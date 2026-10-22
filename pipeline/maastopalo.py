#!/usr/bin/env python3
"""Kaira: voimassa olevat maastopalovaroitukset (Ilmatieteen laitos) kartalle.

Ilmatieteen laitos julkaisee varoitukset CAP-muodossa (Common Alerting Protocol 1.2). Syöte luetaan GitHub
Actionsissa tunnin välein (.github/workflows/maastopalo.yml), joten puhelin ei lähetä sijaintiaan minnekään.
Maastopalovaroitus (eventCode forestFireWeather) korvasi metsäpalo- ja ruohikkopalovaroitukset keväällä 2024.

Tulos: docs/data/maastopalo.json. Tiedosto kirjoitetaan vain, kun varoitukset muuttuvat, jotta jokainen tarkistus
ei käynnistä Cloudflare Pagesin julkaisua (ilmaistasolla 500 julkaisua kuukaudessa).

  python3 pipeline/maastopalo.py             # päivitys
  python3 pipeline/maastopalo.py --diagnose  # lisäksi muutaman minkä tahansa varoituksen rakenne lokiin
"""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vesitilanne import simplify_ring  # noqa: E402

FEED = "https://alerts.fmi.fi/cap/feed/atom_fi-FI.xml"
CAP_PREFIX = "https://alerts.fmi.fi/cap/"
UA = "kaira/0.1 (+https://github.com/gitdaada/kaira)"
EVENT = "forestFireWeather"
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs", "data", "maastopalo.json")
TASO = {"Moderate": "keltainen", "Severe": "oranssi", "Extreme": "punainen"}
MAX_ALERTS = 300
SIMPLIFY_DEG = 0.001  # noin 100 m
ATOM = "{http://www.w3.org/2005/Atom}"


def gh(level, msg):
    msg = str(msg).replace("\n", " ")[:900]
    print(("::%s::%s" % (level, msg)) if os.environ.get("GITHUB_ACTIONS") else msg, flush=True)


def get(url, timeout=60, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode("utf-8", "replace") if hasattr(e, "read") else ""
            last = RuntimeError("HTTP %s %s (%s): %s" % (e.code, e.reason, e.headers.get("Server", "?"), re.sub(r"\s+", " ", body)))
        except Exception as e:  # noqa: BLE001
            last = e
        time.sleep(10 * (i + 1))
    raise last


def local(tag):
    """Elementin nimi ilman nimiavaruutta."""
    return tag.rsplit("}", 1)[-1]


def child(el, name):
    for c in el:
        if local(c.tag) == name:
            return c
    return None


def children(el, name):
    return [c for c in el if local(c.tag) == name]


def text(el, name, default=""):
    c = child(el, name) if el is not None else None
    return (c.text or "").strip() if c is not None and c.text else default


def parse_feed(xml_bytes):
    """Atom-syöte -> [(otsikko, CAP-osoite)]. Vain alerts.fmi.fi:n CAP-dokumentit hyväksytään."""
    root = ET.fromstring(xml_bytes)
    out = []
    for e in root.iter(ATOM + "entry"):
        title = text(e, "title")
        summary = text(e, "summary")
        href = None
        for ln in children(e, "link"):
            h = ln.get("href") or ""
            if h.startswith(CAP_PREFIX) and h.endswith(".xml") and ".." not in h:
                href = h
                break
        if href:
            out.append((title, summary, href))
    return out


def parse_polygon(s):
    """CAP 1.2: välilyönnein erotetut "lat,lon"-parit WGS84:nä -> [[lon, lat], ...] suljettuna renkaana."""
    pts = []
    for pair in (s or "").split():
        try:
            lat, lon = (float(x) for x in pair.split(","))
        except ValueError:
            continue
        if 55 <= lat <= 72 and 15 <= lon <= 35:  # Suomi ja lähialueet
            pts.append((lon, lat))
    if len(pts) < 4:
        return None
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    pts = simplify_ring(pts, SIMPLIFY_DEG)
    return [[round(p[0], 4), round(p[1], 4)] for p in pts] if len(pts) >= 4 else None


def parse_time(s):
    try:
        t = dt.datetime.fromisoformat((s or "").strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else None


def clean(s, n):
    s = re.sub(r"[\x00-\x1f\x7f]+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def parse_cap(xml_bytes):
    """CAP-dokumentti -> dict tai None, jos kyse ei ole voimassa olevasta maastopalovaroituksesta."""
    root = ET.fromstring(xml_bytes)
    if local(root.tag) != "alert":
        return None
    a = {"id": text(root, "identifier"), "status": text(root, "status"), "msgType": text(root, "msgType"),
         "sent": text(root, "sent"), "references": text(root, "references")}
    infos = children(root, "info")
    info = next((i for i in infos if text(i, "language").lower() == "fi-fi"), infos[0] if infos else None)
    if info is None:
        return None
    codes = [text(c, "value") for c in children(info, "eventCode")]
    a.update({"event": text(info, "event"), "codes": codes, "severity": text(info, "severity"),
              "onset": text(info, "onset") or text(info, "effective"), "expires": text(info, "expires"),
              "headline": text(info, "headline"), "description": text(info, "description")})
    areas = []
    for ar in children(info, "area"):
        polys = [p for p in (parse_polygon(pe.text) for pe in children(ar, "polygon")) if p]
        areas.append({"nimi": text(ar, "areaDesc"), "polygonit": polys})
    a["areas"] = areas
    return a


def superseded(alerts):
    """Update- ja Cancel-viestit korvaavat aiemmat: references = "lähettäjä,tunniste,aika ..."."""
    out = set()
    for a in alerts:
        for ref in (a.get("references") or "").split():
            parts = ref.split(",")
            if len(parts) >= 2:
                out.add(parts[1])
    return out


def build(alerts, now):
    gone = superseded(alerts)
    out = []
    for a in alerts:
        if EVENT not in a["codes"] or a["status"] != "Actual" or a["msgType"] == "Cancel" or a["id"] in gone:
            continue
        onset, expires = parse_time(a["onset"]), parse_time(a["expires"])
        if not expires or expires <= now:
            continue
        taso = TASO.get(a["severity"])
        if not taso:
            continue
        for ar in a["areas"]:
            if not ar["polygonit"]:
                continue
            out.append({"id": clean(a["id"], 120), "taso": taso, "alue": clean(ar["nimi"], 120),
                        "otsikko": clean(a["headline"], 160), "kuvaus": clean(a["description"], 400),
                        "alkaa": onset.isoformat() if onset else None, "paattyy": expires.isoformat(),
                        "polygonit": ar["polygonit"][:20]})
    out.sort(key=lambda w: (w["alkaa"] or "", w["alue"], w["taso"]))
    return out[:MAX_ALERTS]


def diagnose(entries, n=3):
    """Lokiin muutaman varoituksen rakenne (mikä tahansa varoitustyyppi), jotta jäsennys voidaan todeta oikeaksi."""
    for title, _, href in entries[:n]:
        try:
            a = parse_cap(get(href))
        except Exception as e:  # noqa: BLE001
            gh("warning", "Diagnostiikka: %s: %r" % (href, e))
            continue
        if not a:
            gh("warning", "Diagnostiikka: ei CAP-hälytys: %s" % href)
            continue
        gh("notice", "Diagnostiikka: %s | %s %s %s | onset %s expires %s | alueita %d, polygoneja %d, pisteitä %d" % (
            clean(title, 80), a["msgType"], ",".join(a["codes"]), a["severity"], a["onset"], a["expires"], len(a["areas"]),
            sum(len(x["polygonit"]) for x in a["areas"]), sum(len(p) for x in a["areas"] for p in x["polygonit"])))


def main():
    now = dt.datetime.now(dt.timezone.utc)
    entries = parse_feed(get(FEED))
    fire = [e for e in entries if re.search(r"maastopalo", e[0] + " " + e[1], re.I)]
    gh("notice", "Syötteessä %d varoitusta, joista maastopalovaroituksia %d" % (len(entries), len(fire)))
    if "--diagnose" in sys.argv:
        diagnose(fire + [e for e in entries if e not in fire])
    alerts = []
    for title, _, href in fire[:MAX_ALERTS]:
        try:
            a = parse_cap(get(href))
        except Exception as e:  # noqa: BLE001
            raise RuntimeError("Varoitusta ei saatu: %s (%r)" % (href, e))
        if a:
            alerts.append(a)
    warnings = build(alerts, now)
    data = {"lahde": "Ilmatieteen laitos, varoitukset (alerts.fmi.fi)", "varoitukset": warnings}
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except (OSError, ValueError):
        old = None
    if old and {k: v for k, v in old.items() if k != "paivitetty"} == data:
        gh("notice", "Maastopalovaroitukset ennallaan (%d)" % len(warnings))
        return 0
    data = {"paivitetty": now.replace(microsecond=0).isoformat().replace("+00:00", "Z"), **data}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write("\n")
    gh("notice", "Maastopalovaroitukset päivitetty: %d aluetta (%s)" % (
        len(warnings), ", ".join(sorted({w["taso"] for w in warnings})) or "ei varoituksia"))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001
        gh("error", "VIRHE: %s" % e)
        sys.exit(1)

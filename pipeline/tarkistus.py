#!/usr/bin/env python3
"""Rajapintojen tarkistus GitHub Actionsissa (käsin käynnistettävä): tulostaa vastausten rakenteen, jotta
sovelluksen jäsennys voidaan todeta oikeaksi oikealla datalla. Ei tallenna mitään."""
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vesitilanne as V  # noqa: E402

FMI = "https://opendata.fmi.fi/wfs"


def gh(level, msg):
    print("::%s::%s" % (level, str(msg).replace("\n", " ")[:950]), flush=True)


def fmi(q):
    url = FMI + "?" + urllib.parse.urlencode(dict({"service": "WFS", "version": "2.0.0", "request": "getFeature"}, **q))
    req = urllib.request.Request(url, headers={"User-Agent": V.UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def members(xml):
    return re.findall(r"<wfs:member>.*?</wfs:member>", xml, re.S)


def iso(t):
    return t.replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    # Ensin: GitHub näyttää enintään 10 merkintää tyyppiä kohden askeleessa.
    mml_tiles()
    rapids_sources()
    now = dt.datetime.now(dt.timezone.utc)
    # Salamat: rakenne ensimmäisestä havainnosta (haetaan taaksepäin, kunnes löytyy)
    for days in (1, 7, 30):
        try:
            x = fmi({"storedquery_id": "fmi::observations::lightning::simple", "bbox": "19,59,32,71", "parameters": "peak_current,multiplicity",
                     "starttime": iso(now - dt.timedelta(days=days)), "endtime": iso(now)})
        except Exception as e:  # noqa: BLE001
            gh("warning", "Salamat %d vrk: %r" % (days, e))
            continue
        m = members(x)
        gh("notice", "Salamat %d vrk: %d jäsentä, %d tavua" % (days, len(m), len(x)))
        if m:
            gh("notice", "Salamat esimerkki: " + re.sub(r"\s+", " ", m[0])[:900])
            break
    # Lumensyvyys
    try:
        x = fmi({"storedquery_id": "fmi::observations::weather::simple", "bbox": "24,66,30,70", "parameters": "snow_aws",
                 "starttime": iso(now - dt.timedelta(hours=3)), "endtime": iso(now), "timestep": "60"})
        m = members(x)
        pos = {re.search(r"<gml:pos>([^<]+)</gml:pos>", s).group(1).strip() for s in m if "<gml:pos>" in s}
        vals = re.findall(r"<BsWfs:ParameterValue>([^<]*)</BsWfs:ParameterValue>", x)
        gh("notice", "Lumi: %d jäsentä, %d asemaa, arvoja esim. %s" % (len(m), len(pos), vals[:12]))
        if m:
            gh("notice", "Lumi esimerkki: " + re.sub(r"\s+", " ", m[0])[:900])
        else:
            gh("notice", "Lumi vastaus: " + re.sub(r"\s+", " ", x)[:900])
    except Exception as e:  # noqa: BLE001
        gh("warning", "Lumi: %r" % e)
    # Syke: pintaveden lämpötila
    try:
        V.syke_suureet()
        temp = {k: v for k, v in V.SUURE.items() if "lämpö" in (v[0] or "").lower() or "lampo" in (v[0] or "").lower()}
        gh("notice", "Syke lämpösuureet: %s" % temp)
        rows = V.syke_json("LampoPintavesi", {"$top": "3", "$orderby": "Aika desc"})
        gh("notice", "Syke LampoPintavesi esimerkki: %s" % json.dumps(rows[:3], ensure_ascii=False)[:800])
        sid = next(iter(temp)) if temp else None
        if sid is not None:
            ps = V.syke_json("Paikka", {"$filter": "Suure_Id eq %d" % sid, "$top": "3"})
            gh("notice", "Syke lämpöasemat (Suure %s): %d, esim. %s" % (sid, len(ps), json.dumps(ps[:2], ensure_ascii=False)[:600]))
    except Exception as e:  # noqa: BLE001
        gh("warning", "Syke: %r" % e)
    # Vesistökäyrät oikealla datalla: keinotekoinen uoma Roukkajankosken (Nurmes) asemien kohdalla
    try:
        lat, lon = V.dms("633838"), V.dms("290549")
        gj = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"joki_id": "testi"},
              "geometry": {"type": "LineString", "coordinates": [[lon - 0.02, lat - 0.005], [lon, lat], [lon + 0.02, lat + 0.005]]}}]}
        today = now.date()
        stations = V.syke_stations({"bbox_latlon": V.river_bbox(gj, 0.05)})
        m, ms = V.syke_status({"id": "testi"}, gj, stations, today)
        for x in ms:
            gh("notice", "Käyrä %s: asema %s, arvo %s %s, sarja %d pv, kaista %d pv, luokka %s" % (
                x["suure"], x["asema"], x["arvo"], x["yksikko"], len(x["sarja"]), len(x["kaista"]), x["luokka"]))
        t = V.temperature({"id": "testi"}, gj, V.syke_temp_stations(V.river_bbox(gj, 0.15)), today)
        gh("notice", "Lämpötila: %s" % (json.dumps({k: t[k] for k in ("asema", "arvo", "aika", "etaisyys_km", "vuodet")}, ensure_ascii=False)
                                         + " sarja %d, kaista %d" % (len(t["sarja"]), len(t["kaista"])) if t else "ei asemaa"))
        for line in V.log[-12:]:
            gh("notice", "Loki: " + line)
    except Exception as e:  # noqa: BLE001
        gh("warning", "Vesistökäyrät: %r" % e)
    return 0


def mml_tiles():
    """Maanmittauslaitoksen karttatiilet avaimella (Actions-salaisuus): tila, viive ja koko. Osoitetta ei tulosteta."""
    import math
    key = os.environ.get("MML_API_KEY", "").strip()
    lat, lon = 60.12, 24.44  # Kirkkonummi
    rows = []
    for layer, ext in (("maastokartta", "png"), ("taustakartta", "png")):
        for z in (13, 15, 16):
            n = 2 ** z
            x = int((lon + 180) / 360 * n)
            y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
            for k in ([key] if key else []) + [""]:
                url = "https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/%s/default/WGS84_Pseudo-Mercator/%d/%d/%d.%s" % (layer, z, y, x, ext)
                if k:
                    url += "?" + urllib.parse.urlencode({"api-key": k})
                t0 = time.time()
                try:
                    req = urllib.request.Request(url, headers={"User-Agent": V.UA})
                    with urllib.request.urlopen(req, timeout=30) as r:
                        body = r.read()
                        st, ct, hd = r.status, r.headers.get("Content-Type"), {h: r.headers.get(h) for h in ("Retry-After", "X-RateLimit-Remaining") if r.headers.get(h)}
                except urllib.error.HTTPError as e:
                    body, st, ct, hd = e.read()[:200], e.code, e.headers.get("Content-Type"), {h: e.headers.get(h) for h in ("Retry-After", "X-RateLimit-Remaining") if e.headers.get(h)}
                except Exception as e:  # noqa: BLE001
                    body, st, ct, hd = b"", type(e).__name__, "", {}
                rows.append("%s z%d %s: %s %s %d t %d ms%s%s" % (layer, z, "avain" if k else "ilman", st, ct, len(body), (time.time() - t0) * 1000,
                                                                 " " + json.dumps(hd) if hd else "", (" " + body[:120].decode("utf-8", "replace")) if st != 200 else ""))
    gh("notice", "MML-tiilet (avain %s): %s" % ("asetettu" if key else "puuttuu", " | ".join(rows)))


MML_OGC = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1/"


def rapids_sources():
    """Kosket ja suvannot piirretyillä kalastusalueilla: OpenStreetMap alueella ja sen ympäristössä (10 km)
    sekä Maanmittauslaitoksen maastotietokanta (kohdeluokka Koski), jos avain on asetettu Actionsin salaisuudeksi."""
    key = os.environ.get("MML_API_KEY", "").strip()
    for a in V.read_drawn():
        s, w, n, e = a["bbox_latlon"]
        m = 0.09
        bb = "%f,%f,%f,%f" % (s - m, w - m * 2.5, n + m, e + m * 2.5)
        q = ('[out:json][timeout:90];(nwr["waterway"~"^(rapids|waterfall)$"](%s);nwr["water"="rapids"](%s);nwr["whitewater"](%s);'
             'nwr["name"~"(koski|kongas|köngäs|niva|suvanto|suanto)$",i](%s););out center tags;' % (bb, bb, bb, bb))
        try:
            j = None
            for ep in (V.OVERPASS, "https://overpass.kumi.systems/api/interpreter"):
                try:
                    j = json.loads(V.get(ep, data=urllib.parse.urlencode({"data": q}).encode(), timeout=120, tries=2))
                    break
                except Exception as ex2:  # noqa: BLE001
                    gh("notice", "OSM %s: %s %r" % (a["id"], ep.split("/")[2], ex2))
            if j is None:
                continue
            els = j.get("elements", [])
            rows = []
            for el in els:
                t = el.get("tags", {})
                c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
                rows.append("%s %s [%s] %.1f km" % (el["type"][0], t.get("name", "-"), ",".join("%s=%s" % (k, t[k]) for k in ("waterway", "water", "whitewater", "natural", "place") if k in t),
                                                     V.dist_km((s + n) / 2, (w + e) / 2, c["lat"], c["lon"]) if c.get("lat") else -1))
            gh("notice", "OSM %s (alue + 10 km): %d kohdetta: %s" % (a["id"], len(els), "; ".join(sorted(rows, key=lambda r: float(r.rsplit(" ", 2)[-2]))[:15])))
        except Exception as ex:  # noqa: BLE001
            gh("warning", "OSM %s: %r" % (a["id"], ex))
        time.sleep(3)
        if not key:
            gh("notice", "MML %s: ei avainta (MML_API_KEY)" % a["id"])
            continue
        inside = lambda lon, lat: any(point_in_ring(lon, lat, r) for r in a["rings"])  # noqa: E731
        big = "%f,%f,%f,%f" % (w - m * 2.5, s - m, e + m * 2.5, n + m)
        try:
            fs = mml_items(MML_OGC + "collections/koski/items", big, key)
            rows = []
            for f in fs:
                c = feature_center(f.get("geometry") or {})
                rows.append((V.dist_km((s + n) / 2, (w + e) / 2, c[1], c[0]), c, (f.get("geometry") or {}).get("type"), inside(c[0], c[1])))
            rows.sort()
            gh("notice", "MML koski %s (alue + 10 km): %d kohdetta, alueella %d. Ominaisuudet: %s. Lähimmät: %s" % (
                a["id"], len(fs), sum(r[3] for r in rows), json.dumps(fs[0].get("properties") if fs else None, ensure_ascii=False)[:400],
                "; ".join("%.2f km %s %.5f,%.5f%s" % (r[0], r[2], r[1][1], r[1][0], " (alueella)" if r[3] else "") for r in rows[:8])))
        except urllib.error.HTTPError as ex:
            gh("warning", "MML koski %s: HTTP %s" % (a["id"], ex.code))
        except Exception as ex:  # noqa: BLE001
            gh("warning", "MML koski %s: %r" % (a["id"], ex))
        # Nimistö: koskien ja suvantojen nimet
        try:
            fs = mml_items(MML_NAMES + "collections/placenames/items", big, key)
            hits = []
            for f in fs:
                pr = f.get("properties") or {}
                nm = str(pr.get("spelling") or pr.get("name") or "")
                if re.search(r"(koski|kongas|köngäs|niva|suvanto|suanto|vuopio|oja|eno|joki)$", nm, re.I):
                    c = feature_center(f.get("geometry") or {})
                    hits.append("%s [%s] %.2f km%s" % (nm, pr.get("placeType") or pr.get("placeTypeCode") or pr.get("type"),
                                                      V.dist_km((s + n) / 2, (w + e) / 2, c[1], c[0]), " (alueella)" if inside(c[0], c[1]) else ""))
            gh("notice", "MML nimistö %s: %d nimeä, vesinimiä %d. Ominaisuudet: %s. %s" % (
                a["id"], len(fs), len(hits), json.dumps(fs[0].get("properties") if fs else None, ensure_ascii=False)[:300], "; ".join(sorted(hits)[:20])))
        except urllib.error.HTTPError as ex:
            gh("warning", "MML nimistö %s: HTTP %s" % (a["id"], ex.code))
        except Exception as ex:  # noqa: BLE001
            gh("warning", "MML nimistö %s: %r" % (a["id"], ex))


def point_in_ring(x, y, ring):
    ins, j = False, len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]
        xj, yj = ring[j][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            ins = not ins
        j = i
    return ins


def feature_center(g):
    """Geometrian keskikohta (lon, lat): pisteen sijainti, viivan tai alueen pisteiden keskiarvo."""
    t, c = g.get("type"), g.get("coordinates")
    if t == "Point":
        return c[0], c[1]
    pts = c if t in ("LineString", "MultiPoint") else [p for part in c for p in (part if t != "MultiPolygon" else part[0])]
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


MML_NAMES = "https://avoin-paikkatieto.maanmittauslaitos.fi/geographic-names/features/v1/"


def mml_items(base, bbox, key, limit=1000, pages=5):
    """OGC API Features -haku sivuittain (next-linkit). Avain vain kyselyparametrina, ei lokiin."""
    url = base + "?" + urllib.parse.urlencode({"bbox": bbox, "limit": str(limit), "api-key": key})
    out = []
    for _ in range(pages):
        req = urllib.request.Request(url, headers={"User-Agent": V.UA, "Accept": "application/geo+json"})
        with urllib.request.urlopen(req, timeout=90) as r:
            fc = json.loads(r.read())
        out += fc.get("features", [])
        nxt = [l.get("href") for l in fc.get("links", []) if l.get("rel") == "next"]
        if not nxt or not fc.get("features"):
            break
        url = nxt[0] if "api-key=" in nxt[0] else nxt[0] + ("&" if "?" in nxt[0] else "?") + urllib.parse.urlencode({"api-key": key})
    return out


if __name__ == "__main__":
    sys.exit(main())

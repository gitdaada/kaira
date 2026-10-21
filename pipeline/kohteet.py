"""Eränkäynnin kohteet koko Suomesta OpenStreetMapista: docs/data/kohteet/{tuvat,laavut,tulipaikat}.geojson.

Ajetaan GitHub Actionsissa kerran kuukaudessa (.github/workflows/kohteet.yml). Vain Pythonin
standardikirjasto ja julkinen Overpass-rajapinta, ei avaimia. Aineisto © OpenStreetMapin tekijät, ODbL.

- tuvat:      autiotuvat, autiokammit, päivätuvat ja kodat (tourism=wilderness_hut, nimessä autiotupa/-kammi,
              amenity=shelter + shelter_type=basic_hut). Varaus- ja vuokratuvat jätetään pois.
- laavut:     amenity=shelter + shelter_type=lean_to, tourism=lean_to tai nimessä laavu.
- tulipaikat: leisure=firepit. Laavun, kodan tai tuvan vieressä (alle 40 m) oleva tulipaikka yhdistetään siihen.
Yksityiset, käytöstä poistetut ja raunioituneet kohteet jätetään pois. Kohteista tallennetaan vain
kohteen tiedot (nimi, sijainti, varustus, ylläpitäjä), ei henkilötietoja.
"""
import datetime as dt
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "kaira/0.1 (+https://github.com/gitdaada/kaira)"
# Julkiset Overpass-palvelimet: toinen on varalla, jos ensimmäinen on ylikuormittunut.
ENDPOINTS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
DEADLINE_S = 40 * 60  # tämän jälkeen loput maakunnat käyttävät edellistä aineistoa
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "docs", "data", "kohteet")
MAAKUNNAT = [
    ("FI-01", "Ahvenanmaa"), ("FI-02", "Etelä-Karjala"), ("FI-03", "Etelä-Pohjanmaa"), ("FI-04", "Etelä-Savo"),
    ("FI-05", "Kainuu"), ("FI-06", "Kanta-Häme"), ("FI-07", "Keski-Pohjanmaa"), ("FI-08", "Keski-Suomi"),
    ("FI-09", "Kymenlaakso"), ("FI-10", "Lappi"), ("FI-11", "Pirkanmaa"), ("FI-12", "Pohjanmaa"),
    ("FI-13", "Pohjois-Karjala"), ("FI-14", "Pohjois-Pohjanmaa"), ("FI-15", "Pohjois-Savo"), ("FI-16", "Päijät-Häme"),
    ("FI-17", "Satakunta"), ("FI-18", "Uusimaa"), ("FI-19", "Varsinais-Suomi"),
]
POIS = re.compile(r"varaustupa|vuokratupa|vuokrakämppä|vuokrakota|varauskammi|vuokrakammi", re.I)
TYYPIT = {"autiotupa": "Autiotupa", "kammi": "Autiokammi", "paivatupa": "Päivätupa", "kota": "Kota",
          "laavu": "Laavu", "tulipaikka": "Tulipaikka"}
TIEDOSTO = {"autiotupa": "tuvat", "kammi": "tuvat", "paivatupa": "tuvat", "kota": "tuvat", "laavu": "laavut", "tulipaikka": "tulipaikat"}
# Alarajat: jos haku palauttaa vähemmän, aineistoa ei päivitetä (Overpass-virhe tai osittainen vastaus).
MINIMI = {"tuvat": 150, "laavut": 300, "tulipaikat": 200}
NIMI_TUPA = re.compile(r"autiotupa|autiokammi|autiotuvat", re.I)
LINKIT = ("luontoon.fi", "metsa.fi", "retkikartta.fi")


def get(url, data=None, timeout=330, tries=2):  # yli Overpassin oman aikarajan (280 s)
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            last = e
            # Ylikuormitettu palvelin (502/503/504/429): ei odoteta samaa palvelinta, vaan kokeillaan varapalvelinta.
            if getattr(e, "code", None) in (429, 502, 503, 504):
                break
            time.sleep(20 * (i + 1))
    raise last


def gh(level, msg):
    """GitHub Actionsin merkintä (näkyy ajon yhteenvedossa ja rajapinnassa), muuten tavallinen tuloste."""
    msg = str(msg).replace("\n", " ")[:900]
    print(("::%s::%s" % (level, msg)) if os.environ.get("GITHUB_ACTIONS") else msg, flush=True)


def overpass(iso):
    q = ('[out:json][timeout:280];area["ISO3166-2"="%s"]->.a;('
         'nwr["tourism"="wilderness_hut"](area.a);'
         # Nimihaku vain rakennuksista ja palvelukohteista: koko maakunnan kaikkien nimien läpikäynti on raskas.
         'nwr["building"]["name"~"autiotupa|autiokammi",i](area.a);'
         'nwr["amenity"]["name"~"autiotupa|autiokammi",i](area.a);'
         'nwr["amenity"="shelter"]["shelter_type"~"^(lean_to|basic_hut)$"](area.a);'
         'nwr["tourism"="lean_to"](area.a);'
         'nwr["amenity"="shelter"]["name"~"laavu|kota",i](area.a);'
         'nwr["leisure"="firepit"](area.a);'
         ');out center tags;') % iso
    data = urllib.parse.urlencode({"data": q}).encode()
    errors = []
    for url in ENDPOINTS:
        try:
            j = json.loads(get(url, data=data))
            if "elements" not in j:
                raise RuntimeError("vastauksessa ei ole elements-kenttää: %s" % str(j.get("remark", ""))[:200])
            if "runtime error" in str(j.get("remark", "")).lower():
                raise RuntimeError(str(j["remark"])[:200])
            return j["elements"]
        except Exception as e:  # noqa: BLE001
            errors.append("%s: %r" % (urllib.parse.urlparse(url).hostname, e))
    raise RuntimeError("; ".join(errors))


def previous(maakunta):
    """Maakunnan kohteet edellisestä aineistosta (käytetään, jos haku epäonnistuu)."""
    out = {}
    for k in MINIMI:
        try:
            with open(os.path.join(OUT_DIR, k + ".geojson"), encoding="utf-8") as fh:
                feats = json.load(fh).get("features", [])
        except (OSError, ValueError):
            feats = []
        out[k] = [f for f in feats if (f.get("properties") or {}).get("maakunta") == maakunta]
    return out


def clean_text(s, n):
    s = re.sub(r"[\x00-\x1f\x7f]+", " ", str(s or "")).strip()
    return s if len(s) <= n else s[: n - 1].rstrip() + "…"


def num(s):
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)", str(s or ""))
    return float(m.group(1).replace(",", ".")) if m else None


def safe_link(t):
    for k in ("website", "contact:website", "url"):
        u = t.get(k, "")
        try:
            p = urllib.parse.urlparse(u)
        except ValueError:
            continue
        host = (p.hostname or "").lower()
        if p.scheme == "https" and any(host == d or host.endswith("." + d) for d in LINKIT):
            return u[:300]
    return None


def unusable(t):
    """Syy, jos kohde ei ole vapaasti käytettävissä, muuten None."""
    if t.get("access") in ("private", "no", "customers"):
        return "ei vapaata pääsyä"
    if t.get("ruins") == "yes" or any(k.startswith(("disused:", "abandoned:", "was:", "removed:", "destroyed:", "razed:")) for k in t):
        return "purettu tai käytöstä poistettu"
    return None


def is_hut(t):
    """Palauttaa (hyväksytty, syy) autiotuville ja -kammeille."""
    name = t.get("name", "") or t.get("name:fi", "")
    if t.get("tourism") != "wilderness_hut":
        if not NIMI_TUPA.search(name):
            return False, "ei tupa"
        if not ("building" in t or t.get("amenity") == "shelter" or t.get("tourism") == "alpine_hut"):
            return False, "nimi viittaa tupaan, mutta kohde on muu"
    if POIS.search(name):
        return False, "varaus- tai vuokratupa"
    if re.search(r"laavu", name, re.I) and not re.search(r"tupa|kammi", name, re.I):
        return False, "laavu"
    if t.get("reservation") in ("required", "yes", "members_only"):
        return False, "varattava"
    why = unusable(t)
    if why:
        return False, why
    return True, ""


def hut_type(name):
    """autiotupa, kammi, paivatupa tai kota nimen perusteella (autiotupa voittaa, jos nimessä on molemmat)."""
    if re.search(r"autiotupa|autiotuvat", name, re.I):
        return "autiotupa"
    if re.search(r"päivätupa", name, re.I):
        return "paivatupa"
    if re.search(r"kammi", name, re.I):
        return "kammi"
    if re.search(r"kota\b", name, re.I):
        return "kota"
    return "autiotupa"


def classify(t):
    """Palauttaa (tyyppi, syy). tyyppi = None, jos kohde jätetään pois."""
    name = t.get("name", "") or t.get("name:fi", "")
    if t.get("tourism") == "wilderness_hut" or NIMI_TUPA.search(name):
        ok, why = is_hut(t)
        if ok:
            return hut_type(name), ""
        if why != "laavu":
            return None, why
    why = unusable(t)
    if why:
        return None, why
    if t.get("leisure") == "firepit" and t.get("amenity") != "shelter":
        return "tulipaikka", ""
    st = t.get("shelter_type", "")
    named_laavu = re.search(r"laavu", name, re.I) and (t.get("amenity") == "shelter" or t.get("tourism") == "wilderness_hut" or "building" in t)
    if t.get("tourism") == "lean_to" or st == "lean_to" or named_laavu:
        return "laavu", ""
    if t.get("amenity") == "shelter" and (st == "basic_hut" or re.search(r"kota\b|kota$", name, re.I)):
        if POIS.search(name) or t.get("reservation") in ("required", "yes", "members_only"):
            return None, "varattava"
        return "kota", ""
    return None, "muu kohde"


def describe(t, tyyppi, maakunta, tuli_vieressa=False):
    s = ["%s, %s." % (TYYPIT[tyyppi], maakunta)]
    if tyyppi == "paivatupa":
        s.append("Tarkoitettu päiväkäyttöön, kuten taukoihin ja ruokailuun.")
    cap = num(t.get("capacity") or t.get("beds"))
    if cap and tyyppi in ("autiotupa", "kammi", "paivatupa", "kota"):
        s.append("Makuupaikkoja noin %d." % cap)
    if tyyppi != "tulipaikka" and (tuli_vieressa or t.get("fireplace") == "yes" or t.get("bbq") == "yes" or t.get("heating") in ("stove", "fireplace", "wood")):
        s.append("Tulisija.")
    if t.get("toilets") == "yes":
        s.append("Käymälä.")
    if t.get("drinking_water") == "yes":
        s.append("Juomavettä saatavilla.")
    if t.get("operator"):
        s.append("Ylläpitäjä: %s." % clean_text(t["operator"], 60))
    ele = num(t.get("ele"))
    if ele and tyyppi in ("autiotupa", "kammi"):
        s.append("Korkeus %d m." % round(ele))
    d = t.get("description:fi") or t.get("description")
    if d:
        s.append(clean_text(d, 200))
    return " ".join(s)


def dist_m(a, b):
    R = 6371000.0
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dla, dlo = la2 - la1, math.radians(b[0] - a[0])
    h = math.sin(dla / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlo / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


class Grid:
    """Karkea ruudukko lähinaapurien hakuun (n. 1 km ruudut)."""
    def __init__(self):
        self.cells = {}

    def key(self, c):
        return (int(c[0] * 50), int(c[1] * 100))

    def add(self, c, item):
        self.cells.setdefault(self.key(c), []).append(item)

    def near(self, c):
        kx, ky = self.key(c)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                yield from self.cells.get((kx + dx, ky + dy), [])


def build(elements_by_region):
    """elements_by_region = [(maakunta, [osm-elementit])] -> {tiedosto: [featuret]}, poisjätetyt."""
    raw, excluded = [], {}
    for maakunta, els in elements_by_region:
        for el in els:
            t = el.get("tags", {})
            tyyppi, why = classify(t)
            if not tyyppi:
                excluded[why] = excluded.get(why, 0) + 1
                continue
            c = el.get("center") or {"lat": el.get("lat"), "lon": el.get("lon")}
            if c.get("lat") is None:
                continue
            raw.append({"t": t, "tyyppi": tyyppi, "maakunta": maakunta, "osm": "%s/%d" % (el["type"], el["id"]),
                        "c": [round(c["lon"], 5), round(c["lat"], 5)], "n": len(t)})

    # Sama kohde voi olla sekä pisteenä että rakennuksena (ja kahden maakunnan haussa): poistetaan kaksoiskappaleet.
    raw.sort(key=lambda r: -r["n"])
    seen_osm, kept, grid = set(), [], Grid()
    for r in raw:
        if r["osm"] in seen_osm:
            continue
        seen_osm.add(r["osm"])
        name = (r["t"].get("name") or r["t"].get("name:fi") or "").lower()
        dup = False
        for k in grid.near(r["c"]):
            same_kind = TIEDOSTO[k["tyyppi"]] == TIEDOSTO[r["tyyppi"]]
            kname = (k["t"].get("name") or k["t"].get("name:fi") or "").lower()
            if same_kind and dist_m(k["c"], r["c"]) < (300 if name and name == kname else 25):
                dup = True
                break
        if dup:
            continue
        grid.add(r["c"], r)
        kept.append(r)

    # Tulipaikka laavun, kodan tai tuvan vieressä yhdistetään siihen.
    shelters = Grid()
    for r in kept:
        if r["tyyppi"] != "tulipaikka":
            shelters.add(r["c"], r)
    merged = set()
    for r in kept:
        if r["tyyppi"] == "tulipaikka":
            for k in shelters.near(r["c"]):
                if dist_m(k["c"], r["c"]) < 40:
                    k["tuli"] = True
                    merged.add(r["osm"])
    out = {"tuvat": [], "laavut": [], "tulipaikat": []}
    for r in kept:
        if r["osm"] in merged:
            continue
        name = r["t"].get("name") or r["t"].get("name:fi") or ""
        props = {"nimi": clean_text(name, 80), "tyyppi": r["tyyppi"], "maakunta": r["maakunta"],
                 "kuvaus": describe(r["t"], r["tyyppi"], r["maakunta"], r.get("tuli", False)), "osm": r["osm"]}
        link = safe_link(r["t"])
        if link:
            props["linkki"] = link
        out[TIEDOSTO[r["tyyppi"]]].append({"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": r["c"]}})
    for k in out:
        out[k].sort(key=lambda f: (f["properties"]["maakunta"], f["properties"]["nimi"], f["geometry"]["coordinates"]))
    return out, excluded


def coverage():
    """Maakunnat, joista edellisessä aineistossa on kohteita (kaikki tiedostot)."""
    have = None
    for k in MINIMI:
        names = {f["properties"]["maakunta"] for f in sum(previous_all(k), [])}
        have = names if have is None else have & names
    return have or set()


def previous_all(k):
    try:
        with open(os.path.join(OUT_DIR, k + ".geojson"), encoding="utf-8") as fh:
            return [json.load(fh).get("features", [])]
    except (OSError, ValueError):
        return [[]]


def main():
    regions, failed, t0 = [], [], time.time()
    # Puuttuvat maakunnat ensin: jos rajapinta on ruuhkainen, jokainen ajo täydentää aineistoa.
    have = coverage()
    order = sorted(MAAKUNNAT, key=lambda m: m[1] in have)
    if have:
        print("Edellisessä aineistossa kaikki tiedostot: %s" % ", ".join(sorted(have)), flush=True)
    for iso, maakunta in order:
        if time.time() - t0 > DEADLINE_S:
            failed.append(maakunta)
            gh("warning", "%s: aika loppui, käytetään edellistä aineistoa" % maakunta)
            continue
        try:
            els = overpass(iso)
        except Exception as e:  # noqa: BLE001
            failed.append(maakunta)
            gh("warning", "%s: haku epäonnistui, käytetään edellistä aineistoa (%s)" % (maakunta, e))
            continue
        print("%s: %d OSM-kohdetta" % (maakunta, len(els)), flush=True)
        if not els:
            gh("warning", "%s: ei yhtään kohdetta (tarkista ISO3166-2-tunnus %s)" % (maakunta, iso))
        regions.append((maakunta, els))
        time.sleep(8)
    if not regions:
        raise RuntimeError("Yhtään maakuntaa ei saatu haettua")
    out, excluded = build(regions)
    for maakunta in failed:
        for k, feats in previous(maakunta).items():
            out[k] += feats
    for k in out:
        out[k].sort(key=lambda f: (f["properties"]["maakunta"], f["properties"]["nimi"], f["geometry"]["coordinates"]))
    for k, n in MINIMI.items():
        if len(out[k]) < n:
            raise RuntimeError("Liian vähän kohteita (%s: %d < %d), aineistoa ei päivitetä" % (k, len(out[k]), n))
    os.makedirs(OUT_DIR, exist_ok=True)
    today = dt.date.today().isoformat()
    for k, feats in out.items():
        fc = {"type": "FeatureCollection",
              "properties": {"lahde": "© OpenStreetMapin tekijät, ODbL", "paivitetty": today, "maara": len(feats)},
              "features": feats}
        with open(os.path.join(OUT_DIR, k + ".geojson"), "w", encoding="utf-8") as fh:
            json.dump(fc, fh, ensure_ascii=False, separators=(",", ":"))
            fh.write("\n")
        per = {}
        for f in feats:
            per[f["properties"]["tyyppi"]] = per.get(f["properties"]["tyyppi"], 0) + 1
        gh("notice", "%s: %d kohdetta (%s)" % (k, len(feats), ", ".join("%s %d" % kv for kv in sorted(per.items()))))
    gh("notice", "Pois jätetyt: %s%s" % (", ".join("%s %d" % kv for kv in sorted(excluded.items())),
                                          "; edellinen aineisto: " + ", ".join(failed) if failed else ""))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # noqa: BLE001
        gh("error", "VIRHE: %s" % e)
        sys.exit(1)

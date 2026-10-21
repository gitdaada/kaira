"""Kaira / Kalastus: jokien vesitilanne ja jäänpaksuus kartalle.

Ajetaan GitHub Actionsissa kerran päivässä (.github/workflows/vesitilanne.yml). Käyttää vain julkisia rajapintoja
ilman avaimia, ja tulokset tallennetaan repoon:
  - docs/layers/<alue>-joet.geojson  jokien uomat (OpenStreetMap, ODbL), haetaan kun tiedosto puuttuu tai alue muuttuu
  - docs/layers/<alue>.geojson       piirretyn kalastusalueen raja (areas/kalastus/<alue>.geojson)
  - docs/layers/index.json           kalastusalueiden luettelo sovellukselle
  - docs/data/vesitilanne.json       luokka joelle: alhainen / normaali / korkea
  - docs/data/jaa.json               Syken jäänpaksuusmittaukset (viimeiset 30 vrk) koko maasta

Alueet: pipeline/joet.json (käsin määritellyt joet) ja areas/kalastus/*.geojson (sovelluksessa piirretyt alueet,
joiden nimetyt joet ja purot haetaan OpenStreetMapista automaattisesti).

Luokka lasketaan ensisijaisesti Syken mitatusta virtaamasta tai vedenkorkeudesta: arvoa verrataan saman
vuodenajan (±7 vrk) arvoihin aiempina vuosina. Alle 25 %:n = alhainen, yli 75 %:n = korkea, muuten normaali.
Jos joella ei ole mittausasemaa, luokka arvioidaan 14 vuorokauden sademäärästä samalla tavalla
(Ilmatieteen laitoksen lähin sääasema). Sadearvio on karkeampi, ja se merkitään erikseen.
Vain Pythonin standardikirjasto.
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
import xml.etree.ElementTree as ET

UA = "kaira/0.1 (+https://github.com/gitdaada/kaira)"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(ROOT, "pipeline", "joet.json")
OUT = os.path.join(ROOT, "docs", "data", "vesitilanne.json")
LAYERS = os.path.join(ROOT, "docs", "layers")
DRAWN = os.path.join(ROOT, "areas", "kalastus")
ICE_OUT = os.path.join(ROOT, "docs", "data", "jaa.json")
ICE_DAYS = 30
MAX_RIVERS = 15
SYKE = "https://rajapinnat.ymparisto.fi/api/Hydrologiarajapinta/1.2/odata"
FMI = "https://opendata.fmi.fi/wfs"
OVERPASS = "https://overpass-api.de/api/interpreter"
WINDOW_D = 7          # ± vuorokautta vuodenajan vertailussa
MIN_YEARS = 5         # vähintään näin monta vertailuvuotta
MAX_AGE_D = 10        # mittaus enintään näin vanha
NEAR_KM = 2.0         # aseman enimmäisetäisyys uomasta
RAIN_DAYS = 14
RAIN_YEARS = 15
log = []


def note(msg):
    log.append(msg)
    print(msg, flush=True)


def get(url, data=None, timeout=90, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": "application/json, */*"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa
            last = e
            time.sleep(3 * (i + 1))
    raise last


# --- Geometria -------------------------------------------------------------------

def to_tm35(lat, lon):
    """WGS84 -> ETRS-TM35FIN (Krüger-sarja, sama kuin docs/core.js)."""
    a, f = 6378137.0, 1 / 298.257222101
    n = f / (2 - f)
    A = a / (1 + n) * (1 + n * n / 4 + n ** 4 / 64)
    al = [n / 2 - 2 * n * n / 3 + 5 * n ** 3 / 16, 13 * n * n / 48 - 3 * n ** 3 / 5, 61 * n ** 3 / 240]
    e = 2 * math.sqrt(n) / (1 + n)
    phi, dl = math.radians(lat), math.radians(lon - 27)
    t = math.sinh(math.atanh(math.sin(phi)) - e * math.atanh(e * math.sin(phi)))
    xi1, eta1 = math.atan2(t, math.cos(dl)), math.atanh(math.sin(dl) / math.sqrt(1 + t * t))
    xi, eta = xi1, eta1
    for j in range(1, 4):
        xi += al[j - 1] * math.sin(2 * j * xi1) * math.cosh(2 * j * eta1)
        eta += al[j - 1] * math.cos(2 * j * xi1) * math.sinh(2 * j * eta1)
    return 0.9996 * A * xi, 500000 + 0.9996 * A * eta


def dist_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def simplify(pts, tol):
    """Douglas-Peucker asteina (pieni tol riittää karttanäkymään)."""
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dmax, idx = 0, 0
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        num = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1)
        den = math.hypot(y2 - y1, x2 - x1) or 1e-12
        d = num / den
        if d > dmax:
            dmax, idx = d, i
    if dmax > tol:
        return simplify(pts[:idx + 1], tol)[:-1] + simplify(pts[idx:], tol)
    return [pts[0], pts[-1]]


def fetch_rivers(area):
    """Uomat OpenStreetMapista nimen ja rajauksen perusteella."""
    s, w, n, e = area["bbox_latlon"]
    names = "|".join(re.escape(r["osm"]) for r in area["joet"])
    q = '[out:json][timeout:90];way["waterway"~"river|stream"]["name"~"^(%s)$"](%f,%f,%f,%f);out geom tags;' % (names, s, w, n, e)
    j = json.loads(get(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(), timeout=120))
    byname = {r["osm"]: r["id"] for r in area["joet"]}
    feats = []
    for el in j.get("elements", []):
        name = el.get("tags", {}).get("name")
        if name not in byname or not el.get("geometry"):
            continue
        pts = [(round(p["lon"], 5), round(p["lat"], 5)) for p in el["geometry"]]
        pts = simplify(pts, 0.00004)
        feats.append({"type": "Feature", "properties": {"nimi": name, "tyyppi": "joki", "joki_id": byname[name]},
                      "geometry": {"type": "LineString", "coordinates": [list(p) for p in pts]}})
    if not feats:
        raise RuntimeError("OSM: ei uomia alueelle " + area["id"])
    return {"type": "FeatureCollection", "features": feats,
            "properties": {"lahde": "© OpenStreetMapin tekijät, ODbL"}}


def river_points(gj, joki_id):
    pts = []
    for f in gj["features"]:
        if f["properties"].get("joki_id") == joki_id:
            pts += f["geometry"]["coordinates"]
    return pts


# --- Tilastot --------------------------------------------------------------------

def pct(vals, q):
    v = sorted(vals)
    if not v:
        return None
    k = (len(v) - 1) * q
    lo, hi = math.floor(k), math.ceil(k)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def classify(value, p25, p75):
    if value is None or p25 is None or p75 is None:
        return None
    if value < p25:
        return "alhainen"
    if value > p75:
        return "korkea"
    return "normaali"


def doy_diff(a, b):
    d = abs(a.timetuple().tm_yday - b.timetuple().tm_yday)
    return min(d, 365 - d)


# --- Syke --------------------------------------------------------------------------

def odata_query(params):
    """OData-parametrit: $-merkki ja välilyönnit eivät saa koodautua muotoon %24 tai +."""
    return "&".join(k + "=" + urllib.parse.quote(str(v), safe="(),'$:") for k, v in params.items())


def syke_json(path, params):
    url = SYKE + "/" + path + ("?" + odata_query(params) if params else "")  # $format ei ole sallittu, JSON on oletus
    rows, pages = [], 0
    while url and pages < 80:
        j = json.loads(get(url))
        rows += j.get("value", [])
        nxt = j.get("odata.nextLink")
        url = None
        if nxt:
            url = nxt if nxt.startswith("http") else SYKE + "/" + nxt.lstrip("/")
        pages += 1
    return rows


def parse_time(s):
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(s))
    return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))) if m else None


SUURE = {}


def syke_suureet():
    for r in syke_json("Suure", {}):
        SUURE[r["Suure_Id"]] = (r.get("Nimi") or "", r.get("Yksikko") or "")


def syke_stations(area):
    s, w, n, e = area["bbox_latlon"]
    corners = [to_tm35(s, w), to_tm35(s, e), to_tm35(n, w), to_tm35(n, e)]
    nmin, nmax = min(c[0] for c in corners), max(c[0] for c in corners)
    emin, emax = min(c[1] for c in corners), max(c[1] for c in corners)
    flt = "KoordErTmPohj ge %d and KoordErTmPohj le %d and KoordErTmIta ge %d and KoordErTmIta le %d" % (nmin, nmax, emin, emax)
    return syke_json("Paikka", {"$filter": flt})


def syke_series(entity, pid, since):
    rows = syke_json(entity, {"$filter": "Paikka_Id eq %d and Aika ge datetime'%s'" % (pid, since.isoformat()),
                              "$orderby": "Aika"})
    out = []
    for r in rows:
        d, v = parse_time(r.get("Aika")), r.get("Arvo")
        if d is not None and v is not None:
            out.append((d, float(v)))
    return out


def syke_status(river, gj, stations, today):
    pts = river_points(gj, river["id"])
    if not pts:
        return None
    tm = [to_tm35(p[1], p[0]) for p in pts]
    cands = []
    for st in stations:
        try:
            sn, se = float(st["KoordErTmPohj"]), float(st["KoordErTmIta"])
        except (TypeError, ValueError, KeyError):
            continue
        d = min(math.hypot(sn - n, se - e) for (n, e) in tm) / 1000.0
        lat = lon = None
        name = SUURE.get(st.get("Suure_Id"), ("", ""))[0].lower()
        if d > NEAR_KM or not ("virtaama" in name or "vedenkorkeus" in name):
            continue
        rank = (0 if "virtaama" in name else (1 if not st.get("JarviNimi") else 2), d)
        cands.append((rank, st, "Virtaama" if "virtaama" in name else "Vedenkorkeus", lat, lon, d))
    cands.sort(key=lambda c: c[0])
    note("%s: asemaehdokkaat %s" % (river["id"], ", ".join("%s/%s %.1f km" % (c[1]["Nimi"], c[2], c[5]) for c in cands[:6]) or "ei yhtään"))
    for rank, st, entity, lat, lon, d in cands[:6]:
        try:
            series = syke_series(entity, st["Paikka_Id"], dt.date(today.year - 31, 1, 1))
        except Exception as e:  # noqa
            note("Syke %s %s: %r" % (st["Nimi"], entity, e))
            continue
        if not series:
            note("Syke %s/%s: ei dataa" % (st["Nimi"], entity))
            continue
        last_d, last_v = series[-1]
        if (today - last_d).days > MAX_AGE_D:
            note("Syke %s: viimeisin arvo %s, liian vanha" % (st["Nimi"], last_d))
            continue
        ref = [v for (d0, v) in series if d0.year < today.year and doy_diff(d0, last_d) <= WINDOW_D]
        years = len({d0.year for (d0, v) in series if d0.year < today.year and doy_diff(d0, last_d) <= WINDOW_D})
        if years < MIN_YEARS:
            note("Syke %s: vain %d vertailuvuotta" % (st["Nimi"], years))
            continue
        p25, p75 = pct(ref, 0.25), pct(ref, 0.75)
        unit = SUURE.get(st.get("Suure_Id"), ("", ""))[1] or ("m³/s" if entity == "Virtaama" else "cm")
        return {"suure": entity.lower(), "asema": st["Nimi"], "paikka_id": st["Paikka_Id"], "etaisyys_km": round(d, 1),
                "arvo": last_v, "aika": last_d.isoformat(), "yksikko": unit.replace("m3/s", "m³/s"),
                "p25": round(p25, 3), "p75": round(p75, 3), "vuodet": years, "luokka": classify(last_v, p25, p75)}
    return None


# --- Ilmatieteen laitos: 14 vrk sademäärä ------------------------------------------

def fmi_daily_rain(params):
    q = dict({"service": "WFS", "version": "2.0.0", "request": "getFeature",
              "storedquery_id": "fmi::observations::weather::daily::timevaluepair", "parameters": "rrday"}, **params)
    x = get(FMI + "?" + urllib.parse.urlencode(q))
    return parse_fmi_tvp(x)


def parse_fmi_tvp(x):
    """FMI:n timevaluepair-XML -> {fmisid: {nimi, pos, arvot}}. ElementTree tukee {*}-jokerimerkkiä vain iterfindissä."""
    root = ET.fromstring(x)
    out = {}
    for obs in root.iterfind(".//{*}PointTimeSeriesObservation"):
        name, fmisid, pos = None, None, None
        for loc in obs.iterfind(".//{*}Location"):
            for idn in loc.iterfind("{*}identifier"):
                fmisid = (idn.text or "").strip()
            for nm in loc.iterfind("{*}name"):
                if (nm.get("codeSpace") or "").endswith("/name"):
                    name = (nm.text or "").strip()
        for p in obs.iterfind(".//{*}pos"):
            pos = [float(v) for v in p.text.split()[:2]]
            break
        vals = []
        for tvp in obs.iterfind(".//{*}MeasurementTVP"):
            v = tvp.find("{*}value")
            try:
                f = float(v.text)
            except (TypeError, ValueError, AttributeError):
                continue
            if f != f:  # NaN
                continue
            vals.append(max(f, 0.0))  # -1 = ei sadetta
        if fmisid:
            out[fmisid] = {"nimi": name or fmisid, "pos": pos, "arvot": vals}
    return out


def rain_status(river, gj, today):
    pts = river_points(gj, river["id"])
    if not pts:
        return None
    lat = sum(p[1] for p in pts) / len(pts)
    lon = sum(p[0] for p in pts) / len(pts)
    end = today - dt.timedelta(days=1)
    start = end - dt.timedelta(days=RAIN_DAYS - 1)
    bbox = "%.3f,%.3f,%.3f,%.3f" % (lon - 1.2, lat - 0.5, lon + 1.2, lat + 0.5)
    now = fmi_daily_rain({"bbox": bbox, "starttime": start.isoformat() + "T00:00:00Z", "endtime": end.isoformat() + "T00:00:00Z"})
    best = None
    for fid, st in now.items():
        if len(st["arvot"]) < RAIN_DAYS - 1 or not st["pos"]:
            continue
        d = dist_km(lat, lon, st["pos"][0], st["pos"][1])
        if best is None or d < best[0]:
            best = (d, fid, st)
    if not best:
        note("%s: ei sääasemaa, jolla 14 vrk sadetiedot (%d asemaa haussa)" % (river["id"], len(now)))
        return None
    d, fid, st = best
    total = round(sum(st["arvot"]), 1)
    note("%s: sadeasema %s (%.0f km), 14 vrk %.1f mm" % (river["id"], st["nimi"], d, total))
    sums = []
    for k in range(1, RAIN_YEARS + 1):
        try:
            s0, e0 = start.replace(year=start.year - k), end.replace(year=end.year - k)
        except ValueError:  # 29.2.
            continue
        try:
            r = fmi_daily_rain({"fmisid": fid, "starttime": s0.isoformat() + "T00:00:00Z", "endtime": e0.isoformat() + "T00:00:00Z"})
        except Exception as e:  # noqa
            note("FMI %s %d: %r" % (st["nimi"], s0.year, e))
            continue
        vals = (r.get(fid) or {}).get("arvot") or []
        if len(vals) >= RAIN_DAYS - 1:
            sums.append(sum(vals))
        time.sleep(0.3)
    if len(sums) < MIN_YEARS:
        return {"mm": total, "asema": st["nimi"], "etaisyys_km": round(d, 1), "p25": None, "p75": None, "vuodet": len(sums), "luokka": None}
    p25, p75 = pct(sums, 0.25), pct(sums, 0.75)
    return {"mm": total, "asema": st["nimi"], "etaisyys_km": round(d, 1), "p25": round(p25, 1), "p75": round(p75, 1),
            "vuodet": len(sums), "jakso": [start.isoformat(), end.isoformat()], "luokka": classify(total, p25, p75)}



# --- Piirretyt kalastusalueet (areas/kalastus) -------------------------------------

def slugify(name):
    s = name.lower().replace("ä", "a").replace("ö", "o").replace("å", "a")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60] or "alue"


def outer_rings(gj):
    """GeoJSON -> ulkorenkaat [(lon, lat), ...]. Polygonit, joilla on ominaisuus poista=true, ohitetaan."""
    rings = []
    feats = gj.get("features", []) if gj.get("type") == "FeatureCollection" else [gj]
    for f in feats:
        g = f.get("geometry") or {}
        if (f.get("properties") or {}).get("poista") in (True, "true"):
            continue
        if g.get("type") == "Polygon":
            rings.append(g["coordinates"][0])
        elif g.get("type") == "MultiPolygon":
            rings += [p[0] for p in g["coordinates"]]
    out = []
    for r in rings:
        pts = [(float(c[0]), float(c[1])) for c in r if len(c) >= 2 and -180 <= float(c[0]) <= 180 and -90 <= float(c[1]) <= 90]
        if len(pts) >= 4:
            out.append(pts)
    return out


def read_drawn():
    """areas/kalastus/*.geojson -> [{id, nimi, rings, bbox_latlon, hash}]."""
    import hashlib
    out = []
    if not os.path.isdir(DRAWN):
        return out
    for fn in sorted(os.listdir(DRAWN)):
        if not fn.endswith((".geojson", ".json")) or fn.startswith(("_", ".")):
            continue
        raw = open(os.path.join(DRAWN, fn), "rb").read()
        try:
            gj = json.loads(raw)
            rings = outer_rings(gj)
        except Exception as e:  # noqa
            note("%s: virheellinen GeoJSON (%r)" % (fn, e))
            continue
        if not rings:
            note("%s: ei aluetta (polygonia)" % fn)
            continue
        props = (gj.get("features") or [{}])[0].get("properties") or {} if gj.get("type") == "FeatureCollection" else gj.get("properties") or {}
        stem = os.path.splitext(fn)[0]
        name = str(props.get("nimi") or props.get("name") or stem.replace("-", " ").capitalize())[:60]
        lons = [p[0] for r in rings for p in r]
        lats = [p[1] for r in rings for p in r]
        out.append({"id": slugify(stem), "nimi": name, "rings": rings, "piirretty": True,
                    "bbox_latlon": [min(lats), min(lons), max(lats), max(lons)],
                    "hash": hashlib.sha1(raw).hexdigest()[:12]})
    return out


def simplify_ring(ring, tol):
    """Suljettu rengas: Douglas-Peucker kahtena puolikkaana, koska alku- ja loppupiste ovat samat."""
    if len(ring) < 5:
        return ring
    far = max(range(len(ring)), key=lambda i: (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2)
    return simplify(ring[:far + 1], tol)[:-1] + simplify(ring[far:], tol)


def poly_filter(ring, max_pts=120):
    """Overpassin poly-suodatin: "lat lon lat lon ..." (rengas yksinkertaistettuna)."""
    pts = ring
    tol = 0.0002
    while len(pts) > max_pts:
        pts = simplify_ring(ring, tol)
        tol *= 2
    return " ".join("%.5f %.5f" % (p[1], p[0]) for p in pts)


def fetch_drawn_rivers(area):
    """Nimetyt joet ja purot piirretyn alueen sisällä. Palauttaa (GeoJSON, joet)."""
    parts = []
    for r in area["rings"]:
        pf = poly_filter(r)
        parts.append('way["waterway"="river"]["name"](poly:"%s");way["waterway"="stream"]["name"](poly:"%s");' % (pf, pf))
    q = "[out:json][timeout:120];(" + "".join(parts) + ");out geom tags;"
    j = json.loads(get(OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(), timeout=180))
    lengths, ways = {}, {}
    for el in j.get("elements", []):
        name = (el.get("tags", {}).get("name") or "").strip()
        geom = el.get("geometry") or []
        if not name or len(geom) < 2:
            continue
        pts = [(round(p["lon"], 5), round(p["lat"], 5)) for p in geom]
        length = sum(dist_km(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]) for i in range(1, len(pts)))
        lengths[name] = lengths.get(name, 0) + length
        ways.setdefault(name, []).append(pts)
    names = sorted(lengths, key=lambda n: -lengths[n])[:MAX_RIVERS]
    joet, feats = [], []
    for name in names:
        jid = (area["id"] + "-" + slugify(name))[:80]
        joet.append({"id": jid, "nimi": name, "osm": name})
        for pts in ways[name]:
            feats.append({"type": "Feature", "properties": {"nimi": name, "tyyppi": "joki", "joki_id": jid},
                          "geometry": {"type": "LineString", "coordinates": [list(p) for p in simplify(pts, 0.00004)]}})
    gj = {"type": "FeatureCollection", "features": feats,
          "properties": {"lahde": "© OpenStreetMapin tekijät, ODbL", "alue_hash": area["hash"], "joet": joet}}
    return gj, joet


def area_layer(area):
    """Piirretyn alueen raja kalastustasoksi."""
    feats = [{"type": "Feature", "properties": {"nimi": area["nimi"], "tyyppi": "alue"},
              "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in r]]}} for r in area["rings"]]
    return {"type": "FeatureCollection", "features": feats, "properties": {"alue_hash": area["hash"]}}


def update_index(drawn):
    """docs/layers/index.json: käsin lisätyt tasot säilyvät, piirretyt päivittyvät."""
    path = os.path.join(LAYERS, "index.json")
    try:
        idx = json.load(open(path, encoding="utf-8"))
    except Exception:  # noqa
        idx = {"tasot": []}
    manual = [t for t in idx.get("tasot", []) if not t.get("piirretty")]
    ids = {t["id"] for t in manual}
    for a in drawn:
        if a["id"] in ids:
            continue
        entry = {"id": a["id"], "nimi": a["nimi"], "tiedosto": a["id"] + ".geojson", "piirretty": True}
        dpath = os.path.join(LAYERS, a["id"] + "-syvyys.geojson")
        try:
            dprops = json.load(open(dpath, encoding="utf-8")).get("properties") or {}
            if dprops.get("alue_hash") == a["hash"] and dprops.get("jarvia"):
                entry["syvyys"] = a["id"] + "-syvyys.geojson"
        except Exception:  # noqa
            pass
        manual.append(entry)
    idx["tasot"] = manual
    json.dump(idx, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    # Poistetun alueen tiedostot pois
    keep = {a["id"] for a in drawn}
    old = [t["id"] for t in json.load(open(path, encoding="utf-8")).get("tasot", [])]
    for fn in os.listdir(LAYERS):
        m = re.match(r"^(.+?)(-joet|-syvyys)?\.geojson$", fn)
        if not m:
            continue
        base = m.group(1)
        marker = os.path.join(LAYERS, fn)
        try:
            props = json.load(open(marker, encoding="utf-8")).get("properties") or {}
        except Exception:  # noqa
            continue
        if props.get("alue_hash") and base not in keep and base not in old:
            os.remove(marker)
            note("Poistettu %s (alue poistettu)" % fn)


# --- Jäänpaksuus (Syke) -------------------------------------------------------------

def dms(v):
    """Syken KoordLat/KoordLong muodossa AASSVV (esim. 690302) -> desimaaliasteet."""
    try:
        v = int(v)
    except (TypeError, ValueError):
        return None
    d, rest = divmod(v, 10000)
    m, s = divmod(rest, 100)
    if m >= 60 or s >= 60:
        return None
    return round(d + m / 60 + s / 3600, 5)


def ice_status(today):
    since = today - dt.timedelta(days=ICE_DAYS)
    rows = syke_json("Jaanpaksuus", {"$filter": "Aika ge datetime'%s'" % since.isoformat(), "$orderby": "Aika"})
    latest = {}
    for r in rows:
        d, v = parse_time(r.get("Aika")), r.get("Arvo")
        if d is None or v is None:
            continue
        latest[r["Paikka_Id"]] = (d, float(v))
    asemat = []
    if latest:
        places = {p["Paikka_Id"]: p for p in syke_json("Paikka", {"$filter": "Suure_Id eq 9"})}
        for pid, (d, v) in latest.items():
            p = places.get(pid)
            if not p:
                continue
            lat, lon = dms(p.get("KoordLat")), dms(p.get("KoordLong"))
            if lat is None or lon is None:
                continue
            asemat.append({"nimi": (p.get("Nimi") or "").strip()[:60], "jarvi": (p.get("JarviNimi") or "").strip()[:80],
                           "kunta": (p.get("KuntaNimi") or "").strip()[:40], "lat": lat, "lon": lon, "cm": round(v), "aika": d.isoformat()})
    asemat.sort(key=lambda a: (a["kunta"], a["nimi"]))
    return {"paivitetty": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "jakso_vrk": ICE_DAYS, "lahde": "Syke, Hydrologiarajapinta (CC BY 4.0)", "asemat": asemat}


# --- Pääohjelma --------------------------------------------------------------------

def main():
    cfg = json.load(open(CONFIG, encoding="utf-8"))
    today = dt.datetime.now(dt.timezone.utc).date()
    try:
        syke_suureet()
    except Exception as e:  # noqa
        note("Syke: suureita ei saatu: %r" % e)
    result = {"paivitetty": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
              "joet": [], "geometriat": [], "lahteet": [
                  "Syke, Hydrologiarajapinta (CC BY 4.0)", "Ilmatieteen laitos, avoin data (CC BY 4.0)",
                  "Uomat © OpenStreetMapin tekijät (ODbL)"]}
    drawn = read_drawn()
    os.makedirs(LAYERS, exist_ok=True)
    for a in drawn:
        path = os.path.join(LAYERS, a["id"] + ".geojson")
        try:
            old = json.load(open(path, encoding="utf-8")).get("properties", {}).get("alue_hash")
        except Exception:  # noqa
            old = None
        if old != a["hash"]:
            json.dump(area_layer(a), open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
            note("%s: aluetaso kirjoitettu" % a["id"])
    update_index(drawn)
    areas = list(cfg["alueet"]) + drawn
    for area in areas:
        path = os.path.join(LAYERS, area["id"] + "-joet.geojson")
        rel = "layers/" + area["id"] + "-joet.geojson"
        gj = None
        if os.path.exists(path):
            gj = json.load(open(path, encoding="utf-8"))
            if area.get("piirretty") and (gj.get("properties") or {}).get("alue_hash") != area["hash"]:
                gj = None  # alue muuttunut: haetaan joet uudelleen
        if gj is None:
            try:
                if area.get("piirretty"):
                    gj, _ = fetch_drawn_rivers(area)
                    time.sleep(5)
                else:
                    gj = fetch_rivers(area)
                json.dump(gj, open(path, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
                note("%s: %d uomaa haettu" % (area["id"], len(gj["features"])))
            except Exception as e:  # noqa
                note("%s: uomia ei saatu: %r" % (area["id"], e))
                continue
        if area.get("piirretty"):
            area = dict(area, joet=(gj.get("properties") or {}).get("joet") or [])
        if not gj.get("features"):
            note("%s: alueella ei ole nimettyjä jokia" % area["id"])
            continue
        result["geometriat"].append(rel)
        try:
            stations = syke_stations(area)
            note("%s: %d Syken asemaa rajauksella" % (area["id"], len(stations)))
        except Exception as e:  # noqa
            stations = []
            note("%s: Syken asemia ei saatu: %r" % (area["id"], e))
        for river in area["joet"]:
            entry = {"id": river["id"], "nimi": river["nimi"], "alue": area["id"], "luokka": None, "menetelma": None}
            try:
                m = syke_status(river, gj, stations, today)
            except Exception as e:  # noqa
                m = None
                note("%s: mittaus epäonnistui: %r" % (river["id"], e))
            try:
                r = rain_status(river, gj, today)
            except Exception as e:  # noqa
                r = None
                note("%s: sade epäonnistui: %r" % (river["id"], e))
            if m:
                entry["mittaus"] = m
            if r:
                entry["sade14"] = r
            if m and m.get("luokka"):
                entry["luokka"], entry["menetelma"] = m["luokka"], "mittaus"
            elif r and r.get("luokka"):
                entry["luokka"], entry["menetelma"] = r["luokka"], "sade"
            note("%s: %s (%s)" % (river["id"], entry["luokka"], entry["menetelma"]))
            result["joet"].append(entry)
    try:
        ice = ice_status(today)
        json.dump(ice, open(ICE_OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        note("Jäänpaksuus: %d asemaa, joilla mittaus %d vrk sisällä" % (len(ice["asemat"]), ICE_DAYS))
    except Exception as e:  # noqa
        note("Jäänpaksuutta ei saatu: %r" % e)
    result["loki"] = log[-60:]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(result, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())

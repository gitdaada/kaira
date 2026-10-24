#!/usr/bin/env python3
"""
Kansallispuistot, luonnonpuistot ja valtion retkeilyalueet eränkäyntiosion listaan.

Lähteet:
  - Nimet, tyypit ja rajat: Syke, valtion luonnonsuojelualueet (CC BY 4.0). Jos Syken palvelu ei vastaa,
    OpenStreetMap (ODbL). Valtion retkeilyalueet (pipeline/data/puistot_lisat.json) OpenStreetMapista.
  - Perustamisvuosi, kunnat, linkki Metsähallituksen sivulle (luontoon.fi) ja kuva: Wikidata (CC0).
  - Kuvat: Wikimedia Commons, vain vapaat lisenssit (CC0, public domain, CC BY, CC BY-SA); tekijä ja lisenssi
    tallennetaan kuvan yhteyteen.

Tulos: docs/data/puistot.json (luettelo), docs/data/puistot/<id>.geojson (yksinkertaistettu raja, ladataan vain
pyydettäessä) ja docs/img/puistot/<id>.jpg (kuva enintään 720 px). Ei avaimia eikä salaisuuksia.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import html
import io
import json
import os
import re
import sys
import time
import zipfile
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT_JSON = ROOT / "docs" / "data" / "puistot.json"
OUT_GEO = ROOT / "docs" / "data" / "puistot"
OUT_IMG = ROOT / "docs" / "img" / "puistot"
CACHE = ROOT / ".cache" / "puistot"
EXTRA = ROOT / "pipeline" / "data" / "puistot_lisat.json"
CONFIG = ROOT / "pipeline" / "config.json"

UA = "kaira/0.1 (+https://github.com/gitdaada/kaira)"
OVERPASS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")
WD_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
TYPES = ("kansallispuisto", "luonnonpuisto", "retkeilyalue")
NAME_COLS = ["Nimi", "NimiSuomi", "LsAlueNimi", "Nimi_fi", "Name", "NIMI"]
TYPE_COLS = ["TyyppiNimi", "Tyyppi", "LsAlueTyyp", "SuojTyyppi", "TyyppiNim", "Type", "TYYPPI"]
DATE_COLS = ["Voimaantul", "Voimaantulo", "PerustPvm", "PerustamisPvm", "Perustettu", "PaatPvm"]
LICENSE_OK = re.compile(r"^(cc0( 1\.0)?|public domain|pd|copyrighted free use|attribution|no restrictions|cc[ -]by(-sa)?[ -][0-9.]+( [a-z]{2,})?)$", re.I)
LINK_OK = re.compile(r"^https://(www\.)?(luontoon\.fi|nationalparks\.fi|metsa\.fi)(/|$)", re.I)
IMG_W, IMG_H = 720, 540
KM2, HA = "http://www.wikidata.org/entity/Q712226", "http://www.wikidata.org/entity/Q35852"
FINLAND = "Q33"

S = requests.Session()
S.headers.update({"User-Agent": UA})
notes: list[str] = []


def gh(level, msg):
    print("::%s::%s" % (level, str(msg).replace("\n", " ")[:950]), flush=True)


def note(msg):
    notes.append(msg)
    print(msg, flush=True)


def get(url, params=None, data=None, timeout=90, tries=3, raw=False):
    last = None
    for i in range(tries):
        try:
            r = S.post(url, data=data, timeout=timeout) if data is not None else S.get(url, params=params, timeout=timeout)
            if r.status_code == 429 or r.status_code >= 500:
                last = RuntimeError("HTTP %s" % r.status_code)
                time.sleep(min(60, int(r.headers.get("Retry-After", "0") or 0) or 5 * (i + 1)))
                continue
            r.raise_for_status()
            return r.content if raw else r.json()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise last


# --- Apufunktiot (testataan erikseen) ------------------------------------------------------

def slugify(name: str) -> str:
    s = name.lower().replace("ä", "a").replace("ö", "o").replace("å", "a")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:60] or "kohde"


def clean(v) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    return "" if s.lower() in ("none", "nan", "nat") else s


def pick_col(columns, candidates):
    low = {c.lower(): c for c in columns}
    for cand in candidates:
        if cand.lower() in low:
            return low[cand.lower()]
    return None


def base_name(name: str) -> str:
    """Nimen tarkenne suluissa pois: saman puiston osat (esim. eri haltija) yhdistyvät."""
    return re.sub(r"\s*\([^)]*\)\s*$", "", (name or "").strip())


def kind_of(type_value: str, name: str):
    """Syken tyyppi tai nimen loppu -> kansallispuisto | luonnonpuisto | None."""
    t, n = (type_value or "").lower(), (name or "").lower()
    for k in ("kansallispuisto", "luonnonpuisto"):
        if k in t or n.endswith(k):
            return k
    return None


def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def license_ok(name: str) -> bool:
    return bool(LICENSE_OK.match((name or "").strip()))


def link_ok(url: str):
    """Vain Metsähallituksen sivut, https:llä."""
    u = (url or "").strip()
    if u.startswith("http://"):
        u = "https://" + u[7:]
    return u if LINK_OK.match(u) and len(u) < 300 and not re.search(r"[\s\"'<>]", u) else None


def wd_year(claims, prop="P571"):
    for c in claims.get(prop, []):
        v = (((c.get("mainsnak") or {}).get("datavalue") or {}).get("value") or {})
        m = re.match(r"^\+?(\d{4})-", str(v.get("time", "")))
        if m:
            return int(m.group(1))
    return None


def wd_values(claims, prop):
    out = []
    for c in claims.get(prop, []):
        if c.get("rank") == "deprecated":
            continue
        v = ((c.get("mainsnak") or {}).get("datavalue") or {}).get("value")
        if v is not None:
            out.append(v)
    return out


def wd_area_ha(claims):
    for v in wd_values(claims, "P2046"):
        try:
            amount = float(v.get("amount"))
        except (TypeError, ValueError):
            continue
        if v.get("unit") == KM2:
            return amount * 100
        if v.get("unit") == HA:
            return amount
    return None


def choose_entity(name, candidates):
    """wbsearchentities-tuloksista nimeä vastaava kohde: sama nimi ensin, sitten kuvaus, jossa tyyppi."""
    nm = name.casefold()
    exact = [c for c in candidates if (c.get("label") or "").casefold() == nm]
    if exact:
        return exact[0]["id"]
    kind = next((k for k in TYPES if nm.endswith(k)), "")
    for c in candidates:
        d = (c.get("description") or "").casefold()
        if kind and kind in d:
            return c["id"]
    return None


def rings_from_osm(el):
    """Overpassin elementti (out geom) -> lista ulkorenkaita [(lon, lat), ...]."""
    from shapely.geometry import LineString
    from shapely.ops import linemerge, polygonize
    if el.get("type") == "way":
        g = [(p["lon"], p["lat"]) for p in el.get("geometry") or []]
        return [g] if len(g) >= 4 and g[0] == g[-1] else []
    lines = []
    for m in el.get("members") or []:
        if m.get("type") == "way" and m.get("role") in ("outer", "") and m.get("geometry"):
            pts = [(p["lon"], p["lat"]) for p in m["geometry"]]
            if len(pts) >= 2:
                lines.append(LineString(pts))
    if not lines:
        return []
    return [list(p.exterior.coords) for p in polygonize(linemerge(lines))]


# --- Rajat -------------------------------------------------------------------------------------

def to_3067():
    from pyproj import Transformer
    return Transformer.from_crs("EPSG:4326", "EPSG:3067", always_xy=True), Transformer.from_crs("EPSG:3067", "EPSG:4326", always_xy=True)


def syke_parks():
    """Syken valtion luonnonsuojelualueista kansallis- ja luonnonpuistot: [(tyyppi, nimi, geometria EPSG:3067, perustettu)]."""
    import geopandas as gpd
    from shapely.ops import unary_union
    url = json.loads(CONFIG.read_text(encoding="utf-8"))["protected"]["sources"][0]["url"]
    CACHE.mkdir(parents=True, exist_ok=True)
    z = CACHE / "valtio.zip"
    if not z.exists() or time.time() - z.stat().st_mtime > 25 * 86400:
        data = get(url, timeout=300, raw=True)
        z.write_bytes(data)
    xdir = CACHE / "valtio"
    if not xdir.exists() or xdir.stat().st_mtime < z.stat().st_mtime:
        with zipfile.ZipFile(z) as zf:
            zf.extractall(xdir)
    groups, shown = {}, False
    for shp in sorted(xdir.rglob("*.shp")):
        gdf = gpd.read_file(shp)
        if gdf.empty:
            continue
        gdf = (gdf.set_crs(3067) if gdf.crs is None else gdf).to_crs(3067)
        ncol, tcol, dcol = pick_col(gdf.columns, NAME_COLS), pick_col(gdf.columns, TYPE_COLS), pick_col(gdf.columns, DATE_COLS)
        if not shown:
            types = sorted({clean(v) for v in gdf[tcol]})[:40] if tcol else []
            gh("notice", "Syke %s: sarakkeet %s; nimi %s, tyyppi %s, pvm %s; tyypit %s" % (shp.name, list(gdf.columns)[:30], ncol, tcol, dcol, types))
            shown = True
        if not ncol:
            continue
        for _, r in gdf.iterrows():
            name = base_name(clean(r[ncol]))
            kind = kind_of(clean(r[tcol]) if tcol else "", name)
            if not kind or not name or r.geometry is None or r.geometry.is_empty:
                continue
            g = groups.setdefault((kind, name), {"geoms": [], "year": None})
            g["geoms"].append(r.geometry.buffer(0))
            if dcol:
                m = re.search(r"(18|19|20)\d{2}", clean(r[dcol]))
                if m:  # vanhin päätös: puiston perustaminen (laajennukset myöhemmin)
                    g["year"] = min(int(m.group(0)), g["year"] or 9999)
    return [(k, n, unary_union(g["geoms"]), g["year"]) for (k, n), g in groups.items()]


def osm_query(q):
    last = None
    for ep in OVERPASS:
        try:
            j = get(ep, data={"data": q}, timeout=200, tries=2)
            if j.get("remark") and not j.get("elements"):
                raise RuntimeError("Overpass: " + str(j["remark"])[:200])
            return j.get("elements", [])
        except Exception as e:  # noqa: BLE001
            last = e
            note("Overpass %s: %r" % (ep.split("/")[2], e))
    raise last


def osm_areas(names=None, kinds=None):
    """OpenStreetMapin alueet nimen mukaan: {nimi: (geometria EPSG:3067, wikidata, verkkosivu)}."""
    from shapely.geometry import Polygon
    from shapely.ops import transform, unary_union
    if names:
        rx = "^(" + "|".join(n.replace('"', "") for n in names) + ")$"
    else:
        rx = "(%s)$" % "|".join(kinds)
    q = ('[out:json][timeout:180];area["ISO3166-1"="FI"][admin_level=2]->.fi;'
         '(relation["name"~"%s"](area.fi);way["name"~"%s"](area.fi););out geom tags;' % (rx, rx))
    fwd, _ = to_3067()
    best = {}
    for el in osm_query(q):
        t = el.get("tags") or {}
        name = t.get("name:fi") or t.get("name")
        if not name or any(k in t for k in ("highway", "building", "amenity", "railway", "tourism")):
            continue
        polys = [Polygon(r) for r in rings_from_osm(el) if len(r) >= 4]
        if not polys:
            continue
        g = transform(fwd.transform, unary_union([p.buffer(0) for p in polys]))
        if g.area < 10000:
            continue
        if name not in best or g.area > best[name][0].area:
            best[name] = (g, t.get("wikidata"), t.get("website") or t.get("url"))
    return best


def osm_hiking(names):
    """Valtion retkeilyalueet OpenStreetMapista: ensin nimet (kevyt haku), sitten valittujen rajat.
    Palauttaa {haluttu nimi: (geometria EPSG:3067, wikidata, verkkosivu)}."""
    from shapely.geometry import Polygon
    from shapely.ops import transform, unary_union
    base = '[out:json][timeout:120];area["ISO3166-1"="FI"][admin_level=2]->.fi;'
    els = osm_query(base + '(relation["name"~"retkeily",i](area.fi);way["name"~"retkeily",i](area.fi););out tags;')
    cands = [(e["type"], e["id"], (e.get("tags") or {})) for e in els if e.get("type") in ("relation", "way")]
    gh("notice", "OSM retkeily-nimet: %s" % sorted({(t.get("name:fi") or t.get("name") or "") + " [" + ",".join("%s=%s" % (k, t[k]) for k in ("boundary", "leisure", "protect_class", "tourism", "landuse") if k in t) + "]"
                                                    for _, _, t in cands})[:40])
    pick = {}
    for want in names:
        stem = want.split()[0][:5].casefold()
        best = None
        for typ, oid, t in cands:
            nm = (t.get("name:fi") or t.get("name") or "")
            if nm.casefold() == want.casefold() or (nm.casefold().startswith(stem) and "retkeily" in nm.casefold()):
                score = (nm.casefold() == want.casefold(), typ == "relation", "boundary" in t or "leisure" in t)
                if best is None or score > best[0]:
                    best = (score, typ, oid, t)
        if best:
            pick[want] = best[1:]
    if not pick:
        return {}
    ids = "".join("%s(%d);" % (typ, oid) for typ, oid, _ in pick.values())
    geo = {(e["type"], e["id"]): e for e in osm_query(base.replace('area["ISO3166-1"="FI"][admin_level=2]->.fi;', "") + "(" + ids + ");out geom;")}
    fwd, _ = to_3067()
    out = {}
    for want, (typ, oid, t) in pick.items():
        el = geo.get((typ, oid))
        polys = [Polygon(r) for r in rings_from_osm(el or {}) if len(r) >= 4]
        if not polys:
            note("%s: OpenStreetMapin kohteella %s/%d ei ole aluetta" % (want, typ, oid))
            continue
        g = transform(fwd.transform, unary_union([p.buffer(0) for p in polys]))
        out[want] = (g, t.get("wikidata"), t.get("website") or t.get("url"))
    return out


def boundary_feature(name, kind, g3067):
    """Yksinkertaistettu raja WGS84:ssä ja sen tiedot."""
    from shapely.geometry import mapping
    from shapely.ops import transform
    _, back = to_3067()
    ha = g3067.area / 1e4
    tol = 20 if ha < 5000 else 40 if ha < 50000 else 80
    simple = g3067.simplify(tol, preserve_topology=True)
    pt = transform(back.transform, g3067.representative_point())
    g = transform(back.transform, simple)
    s, w, n, e = g.bounds[1], g.bounds[0], g.bounds[3], g.bounds[2]

    def rnd(o):
        if isinstance(o, (list, tuple)):
            if o and isinstance(o[0], (int, float)):
                return [round(o[0], 5), round(o[1], 5)]
            return [rnd(x) for x in o]
        return o
    geom = mapping(g)
    geom = {"type": geom["type"], "coordinates": rnd(geom["coordinates"])}
    fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"nimi": name, "tyyppi": "alue"}, "geometry": geom}]}
    return fc, {"ha": round(ha), "lat": round(pt.y, 5), "lon": round(pt.x, 5), "bbox": [round(s, 5), round(w, 5), round(n, 5), round(e, 5)]}


# --- Wikidata ja Commons -----------------------------------------------------------------------

def wd_search(name):
    j = get(WD_API, params={"action": "wbsearchentities", "search": name, "language": "fi", "uselang": "fi", "type": "item", "limit": 7, "format": "json"})
    return j.get("search", [])


def wd_entities(ids, props="claims|labels|sitelinks"):
    out = {}
    ids = [i for i in ids if re.match(r"^Q\d+$", i or "")]
    for k in range(0, len(ids), 50):
        j = get(WD_API, params={"action": "wbgetentities", "ids": "|".join(ids[k:k + 50]), "props": props, "languages": "fi|en", "format": "json"})
        out.update(j.get("entities", {}))
        time.sleep(1)
    return out


def commons_image(filename):
    j = get(COMMONS_API, params={"action": "query", "titles": "File:" + filename, "prop": "imageinfo", "iiprop": "url|extmetadata|mime",
                                 "iiurlwidth": IMG_W, "format": "json"})
    pages = list(((j.get("query") or {}).get("pages") or {}).values())
    if not pages or not pages[0].get("imageinfo"):
        return None
    ii = pages[0]["imageinfo"][0]
    md = ii.get("extmetadata") or {}
    lic = strip_html((md.get("LicenseShortName") or {}).get("value", ""))
    if not license_ok(lic) or not re.match(r"^image/(jpeg|png|webp)$", ii.get("mime", "")):
        return {"hylatty": lic or ii.get("mime", "")}
    artist = strip_html((md.get("Artist") or {}).get("value", "")) or "Tuntematon"
    page = ii.get("descriptionurl") or ""
    return {"url": ii.get("thumburl") or ii.get("url"), "page": page if page.startswith("https://commons.wikimedia.org/") else "",
            "tekija": artist[:80], "lisenssi": lic[:40]}


def save_image(pid, info):
    from PIL import Image
    data = get(info["url"], timeout=120, raw=True)
    im = Image.open(io.BytesIO(data))
    im = im.convert("RGB")
    im.thumbnail((IMG_W, IMG_H))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=80, optimize=True, progressive=True)
    path = OUT_IMG / (pid + ".jpg")
    path.write_bytes(buf.getvalue())
    return path


def page_ok(url, name):
    """Sivu vastaa ja on Metsähallituksen sivu, jolla kohteen nimi mainitaan. Palauttaa lopullisen osoitteen."""
    try:
        r = S.get(url, timeout=30, allow_redirects=True)
    except Exception:  # noqa: BLE001
        return None
    final = link_ok(r.url)
    stem = name.split()[0][:5].casefold()
    if r.status_code == 200 and final and stem in r.text.casefold():
        return final
    return None


def find_link(name, pid, candidates):
    """Wikidatan tai OSM:n linkit varmistettuina; muuten luontoon.fi:n kohdesivu nimen perusteella."""
    for u in candidates:
        ok = page_ok(u, name)
        if ok:
            return ok
    short = slugify(name.split()[0])
    guesses = ["https://www.luontoon.fi/fi/kohteet/" + pid, "https://www.luontoon.fi/" + short, "https://www.luontoon.fi/fi/kohteet/" + short]
    for u in guesses:
        ok = page_ok(u, name)
        time.sleep(0.5)
        if ok:
            return ok
    return candidates[0] if candidates else None


def short_hash(b):
    return hashlib.sha1(b).hexdigest()[:10]


# --- Pääohjelma --------------------------------------------------------------------------------

def main():
    extra = json.loads(EXTRA.read_text(encoding="utf-8"))
    skip = set(extra.get("ohita", []))
    prev = {}
    if OUT_JSON.exists():
        try:
            prev = {k["id"]: k for k in json.loads(OUT_JSON.read_text(encoding="utf-8")).get("kohteet", [])}
        except Exception:  # noqa: BLE001
            prev = {}
    lahteet = []
    items = []  # {kind, name, g3067, year, wikidata, website}
    try:
        for kind, name, g, year in syke_parks():
            items.append({"kind": kind, "name": name, "g": g, "year": year, "wd": None, "web": None})
        lahteet.append("Kansallis- ja luonnonpuistojen rajat: Syke, valtion luonnonsuojelualueet (CC BY 4.0)")
    except Exception as e:  # noqa: BLE001
        gh("warning", "Syken suojelualueita ei saatu (%r), rajat OpenStreetMapista" % e)
        for name, (g, wd, web) in osm_areas(kinds=["kansallispuisto", "luonnonpuisto"]).items():
            kind = kind_of("", name)
            if kind:
                items.append({"kind": kind, "name": name, "g": g, "year": None, "wd": wd, "web": web})
        lahteet.append("Kansallis- ja luonnonpuistojen rajat: © OpenStreetMapin tekijät (ODbL)")
    hiking = extra.get("retkeilyalueet", [])
    found = {}
    try:
        found = osm_hiking(hiking)
    except Exception as e:  # noqa: BLE001
        gh("warning", "Retkeilyalueiden rajoja ei saatu: %r" % e)
    for name in hiking:
        g, wd, web = found.get(name, (None, None, None))
        items.append({"kind": "retkeilyalue", "name": name, "g": g, "year": None, "wd": wd, "web": web})
    if found:
        lahteet.append("Retkeilyalueiden rajat: © OpenStreetMapin tekijät (ODbL)")
    items = [it for it in items if slugify(it["name"]) not in skip]

    # Wikidata: tunnus nimen perusteella, ellei OpenStreetMap tai lisätiedosto kerro sitä
    for it in items:
        pid = slugify(it["name"])
        it["id"] = pid
        if extra.get("wikidata", {}).get(pid):
            it["wd"] = extra["wikidata"][pid]
        if not it["wd"]:
            try:
                cands = wd_search(it["name"])
                it["wd"] = choose_entity(it["name"], cands)
                if not it["wd"] and it["kind"] == "retkeilyalue":
                    gh("notice", "Wikidata %s: ehdokkaat %s" % (it["name"], [(c.get("id"), c.get("label"), c.get("description")) for c in cands[:5]]))
            except Exception as e:  # noqa: BLE001
                note("%s: Wikidata-haku epäonnistui (%r)" % (pid, e))
            time.sleep(0.5)
    ents = wd_entities([it["wd"] for it in items if it["wd"]])
    admin_ids = set()
    for it in items:
        e = ents.get(it["wd"] or "", {})
        claims = e.get("claims", {}) if e else {}
        if it["wd"] and FINLAND not in [v.get("id") for v in wd_values(claims, "P17") if isinstance(v, dict)]:
            note("%s: Wikidatan %s ei ole Suomessa, ohitetaan" % (it["id"], it["wd"]))
            it["wd"], claims = None, {}
        it["claims"] = claims
        admin_ids.update(v.get("id") for v in wd_values(claims, "P131") if isinstance(v, dict))
    admin = wd_entities(sorted(admin_ids), props="labels")

    OUT_GEO.mkdir(parents=True, exist_ok=True)
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    out, keep_geo, keep_img = [], set(), set()
    for it in sorted(items, key=lambda x: (TYPES.index(x["kind"]), x["name"])):
        pid, claims = it["id"], it["claims"]
        entry = {"id": pid, "nimi": it["name"][:80], "tyyppi": it["kind"], "ha": None, "perustettu": it["year"] or wd_year(claims),
                 "kunnat": [], "lat": None, "lon": None, "bbox": None, "raja": None, "linkki": None, "kuva": None, "wikidata": it["wd"]}
        if it["g"] is not None and not it["g"].is_empty:
            fc, info = boundary_feature(it["name"], it["kind"], it["g"])
            entry.update(info)
            raw = json.dumps(fc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            (OUT_GEO / (pid + ".geojson")).write_bytes(raw)
            keep_geo.add(pid + ".geojson")
            entry["raja"] = "data/puistot/%s.geojson?v=%s" % (pid, short_hash(raw))
        else:
            coord = next((v for v in wd_values(claims, "P625") if isinstance(v, dict)), None)
            if coord:
                entry["lat"], entry["lon"] = round(coord["latitude"], 5), round(coord["longitude"], 5)
            ha = wd_area_ha(claims)
            entry["ha"] = round(ha) if ha else None
            if not coord:
                note("%s: ei rajaa eikä Wikidatan sijaintia (Wikidata %s)" % (pid, it["wd"]))
        for v in wd_values(claims, "P131")[:4]:
            lab = ((admin.get(v.get("id"), {}).get("labels") or {}).get("fi") or {}).get("value") if isinstance(v, dict) else None
            if lab and lab != "Suomi":
                entry["kunnat"].append(lab[:40])
        links = [link_ok(u) for u in wd_values(claims, "P856") if isinstance(u, str)] + [link_ok(it["web"] or "")]
        links = [u for u in links if u]
        links.sort(key=lambda u: 0 if "luontoon.fi" in u else 1)
        entry["linkki"] = link_ok(extra.get("linkit", {}).get(pid, "")) or find_link(it["name"], pid, links)
        # Kuva: sama Commons-tiedosto käytetään uudelleen, jos se on jo tallessa
        fname = next((v for v in wd_values(claims, "P18") if isinstance(v, str)), None)
        old = (prev.get(pid) or {}).get("kuva") or {}
        if fname:
            try:
                if old.get("tiedosto") == fname and (OUT_IMG / (pid + ".jpg")).exists():
                    entry["kuva"] = old
                else:
                    info = commons_image(fname)
                    if info and info.get("url"):
                        path = save_image(pid, info)
                        entry["kuva"] = {"src": "img/puistot/%s.jpg?v=%s" % (pid, short_hash(path.read_bytes())), "tekija": info["tekija"],
                                         "lisenssi": info["lisenssi"], "lahde": info["page"], "tiedosto": fname[:200]}
                    elif info:
                        note("%s: kuvan lisenssi ei kelpaa (%s)" % (pid, info.get("hylatty")))
                    time.sleep(1)
            except Exception as e:  # noqa: BLE001
                note("%s: kuvaa ei saatu (%r)" % (pid, e))
                if old.get("src") and (OUT_IMG / (pid + ".jpg")).exists():
                    entry["kuva"] = old
        if entry["kuva"]:
            keep_img.add(pid + ".jpg")
        if entry["lat"] is None:
            note("%s: ei sijaintia, ohitetaan" % pid)
            continue
        out.append(entry)

    for d, keep in ((OUT_GEO, keep_geo), (OUT_IMG, keep_img)):
        for p in d.iterdir():
            if p.is_file() and p.name not in keep:
                p.unlink()
    lahteet += ["Perustiedot ja linkit: Wikidata (CC0)", "Kuvat: Wikimedia Commons, tekijät ja lisenssit kohteittain"]
    result = {"paivitetty": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "lahteet": lahteet, "kohteet": out}
    old_cmp = None
    if OUT_JSON.exists():
        try:
            o = json.loads(OUT_JSON.read_text(encoding="utf-8"))
            old_cmp = json.dumps({k: v for k, v in o.items() if k != "paivitetty"}, sort_keys=True, ensure_ascii=False)
        except Exception:  # noqa: BLE001
            pass
    if old_cmp != json.dumps({k: v for k, v in result.items() if k != "paivitetty"}, sort_keys=True, ensure_ascii=False):
        OUT_JSON.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    by = {k: sum(1 for e in out if e["tyyppi"] == k) for k in TYPES}
    gh("notice", "Puistot: %s; ilman linkkiä %s; ilman kuvaa %s; ilman Wikidataa %s" % (
        by, [e["id"] for e in out if not e["linkki"]], [e["id"] for e in out if not e["kuva"]], [e["id"] for e in out if not e["wikidata"]]))
    for m in notes[:8]:
        gh("notice", m)
    return 0


if __name__ == "__main__":
    sys.exit(main())

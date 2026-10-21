#!/usr/bin/env python3
"""Kaira / Kalastus: mitattujen järvien syvyysalueet piirretyille kalastusalueille.

Lähde: Syke, syvyysalueet ja syvyyskäyrät (INSPIRE Elevation, WFS, CC BY 4.0). Mukaan tulevat vain järvet,
joilla on Syken syvyysmittaus. Muita järviä ei arvioida eikä mallinneta.

Tulos: docs/layers/<alue>-syvyys.geojson. Haetaan vain, kun tiedosto puuttuu tai alueen raja on muuttunut.
Ajetaan ennen vesitilanne.py:tä, joka lisää tason luetteloon (docs/layers/index.json).
"""
import json
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import vesitilanne as V  # noqa: E402

sys.setrecursionlimit(20000)

WFS = "https://paikkatiedot.ymparisto.fi/geoserver/inspire_el/wfs"
T_ALUE = "inspire_el:EL.Syvyysalue"
T_KAYRA = "inspire_el:EL.ContourLine"
PAGE = 2000
MAX_FEATURES = 20000
MAX_BYTES = 6 * 1024 * 1024


def bbox_tm35(bb):
    s, w, n, e = bb
    corners = [V.to_tm35(s, w), V.to_tm35(s, e), V.to_tm35(n, w), V.to_tm35(n, e)]
    return (min(c[1] for c in corners) - 500, min(c[0] for c in corners) - 500,
            max(c[1] for c in corners) + 500, max(c[0] for c in corners) + 500)


def wfs_features(type_name, bb):
    """Kaikki rajauksen kohteet sivuittain. Rajaus ETRS-TM35FIN:nä (ei akselijärjestysongelmaa), tulos WGS84:nä."""
    minx, miny, maxx, maxy = bbox_tm35(bb)
    out, start = [], 0
    while start < MAX_FEATURES:
        q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": type_name,
             "outputFormat": "application/json", "srsName": "EPSG:4326", "count": PAGE, "startIndex": start,
             "sortBy": "objectid", "bbox": "%d,%d,%d,%d,EPSG:3067" % (minx, miny, maxx, maxy)}
        j = json.loads(V.get(WFS + "?" + urllib.parse.urlencode(q), timeout=180))
        feats = j.get("features") or []
        out += feats
        if len(feats) < PAGE:
            break
        start += PAGE
        time.sleep(1)
    return out


def inside(pt, ring):
    x, y = pt
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            c = not c
        j = i
    return c


def in_area(pt, rings):
    return any(inside(pt, r) for r in rings)


def lines_of(geom):
    """Polygonin tai viivan kaikki koordinaattijonot."""
    t, c = geom.get("type"), geom.get("coordinates") or []
    if t == "LineString":
        return [c]
    if t in ("MultiLineString", "Polygon"):
        return c
    if t == "MultiPolygon":
        return [r for p in c for r in p]
    return []


def bbox_of(geom):
    xs, ys = [], []
    for ln in lines_of(geom):
        for p in ln:
            xs.append(p[0])
            ys.append(p[1])
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def overlaps(a, b):
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def simp(geom, tol):
    def ln(pts, closed):
        pts = [(round(p[0], 5), round(p[1], 5)) for p in pts]
        if closed and len(pts) >= 4:
            # Suljettu rengas: Douglas-Peucker kahtena puolikkaana (alku ja loppu ovat sama piste).
            q = V.simplify_ring(pts, tol)
            return [list(p) for p in q] if len(q) >= 4 else None
        q = V.simplify(pts, tol)
        return [list(p) for p in q] if len(q) >= 2 else None
    t, c = geom["type"], geom["coordinates"]
    if t == "MultiPolygon":
        polys = []
        for poly in c:
            rings = [ln(r, True) for r in poly]
            if rings and rings[0]:
                polys.append([r for r in rings if r])
        return {"type": "MultiPolygon", "coordinates": polys} if polys else None
    if t == "Polygon":
        rings = [r for r in (ln(r, True) for r in c) if r]
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if t == "MultiLineString":
        lines = [x for x in (ln(r, False) for r in c) if x and len(x) >= 2]
        return {"type": "MultiLineString", "coordinates": lines} if lines else None
    if t == "LineString":
        x = ln(c, False)
        return {"type": "LineString", "coordinates": x} if x and len(x) >= 2 else None
    return None


def depth_class(txt):
    """'3-6' -> (3, 6); '20-' -> (20, None)."""
    try:
        a, _, b = str(txt).partition("-")
        return float(a.replace(",", ".")), (float(b.replace(",", ".")) if b.strip() else None)
    except ValueError:
        return None, None


def build(area, alueet, kayrat):
    lakes = {}
    for f in alueet:
        pr, g = f.get("properties") or {}, f.get("geometry") or {}
        jt = pr.get("jarvitunnus")
        if not jt:
            continue
        hit = any(in_area(p, area["rings"]) for ln in lines_of(g) for p in ln[::5])
        bb = bbox_of(g)
        lk = lakes.setdefault(jt, {"nimi": pr.get("syvmittausaluenimi") or "", "hit": False, "bb": bb, "feats": []})
        lk["hit"] = lk["hit"] or hit
        if bb and lk["bb"]:
            lk["bb"] = (min(lk["bb"][0], bb[0]), min(lk["bb"][1], bb[1]), max(lk["bb"][2], bb[2]), max(lk["bb"][3], bb[3]))
        lk["feats"].append(f)
    chosen = {k: v for k, v in lakes.items() if v["hit"]}
    for tol in (0.00003, 0.00006, 0.00012, 0.00025):
        feats = []
        for jt, lk in sorted(chosen.items()):
            for f in lk["feats"]:
                pr = f["properties"]
                g = simp(f["geometry"], tol)
                if not g:
                    continue
                lo, hi = depth_class(pr.get("syvyysvali_m"))
                feats.append({"type": "Feature", "geometry": g, "properties": {
                    "tyyppi": "syvyysalue", "jarvi": lk["nimi"][:60], "jarvitunnus": jt,
                    "vali": str(pr.get("syvyysvali_m") or "")[:12], "min_m": lo, "max_m": hi}})
        boxes = [lk["bb"] for lk in chosen.values() if lk["bb"]]
        for f in kayrat:
            g0 = f.get("geometry") or {}
            bb = bbox_of(g0)
            if not bb or not any(overlaps(bb, b) for b in boxes):
                continue
            g = simp(g0, tol)
            if not g:
                continue
            try:
                m = float(str((f.get("properties") or {}).get("syvyyskayra_m")).replace(",", "."))
            except ValueError:
                continue
            feats.append({"type": "Feature", "geometry": g, "properties": {"tyyppi": "syvyyskayra", "m": m}})
        gj = {"type": "FeatureCollection", "features": feats, "properties": {
            "alue_hash": area["hash"], "jarvia": len(chosen),
            "jarvet": sorted({lk["nimi"] for lk in chosen.values() if lk["nimi"]})[:200],
            "lahde": "Syke, syvyysalueet ja syvyyskäyrät (CC BY 4.0)"}}
        txt = json.dumps(gj, ensure_ascii=False, separators=(",", ":"))
        if len(txt.encode()) <= MAX_BYTES:
            return gj, txt
    return gj, txt


def main():
    drawn = V.read_drawn()
    os.makedirs(V.LAYERS, exist_ok=True)
    for area in drawn:
        path = os.path.join(V.LAYERS, area["id"] + "-syvyys.geojson")
        try:
            if json.load(open(path, encoding="utf-8")).get("properties", {}).get("alue_hash") == area["hash"]:
                print("%s: syvyystaso ajan tasalla" % area["id"])
                continue
        except Exception:  # noqa
            pass
        try:
            alueet = wfs_features(T_ALUE, area["bbox_latlon"])
            kayrat = wfs_features(T_KAYRA, area["bbox_latlon"]) if alueet else []
        except Exception as e:  # noqa
            print("%s: syvyysdataa ei saatu: %r" % (area["id"], e))
            continue
        if alueet:
            print("%s: kentät %s" % (area["id"], sorted((alueet[0].get("properties") or {}).keys())))
        gj, txt = build(area, alueet, kayrat)
        open(path, "w", encoding="utf-8").write(txt)
        print("%s: %d mitattua järveä, %d kohdetta, %.1f kt" % (area["id"], gj["properties"]["jarvia"],
                                                              len(gj["features"]), len(txt) / 1024))
    return 0


if __name__ == "__main__":
    sys.exit(main())

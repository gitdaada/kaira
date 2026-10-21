"""Vesitilanneputken laskennan testit: python3 tests/test_pipeline.py"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import vesitilanne as v  # noqa: E402

assert v.classify(1, 2, 5) == "alhainen"
assert v.classify(3, 2, 5) == "normaali"
assert v.classify(6, 2, 5) == "korkea"
assert v.classify(None, 2, 5) is None
assert v.pct([1, 2, 3, 4, 5], 0.25) == 2 and v.pct([1, 2, 3, 4, 5], 0.75) == 4
assert v.doy_diff(dt.date(2026, 12, 30), dt.date(2025, 1, 2)) <= 4
n, e = v.to_tm35(69 + 8.9371 / 60, 21 + 33.7112 / 60)  # Porojärven autiotupa: N 7680549, E 284220
assert abs(n - 7680549) < 3 and abs(e - 284220) < 3
q = v.odata_query({"$filter": "Paikka_Id eq 5 and Aika ge datetime'2020-01-01'", "$format": "json"})
assert q.startswith("$filter=Paikka_Id%20eq%205") and "%24" not in q
pts = [(0, 0), (1, 0.00001), (2, 0)]
assert v.simplify(pts, 0.001) == [(0, 0), (2, 0)]
print("putken laskenta läpi")

# FMI:n timevaluepair-jäsennys (synteettinen aineisto)
x = open(os.path.join(os.path.dirname(__file__), "fixtures", "fmi_daily_tvp.xml"), "rb").read()
r = v.parse_fmi_tvp(x)
assert r == {"999001": {"nimi": "Testiasema", "pos": [65.4, 29.5], "arvot": [2.5, 0.0, 4.0]}}, r
print("FMI-jäsennys läpi")

# Kohteiden suodatus ja kuvaus
import kohteet as a  # noqa: E402
assert a.is_hut({"tourism": "wilderness_hut", "name": "Pihtsusjärven autiotupa"})[0]
assert not a.is_hut({"tourism": "wilderness_hut", "name": "Pihtsusjärven varaustupa"})[0]
assert not a.is_hut({"tourism": "wilderness_hut", "name": "Testitupa", "reservation": "required"})[0]
assert not a.is_hut({"name": "Autiotupa", "place": "locality"})[0]
assert a.is_hut({"name": "Vanha autiotupa", "building": "hut"})[0]
assert not a.is_hut({"tourism": "wilderness_hut", "name": "X", "ruins": "yes"})[0]
d = a.describe({"capacity": "8", "fireplace": "yes", "operator": "Metsähallitus", "ele": "512"}, "autiotupa", "Lappi")
assert d == "Autiotupa, Lappi. Makuupaikkoja noin 8. Tulisija. Ylläpitäjä: Metsähallitus. Korkeus 512 m.", d
assert not a.is_hut({"tourism": "wilderness_hut", "name": "Nikon Laavu"})[0]
assert a.hut_type("Kapusta päivätupa") == "paivatupa" and a.hut_type("Pallas avoin kota") == "kota"
assert a.hut_type("Kotajärvi autiotupa") == "autiotupa" and a.hut_type("Áhkogoahti kammi") == "kammi"
assert a.hut_type("Muorravaarakka varaus- ja autiotupa") == "autiotupa" and a.is_hut({"tourism": "wilderness_hut", "name": "Muorravaarakka varaus- ja autiotupa"})[0]
assert a.safe_link({"website": "https://www.luontoon.fi/fi/kohteet/x"}) and not a.safe_link({"website": "http://luontoon.fi/x"})
assert not a.safe_link({"website": "https://example.com/luontoon.fi"})
print("autiotupien suodatus läpi")

# Laavut, kodat ja tulipaikat sekä yhdistäminen
assert a.classify({"amenity": "shelter", "shelter_type": "lean_to", "name": "Kotijärven laavu"}) == ("laavu", "")
assert a.classify({"tourism": "lean_to"}) == ("laavu", "")
assert a.classify({"leisure": "firepit"}) == ("tulipaikka", "")
assert a.classify({"leisure": "firepit", "access": "private"})[0] is None
assert a.classify({"amenity": "shelter", "shelter_type": "basic_hut", "name": "Hirvaskota"}) == ("kota", "")
assert a.classify({"amenity": "shelter", "shelter_type": "public_transport"})[0] is None
assert a.classify({"amenity": "shelter", "shelter_type": "lean_to", "disused:amenity": "shelter"})[0] is None
assert a.classify({"tourism": "wilderness_hut", "name": "Nikon Laavu"}) == ("laavu", "")
assert a.classify({"tourism": "wilderness_hut", "name": "Testin autiotupa"}) == ("autiotupa", "")
els = [
    {"type": "node", "id": 1, "lat": 61.0, "lon": 25.0, "tags": {"amenity": "shelter", "shelter_type": "lean_to", "name": "A-laavu"}},
    {"type": "node", "id": 2, "lat": 61.0001, "lon": 25.0001, "tags": {"leisure": "firepit"}},          # laavun vieressä: yhdistetään
    {"type": "node", "id": 3, "lat": 61.01, "lon": 25.01, "tags": {"leisure": "firepit"}},              # erillinen tulipaikka
    {"type": "way", "id": 4, "center": {"lat": 61.0, "lon": 25.0}, "tags": {"amenity": "shelter", "shelter_type": "lean_to", "name": "A-laavu", "building": "roof"}},  # sama laavu rakennuksena
    {"type": "node", "id": 5, "lat": 66.0, "lon": 26.0, "tags": {"tourism": "wilderness_hut", "name": "B autiotupa", "capacity": "6"}},
]
out, exc = a.build([("Pirkanmaa", els[:4]), ("Lappi", els[4:]), ("Lappi", els[4:])])
assert len(out["laavut"]) == 1 and "Tulisija." in out["laavut"][0]["properties"]["kuvaus"], out["laavut"]
assert len(out["tulipaikat"]) == 1 and out["tulipaikat"][0]["properties"]["osm"] == "node/3", out["tulipaikat"]
assert len(out["tuvat"]) == 1 and out["tuvat"][0]["properties"]["tyyppi"] == "autiotupa", out["tuvat"]
print("laavujen ja tulipaikkojen käsittely läpi")

# Piirretyt kalastusalueet, jäänpaksuus ja syvyysalueet
import json  # noqa: E402
import tempfile  # noqa: E402
assert v.dms(690302) == round(69 + 3 / 60 + 2 / 3600, 5)
assert v.dms("612959") == round(61 + 29 / 60 + 59 / 3600, 5)
assert v.dms(616100) is None and v.dms(None) is None
assert v.slugify("Ylä-Ounasjoen Alue!") == "yla-ounasjoen-alue"
sq = [[24.0, 65.0], [24.1, 65.0], [24.1, 65.1], [24.0, 65.1], [24.0, 65.0]]
gj = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"nimi": "Testijoki"}, "geometry": {"type": "Polygon", "coordinates": [sq]}},
    {"type": "Feature", "properties": {"poista": True}, "geometry": {"type": "Polygon", "coordinates": [sq]}},
    {"type": "Feature", "properties": {}, "geometry": {"type": "Point", "coordinates": [24, 65]}}]}
assert len(v.outer_rings(gj)) == 1
with tempfile.TemporaryDirectory() as tmp:
    old = v.DRAWN
    v.DRAWN = tmp
    open(os.path.join(tmp, "Testi Alue.geojson"), "w").write(json.dumps(gj))
    open(os.path.join(tmp, "rikki.geojson"), "w").write("{ei json")
    open(os.path.join(tmp, "piste.geojson"), "w").write(json.dumps({"type": "Point", "coordinates": [1, 2]}))
    d = v.read_drawn()
    v.DRAWN = old
assert len(d) == 1 and d[0]["id"] == "testi-alue" and d[0]["nimi"] == "Testijoki" and d[0]["piirretty"], d
assert d[0]["bbox_latlon"] == [65.0, 24.0, 65.1, 24.1] and len(d[0]["hash"]) == 12
pf = v.poly_filter(d[0]["rings"][0])
assert pf.split()[:2] == ["65.00000", "24.00000"], pf
long_ring = [[24 + 0.001 * i, 65 + 0.0001 * (i % 7)] for i in range(500)] + [[24, 65]]
assert len(v.poly_filter(long_ring, 50).split()) <= 100
assert len(v.poly_filter(sq).split()) >= 8
print("piirretyt alueet läpi")

import syvyys as s  # noqa: E402
assert s.depth_class("3-6") == (3.0, 6.0) and s.depth_class("20-") == (20.0, None)
assert s.inside((24.05, 65.05), sq) and not s.inside((24.2, 65.05), sq)
lake_in = {"type": "Feature", "properties": {"jarvitunnus": "1.1", "syvmittausaluenimi": "Sisäjärvi", "syvyysvali_m": "0-3"},
           "geometry": {"type": "MultiPolygon", "coordinates": [[[[24.02, 65.02], [24.04, 65.02], [24.04, 65.04], [24.02, 65.04], [24.02, 65.02]]]]}}
lake_in2 = {"type": "Feature", "properties": {"jarvitunnus": "1.1", "syvmittausaluenimi": "Sisäjärvi", "syvyysvali_m": "3-6"},
            "geometry": {"type": "MultiPolygon", "coordinates": [[[[24.09, 65.02], [24.12, 65.02], [24.12, 65.03], [24.09, 65.03], [24.09, 65.02]]]]}}
lake_out = {"type": "Feature", "properties": {"jarvitunnus": "2.2", "syvmittausaluenimi": "Ulkojärvi", "syvyysvali_m": "0-3"},
            "geometry": {"type": "MultiPolygon", "coordinates": [[[[24.3, 65.3], [24.4, 65.3], [24.4, 65.4], [24.3, 65.4], [24.3, 65.3]]]]}}
k_in = {"type": "Feature", "properties": {"syvyyskayra_m": "3"},
        "geometry": {"type": "MultiLineString", "coordinates": [[[24.03, 65.03], [24.035, 65.035]]]}}
k_out = {"type": "Feature", "properties": {"syvyyskayra_m": "3"},
         "geometry": {"type": "MultiLineString", "coordinates": [[[24.35, 65.35], [24.36, 65.36]]]}}
out, txt = s.build(d[0], [lake_in, lake_in2, lake_out], [k_in, k_out])
types = [f["properties"]["tyyppi"] for f in out["features"]]
assert out["properties"]["jarvia"] == 1 and out["properties"]["jarvet"] == ["Sisäjärvi"], out["properties"]
assert types.count("syvyysalue") == 2 and types.count("syvyyskayra") == 1, types
assert out["properties"]["alue_hash"] == d[0]["hash"] and json.loads(txt)["properties"]["jarvia"] == 1
print("syvyysalueet läpi")
circle = [[24 + 0.1 * __import__("math").cos(i / 50), 65 + 0.05 * __import__("math").sin(i / 50)] for i in range(315)]
circle.append(circle[0])
cf = v.poly_filter(circle, 60).split()
assert 16 <= len(cf) <= 120, len(cf)
print("renkaan yksinkertaistus läpi")

# Kohteet: epäonnistunut maakunta käyttää edellistä aineistoa
with tempfile.TemporaryDirectory() as tmp:
    old = (a.OUT_DIR, a.MAAKUNNAT, a.MINIMI, a.overpass, a.time.sleep)
    a.OUT_DIR, a.MAAKUNNAT, a.MINIMI = tmp, [("FI-01", "Ahvenanmaa"), ("FI-10", "Lappi")], {"tuvat": 1, "laavut": 1, "tulipaikat": 0}
    prev = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"nimi": "Vanha tupa", "tyyppi": "autiotupa", "maakunta": "Lappi"}, "geometry": {"type": "Point", "coordinates": [25.0, 68.0]}},
        {"type": "Feature", "properties": {"nimi": "Poistuva", "tyyppi": "autiotupa", "maakunta": "Ahvenanmaa"}, "geometry": {"type": "Point", "coordinates": [20.0, 60.2]}}]}
    open(os.path.join(tmp, "tuvat.geojson"), "w").write(json.dumps(prev))

    def fake(iso):
        if iso == "FI-10":
            raise RuntimeError("504")
        return [{"type": "node", "id": 1, "lat": 60.1, "lon": 19.9, "tags": {"amenity": "shelter", "shelter_type": "lean_to", "name": "Testilaavu"}}]
    a.overpass, a.time.sleep = fake, lambda s: None
    a.main()
    tuvat = json.load(open(os.path.join(tmp, "tuvat.geojson")))["features"]
    laavut = json.load(open(os.path.join(tmp, "laavut.geojson")))["features"]
    a.OUT_DIR, a.MAAKUNNAT, a.MINIMI, a.overpass, a.time.sleep = old
assert [f["properties"]["nimi"] for f in tuvat] == ["Vanha tupa"], tuvat
assert [f["properties"]["nimi"] for f in laavut] == ["Testilaavu"], laavut
print("kohteiden varahaku läpi")

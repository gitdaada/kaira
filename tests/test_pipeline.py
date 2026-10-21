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

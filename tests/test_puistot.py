"""Puistoluettelon haun apufunktiot: python3 tests/test_puistot.py (ei verkkoa)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "pipeline"))
import puistot as p  # noqa: E402

assert p.slugify("Pallas-Yllästunturin kansallispuisto") == "pallas-yllastunturin-kansallispuisto"
assert p.base_name("Selkämeren kansallispuisto (Rauman kaupunki)") == "Selkämeren kansallispuisto"
assert p.kind_of("Kansallispuisto (haltija muu kuin MH)", "X") == "kansallispuisto"
assert p.kind_of("", "Kevon luonnonpuisto") == "luonnonpuisto" and p.kind_of("Soidensuojelualue", "Jokin suo") is None
assert p.strip_html('<a href="x">Matti &amp; Maija</a>\n <span>V.</span>') == "Matti & Maija V."

for ok in ("CC BY-SA 4.0", "CC BY 2.0", "CC0", "Public domain", "CC BY-SA 3.0 de", "cc-by-sa-4.0", "Copyrighted free use"):
    assert p.license_ok(ok), ok
for bad in ("GFDL", "Fair use", "CC BY-NC 2.0", "CC BY-ND 4.0", "CC BY-NC-SA 4.0", "All rights reserved", ""):
    assert not p.license_ok(bad), bad

assert p.link_ok("http://www.luontoon.fi/nuuksio") == "https://www.luontoon.fi/nuuksio"
assert p.link_ok("https://www.luontoon.fi/fi/kohteet/kolin-kansallispuisto") == "https://www.luontoon.fi/fi/kohteet/kolin-kansallispuisto"
for bad in ("https://evil.fi/luontoon.fi", "https://luontoon.fi.evil.com/", "https://www.luontoon.fi/x y", "javascript:alert(1)", "https://www.luontoon.fi/\"><script>"):
    assert p.link_ok(bad) is None, bad

cl = {"P571": [{"mainsnak": {"datavalue": {"value": {"time": "+1994-00-00T00:00:00Z"}}}}],
      "P2046": [{"mainsnak": {"datavalue": {"value": {"amount": "+45.5", "unit": p.KM2}}}}],
      "P131": [{"rank": "deprecated", "mainsnak": {"datavalue": {"value": {"id": "Q1"}}}}, {"mainsnak": {"datavalue": {"value": {"id": "Q2"}}}}]}
assert p.wd_year(cl) == 1994 and p.wd_area_ha(cl) == 4550
assert [v["id"] for v in p.wd_values(cl, "P131")] == ["Q2"], "vanhentunut arvo ohitetaan"

c = [{"id": "Q1", "label": "Nuuksio", "description": "kylä"}, {"id": "Q2", "label": "Nuuksion kansallispuisto", "description": "kansallispuisto"}]
assert p.choose_entity("Nuuksion kansallispuisto", c) == "Q2"
assert p.choose_entity("Ruunaan retkeilyalue", [{"id": "Q9", "label": "Ruunaa", "description": "valtion retkeilyalue Lieksassa"}]) == "Q9"
assert p.choose_entity("X kansallispuisto", [{"id": "Q5", "label": "Y", "description": "kunta"}]) is None

way = {"type": "way", "geometry": [{"lon": 0, "lat": 0}, {"lon": 1, "lat": 0}, {"lon": 1, "lat": 1}, {"lon": 0, "lat": 0}]}
assert len(p.rings_from_osm(way)) == 1
assert p.rings_from_osm({"type": "way", "geometry": [{"lon": 0, "lat": 0}, {"lon": 1, "lat": 0}]}) == [], "avoin viiva ei ole alue"
rel = {"type": "relation", "members": [
    {"type": "way", "role": "outer", "geometry": [{"lon": 0, "lat": 0}, {"lon": 1, "lat": 0}, {"lon": 1, "lat": 1}]},
    {"type": "way", "role": "outer", "geometry": [{"lon": 1, "lat": 1}, {"lon": 0, "lat": 1}, {"lon": 0, "lat": 0}]},
    {"type": "way", "role": "inner", "geometry": [{"lon": 0.2, "lat": 0.2}, {"lon": 0.4, "lat": 0.2}, {"lon": 0.4, "lat": 0.4}, {"lon": 0.2, "lat": 0.2}]}]}
assert len(p.rings_from_osm(rel)) == 1, "relaation ulkorenkaat yhdistetään, sisärenkaat ohitetaan"

# Raja: yksinkertaistus, edustava piste alueen sisällä ja rajaus
from shapely.geometry import Polygon  # noqa: E402
fwd, back = p.to_3067()
ring = [fwd.transform(lon, lat) for lon, lat in [(25.0, 62.0), (25.1, 62.0), (25.1, 62.05), (25.0, 62.05), (25.0, 62.0)]]
fc, info = p.boundary_feature("Testipuisto", "kansallispuisto", Polygon(ring))
assert fc["features"][0]["geometry"]["type"] == "Polygon" and fc["features"][0]["properties"]["tyyppi"] == "alue"
assert 2500 < info["ha"] < 3000 and 62.0 < info["lat"] < 62.05 and 25.0 < info["lon"] < 25.1
assert info["bbox"][0] <= info["lat"] <= info["bbox"][2]
print("puistot läpi")

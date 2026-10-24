"""Selaintesti: python3 tests/e2e.py <docs-kansio> <kuvakansio>

Käynnistää paikallisen palvelimen sovellukselle ja valekarttapalvelun (MML:n tilalla), korvaa sää- ja
sadetutkarajapinnat testidatalla ja käy läpi kaikki osiot: metsästys (alue, napautus, merkintä,
tuuliviuhka), kalastus (perhot, solmut, saalis, vesitilanne), eränkäynti (kohteet, kompassi,
suunnistus, GPX), yhteiset työkalut (mittaus, SOS, ohje, käyttöehdot) ja offline-tallennuksen
sekä uudelleenkäynnistyksen ilman verkkoa.
"""
import io
import json
import shutil
import tempfile
import sys
import threading
import time
from datetime import datetime, timedelta, timezone
from functools import partial
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image
from playwright.sync_api import sync_playwright

SITE = Path(sys.argv[1]).resolve()
SHOTS = Path(sys.argv[2])
SHOTS.mkdir(parents=True, exist_ok=True)
APP_PORT, TILE_PORT = 8771, 8772
APP = "http://127.0.0.1:%d/" % APP_PORT
TILE_REQUESTS = []


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def png(rgb=(236, 232, 214)):
    buf = io.BytesIO()
    Image.new("RGB", (256, 256), rgb).save(buf, "PNG")
    return buf.getvalue()


TILE_PNG = png()


class TileHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        TILE_REQUESTS.append(urlparse(self.path).path)
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(TILE_PNG)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(TILE_PNG)


def serve(handler, port):
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def fmi_xml():
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    parts = []
    for h in range(-1, 60):
        t = (now + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M:%SZ")
        for name, val in (("WindDirection", 225), ("WindSpeedMS", 4.2), ("WindGust", 7.5), ("Temperature", 6.4), ("Humidity", 82), ("Precipitation1h", 0.2)):
            parts.append("<wfs:member><BsWfs:BsWfsElement><BsWfs:Time>%s</BsWfs:Time><BsWfs:ParameterName>%s</BsWfs:ParameterName>"
                         "<BsWfs:ParameterValue>%s</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>" % (t, name, val))
    return ('<?xml version="1.0"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" '
            'xmlns:BsWfs="http://xml.fmi.fi/schema/wfs/2.0">' + "".join(parts) + "</wfs:FeatureCollection>")


def nowcast(rain):
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    now = now - timedelta(minutes=now.minute % 5)
    ts = []
    for k in range(0, 25):
        t = (now + timedelta(minutes=5 * k)).strftime("%Y-%m-%dT%H:%M:%SZ")
        ts.append({"time": t, "data": {"instant": {"details": {"precipitation_rate": (1.5 if rain and k >= 3 else 0.0)}}}})
    return json.dumps({"properties": {"meta": {"radar_coverage": "ok"}, "timeseries": ts}})


GPX = """<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="testi" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Testireitti &lt;b&gt;</name></metadata>
  <wpt lat="69.12" lon="21.62"><name>Kahvipaikka</name></wpt>
  <trk><name>Ura</name><trkseg>
    <trkpt lat="69.100" lon="21.600"/><trkpt lat="69.105" lon="21.610"/><trkpt lat="69.110" lon="21.620"/>
    <trkpt lat="69.115" lon="21.640"/><trkpt lat="69.120" lon="21.650"/>
  </trkseg></trk>
</gpx>"""


def square(lat, lon, d):
    return [[lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]


def fixtures():
    """Testidata kalastuksen jää- ja syvyysnäkymille (korvaa sovelluksen omat tiedostot vain testissä)."""
    idx = json.loads((SITE / "layers" / "index.json").read_text(encoding="utf-8"))
    idx["tasot"].append({"id": "testijarvi", "nimi": "Testijärvi", "tiedosto": "testijarvi.geojson", "piirretty": True,
                         "versio": "abc123def0", "syvyys": "testijarvi-syvyys.geojson", "syvyys_versio": "0fed321cba"})
    now = datetime.now(timezone.utc)
    return {
        "layers/index.json": idx,
        "layers/testijarvi.geojson": {"type": "FeatureCollection", "features": [{"type": "Feature",
            "properties": {"nimi": "Testijärvi", "tyyppi": "alue"}, "geometry": {"type": "Polygon", "coordinates": [square(62.0, 25.0, 0.05)]}}]},
        "layers/testijarvi-syvyys.geojson": {"type": "FeatureCollection", "properties": {"jarvia": 1, "jarvet": ["Testijärvi"]}, "features": [
            {"type": "Feature", "properties": {"tyyppi": "syvyysalue", "jarvi": "Testijärvi", "vali": "3-6", "min_m": 3, "max_m": 6},
             "geometry": {"type": "MultiPolygon", "coordinates": [[square(62.0, 25.0, 0.01)]]}},
            {"type": "Feature", "properties": {"tyyppi": "syvyyskayra", "m": 3},
             "geometry": {"type": "LineString", "coordinates": square(62.0, 25.0, 0.01)}}]},
        "data/maastopalo.json": {"paivitetty": now.isoformat(), "lahde": "testi", "varoitukset": [
            {"id": "t1", "taso": "keltainen", "alue": "Testimaakunta", "otsikko": "Keltainen maastopalovaroitus", "alkaa": (now - timedelta(hours=2)).isoformat(),
             "paattyy": (now + timedelta(hours=10)).isoformat(), "polygonit": [square(63.48, 25.94, 0.3)]},
            {"id": "t2", "taso": "punainen", "alue": "Kalamajan alue", "otsikko": "Punainen maastopalovaroitus", "alkaa": (now - timedelta(hours=1)).isoformat(),
             "paattyy": (now + timedelta(hours=5)).isoformat(), "polygonit": [square(64.2736, 27.3272, 0.05)]},
            {"id": "t3", "taso": "oranssi", "alue": "Vanhentunut", "alkaa": (now - timedelta(days=2)).isoformat(),
             "paattyy": (now - timedelta(days=1)).isoformat(), "polygonit": [square(63.48, 25.94, 0.5)]},
            {"id": "t4", "taso": "oranssi", "alue": "Huominen", "alkaa": (now + timedelta(hours=20)).isoformat(),
             "paattyy": (now + timedelta(hours=30)).isoformat(), "polygonit": [square(61.0, 24.0, 0.5)]},
            {"id": "t5", "taso": "musta", "alue": "Virheellinen", "paattyy": (now + timedelta(hours=3)).isoformat(), "polygonit": [square(62.0, 25.0, 0.5)]}]},
        "data/jaa.json": {"paivitetty": now.isoformat(), "jakso_vrk": 30, "asemat": [
            {"nimi": "Lähiasema", "jarvi": "Lähijärvi", "lat": 63.49, "lon": 25.95, "cm": 34, "aika": (now - timedelta(days=2)).date().isoformat()},
            {"nimi": "Alueasema", "jarvi": "Testijärvi", "lat": 62.02, "lon": 25.01, "cm": 41, "aika": (now - timedelta(days=12)).date().isoformat()},
            {"nimi": "Kaukoasema", "jarvi": "Kaukojärvi", "lat": 61.0, "lon": 24.0, "cm": 50, "aika": now.date().isoformat()}]},
    }


def fmi_simple(rows):
    """Ilmatieteen laitoksen "simple"-muotoinen vastaus: rows = [(lat, lon, aika, parametri, arvo)]."""
    m = "".join('<wfs:member><BsWfs:BsWfsElement gml:id="e%d"><BsWfs:Location><gml:Point srsDimension="2"><gml:pos>%.5f %.5f </gml:pos></gml:Point></BsWfs:Location>'
                '<BsWfs:Time>%s</BsWfs:Time><BsWfs:ParameterName>%s</BsWfs:ParameterName><BsWfs:ParameterValue>%s</BsWfs:ParameterValue></BsWfs:BsWfsElement></wfs:member>'
                % (i, r[0], r[1], r[2].strftime("%Y-%m-%dT%H:%M:%SZ"), r[3], r[4]) for i, r in enumerate(rows))
    return ('<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" '
            'xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:BsWfs="http://xml.fmi.fi/schema/wfs/2.0">' + m + '</wfs:FeatureCollection>')


def lightning_xml():
    now = datetime.now(timezone.utc)
    return fmi_simple([(63.50, 25.95, now - timedelta(minutes=5), "peak_current", "-12.0"),
                       (63.55, 26.05, now - timedelta(minutes=25), "peak_current", "8.0"),
                       (63.85, 25.94, now - timedelta(minutes=10), "peak_current", "5.0")])  # 41 km: ei mukana


def snow_xml():
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    return fmi_simple([(63.45, 25.90, now - timedelta(hours=1), "snow_aws", "11.0"), (63.45, 25.90, now, "snow_aws", "12.0"),
                       (63.52, 26.10, now, "snow_aws", "15.0"), (63.48, 25.95, now, "snow_aws", "NaN"),
                       (63.85, 25.94, now, "snow_aws", "30.0")])


def berry_fixture(site):
    """Eränkäynnin testialueet marja- ja sienitasoineen sijainnin kohdalle (100 x 100 ruutua, n. 3,6 km) ja sen itäpuolelle.
    Oikeiden alueiden marja- ja sienitiedot poistetaan testikopiosta, jotta tulokset eivät riipu tuotantodatasta."""
    import math
    lat, lon, n, res = 63.4806, 25.9395, 100, 36.0
    idx_path = site / "data" / "areas.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    idx["areas"] = [a for a in idx["areas"] if a.get("osio") != "erankaynti"]
    for a in idx["areas"]:
        a.pop("marjat", None); a.pop("sienet", None)
    mx = lon * 20037508.342789 / 180
    my = math.log(math.tan((90 + lat) * math.pi / 360)) * 6378137

    def ll(x, y):
        return [round(math.degrees(2 * math.atan(math.exp(y / 6378137)) - math.pi / 2), 6), round(x / 6378137 * 180 / math.pi, 6)]
    for aid, name, dx in (("era-testi", "Marjatesti", 0.0), ("era-testi-ita", "Marjatesti itä", n * res)):
        x0, y1 = mx - n * res / 2 + dx, my + n * res / 2
        x1, y0 = x0 + n * res, y1 - n * res
        d = site / "data" / aid
        d.mkdir(parents=True, exist_ok=True)
        m = Image.new("RGB", (n, n), (0, 0, 0)); px = m.load()
        s2 = Image.new("RGB", (n, n), (0, 0, 0)); py = s2.load()
        for i in range(n):
            for j in range(n):
                px[i, j] = (220, 140 if i < n // 2 else 0, 0)        # mustikka hyvä kaikkialla, puolukka sopiva vasemmalla
                py[i, j] = (0, 0, 200 if j < n // 2 else 0)          # herkkutatti hyvä yläpuolella
        m.save(d / "marjat.png"); s2.save(d / "sienet.png")
        b0, b1 = ll(x0, y0), ll(x1, y1)
        ring = [[b0[1], b0[0]], [b1[1], b0[0]], [b1[1], b1[0]], [b0[1], b1[0]], [b0[1], b0[0]]]
        (d / "boundary.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {},
            "geometry": {"type": "Polygon", "coordinates": [ring]}}]}), encoding="utf-8")
        idx["areas"].append({"id": aid, "name": name, "osio": "erankaynti", "areaHa": 1296, "center": [(b0[0] + b1[0]) / 2, (b0[1] + b1[1]) / 2],
                             "version": "t1", "bytes": 5000,
                             "forest": {"width": n, "height": n, "res": res, "mercBounds": [x0, y0, x1, y1], "bounds": [b0, b1], "file": "data/%s/forest.png?v=t1" % aid},
                             "boundary": "data/%s/boundary.geojson?v=t1" % aid, "marjat": "data/%s/marjat.png?v=t1" % aid, "sienet": "data/%s/sienet.png?v=t1" % aid})
    idx_path.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")



def parks_fixture(site):
    """Puistoluettelon testidata: kansallispuisto Kalamajan autiotuvan ympärillä, luonnonpuisto ja retkeilyalue sekä
    kohteet, joiden linkki ja kuva eivät kelpaa (pois) ja tuntematon tyyppi (pois)."""
    (site / "data" / "puistot").mkdir(parents=True, exist_ok=True)
    (site / "img" / "puistot").mkdir(parents=True, exist_ok=True)
    ring = square(64.2736, 27.3272, 0.05)
    (site / "data" / "puistot" / "testin-kansallispuisto.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"nimi": "Testin kansallispuisto", "tyyppi": "alue"}, "geometry": {"type": "Polygon", "coordinates": [ring]}}]}), encoding="utf-8")
    Image.new("RGB", (720, 540), (60, 110, 70)).save(site / "img" / "puistot" / "testin-kansallispuisto.jpg", "JPEG")
    kuva = {"src": "img/puistot/testin-kansallispuisto.jpg?v=abc123", "tekija": "Testikuvaaja", "lisenssi": "CC BY-SA 4.0",
            "lahde": "https://commons.wikimedia.org/wiki/File:Testi.jpg"}
    data = {"paivitetty": "2026-10-24T00:00:00Z", "lahteet": [], "kohteet": [
        {"id": "testin-kansallispuisto", "nimi": "Testin kansallispuisto", "tyyppi": "kansallispuisto", "lat": 64.2736, "lon": 27.3272, "ha": 5400,
         "perustettu": 1982, "kunnat": ["Testikunta"], "bbox": [64.22, 27.22, 64.33, 27.43], "raja": "data/puistot/testin-kansallispuisto.geojson?v=abc123",
         "linkki": "https://www.luontoon.fi/testi", "kuva": kuva},
        {"id": "testin-luonnonpuisto", "nimi": "Testin luonnonpuisto", "tyyppi": "luonnonpuisto", "lat": 68.5, "lon": 23.6, "ha": 950, "kunnat": [], "linkki": None, "kuva": None},
        {"id": "testin-retkeilyalue", "nimi": "Testin retkeilyalue", "tyyppi": "retkeilyalue", "lat": 62.0, "lon": 25.0, "ha": 3100, "kunnat": ["Toinen"]},
        {"id": "huono", "nimi": "Huono linkki", "tyyppi": "kansallispuisto", "lat": 69.5, "lon": 27.0, "linkki": "javascript:alert(1)",
         "kuva": {"src": "https://evil.example/x.jpg"}, "raja": "../../etc/passwd"},
        {"id": "muu", "nimi": "Tuntematon tyyppi", "tyyppi": "muu", "lat": 63.0, "lon": 26.0}]}
    (site / "data" / "puistot.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("ok -", msg)




def main():
    # Sovellus ajetaan kopiosta, johon lisätään kalastuksen testidata (palvelutyöntekijän hakuja ei voi siepata).
    tmp = tempfile.TemporaryDirectory()
    site = Path(tmp.name) / "site"
    shutil.copytree(SITE, site)
    for rel, data in fixtures().items():
        (site / rel).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    berry_fixture(site)
    parks_fixture(site)
    app_srv = serve(partial(Quiet, directory=str(site)), APP_PORT)
    tile_srv = serve(TileHandler, TILE_PORT)
    errors = []
    gpx_path = SHOTS / "testi.gpx"
    gpx_path.write_text(GPX, encoding="utf-8")
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                            geolocation={"latitude": 63.4806, "longitude": 25.9395}, permissions=["geolocation"], locale="fi-FI",
                            bypass_csp=True)  # Playwrightin odotusfunktiot vaativat eval-luvan; CSP tarkistetaan erikseen lopussa
        state = {"rain": True}

        def handle(route):
            u = route.request.url
            if u.startswith("https://opendata.fmi.fi/") and "lightning" in u:
                return route.fulfill(status=200, content_type="application/xml", body=lightning_xml(), headers={"Access-Control-Allow-Origin": "*"})
            if u.startswith("https://opendata.fmi.fi/") and "snow_aws" in u:
                return route.fulfill(status=200, content_type="application/xml", body=snow_xml(), headers={"Access-Control-Allow-Origin": "*"})
            if u.startswith("https://opendata.fmi.fi/"):
                return route.fulfill(status=200, content_type="application/xml", body=fmi_xml())
            if u.startswith("https://api.met.no/"):
                return route.fulfill(status=200, content_type="application/json", body=nowcast(state["rain"]), headers={"Access-Control-Allow-Origin": "*"})
            if u.startswith("https://tile.openstreetmap.org/") or u.startswith("https://avoin-karttakuva.maanmittauslaitos.fi/"):
                return route.fulfill(status=200, content_type="image/png", body=TILE_PNG, headers={"Access-Control-Allow-Origin": "*"})
            if u.startswith(APP) or u.startswith("http://127.0.0.1:%d/" % TILE_PORT) or u.startswith("data:") or u.startswith("blob:"):
                return route.continue_()
            return route.abort()
        ctx.route("**/*", handle)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append("PAGEERROR: " + str(e)))
        pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "404" not in m.text and "ERR_" not in m.text else None)
        pg.on("dialog", lambda d: d.accept())

        # --- Aloitus ---
        pg.goto(APP, wait_until="load")
        pg.wait_for_function("window.K && K.section")
        check(pg.locator("#start").is_visible(), "aloitusnäkymä näkyy ensimmäisellä kerralla")
        check(pg.locator(".start-card.on").count() == 0, "aloitusnäkymässä ei ole valmiiksi valittua osiota")
        check("kaupalliseen" in pg.locator(".start-terms").inner_text(), "aloitusnäkymässä maininta kaupallisesta käytöstä")
        pg.screenshot(path=str(SHOTS / "01-aloitus.png"))

        # --- Metsästys ---
        pg.locator(".start-card", has_text="Metsästys").click()
        pg.wait_for_selector("#sheet:not([hidden])")
        check(pg.locator("#sheetTitle").inner_text() == "Lupa-alueet", "metsästyksessä avautuu lupa-alueiden luettelo")
        check(pg.locator(".card-main", has_text="Marjatesti").count() == 0, "eränkäynnin alue ei näy lupa-alueissa")
        pg.locator(".card-main", has_text="Jahti").click()
        pg.wait_for_function("K.hunt.S.forest !== null", timeout=20000)
        check(True, "lupa-alueen metsätieto latautui")
        pg.wait_for_function("K.wx.data && K.wx.data.series.length > 10", timeout=15000)
        check("°" in pg.locator("#wxCard").inner_text(), "sääkortti näyttää lämpötilan")
        check("Haju" in pg.locator("#wxCard").inner_text(), "metsästyksessä sääkortissa hajuolosuhteet")
        # Napautus alueen keskelle
        a = pg.evaluate("K.hunt.S.area.center")
        pg.evaluate("K.map.setView([%f, %f], 14, {animate:false})" % (a[0], a[1]))
        pg.wait_for_timeout(400)
        pg.mouse.click(195, 470)
        pg.wait_for_selector("#infoCard:not([hidden])")
        txt = pg.locator("#infoCard").inner_text()
        check(any(w in txt for w in ("metsä", "Metsä", "Taimikko", "Puuton", "Ei metsätietoa", "Hakkuuaukko")), "napautus näyttää metsätiedon: " + txt.split("\n")[0])
        check("Suunnista tänne" in txt, "tietokortissa suunnistus")
        pg.screenshot(path=str(SHOTS / "02-metsastys.png"))
        pg.locator("#infoCard .info-close").click()
        # Oma (piirretty) alue lupa-alueen päällä: napautus näyttää silti metsätiedon, ei pelkkää alueen nimeä
        pg.evaluate("""window._own = K.geoLayer({type: 'FeatureCollection', features: [{type: 'Feature', properties: {nimi: 'Oma testialue', tyyppi: 'alue'},
            geometry: {type: 'Polygon', coordinates: [[[%f, %f], [%f, %f], [%f, %f], [%f, %f], [%f, %f]]]}}]}).addTo(K.map)""" % (
            a[1] - 0.05, a[0] - 0.03, a[1] + 0.05, a[0] - 0.03, a[1] + 0.05, a[0] + 0.03, a[1] - 0.05, a[0] + 0.03, a[1] - 0.05, a[0] - 0.03))
        pg.wait_for_timeout(200)
        pg.mouse.click(195, 470)
        pg.wait_for_selector("#infoCard:not([hidden])")
        own_txt = pg.locator("#infoCard").inner_text()
        check("Oma testialue" not in own_txt.split("\n")[0] and own_txt.split("\n")[0] == txt.split("\n")[0],
              "oman alueen sisällä napautus näyttää metsätiedon (%s)" % own_txt.split("\n")[0])
        pg.locator("#infoCard .info-close").click()
        pg.evaluate("K.map.removeLayer(window._own)")
        # GPS ja tuuliviuhka
        pg.locator("#locateBtn").click()
        pg.wait_for_function("K.pos !== null", timeout=10000)
        pg.wait_for_function("document.querySelector('.wind-canvas') !== null", timeout=10000)
        check(True, "tuuliviuhka piirtyy sijainnista")
        # Salamat ja lumensyvyys 20 km säteellä sijainnista
        pg.wait_for_function("K.obsWx.S.lightPt && Math.abs(K.obsWx.S.lightPt.lat - 63.48) < 0.02 && K.obsWx.S.snow && K.obsWx.S.snow.length", timeout=15000)
        check(len(pg.evaluate("K.obsWx.S.light")) == 2, "salamat 20 km säteellä (kaukainen pois)")
        check([x["cm"] for x in pg.evaluate("K.obsWx.S.snow")][:2] == [12, 15], "lumensyvyys: uusin arvo asemittain, NaN ohitettu")
        pg.wait_for_function("document.getElementById('wxCard').innerText.indexOf('Salamat 2') >= 0 && document.getElementById('wxCard').innerText.indexOf('Lumi 12–15 cm') >= 0", timeout=5000)
        check(True, "sääkortissa salamat ja lumi")
        check(pg.locator(".bolt-pin").count() == 2 and pg.locator(".obs-lumi").count() == 2, "salamat ja lumiasemat kartalla")
        # Maastopalovaroitus: voimassa olevat alueet kartalla ja merkki yläpalkissa, kun sijainti on varoitusalueella
        pg.wait_for_function("K.palo.S.data !== null", timeout=10000)
        check([w["alue"] for w in pg.evaluate("K.palo.nowList()")] == ["Testimaakunta", "Kalamajan alue"], "voimassa olevat maastopalovaroitukset (vanhentunut, tuleva ja virheellinen pois)")
        pg.wait_for_function("document.getElementById('wxCard').innerText.indexOf('Maastopalovaroitus') >= 0", timeout=10000)
        check(True, "sääkortissa maastopalovaroitus, kun sijainti on varoitusalueella")
        check(pg.evaluate("document.querySelectorAll('.leaflet-fire-pane path').length") == 2, "varoitusalueet kartalla")
        pg.evaluate("K.tapInfo(L.latLng(63.4806, 25.9395), {title: 'Testi'})")
        check("avotulen teko kielletty" in pg.locator("#infoCard").inner_text(), "tietokortissa maastopalovaroitus")
        pg.locator("#infoCard .info-close").click()
        pg.locator("#wxCard").click()
        pg.wait_for_selector("#sheet:not([hidden])")
        check("avotulen teko kielletty" in pg.locator("#sheetBody").inner_text(), "sääpaneelissa maastopalovaroitus")
        pg.locator("#sheetBody button", has_text="Kaikki maastopalovaroitukset").click()
        pg.wait_for_function("document.getElementById('sheetTitle').innerText === 'Maastopalovaroitukset'")
        body = pg.locator("#sheetBody").inner_text()
        check("Testimaakunta" in body and "Huominen" in body and "Vanhentunut" not in body and "Avotuleksi ei katsota" in body, "varoituspaneeli: sijainti, voimassa ja alkamassa")
        pg.screenshot(path=str(SHOTS / "03b-maastopalo.png"))
        pg.locator("#sheetClose").click()
        # Marjat metsästyksessä: vain mustikka ja puolukka, rivi metsätiedon/sijainnin korttiin
        pg.evaluate("K.settings.mbMustikka = true; K.saveSettings(); K.map.setView([63.4806, 25.9395], 13, {animate:false}); K.berries.refresh()")
        pg.wait_for_function("K.berries.S.dec['era-testi|marjat']", timeout=15000)
        pg.wait_for_timeout(300)
        pg.mouse.click(195, 400)
        pg.wait_for_selector("#infoCard:not([hidden])")
        check("Mustikka: hyvä" in pg.locator("#infoCard").inner_text(), "metsästyksessä marjatieto tietokortissa")
        pg.locator("#infoCard .info-close").click()
        pg.locator("#navLayers").click()
        pg.wait_for_function("document.getElementById('sheetBody').innerText.toLowerCase().indexOf('lintujen ravintoa') >= 0", timeout=10000)
        body = pg.locator("#sheetBody").inner_text().lower()
        check("puolukka" in body and "kantarelli" not in body, "metsästyksen Tasoissa vain mustikka ja puolukka")
        pg.locator("#sheetClose").click()
        pg.evaluate("K.settings.mbMustikka = false; K.saveSettings(); K.berries.refresh()")
        # Merkintä
        pg.locator("#navMain").click()
        pg.wait_for_selector("#sheet:not([hidden]) .obs-form")
        pg.locator(".obs-form .seg button", has_text="Teeri").click()
        pg.locator(".obs-form .seg button", has_text="Saalis").click()
        pg.locator(".obs-form .btn-primary", has_text="Tallenna").click()
        check(pg.evaluate("K.hunt.obs().length") == 1, "metsästysmerkintä tallentui")
        check(pg.locator(".obs-pin.obs-saalis").count() >= 1, "merkintä näkyy kartalla")
        # Sääpaneeli metsästyksessä
        pg.locator("#wxCard").click()
        pg.wait_for_selector("#sheet:not([hidden])")
        body = pg.locator("#sheetBody").inner_text().lower()
        check("koiran hajuolosuhteet" in body and "tuuliviuhka" in body and "ennuste" in body, "sääpaneelissa ennuste, haju ja tuuliviuhka")
        pg.locator("#sheetClose").click()
        # Sadetutka (testidatassa sataa)
        pg.wait_for_function("K.rain.data && K.rain.data.anyRain", timeout=20000)
        pg.wait_for_selector("#rainBar:not([hidden])")
        check(pg.evaluate("!!K.rain.layer"), "sadetutka näkyy kartalla, kun lähellä sataa")
        pg.screenshot(path=str(SHOTS / "03-sade.png"))
        pg.locator("#rainHide").click()

        # --- Kalastus ---
        pg.evaluate("K.setSection('kalastus')")
        pg.wait_for_timeout(500)
        check(pg.locator(".obs-pin.obs-saalis").count() == 0, "metsästysmerkinnät poistuvat kalastuksessa")
        check("Maastopalovaroitus" not in pg.locator("#wxCard").inner_text() and pg.evaluate("document.querySelectorAll('.leaflet-fire-pane path').length") == 0, "maastopalovaroitukset eivät näy kalastuksessa")
        check(pg.evaluate("document.querySelectorAll('.wind-canvas').length") == 0, "tuuliviuhka ei näy kalastuksessa")
        check(pg.locator("#navMain .nav-lbl").inner_text() == "Saalis" and pg.locator("#navInfo .nav-lbl").inner_text() == "Perhot", "alapalkki vaihtuu osion mukaan")
        styles = pg.evaluate("""['koski', 'suvanto', 'kohde'].map(function (t) { var o = null;
            K.geoLayer({type: 'FeatureCollection', features: [{type: 'Feature', properties: {tyyppi: t}, geometry: {type: 'Point', coordinates: [25, 63]}},
              {type: 'Feature', properties: {tyyppi: 'joki'}, geometry: {type: 'LineString', coordinates: [[25, 63], [25.1, 63.1]]}}]})
              .eachLayer(function (l) { if (l.getRadius) o = [l.options.fillColor, l.options.fillOpacity, l.options.color]; else if (l.options.color !== '#2b8cbe') o = 'viiva'; });
            return o; })""")
        check(styles == [["#2b8cbe", 1, "#10160f"], ["#7fc8e8", 1, "#10160f"], ["#5bd18b", 1, "#10160f"]], "kosket, suvannot ja kohteet omilla väreillään, joki viivatyylillä (%s)" % styles)
        pg.wait_for_function("performance.getEntriesByType('resource').some(function (e) { return e.name.indexOf('layers/testijarvi.geojson?v=abc123def0') >= 0; })", timeout=10000)
        check(True, "kalastusalueen taso haetaan versiolla (päivittynyt taso ei jää välimuistiin)")
        pg.locator("#navInfo").click()
        pg.wait_for_selector("#sheetBody .seg")
        pg.wait_for_function("document.querySelector('#sheetBody').innerText.toLowerCase().indexOf('kalalaji') >= 0", timeout=10000)
        pg.locator("#sheetBody .field", has_text="Nouseeko").locator("button", has_text="Kyllä").click()
        pg.locator("#sheetBody .field", has_text="Lentääkö").locator("button", has_text="Ei").click()
        check(pg.locator(".fly-card").count() > 0, "perhosuositus näkyy")
        pg.locator("#sheetBody .seg button", has_text="Solmut").first.click()
        check(pg.locator(".knot-svg").count() == 1, "solmuanimaatio näkyy")
        pg.screenshot(path=str(SHOTS / "04-perhot.png"))
        pg.locator("#sheetClose").click()
        pg.locator("#navMain").click()
        pg.wait_for_selector("#sheet:not([hidden]) .obs-form")
        pg.locator(".obs-form .seg button", has_text="Harjus").click()
        pg.locator(".obs-form input[aria-label='Pituus (cm)']").fill("38.5")
        pg.locator(".obs-form .btn-primary", has_text="Tallenna").click()
        check(pg.evaluate("K.fish.catches().length") == 1 and pg.evaluate("K.fish.catches()[0].cm") == 38.5, "saalis tallentui pituuden kanssa")
        pg.wait_for_function("K.fish.S.water && K.fish.S.water.geo", timeout=10000)
        check(True, "vesitilanne latautui")
        # Vesistökäyrät: virtaama, vedenkorkeus ja veden lämpötila joen tietokortissa
        pg.evaluate("""(function () {
          var d = function (k) { var t = new Date(Date.now() - (29 - k) * 864e5); return t.toISOString().slice(0, 10); };
          var mk = function (suure, base, unit) { var s = [], b = []; for (var k = 0; k < 30; k++) { s.push([d(k), base + Math.sin(k / 4) * base * 0.1]); b.push([d(k), base * 0.9, base * 1.1]); }
            return { suure: suure, asema: 'Testiasema', etaisyys_km: 0.4, arvo: s[29][1], aika: s[29][0], yksikko: unit, p25: base * 0.9, p75: base * 1.1, vuodet: 20, sarja: s, kaista: b }; };
          K.fish.waterInfo({ nimi: 'Testijoki', luokka: 'normaali', menetelma: 'mittaus', mittaukset: [mk('virtaama', 22, 'm³/s'), mk('vedenkorkeus', 118, 'cm')],
            lampotila: Object.assign(mk('lampotila', 6.8, '°C'), { kaista: [] }) }, L.latLng(63.48, 25.94));
        })()""")
        pg.wait_for_selector("#infoCard:not([hidden])")
        txt = pg.locator("#infoCard").inner_text()
        check(pg.locator("#infoCard .water-chart").count() == 3 and "Virtaama" in txt and "Vedenkorkeus" in txt and "Veden lämpötila" in txt, "joen kortissa kolme käyrää")
        pg.screenshot(path=str(SHOTS / "04e-vesistokayrat.png"))
        pg.locator("#infoCard .info-close").click()
        # Jäänpaksuus: vain 5 km säteellä sijainnista tai kalastusalueella olevat asemat
        pg.wait_for_function("K.fish.S.ice && K.fish.S.layers.testijarvi", timeout=10000)
        names = pg.evaluate("K.fish.iceStations().map(function (x) { return x.a.nimi; })")
        check(names == ["Lähiasema", "Alueasema"], "jäänpaksuus: lähiasema ja kalastusalueen asema, ei kaukaista (%s)" % names)
        check(pg.locator(".obs-jaa").count() == 2, "jäämerkit kartalla")
        pg.locator("#navMenu").click()
        pg.locator(".menu-item", has_text="Jäänpaksuus").click()
        body = pg.locator("#sheetBody").inner_text()
        check("34 cm" in body and "41 cm" in body and "tuuralla" in body and "sinusta" in body and "Kaukojärvi" not in body,
              "jäänpaksuuslista: arvo, etäisyys ja varoitus")
        pg.screenshot(path=str(SHOTS / "04b-jaa.png"))
        pg.locator("#sheetClose").click()
        # Syvyysalue: napautus järven kohdalla kalastusalueen sisällä
        pg.wait_for_function("K.fish.S.layers.testijarvi.depth", timeout=10000)
        pg.evaluate("K.map.setView([62.0, 25.0], 13, {animate:false})")
        pg.wait_for_timeout(400)
        check(pg.evaluate("!!K.fish.depthAt(L.latLng(62.0, 25.0)) && !K.fish.depthAt(L.latLng(62.03, 25.0))"), "syvyysalueen pistehaku")
        pg.mouse.click(195, 422)
        pg.wait_for_selector("#infoCard:not([hidden])")
        txt = pg.locator("#infoCard").inner_text()
        check("Syvyys 3–6 m" in txt and "Testijärvi" in txt, "napautus järvellä näyttää syvyyden: " + txt.split("\n")[0])
        pg.screenshot(path=str(SHOTS / "04c-syvyys.png"))
        pg.locator("#infoCard .info-close").click()
        # Alueen piirto: kulmapisteet, tallennus omaksi tasoksi ja analyysilinkki
        pg.locator("#navTools").click()
        pg.locator(".menu-item", has_text="Piirrä alue").click()
        check(pg.locator("#drawBar").is_visible() and pg.locator("#drawDone").is_disabled(), "piirtopalkki näkyy")
        for x, y in ((110, 330), (290, 340), (280, 520), (120, 500)):
            pg.mouse.click(x, y)
        dt = pg.locator("#drawText").inner_text()
        check("4 pistettä" in dt and (" ha" in dt or "km²" in dt), "piirto näyttää pisteet ja pinta-alan: " + dt)
        check(pg.locator("#infoCard").is_hidden(), "piirron napautus ei avaa tietokorttia")
        pg.locator("#drawMode").click()
        pg.mouse.move(150, 410); pg.mouse.down(); pg.mouse.move(200, 440, steps=8); pg.mouse.move(250, 410, steps=8); pg.mouse.up()
        n = pg.evaluate("parseInt(document.getElementById('drawText').textContent, 10)")
        # Vedon pisteet osuvat sormen kohdalle (kääntyvän kartan säiliö on näyttöä suurempi).
        far = pg.evaluate("""(function () { var last = null; K.map.eachLayer(function (l) { if (l instanceof L.Polygon && l.options.pane === 'targetPane') last = l; });
          var ll = last.getLatLngs()[0], p = ll[ll.length - 1], q = K.rot ? K.rot.latLngToScreen(p) : K.map.latLngToContainerPoint(p);
          return Math.hypot(q.x - 250, q.y - 410); })()""")
        check(far < 12, "sormen vedon viimeinen piste osuu sormen kohdalle (%.1f px)" % far)
        check(n > 6, "sormella piirto lisää pisteitä (%d, palkin yläreuna %s)" % (n, pg.evaluate("Math.round(document.getElementById('drawBar').getBoundingClientRect().top)")))
        pg.screenshot(path=str(SHOTS / "04d-piirto.png"))
        pg.locator("#drawDone").click()
        pg.wait_for_selector("#sheet:not([hidden]) input[aria-label='Alueen nimi']")
        pg.locator("input[aria-label='Alueen nimi']").fill("Testi <b>joki</b>")
        pg.locator("#sheetBody .btn-primary", has_text="Tallenna tasoksi").click()
        saved = pg.evaluate("(JSON.parse(localStorage.getItem('kaira.imported')) || []).filter(function (x) { return /^piirretty-/.test(x.id); })")
        check(len(saved) == 1 and saved[0]["nimi"] == "Testi <b>joki</b>", "piirretty alue tallentui omaksi tasoksi")
        pg.evaluate("window.open = function (u) { window.__opened = u; return null; }")
        pg.locator("#sheetBody .btn-primary", has_text="Lähetä analysoitavaksi").click()
        url = pg.evaluate("window.__opened")
        check(url.startswith("https://github.com/gitdaada/kaira/new/main/areas/kalastus?filename=testi-b-joki-b.geojson&value=") and len(url) < 7000,
              "analyysilinkki avaa GitHubin kalastusalueen tiedoston")
        pg.locator("#sheetClose").click()

        # --- Eränkäynti ---
        pg.evaluate("K.setSection('erankaynti')")
        pg.wait_for_function("K.wild.D.features.length > 50", timeout=15000)
        check(pg.locator(".obs-kala").count() == 0, "saaliit poistuvat eränkäynnissä")
        pg.evaluate("K.map.setView([68.4, 23.5], 10, {animate:false})")
        pg.wait_for_timeout(400)
        check(pg.locator(".kohde-pin").count() > 0, "kohteet näkyvät kartalla")
        pg.locator("#navMain").click()
        pg.wait_for_selector(".list-row")
        check(pg.locator(".list-row").count() > 5, "lähimmät kohteet listattu")
        pg.locator(".list-row").first.click()
        pg.wait_for_selector(".kohde-dial")
        check("Suunta" in pg.locator(".kohde-read").inner_text() or "–" in pg.locator(".kohde-read").inner_text(), "kohteen kompassi näkyy")
        pg.screenshot(path=str(SHOTS / "05-kohde.png"))
        # Varoitusalueella olevan kohteen paneelissa näkyy avotulikielto
        pg.evaluate("K.wild.openKohde(K.wild.D.features.filter(function (f) { return f.nimi === 'Kalamaja autiotupa'; })[0])")
        pg.wait_for_function("document.getElementById('sheetBody').innerText.indexOf('Kalamaja') >= 0 || document.getElementById('sheetTitle').innerText.indexOf('Kalamaja') >= 0")
        check("Punainen maastopalovaroitus" in pg.locator("#sheetBody").inner_text(), "kohteen paneelissa maastopalovaroitus")
        pg.screenshot(path=str(SHOTS / "05b-kohde-varoitus.png"))
        pg.locator("#sheetBody .btn-primary", has_text="Suunnista tänne").click()
        pg.wait_for_selector("#targetCard:not([hidden])")
        check(pg.evaluate("!!K.target") and "km" in pg.locator("#targetCard").inner_text(), "suunnistuskortti näyttää matkan")
        pg.screenshot(path=str(SHOTS / "06-suunnistus.png"))
        pg.locator("#targetCard .btn", has_text="Lopeta").click()
        check(pg.evaluate("K.target === null"), "suunnistus lopetettu")
        # Puistot ja retkialueet: Kohteet-paneelin välilehti, etäisyysjärjestys sijainnista, suodatus, haku ja kohteen sivu
        pg.locator("#navMain").click()
        pg.wait_for_selector("#sheetBody .seg-tabs")
        pg.locator("#sheetBody .seg-tabs button", has_text="Puistot").click()
        pg.wait_for_function("document.querySelectorAll('#sheetBody .park-list .list-row').length >= 3", timeout=10000)
        rows = pg.evaluate("Array.from(document.querySelectorAll('#sheetBody .park-list .list-row b')).map(function (b) { return b.textContent; })")
        check(rows == ["Testin kansallispuisto", "Testin retkeilyalue", "Testin luonnonpuisto", "Huono linkki"], "puistot etäisyyden mukaan, tuntematon tyyppi pois (%s)" % rows)
        bad = pg.evaluate("K.parks.P.data.filter(function (e) { return e.id === 'huono'; })[0]")
        check(bad["linkki"] is None and bad["kuva"] is None and bad["raja"] is None, "kelpaamaton linkki, kuva ja raja hylätään")
        pg.locator("#sheetBody .seg-wrap button", has_text="Luonnonpuistot").click()
        pg.wait_for_function("document.querySelectorAll('#sheetBody .park-list .list-row').length === 1")
        check(pg.locator("#sheetBody .park-list .list-row b").inner_text() == "Testin luonnonpuisto", "suodatus tyypin mukaan")
        pg.locator("#sheetBody .seg-wrap button", has_text="Kaikki").click()
        pg.locator("#sheetBody input[type=search]").fill("testikunta")
        pg.wait_for_function("document.querySelectorAll('#sheetBody .park-list .list-row').length === 1")
        check(pg.locator("#sheetBody .park-list .list-row b").inner_text() == "Testin kansallispuisto", "haku nimellä tai kunnalla")
        pg.screenshot(path=str(SHOTS / "06d-puistot.png"))
        pg.locator("#sheetBody .park-list .list-row").first.click()
        pg.wait_for_function("document.getElementById('sheetTitle').innerText === 'Testin kansallispuisto'")
        body = pg.locator("#sheetBody").inner_text()
        check("Kansallispuisto · 54 km² · perustettu 1982" in body and "Testikunta" in body and "Testikuvaaja, CC BY-SA 4.0" in body, "kohteen perustiedot ja kuvan tekijä")
        link = pg.locator("#sheetBody a.btn-primary")
        check(link.get_attribute("href") == "https://www.luontoon.fi/testi" and link.get_attribute("target") == "_blank" and link.inner_text() == "Avaa luontoon.fi",
              "linkki Metsähallituksen sivulle")
        check(pg.evaluate("document.querySelector('#sheetBody .park-fig img').getAttribute('src')") == "img/puistot/testin-kansallispuisto.jpg?v=abc123", "kohteen kuva")
        pg.locator("#sheetBody button", has_text="Tuvat ja laavut alueella").click()
        pg.wait_for_function("document.querySelector('#sheetBody .park-inside h3') && document.querySelector('#sheetBody .park-inside h3').innerText.toLowerCase().indexOf('alueella') >= 0", timeout=10000)
        check("Kalamaja autiotupa" in pg.locator("#sheetBody .park-inside").inner_text(), "alueen tuvat ja laavut rajan sisältä")
        pg.screenshot(path=str(SHOTS / "06e-puisto.png"))
        pg.locator("#sheetBody button", has_text="Näytä kartalla").click()
        pg.wait_for_function("K.parks.P.layer.getLayers().length === 2 && document.getElementById('sheet').hidden", timeout=10000)
        check("raja kartalla" in pg.locator("#toast").inner_text(), "puiston raja kartalla")
        pg.wait_for_timeout(1500)  # kartan siirtymäanimaatio loppuun ennen seuraavia testejä
        pg.locator("#toast button", has_text="Piilota").click()
        check(pg.evaluate("K.parks.P.layer.getLayers().length") == 0, "rajan piilotus")
        pg.evaluate("K.parks.openPark(K.parks.P.data.filter(function (e) { return e.id === 'testin-luonnonpuisto'; })[0])")
        pg.wait_for_function("document.getElementById('sheetTitle').innerText === 'Testin luonnonpuisto'")
        check("liikkumista on rajoitettu" in pg.locator("#sheetBody").inner_text() and pg.locator("#sheetBody a.btn-primary").count() == 0, "luonnonpuiston huomautus, ei linkkiä ilman osoitetta")
        pg.locator("#sheetClose").click()
        # Marjat ja sienet: tasot vain eränkäynnissä, piirretyillä alueilla
        pg.evaluate("K.settings.bMustikka = true; K.settings.bHerkku = true; K.saveSettings(); K.map.setView([63.4806, 25.9395], 13, {animate:false})")
        pg.wait_for_function("K.berries.S.dec['era-testi|marjat'] && K.berries.S.dec['era-testi|sienet']", timeout=15000)
        # Kaksi aluetta näkymässä ja molemmat tiedostot: kaikki neljä kuvaa pysyvät muistissa eivätkä pura toisiaan pois siirroissa
        pg.wait_for_function("['era-testi', 'era-testi-ita'].every(function (a) { return K.berries.S.dec[a + '|marjat'] && K.berries.S.dec[a + '|sienet']; })", timeout=15000)
        pg.evaluate("window._dec0 = K.berries.S.dec['era-testi|marjat']; K.map.panBy([30, 0], {animate: false})")
        pg.wait_for_timeout(500)
        check(pg.evaluate("K.berries.S.dec['era-testi|marjat'] === window._dec0 && Object.keys(K.berries.S.dec).length === 4"),
              "kahden vierekkäisen alueen marja- ja sienikuvat pysyvät muistissa siirron jälkeen")
        r = pg.evaluate("K.berries.at(L.latLng(63.4815, 25.9395)).map(function (x) { return x.laji.id + ':' + x.taso; })")
        check(r == ["mustikka:2", "herkkutatti:2"], "marja- ja sienitiedot pisteessä (%s)" % r)
        check(pg.evaluate("K.berries.at(L.latLng(63.4795, 25.9395)).map(function (x) { return x.laji.id; })") == ["mustikka"], "herkkutatti vain alueen yläosassa")
        pg.locator("#navLayers").click()
        pg.wait_for_function("document.getElementById('sheetBody').innerText.indexOf('Marjatesti') >= 0", timeout=10000)
        body = pg.locator("#sheetBody").inner_text().lower()
        check("marjat ja sienet" in body and "suppilovahvero" in body and "marjatesti" in body, "Tasot: marja- ja sienikytkimet ja alueet")
        pg.locator("#sheetClose").click()
        pg.screenshot(path=str(SHOTS / "05c-marjat.png"))
        pg.evaluate("K.settings.bMustikka = false; K.settings.bHerkku = false; K.saveSettings(); K.berries.refresh()")
        # GPX
        pg.locator("#navInfo").click()
        pg.wait_for_selector("#sheetBody .btn-primary", )
        with pg.expect_file_chooser() as fc:
            pg.locator("#sheetBody .btn-primary", has_text="Tuo GPX-reitti").click()
        fc.value.set_files(str(gpx_path))
        pg.wait_for_function("K.wild.routes().length === 1", timeout=5000)
        r = pg.evaluate("K.wild.routes()[0]")
        check(r["name"] == "Testireitti <b>" and r["km"] > 1 and len(r["wpts"]) == 1, "GPX-reitti tuotiin (nimi tekstinä, pituus, reittipiste)")
        pg.locator("#navInfo").click()
        pg.wait_for_selector("#sheetBody .card-title")
        check(pg.locator(".card-title", has_text="Testireitti <b>").count() == 1, "GPX-nimi näkyy tekstinä, ei HTML:nä")
        pg.locator("#sheetClose").click()

        # --- Yhteiset työkalut ---
        pg.locator("#navTools").click()
        pg.locator(".menu-item", has_text="Mittaa").click()
        pg.mouse.click(120, 400)
        pg.mouse.click(260, 520)
        check("Matka" in pg.locator("#measureText").inner_text(), "mittaus näyttää matkan")
        pg.locator("#measureDone").click()
        pg.locator("#sosBtn").click()
        pg.wait_for_selector("#sheet:not([hidden])")
        check("ETRS-TM35FIN" in pg.locator("#sheetBody").inner_text(), "hätäkoordinaatit näkyvät")
        check(pg.locator("#sheetBody a.sos-call").get_attribute("href") == "tel:112", "SOS: soita 112 -linkki")
        # Hälytä apua: ilman vastaanottajia ohjataan asetuksiin
        pg.locator("#sosAlarmBtn").click()
        pg.wait_for_selector("#sosAlarm")
        check("Vastaanottajia ei ole" in pg.locator("#sosAlarm").inner_text() and pg.locator("#sosSms").count() == 0, "hälytys ilman vastaanottajia ohjaa asetuksiin")
        pg.locator("#sosAlarm a", has_text="asetuksiin").click()
        pg.wait_for_function("document.getElementById('sheetTitle').innerText === 'Asetukset'")
        pg.locator("#sosMsg").fill("Nilkka nyrjähti, en pääse kävelemään.")
        pg.locator("#sosMsg").dispatch_event("change")
        def rcpt(i, nimi, nro):
            pg.locator('[aria-label="Vastaanottaja %d, nimi"]' % i).fill(nimi)
            pg.locator('[aria-label="Vastaanottaja %d, puhelinnumero"]' % i).fill(nro)
            pg.locator('[aria-label="Vastaanottaja %d, puhelinnumero"]' % i).dispatch_event("change")
        rcpt(1, "Ville", "040 123 4567")
        rcpt(2, "Anna", "123")
        check("Numero ei kelpaa" in pg.locator("#toast").inner_text() and "input-bad" in pg.locator('[aria-label="Vastaanottaja 2, puhelinnumero"]').get_attribute("class"),
              "virheellinen numero hylätään")
        rcpt(2, "Anna", "+46 70 123 45 67")
        check(pg.locator('[aria-label="Vastaanottaja 1, puhelinnumero"]').input_value() == "+358401234567", "numero muutetaan kansainväliseen muotoon")
        check(pg.evaluate("K.settings.sosTo") == [{"nimi": "Ville", "nro": "+358401234567"}, {"nimi": "Anna", "nro": "+46701234567"}]
              and pg.evaluate("K.settings.sosMsg") == "Nilkka nyrjähti, en pääse kävelemään.", "hätäviestin asetukset tallentuivat")
        pg.screenshot(path=str(SHOTS / "06b-hataviesti-asetukset.png"), full_page=False)
        pg.locator("#sheetClose").click()
        pg.locator("#sosBtn").click()
        pg.wait_for_selector("#sheet:not([hidden])")
        pg.locator("#sosAlarmBtn").click()
        pg.wait_for_selector("#sosSms")
        pre = pg.locator(".sos-preview").inner_text()
        check(pre.startswith("Nilkka nyrjähti") and "Sijainti: 63.4806" in pre and "ETRS-TM35FIN: N " in pre and "google.com/maps/search/?api=1&query=63.4806" in pre,
              "hätäviestissä oma teksti, sijainti, koordinaatit ja kartalinkki")
        check(pg.evaluate("document.getElementById('sosSms').getAttribute('href') === 'sms:+358401234567,+46701234567?body=' + encodeURIComponent(document.querySelector('.sos-preview').textContent)"),
              "tekstiviesti kaikille vastaanottajille kerralla")
        wa = pg.evaluate("Array.from(document.querySelectorAll('#sosAlarm a.sos-wa')).map(function (a) { return [a.textContent, a.getAttribute('href').split('?')[0], a.target, a.rel]; })")
        check(wa == [["WhatsApp: Ville", "https://wa.me/358401234567", "_blank", "noopener noreferrer"], ["WhatsApp: Anna", "https://wa.me/46701234567", "_blank", "noopener noreferrer"]],
              "WhatsApp-linkki jokaiselle vastaanottajalle")
        check(pg.evaluate("document.querySelector('#sosAlarm a.sos-wa').getAttribute('href').indexOf('?text=' + encodeURIComponent(document.querySelector('.sos-preview').textContent)) > 0"),
              "WhatsAppiin valmis viesti")
        pg.locator("#sheetBody").evaluate("function (b) { b.scrollTop = b.scrollHeight; }")
        pg.screenshot(path=str(SHOTS / "06c-halyta-apua.png"))
        pg.locator("#sheetClose").click()
        pg.locator("#navMenu").click()
        pg.locator(".menu-item", has_text="Ohje").click()
        check("Kohteen kompassi" in pg.locator("#sheetBody").inner_text(), "eränkäynnin ohje näkyy")
        pg.locator("#sheetBody .seg button", has_text="Metsästys").click()
        check("Vinoviivat" in pg.locator("#sheetBody").inner_text(), "metsästyksen ohje näkyy välilehdeltä")
        pg.screenshot(path=str(SHOTS / "07-ohje.png"))
        pg.locator("#navMenu").click()
        pg.locator(".menu-item", has_text="Käyttöehdot").click()
        check("Ei kaupalliseen käyttöön" in pg.locator("#sheetBody").inner_text(), "käyttöehdot sovelluksessa")
        pg.locator("#sheetClose").click()

        # --- Offline: näkymän tallennus ja uudelleenkäynnistys ilman verkkoa ---
        pg.evaluate("K.settings.apiKey='testiavain'; K.settings.maxZoom=15; K.saveSettings(); K.setBasemap()")
        pg.evaluate("K.map.setView([68.4, 23.5], 13, {animate:false})")
        pg.wait_for_timeout(300)
        pg.locator("#navTools").click()
        pg.locator(".menu-item", has_text="Tallenna näkymä").click()
        pg.locator("#sheetBody .btn-primary").click()
        pg.wait_for_function("Object.keys(K.offline.records()).length === 1 && !K.offline.busy()", timeout=60000)
        rec = pg.evaluate("Object.values(K.offline.records())[0]")
        check(rec["tiles"] > 0 and rec["failed"] == 0, "näkymä tallennettu offline (%d tiiltä)" % rec["tiles"])
        pg.wait_for_function("navigator.serviceWorker.controller !== null", timeout=15000)
        ctx.set_offline(True)
        pg.reload(wait_until="load")
        pg.wait_for_function("window.K && K.section === 'erankaynti'", timeout=15000)
        check(pg.locator("#netChip").is_visible(), "offline-tila näkyy")
        check(pg.evaluate("K.wild.routes().length") == 1 and pg.evaluate("K.hunt.obs().length") == 1, "tallennetut tiedot säilyivät")
        pg.wait_for_function("K.wild.D.features.length > 50", timeout=10000)
        check(True, "kohteet toimivat ilman verkkoa")
        pg.evaluate("K.setSection('metsastys')")
        pg.wait_for_function("K.hunt.S.areas.length > 0", timeout=10000)
        check(True, "lupa-alueluettelo toimii ilman verkkoa")
        pg.screenshot(path=str(SHOTS / "08-offline.png"))
        ctx.set_offline(False)

        bad = [e for e in errors if "Failed to load resource" not in e]
        check(not bad, "ei JavaScript-virheitä" + ("" if not bad else ": " + " | ".join(bad[:5])))

        # --- Sisältöturvakäytäntö: sovelluksen omat resurssit eivät riko CSP:tä ---
        ctx2 = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, service_workers="block",
                             geolocation={"latitude": 63.4806, "longitude": 25.9395}, permissions=["geolocation"])
        ctx2.route("**/*", handle)
        csp = []
        p2 = ctx2.new_page()
        p2.on("console", lambda m: csp.append(m.text) if "Content Security Policy" in m.text or "Refused" in m.text else None)
        p2.on("pageerror", lambda e: csp.append(str(e)))
        p2.goto(APP, wait_until="load")
        time.sleep(1.5)
        for sec in ("metsastys", "kalastus", "erankaynti"):
            p2.evaluate("K.setSection('%s')" % sec)
            time.sleep(2.5)
        p2.evaluate("K.openHelp('metsastys')")
        p2.evaluate("K.startGps(true)")
        time.sleep(2)
        check(not csp, "CSP ei estä sovelluksen omia toimintoja" + ("" if not csp else ": " + " | ".join(csp[:5])))
        ctx2.close()
        b.close()
    app_srv.shutdown(); tile_srv.shutdown()
    tmp.cleanup()
    print("SELAINTESTI LÄPI")


if __name__ == "__main__":
    main()

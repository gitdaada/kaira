"""Selaintesti: python3 tests/e2e.py <docs-kansio> <kuvakansio>

Käynnistää paikallisen palvelimen sovellukselle ja valekarttapalvelun (MML:n tilalla), korvaa sää- ja
sadetutkarajapinnat testidatalla ja käy läpi kaikki osiot: metsästys (alue, napautus, merkintä,
tuuliviuhka), kalastus (perhot, solmut, saalis, vesitilanne), eränkäynti (kohteet, kompassi,
suunnistus, GPX), yhteiset työkalut (mittaus, SOS, ohje, käyttöehdot) ja offline-tallennuksen
sekä uudelleenkäynnistyksen ilman verkkoa.
"""
import io
import json
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


def check(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("ok -", msg)


def main():
    app_srv = serve(partial(Quiet, directory=str(SITE)), APP_PORT)
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
        # GPS ja tuuliviuhka
        pg.locator("#locateBtn").click()
        pg.wait_for_function("K.pos !== null", timeout=10000)
        pg.wait_for_function("document.querySelector('.wind-canvas') !== null", timeout=10000)
        check(True, "tuuliviuhka piirtyy sijainnista")
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
        check(pg.evaluate("document.querySelectorAll('.wind-canvas').length") == 0, "tuuliviuhka ei näy kalastuksessa")
        check(pg.locator("#navMain .nav-lbl").inner_text() == "Saalis" and pg.locator("#navInfo .nav-lbl").inner_text() == "Perhot", "alapalkki vaihtuu osion mukaan")
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
        pg.locator("#sheetBody .btn-primary", has_text="Suunnista tänne").click()
        pg.wait_for_selector("#targetCard:not([hidden])")
        check(pg.evaluate("!!K.target") and "km" in pg.locator("#targetCard").inner_text(), "suunnistuskortti näyttää matkan")
        pg.screenshot(path=str(SHOTS / "06-suunnistus.png"))
        pg.locator("#targetCard .btn", has_text="Lopeta").click()
        check(pg.evaluate("K.target === null"), "suunnistus lopetettu")
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
    print("SELAINTESTI LÄPI")


if __name__ == "__main__":
    main()

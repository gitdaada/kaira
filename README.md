# Kaira

Offline-toimiva karttasovellus metsästykseen, kalastukseen ja eränkäyntiin. Asennetaan puhelimeen selaimen kautta.

Sovellus: https://kaira-kartta.pages.dev/

Kaira yhdistää aiemmat sovellukset Metsäkartta (`gitdaada/metsakartta`) ja Joki-opas (`gitdaada/joki-opas`). Versio 0.1 on testiversio.

> **Ei kaupalliseen käyttöön ilman tekijän lupaa.** Kairaa saa käyttää, muokata ja jakaa ei-kaupallisiin tarkoituksiin. Kaupallinen käyttö, kuten julkaisu sovelluskaupassa, vaatii tekijän kirjallisen luvan. Ks. [Lisenssi](#lisenssi).

## Osiot

Käyttäjä valitsee osion aloitusnäkymässä tai yläpalkista. Kartta, tasot ja alapalkin painikkeet vaihtuvat osion mukaan. Jokaisessa osiossa on oma ohje (Valikko → Ohje).

**Kaikissa osioissa**

- Maastokartta, taustakartta tai ilmakuva (Maanmittauslaitos), ilman avainta OpenStreetMap
- Offline-tallennus: lupa-alue, kalastusalue, reitti, oma taso tai nykyinen näkymä
- Oma sijainti ja seuranta, kartan kääntö kahdella sormella, kompassiseuranta
- Sää sijainnissa: tuntiennuste noin 60 h (tallentuu offline-käyttöön), animoitu sadetutka 0–2 h, aurinko ja hämärä
- Etäisyyden ja suunnan mittaus, etäisyysrenkaat 1, 5 ja 20 km
- Salamahavainnot (viimeinen tunti) ja lumensyvyys sääasemilta 20 km säteellä sijainnista
- Suunnistus mihin tahansa kohtaan: katkoviiva ja suuntakortti
- Hätäkoordinaatit (WGS84, asteet ja minuutit, ETRS-TM35FIN) ja Hälytä apua: valmis viesti sijainteineen ja kartalinkkeineen tekstiviestinä kaikille tai WhatsAppissa 1–3 asetuksissa valitulle henkilölle. Käyttäjä lähettää viestin itse; vastaanottajat ovat vain laitteessa.
- Alueen piirto napauttamalla tai sormella: oma taso, offline-tallennus ja GeoJSON-lataus
- Omat GeoJSON-tasot, näyttö päällä -tila

**Metsästys** (Metsäkartasta)

- Metsän ikä värikoodattuna Metsähallituksen lupa-alueilla, taimikot vinoviivoin
- Luonnonsuojelualueet, uudet hakkuut ja hakkuuilmoitukset
- Kanalintujen elinympäristö: metso, teeri ja pyy
- Mustikan ja puolukan kasvupaikka-arvio (lintujen ravintoa) lupa-alueilla, napautustieto metsätiedon kortissa
- Tuuliviuhka (hajusi kulku) ja koiran hajuolosuhteet
- Havaintojen ja saaliin kirjaus, kauden yhteenveto, CSV-vienti ja Metsäkartan merkintöjen tuonti
- Voimassa olevat maastopalovaroitukset (Ilmatieteen laitos) kartalla, sääkortissa ja tietokortissa

| Väri | Merkitys |
| --- | --- |
| Punainen | Puuton (hakkuuaukko, avosuo) |
| Vihreä | Metsä alle 80 v, vihreämpi = nuorempi |
| Sininen | Vanha metsä, vähintään 80 v (raja muutettavissa) |
| Vinoviivoitus | Taimikko (alle 7 m) |
| Keltainen katkoviiva | Luonnonsuojelualue |
| Musta viiva | Lupa-alueen raja |
| Punainen reunus / katkoviiva | Uusi hakkuuaukko / hakkuuilmoitus |
| Oranssi alue | Kanalintulajin elinympäristö |
| Violetti alue | Mustikan kasvupaikka (vahva = hyvä, haalea = sopiva) |
| Punainen alue | Puolukan kasvupaikka |
| Keltainen, oranssi tai punainen katkoviiva-alue | Voimassa oleva maastopalovaroitus |
| Violetti viuhka | Tuuliviuhka |

**Kalastus** (Joki-oppaasta)

- Perhosuositus hyönteisen kehitysvaiheen mukaan (pohjalla, nousussa, pinturi, aikuinen), lohelle veden tilan mukaan
- Animoidut solmuohjeet, toimivat ilman verkkoa
- Jokien vesitilanne väreinä (punainen = alhainen, vihreä = normaali, tummansininen = korkea)
- Virtaama, vedenkorkeus ja veden lämpötila 30 vuorokauden käyrinä tavallisen vaihteluvälin kanssa (Valikko → Vesistöt tai napauta jokea)
- Piirretyt kalastusalueet: raja, kosket ja suvannot (Maanmittauslaitoksen maastotietokanta ja nimistö sekä OpenStreetMap)
- Jäänpaksuus: Syken mittaukset kalastusalueilla ja 5 km säteellä sijainnista (arvo, mittauspäivä, etäisyys ja varoitus)
- Järvien syvyysalueet piirretyillä kalastusalueilla, vain Syken mittaamat järvet
- Saaliskirjaus: laji, pituus, paino, vapautettu, perho tai viehe

**Eränkäynti**

- Autiotuvat, autiokammit, päivätuvat, kodat, laavut ja tulipaikat koko Suomesta (OpenStreetMap, päivittyy viikoittain)
- Lähimmät kohteet etäisyyden mukaan, kohteen kompassi ja *Suunnista tänne*
- GPX-reittien tuonti, näyttö, offline-tallennus ja suunnistus reitin alkuun
- Voimassa olevat maastopalovaroitukset: alueet kartalla, avotulikielto laavun ja tulipaikan tiedoissa
- Marjojen ja sienten kasvupaikka-arvio (mustikka, puolukka, kantarelli, suppilovahvero, herkkutatti) piirretyillä alueilla ja lupa-alueilla; arvio metsätiedosta, ei satoennuste

## Käyttöönotto

1. **Puhelin:** avaa https://kaira-kartta.pages.dev/ Chromessa ja valitse ⋮ → *Asenna sovellus* (iPhone: Safari → Jaa → *Lisää Koti-valikkoon*).
2. **MML:n API-avain:** hae ilmainen avain [Maanmittauslaitokselta](https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje) ja syötä se sovelluksen asetuksiin. Avain on henkilökohtainen ja tallentuu vain puhelimeen.
3. **Offline:** tallenna alue kotona Wi-Fissä ennen reissua.
4. **Kosket kalastusalueille (valinnainen):** lisää MML:n API-avain repon Actions-salaisuudeksi nimellä `MML_API_KEY` (Settings → Secrets and variables → Actions). Vesitilanne-ajo hakee sillä maastotietokannan kosket ja nimistön; ilman sitä kosket haetaan vain OpenStreetMapista. Avain ei tallennu repoon eikä sovellukseen.

Julkaisu: Cloudflare Pages julkaisee `docs/`-kansion automaattisesti jokaisesta pushista main-haaraan (Framework preset None, Build command tyhjä, Build output directory `docs`).

## Alueet

- **Metsästys:** lupa-alueiden rajat ovat kansiossa [`areas/metsastys/`](areas/metsastys/README.md). Uusi tiedosto käynnistää metsäkartan rakentamisen GitHub Actionsissa.
- **Kalastus:** piirretyt kalastusalueet ovat kansiossa `areas/kalastus/`. Uusi tiedosto käynnistää Vesitilanne-ajon, joka hakee alueen nimetyt joet ja purot (OpenStreetMap), niiden vesitilanteen, kosket ja suvannot sekä mitattujen järvien syvyysalueet. Tulokset tallentuvat kansioon `docs/layers/` (luettelo `docs/layers/index.json`). Jokia voi määritellä myös käsin tiedostossa `pipeline/joet.json`.
- **Eränkäynti:** piirretyt alueet ovat kansiossa `areas/erankaynti/`. Rakenna metsäkartat -ajo laskee niille marja- ja sienitasot (`pipeline/marjat.py`); lupa-alueet saavat tasot samalla.
- **Piirto sovelluksessa:** Työkalut → Piirrä alue → Valmis → Lähetä analysoitavaksi. GitHub avautuu valmiiksi täytettynä, ja repon omistaja tallentaa tiedoston (*Commit changes*). Lähetetty alue on julkinen. Merkinnät ja saaliit eivät lähde laitteesta.

## Miten tämä toimii

- `docs/`: sovellus (Cloudflare Pages). Leaflet-kartta ja tavallinen JavaScript ilman käännösvaihetta.
  - `js/kaira.js`: runko (asetukset, kartta, osiot, alapalkki, sijainti, kompassi, suunnistus, offline, hätäkoordinaatit ja hätäviesti)
  - `js/weather.js`: sää, sadetutka ja aurinko kaikissa osioissa
  - `js/tools.js`: mittaus, alueen piirto, etäisyysrenkaat, omat tasot, näkymän tallennus
  - `js/hunt.js`, `js/fish.js`, `js/wild.js`: osioiden toiminnot
  - `js/palo.js`: maastopalovaroitukset (metsästys ja eränkäynti)
  - `js/havainnot.js`: salamahavainnot ja lumensyvyys (kaikki osiot)
  - `js/marjat.js`: marjojen ja sienten kasvupaikat (eränkäynti; mustikka ja puolukka myös metsästyksessä)
  - `js/help.js`: osiokohtainen ohje ja käyttöehdot
  - `js/core.js`, `js/jcore.js`: laskenta ilman käyttöliittymää (testattavissa)
  - `sw.js`: service worker, joka pitää sovelluksen ja tallennetut kartat käytettävissä ilman verkkoa
- `pipeline/`: datan päivitys GitHub Actionsissa

| Ajo | Ajastus | Tuottaa |
| --- | --- | --- |
| Rakenna metsäkartat (`build.py`) | Maanantaisin ja kun `areas/metsastys/` tai `areas/erankaynti/` muuttuu | `docs/data/<alue>/` (myös marjat.png ja sienet.png), `docs/data/areas.json` |
| Vesitilanne (`syvyys.py`, `vesitilanne.py`) | Päivittäin ja kun `areas/kalastus/` muuttuu | `docs/data/vesitilanne.json`, `docs/data/jaa.json`, `docs/layers/` |
| Kohteet (`kohteet.py`) | Viikoittain | `docs/data/kohteet/{tuvat,laavut,tulipaikat}.geojson` |
| Maastopalovaroitukset (`maastopalo.py`) | Huhti–syyskuussa tunnin välein, loka–maaliskuussa 6 tunnin välein; tallennus vain muutoksesta | `docs/data/maastopalo.json` |
| Testit | Jokaisessa muutoksessa | – (myös riippuvuuksien haavoittuvuudet ja Cloudflaren rajat) |
| Rajapintojen tarkistus (`tarkistus.py`) | Käsin | Vain lokimerkinnät: rajapintojen vastausten rakenne oikealla datalla |

Ajon voi käynnistää käsin: *Actions → ajo → Run workflow*. GitHub keskeyttää ajastetut ajot, jos repossa ei tapahdu mitään 60 päivään.

## Tietosuoja ja tietoturva

- Sovellus ei kerää, tallenna eikä lähetä henkilötietoja. Siinä ei ole kirjautumista, evästeitä, analytiikkaa, palvelinta eikä ulkopuolisia skriptejä tai fontteja.
- Sijainti käsitellään vain laitteessa. Maastopalovaroitukset haetaan GitHub Actionsissa koko maasta, joten niitä varten sijaintia ei lähetetä minnekään. Sää-, sade-, salama- ja lumitietoa haettaessa Ilmatieteen laitokselle, MET Norwaylle ja varalla Open-Meteolle lähetetään noin kilometrin tarkkuuteen pyöristetyt koordinaatit, vain kun sovellus on auki.
- Merkinnät, saaliit, reitit, tuodut tasot, API-avain ja offline-kartat ovat vain laitteen selaimessa.
- Sisältöturvakäytäntö (CSP) sallii yhteydet vain sovellukseen itseensä sekä Maanmittauslaitokselle, OpenStreetMapille, Ilmatieteen laitokselle, Open-Meteolle ja MET Norwaylle.
- Tuodut tiedostot (GeoJSON, GPX, CSV) tarkistetaan: vain sijainnit ja tunnetut tekstikentät luetaan, eikä sisältöä tulkita HTML:nä.
- GitHub Actions -ajoilla on vain välttämättömät oikeudet, ja käytettyjen toimintojen versiot on lukittu.
- Repossa ei ole API-avaimia, salasanoja eikä henkilötietoja. Älä lisää niitä tiedostoihin.
- GitHubin salaisuusskannaus ja push-suojaus ovat päällä. Testit-ajo tarkistaa Python-riippuvuuksien tunnetut haavoittuvuudet (pip-audit) ja Cloudflare Pagesin ilmaistason rajat (tiedosto alle 25 MiB, alle 20 000 tiedostoa, ei Functions-koodia).
- Sivusto ei näy hakukoneissa (`X-Robots-Tag: noindex`). Puuttuvat polut palauttavat 404-sivun, joten virheellinen osoite ei tallennu välimuistiin datan tilalle.
- Repo on julkinen. Siitä näkyvät sovelluksen koodi sekä lupa- ja kalastusalueiden rajat.

## Tietolähteet ja lisenssit

- Pohjakartta ja ilmakuva: Maanmittauslaitos, CC BY 4.0. Ilman avainta: © OpenStreetMapin tekijät, ODbL (vain verkossa).
- Metsätieto sekä elinympäristö-, marja- ja sienimallin lähtötiedot: Luonnonvarakeskus, MVMI 2023, CC BY 4.0. Mustikka-arvio perustuu Luken malliin (Turtiainen ym. 2016, Silva Fennica 50(4) 1573); puolukka- ja sieniarviot ovat suuntaa antavia asiantuntija-arvioita.
- Luonnonsuojelualueet: Syke / Metsähallitus, CC BY 4.0. Uudet hakkuut: Suomen metsäkeskus, CC BY 4.0.
- Sää ja tuuli: Ilmatieteen laitos, CC BY 4.0; varalla Open-Meteo (CC BY 4.0, ilmainen vain ei-kaupalliseen käyttöön).
- Maastopalovaroitukset: Ilmatieteen laitos, varoitukset CAP-muodossa (alerts.fmi.fi). Koska Ilmatieteen laitoksen palvelin ei vastaa GitHub Actionsin verkosta, varoitukset haetaan tarvittaessa EUMETNET MeteoAlarmin kautta (CC BY 4.0). MeteoAlarmin varoitusalueiden rajat (`pipeline/data/meteoalarm_fi.geojson`, CC BY 4.0) on poimittu meteoalarm-Python-kirjaston (MIT) aineistosta ja yksinkertaistettu; rajat ovat likimääräisiä. Varoitus on voimassa vain Ilmatieteen laitoksen ilmoittamana; tarkista ajantasainen tilanne ilmatieteenlaitos.fi/varoitukset.
- Sadetutkaennuste: MET Norway, Nowcast 2.0, CC BY 4.0.
- Salamahavainnot ja lumensyvyys: Ilmatieteen laitos, avoin data, CC BY 4.0 (haetaan puhelimessa, sijainti pyöristettynä noin 1 km).
- Vesitilanne, virtaama, vedenkorkeus, veden lämpötila ja jäänpaksuus: Syke, Hydrologiarajapinta, CC BY 4.0; sademäärä: Ilmatieteen laitos, CC BY 4.0. Jokien uomat: © OpenStreetMapin tekijät, ODbL.
- Järvien syvyysalueet ja syvyyskäyrät: Syke, CC BY 4.0 (vain mitatut järvet).
- Kosket ja suvannot kalastusalueilla: Maanmittauslaitos, maastotietokanta (kohdeluokka Koski) ja nimistö, CC BY 4.0, sekä © OpenStreetMapin tekijät, ODbL.
- Tuvat, laavut ja tulipaikat: © OpenStreetMapin tekijät, ODbL. Varaus- ja vuokratuvat jätetään pois. Tarkista ajantasaiset tiedot ylläpitäjältä (useimmiten luontoon.fi).
- Perhosuositukset ovat lähtötaulukko yleisesti käytetyistä perhoista. Perhojen valokuvat: Wikimedia Commons, tekijät ja lisenssit sovelluksessa ja tiedostossa `docs/img/perhot/kuvat/lahteet.json`.
- Solmujen vaiheet: Orvis, Animated Knots ja Bass Pro. Animaatiot ovat tämän sovelluksen omia piirroksia (`docs/js/solmut.js`).
- Kirjastot ja fontit: Leaflet 1.9 (BSD 2-Clause), Inter ja Montserrat (SIL Open Font License 1.1, `docs/fonts/`).

MVMI on satelliittikuviin perustuva arvio, ja lupa-alueiden rajat on piirretty käsin. Viralliset rajat ovat eräluvat.fi:n kartoissa. Tiedot eivät korvaa virallisia karttoja, metsäpalo- tai jäätilannetietoja eikä omaa harkintaa.

## Kehitys

```
python3 tests/test_pipeline.py     # vesitilanne ja kohteet
python3 tests/test_encoding.py     # metsäkartan koodaus
python3 tests/test_cuts.py         # hakkuutunnistus
python3 tests/test_habitat.py      # elinympäristömalli
python3 tests/test_marjat.py       # marja- ja sienimalli
node tests/jcore.test.js           # laskentaydin
python3 tests/e2e.py docs /tmp/kuvat   # selaintesti (Playwright)
```

## Lisenssi

Sovellus ja sen lähdekoodi ovat julkisesti nähtävillä, mutta niitä ei saa käyttää kaupallisesti ilman tekijän lupaa.

- Sovelluksen koodi on lisensoitu [PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0) -lisenssillä ([LICENSE](LICENSE)). Sovellusta saa käyttää, muokata ja jakaa ei-kaupallisiin tarkoituksiin, esimerkiksi omaan käyttöön, harrastuksiin, opiskeluun ja tutkimukseen.
- Kaupallinen käyttö edellyttää tekijän (GitHub-käyttäjä [gitdaada](https://github.com/gitdaada)) etukäteen antamaa kirjallista lupaa. Kaupallista käyttöä on esimerkiksi:
  - sovelluksen tai siitä muokatun version julkaiseminen sovelluskaupassa (esim. App Store tai Google Play) tai muuten maksullisena, mainosrahoitteisena tai tilauspohjaisena
  - sovelluksen tai sen osien käyttäminen osana kaupallista tuotetta tai palvelua, kuten maksullista opastus-, erä- tai kalastusmatkailupalvelua
  - sovelluksen myyminen tai lisensoiminen eteenpäin.
- Luvasta, sen ehdoista ja mahdollisesta rojaltijaosta sovitaan tapauskohtaisesti erikseen kirjallisesti. Lupaa voi pyytää avaamalla [issuen](https://github.com/gitdaada/kaira/issues).
- Kopioissa ja muokatuissa versioissa on säilytettävä LICENSE-tiedosto ja sen alussa oleva `Required Notice` -rivi.
- Poikkeukset: `docs/vendor/leaflet/` on Leaflet-kirjasto, jota koskee sen oma BSD 2-Clause -lisenssi ([docs/vendor/leaflet/LICENSE](docs/vendor/leaflet/LICENSE)). Fontteja (`docs/fonts/`) koskee SIL Open Font License 1.1. Perhojen valokuvia (`docs/img/perhot/kuvat/`) koskevat niiden omat lisenssit.

Sovelluksen data (`docs/data/`, `docs/layers/`) on johdettu avoimista aineistoista, joiden lisenssit on lueteltu kohdassa *Tietolähteet ja lisenssit*. Kuvakkeet ja piirrokset (`docs/icons/`, `docs/img/perhot/*.svg`) ovat tekijän omia, eikä niitä saa käyttää kaupallisesti ilman lupaa.

Sama rajoitus näkyy sovelluksessa: aloitusnäkymässä ja kohdassa *Valikko → Käyttöehdot ja lisenssi*.

/*
 * Kaira: osiokohtainen ohje ja käyttöehdot sovelluksen sisällä.
 */
(function () {
  'use strict';

  var K = window.K, MK = window.MK, h = K.h, store = K.store;

  function sw(bg, cls) { return h('span', { class: 'sw' + (cls ? ' ' + cls : ''), style: bg ? { background: bg } : null }); }
  function ico(name) { return h('span', { class: 'help-ico' }, K.icon(name)); }
  function pin(cls, txt) { return h('span', { class: 'help-ico' }, h('span', { class: 'obs-pin obs-pin-static ' + cls, text: txt })); }
  function row(icon, title, text) { return h('div', { class: 'help-row' }, icon || h('span', { class: 'help-ico' }), h('div', null, h('b', { text: title }), text ? h('span', { text: text }) : null)); }
  function block(title, rows) { return [h('h3', { text: title })].concat(rows); }

  var C = MK.COLORS;
  var HELP = {
    yleiset: function () {
      return [].concat(
        block('Näytön painikkeet', [
          row(h('span', { class: 'help-ico help-txt', text: 'Osio' }), 'Osion vaihto (vasen yläkulma)', 'Valitse Metsästys, Kalastus tai Eränkäynti. Kartta, tasot ja alapalkin painikkeet vaihtuvat osion mukaan.'),
          row(h('span', { class: 'help-ico help-sos', text: 'SOS' }), 'Hätäkoordinaatit ja hälytys', 'Sijaintisi koordinaatteina hätäpuhelua (112) varten. GPS toimii ilman verkkoa. Hälytä apua avaa valmiin viestin sijainteineen tekstiviestinä tai WhatsAppissa asetuksissa valitsemillesi 1–3 henkilölle; lähetät sen itse.'),
          row(ico('drop'), 'Sääkortti', 'Lämpötila, tuuli, sade 2 tunnin sisällä ja aurinko sijainnissasi. Napauta: tuntiennuste ja animoitu sadetutka. Nuoli näyttää, mihin tuuli puhaltaa.'),
          row(ico('arrow'), 'Kompassi', 'Napauta: kartta kääntyy katsomasuuntaasi. Uudelleen napautus palauttaa pohjoisen ylös. Karttaa voi kääntää myös kahdella sormella.'),
          row(ico('area'), 'Oma sijainti', '1. napautus: sijainti päälle ja kartta seuraa. 2.: kartta seuraa uudelleen siirron jälkeen. 3.: sijainti pois.')
        ]),
        block('Alapalkki', [
          row(ico('layers'), 'Tasot', 'Pohjakartta (maastokartta, taustakartta tai ilmakuva), osion tasot, omat tasot ja etäisyysrenkaat.'),
          row(ico('tools'), 'Työkalut', 'Etäisyyden ja suunnan mittaus, alueen piirto, näkymän tallennus offline-käyttöön ja omien tasojen tuonti.'),
          row(h('span', { class: 'help-ico help-main' }, K.icon('pinPlus')), 'Keskimmäinen painike', 'Osion päätoiminto: metsästyksessä merkintä, kalastuksessa saalis, eränkäynnissä lähimmät kohteet.'),
          row(ico('info'), 'Osion tieto', 'Metsästyksessä lupa-alueet, kalastuksessa perhot ja solmut, eränkäynnissä reitit.'),
          row(ico('menu'), 'Valikko', 'Ohje, offline-alueet, asetukset, tietolähteet ja käyttöehdot.')
        ]),
        block('Suunnistus ja offline', [
          row(h('span', { class: 'help-ico' }, sw('#FF6B35')), 'Napauta karttaa', 'Näet kohdan koordinaatit ja etäisyyden sinusta. Suunnista tänne piirtää oranssin katkoviivan ja näyttää oikeassa yläkulmassa matkan ja suunnan.'),
          row(ico('draw'), 'Piirrä alue', 'Työkalut → Piirrä alue. Napauta kulmapisteet tai paina Sormi ja vedä reuna sormella (Sormi-tilassa kartta ei liiku). Valmis tallentaa alueen omaksi tasoksi, jonka voi tallentaa offline-käyttöön.'),
          row(h('span', { class: 'help-ico' }, K.sv ? (function () { var v = K.sv('svg', { viewBox: '0 0 24 24', width: 22, height: 22 }); K.sv('path', { d: 'M13 2 4 14h6l-1 8 9-12h-6z', fill: '#E5484D', stroke: '#10160f', 'stroke-width': 1.4 }, v); return v; })() : null), 'Salamat', 'Viimeisen tunnin salamat 20 km säteellä: punainen alle 15 min, oranssi alle 30 min, keltainen alle tunti sitten. Määrä ja lähin näkyvät sääkortissa.'),
          row(pin('obs-lumi', '23'), 'Lumensyvyys', 'Sääasemien lumensyvyys senttimetreinä 20 km säteellä. Jos lähellä ei ole asemaa, sääkortissa näkyy lähin enintään 50 km päästä.'),
          row(ico('offline'), 'Kartat ilman verkkoa', 'Lisää Maanmittauslaitoksen ilmainen API-avain asetuksiin. Tallenna alue kotona Wi-Fissä: lupa-alue, kalastusalue, reitti tai nykyinen näkymä.'),
          row(ico('shield'), 'Tietosi pysyvät puhelimessa', 'Merkinnät, saaliit, reitit ja tasot eivät lähde minnekään. Säähän lähtee vain noin kilometrin tarkkuuteen pyöristetty sijainti.')
        ]));
    },
    metsastys: function () {
      return [].concat(
        block('Painikkeet', [
          row(h('span', { class: 'help-ico help-main' }, K.icon('pinPlus')), 'Merkitse', 'Kirjaa havainto, koiran seisonta tai saalis (laji, määrä, sukupuoli) sijaintiisi tai kartalta valittuun kohtaan.'),
          row(ico('area'), 'Lupa-alue', 'Valitse Metsähallituksen lupa-alue. Tallenna se offline-käyttöön ennen jahtia: metsätieto ja maastokartta.'),
          row(ico('layers'), 'Tasot', 'Metsän ikä, suojelualueet, uudet hakkuut, kanalintujen elinympäristö (metso, teeri, pyy), tuuliviuhka ja merkinnät.')
        ]),
        block('Kartan värit', [
          row(h('span', { class: 'help-ico' }, sw(MK.cssRGB(C.treeless))), 'Punainen', 'Puuton: hakkuuaukko tai avosuo.'),
          row(h('span', { class: 'help-ico' }, sw('linear-gradient(90deg,' + MK.cssRGB(C.young) + ',' + MK.cssRGB(C.middle) + ')')), 'Vihreä', 'Metsä alle 80 vuotta. Mitä vihreämpi, sitä nuorempi. Rajan voi muuttaa asetuksista.'),
          row(h('span', { class: 'help-ico' }, sw(MK.cssRGB(C.old))), 'Sininen', 'Vanha metsä, vähintään 80 vuotta.'),
          row(h('span', { class: 'help-ico' }, sw('repeating-linear-gradient(135deg,' + MK.cssRGB(C.hatch) + ' 0 2px,' + MK.cssRGB(MK.ageColor(5, 80)) + ' 2px 7px)')), 'Vinoviivat', 'Taimikko, alle 7 m.'),
          row(h('span', { class: 'help-ico' }, sw(null, 'sw-dash')), 'Keltainen katkoviiva', 'Luonnonsuojelualue.'),
          row(h('span', { class: 'help-ico' }, sw(null, 'sw-line')), 'Musta viiva', 'Lupa-alueen raja (käsin piirretty, virallinen raja eräluvat.fi:ssä).'),
          row(h('span', { class: 'help-ico' }, sw(null, 'sw-cut')), 'Punainen reunus', 'Uusi hakkuuaukko metsätiedon jälkeen (latvusmalli).'),
          row(h('span', { class: 'help-ico' }, sw(null, 'sw-cut-dash')), 'Punainen katkoviiva', 'Hakkuuilmoitus: hakkuu ei välttämättä ole vielä tehty.'),
          row(h('span', { class: 'help-ico' }, sw(null, 'sw-hab2')), 'Oranssi alue', 'Valitun kanalintulajin elinympäristö: vahva = hyvä, haalea = sopiva.'),
          row(h('span', { class: 'help-ico' }, sw(null, 'sw-wind')), 'Violetti viuhka', 'Tuuliviuhka: hajusi kulku sijainnistasi myötätuuleen. Mitä heikompi tuuli, sitä leveämpi viuhka.'),
          row(h('span', { class: 'help-ico' }, sw('repeating-linear-gradient(135deg,#F2C200 0 4px,transparent 4px 8px)')), 'Keltainen, oranssi tai punainen katkoviiva-alue', 'Voimassa oleva maastopalovaroitus (Ilmatieteen laitos): avotulen teko on kielletty. Sääkortissa näkyy Maastopalovaroitus, kun olet varoitusalueella. Kaikki varoitukset: Valikko → Maastopalovaroitukset.'),
          row(h('span', { class: 'help-ico' }, sw('linear-gradient(90deg,#7b2cbf,#e03131)')), 'Violetti ja punainen alue', 'Tasot → Marjat: mustikan (violetti) ja puolukan (punainen) kasvupaikka-arvio, vahva = hyvä, haalea = sopiva. Marjat ovat metsäkanalintujen tärkeää ravintoa. Napautus näyttää marjatiedon metsätiedon kortissa.'),
          row(pin('obs-havainto', 'M'), 'Omat merkinnät', 'Sininen = havainto, keltainen = seisonta, punainen = saalis. Kirjain kertoo lajin.')
        ]),
        block('Vinkit', [
          row(null, 'Napauta karttaa', 'Näet ruudun arvioidun iän ja pituuden, suojelualueen, hakkuut ja elinympäristön.'),
          row(null, 'Koiran hajuolosuhteet', 'Näkyvät sääkortissa. Sääpaneelista löydät 12 tunnin arvion ja parhaan valoisan ajan.'),
          row(null, 'Oma tuulihavainto', 'Sääpaneelissa voit asettaa tuulen suunnan itse (savu, lumi, heinä).'),
          row(null, 'Metsäkartan merkinnät', 'Lataa ne Metsäkartasta CSV-tiedostona ja tuo: Valikko → Havainnot ja saalis → Tuo Metsäkartan merkinnät.'),
          row(null, 'Saalisilmoitus', 'Kauden saalisyhteenvedon voi kopioida. Ilmoitus tehdään eräluvat.fi-palvelussa.'),
          row(null, 'Uusi metsästysalue', 'Piirrä alue ja valitse Lähetä analysoitavaksi. GitHub avautuu valmiiksi täytettynä; tallennuksen jälkeen alue näkyy Lupa-alue-listassa metsätietoineen (yleensä alle tunnissa). Alue on julkinen, merkinnät eivät.')
        ]));
    },
    kalastus: function () {
      return [].concat(
        block('Painikkeet', [
          row(h('span', { class: 'help-ico help-main' }, K.icon('fishPlus')), 'Saalis', 'Kirjaa saalis: laji, pituus, paino, vapautettu ja perho tai viehe. Sijainti GPS:stä tai kartalta.'),
          row(ico('fly'), 'Perhot', 'Valitse kalalaji ja hyönteinen ja vastaa kysymyksiin. Saat perhon kehitysvaiheen mukaan: pohjalla, nousussa, pinturi tai aikuinen. Lohelle suositus veden tilan mukaan.'),
          row(ico('fly'), 'Solmut', 'Perhot-paneelin Solmut-välilehdellä animoidut ohjeet: verisolmu ja parannettu clinch-solmu. Toimivat ilman verkkoa.'),
          row(ico('layers'), 'Tasot', 'Jokien vesitilanne, kalastusalueet, järvien syvyysalueet, jäänpaksuusmittaukset ja saaliit kartalla.'),
          row(ico('drop'), 'Vesistöt', 'Valikko → Vesistöt tai napauta jokea: virtaama, vedenkorkeus ja veden lämpötila 30 vuorokauden käyrinä. Vihreä alue on tavallinen vaihteluväli tähän aikaan vuodesta.'),
          row(ico('drop'), 'Jäänpaksuus', 'Valikko → Jäänpaksuus. Syken mittaukset kalastusalueilla ja 5 km säteellä sijainnistasi: paksuus, mittauspäivä ja etäisyys.')
        ]),
        block('Kartan värit', [
          row(h('span', { class: 'help-ico' }, sw('#e5484d', 'sw-water')), 'Punainen joki', 'Alhainen vesi verrattuna saman vuodenajan tavalliseen.'),
          row(h('span', { class: 'help-ico' }, sw('#2fb35a', 'sw-water')), 'Vihreä joki', 'Normaali vesitilanne.'),
          row(h('span', { class: 'help-ico' }, sw('#0b3d91', 'sw-water')), 'Tummansininen joki', 'Korkea vesi.'),
          row(h('span', { class: 'help-ico' }, sw('#8a9aa0', 'sw-water')), 'Harmaa katkoviiva', 'Ei tietoa.'),
          row(h('span', { class: 'help-ico' }, h('span', { class: 'dot big', style: { background: '#2b8cbe' } })), 'Tummansininen pallo', 'Koski (OpenStreetMap). Napauta nähdäksesi nimen.'),
          row(h('span', { class: 'help-ico' }, h('span', { class: 'dot big', style: { background: '#7fc8e8' } })), 'Vaaleansininen pallo', 'Suvanto (OpenStreetMap).'),
          row(pin('obs-kala', 'Ha'), 'Saalismerkki', 'Lajin lyhenne, esim. Ha = harjus, Lo = lohi, Ta = taimen.'),
          row(h('span', { class: 'help-ico' }, sw('linear-gradient(90deg,#cfeaf7,#69b3e0,#123f78)')), 'Sininen järvi', 'Syvyysalue: mitä tummempi, sitä syvempi. Vain Syken mittaamat järvet. Napauta järveä nähdäksesi syvyysvälin.'),
          row(pin('obs-jaa', '25'), 'Jäämerkki', 'Mitattu jäänpaksuus senttimetreinä. Haalea merkki = mittaus yli viikon vanha.')
        ]),
        block('Vinkit', [
          row(null, 'Napauta jokea', 'Näet mitatun virtaaman tai vedenkorkeuden ja tavallisen vaihteluvälin, tai sademäärään perustuvan arvion.'),
          row(null, 'Uusi kalastusalue', 'Työkalut → Piirrä alue → Lähetä analysoitavaksi. Analyysi hakee alueen joet, vesitilanteen, kosket, suvannot ja mitattujen järvien syvyydet. Valmis alue näkyy Tasot-paneelissa; tallenna se offline-käyttöön ennen reissua. Alue on julkinen, saaliit eivät.'),
          row(null, 'Jäällä liikkuminen', 'Jäämittaus on yhdestä pisteestä. Tarkista jää aina itse tuuralla: virtapaikat, salmet, jokisuut ja kaislikot voivat olla heikkoja.'),
          row(null, 'Perhojen kuvat', 'Kuvat tallentuvat puhelimeen, kun avaat osion verkossa, joten suositus toimii myös joella ilman kenttää.')
        ]));
    },
    erankaynti: function () {
      function k(t) { var s = h('span', { class: 'help-ico' }); s.appendChild(K.kohdeIcon ? K.kohdeIcon(t) : K.icon('hut')); return s; }
      return [].concat(
        block('Painikkeet', [
          row(h('span', { class: 'help-ico help-main' }, K.icon('hut')), 'Kohteet', 'Lähimmät autiotuvat, laavut ja tulipaikat etäisyyden mukaan. Suodata tyypin mukaan.'),
          row(ico('route'), 'Reitit', 'Tuo GPX-reitti (esim. retkikartta.fi tai urheilukello). Näytä, tallenna offline tai suunnista reitin alkuun.'),
          row(ico('layers'), 'Tasot', 'Valitse näytettävät kohdetyypit ja reitit.')
        ]),
        block('Kartan merkit', [
          row(h('span', { class: 'help-ico' }, sw('repeating-linear-gradient(135deg,#F2C200 0 4px,transparent 4px 8px)')), 'Keltainen, oranssi tai punainen katkoviiva-alue', 'Voimassa oleva maastopalovaroitus (Ilmatieteen laitos): avotulen teko on kielletty. Sääkortissa näkyy Maastopalovaroitus, kun olet varoitusalueella. Kaikki varoitukset: Valikko → Maastopalovaroitukset.'),
          row(h('span', { class: 'help-ico' }, sw('linear-gradient(90deg,#7b2cbf,#e03131,#f59f00,#8d6e63,#5c3d2e)')), 'Marjat ja sienet', 'Tasot → Marjat ja sienet: mustikan (violetti), puolukan (punainen), kantarellin (keltainen), suppilovahveron (harmaanruskea) ja herkkutatin (tummanruskea) kasvupaikka-arvio. Vahva väri = hyvä, haalea = sopiva. Vain piirretyillä alueilla ja lupa-alueilla. Arvio metsätiedosta, ei satoennuste.'),
          row(k('autiotupa'), 'Ruskea talo', 'Autiotupa.'),
          row(k('kammi'), 'Vihreä talo', 'Autiokammi.'),
          row(k('paivatupa'), 'Sininen talo', 'Päivätupa, tarkoitettu päiväkäyttöön.'),
          row(k('kota'), 'Sininen kolmio', 'Kota.'),
          row(k('laavu'), 'Turkoosi laavu', 'Laavu. Näkyy, kun karttaa on lähennetty.'),
          row(k('tulipaikka'), 'Punainen liekki', 'Tulipaikka. Näkyy lähimmästä. Tarkista metsäpalovaroitus ennen tulentekoa.'),
          row(h('span', { class: 'help-ico' }, sw('#e11d48', 'sw-water')), 'Punainen viiva', 'Tuomasi GPX-reitti.')
        ]),
        block('Vinkit', [
          row(null, 'Kohteen kompassi', 'Napauta kohdetta. Pidä puhelinta vaakatasossa: kun nuoli osoittaa ylös, kohde on edessäsi.'),
          row(null, 'Suunnistus', 'Suunnista tänne jättää suunnan ja katkoviivan näkyviin, vaikka sulkisit paneelin.'),
          row(null, 'Etäisyysrenkaat', 'Tasot → Apuvälineet: 1, 5 ja 20 km sijainnistasi.'),
          row(null, 'Tietojen tarkistus', 'Kohteet ovat OpenStreetMapista. Tarkista tupien kunto ja säännöt ylläpitäjältä (useimmiten luontoon.fi).')
        ]));
    }
  };
  var TABS = [['metsastys', 'Metsästys'], ['kalastus', 'Kalastus'], ['erankaynti', 'Eränkäynti'], ['yleiset', 'Yleiset']];
  var tab = null;

  K.openHelp = function (which) {
    tab = which || K.section || 'yleiset';
    K.openSheet('help', 'Ohje', function (body) {
      body.appendChild(K.seg(TABS, tab, function (v) { tab = v; K.renderSheet(); $('sheetBody').scrollTop = 0; }, { cls: 'seg-tabs', label: 'Ohjeen osio' }));
      HELP[tab]().forEach(function (el) { body.appendChild(el); });
      if (tab !== 'yleiset') body.appendChild(h('p', { class: 'muted small' }, 'Kaikkien osioiden yhteiset toiminnot: ', h('a', { href: '#', onclick: function (e) { e.preventDefault(); tab = 'yleiset'; K.renderSheet(); $('sheetBody').scrollTop = 0; }, text: 'Yleiset' }), '.'));
    });
  };
  var $ = K.$;

  // --- Käyttöehdot ---
  K.openTerms = function () {
    K.openSheet('terms', 'Käyttöehdot ja lisenssi', function (body) {
      body.appendChild(h('div', { class: 'notice' }, h('b', { text: 'Ei kaupalliseen käyttöön ilman tekijän lupaa. ' }),
        'Kairaa ja sen lähdekoodia saa käyttää, muokata ja jakaa ei-kaupallisiin tarkoituksiin, kuten omaan käyttöön, harrastuksiin, opiskeluun ja tutkimukseen.'));
      body.appendChild(h('h3', { text: 'Kaupallinen käyttö' }));
      body.appendChild(h('p', { class: 'small', text: 'Kaupallinen käyttö edellyttää tekijän (GitHub-käyttäjä gitdaada) etukäteen antamaa kirjallista lupaa. Kaupallista käyttöä on esimerkiksi:' }));
      body.appendChild(h('ul', { class: 'feature-list small' },
        h('li', { text: 'sovelluksen tai siitä muokatun version julkaiseminen sovelluskaupassa (esim. App Store tai Google Play) tai muuten maksullisena, mainosrahoitteisena tai tilauspohjaisena' }),
        h('li', { text: 'sovelluksen tai sen osien käyttäminen osana kaupallista tuotetta tai palvelua, kuten maksullista opastus-, erä- tai kalastusmatkailupalvelua' }),
        h('li', { text: 'sovelluksen myyminen tai lisensoiminen eteenpäin' })));
      body.appendChild(h('p', { class: 'small' }, 'Luvasta, sen ehdoista ja mahdollisesta rojaltijaosta sovitaan tapauskohtaisesti kirjallisesti. Lupaa voi pyytää ',
        h('a', { href: 'https://github.com/gitdaada/kaira/issues', target: '_blank', rel: 'noopener noreferrer', text: 'GitHubissa' }), '.'));
      body.appendChild(h('h3', { text: 'Lisenssi' }));
      body.appendChild(h('p', { class: 'small', text: 'Koodi: PolyForm Noncommercial 1.0.0, © 2026 gitdaada. Kopioissa ja muokatuissa versioissa on säilytettävä LICENSE-tiedosto ja sen Required Notice -rivi. Leaflet: BSD 2-Clause. Fontit Inter ja Montserrat: SIL Open Font License 1.1. Kuvakkeet ja piirrokset ovat tekijän omia. Aineistojen lisenssit: Valikko → Tietolähteet ja tietosuoja.' }));
      body.appendChild(h('h3', { text: 'Vastuu' }));
      body.appendChild(h('p', { class: 'small', text: 'Tiedot ovat suuntaa antavia arvioita avoimista aineistoista. Ne eivät korvaa virallisia karttoja, lupa-alueiden virallisia rajoja (eräluvat.fi), metsäpalo- tai jäätilannetietoja eikä omaa harkintaa. Sovellus on testikäytössä, ja käyttäjä vastaa omasta turvallisuudestaan maastossa.' }));
      body.appendChild(h('p', { class: 'small' }, 'Lähdekoodi: ', h('a', { href: 'https://github.com/gitdaada/kaira', target: '_blank', rel: 'noopener noreferrer', text: 'github.com/gitdaada/kaira' }), ' · versio ' + K.VERSION));
    });
  };

  K.on('menutop', function (list, sec) {
    var def = null;
    K.SECTIONS.forEach(function (s) { if (s.id === sec) def = s; });
    list.appendChild(K.menuItem('info', 'Ohje' + (def ? ': ' + def.name : ''), 'Painikkeet, kartan merkit ja vinkit', function () { K.openHelp(sec); }));
  });
  K.on('menu', function (list) {
    list.appendChild(K.menuItem('shield', 'Käyttöehdot ja lisenssi', 'Ei kaupalliseen käyttöön ilman tekijän lupaa', K.openTerms));
  });

  // Ensimmäisellä käyntikerralla osiossa tarjotaan ohjetta.
  K.on('section', function (sec) {
    var seen = store.get('helpSeen', {}) || {};
    if (seen[sec]) return;
    var def = null;
    K.SECTIONS.forEach(function (s) { if (s.id === sec) def = s; });
    // Näytetään, kun paneeli on suljettu ja käyttäjä on yhä tässä osiossa.
    K.tip('ohje-' + sec, 'Ensimmäistä kertaa ' + (def ? def.name.toLowerCase() + 'osiossa' : 'täällä') + '? Katso lyhyt ohje.',
      { label: 'Ohje', fn: function () { K.openHelp(sec); } },
      { cond: function () { if (K.section !== sec) return false; seen[sec] = true; store.set('helpSeen', seen); return true; } });
  });

  // Aloitusnäkymän alalaitaan käyttöehtojen maininta.
  K.on('start', function () {
    var inner = document.querySelector('.start-inner');
    if (!inner) return;
    inner.appendChild(h('p', { class: 'start-terms' }, '© gitdaada · Ei kaupalliseen käyttöön ilman tekijän lupaa. ',
      h('button', { type: 'button', class: 'link-btn', text: 'Käyttöehdot', onclick: function () { K.openTerms(); } })));
  });
})();

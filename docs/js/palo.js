/*
 * Kaira: maastopalovaroitukset metsästys- ja eränkäyntiosiossa.
 * Lähde: Ilmatieteen laitoksen varoitukset (CAP), jotka GitHub Actions hakee tunnin välein tiedostoon
 * data/maastopalo.json. Puhelin hakee vain tämän tiedoston sovelluksen omalta palvelimelta, eikä sijaintia
 * lähetetä minnekään. Voimassaolo lasketaan puhelimessa varoituksen alku- ja loppuajasta.
 */
(function () {
  'use strict';

  var K = window.K, h = K.h, $ = K.$, settings = K.settings, map = K.map;
  var SECS = { metsastys: true, erankaynti: true };
  var TASO = {
    keltainen: { nimi: 'Keltainen', color: '#F2C200' },
    oranssi: { nimi: 'Oranssi', color: '#FF7A1A' },
    punainen: { nimi: 'Punainen', color: '#E5484D' }
  };
  var RANK = { keltainen: 1, oranssi: 2, punainen: 3 };
  var REFRESH_MS = 30 * 60000;
  var RULE = 'Maastopalovaroituksen aikana kaikenlaisen avotulen teko on kielletty, myös nuotiopaikoilla. Avotuleksi ei katsota maapohjasta eristettyjä tulisijoja, kuten tuulelta suojattuja grillejä ja huuvalla varustettuja grillikatoksia. Kertakäyttögrilli on avotuli. Tarkista paikallinen ohje pelastuslaitokselta.';

  var S = { data: null, fetched: 0, loading: null };
  map.createPane('firePane');
  map.getPane('firePane').style.zIndex = 390;
  map.getPane('firePane').style.pointerEvents = 'none';
  var layer = L.layerGroup();

  function active() { return !!SECS[K.section] && settings.showFire; }

  /** Tarkistettu varoitus tai null. Polygonit [[lon, lat], ...]. */
  function sanitize(w) {
    if (!w || !TASO[w.taso]) return null;
    var end = Date.parse(w.paattyy), start = w.alkaa ? Date.parse(w.alkaa) : 0;
    if (!isFinite(end) || !isFinite(start)) return null;
    var polys = (Array.isArray(w.polygonit) ? w.polygonit : []).slice(0, 20).map(function (r) {
      return (Array.isArray(r) ? r : []).filter(function (c) {
        return Array.isArray(c) && isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
      }).map(function (c) { return [Number(c[0]), Number(c[1])]; });
    }).filter(function (r) { return r.length >= 4; });
    if (!polys.length) return null;
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    polys.forEach(function (r) { r.forEach(function (c) { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); }); });
    var str = function (v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; };
    return { taso: w.taso, alue: str(w.alue, 120) || 'Varoitusalue', otsikko: str(w.otsikko, 160), start: start, end: end, polys: polys, bbox: b };
  }
  function load(force) {
    if (S.loading) return S.loading;
    if (!force && S.data && Date.now() - S.fetched < REFRESH_MS) return Promise.resolve(S.data);
    S.loading = K.fetchJSON('data/maastopalo.json', { cache: 'no-cache' }).then(function (j) {
      S.data = { paivitetty: j.paivitetty || null, list: (j.varoitukset || []).slice(0, 300).map(sanitize).filter(Boolean) };
      S.fetched = Date.now();
      return S.data;
    }).catch(function () { return S.data; }).then(function (d) { S.loading = null; render(); return d; });
    return S.loading;
  }

  function nowList() { var t = Date.now(); return S.data ? S.data.list.filter(function (w) { return w.start <= t && t < w.end; }) : []; }
  function upcoming() { var t = Date.now(); return S.data ? S.data.list.filter(function (w) { return w.start > t && w.start - t < 48 * 3600000; }) : []; }
  function inRing(x, y, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / ((r[j][1] - r[i][1]) || 1e-12) + r[i][0]) c = !c;
    }
    return c;
  }
  /** Voimassa olevat varoitukset pisteessä, vakavin ensin. */
  function at(lat, lon, list) {
    return (list || nowList()).filter(function (w) {
      return lon >= w.bbox[0] && lon <= w.bbox[2] && lat >= w.bbox[1] && lat <= w.bbox[3] && w.polys.some(function (r) { return inRing(lon, lat, r); });
    }).sort(function (a, b) { return RANK[b.taso] - RANK[a.taso]; });
  }
  function when(w) {
    return (w.start > Date.now() ? 'alkaa ' + K.fmtWhen(w.start) + ', ' : '') + 'voimassa ' + K.fmtWhen(w.end) + ' asti';
  }

  /** Tietokorttiin ja kohteen paneeliin lisättävä huomautus, jos piste on varoitusalueella (vain M ja E). */
  K.fireNotice = function (ll) {
    if (!active() || !ll) return null;
    var ws = at(ll.lat, ll.lng);
    if (!ws.length) return null;
    var w = ws[0];
    return h('div', { class: 'fire-notice fire-' + w.taso },
      h('b', { text: TASO[w.taso].nimi + ' maastopalovaroitus: avotulen teko kielletty' }),
      h('span', { text: w.alue + ' · ' + when(w) + '.' }));
  };
  K.fireAt = function (lat, lon) { return at(lat, lon); };

  function render() {
    layer.clearLayers();
    var on = active() && S.data;
    if (!on) { if (map.hasLayer(layer)) map.removeLayer(layer); updateChip(); return; }
    if (!map.hasLayer(layer)) layer.addTo(map);
    nowList().sort(function (a, b) { return RANK[a.taso] - RANK[b.taso]; }).forEach(function (w) {
      var c = TASO[w.taso].color;
      L.polygon(w.polys.map(function (r) { return r.map(function (p) { return [p[1], p[0]]; }); }),
        { pane: 'firePane', interactive: false, color: c, weight: 2.5, opacity: 0.95, dashArray: '9 6', fillColor: c, fillOpacity: w.taso === 'keltainen' ? 0.12 : 0.18 }).addTo(layer);
    });
    updateChip();
  }

  // Sääkortti: varoitusrivi, kun sijainti (tai ilman sijaintia kartan keskikohta) on voimassa olevalla varoitusalueella.
  // Kortti piirretään uudelleen vain, kun tilanne muuttuu.
  var lastKey = null;
  function hereList() { if (!active() || !S.data) return []; var p = K.wherePoint(); return at(p.lat, p.lon); }
  function updateChip() {
    var ws = hereList(), key = ws.length ? ws[0].taso + '|' + ws[0].alue : '';
    if (key === lastKey) return;
    lastKey = key;
    if (K.renderWxCard) K.renderWxCard();
  }
  K.on('wxcard', function (card) {
    var ws = hereList();
    if (!ws.length) return;
    card.appendChild(h('div', { class: 'wx-line wx-fire fire-' + ws[0].taso },
      h('i', { class: 'dot', style: { background: TASO[ws[0].taso].color } }), h('span', { text: 'Maastopalovaroitus' })));
  });
  K.on('wxsheet', function (body) {
    if (!active()) return;
    var ws = hereList(), p = K.wherePoint();
    body.appendChild(h('h3', { text: 'Maastopalovaroitus' }));
    var n = ws.length ? K.fireNotice(L.latLng(p.lat, p.lon)) : null;
    body.appendChild(n || h('p', { class: 'muted', text: S.data ? 'Ei voimassa olevaa varoitusta ' + (p.src === 'gps' ? 'sijainnissasi.' : 'kartan keskellä.') : 'Varoituksia ei ole vielä ladattu.' }));
    body.appendChild(h('button', { type: 'button', class: 'btn btn-sm', text: 'Kaikki maastopalovaroitukset', onclick: openSheet }));
  });

  function row(w) {
    return h('div', { class: 'fire-row' },
      h('span', { class: 'sw', style: { background: TASO[w.taso].color } }),
      h('div', null, h('b', { text: w.alue }), h('small', { text: TASO[w.taso].nimi + ' · ' + when(w) })));
  }
  function renderSheet(body) {
    if (!S.data) { body.appendChild(h('p', { class: 'muted', text: 'Ladataan varoituksia…' })); load(true).then(function () { if (K.sheetName() === 'palo') K.renderSheet(); }); return; }
    var p = K.wherePoint(), here = at(p.lat, p.lon), now = nowList(), next = upcoming();
    body.appendChild(h('div', { class: 'notice notice-warn', text: RULE }));
    body.appendChild(h('h3', { text: p.src === 'gps' ? 'Sijainnissasi' : 'Kartan keskellä' }));
    body.appendChild(here.length ? h('div', null, here.map(row)) : h('p', { class: 'muted', text: 'Ei voimassa olevaa maastopalovaroitusta. Älä silti tee avotulta, jos maasto on kuiva.' }));
    body.appendChild(h('h3', { text: 'Voimassa nyt (' + now.length + ')' }));
    body.appendChild(now.length ? h('div', null, now.map(row)) : h('p', { class: 'muted', text: 'Suomessa ei ole voimassa olevia maastopalovaroituksia.' }));
    if (next.length) { body.appendChild(h('h3', { text: 'Alkamassa 48 tunnin sisällä' })); body.appendChild(h('div', null, next.map(row))); }
    var upd = S.data.paivitetty ? K.fmtDate(Date.parse(S.data.paivitetty)) + ' klo ' + K.hm(Date.parse(S.data.paivitetty)) : '–';
    body.appendChild(h('p', { class: 'muted small', text: 'Lähde: Ilmatieteen laitos. Varoitukset tarkistetaan tunnin välein; viimeisin muutos ' + upd +
      '. Haettu puhelimeen klo ' + K.hm(S.fetched) + '. Ilman verkkoa näytetään viimeksi haetut varoitukset. Ajantasaiset varoitukset: ilmatieteenlaitos.fi/varoitukset.' }));
  }
  function openSheet() { K.openSheet('palo', 'Maastopalovaroitukset', renderSheet); load(); }
  K.openFire = openSheet;

  function legend() {
    var box = h('div', { class: 'water-legend' });
    ['keltainen', 'oranssi', 'punainen'].forEach(function (k) { box.appendChild(h('span', { class: 'li' }, h('span', { class: 'sw', style: { background: TASO[k].color } }), TASO[k].nimi)); });
    return box;
  }
  K.on('layers', function (body, sec) {
    if (!SECS[sec]) return;
    body.appendChild(h('h3', { text: 'Maastopalovaroitukset' }));
    var n = nowList().length;
    body.appendChild(K.toggleRow('Voimassa olevat varoitukset', S.data ? (n ? n + ' varoitusaluetta nyt · Ilmatieteen laitos' : 'Ei voimassa olevia varoituksia · Ilmatieteen laitos') : 'Ilmatieteen laitos, tarkistetaan tunnin välein', settings.showFire, function (v) {
      settings.showFire = v; K.saveSettings(); if (v) load(); render(); K.renderSheet();
    }));
    if (settings.showFire) body.appendChild(legend());
  });
  K.on('menu', function (list, sec) {
    if (!SECS[sec]) return;
    var n = nowList().length;
    list.appendChild(K.menuItem('flame', 'Maastopalovaroitukset', S.data ? (n ? n + ' varoitusaluetta voimassa' : 'Ei voimassa olevia varoituksia') : 'Ilmatieteen laitos', openSheet));
  });
  K.on('section', function () { if (active()) load(); render(); });
  K.on('visible', function () { if (active()) load(); });
  var tick = 0;
  K.on('minute', function () { if (++tick % 5 === 0 && active()) { if (Date.now() - S.fetched > REFRESH_MS) load(true); else render(); } });
  K.on('pos', function () { if (active() && S.data) updateChip(); });
  map.on('moveend', function () { if (active() && S.data && !(K.pos && Date.now() - K.pos.t < 30 * 60000)) updateChip(); });

  K.palo = { S: S, at: at, nowList: nowList, load: load };
})();

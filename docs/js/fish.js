/*
 * Kaira / Kalastus: perhosuositus hyönteisen kehitysvaiheen mukaan, animoidut solmuohjeet,
 * jokien vesitilanne, kalastusalueiden tasot ja saaliskirjaus. Perhot, solmut ja vesitilanne ovat
 * Joki-oppaasta (gitdaada/joki-opas). Saaliit tallentuvat vain tähän laitteeseen.
 */
(function () {
  'use strict';

  var K = window.K, JG = window.JG, h = K.h, settings = K.settings, map = K.map, store = K.store;
  var SEC = 'kalastus';
  function active() { return K.section === SEC; }
  var S = { flies: null, fly: { tab: 'perhot', species: 'harjus', group: 'kaikki', surface: null, flying: null, signs: null, water: null },
            knot: null, water: null, layers: {}, layerIndex: null, prefetched: false };

  // ---------------------------------------------------------------------------
  // Perhot ja solmut
  // ---------------------------------------------------------------------------

  function loadFlies() {
    if (S.flies) return Promise.resolve(S.flies);
    return K.fetchJSON('data/perhot.json').then(function (d) { S.flies = d; return d; });
  }
  function yesNo(label, key) {
    return h('div', { class: 'field' }, h('span', { class: 'label', text: label }),
      K.seg([[true, 'Kyllä'], [false, 'Ei']], S.fly[key], function (v) { S.fly[key] = v; K.renderSheet(); }));
  }
  function flyCard(p, title, lines, badges) {
    var right = h('div', null, h('div', { class: 't', text: title }));
    (badges || []).forEach(function (b) { if (b) right.appendChild(h('span', { class: 'badge', text: b })); });
    lines.forEach(function (l) { if (l) right.appendChild(h('div', { class: 'small', text: l })); });
    if (p.kuvassa) right.appendChild(h('div', { class: 'credit', text: 'Kuvassa: ' + p.kuvassa }));
    if (/\.svg$/.test(p.kuva || '')) right.appendChild(h('div', { class: 'credit', text: 'Piirros: vapaata kuvaa ei löytynyt.' }));
    if (p.kuvaaja || p.lisenssi) {
      var credit = h('div', { class: 'credit' }, 'Kuva: ' + (p.kuvaaja || 'tuntematon') + ', ' + (p.lisenssi || '') + ', pienennetty, ');
      if (p.lahde && /^https:\/\/commons\.wikimedia\.org\//.test(p.lahde)) credit.appendChild(h('a', { href: p.lahde, target: '_blank', rel: 'noopener noreferrer', text: 'lähde' }));
      right.appendChild(credit);
    }
    var safeImg = /^[a-z0-9_\/.-]+$/i.test(p.kuva || '') && !/\.\./.test(p.kuva) ? 'img/perhot/' + p.kuva : '';
    return h('div', { class: 'fly-card' }, safeImg ? h('img', { src: safeImg, alt: title, loading: 'lazy' }) : null, right);
  }
  function renderKnots(body) {
    var list = window.JGKnots ? window.JGKnots.list : [];
    if (!list.length) { body.appendChild(h('p', { class: 'muted', text: 'Solmuanimaatioita ei voitu ladata.' })); return; }
    if (!S.knot) S.knot = list[0].id;
    body.appendChild(h('h3', { text: 'Solmu' }));
    body.appendChild(K.seg(list.map(function (k) { return [k.id, k.nimi]; }), S.knot, function (v) { S.knot = v; K.renderSheet(); }));
    var k = list.filter(function (x) { return x.id === S.knot; })[0];
    body.appendChild(h('p', { class: 'muted small', text: k.kaytto + ' (' + k.en + ').' }));
    body.appendChild(window.JGKnots.player(k.id));
    body.appendChild(h('h3', { text: 'Vinkit' }));
    body.appendChild(h('ul', { class: 'small knot-tips' }, k.tiedot.map(function (t) { return h('li', { text: t }); })));
    body.appendChild(h('p', { class: 'muted small', text: 'Vaiheet: Orvis, Animated Knots ja Bass Pro. Animaatiot ovat omia piirroksia ja toimivat ilman verkkoa.' }));
  }
  function renderFlies(body) {
    var d = S.flies, f = S.fly;
    body.appendChild(K.seg([['perhot', 'Perhot'], ['solmut', 'Solmut']], f.tab, function (v) { f.tab = v; K.renderSheet(); }, { label: 'Näkymä' }));
    if (f.tab === 'solmut') { renderKnots(body); return; }
    if (!d) { body.appendChild(h('p', { class: 'muted', text: 'Ladataan…' })); return; }
    body.appendChild(h('p', { class: 'warn-text small', text: d.lampoteksti }));
    body.appendChild(h('h3', { text: 'Kalalaji' }));
    body.appendChild(K.seg(Object.keys(d.lajit).map(function (k) { return [k, d.lajit[k].nimi]; }), f.species, function (v) { f.species = v; K.renderSheet(); }, { cls: 'seg-wrap', label: 'Kalalaji' }));
    var sp = d.lajit[f.species];
    if (!sp) return;
    if (sp.lohi) {
      body.appendChild(h('p', { class: 'small', text: d.lohi.huom }));
      body.appendChild(h('h3', { text: 'Veden tila' }));
      body.appendChild(K.seg(Object.keys(d.lohi.tilat).map(function (k) { return [k, d.lohi.tilat[k].nimi]; }), f.water, function (v) { f.water = v; K.renderSheet(); }, { cls: 'seg-wrap' }));
      var t = d.lohi.tilat[f.water];
      if (t) t.perhot.forEach(function (p) { body.appendChild(flyCard({ kuva: p.kuva || t.kuva, kuvaaja: p.kuvaaja, lisenssi: p.lisenssi, lahde: p.lahde, kuvassa: p.kuvassa }, p.nimi, [t.tapa], [p.koko])); });
      body.appendChild(h('p', { class: 'muted small', text: d.huom }));
      return;
    }
    body.appendChild(h('p', { class: 'muted small', text: sp.nimi + ': koot ' + sp.koot + '. ' + (sp.lisa || '') }));
    body.appendChild(h('h3', { text: 'Hyönteinen' }));
    if (f.group !== 'kaikki' && sp.ryhmat.indexOf(f.group) < 0) f.group = 'kaikki';
    body.appendChild(K.seg([['kaikki', 'En tiedä']].concat(sp.ryhmat.map(function (k) { return [k, d.ryhmat[k].nimi]; })), f.group, function (v) { f.group = v; K.renderSheet(); }, { cls: 'seg-wrap' }));
    body.appendChild(h('h3', { text: 'Mitä näet?' }));
    body.appendChild(yesNo('Nouseeko kaloja pintaan tai kuoriutuuko pinnalla hyönteisiä?', 'surface'));
    if (f.surface === true) body.appendChild(yesNo('Lentääkö veden yllä hyönteisiä tai munivia naaraita?', 'flying'));
    if (f.surface === false) body.appendChild(yesNo('Näkyykö kuoriutumisen merkkejä: lentäviä hyönteisiä rannalla tai nahkoja kivillä?', 'signs'));
    if (f.surface === null || (f.surface === false && f.signs === null)) {
      body.appendChild(h('p', { class: 'muted small', text: 'Vastaa kysymyksiin, niin sovellus valitsee kehitysvaiheen: pohjalla (toukka), nousussa (nymfi), pinturi tai aikuinen.' }));
      return;
    }
    var recs = JG.recommend(d, f.species, f.group, { surface: f.surface, flying: f.flying === true, signs: f.signs === true });
    body.appendChild(h('h3', { text: 'Suositus' }));
    if (!recs.length) body.appendChild(h('p', { class: 'muted', text: 'Ei suositusta tälle yhdistelmälle.' }));
    recs.forEach(function (r) { r.perhot.forEach(function (p) { body.appendChild(flyCard(p, p.nimi, [r.kuvaus, r.huom], [r.ryhma, r.vaihe, r.syvyys, 'koko ' + p.koko])); }); });
    body.appendChild(h('p', { class: 'muted small', text: d.huom }));
  }
  function openFlies() {
    K.openSheet('flies', 'Perhot ja solmut', renderFlies);
    loadFlies().then(function () { if (K.sheetName() === 'flies') K.renderSheet(); }, function () { K.toast('Perhotietoja ei voitu ladata.'); });
  }
  /** Verkossa ollessa perhojen kuvat ja data haetaan valmiiksi offline-käyttöä varten. */
  function prefetch() {
    if (S.prefetched || !navigator.onLine || !('serviceWorker' in navigator)) return;
    S.prefetched = true;
    loadFlies().then(function (d) {
      var urls = {};
      Object.keys(d.ryhmat).forEach(function (g) {
        Object.keys(d.ryhmat[g].vaiheet).forEach(function (v) { (d.ryhmat[g].vaiheet[v].perhot || []).forEach(function (p) { if (p.kuva) urls['img/perhot/' + p.kuva] = 1; }); if (d.ryhmat[g].vaiheet[v].kuva) urls['img/perhot/' + d.ryhmat[g].vaiheet[v].kuva] = 1; });
      });
      Object.keys(d.lohi.tilat).forEach(function (k) { if (d.lohi.tilat[k].kuva) urls['img/perhot/' + d.lohi.tilat[k].kuva] = 1; d.lohi.tilat[k].perhot.forEach(function (p) { if (p.kuva) urls['img/perhot/' + p.kuva] = 1; }); });
      Object.keys(urls).filter(function (u) { return !/\.\./.test(u); }).forEach(function (u) { fetch(u, { credentials: 'omit' }).catch(function () {}); });
    }).catch(function () { S.prefetched = false; });
  }

  // ---------------------------------------------------------------------------
  // Vesitilanne jokien päällä (data/vesitilanne.json, päivittyy GitHub Actionsissa päivittäin)
  // ---------------------------------------------------------------------------

  var WATER = {
    alhainen: { color: '#e5484d', nimi: 'Alhainen' }, normaali: { color: '#2fb35a', nimi: 'Normaali' },
    korkea: { color: '#0b3d91', nimi: 'Korkea' }, tuntematon: { color: '#8a9aa0', nimi: 'Ei tietoa' }
  };
  var waterLayer = L.layerGroup();
  function fmtNum(v, unit) {
    if (v === null || v === undefined || !isFinite(v)) return '–';
    var d = Math.abs(v) >= 100 ? 0 : (Math.abs(v) >= 10 ? 1 : 2);
    return v.toFixed(d).replace('.', ',') + (unit ? ' ' + unit : '');
  }
  function isoDate(iso) { var t = Date.parse(iso); return isFinite(t) ? K.fmtDate(t) : ''; }
  function waterLegend() {
    var box = h('div', { class: 'water-legend' });
    ['alhainen', 'normaali', 'korkea', 'tuntematon'].forEach(function (k) {
      box.appendChild(h('span', { class: 'li' }, h('span', { class: 'sw sw-water', style: { background: WATER[k].color } }), WATER[k].nimi));
    });
    return h('div', null, box, h('p', { class: 'muted small', text: S.water ? 'Verrattu saman vuodenajan tavalliseen vaihteluun (25–75 % aiempina vuosina). Päivitetty ' +
      isoDate(S.water.paivitetty) + '. Napauta jokea nähdäksesi arvot.' : 'Vesitilannetta ei ole vielä ladattu.' }));
  }
  // --- Käyrät: 30 vrk mitattu arvo ja tavallinen vaihteluväli (25–75 % aiempina vuosina samaan aikaan) ---
  var SUURE = { virtaama: { nimi: 'Virtaama', color: '#4cc3d9' }, vedenkorkeus: { nimi: 'Vedenkorkeus', color: '#7aa2ff' }, lampotila: { nimi: 'Veden lämpötila', color: '#ff9f43' } };
  function dayMs(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function dm(ms) { var d = new Date(ms); return d.getUTCDate() + '.' + (d.getUTCMonth() + 1) + '.'; }
  function cleanSeries(a) {
    return (Array.isArray(a) ? a : []).map(function (r) { return Array.isArray(r) ? [dayMs(r[0]), Number(r[1]), r.length > 2 ? Number(r[2]) : null] : null; })
      .filter(function (r) { return r && isFinite(r[0]) && isFinite(r[1]) && (r[2] === null || isFinite(r[2])); }).slice(-60);
  }
  /** Pieni viivakaavio (SVG). Tekstit ja värit attribuutteina, ei tyylejä (CSP). */
  function chart(m) {
    var line = cleanSeries(m.sarja), bandRows = cleanSeries(m.kaista);
    if (line.length < 2) return null;
    var W = 320, H = 112, L = 40, R = 10, T = 10, B = 20;
    var xs = line.map(function (p) { return p[0]; }).concat(bandRows.map(function (p) { return p[0]; }));
    var ys = line.map(function (p) { return p[1]; });
    bandRows.forEach(function (b) { ys.push(b[1], b[2]); });
    var x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    if (y1 - y0 < 1e-9) { y0 -= 1; y1 += 1; }
    var pad = (y1 - y0) * 0.08; y0 -= pad; y1 += pad;
    var X = function (t) { return L + (W - L - R) * (x1 > x0 ? (t - x0) / (x1 - x0) : 0.5); };
    var Y = function (v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); };
    var svg = K.sv('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'water-chart', role: 'img', 'aria-label': SUURE[m.suure].nimi + ' 30 vuorokautta' });
    K.sv('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'none', stroke: 'rgba(140,147,158,0.35)', 'stroke-width': 1 }, svg);
    if (bandRows.length > 1) {
      var up = bandRows.map(function (b) { return X(b[0]).toFixed(1) + ',' + Y(b[2]).toFixed(1); });
      var down = bandRows.slice().reverse().map(function (b) { return X(b[0]).toFixed(1) + ',' + Y(b[1]).toFixed(1); });
      K.sv('polygon', { points: up.concat(down).join(' '), fill: 'rgba(74,124,89,0.38)', stroke: 'none' }, svg);
    }
    K.sv('polyline', { points: line.map(function (p) { return X(p[0]).toFixed(1) + ',' + Y(p[1]).toFixed(1); }).join(' '), fill: 'none', stroke: SUURE[m.suure].color, 'stroke-width': 2.2, 'stroke-linejoin': 'round' }, svg);
    var last = line[line.length - 1];
    K.sv('circle', { cx: X(last[0]).toFixed(1), cy: Y(last[1]).toFixed(1), r: 3.5, fill: SUURE[m.suure].color }, svg);
    var txt = function (x, y, t, anchor) { var e = K.sv('text', { x: x, y: y, fill: '#A9B0B9', 'font-size': 10.5, 'text-anchor': anchor || 'start' }, svg); e.textContent = t; };
    txt(L - 4, T + 9, fmtNum(y1 - pad), 'end');
    txt(L - 4, H - B, fmtNum(y0 + pad), 'end');
    txt(L, H - 5, dm(x0));
    txt(W - R, H - 5, dm(x1), 'end');
    return svg;
  }
  function measureBlock(m) {
    if (!m || !SUURE[m.suure]) return null;
    var head = SUURE[m.suure].nimi + ' ' + fmtNum(m.arvo, m.yksikko) + ' (' + isoDate(m.aika) + ')';
    var sub = 'Asema ' + m.asema + (m.etaisyys_km ? ', ' + K.fmt1(m.etaisyys_km) + ' km uomasta' : '') +
      (m.p25 !== null && m.p25 !== undefined ? '. Tavallisesti tähän aikaan ' + fmtNum(m.p25) + '–' + fmtNum(m.p75, m.yksikko) + ' (' + m.vuodet + ' v).' : '.');
    var c = chart(m);
    return h('div', { class: 'water-measure' }, h('b', { text: head }), h('span', { class: 'small muted', text: sub }), c);
  }
  function measures(j) {
    var list = Array.isArray(j.mittaukset) && j.mittaukset.length ? j.mittaukset : (j.mittaus ? [j.mittaus] : []);
    return list.concat(j.lampotila ? [j.lampotila] : []);
  }
  var CHART_NOTE = 'Viiva = mitattu 30 vrk, vihreä alue = tavallinen vaihteluväli (25–75 % aiempina vuosina samaan aikaan).';

  function waterInfo(j, ll) {
    var c = WATER[j.luokka] || WATER.tuntematon, extras = [], r = j.sade14;
    measures(j).forEach(function (m) { var b = measureBlock(m); if (b) extras.push(b); });
    if (extras.length) extras.push(h('div', { class: 'small muted', text: CHART_NOTE }));
    if (r) {
      extras.push(h('div', { class: 'small', text: 'Sade 14 vrk: ' + fmtNum(r.mm, 'mm') + ', sääasema ' + r.asema + (r.etaisyys_km ? ' (' + Math.round(r.etaisyys_km) + ' km)' : '') + '.' }));
      if (r.p25 !== null && r.p25 !== undefined) extras.push(h('div', { class: 'small muted', text: 'Tavallisesti samaan aikaan ' + fmtNum(r.p25, 'mm') + '–' + fmtNum(r.p75, 'mm') + ' (' + r.vuodet + ' vuotta).' }));
    }
    extras.push(h('div', { class: 'small muted', text: j.menetelma === 'mittaus' ? 'Luokka mitatusta arvosta (Syke).' :
      (j.menetelma === 'sade' ? 'Luokka on arvio sademäärästä (Ilmatieteen laitos), ei mitattu vedenkorkeus.' : 'Luokkaa ei voitu laskea.') }));
    K.tapInfo(ll, { title: j.nimi, detail: 'Vesitilanne: ' + c.nimi, swatch: c.color, extras: extras, targetName: j.nimi });
  }
  function drawWater() {
    waterLayer.clearLayers();
    if (!active() || !settings.water) { if (map.hasLayer(waterLayer)) map.removeLayer(waterLayer); return; }
    waterLayer.addTo(map);
    if (!S.water) { loadWater(); return; }
    var byId = {};
    (S.water.joet || []).forEach(function (j) { byId[j.id] = j; });
    (S.water.geo || []).forEach(function (gj) {
      gj.features.forEach(function (f) {
        var j = byId[(f.properties || {}).joki_id];
        if (!j || !f.geometry || !/LineString/.test(f.geometry.type)) return;
        var c = (WATER[j.luokka] || WATER.tuntematon).color;
        L.geoJSON(f, { pane: 'linePane', style: { color: '#ffffff', weight: 9, opacity: 0.85, lineCap: 'round' }, interactive: false }).addTo(waterLayer);
        L.geoJSON(f, { pane: 'linePane', style: { color: c, weight: 5, opacity: 1, lineCap: 'round', dashArray: j.luokka ? null : '6 6', bubblingMouseEvents: false } })
          .on('click', function (e) { if (K.measuring) { K.measureAdd(e.latlng); return; } waterInfo(j, e.latlng); }).addTo(waterLayer);
      });
    });
  }
  function loadWater() {
    return K.fetchJSON('data/vesitilanne.json', { cache: 'no-cache' }).then(function (j) {
      var files = (j.geometriat || []).filter(function (f) { return /^layers\/[a-z0-9_-]+\.geojson$/i.test(f); });
      return Promise.all(files.map(function (f) { return K.fetchJSON(f).then(JG.cleanGeoJSON).catch(function () { return null; }); })).then(function (geo) {
        j.geo = geo.filter(Boolean);
        S.water = j;
        drawWater();
        if (K.sheetName() === 'layers') K.renderSheet();
      });
    }).catch(function () { K.toast('Vesitilannetta ei voitu ladata.'); });
  }

  // ---------------------------------------------------------------------------
  // Kalastusalueiden tasot (docs/layers/index.json)
  // ---------------------------------------------------------------------------

  /** Tason versio osoitteeseen: muuttunut taso haetaan heti verkosta eikä välimuistista. */
  function ver(v) { return typeof v === 'string' && /^[a-f0-9]{6,16}$/.test(v) ? '?v=' + v : ''; }
  function loadFishLayers() {
    if (S.layerIndex) { showFishLayers(); return Promise.resolve(); }
    return K.fetchJSON('layers/index.json').then(function (idx) {
      var tasot = (idx.tasot || []).filter(function (t) { return t && /^[a-z0-9_-]+$/i.test(t.id) && /^[a-z0-9_-]+\.geojson$/i.test(t.tiedosto); });
      S.layerIndex = tasot;
      return Promise.all(tasot.map(function (t) {
        return K.fetchJSON('layers/' + t.tiedosto + ver(t.versio)).then(function (gj) {
          var clean = JG.cleanGeoJSON(gj);
          S.layers[t.id] = { id: t.id, name: String(t.nimi || t.id).slice(0, 60), gj: clean, layer: K.geoLayer(clean),
            depthFile: typeof t.syvyys === 'string' && /^[a-z0-9_-]+\.geojson$/i.test(t.syvyys) ? t.syvyys + ver(t.syvyys_versio) : null };
        }).catch(function () { /* taso puuttuu */ });
      })).then(showFishLayers);
    }).catch(function () { S.layerIndex = null; });
  }
  function showFishLayers() {
    Object.keys(S.layers).forEach(function (id) {
      var e = S.layers[id], on = active() && settings.fishLayers && !settings.hidden['kal-' + id];
      if (on && !map.hasLayer(e.layer)) e.layer.addTo(map);
      if (!on && map.hasLayer(e.layer)) map.removeLayer(e.layer);
      showDepth(e, on && settings.showDepth);
    });
    renderIce();
  }

  // ---------------------------------------------------------------------------
  // Syvyysalueet: vain Syken mittaamat järvet piirretyillä kalastusalueilla (layers/<alue>-syvyys.geojson)
  // ---------------------------------------------------------------------------

  var DEPTH = [[0, '#cfeaf7'], [3, '#9fd2ee'], [6, '#69b3e0'], [10, '#3b8cc9'], [20, '#1f62a6'], [40, '#123f78']];
  function depthColor(min) { var c = DEPTH[0][1]; DEPTH.forEach(function (d) { if (min !== null && min >= d[0]) c = d[1]; }); return c; }
  function depthLabel(p) { return p.max_m !== null && p.max_m !== undefined ? K.fmt1(p.min_m) + '–' + K.fmt1(p.max_m) + ' m' : 'yli ' + K.fmt1(p.min_m) + ' m'; }
  function showDepth(e, on) {
    if (!e.depthFile) return;
    if (!on) { if (e.depth && map.hasLayer(e.depth.layer)) map.removeLayer(e.depth.layer); return; }
    if (e.depth) { if (!map.hasLayer(e.depth.layer)) e.depth.layer.addTo(map); return; }
    if (e.depthLoading) return;
    e.depthLoading = true;
    K.fetchJSON('layers/' + e.depthFile).then(function (gj) {
      var feats = ((gj && gj.features) || []).filter(function (f) {
        return f && f.geometry && f.properties && /^(Multi)?(Polygon|LineString)$/.test(f.geometry.type);
      }).map(function (f) {
        var p = f.properties, n = function (v) { v = Number(v); return v === null || !isFinite(v) ? null : v; };
        return { type: 'Feature', geometry: f.geometry, properties: p.tyyppi === 'syvyyskayra'
          ? { tyyppi: 'syvyyskayra', m: n(p.m) }
          : { tyyppi: 'syvyysalue', jarvi: String(p.jarvi || '').slice(0, 60), min_m: n(p.min_m), max_m: p.max_m === null ? null : n(p.max_m) } };
      });
      var areas = feats.filter(function (f) { return f.properties.tyyppi === 'syvyysalue'; });
      var layer = L.geoJSON({ type: 'FeatureCollection', features: feats }, {
        pane: 'habitatPane', interactive: false,
        style: function (f) {
          return f.properties.tyyppi === 'syvyyskayra' ? { color: '#0b2f55', weight: 1, opacity: 0.55, fill: false }
            : { stroke: false, fillColor: depthColor(f.properties.min_m), fillOpacity: 0.6 };
        }
      });
      // Pistehaku napautukselle: rajaus ensin, sitten pisteen sijainti monikulmiossa.
      areas.forEach(function (f) { f._b = JG.bboxOf({ features: [f] }); });
      e.depth = { layer: layer, areas: areas, lakes: (gj.properties && gj.properties.jarvet || []).slice(0, 200) };
      e.depthLoading = false;
      showFishLayers();
    }).catch(function () { e.depthLoading = false; });
  }
  function inRing(x, y, r) {
    var c = false;
    for (var i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / ((r[j][1] - r[i][1]) || 1e-12) + r[i][0]) c = !c;
    }
    return c;
  }
  function inPolygon(x, y, g) {
    var polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    return polys.some(function (poly) { return inRing(x, y, poly[0]) && !poly.slice(1).some(function (hole) { return inRing(x, y, hole); }); });
  }
  function depthAt(ll) {
    var x = ll.lng, y = ll.lat, hit = null;
    Object.keys(S.layers).forEach(function (id) {
      var d = S.layers[id].depth;
      if (hit || !d || !map.hasLayer(d.layer)) return;
      for (var i = 0; i < d.areas.length && !hit; i++) {
        var f = d.areas[i], b = f._b;
        if (b && x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && inPolygon(x, y, f.geometry)) hit = f;
      }
    });
    return hit;
  }
  function depthInfo(ll) {
    if (!active() || !settings.showDepth) return false;
    var f = depthAt(ll);
    if (!f) return false;
    K.tapInfo(ll, { title: f.properties.jarvi || 'Järvi', detail: 'Syvyys ' + depthLabel(f.properties), swatch: depthColor(f.properties.min_m),
      extras: [h('div', { class: 'small muted', text: 'Syken syvyysmittaus. Käytä suuntaa antavana: mittaukset voivat olla vuosikymmenten takaa.' })],
      targetName: f.properties.jarvi || 'Järvi' });
    return true;
  }
  K.onPointInfo(depthInfo);
  K.onMapClick(function (ll) { return !K.measuring && !K.drawing && depthInfo(ll); }, 20);
  function depthLegend() {
    var box = h('div', { class: 'water-legend' });
    [['0–3 m', 0], ['3–6 m', 3], ['6–10 m', 6], ['10–20 m', 10], ['20–40 m', 20], ['yli 40 m', 40]].forEach(function (d) {
      box.appendChild(h('span', { class: 'li' }, h('span', { class: 'sw', style: { background: depthColor(d[1]) } }), d[0]));
    });
    return box;
  }

  // ---------------------------------------------------------------------------
  // Jäänpaksuus: Syken mittaukset (data/jaa.json) kalastusalueilla ja 5 km säteellä sijainnista
  // ---------------------------------------------------------------------------

  var ICE_NEAR_M = 5000, ICE_OLD_D = 7;
  var iceLayer = L.layerGroup();
  function loadIce() {
    if (S.ice || S.iceLoading) return Promise.resolve(S.ice);
    S.iceLoading = true;
    return K.fetchJSON('data/jaa.json', { cache: 'no-cache' }).then(function (j) {
      S.ice = {
        paivitetty: j.paivitetty, jakso: Number(j.jakso_vrk) || 30,
        asemat: (j.asemat || []).filter(function (a) {
          return a && isFinite(a.lat) && isFinite(a.lon) && Math.abs(a.lat) <= 90 && Math.abs(a.lon) <= 180 && isFinite(a.cm) && a.cm >= 0 && a.cm < 300 && isFinite(Date.parse(a.aika));
        }).map(function (a) {
          return { nimi: String(a.nimi || '').slice(0, 60), jarvi: String(a.jarvi || '').slice(0, 80), lat: +a.lat, lon: +a.lon, cm: Math.round(a.cm), aika: a.aika };
        })
      };
      S.iceLoading = false;
      renderIce();
      return S.ice;
    }).catch(function () { S.iceLoading = false; return null; });
  }
  function inFishArea(lat, lon) {
    return Object.keys(S.layers).some(function (id) {
      return (S.layers[id].gj.features || []).some(function (f) {
        return f.geometry && /Polygon/.test(f.geometry.type) && (f.properties || {}).tyyppi === 'alue' && inPolygon(lon, lat, f.geometry);
      });
    });
  }
  /** Asemat kalastusalueilla tai 5 km säteellä sijainnista, lähin ensin. */
  function iceStations() {
    if (!S.ice) return [];
    var w = K.wherePoint();
    return S.ice.asemat.map(function (a) {
      var d = JG.distance(w.lat, w.lon, a.lat, a.lon);
      return { a: a, d: d, near: d <= ICE_NEAR_M, area: inFishArea(a.lat, a.lon), src: w.src };
    }).filter(function (x) { return x.near || x.area; }).sort(function (x, y) { return x.d - y.d; });
  }
  function iceAgeDays(a) { return Math.floor((Date.now() - Date.parse(a.aika)) / 86400000); }
  function iceTitle(a) { return a.jarvi ? a.jarvi + (a.nimi && a.nimi !== a.jarvi ? ', ' + a.nimi : '') : (a.nimi || 'Mittauspaikka'); }
  var ICE_WARN = 'Mittaus on yhdestä pisteestä. Jää voi olla paljon ohuempaa virtapaikoissa, salmissa, jokisuilla, kaislikoissa, lähteiden kohdalla ja lumen alla. Tarkista jää itse tuuralla ennen jäälle menoa ja koko matkan ajan.';
  function iceInfo(x) {
    var a = x.a, age = iceAgeDays(a);
    K.tapInfo(L.latLng(a.lat, a.lon), { title: iceTitle(a), detail: 'Jäänpaksuus ' + a.cm + ' cm · mitattu ' + isoDate(a.aika) + (age > ICE_OLD_D ? ' (' + age + ' vrk sitten)' : ''),
      swatch: '#dff3ff', extras: [h('div', { class: 'small notice notice-warn', text: ICE_WARN })], targetName: iceTitle(a) });
  }
  function renderIce() {
    iceLayer.clearLayers();
    if (!active() || !settings.showIce || !S.ice) { if (map.hasLayer(iceLayer)) map.removeLayer(iceLayer); return; }
    if (!map.hasLayer(iceLayer)) iceLayer.addTo(map);
    iceStations().forEach(function (x) {
      var m = L.marker([x.a.lat, x.a.lon], { keyboard: false, title: iceTitle(x.a),
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: h('div', { class: 'obs-pin obs-jaa' + (iceAgeDays(x.a) > ICE_OLD_D ? ' ice-old' : ''), text: String(x.a.cm) }) }) });
      m.on('click', function (e) { if (K.measuring) { K.measureAdd(e.latlng); return; } if (K.drawing) { K.drawAdd(e.latlng); return; } iceInfo(x); });
      iceLayer.addLayer(m);
    });
  }
  function renderIceList(body) {
    if (!S.ice) { body.appendChild(h('p', { class: 'muted', text: 'Ladataan jäätietoja…' })); loadIce().then(function () { if (K.sheetName() === 'ice') K.renderSheet(); }); return; }
    var list = iceStations(), w = K.wherePoint();
    body.appendChild(h('div', { class: 'notice notice-warn', text: ICE_WARN }));
    if (!list.length) {
      body.appendChild(h('p', { text: S.ice.asemat.length
        ? 'Kalastusalueilla tai 5 km säteellä ' + (w.src === 'gps' ? 'sijainnistasi' : 'kartan keskipisteestä') + ' ei ole mittauksia viimeisen ' + S.ice.jakso + ' vuorokauden ajalta.'
        : 'Sykellä ei ole jäänpaksuusmittauksia viimeisen ' + S.ice.jakso + ' vuorokauden ajalta. Mittaukset alkavat, kun järvet ovat jäässä.' }));
    }
    list.forEach(function (x) {
      var age = iceAgeDays(x.a);
      body.appendChild(h('div', { class: 'ice-row' },
        h('div', null, h('b', { text: iceTitle(x.a) })),
        h('div', { class: 'ice-cm' + (age > ICE_OLD_D ? ' ice-old' : ''), text: x.a.cm + ' cm' }),
        h('div', { class: 'ice-meta', text: 'Mitattu ' + isoDate(x.a.aika) + (age > ICE_OLD_D ? ' (' + age + ' vrk sitten)' : '') + ' · ' +
          K.fmtDist(x.d) + (x.src === 'gps' ? ' sinusta' : ' kartan keskeltä') + (x.area && !x.near ? ' · kalastusalueella' : '') }),
        h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', text: 'Näytä', onclick: function () {
          K.closeSheet(); map.setView([x.a.lat, x.a.lon], Math.max(map.getZoom(), 13)); iceInfo(x);
        } }))));
    });
    body.appendChild(h('p', { class: 'muted small', text: 'Lähde: Syke, Hydrologiarajapinta (CC BY 4.0). Päivitetty ' + isoDate(S.ice.paivitetty) + '. Mukana mittaukset viimeisen ' + S.ice.jakso + ' vuorokauden ajalta.' }));
  }
  function openIce() { K.openSheet('ice', 'Jäänpaksuus', renderIceList); }
  function renderWaterList(body) {
    if (!S.water) { body.appendChild(h('p', { class: 'muted', text: 'Ladataan vesitilannetta…' })); loadWater().then(function () { if (K.sheetName() === 'water-list') K.renderSheet(); }); return; }
    var joet = (S.water.joet || []).slice().sort(function (a, b) { return String(a.nimi).localeCompare(String(b.nimi), 'fi'); });
    if (!joet.length) { body.appendChild(h('p', { class: 'muted', text: 'Ei jokia. Piirrä kalastusalue ja lähetä se analysoitavaksi.' })); return; }
    joet.forEach(function (j) {
      var c = WATER[j.luokka] || WATER.tuntematon, blocks = measures(j).map(measureBlock).filter(Boolean);
      body.appendChild(h('div', { class: 'card water-card' },
        h('div', { class: 'card-main' }, h('div', { class: 'card-title' }, h('span', { class: 'sw sw-water', style: { background: c.color } }), ' ' + j.nimi),
          h('div', { class: 'card-sub', text: 'Vesitilanne: ' + c.nimi + (j.menetelma === 'sade' ? ' (arvio sademäärästä)' : '') })),
        blocks.length ? h('div', { class: 'water-blocks' }, blocks) : h('p', { class: 'small muted water-blocks', text: 'Ei mittausasemaa lähellä tätä jokea.' })));
    });
    body.appendChild(h('p', { class: 'muted small', text: CHART_NOTE + ' Lähde: Syke, Hydrologiarajapinta (CC BY 4.0). Päivitetty ' + isoDate(S.water.paivitetty) + '.' }));
  }
  function openWaterList() { K.openSheet('water-list', 'Vesistöt', renderWaterList); }
  K.on('pos', function () { if (active() && S.ice && settings.showIce) renderIce(); });

  // ---------------------------------------------------------------------------
  // Saaliskirjaus (vain tässä laitteessa)
  // ---------------------------------------------------------------------------

  var FISH = [['lohi', 'Lohi', 'Lo'], ['taimen', 'Taimen', 'Ta'], ['harjus', 'Harjus', 'Ha'], ['nieria', 'Nieriä', 'Ni'], ['kirjolohi', 'Kirjolohi', 'Ki'],
    ['siika', 'Siika', 'Si'], ['hauki', 'Hauki', 'Hk'], ['ahven', 'Ahven', 'Ah'], ['kuha', 'Kuha', 'Ku'], ['made', 'Made', 'Ma'], ['muu', 'Muu', '?']];
  function fishName(k) { for (var i = 0; i < FISH.length; i++) if (FISH[i][0] === k) return FISH[i][1]; return 'Muu'; }
  function fishShort(k) { for (var i = 0; i < FISH.length; i++) if (FISH[i][0] === k) return FISH[i][2]; return '?'; }
  function numOrNull(v, max) { var n = Number(String(v === null || v === undefined ? '' : v).replace(',', '.')); return v === '' || v === null || v === undefined || !isFinite(n) || n <= 0 ? null : Math.min(max, Math.round(n * 10) / 10); }
  function sanitizeCatch(o) {
    if (!o || typeof o !== 'object') return null;
    var lat = Number(o.lat), lon = Number(o.lon);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return {
      id: String(o.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      t: Number(o.t) || Date.now(), lat: lat, lon: lon, acc: o.acc === null || o.acc === '' || !isFinite(Number(o.acc)) ? null : Math.round(Number(o.acc)),
      laji: FISH.some(function (f) { return f[0] === o.laji; }) ? o.laji : 'muu',
      cm: numOrNull(o.cm, 250), kg: numOrNull(o.kg, 80), vap: !!o.vap,
      viehe: typeof o.viehe === 'string' ? o.viehe.slice(0, 60) : '', note: typeof o.note === 'string' ? o.note.slice(0, 120) : ''
    };
  }
  var catches = (store.get('catch', []) || []).map(sanitizeCatch).filter(Boolean);
  function saveCatches() { if (!store.set('catch', catches)) K.toast('Tallennustila on täynnä: saalista ei tallennettu.'); }
  var catchLayer = L.layerGroup();
  function catchDetail(o) {
    return [o.cm ? K.fmt1(o.cm) + ' cm' : '', o.kg ? K.fmt1(o.kg) + ' kg' : '', o.vap ? 'vapautettu' : '', o.viehe].filter(Boolean).join(' · ');
  }
  function renderCatchMarkers() {
    catchLayer.clearLayers();
    if (!active() || !settings.showCatch) { if (map.hasLayer(catchLayer)) map.removeLayer(catchLayer); return; }
    if (!map.hasLayer(catchLayer)) catchLayer.addTo(map);
    catches.forEach(function (o) {
      var m = L.marker([o.lat, o.lon], { keyboard: false, title: fishName(o.laji),
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: h('div', { class: 'obs-pin obs-kala', text: fishShort(o.laji) }) }) });
      m.on('click', function (e) { if (K.measuring) { K.measureAdd(e.latlng); return; } showCatch(o); });
      catchLayer.addLayer(m);
    });
  }
  function showCatch(o) {
    K.showCard({
      badge: h('span', { class: 'obs-pin obs-pin-static obs-kala', text: fishShort(o.laji) }),
      title: fishName(o.laji), detail: K.fmtDate(o.t) + ' klo ' + K.hm(o.t) + (catchDetail(o) ? ' · ' + catchDetail(o) : '') + (o.note ? ' · ' + o.note : ''),
      meta: [K.fmtLatLon(o.lat, o.lon)].concat(K.fromMe(o.lat, o.lon) ? [K.fromMe(o.lat, o.lon)] : []),
      actions: [
        { label: 'Suunnista tänne', primary: true, fn: function () { K.closeCard(); K.setTarget({ lat: o.lat, lng: o.lon, name: fishName(o.laji) + ', saaliin paikka' }); } },
        { label: 'Poista', danger: true, fn: function () {
          if (!confirm('Poistetaanko saalismerkintä?')) return;
          catches = catches.filter(function (x) { return x.id !== o.id; });
          saveCatches(); renderCatchMarkers(); K.closeCard(); K.toast('Saalismerkintä poistettu.');
        } }
      ]
    });
  }

  var draft = null, picking = false;
  function newDraft() {
    var gps = K.pos && Date.now() - K.pos.t < 120000;
    return { laji: 'harjus', cm: '', kg: '', vap: false, viehe: '', note: '', loc: gps ? { lat: K.pos.lat, lon: K.pos.lon, acc: K.pos.acc, src: 'gps' } : null };
  }
  function numInput(label, key, unit, step) {
    var inp = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: '0', step: step, placeholder: unit, 'aria-label': label });
    inp.value = draft[key];
    inp.addEventListener('input', function () { draft[key] = inp.value; });
    return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), inp);
  }
  function renderCatchForm(body) {
    var d = draft || (draft = newDraft());
    body.classList.add('obs-form');
    var locTxt = d.loc ? (d.loc.src === 'gps' ? 'Oma sijainti' + (d.loc.acc ? ' (±' + K.fmtInt(d.loc.acc) + ' m)' : '') : 'Kartalta valittu kohta') + ' · ' + K.fmtLatLon(d.loc.lat, d.loc.lon) : 'Paikkaa ei ole valittu';
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Paikka' }), h('div', { class: d.loc ? 'coords' : 'warn-text', text: locTxt }),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', text: K.pos ? 'Oma sijainti' : 'Hae sijainti', onclick: function () {
          if (!K.pos) { K.startGps(false); K.toast('Haetaan sijaintia…'); return; }
          d.loc = { lat: K.pos.lat, lon: K.pos.lon, acc: K.pos.acc, src: 'gps' }; K.renderSheet();
        } }),
        h('button', { type: 'button', class: 'btn', text: 'Valitse kartalta', onclick: function () { picking = true; K.closeSheet(); K.toast('Napauta karttaa saaliin kohdalla.', null, 6000); } }))));
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Laji' }),
      K.seg(FISH.map(function (f) { return [f[0], f[1]]; }), d.laji, function (v) { d.laji = v; K.renderSheet(); }, { cls: 'seg-wrap', label: 'Laji' })));
    body.appendChild(h('div', { class: 'row' }, numInput('Pituus (cm)', 'cm', 'cm', '0.5'), numInput('Paino (kg)', 'kg', 'kg', '0.05')));
    body.appendChild(K.toggleRow('Vapautettu', null, d.vap, function (v) { d.vap = v; }));
    var vi = h('input', { class: 'input', type: 'text', maxlength: '60', placeholder: 'Perho tai viehe (valinnainen)', 'aria-label': 'Perho tai viehe' });
    vi.value = d.viehe;
    vi.addEventListener('input', function () { d.viehe = vi.value.slice(0, 60); });
    var note = h('input', { class: 'input', type: 'text', maxlength: '120', placeholder: 'Lisätieto (valinnainen)', 'aria-label': 'Lisätieto' });
    note.value = d.note;
    note.addEventListener('input', function () { d.note = note.value.slice(0, 120); });
    body.appendChild(h('div', { class: 'field' }, vi, note));
    body.appendChild(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Tallenna', disabled: !d.loc, onclick: function () {
        var o = sanitizeCatch({ t: Date.now(), lat: d.loc.lat, lon: d.loc.lon, acc: d.loc.src === 'gps' ? d.loc.acc : null, laji: d.laji, cm: d.cm, kg: d.kg, vap: d.vap, viehe: d.viehe, note: d.note });
        catches.push(o); saveCatches(); draft = null; K.closeSheet(); renderCatchMarkers();
        K.toast('Saalis tallennettu: ' + fishName(o.laji) + (catchDetail(o) ? ', ' + catchDetail(o) : '') + '.');
      } }),
      h('button', { type: 'button', class: 'btn', text: 'Kaikki saaliit (' + catches.length + ')', onclick: function () { K.openSheet('catch-list', 'Saaliit', renderCatchList); } })));
  }
  function openCatchForm() { K.openSheet('catch-new', 'Uusi saalis', renderCatchForm); }
  K.onMapClick(function (ll) {
    if (!picking) return false;
    picking = false;
    if (!draft) draft = newDraft();
    draft.loc = { lat: ll.lat, lon: ll.lng, acc: null, src: 'map' };
    openCatchForm();
    return true;
  }, 90);
  K.on('pos', function () { if (K.sheetName() === 'catch-new' && draft && !draft.loc) { draft.loc = { lat: K.pos.lat, lon: K.pos.lon, acc: K.pos.acc, src: 'gps' }; K.renderSheet(); } });

  function renderCatchList(body) {
    var year = new Date().getFullYear(), start = new Date(year, 0, 1).getTime(), by = {};
    catches.filter(function (o) { return o.t >= start; }).forEach(function (o) {
      var b = by[o.laji] || (by[o.laji] = { n: 0, vap: 0, max: 0 });
      b.n++; if (o.vap) b.vap++; if (o.cm && o.cm > b.max) b.max = o.cm;
    });
    var lines = Object.keys(by).map(function (k) { var b = by[k]; return fishName(k) + ' ' + b.n + (b.vap ? ' (vapautettu ' + b.vap + ')' : '') + (b.max ? ', suurin ' + K.fmt1(b.max) + ' cm' : ''); });
    body.appendChild(h('h3', { text: 'Saaliit vuonna ' + year }));
    body.appendChild(lines.length ? h('ul', { class: 'feature-list' }, lines.map(function (l) { return h('li', { text: l }); })) : h('p', { class: 'muted', text: 'Ei saaliita tänä vuonna.' }));
    var row = h('div', { class: 'btn-row' });
    row.appendChild(h('button', { type: 'button', class: 'btn btn-primary', text: 'Uusi saalis', onclick: function () { draft = null; openCatchForm(); } }));
    if (catches.length) row.appendChild(h('button', { type: 'button', class: 'btn', text: 'Lataa CSV', onclick: function () {
      var rows = [['aika', 'laji', 'pituus_cm', 'paino_kg', 'vapautettu', 'perho_viehe', 'lat', 'lon', 'tarkkuus_m', 'lisatieto']].concat(catches.map(function (o) {
        return [new Date(o.t).toISOString(), o.laji, o.cm === null ? '' : o.cm, o.kg === null ? '' : o.kg, o.vap ? 'kylla' : 'ei', o.viehe, o.lat.toFixed(6), o.lon.toFixed(6), o.acc === null ? '' : o.acc, o.note];
      }));
      K.download('﻿' + rows.map(function (r) { return r.map(K.csvCell).join(';'); }).join('\r\n'), 'kaira-saaliit.csv', 'text/csv;charset=utf-8');
    } }));
    body.appendChild(row);
    body.appendChild(h('h3', { text: 'Saaliit (' + catches.length + ')' }));
    catches.slice().sort(function (a, b) { return b.t - a.t; }).slice(0, 200).forEach(function (o) {
      body.appendChild(h('div', { class: 'obs-row' },
        h('span', { class: 'obs-pin obs-pin-static obs-kala', text: fishShort(o.laji) }),
        h('div', { class: 'obs-txt' }, h('b', { text: fishName(o.laji) + (catchDetail(o) ? ' · ' + catchDetail(o) : '') }),
          h('small', { text: K.fmtDate(o.t) + ' klo ' + K.hm(o.t) + (o.note ? ' · ' + o.note : '') })),
        h('button', { type: 'button', class: 'btn', text: 'Näytä', onclick: function () { K.closeSheet(); map.setView([o.lat, o.lon], Math.max(map.getZoom(), 15)); showCatch(o); } })));
    });
    if (catches.length) body.appendChild(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-danger', text: 'Poista kaikki saaliit', onclick: function () {
      if (!confirm('Poistetaanko kaikki saalismerkinnät tästä puhelimesta?')) return;
      catches = []; saveCatches(); renderCatchMarkers(); K.renderSheet(); K.toast('Saaliit poistettu.');
    } })));
    body.appendChild(h('p', { class: 'muted small', text: 'Saaliit tallentuvat vain tähän puhelimeen eivätkä lähde minnekään.' }));
  }

  // ---------------------------------------------------------------------------
  // Paneelit ja osion vaihto
  // ---------------------------------------------------------------------------

  K.on('layers', function (body, sec) {
    if (sec !== SEC) return;
    body.appendChild(h('h3', { text: 'Vesitilanne' }));
    body.appendChild(K.toggleRow('Jokien vesitilanne väreinä', 'Punainen = alhainen, vihreä = normaali, tummansininen = korkea', settings.water, function (v) {
      settings.water = v; K.saveSettings(); drawWater(); K.renderSheet();
    }));
    if (settings.water) body.appendChild(waterLegend());
    body.appendChild(h('h3', { text: 'Kalastusalueet' }));
    body.appendChild(K.toggleRow('Näytä kalastusalueet', 'Alueen raja, kosket ja suvannot', settings.fishLayers, function (v) { settings.fishLayers = v; K.saveSettings(); showFishLayers(); K.renderSheet(); }));
    if (!Object.keys(S.layers).length) body.appendChild(h('p', { class: 'muted small', text: 'Ei vielä kalastusalueita. Piirrä alue (Työkalut → Piirrä alue) ja lähetä se analysoitavaksi. Valmis alue näkyy tässä.' }));
    if (settings.fishLayers) Object.keys(S.layers).forEach(function (id) {
      var e = S.layers[id], b = K.gjBounds(e.gj), hid = 'kal-' + id;
      body.appendChild(K.toggleRow(e.name, null, !settings.hidden[hid], function (v) { if (v) delete settings.hidden[hid]; else settings.hidden[hid] = true; K.saveSettings(); showFishLayers(); }));
      if (b) body.appendChild(h('div', { class: 'btn-row btn-row-sub' },
        h('button', { type: 'button', class: 'btn btn-sm', text: 'Näytä', onclick: function () { K.closeSheet(); K.fitBounds(b); } }),
        h('button', { type: 'button', class: 'btn btn-sm', text: K.offline.get('kalastus-' + id) ? 'Offline ✓' : 'Offline', onclick: function () { K.openOfflineFor({ id: 'kalastus-' + id, name: e.name, kind: 'kalastusalue', bounds: b }); } })));
    });
    var hasDepth = Object.keys(S.layers).some(function (id) { return S.layers[id].depthFile; });
    body.appendChild(h('h3', { text: 'Syvyys ja jää' }));
    body.appendChild(K.toggleRow('Järvien syvyysalueet', hasDepth ? 'Vain Syken mittaamat järvet piirretyillä kalastusalueilla' : 'Ei vielä mitattuja järviä kalastusalueilla', settings.showDepth, function (v) {
      settings.showDepth = v; K.saveSettings(); showFishLayers(); K.renderSheet();
    }));
    if (settings.showDepth && hasDepth) body.appendChild(depthLegend());
    body.appendChild(K.toggleRow('Jäänpaksuusmittaukset', 'Kalastusalueilla ja 5 km säteellä sijainnista (Syke)', settings.showIce, function (v) {
      settings.showIce = v; K.saveSettings(); if (v) loadIce(); renderIce();
    }));
    body.appendChild(h('h3', { text: 'Saaliit' }));
    body.appendChild(K.toggleRow('Näytä saaliit kartalla', 'Tallentuvat vain tähän puhelimeen', settings.showCatch, function (v) { settings.showCatch = v; K.saveSettings(); renderCatchMarkers(); }));
  });
  K.on('menu', function (list, sec) {
    if (sec !== SEC) return;
    list.appendChild(K.menuItem('fishPlus', 'Saaliit', catches.length + ' merkintää · CSV-vienti', function () { K.openSheet('catch-list', 'Saaliit', renderCatchList); }));
    list.appendChild(K.menuItem('drop', 'Vesistöt', 'Vesitilanne, veden lämpötila, virtaama ja vedenkorkeus käyrinä', openWaterList));
    list.appendChild(K.menuItem('drop', 'Jäänpaksuus', 'Syken mittaukset lähelläsi ja kalastusalueilla', openIce));
  });
  K.defineNav(SEC, {
    main: { label: 'Saalis', icon: 'fishPlus', sheet: 'catch-new', fn: function () { draft = null; openCatchForm(); } },
    info: { label: 'Perhot', icon: 'fly', sheet: 'flies', fn: openFlies }
  });

  function enter() {
    drawWater();
    loadFishLayers().then(function () {
      if (!active()) return;
      // Ensimmäisellä kerralla kartta kalastusalueille, jos näkymä on koko Suomi.
      if (!store.get('fishSeen', false) && map.getZoom() < 7) {
        var ids = Object.keys(S.layers), b = ids.length ? K.gjBounds(S.layers[ids[0]].gj) : null;
        if (b) K.fitBounds(b);
      }
      store.set('fishSeen', true);
    });
    renderCatchMarkers();
    if (settings.showIce) loadIce();
    setTimeout(prefetch, 3000);
  }
  function leave() {
    if (map.hasLayer(waterLayer)) map.removeLayer(waterLayer);
    if (map.hasLayer(iceLayer)) map.removeLayer(iceLayer);
    showFishLayers();
    renderCatchMarkers();
    picking = false;
  }
  K.on('section', function (sec) { if (sec === SEC) enter(); });
  K.on('leave', function (sec) { if (sec === SEC) leave(); });

  K.fish = { S: S, catches: function () { return catches; }, iceStations: iceStations, depthAt: depthAt, openIce: openIce, openWaterList: openWaterList, waterInfo: waterInfo };
})();

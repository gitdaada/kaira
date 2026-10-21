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
  function waterInfo(j, ll) {
    var c = WATER[j.luokka] || WATER.tuntematon, extras = [], m = j.mittaus, r = j.sade14;
    if (m) {
      extras.push(h('div', { class: 'small', text: (m.suure === 'virtaama' ? 'Virtaama ' : 'Vedenkorkeus ') + fmtNum(m.arvo, m.yksikko) + ' (' + isoDate(m.aika) + '), asema ' + m.asema + '.' }));
      if (m.p25 !== null && m.p25 !== undefined) extras.push(h('div', { class: 'small muted', text: 'Tavallisesti tähän aikaan ' + fmtNum(m.p25, m.yksikko) + '–' + fmtNum(m.p75, m.yksikko) + ' (' + m.vuodet + ' vuotta).' }));
    }
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

  function loadFishLayers() {
    if (S.layerIndex) { showFishLayers(); return Promise.resolve(); }
    return K.fetchJSON('layers/index.json').then(function (idx) {
      var tasot = (idx.tasot || []).filter(function (t) { return t && /^[a-z0-9_-]+$/i.test(t.id) && /^[a-z0-9_-]+\.geojson$/i.test(t.tiedosto); });
      S.layerIndex = tasot;
      return Promise.all(tasot.map(function (t) {
        return K.fetchJSON('layers/' + t.tiedosto).then(function (gj) {
          var clean = JG.cleanGeoJSON(gj);
          S.layers[t.id] = { id: t.id, name: String(t.nimi || t.id).slice(0, 60), gj: clean, layer: K.geoLayer(clean) };
        }).catch(function () { /* taso puuttuu */ });
      })).then(showFishLayers);
    }).catch(function () { S.layerIndex = null; });
  }
  function showFishLayers() {
    Object.keys(S.layers).forEach(function (id) {
      var e = S.layers[id], on = active() && settings.fishLayers && !settings.hidden['kal-' + id];
      if (on && !map.hasLayer(e.layer)) e.layer.addTo(map);
      if (!on && map.hasLayer(e.layer)) map.removeLayer(e.layer);
    });
  }

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
    body.appendChild(K.toggleRow('Näytä kalastusalueet', 'Kosket, suvannot, tuvat ja reitit', settings.fishLayers, function (v) { settings.fishLayers = v; K.saveSettings(); showFishLayers(); K.renderSheet(); }));
    if (settings.fishLayers) Object.keys(S.layers).forEach(function (id) {
      var e = S.layers[id], b = K.gjBounds(e.gj), hid = 'kal-' + id;
      body.appendChild(K.toggleRow(e.name, null, !settings.hidden[hid], function (v) { if (v) delete settings.hidden[hid]; else settings.hidden[hid] = true; K.saveSettings(); showFishLayers(); }));
      if (b) body.appendChild(h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', text: 'Näytä', onclick: function () { K.closeSheet(); K.fitBounds(b); } }),
        h('button', { type: 'button', class: 'btn', text: 'Offline', onclick: function () { K.openOfflineFor({ id: 'kalastus-' + id, name: e.name, kind: 'kalastusalue', bounds: b }); } })));
    });
    body.appendChild(h('h3', { text: 'Saaliit' }));
    body.appendChild(K.toggleRow('Näytä saaliit kartalla', 'Tallentuvat vain tähän puhelimeen', settings.showCatch, function (v) { settings.showCatch = v; K.saveSettings(); renderCatchMarkers(); }));
  });
  K.on('menu', function (list, sec) {
    if (sec !== SEC) return;
    list.appendChild(K.menuItem('fishPlus', 'Saaliit', catches.length + ' merkintää · CSV-vienti', function () { K.openSheet('catch-list', 'Saaliit', renderCatchList); }));
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
    setTimeout(prefetch, 3000);
  }
  function leave() {
    if (map.hasLayer(waterLayer)) map.removeLayer(waterLayer);
    showFishLayers();
    renderCatchMarkers();
    picking = false;
  }
  K.on('section', function (sec) { if (sec === SEC) enter(); });
  K.on('leave', function (sec) { if (sec === SEC) leave(); });

  K.fish = { S: S, catches: function () { return catches; } };
})();

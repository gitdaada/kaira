/*
 * Kaira: yhteiset työkalut kaikissa osioissa: etäisyyden ja suunnan mittaus, etäisyysrenkaat,
 * omat GeoJSON-tasot (tuonti puhelimessa) ja näkymän tallennus offline-käyttöön.
 */
(function () {
  'use strict';

  var K = window.K, JG = window.JG, h = K.h, $ = K.$, settings = K.settings, map = K.map, store = K.store;

  // ---------------------------------------------------------------------------
  // GeoJSON-tasojen piirto (käytetään myös kalastusalueissa)
  // ---------------------------------------------------------------------------

  var STYLE = {
    alue: { color: '#ffd166', weight: 2.5, dashArray: '6 6', fillColor: '#ffd166', fillOpacity: 0.06 },
    joki: { color: '#2b8cbe', weight: 4 },
    reitti: { color: '#e5484d', weight: 3, dashArray: '4 6' },
    oletus: { color: '#4cc3d9', weight: 3, fillOpacity: 0.12 }
  };
  var POINT = { koski: '#2b8cbe', suvanto: '#7fc8e8', tupa: '#ffd166', laavu: '#ff9f43', parkki: '#cfd8dc', kohde: '#5bd18b' };
  var TYPE_NAMES = { alue: 'Alue', joki: 'Joki', koski: 'Koski', suvanto: 'Suvanto', tupa: 'Tupa', laavu: 'Laavu', parkki: 'Pysäköinti', reitti: 'Reitti', kohde: 'Kohde' };
  K.featureTitle = function (p) { return (p && (p.nimi || p.name)) || 'Kohde'; };

  /** Leaflet-taso tarkistetusta GeoJSONista. Napautus avaa tietokortin. */
  K.geoLayer = function (gj) {
    return L.geoJSON(gj, {
      pane: 'linePane',
      style: function (f) { var t = (f.properties || {}).tyyppi; return Object.assign({ pane: 'linePane', bubblingMouseEvents: false }, STYLE[t] || STYLE.oletus); },
      pointToLayer: function (f, ll) {
        var c = POINT[(f.properties || {}).tyyppi] || '#4cc3d9';
        return L.circleMarker(ll, { pane: 'linePane', radius: 9, color: '#10160f', weight: 2.5, fillColor: c, fillOpacity: 1, bubblingMouseEvents: false });
      },
      onEachFeature: function (f, l) {
        l.on('click', function (e) {
          if (K.measuring) { K.measureAdd(e.latlng); return; } // mittauksen aikana napautus lisää pisteen
          var p = f.properties || {}, ll = e.latlng;
          if (f.geometry.type === 'Point') ll = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
          K.tapInfo(ll, { title: K.featureTitle(p), detail: [TYPE_NAMES[p.tyyppi] || '', p.kuvaus || p.description || ''].filter(Boolean).join(' · '), targetName: K.featureTitle(p) });
        });
      }
    });
  };
  /** GeoJSONin rajaus [[s, w], [n, e]] (alue-tyyppiset polygonit ensisijaisesti). */
  K.gjBounds = function (gj) {
    var b = JG.areaBbox(gj);
    return b ? [[b[1], b[0]], [b[3], b[2]]] : null;
  };

  // ---------------------------------------------------------------------------
  // Mittaus
  // ---------------------------------------------------------------------------

  K.measuring = false;
  var pts = [], measureLayer = L.layerGroup().addTo(map);
  function addPoint(ll) { pts.push(ll); drawMeasure(); }
  function distLabel(text) { return L.divIcon({ className: 'dist-label', html: h('span', { text: text }), iconSize: null, iconAnchor: [-8, 8] }); }
  function drawMeasure() {
    measureLayer.clearLayers();
    if (pts.length > 1) L.polyline(pts, { pane: 'targetPane', color: '#FF6B35', weight: 4, interactive: false }).addTo(measureLayer);
    var total = 0;
    pts.forEach(function (p, i) {
      if (i > 0) total += JG.distance(pts[i - 1].lat, pts[i - 1].lng, p.lat, p.lng);
      L.circleMarker(p, { pane: 'targetPane', radius: 6, color: '#10160f', weight: 2, fillColor: '#FF6B35', fillOpacity: 1, interactive: false }).addTo(measureLayer);
      if (i > 0) L.marker(p, { interactive: false, keyboard: false, icon: distLabel(K.fmtDist(total)) }).addTo(measureLayer);
    });
    updateMeasureText();
  }
  function updateMeasureText() {
    var el = $('measureText');
    if (!pts.length) { el.textContent = 'Napauta karttaa lisätäksesi pisteitä.'; return; }
    var total = 0, n = pts.length, parts = [];
    for (var i = 1; i < n; i++) total += JG.distance(pts[i - 1].lat, pts[i - 1].lng, pts[i].lat, pts[i].lng);
    if (n > 1) {
      var a = pts[n - 2], b = pts[n - 1], brg = JG.bearing(a.lat, a.lng, b.lat, b.lng);
      parts.push('Matka ' + K.fmtDist(total) + ', viimeinen osuus ' + Math.round(brg) + '° ' + JG.dirName(brg));
    }
    var fm = K.fromMe(pts[n - 1].lat, pts[n - 1].lng);
    if (fm) parts.push(fm.replace('Sinusta', 'Viimeinen piste sinusta'));
    else if (n === 1) parts.push('Lisää toinen piste tai laita sijainti päälle.');
    el.textContent = parts.join(' · ');
    $('measureGo').hidden = !pts.length;
  }
  function setMeasuring(on) {
    K.measuring = on;
    $('measureBar').hidden = !on;
    if (on) { K.closeSheet(); K.closeCard(); }
    else { pts = []; drawMeasure(); }
    K.liftFabs();
  }
  K.setMeasuring = setMeasuring;
  K.measureAdd = addPoint;
  K.onMapClick(function (ll) { if (!K.measuring) return false; addPoint(ll); return true; }, 100);
  $('measureUndo').addEventListener('click', function () { pts.pop(); drawMeasure(); });
  $('measureClear').addEventListener('click', function () { pts = []; drawMeasure(); });
  $('measureDone').addEventListener('click', function () { setMeasuring(false); });
  var goBtn = h('button', { id: 'measureGo', type: 'button', class: 'btn', text: 'Suunnista', hidden: true, onclick: function () {
    var t = pts[pts.length - 1];
    if (!t) return;
    setMeasuring(false);
    K.setTarget({ lat: t.lat, lng: t.lng, name: 'Mitattu piste' });
  } });
  $('measureDone').parentNode.insertBefore(goBtn, $('measureDone'));
  K.on('pos', function () { if (K.measuring) updateMeasureText(); });

  // ---------------------------------------------------------------------------
  // Etäisyysrenkaat 1, 5 ja 20 km
  // ---------------------------------------------------------------------------

  var rings = L.layerGroup().addTo(map), ringsAt = null;
  function drawRings() {
    if (!settings.rings || !K.pos) { rings.clearLayers(); ringsAt = null; return; }
    // Piirretään uudelleen vain, kun sijainti on muuttunut yli 20 m.
    if (ringsAt && JG.distance(ringsAt[0], ringsAt[1], K.pos.lat, K.pos.lon) < 20) return;
    rings.clearLayers();
    var c = [K.pos.lat, K.pos.lon];
    ringsAt = c;
    [1000, 5000, 20000].forEach(function (r) {
      L.circle(c, { pane: 'linePane', radius: r, color: '#ffffff', weight: 2, opacity: 0.9, dashArray: '6 7', fill: false, interactive: false }).addTo(rings);
      L.circle(c, { pane: 'linePane', radius: r, color: '#10160f', weight: 4, opacity: 0.25, fill: false, interactive: false }).addTo(rings);
      var lbl = JG.destPoint(c[0], c[1], 0, r);
      L.marker(lbl, { interactive: false, keyboard: false, icon: L.divIcon({ className: 'dist-label', html: h('span', { text: K.fmtDist(r) }), iconSize: null }) }).addTo(rings);
    });
  }
  K.on('pos', drawRings);
  K.on('posoff', drawRings);

  // ---------------------------------------------------------------------------
  // Omat GeoJSON-tasot: tuodaan puhelimessa, tallentuvat vain tähän laitteeseen
  // ---------------------------------------------------------------------------

  var own = {}; // id -> {id, name, gj, layer}
  function addOwn(id, name, gj) {
    var layer = K.geoLayer(gj);
    own[id] = { id: id, name: name, gj: gj, layer: layer };
    if (!settings.hidden[id]) layer.addTo(map);
  }
  function loadOwn() {
    (store.get('imported', []) || []).forEach(function (x) {
      try { if (x && /^tuotu-[a-z0-9]+$/.test(x.id)) addOwn(x.id, String(x.nimi || 'Tuotu taso').slice(0, 60), JG.cleanGeoJSON(x.gj)); } catch (e) { /* ohitetaan viallinen */ }
    });
  }
  function importGeoJSON(f) {
    if (f.size > 2 * 1024 * 1024) { K.toast('Tiedosto on liian suuri (yli 2 Mt).'); return; }
    f.text().then(function (txt) {
      var gj = JG.cleanGeoJSON(JSON.parse(txt));
      var id = 'tuotu-' + Date.now().toString(36);
      var name = f.name.replace(/\.(geo)?json$/i, '').slice(0, 60) || 'Tuotu taso';
      var list = store.get('imported', []) || [];
      list.push({ id: id, nimi: name, gj: gj });
      if (!store.set('imported', list)) { K.toast('Tallennustila on täynnä.'); return; }
      addOwn(id, name, gj);
      var b = K.gjBounds(gj);
      if (b) K.fitBounds(b);
      K.closeSheet();
      K.toast('Taso tuotu: ' + name);
    }).catch(function (e) { K.toast('Tuonti epäonnistui: ' + (e && e.message ? e.message : 'virheellinen tiedosto')); });
  }
  function removeOwn(id) {
    var e = own[id];
    if (e) map.removeLayer(e.layer);
    delete own[id];
    delete settings.hidden[id]; K.saveSettings();
    store.set('imported', (store.get('imported', []) || []).filter(function (x) { return x.id !== id; }));
    if (K.offline.get(id)) K.offline.remove(id);
  }
  /** Tiedostonvalinta: avaa laitteen tiedostoselaimen. */
  K.pickFile = function (accept, onFile) {
    var input = h('input', { type: 'file', accept: accept, hidden: true });
    input.addEventListener('change', function () { if (input.files[0]) onFile(input.files[0]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  };

  function ownLayersSection(body) {
    var ids = Object.keys(own);
    body.appendChild(h('h3', { text: 'Omat tasot' }));
    if (!ids.length) body.appendChild(h('p', { class: 'muted small', text: 'Ei tuotuja tasoja. Piirrä taso geojson.io:ssa ja tuo se Työkalut-valikosta. Tuotu taso näkyy kaikissa osioissa.' }));
    ids.forEach(function (id) {
      var e = own[id], b = K.gjBounds(e.gj);
      body.appendChild(K.toggleRow(e.name, 'Tuotu taso, vain tässä laitteessa', !settings.hidden[id], function (v) {
        if (v) { delete settings.hidden[id]; e.layer.addTo(map); } else { settings.hidden[id] = true; map.removeLayer(e.layer); }
        K.saveSettings();
      }));
      body.appendChild(h('div', { class: 'btn-row' },
        b ? h('button', { type: 'button', class: 'btn', text: 'Näytä', onclick: function () { K.closeSheet(); K.fitBounds(b); } }) : null,
        b ? h('button', { type: 'button', class: 'btn', text: 'Offline', onclick: function () { openOfflineFor({ id: id, name: e.name, kind: 'taso', bounds: b }); } }) : null,
        h('button', { type: 'button', class: 'btn btn-danger', text: 'Poista', onclick: function () {
          if (confirm('Poistetaanko taso ' + e.name + '?')) { removeOwn(id); K.renderSheet(); }
        } })));
    });
    body.appendChild(h('h3', { text: 'Apuvälineet' }));
    body.appendChild(K.toggleRow('Etäisyysrenkaat 1, 5 ja 20 km', 'Näkyvät sijainnin ympärillä', settings.rings, function (v) {
      settings.rings = v; K.saveSettings(); drawRings(); if (v && !K.pos) K.toast('Renkaat näkyvät, kun sijainti on päällä.');
    }));
  }

  // ---------------------------------------------------------------------------
  // Offline: näkymä tai valittu alue
  // ---------------------------------------------------------------------------

  /** Näytöllä näkyvän alueen rajaus myös käännetyllä kartalla: [[s, w], [n, e]]. */
  K.visibleBounds = function () {
    if (!K.rot) { var b = map.getBounds(); return [[b.getSouth(), b.getWest()], [b.getNorth(), b.getEast()]]; }
    var W = window.innerWidth, H = window.innerHeight, top = 70, bottom = 70;
    var pts = [[0, top], [W, top], [W, H - bottom], [0, H - bottom]].map(function (p) { return K.rot.screenToLatLng(p); });
    var s = Math.min.apply(null, pts.map(function (p) { return p.lat; })), n = Math.max.apply(null, pts.map(function (p) { return p.lat; }));
    var w = Math.min.apply(null, pts.map(function (p) { return p.lng; })), e = Math.max.apply(null, pts.map(function (p) { return p.lng; }));
    return [[s, w], [n, e]];
  };
  function openOfflineFor(spec) {
    K.openSheet('offline-one', 'Tallenna offline', function (body) {
      body.appendChild(h('p', null, h('b', { text: spec.name })));
      if (!K.hasKey()) body.appendChild(h('div', { class: 'notice' }, 'Maastokartan tallennus vaatii MML:n API-avaimen. ',
        h('a', { href: '#', onclick: function (e) { e.preventDefault(); K.openSettings(); }, text: 'Lisää avain asetuksiin' }), '.'));
      body.appendChild(h('div', { class: 'card' }, K.offlineControls(spec)));
      body.appendChild(h('p', { class: 'muted small', text: 'Tee tallennus Wi-Fissä. Maanmittauslaitoksen avoin rajapinta on tarkoitettu pienimuotoiseen käyttöön, joten tallenna vain tarvitsemasi alue. Tarkkuuden voit vaihtaa asetuksista.' }));
    });
  }
  K.openOfflineFor = openOfflineFor;
  function saveView() {
    var b = K.visibleBounds(), d = new Date();
    var id = 'nakyma-' + Date.now().toString(36);
    openOfflineFor({ id: id, name: 'Näkymä ' + K.fmtDate(d) + ' klo ' + K.hm(d), kind: 'nakyma', bounds: b });
  }

  // ---------------------------------------------------------------------------
  // Valikot
  // ---------------------------------------------------------------------------

  K.on('tools', function (list) {
    list.appendChild(K.menuItem('ruler', 'Mittaa etäisyys ja suunta', 'Napauta pisteitä kartalle, suunnista viimeiseen', function () { setMeasuring(true); }));
    list.appendChild(K.menuItem('offline', 'Tallenna näkymä offline', 'Nykyinen kartta-alue maastoon ilman verkkoa', saveView));
    list.appendChild(K.menuItem('upload', 'Tuo GeoJSON-taso', 'geojson.io:ssa piirretyt alueet, kohteet ja reitit', function () {
      K.pickFile('.geojson,.json,application/geo+json,application/json', importGeoJSON);
    }));
  });
  K.on('start', function () {
    loadOwn();
    // Omat tasot ja apuvälineet tasopaneelin loppuun, osion tasojen jälkeen.
    K.on('layers', function (body) { ownLayersSection(body); });
  });
})();

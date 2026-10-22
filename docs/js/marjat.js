/*
 * Kaira: marjojen ja sienten kasvupaikka-arvio piirretyillä alueilla ja lupa-alueilla. Eränkäynnissä mustikka,
 * puolukka, kantarelli, suppilovahvero ja herkkutatti; metsästyksessä mustikka ja puolukka (lintujen ravintoa),
 * omilla kytkimillään. Tasot lasketaan GitHub Actionsissa MVMI-metsätiedosta (pipeline/marjat.py):
 * marjat.png (R mustikka, G puolukka) ja sienet.png (R kantarelli, G suppilovahvero, B herkkutatti) samassa
 * ruudukossa kuin alueen metsäkuva. Arvio kasvupaikasta, ei satoennuste.
 */
(function () {
  'use strict';

  var K = window.K, MK = window.MK, h = K.h, settings = K.settings, map = K.map;
  var MIN_ZOOM = 9, CACHE_MAX = 3, VIEW_AREAS = 3;
  var SECS = { erankaynti: { lajit: null, prefix: '' }, metsastys: { lajit: ['mustikka', 'puolukka'], prefix: 'm' } };
  var LAJIT = [
    { id: 'mustikka', nimi: 'Mustikka', set: 'bMustikka', file: 'marjat', ch: 'code', rgb: [123, 44, 191], kuvaus: 'Tuoreet kankaat, varttunut ja kohtalaisen tiheä metsä' },
    { id: 'puolukka', nimi: 'Puolukka', set: 'bPuolukka', file: 'marjat', ch: 'ht', rgb: [224, 49, 49], kuvaus: 'Kuivahkot ja kuivat mäntykankaat, valoisa metsä' },
    { id: 'kantarelli', nimi: 'Kantarelli', set: 'bKantarelli', file: 'sienet', ch: 'code', rgb: [245, 159, 0], kuvaus: 'Varttuneet havu- ja sekametsät tuoreilla ja kuivahkoilla kankailla' },
    { id: 'suppilovahvero', nimi: 'Suppilovahvero', set: 'bSuppilo', file: 'sienet', ch: 'ht', rgb: [141, 110, 99], kuvaus: 'Varttuneet kuusikot ja korvet' },
    { id: 'herkkutatti', nimi: 'Herkkutatti', set: 'bHerkku', file: 'sienet', ch: 'bl', rgb: [92, 61, 46], kuvaus: 'Nuoret ja keski-ikäiset havu- ja sekametsät' }
  ];
  LAJIT.forEach(function (l) { l.colors = [MK.packRGBA(l.rgb[0], l.rgb[1], l.rgb[2], 95), MK.packRGBA(l.rgb[0], l.rgb[1], l.rgb[2], 175)]; });

  var S = { areas: null, dec: {}, order: [], loading: {}, need: {} };
  /** Muisti: vanhimmat puretut kuvat pois, kun niitä on yli CACHE_MAX. Nykyisen näkymän kuvia ei poisteta, muuten ne purettaisiin joka siirrolla uudelleen. */
  function trim() {
    var old = S.order.filter(function (k) { return !S.need[k]; }), extra = S.order.length - CACHE_MAX;
    old.slice(0, Math.max(0, extra)).forEach(function (k) { delete S.dec[k]; });
    S.order = S.order.filter(function (k) { return !!S.dec[k]; });
  }
  function conf() { return SECS[K.section] || null; }
  function active() { return !!conf(); }
  function key(l) { return conf().prefix + l.set; }
  function shown() { var c = conf(); return c ? LAJIT.filter(function (l) { return !c.lajit || c.lajit.indexOf(l.id) >= 0; }) : []; }
  function enabled() { return shown().filter(function (l) { return settings[key(l)]; }); }
  function safeUrl(u) { return typeof u === 'string' && /^data\/[a-z0-9-]+\/(marjat|sienet|boundary)\.(png|geojson)(\?v=[a-z0-9]+)?$/.test(u) ? u : null; }

  function loadAreas() {
    if (S.areas) return Promise.resolve(S.areas);
    return K.fetchJSON('data/areas.json', { cache: 'no-cache' }).then(function (j) {
      S.areas = (j.areas || []).filter(function (a) {
        return a && /^[a-z0-9-]+$/.test(a.id) && a.forest && Array.isArray(a.forest.mercBounds) && safeUrl(a.marjat) && safeUrl(a.sienet);
      });
      return S.areas;
    }).catch(function () { S.areas = S.areas || []; return S.areas; });
  }

  /** Alueen ruudukko metsäkuvan tiedoista (kuvaa itseään ei tarvita). */
  function grid(a) { return MK.makeForest({ code: null, ht: null }, a.forest); }
  function viewMerc() {
    var b = map.getBounds(), p0 = MK.lonLatToMerc(b.getWest(), b.getSouth()), p1 = MK.lonLatToMerc(b.getEast(), b.getNorth());
    return [p0[0], p0[1], p1[0], p1[1]];
  }
  function overlaps(a, v) { var m = a.forest.mercBounds; return !(m[2] < v[0] || m[0] > v[2] || m[3] < v[1] || m[1] > v[3]); }

  function decoded(a, file) {
    var key = a.id + '|' + file, hit = S.dec[key];
    if (hit) { S.order = S.order.filter(function (k) { return k !== key; }).concat([key]); return Promise.resolve(hit); }
    if (S.loading[key]) return S.loading[key];
    S.loading[key] = fetch(safeUrl(a[file]), { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(K.decodePng)
      .then(function (dec) {
        var F = grid(a);
        if (dec.code.length !== F.w * F.h) throw new Error('Ruudukko ei täsmää');
        S.dec[key] = { F: F, code: dec.code, ht: dec.ht, bl: dec.bl };
        S.order.push(key);
        var d = S.dec[key];
        trim();
        return d;
      }).catch(function (e) {
        console.warn('Marja- tai sienitasoa ei saatu:', e && e.message);
        if (!navigator.onLine) K.toast('Marja- ja sienitasot vaativat verkon tai alueen offline-tallennuksen.');
        return null;
      }).then(function (d) { delete S.loading[key]; return d; });
    return S.loading[key];
  }

  var BerryLayer = L.GridLayer.extend({
    options: { pane: 'habitatPane', tileSize: 256, maxZoom: 20, updateWhenZooming: false, keepBuffer: 2 },
    createTile: function (coords) {
      var t = L.DomUtil.create('canvas', 'forest-tile'), sz = this.getTileSize();
      t.width = sz.x; t.height = sz.y;
      var ctx = t.getContext('2d'), img = ctx.createImageData(sz.x, sz.y), out = new Uint32Array(img.data.buffer), any = false;
      enabled().forEach(function (l) {
        (S.areas || []).forEach(function (a) {
          var d = S.dec[a.id + '|' + l.file];
          if (d && MK.renderHabitatTile(d.F, d[l.ch], coords.x, coords.y, coords.z, out, l.colors, sz.x)) any = true;
        });
      });
      if (any) ctx.putImageData(img, 0, 0);
      return t;
    }
  });
  var layer = new BerryLayer(), outlines = L.layerGroup(), outlined = {};

  function refresh() {
    var want = active() && enabled().length && map.getZoom() >= MIN_ZOOM;
    if (!want) {
      if (map.hasLayer(layer)) map.removeLayer(layer);
      if (map.hasLayer(outlines)) map.removeLayer(outlines);
      return;
    }
    loadAreas().then(function (areas) {
      if (!active()) return;
      var v = viewMerc(), files = {};
      enabled().forEach(function (l) { files[l.file] = true; });
      var jobs = [], vis = areas.filter(function (a) { return overlaps(a, v); }).slice(0, VIEW_AREAS);
      S.need = {};
      vis.forEach(function (a) { Object.keys(files).forEach(function (f) { S.need[a.id + '|' + f] = true; }); });
      trim();
      vis.forEach(function (a) {
        Object.keys(files).forEach(function (f) { jobs.push(decoded(a, f)); });
        if (!outlined[a.id] && safeUrl(a.boundary)) {
          outlined[a.id] = true;
          K.fetchJSON(safeUrl(a.boundary)).then(function (gj) {
            L.geoJSON(gj, { pane: 'boundaryPane', interactive: false, style: { color: '#5c3d2e', weight: 2, dashArray: '2 6', fill: false, opacity: 0.8 } }).addTo(outlines);
          }).catch(function () { outlined[a.id] = false; });
        }
      });
      return Promise.all(jobs).then(function () {
        if (!active()) return;
        if (!map.hasLayer(outlines)) outlines.addTo(map);
        if (!map.hasLayer(layer)) layer.addTo(map);
        layer.redraw();
      });
    });
  }
  K.on('section', function () { refresh(); });
  K.on('leave', function () { setTimeout(refresh, 0); });
  map.on('moveend', function () { if (active() && enabled().length) refresh(); });

  /** Pisteen marja- ja sienitiedot: [{laji, taso}] (taso 1 = sopiva, 2 = hyvä). */
  function at(ll) {
    var m = MK.lonLatToMerc(ll.lng, ll.lat), res = [];
    enabled().forEach(function (l) {
      (S.areas || []).forEach(function (a) {
        var d = S.dec[a.id + '|' + l.file];
        if (!d) return;
        var i = MK.sampleIndex(d.F, m[0], m[1]);
        if (i < 0) return;
        var lv = MK.habitatLevel(d[l.ch][i]);
        if (lv) res.push({ laji: l, taso: lv });
      });
    });
    return res;
  }
  /** Tietokorttiin lisättävä rivi (molemmat osiot): metsästyksessä metsätiedon korttiin, eränkäynnissä omaan korttiin. */
  K.berryNotice = function (ll) {
    if (!active() || !enabled().length || !ll) return null;
    var r = at(ll).sort(function (x, y) { return y.taso - x.taso; });
    if (!r.length) return null;
    return h('div', { class: 'berry-notice' },
      h('b', { text: r.map(function (x) { return x.laji.nimi + ': ' + (x.taso === 2 ? 'hyvä' : 'sopiva'); }).join(' · ') }),
      h('span', { class: 'small muted', text: 'Kasvupaikka-arvio metsätiedosta, ei satoennuste.' }));
  };
  // Eränkäynnissä marja- tai sienialueen napautus avaa oman kortin (metsästyksessä rivi tulee metsätiedon korttiin).
  K.onMapClick(function (ll) {
    if (K.section !== 'erankaynti' || !enabled().length || K.measuring || K.drawing || !at(ll).length) return false;
    K.tapInfo(ll, { title: 'Marjat ja sienet' });
    return true;
  }, 12);

  K.on('layers', function (body, sec) {
    if (!SECS[sec]) return;
    var hunt = sec === 'metsastys';
    body.appendChild(h('h3', { text: hunt ? 'Marjat (lintujen ravintoa)' : 'Marjat ja sienet' }));
    shown().forEach(function (l) {
      var k = key(l);
      var row = K.toggleRow(l.nimi, l.kuvaus, settings[k], function (v) { settings[k] = v; K.saveSettings(); refresh(); });
      var lbl = row.querySelector('span');
      if (lbl) lbl.insertBefore(h('span', { class: 'sw berry-sw', style: { background: 'rgb(' + l.rgb.join(',') + ')' } }), lbl.firstChild);
      body.appendChild(row);
    });
    var n = S.areas ? S.areas.length : null;
    body.appendChild(h('p', { class: 'muted small', text: 'Vahva väri = hyvä, haalea = sopiva kasvupaikka. Arvio metsätiedosta (Luke, MVMI), ei satoennuste. ' +
      'Tasot näkyvät vain piirretyillä alueilla ja lupa-alueilla' + (n !== null ? ' (' + n + ' aluetta)' : '') + ', kun karttaa on lähennetty. ' +
      (hunt ? 'Mustikka ja puolukka ovat metson, teeren ja pyyn tärkeää ravintoa. Tallenna lupa-alue offline-käyttöön, niin marjataso tulee mukaan.' :
        'Uusi alue: Työkalut → Piirrä alue → Lähetä analysoitavaksi.') }));
    if (!hunt && S.areas && S.areas.length && enabled().length) {
      S.areas.forEach(function (a) {
        var b = a.forest.bounds;
        body.appendChild(h('div', { class: 'btn-row btn-row-sub' },
          h('span', { class: 'small berry-area', text: a.name }),
          h('button', { type: 'button', class: 'btn btn-sm', text: 'Näytä', onclick: function () { K.closeSheet(); K.fitBounds(b); } }),
          h('button', { type: 'button', class: 'btn btn-sm', text: K.offline.get('marjat-' + a.id) ? 'Offline ✓' : 'Offline', onclick: function () {
            K.openOfflineFor({ id: 'marjat-' + a.id, name: a.name + ': marjat ja sienet', kind: 'marjat', bounds: b, version: a.version,
              dataUrls: [safeUrl(a.marjat), safeUrl(a.sienet), safeUrl(a.boundary)].filter(Boolean), extraBytes: Math.round((a.bytes || 0) * 0.5) });
          } })));
      });
    }
    if (!S.areas) loadAreas().then(function () { if (K.sheetName() === 'layers') K.renderSheet(); });
  });

  K.berries = { S: S, at: at, LAJIT: LAJIT, refresh: refresh };
})();

/*
 * Kaira / Metsästys: Metsähallituksen lupa-alueet, metsän ikä värikoodattuna, luonnonsuojelualueet,
 * uudet hakkuut, kanalintujen elinympäristö, tuuliviuhka, koiran hajuolosuhteet sekä havainnot ja saalis.
 * Toiminnot ovat Metsäkartasta (gitdaada/metsakartta). Merkinnät tallentuvat vain tähän laitteeseen.
 *
 * forest.png: R = 0 ei tietoa, 1 puuton, 2..255 ikä + 2 v; G = keskipituus 0,2 m:n portain.
 */
(function () {
  'use strict';

  var K = window.K, MK = window.MK, JG = window.JG, h = K.h, settings = K.settings, map = K.map, store = K.store;
  var SEC = 'metsastys';
  var S = { index: null, areas: [], area: null, forest: null, stats: null, boundaryGJ: null, protectedGJ: null, cutsGJ: null,
            layers: {}, hab: null, habArea: null, newAreas: {}, active: false, loadSeq: 0 };
  function active() { return K.section === SEC; }

  // ---------------------------------------------------------------------------
  // Metsäkerros
  // ---------------------------------------------------------------------------

  var ForestLayer = L.GridLayer.extend({
    options: { pane: 'forestPane', tileSize: 256, maxZoom: 20, updateWhenZooming: false, keepBuffer: 2 },
    createTile: function (coords) {
      var t = L.DomUtil.create('canvas', 'forest-tile'), sz = this.getTileSize();
      t.width = sz.x; t.height = sz.y;
      if (!S.forest) return t;
      var ctx = t.getContext('2d'), img = ctx.createImageData(sz.x, sz.y), out = new Uint32Array(img.data.buffer);
      if (MK.renderTile(S.forest, coords.x, coords.y, coords.z, out, renderOpts(), sz.x)) ctx.putImageData(img, 0, 0);
      return t;
    }
  });
  var forestLayer = new ForestLayer({ opacity: settings.opacity, attribution: 'Luke, Syke, Metsäkeskus (CC BY 4.0)' });
  var renderOptsCache = null;
  function renderOpts() {
    if (!renderOptsCache) {
      var hc = MK.COLORS.hatch;
      renderOptsCache = { palette: MK.buildPalette(settings.oldAge), taimikkoCode: Math.round(settings.taimikkoM * 5),
        treelessCode: Math.round(settings.treelessM * 5), hatchPeriod: 9, hatchWidth: 2, hatchColor: MK.packRGBA(hc[0], hc[1], hc[2], 255) };
    }
    return renderOptsCache;
  }
  function refreshForest() {
    renderOptsCache = null;
    if (S.forest) S.stats = MK.stats(S.forest, settings.oldAge, Math.round(settings.taimikkoM * 5), Math.round(settings.treelessM * 5));
    forestLayer.redraw();
    renderLegend();
  }
  function toggleLayer(layer, on) {
    if (!layer) return;
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) map.removeLayer(layer);
  }
  function applyLayerVisibility() {
    var a = active();
    toggleLayer(forestLayer, a && settings.showForest && !!S.forest);
    toggleLayer(S.layers.protCasing, a && settings.showProtected);
    toggleLayer(S.layers.prot, a && settings.showProtected);
    toggleLayer(S.layers.cutsCasing, a && settings.showCuts);
    toggleLayer(S.layers.cuts, a && settings.showCuts);
    toggleLayer(S.layers.mask, a && settings.showMask);
    toggleLayer(S.layers.mask2, a && settings.showMask);
    toggleLayer(S.layers.boundaryCasing, a);
    toggleLayer(S.layers.boundary, a);
    applyForestOpacity();
  }
  var rainDim = false;
  function applyForestOpacity() {
    var hab = settings.habitat !== 'off' && !!S.hab;
    forestLayer.setOpacity(settings.opacity * (rainDim ? 0.75 : 1) * (hab ? 0.55 : 1));
  }
  K.on('rainlayer', function (on) { rainDim = on; if (active()) applyForestOpacity(); });

  // ---------------------------------------------------------------------------
  // Selite
  // ---------------------------------------------------------------------------

  var legendOpen = false;
  var LegendControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      var div = L.DomUtil.create('div', 'legend');
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.disableScrollPropagation(div);
      this._div = div;
      setTimeout(renderLegend, 0);
      return div;
    }
  });
  var legend = new LegendControl();
  function sw(style, cls) { return h('span', { class: 'sw' + (cls ? ' ' + cls : ''), style: style || null }); }
  function legendItem(swatch, label, small) { return h('li', null, swatch, h('span', null, label, small ? h('small', { text: small }) : null)); }
  function renderLegend() {
    var div = legend._div;
    if (!div) return;
    var C = MK.COLORS, oa = settings.oldAge;
    div.textContent = '';
    div.classList.toggle('legend-closed', !legendOpen);
    if (!legendOpen) {
      var b = h('button', { type: 'button', class: 'legend-fab', 'aria-label': 'Näytä selite', 'aria-expanded': 'false' });
      var s = K.sv('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, b);
      K.sv('rect', { x: 2.5, y: 3.5, width: 6, height: 4.5, rx: 1, fill: MK.cssRGB(C.treeless) }, s);
      K.sv('rect', { x: 2.5, y: 9.75, width: 6, height: 4.5, rx: 1, fill: MK.cssRGB(C.young) }, s);
      K.sv('rect', { x: 2.5, y: 16, width: 6, height: 4.5, rx: 1, fill: MK.cssRGB(C.old) }, s);
      K.sv('path', { d: 'M11.5 5.75h10M11.5 12h10M11.5 18.25h10', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }, s);
      L.DomEvent.on(b, 'click', function (e) { L.DomEvent.stop(e); legendOpen = true; setTimeout(renderLegend, 0); });
      div.appendChild(b);
      return;
    }
    var close = h('button', { type: 'button', class: 'legend-close', 'aria-label': 'Piilota selite', 'aria-expanded': 'true' }, K.icon('close'));
    L.DomEvent.on(close, 'click', function (e) { L.DomEvent.stop(e); legendOpen = false; setTimeout(renderLegend, 0); });
    div.appendChild(h('div', { class: 'legend-head' }, h('span', { text: 'Selite' }), close));
    var ul = h('ul', { class: 'legend-list' });
    ul.appendChild(legendItem(sw({ background: MK.cssRGB(C.treeless) }), 'Puuton', settings.treelessM > 0 ? 'tai taimet alle ' + String(settings.treelessM).replace('.', ',') + ' m' : null));
    ul.appendChild(legendItem(sw({ background: 'linear-gradient(90deg,' + MK.cssRGB(C.young) + ',' + MK.cssRGB(C.middle) + ')' }), 'Metsä 0–' + (oa - 1) + ' v', 'vihreämpi = nuorempi'));
    ul.appendChild(legendItem(sw({ background: MK.cssRGB(C.old) }), 'Vanha metsä ≥ ' + oa + ' v'));
    ul.appendChild(legendItem(sw({ background: 'repeating-linear-gradient(135deg,' + MK.cssRGB(C.hatch) + ' 0 2px,' + MK.cssRGB(MK.ageColor(5, oa)) + ' 2px 7px)' }), 'Taimikko (alle ' + String(settings.taimikkoM).replace('.', ',') + ' m)'));
    ul.appendChild(legendItem(sw(null, 'sw-dash'), 'Luonnonsuojelualue'));
    ul.appendChild(legendItem(sw(null, 'sw-line'), 'Lupa-alueen raja'));
    if (settings.showWind) ul.appendChild(legendItem(sw(null, 'sw-wind'), 'Tuuliviuhka (hajusi kulku)'));
    if (settings.showRain) ul.appendChild(legendItem(sw(null, 'sw-rain'), 'Sade 0–2 h', 'heikko → kova'));
    if (settings.showObs && obsList.length) ul.appendChild(legendItem(h('span', { class: 'sw sw-obs' }, h('i', { class: 'obs-havainto' }), h('i', { class: 'obs-seisonta' }), h('i', { class: 'obs-saalis' })), 'Omat merkinnät', 'havainto, seisonta, saalis'));
    if (settings.habitat !== 'off') ul.appendChild(legendItem(sw(null, 'sw-hab2'), HAB_NAMES[settings.habitat] + 'n elinympäristö', 'vahva = hyvä, haalea = sopiva'));
    if (settings.showCuts) {
      ul.appendChild(legendItem(sw(null, 'sw-cut'), 'Uusi hakkuuaukko', ((S.index && S.index.mvmiYear) || 2023) + ' jälkeen, latvusmalli'));
      ul.appendChild(legendItem(sw(null, 'sw-cut-dash'), 'Hakkuuilmoitus', 'toteutuminen ei varmaa'));
    }
    div.appendChild(ul);
    if (S.stats && S.stats.total) {
      var st = S.stats, forest = st.young + st.old;
      div.appendChild(h('div', { class: 'legend-stats', text: 'Vanhaa metsää ' + K.pct(st.old, forest) + ' % metsästä · puutonta ' + K.pct(st.treeless, st.total) + ' % alasta' }));
    }
  }

  // ---------------------------------------------------------------------------
  // Lupa-alueet
  // ---------------------------------------------------------------------------

  function loadIndex() {
    var prevIds = ((store.get('index', null) || {}).areas || []).map(function (a) { return a.id; });
    return fetch('data/areas.json', { cache: 'no-cache', credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { store.set('index', j); return j; })
      .catch(function () { return store.get('index', { areas: [] }); })
      .then(function (j) {
        // Eränkäynnin alueet (osio erankaynti) ovat vain marja- ja sienitasoja varten, eivät lupa-alueita.
        S.index = j; S.areas = (j && Array.isArray(j.areas)) ? j.areas.filter(function (a) { return a && /^[a-z0-9-]+$/.test(a.id) && a.forest && a.osio !== 'erankaynti'; }) : [];
        S.prevIds = prevIds;
        return j;
      });
  }
  function findArea(id) { for (var i = 0; i < S.areas.length; i++) if (S.areas[i].id === id) return S.areas[i]; return null; }
  function checkNewAreas() {
    var known = store.get('knownAreas', null);
    if (!Array.isArray(known)) { known = S.prevIds && S.prevIds.length ? S.prevIds.slice() : S.areas.map(function (a) { return a.id; }); store.set('knownAreas', known); }
    var fresh = S.areas.filter(function (a) { return known.indexOf(a.id) < 0; });
    fresh.forEach(function (a) { S.newAreas[a.id] = true; });
    return fresh;
  }
  function markAreasSeen() {
    var known = store.get('knownAreas', []) || [];
    S.areas.forEach(function (a) { if (known.indexOf(a.id) < 0) known.push(a.id); });
    store.set('knownAreas', known.slice(-500));
  }

  function decodeImage(blob) {
    function fromBitmap(src, w, hgt) {
      var stripH = Math.max(1, Math.min(hgt, Math.floor(4000000 / w)));
      var c = document.createElement('canvas');
      c.width = w; c.height = stripH;
      var ctx = c.getContext('2d', { willReadFrequently: true }), all = new Uint8ClampedArray(w * hgt * 4);
      for (var y0 = 0; y0 < hgt; y0 += stripH) {
        var sh = Math.min(stripH, hgt - y0);
        ctx.clearRect(0, 0, w, stripH);
        ctx.drawImage(src, 0, y0, w, sh, 0, 0, w, sh);
        all.set(ctx.getImageData(0, 0, w, sh).data, y0 * w * 4);
      }
      return MK.decodeRGB(all, w, hgt);
    }
    if (window.createImageBitmap) {
      return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
        .catch(function () { return createImageBitmap(blob); })
        .then(function (bmp) { var d = fromBitmap(bmp, bmp.width, bmp.height); if (bmp.close) bmp.close(); return d; });
    }
    return new Promise(function (resolve, reject) {
      var img = new Image(), url = URL.createObjectURL(blob);
      img.onload = function () { URL.revokeObjectURL(url); resolve(fromBitmap(img, img.naturalWidth, img.naturalHeight)); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('Kuvan purku epäonnistui')); };
      img.src = url;
    });
  }
  K.decodePng = decodeImage; // myös eränkäynnin marja- ja sienitasot
  function loadForest(a) {
    return fetch(a.forest.file, { credentials: 'omit' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(decodeImage)
      .then(function (dec) {
        var ck = a.forest.checksum;
        if (ck && (dec.sumR !== ck.sumR || dec.sumG !== ck.sumG)) K.toast('Huom: laite muutti karttakuvaa, ikätiedot voivat olla hieman epätarkkoja.');
        return MK.makeForest(dec, a.forest);
      });
  }

  function clearAreaLayers() {
    Object.keys(S.layers).forEach(function (k) { if (S.layers[k]) { map.removeLayer(S.layers[k]); S.layers[k] = null; } });
    S.forest = null; S.stats = null; S.cutsGJ = null; S.hab = null; S.habArea = null; S.boundaryGJ = null; S.protectedGJ = null;
    if (map.hasLayer(habitatLayer)) map.removeLayer(habitatLayer);
    if (map.hasLayer(forestLayer)) map.removeLayer(forestLayer);
  }
  function eachPolygon(gj, fn) {
    (gj.features || []).forEach(function (f) {
      var g = f.geometry;
      if (!g) return;
      if (g.type === 'Polygon') fn(g.coordinates, f);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(function (p) { fn(p, f); });
    });
  }
  function ringToLatLngs(ring) { return ring.map(function (c) { return [c[1], c[0]]; }); }
  function isDetectedCut(p) { return !!p && p.lahde !== 'ilmoitus'; }

  function buildAreaLayers() {
    var bnd = S.boundaryGJ, prot = S.protectedGJ;
    var world = [[-85, -180], [-85, 180], [85, 180], [85, -180]], holes = [], inner = [];
    eachPolygon(bnd, function (rings) {
      holes.push(ringToLatLngs(rings[0]));
      for (var k = 1; k < rings.length; k++) inner.push(ringToLatLngs(rings[k]));
    });
    var maskStyle = { pane: 'maskPane', stroke: false, fillColor: '#0b0f0c', fillOpacity: 0.32, interactive: false };
    S.layers.mask = L.polygon([world].concat(holes), maskStyle);
    S.layers.mask2 = inner.length ? L.polygon(inner, maskStyle) : null;
    S.layers.boundaryCasing = L.geoJSON(bnd, { pane: 'boundaryPane', interactive: false, style: { color: '#ffffff', weight: 7, opacity: 0.85, fill: false } });
    S.layers.boundary = L.geoJSON(bnd, { pane: 'boundaryPane', interactive: false, style: { color: '#111111', weight: 3, opacity: 1, fill: false } });
    S.layers.protCasing = L.geoJSON(prot, { pane: 'protCasingPane', interactive: false, style: { color: '#1a1a1a', weight: 5.5, opacity: 0.55, fill: false } });
    S.layers.prot = L.geoJSON(prot, { pane: 'protPane', interactive: false,
      style: { color: '#ffd400', weight: 3, opacity: 1, dashArray: '9 7', lineCap: 'butt', fillColor: '#ffd400', fillOpacity: 0.06 } });
    var cuts = S.cutsGJ || { type: 'FeatureCollection', features: [] }, cutColor = MK.cssRGB(MK.COLORS.treeless);
    S.layers.cutsCasing = L.geoJSON(cuts, { pane: 'cutsPane', interactive: false, style: function (f) {
      return isDetectedCut(f.properties) ? { color: '#ffffff', weight: 5.5, opacity: 0.8, fill: false } :
        { color: '#ffffff', weight: 4.5, opacity: 0.6, fill: false, dashArray: '8 6', lineCap: 'butt' };
    } });
    S.layers.cuts = L.geoJSON(cuts, { pane: 'cutsPane', interactive: false, style: function (f) {
      return isDetectedCut(f.properties) ? { color: cutColor, weight: 2.5, opacity: 1, fillColor: cutColor, fillOpacity: 0.3 } :
        { color: cutColor, weight: 2.2, opacity: 1, dashArray: '8 6', lineCap: 'butt', fillColor: cutColor, fillOpacity: 0.06 };
    } });
    applyLayerVisibility();
  }
  function fitArea(a) { K.fitBounds(a.forest.bounds, { paddingTopLeft: [16, 150], paddingBottomRight: [80, legendOpen ? 260 : 110] }); }

  function selectArea(id, opts) {
    var a = findArea(id);
    if (!a) return Promise.resolve();
    opts = opts || {};
    clearAreaLayers();
    S.area = a;
    var seq = ++S.loadSeq;
    store.set('lastArea', id);
    if (!opts.keepView) fitArea(a);
    var empty = function () { return { type: 'FeatureCollection', features: [] }; };
    return Promise.all([K.fetchJSON(a.boundary), K.fetchJSON(a.protected).catch(empty), a.cuts ? K.fetchJSON(a.cuts).catch(empty) : empty()])
      .then(function (res) {
        if (seq !== S.loadSeq || !active()) return;
        S.boundaryGJ = res[0]; S.protectedGJ = res[1]; S.cutsGJ = res[2];
        buildAreaLayers();
        return loadForest(a).then(function (F) {
          if (seq !== S.loadSeq || !active()) return;
          S.forest = F;
          refreshForest();
          applyLayerVisibility();
          ensureHabitat();
        });
      })
      .catch(function (e) {
        console.error(e);
        if (!navigator.onLine && !K.offline.get('alue-' + a.id)) K.toast('Aluetta ei ole tallennettu offline-käyttöön.');
        else K.toast('Alueen lataus epäonnistui: ' + e.message);
      });
  }

  // ---------------------------------------------------------------------------
  // Kanalintujen elinympäristö
  // ---------------------------------------------------------------------------

  var HAB_NAMES = { metso: 'Metso', teeri: 'Teeri', pyy: 'Pyy' };
  var HAB_COLORS = [MK.packRGBA(255, 159, 26, 92), MK.packRGBA(255, 128, 0, 178)];
  var HabitatLayer = L.GridLayer.extend({
    options: { pane: 'habitatPane', tileSize: 256, maxZoom: 20, updateWhenZooming: false, keepBuffer: 2 },
    createTile: function (coords) {
      var t = L.DomUtil.create('canvas', 'forest-tile'), sz = this.getTileSize();
      t.width = sz.x; t.height = sz.y;
      var hab = S.hab && S.hab[settings.habitat];
      if (!S.forest || !hab) return t;
      var ctx = t.getContext('2d'), img = ctx.createImageData(sz.x, sz.y), out = new Uint32Array(img.data.buffer);
      if (MK.renderHabitatTile(S.forest, hab, coords.x, coords.y, coords.z, out, HAB_COLORS, sz.x)) ctx.putImageData(img, 0, 0);
      return t;
    }
  });
  var habitatLayer = new HabitatLayer();
  function ensureHabitat() {
    var a = S.area, want = active() && settings.habitat !== 'off' && a && a.habitat && S.forest;
    if (!want) { if (map.hasLayer(habitatLayer)) map.removeLayer(habitatLayer); applyForestOpacity(); return Promise.resolve(); }
    var ready = S.hab && S.habArea === a.id ? Promise.resolve() :
      fetch(a.habitat, { credentials: 'omit' }).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
        .then(decodeImage)
        .then(function (dec) {
          if (S.area !== a || !S.forest) return;
          if (dec.code.length !== S.forest.w * S.forest.h) throw new Error('Elinympäristön ruudukko ei täsmää');
          S.hab = { metso: dec.code, teeri: dec.ht, pyy: dec.bl }; S.habArea = a.id;
        });
    return ready.then(function () {
      if (S.area !== a || !active()) return;
      if (!map.hasLayer(habitatLayer)) habitatLayer.addTo(map);
      habitatLayer.redraw();
      applyForestOpacity();
    }).catch(function (e) {
      console.warn('Elinympäristöä ei saatu:', e && e.message);
      if (!navigator.onLine && !K.offline.get('alue-' + a.id)) K.toast('Elinympäristö vaatii verkon tai offline-tallennuksen.');
    });
  }
  function habitatAt(ll) {
    if (settings.habitat === 'off' || !S.hab || !S.forest) return null;
    var m = MK.lonLatToMerc(ll.lng, ll.lat), i = MK.sampleIndex(S.forest, m[0], m[1]);
    if (i < 0) return null;
    var lv = MK.habitatLevel(S.hab[settings.habitat][i]);
    return lv ? { species: settings.habitat, level: lv } : null;
  }

  // ---------------------------------------------------------------------------
  // Napautus: tiedot pisteestä
  // ---------------------------------------------------------------------------

  var CUT_SOURCE = { latvusmalli: 'latvusmalli', ilmakuva: 'ilmakuva' };
  function cutSourceText(p) { return (CUT_SOURCE[p.lahde] || 'kaukokartoitus') + (p.vuosi ? ' ' + p.vuosi : ''); }
  function fmtHa(v) { v = Number(v); return isFinite(v) && v > 0 ? (v < 10 ? v.toFixed(1).replace('.', ',') : K.fmtInt(v)) + ' ha' : ''; }
  function fmtMonth(d) { var m = /^(\d{4})-(\d{2})/.exec(String(d || '')); return m ? Number(m[2]) + '/' + m[1] : ''; }
  function tagRow(swCls, bold, rest, muted) {
    return h('div', { class: 'tag' }, h('span', { class: 'sw ' + swCls }), h('span', null, h('b', { text: bold }), rest ? ' ' + rest : '', muted ? h('span', { class: 'muted', text: ' (' + muted + ')' }) : null));
  }

  K.onMapClick(function (ll) {
    if (!active() || !S.area) return false;
    var info = null;
    if (S.forest) {
      var m = MK.lonLatToMerc(ll.lng, ll.lat), i = MK.sampleIndex(S.forest, m[0], m[1]);
      if (i >= 0) info = MK.describe(S.forest.code[i], S.forest.ht[i], settings.oldAge, settings.taimikkoM, settings.treelessM);
    }
    var prots = [], inside = false, cuts = [];
    if (S.protectedGJ) (S.protectedGJ.features || []).forEach(function (f) { if (MK.geometryContains(f.geometry, ll.lng, ll.lat)) prots.push(f.properties || {}); });
    if (S.boundaryGJ) (S.boundaryGJ.features || []).forEach(function (f) { if (MK.geometryContains(f.geometry, ll.lng, ll.lat)) inside = true; });
    if (S.cutsGJ && settings.showCuts) (S.cutsGJ.features || []).forEach(function (f) { if (MK.geometryContains(f.geometry, ll.lng, ll.lat)) cuts.push(f.properties || {}); });
    if (!info && !inside && !prots.length && !cuts.length) return false;

    var C = MK.COLORS, color = null;
    var detected = cuts.filter(isDetectedCut), declared = cuts.filter(function (p) { return !isDetectedCut(p); });
    if (info) color = info.kind === 'treeless' ? C.treeless : (info.kind === 'old' ? C.old : MK.ageColor(info.age, settings.oldAge));
    var title = info ? info.title : (inside ? 'Ei metsätietoa' : 'Lupa-alueen ulkopuolella');
    var detail = info ? info.detail : (inside ? 'Pelto, vesi tai muu kuin metsätalousmaa' : '');
    if (detected.length && info && info.kind !== 'treeless') {
      color = C.treeless;
      title = 'Hakkuuaukko (' + cutSourceText(detected[0]) + ')';
      detail = 'Metsätiedossa ' + ((S.index && S.index.mvmiYear) || '') + ': ' + info.title.toLowerCase() + ', ' + info.detail.charAt(0).toLowerCase() + info.detail.slice(1);
    }
    var extras = [];
    detected.forEach(function (p) { extras.push(tagRow('sw-cut', 'Uusi hakkuuaukko', '', cutSourceText(p) + (fmtHa(p.ha) ? ', ' + fmtHa(p.ha) : ''))); });
    declared.forEach(function (p) {
      var when = fmtMonth(p.pvm), state = p.vahv ? 'näkyy latvusmallissa ' + (p.vahvVuosi || '') : 'toteutuminen ei varmaa';
      extras.push(tagRow('sw-cut-dash', 'Hakkuuilmoitus', (when ? when : '') + (p.tapa ? ': ' + String(p.tapa).toLowerCase() : ''), state.trim()));
    });
    prots.forEach(function (p) { extras.push(tagRow('sw-dash', 'Suojelualue', p.nimi ? ': ' + p.nimi : '', p.tyyppi || '')); });
    var hl = habitatAt(ll);
    if (hl) extras.push(tagRow('sw-hab' + hl.level, HAB_NAMES[hl.species] + 'n elinympäristö', ': ' + (hl.level === 2 ? 'hyvä' : 'sopiva'), 'suuntaa antava malli'));
    if (info && !inside) extras.push(h('div', { class: 'warn-text', text: 'Lupa-alueen ulkopuolella' }));
    if (info) extras.push(h('div', { class: 'muted small', text: 'Satelliittiarvio 16 m ruudusta' }));
    K.tapInfo(ll, { title: title, detail: detail, detailMuted: !info, swatch: color ? MK.cssRGB(color) : null, extras: extras, targetName: 'Valittu kohta' });
    return true;
  }, 10);

  // ---------------------------------------------------------------------------
  // Tuuliviuhka: hajusi kulku sijainnistasi myötätuuleen
  // ---------------------------------------------------------------------------

  var windManual = (function (m) {
    return m && isFinite(Number(m.dir)) ? { dir: MK.norm360(Math.round(Number(m.dir))), at: Number(m.at) || Date.now() } : null;
  })(store.get('windManual', null));
  function currentWind() {
    if (windManual) return { dir: windManual.dir, spd: null, gust: null, manual: true, at: windManual.at };
    var e = K.wx.current();
    return e ? { dir: e.dir, spd: e.spd, gust: e.gust, t: e.t, manual: false } : null;
  }
  var REDUCED_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var FAN_RGB = '196,60,255';
  var WindFanLayer = L.Layer.extend({
    initialize: function () { this._fan = null; this._raf = 0; this._parts = []; this._last = 0; this._prev = 0; },
    setFan: function (fan) {
      var reseed = !this._fan || this._fan.bearing !== fan.bearing;
      this._fan = fan;
      if (reseed) this._seed();
      this._draw();
      return this;
    },
    onAdd: function (m) {
      var c = this._canvas = L.DomUtil.create('canvas', 'wind-canvas');
      c.setAttribute('aria-hidden', 'true');
      m.getPane('windPane').appendChild(c);
      m.on('zoomstart', this._hide, this);
      m.on('zoomend moveend resize viewreset', this._show, this);
      m.on('move rotate', this._draw, this);
      this._loopFn = this._loop.bind(this);
      this._show();
      if (!REDUCED_MOTION) this._raf = requestAnimationFrame(this._loopFn);
    },
    onRemove: function (m) {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      m.off('zoomstart', this._hide, this);
      m.off('zoomend moveend resize viewreset', this._show, this);
      m.off('move rotate', this._draw, this);
      L.DomUtil.remove(this._canvas);
      this._canvas = null;
    },
    _hide: function () { this._hidden = true; if (this._canvas) this._canvas.style.visibility = 'hidden'; },
    _show: function () { this._hidden = false; if (this._canvas) this._canvas.style.visibility = ''; this._draw(); },
    _seed: function () { this._parts = []; for (var i = 0; i < 26; i++) this._parts.push(this._newPart(Math.random())); },
    _newPart: function (s) { return { s: s, u: (Math.random() * 2 - 1) * 0.85, k: 0.7 + Math.random() * 0.6, ph: Math.random() * 6.283, sz: 0.7 + Math.random() * 0.6 }; },
    _loop: function (now) {
      this._raf = requestAnimationFrame(this._loopFn);
      if (document.visibilityState === 'hidden' || now - this._last < 33) return; // n. 30 kuvaa sekunnissa säästää akkua
      var dt = this._prev ? Math.min(0.1, (now - this._prev) / 1000) : 0;
      this._prev = now; this._last = now;
      var f = this._fan;
      if (f && dt) {
        var rate = 1 / Math.max(2.5, 7 - (f.spd === null ? 3 : f.spd) * 0.8);
        for (var i = 0; i < this._parts.length; i++) {
          var p = this._parts[i];
          p.s += dt * rate * p.k;
          if (p.s > 1) this._parts[i] = this._newPart(0);
        }
      }
      this._draw(now);
    },
    _draw: function (now) {
      var m = this._map, c = this._canvas, f = this._fan;
      if (!m || !c || this._hidden) return;
      var sz = m.getSize(), vr = K.rot ? K.rot.visibleRect() : { x: 0, y: 0, w: sz.x, h: sz.y };
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.round(vr.w * dpr) || c.height !== Math.round(vr.h * dpr)) {
        c.width = Math.round(vr.w * dpr); c.height = Math.round(vr.h * dpr);
        c.style.width = vr.w + 'px'; c.style.height = vr.h + 'px';
      }
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint(L.point(vr.x, vr.y)));
      var ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, -vr.x * dpr, -vr.y * dpr);
      ctx.clearRect(vr.x, vr.y, vr.w, vr.h);
      if (!f) return;
      var o = m.latLngToContainerPoint([f.lat, f.lon]), e = m.latLngToContainerPoint(MK.destPoint(f.lat, f.lon, f.bearing, f.len));
      var dx = e.x - o.x, dy = e.y - o.y, Lpx = Math.sqrt(dx * dx + dy * dy);
      if (Lpx < 6) return;
      var a = Math.atan2(dy, dx), hh = f.half * Math.PI / 180;
      var t = REDUCED_MOTION ? 0 : (typeof now === 'number' ? now : performance.now()) / 1000;
      var cosA = Math.cos(a), sinA = Math.sin(a), w0 = 7, tanH = Math.tan(hh), xEnd = Lpx * 0.9;
      function L2S(x, y) { return [o.x + x * cosA - y * sinA, o.y + x * sinA + y * cosA]; }
      function shape(scale) {
        var pts = [], n = 22, i, s, x, wob, b;
        var Wd = function (xx) { return (w0 + tanH * xx) * scale; };
        for (i = 0; i <= n; i++) { s = i / n; x = s * xEnd; wob = 1 + 0.13 * Math.sin(5.2 * s + t * 0.9) + 0.07 * Math.sin(11 * s - t * 1.3); pts.push(L2S(x, -Wd(x) * wob)); }
        var We = Wd(xEnd);
        for (i = 1; i < n; i++) {
          b = -Math.PI / 2 + Math.PI * i / n;
          wob = 1 + 0.12 * Math.sin(3 * b + t * 0.8) + 0.06 * Math.sin(7 * b - t * 1.2);
          pts.push(L2S(xEnd + We * 0.6 * Math.cos(b) * wob, We * Math.sin(b) * (1 + 0.05 * Math.sin(5 * b + t))));
        }
        for (i = n; i >= 0; i--) { s = i / n; x = s * xEnd; wob = 1 + 0.13 * Math.sin(4.7 * s - t * 0.8 + 1.7) + 0.07 * Math.sin(9.5 * s + t * 1.1); pts.push(L2S(x, Wd(x) * wob)); }
        for (i = 1; i < 8; i++) { b = Math.PI / 2 + Math.PI * i / 8; pts.push(L2S(w0 * scale * 0.8 * Math.cos(b), w0 * scale * Math.sin(b))); }
        return pts;
      }
      var grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, Lpx * 1.05);
      grad.addColorStop(0, 'rgba(' + FAN_RGB + ',0.95)');
      grad.addColorStop(0.3, 'rgba(' + FAN_RGB + ',0.7)');
      grad.addColorStop(0.7, 'rgba(' + FAN_RGB + ',0.3)');
      grad.addColorStop(1, 'rgba(' + FAN_RGB + ',0)');
      ctx.fillStyle = grad;
      for (var li = 0; li < 8; li++) {
        var pts = shape(1 - li * 0.1);
        ctx.globalAlpha = 0.16;
        ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
        for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (f.manual) {
        var op = shape(1);
        ctx.setLineDash([6, 5]); ctx.strokeStyle = 'rgba(' + FAN_RGB + ',0.75)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(op[0][0], op[0][1]);
        for (var j = 1; j < op.length; j++) ctx.lineTo(op[j][0], op[j][1]);
        ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
      }
      if (REDUCED_MOTION) return;
      for (var k = 0; k < this._parts.length; k++) {
        var pt = this._parts[k], px = pt.s * xEnd * 1.05;
        var xy = L2S(px, pt.u * (w0 + tanH * px) * (0.8 + 0.2 * Math.sin(t * 0.7 + pt.ph)) + 3 * Math.sin(t * 2.1 + pt.ph));
        var alpha = 0.7 * Math.min(1, pt.s * 8) * Math.pow(1 - pt.s, 1.3), rad = (1.6 + 4.2 * pt.s) * pt.sz;
        var pg = ctx.createRadialGradient(xy[0], xy[1], 0, xy[0], xy[1], rad);
        pg.addColorStop(0, 'rgba(248,226,255,' + alpha.toFixed(3) + ')');
        pg.addColorStop(1, 'rgba(' + FAN_RGB + ',0)');
        ctx.fillStyle = pg;
        ctx.beginPath(); ctx.arc(xy[0], xy[1], rad, 0, 6.2832); ctx.fill();
      }
    }
  });
  var fanLayer = null;
  function drawWindFan() {
    var w = currentWind();
    if (!active() || !settings.showWind || !w || !K.pos) { if (fanLayer) { map.removeLayer(fanLayer); fanLayer = null; } return; }
    var fan = { lat: K.pos.lat, lon: K.pos.lon, bearing: MK.norm360(w.dir + 180), half: MK.fanHalfAngle(w.spd), len: settings.fanLengthM, spd: w.spd, manual: !!w.manual };
    if (!fanLayer) fanLayer = new WindFanLayer().addTo(map);
    fanLayer.setFan(fan);
  }

  // ---------------------------------------------------------------------------
  // Koiran hajuolosuhteet
  // ---------------------------------------------------------------------------

  var SCENT_COLORS = { 'hyvä': '#22c55e', 'kohtalainen': '#f59e0b', 'heikko': '#ef4444' };
  function weatherAt(t) { var e = K.wx.at(t); return e && e.temp !== null && e.temp !== undefined ? e : null; }

  K.on('wxcard', function (card, sec) {
    if (sec !== SEC) return;
    if (settings.showScent) {
      var w = weatherAt(Date.now()), ix = w && MK.scentIndex(w);
      if (ix) card.appendChild(h('div', { class: 'wx-line' }, h('i', { class: 'dot', style: { background: SCENT_COLORS[ix.level] } }), h('span', { text: 'Haju: ' + ix.level })));
    }
    if (windManual) card.appendChild(h('div', { class: 'wx-line', text: 'Tuuli: oma havainto ' + MK.windFromName(windManual.dir) }));
  });

  K.on('wxsheet', function (body, sec) {
    if (sec !== SEC) return;
    // Koiran hajuolosuhteet
    var now = Date.now(), w = weatherAt(now), ix = w && MK.scentIndex(w);
    body.appendChild(h('h3', { text: 'Koiran hajuolosuhteet' }));
    if (!ix) body.appendChild(h('p', { class: 'muted', text: 'Sääennustetta ei ole saatavilla.' }));
    else {
      body.appendChild(h('div', { class: 'scent-now' }, h('i', { class: 'dot big', style: { background: SCENT_COLORS[ix.level] } }),
        h('div', null, h('div', { class: 'wind-title', text: 'Hajuolosuhteet: ' + ix.level }),
          h('div', { class: 'muted small', text: ix.notes.join(', ').replace(/^./, function (c) { return c.toUpperCase(); }) + '.' }))));
      var p = K.wherePoint(), day = MK.sunTimes(MK.localNoon(now, 0), p.lat, p.lon), best = null, list = h('div', { class: 'wind-list' });
      (K.wx.data.series || []).filter(function (e) { return e.t >= now - 30 * 60000 && e.t <= now + 12 * 3600000; }).forEach(function (e) {
        var x = MK.scentIndex(e);
        if (!x) return;
        var light = !day.rise || (e.t >= day.rise && e.t <= day.set);
        if (light && (!best || x.score > best.x.score)) best = { e: e, x: x };
        list.appendChild(h('div', { class: 'wind-row' }, h('span', { class: 'wind-t', text: K.hm(e.t) }),
          h('i', { class: 'dot', style: { background: SCENT_COLORS[x.level] } }),
          h('span', { text: x.level + ' · ' + K.fmt1(e.temp) + ' °C, ' + Math.round(e.rh) + ' %, ' + (e.spd !== null ? K.fmt1(e.spd) + ' m/s' : '–') })));
      });
      if (best) body.appendChild(h('p', null, h('b', { text: 'Paras valoisa aika 12 h sisällä: ' }), 'klo ' + K.hm(best.e.t) + ' (' + best.x.level + ')'));
      body.appendChild(list);
      body.appendChild(h('p', { class: 'muted small', text: 'Suuntaa antava arvio sääennusteesta. Viileä ja kostea sää sekä kohtalainen tuuli kantavat hajua yleensä parhaiten; helle, kuivuus, kova tuuli ja tyyni heikentävät.' }));
    }
    body.appendChild(K.toggleRow('Näytä hajuolosuhteet sääkortissa', null, settings.showScent, function (v) { settings.showScent = v; K.saveSettings(); K.renderWxCard(); }));

    // Tuuliviuhka
    body.appendChild(h('h3', { text: 'Tuuliviuhka' }));
    var cw = currentWind();
    if (cw) body.appendChild(h('p', { text: 'Hajusi kulkee ' + MK.windToName(cw.dir) + (cw.manual ? ' (oma havainto ' + K.fmtWhen(cw.at) + ')' : '') + '.' }));
    if (cw && !cw.manual && cw.spd !== null && cw.spd < 1.5) body.appendChild(h('div', { class: 'notice', text: 'Heikko tuuli: suunta on epävarma ja voi vaihdella, joten viuhka on leveä.' }));
    if (settings.showWind && !K.pos) body.appendChild(h('p', { class: 'muted small', text: 'Viuhka näkyy kartalla, kun oma sijainti on päällä.' }));
    body.appendChild(K.toggleRow('Näytä tuuliviuhka', 'Lähtee omasta sijainnistasi myötätuuleen', settings.showWind, function (v) { settings.showWind = v; K.saveSettings(); renderLegend(); drawWindFan(); }));
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Viuhkan pituus' }),
      K.seg([[100, '100 m'], [200, '200 m'], [300, '300 m'], [500, '500 m']], settings.fanLengthM, function (v) { settings.fanLengthM = v; K.saveSettings(); drawWindFan(); K.renderSheet(); })));
    body.appendChild(K.toggleRow('Käytä omaa tuulihavaintoa', 'Esim. savu, lumi tai kuiva heinä', !!windManual, function (v) {
      if (v) { var c = currentWind(); windManual = { dir: c ? Math.round(c.dir / 5) * 5 % 360 : 0, at: Date.now() }; } else windManual = null;
      store.set('windManual', windManual); drawWindFan(); K.renderWxCard(); K.renderSheet();
    }));
    if (windManual) {
      var lbl = h('div', { class: 'wind-manual-label' });
      var setLbl = function () { lbl.textContent = 'Tuuli ' + MK.windFromName(windManual.dir) + ' (' + windManual.dir + '°) → hajusi kulkee ' + MK.windToName(windManual.dir); };
      setLbl();
      var range = h('input', { type: 'range', min: '0', max: '355', step: '5', value: String(windManual.dir), 'aria-label': 'Tuulen tulosuunta asteina' });
      range.addEventListener('input', function () { windManual = { dir: Number(range.value), at: Date.now() }; setLbl(); drawWindFan(); });
      range.addEventListener('change', function () { store.set('windManual', windManual); K.renderWxCard(); });
      body.appendChild(h('div', { class: 'field' }, lbl, range,
        h('div', { class: 'wind-scale' }, h('span', { text: 'P' }), h('span', { text: 'I' }), h('span', { text: 'E' }), h('span', { text: 'L' }), h('span', { text: 'P' }))));
    }
    body.appendChild(h('p', { class: 'muted small', text: 'Ennuste kuvaa tuulta avoimessa maastossa 10 metrin korkeudella. Metsässä maan tasolla tuuli on heikompaa ja kääntyilee, joten viuhka näyttää vain yleissuunnan. Mitä heikompi tuuli, sitä leveämpi viuhka.' }));
  });

  // ---------------------------------------------------------------------------
  // Havainnot ja saalis (vain tässä laitteessa)
  // ---------------------------------------------------------------------------

  var OBS_SPECIES = [['metso', 'Metso', 'M'], ['teeri', 'Teeri', 'T'], ['pyy', 'Pyy', 'P'], ['riekko', 'Riekko', 'R'], ['muu', 'Muu', '?']];
  var OBS_TYPES = [['havainto', 'Havainto'], ['seisonta', 'Seisonta'], ['saalis', 'Saalis']];
  var OBS_SEX = [['', 'Ei tiedossa'], ['koiras', 'Koiras'], ['naaras', 'Naaras']];
  function nameOf(list, key) { for (var i = 0; i < list.length; i++) if (list[i][0] === key) return list[i][1]; return key; }
  function letterOf(key) { for (var i = 0; i < OBS_SPECIES.length; i++) if (OBS_SPECIES[i][0] === key) return OBS_SPECIES[i][2]; return '?'; }
  function sanitizeObs(o) {
    if (!o || typeof o !== 'object') return null;
    var lat = Number(o.lat), lon = Number(o.lon);
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return {
      id: String(o.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 20) || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      t: Number(o.t) || Date.now(), lat: lat, lon: lon, acc: o.acc === null || o.acc === '' || !isFinite(Number(o.acc)) ? null : Math.round(Number(o.acc)),
      laji: OBS_SPECIES.some(function (s) { return s[0] === o.laji; }) ? o.laji : 'muu',
      tyyppi: OBS_TYPES.some(function (s) { return s[0] === o.tyyppi; }) ? o.tyyppi : 'havainto',
      n: Math.max(1, Math.min(99, Math.round(Number(o.n) || 1))),
      sp: OBS_SEX.some(function (s) { return s[0] === o.sp; }) ? o.sp : '',
      note: typeof o.note === 'string' ? o.note.slice(0, 120) : '',
      area: typeof o.area === 'string' ? o.area.slice(0, 80) : ''
    };
  }
  var obsList = (store.get('obs', []) || []).map(sanitizeObs).filter(Boolean);
  function saveObs() { if (!store.set('obs', obsList)) K.toast('Tallennustila on täynnä: merkintää ei tallennettu.'); }
  var obsLayer = L.layerGroup();

  function renderObsMarkers() {
    obsLayer.clearLayers();
    if (!active() || !settings.showObs) { if (map.hasLayer(obsLayer)) map.removeLayer(obsLayer); return; }
    if (!map.hasLayer(obsLayer)) obsLayer.addTo(map);
    obsList.forEach(function (o) {
      var m = L.marker([o.lat, o.lon], { keyboard: false, title: nameOf(OBS_SPECIES, o.laji) + ', ' + nameOf(OBS_TYPES, o.tyyppi),
        icon: L.divIcon({ className: '', iconSize: [0, 0], html: h('div', { class: 'obs-pin obs-' + o.tyyppi, text: letterOf(o.laji) }) }) });
      m.on('click', function (e) { if (K.measuring) { K.measureAdd(e.latlng); return; } showObsInfo(o); });
      obsLayer.addLayer(m);
    });
    if (legendOpen) renderLegend();
  }
  function showObsInfo(o) {
    K.showCard({
      badge: h('span', { class: 'obs-pin obs-pin-static obs-' + o.tyyppi, text: letterOf(o.laji) }),
      title: nameOf(OBS_SPECIES, o.laji) + ' · ' + nameOf(OBS_TYPES, o.tyyppi),
      detail: K.fmtDate(o.t) + ' klo ' + K.hm(o.t) + ' · ' + o.n + ' kpl' + (o.sp ? ' · ' + nameOf(OBS_SEX, o.sp).toLowerCase() : '') + (o.note ? ' · ' + o.note : ''),
      meta: [K.fmtLatLon(o.lat, o.lon)].concat(o.area ? [o.area] : []).concat(K.fromMe(o.lat, o.lon) ? [K.fromMe(o.lat, o.lon)] : []),
      actions: [
        { label: 'Suunnista tänne', primary: true, fn: function () { K.closeCard(); K.setTarget({ lat: o.lat, lng: o.lon, name: nameOf(OBS_SPECIES, o.laji) + ', ' + nameOf(OBS_TYPES, o.tyyppi).toLowerCase() }); } },
        { label: 'Poista', danger: true, fn: function () {
          if (!confirm('Poistetaanko merkintä?')) return;
          obsList = obsList.filter(function (x) { return x.id !== o.id; });
          saveObs(); renderObsMarkers(); K.closeCard(); K.toast('Merkintä poistettu.');
        } }
      ]
    });
  }

  var draft = null, picking = false;
  function newDraft() {
    var gps = K.pos && Date.now() - K.pos.t < 120000;
    return { laji: 'metso', tyyppi: 'havainto', n: 1, sp: '', note: '', loc: gps ? { lat: K.pos.lat, lon: K.pos.lon, acc: K.pos.acc, src: 'gps' } : null };
  }
  function segRow(label, list, key) {
    return h('div', { class: 'field' }, h('span', { class: 'label', text: label }),
      K.seg(list.map(function (o) { return [o[0], o[1]]; }), draft[key], function (v) { draft[key] = v; K.renderSheet(); }, { cls: 'seg-compact', label: label }));
  }
  function renderObsForm(body) {
    var d = draft || (draft = newDraft());
    body.classList.add('obs-form');
    var locTxt = d.loc ? (d.loc.src === 'gps' ? 'Oma sijainti' + (d.loc.acc ? ' (±' + K.fmtInt(d.loc.acc) + ' m)' : '') : 'Kartalta valittu kohta') + ' · ' + K.fmtLatLon(d.loc.lat, d.loc.lon) : 'Paikkaa ei ole valittu';
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Paikka' }), h('div', { class: d.loc ? 'coords' : 'warn-text', text: locTxt }),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', text: K.pos ? 'Oma sijainti' : 'Hae sijainti', onclick: function () {
          if (!K.pos) { K.startGps(false); K.toast('Haetaan sijaintia…'); return; }
          d.loc = { lat: K.pos.lat, lon: K.pos.lon, acc: K.pos.acc, src: 'gps' }; K.renderSheet();
        } }),
        h('button', { type: 'button', class: 'btn', text: 'Valitse kartalta', onclick: function () { picking = true; K.closeSheet(); K.toast('Napauta karttaa merkinnän kohdalla.', null, 6000); } }))));
    body.appendChild(segRow('Laji', OBS_SPECIES, 'laji'));
    body.appendChild(segRow('Tyyppi', OBS_TYPES, 'tyyppi'));
    var n = h('input', { class: 'input stepper-n', type: 'number', inputmode: 'numeric', min: '1', max: '99', value: String(d.n), 'aria-label': 'Määrä' });
    function setN(v) { d.n = Math.max(1, Math.min(99, Math.round(Number(v) || 1))); n.value = String(d.n); }
    n.addEventListener('change', function () { setN(n.value); });
    body.appendChild(h('div', { class: 'field field-inline' }, h('span', { class: 'label', text: 'Määrä' }),
      h('div', { class: 'stepper' }, h('button', { type: 'button', class: 'btn', 'aria-label': 'Vähemmän', text: '−', onclick: function () { setN(d.n - 1); } }), n,
        h('button', { type: 'button', class: 'btn', 'aria-label': 'Enemmän', text: '+', onclick: function () { setN(d.n + 1); } }))));
    body.appendChild(segRow('Sukupuoli', OBS_SEX, 'sp'));
    var note = h('input', { class: 'input', type: 'text', maxlength: '120', placeholder: 'Lisätieto (valinnainen)', 'aria-label': 'Lisätieto' });
    note.value = d.note;
    note.addEventListener('input', function () { d.note = note.value.slice(0, 120); });
    body.appendChild(h('div', { class: 'field' }, note));
    body.appendChild(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Tallenna', disabled: !d.loc, onclick: function () {
        var o = sanitizeObs({ t: Date.now(), lat: d.loc.lat, lon: d.loc.lon, acc: d.loc.src === 'gps' ? d.loc.acc : null, laji: d.laji, tyyppi: d.tyyppi,
          n: d.n, sp: d.sp, note: d.note, area: S.area ? S.area.name : '' });
        obsList.push(o); saveObs(); draft = null; K.closeSheet(); renderObsMarkers();
        K.toast('Tallennettu: ' + nameOf(OBS_SPECIES, o.laji) + ', ' + nameOf(OBS_TYPES, o.tyyppi).toLowerCase() + '.');
      } }),
      h('button', { type: 'button', class: 'btn', text: 'Kaikki merkinnät (' + obsList.length + ')', onclick: function () { K.openSheet('obs-list', 'Havainnot ja saalis', renderObsList); } })));
  }
  K.onMapClick(function (ll) {
    if (!picking) return false;
    picking = false;
    if (!draft) draft = newDraft();
    draft.loc = { lat: ll.lat, lon: ll.lng, acc: null, src: 'map' };
    openObsForm();
    return true;
  }, 90);
  function openObsForm() { K.openSheet('obs-new', 'Uusi merkintä', renderObsForm); }
  K.on('pos', function () { if (K.sheetName() === 'obs-new' && draft && !draft.loc) { draft.loc = { lat: K.pos.lat, lon: K.pos.lon, acc: K.pos.acc, src: 'gps' }; K.renderSheet(); } });

  function seasonStart(now) {
    var d = new Date(now), y = d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
    return { t: new Date(y, 7, 1).getTime(), label: y + '–' + (y + 1) };
  }
  function catchSummary() {
    var se = seasonStart(Date.now()), by = {};
    obsList.filter(function (o) { return o.tyyppi === 'saalis' && o.t >= se.t; }).forEach(function (o) {
      var b = by[o.laji] || (by[o.laji] = { n: 0, koiras: 0, naaras: 0, areas: {} });
      b.n += o.n; if (o.sp) b[o.sp] += o.n; if (o.area) b.areas[o.area] = (b.areas[o.area] || 0) + o.n;
    });
    return { label: se.label, lines: Object.keys(by).map(function (k) {
      var b = by[k], sx = [];
      if (b.koiras) sx.push(b.koiras + ' koiras');
      if (b.naaras) sx.push(b.naaras + ' naaras');
      return nameOf(OBS_SPECIES, k) + ' ' + b.n + (sx.length ? ' (' + sx.join(', ') + ')' : '') +
        (Object.keys(b.areas).length ? ' – ' + Object.keys(b.areas).map(function (a) { return a + ' ' + b.areas[a]; }).join(', ') : '');
    }) };
  }
  /** CSV-solu: ei kaavoja taulukko-ohjelmassa. */
  K.csvCell = function (v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  /** CSV (puolipiste-erotin, lainausmerkit) -> rivit. */
  K.parseCsv = function (txt) {
    txt = String(txt || '').replace(/^﻿/, '');
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < txt.length; i++) {
      var c = txt[i];
      if (q) {
        if (c === '"') { if (txt[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ';') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && txt[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map(function (r) { return r.map(function (v) { return /^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v; }); })
      .filter(function (r) { return r.some(function (v) { return v.trim(); }); });
  };
  function importMkCsv(file) {
    if (file.size > 3 * 1024 * 1024) { K.toast('Tiedosto on liian suuri.'); return; }
    file.text().then(function (txt) {
      var rows = K.parseCsv(txt), head = rows.shift() || [];
      var col = {}; head.forEach(function (k, i) { col[k.trim().toLowerCase()] = i; });
      if (col.aika === undefined || col.lat === undefined || col.lon === undefined || col.laji === undefined) throw new Error('Tiedosto ei ole Metsäkartan merkintätiedosto.');
      var seen = {}, added = 0, skipped = 0;
      obsList.forEach(function (o) { seen[[o.t, o.lat.toFixed(5), o.lon.toFixed(5), o.laji, o.tyyppi].join('|')] = 1; });
      rows.forEach(function (r) {
        var g = function (k) { return col[k] === undefined ? '' : (r[col[k]] || '').trim(); };
        var o = sanitizeObs({ t: Date.parse(g('aika')), lat: Number(g('lat')), lon: Number(g('lon')), acc: g('tarkkuus_m'), laji: g('laji'), tyyppi: g('tyyppi'),
          n: g('maara'), sp: g('sukupuoli'), area: g('alue'), note: g('lisatieto') });
        if (!o || !isFinite(Date.parse(g('aika')))) { skipped++; return; }
        var key = [o.t, o.lat.toFixed(5), o.lon.toFixed(5), o.laji, o.tyyppi].join('|');
        if (seen[key]) { skipped++; return; }
        seen[key] = 1; obsList.push(o); added++;
      });
      saveObs(); renderObsMarkers(); K.renderSheet();
      K.toast('Tuotu ' + added + ' merkintää' + (skipped ? ', ohitettu ' + skipped + ' (jo tallessa tai virheellinen)' : '') + '.', null, 6000);
    }).catch(function (e) { K.toast('Tuonti epäonnistui: ' + (e && e.message ? e.message : 'virheellinen tiedosto'), null, 6000); });
  }
  function renderObsList(body) {
    var sm = catchSummary();
    body.appendChild(h('h3', { text: 'Saalis kaudella ' + sm.label }));
    body.appendChild(sm.lines.length ? h('ul', { class: 'feature-list' }, sm.lines.map(function (l) { return h('li', { text: l }); })) :
      h('p', { class: 'muted', text: 'Ei saalismerkintöjä tällä kaudella.' }));
    var row = h('div', { class: 'btn-row' });
    row.appendChild(h('button', { type: 'button', class: 'btn btn-primary', text: 'Uusi merkintä', onclick: function () { draft = null; openObsForm(); } }));
    if (sm.lines.length) row.appendChild(h('button', { type: 'button', class: 'btn', text: 'Kopioi yhteenveto', onclick: function () {
      var txt = 'Saalis ' + sm.label + ':\n' + sm.lines.join('\n');
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { K.toast('Yhteenveto kopioitu.'); }, function () { K.toast('Kopiointi ei onnistunut.'); });
    } }));
    if (obsList.length) row.appendChild(h('button', { type: 'button', class: 'btn', text: 'Lataa CSV', onclick: function () {
      var rows = [['aika', 'laji', 'tyyppi', 'maara', 'sukupuoli', 'lat', 'lon', 'tarkkuus_m', 'alue', 'lisatieto']].concat(obsList.map(function (o) {
        return [new Date(o.t).toISOString(), o.laji, o.tyyppi, o.n, o.sp, o.lat.toFixed(6), o.lon.toFixed(6), o.acc === null ? '' : o.acc, o.area, o.note];
      }));
      K.download('﻿' + rows.map(function (r) { return r.map(K.csvCell).join(';'); }).join('\r\n'), 'kaira-merkinnat.csv', 'text/csv;charset=utf-8');
    } }));
    body.appendChild(row);
    body.appendChild(h('h3', { text: 'Merkinnät (' + obsList.length + ')' }));
    obsList.slice().sort(function (a, b) { return b.t - a.t; }).slice(0, 200).forEach(function (o) {
      body.appendChild(h('div', { class: 'obs-row' },
        h('span', { class: 'obs-pin obs-pin-static obs-' + o.tyyppi, text: letterOf(o.laji) }),
        h('div', { class: 'obs-txt' }, h('b', { text: nameOf(OBS_SPECIES, o.laji) + ' · ' + nameOf(OBS_TYPES, o.tyyppi) + (o.n > 1 ? ' · ' + o.n : '') }),
          h('small', { text: K.fmtDate(o.t) + ' klo ' + K.hm(o.t) + (o.area ? ' · ' + o.area : '') + (o.note ? ' · ' + o.note : '') })),
        h('button', { type: 'button', class: 'btn', text: 'Näytä', onclick: function () { K.closeSheet(); map.setView([o.lat, o.lon], Math.max(map.getZoom(), 15)); showObsInfo(o); } })));
    });
    body.appendChild(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn', text: 'Tuo Metsäkartan merkinnät (CSV)', onclick: function () { K.pickFile('.csv,text/csv', importMkCsv); } }),
      obsList.length ? h('button', { type: 'button', class: 'btn btn-danger', text: 'Poista kaikki', onclick: function () {
        if (!confirm('Poistetaanko kaikki metsästysmerkinnät tästä puhelimesta?')) return;
        obsList = []; saveObs(); renderObsMarkers(); K.renderSheet(); K.toast('Merkinnät poistettu.');
      } }) : null));
    body.appendChild(h('p', { class: 'muted small', text: 'Merkinnät tallentuvat vain tähän puhelimeen eivätkä lähde minnekään. Saalisilmoitus tehdään erikseen eräluvat.fi-palvelussa. Metsäkartan merkinnät saat siirrettyä lataamalla ne Metsäkartasta CSV-tiedostona ja tuomalla tänne.' }));
  }

  // ---------------------------------------------------------------------------
  // Paneelit
  // ---------------------------------------------------------------------------

  function areaSpec(a) {
    return { id: 'alue-' + a.id, name: a.name, kind: 'lupa-alue', bounds: a.forest.bounds, version: a.version,
      dataUrls: [a.forest.file, a.boundary, a.protected, a.cuts, a.habitat], extraBytes: a.bytes || 0, cleanPrefix: 'data/' + a.id + '/' };
  }
  function renderAreasSheet(body) {
    markAreasSeen();
    if (!K.hasKey()) body.appendChild(h('div', { class: 'notice' }, 'Maastokartan offline-tallennus vaatii Maanmittauslaitoksen API-avaimen. Ilman avainta tallentuu vain metsätieto. ',
      h('a', { href: '#', onclick: function (e) { e.preventDefault(); K.openSettings(); }, text: 'Asetuksiin' }), '.'));
    if (!S.areas.length) { body.appendChild(h('p', { class: 'muted', text: 'Lupa-alueita ei ole vielä. Lisää aluerajaus repon areas/metsastys-kansioon, niin kartta valmistuu muutamassa minuutissa.' })); return; }
    S.areas.forEach(function (a) {
      var activeA = S.area && S.area.id === a.id;
      var sub = K.fmtInt(a.areaHa) + ' ha' + (a.protectedCount ? ' · ' + a.protectedCount + ' suojelualue' + (a.protectedCount === 1 ? '' : 'tta') : '') + (a.cutsCount ? ' · ' + a.cutsCount + ' uutta hakkuuaukkoa' : '');
      body.appendChild(h('div', { class: 'card' + (activeA ? ' active' : '') },
        h('button', { type: 'button', class: 'card-main', onclick: function () { K.closeSheet(); selectArea(a.id); } },
          h('div', { class: 'card-title' }, a.name, S.newAreas[a.id] ? h('span', { class: 'badge-new', text: 'Uusi' }) : null),
          h('div', { class: 'card-sub', text: sub })),
        K.offlineControls(areaSpec(a), { compact: true, onDone: function (err) { if (!err && S.area && S.area.id === a.id) selectArea(a.id, { keepView: true }); } })));
    });
    var gen = S.index && S.index.generated;
    if (gen) body.appendChild(h('p', { class: 'muted small', text: 'Kartat päivitetty ' + K.fmtDate(Date.parse(gen)) + ' · Metsätieto MVMI ' + (S.index.mvmiYear || '') + '. Rajat on piirretty käsin: virallinen raja on eräluvat.fi:n kartassa.' }));
  }
  function openAreas() { K.openSheet('areas', 'Lupa-alueet', renderAreasSheet); }

  K.on('layers', function (body, sec) {
    if (sec !== SEC) return;
    body.appendChild(h('h3', { text: 'Metsän ikä' }));
    body.appendChild(K.toggleRow('Näytä metsän ikä', S.area ? S.area.name : 'Valitse lupa-alue', settings.showForest, function (v) { settings.showForest = v; K.saveSettings(); applyLayerVisibility(); }));
    var range = h('input', { type: 'range', min: '0.2', max: '1', step: '0.05', value: String(settings.opacity), 'aria-label': 'Peittävyys' });
    range.addEventListener('input', function () { settings.opacity = Number(range.value); applyForestOpacity(); });
    range.addEventListener('change', K.saveSettings);
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Peittävyys' }), range));
    body.appendChild(K.toggleRow('Luonnonsuojelualueet', 'Keltainen katkoviiva', settings.showProtected, function (v) { settings.showProtected = v; K.saveSettings(); applyLayerVisibility(); }));
    body.appendChild(K.toggleRow('Uudet hakkuut', 'Metsätiedon jälkeen tehdyt aukot ja hakkuuilmoitukset', settings.showCuts, function (v) { settings.showCuts = v; K.saveSettings(); applyLayerVisibility(); renderLegend(); }));
    body.appendChild(K.toggleRow('Himmennä lupa-alueen ulkopuoli', null, settings.showMask, function (v) { settings.showMask = v; K.saveSettings(); applyLayerVisibility(); }));
    body.appendChild(h('h3', { text: 'Kanalintujen elinympäristö' }));
    body.appendChild(K.seg([['off', 'Pois'], ['metso', 'Metso'], ['teeri', 'Teeri'], ['pyy', 'Pyy']], settings.habitat, function (v) {
      settings.habitat = v; K.saveSettings(); ensureHabitat(); renderLegend(); K.renderSheet();
    }, { label: 'Elinympäristö' }));
    body.appendChild(h('p', { class: 'muted small', text: S.area && !S.area.habitat ? 'Tälle alueelle ei ole vielä laskettu elinympäristöä.' :
      'Suuntaa antava malli metsätiedosta: puulajit, ikä, latvuspeitto, kasvupaikka ja hakkuut. Vahva väri = hyvä, haalea = sopiva.' }));
    body.appendChild(h('h3', { text: 'Jahtiapurit' }));
    body.appendChild(K.toggleRow('Tuuliviuhka', 'Hajusi kulku sijainnistasi myötätuuleen', settings.showWind, function (v) { settings.showWind = v; K.saveSettings(); renderLegend(); drawWindFan(); }));
    body.appendChild(K.toggleRow('Havainnot ja saalis', 'Merkinnät tallentuvat vain tähän puhelimeen', settings.showObs, function (v) { settings.showObs = v; K.saveSettings(); renderObsMarkers(); }));
  });

  K.on('settings', function (body) {
    body.appendChild(h('h3', { text: 'Metsästys: metsän värit' }));
    function nf(id, label, val, min, max, step, hint, set) {
      return K.numberField(id, label, val, min, max, step, hint, function (v) { set(v); refreshForest(); });
    }
    body.appendChild(nf('oldAge', 'Vanhan metsän raja (v)', settings.oldAge, 20, 250, 5, 'Vähintään tämän ikäinen metsä näkyy sinisenä.', function (v) { settings.oldAge = Math.round(v); }));
    body.appendChild(nf('treelessM', 'Puuttoman raja (m)', settings.treelessM, 0, 3, 0.1, 'Uudistusala, jonka taimet ovat tätä matalampia, näkyy punaisena aukkona. 0 = vain täysin puuton.', function (v) { settings.treelessM = v; }));
    body.appendChild(nf('taimikkoM', 'Taimikon pituusraja (m)', settings.taimikkoM, 1, 15, 0.5, 'Tätä matalampi metsä merkitään vinoviivoin.', function (v) { settings.taimikkoM = v; }));
  });

  K.on('menu', function (list, sec) {
    if (sec !== SEC) return;
    list.appendChild(K.menuItem('pinPlus', 'Havainnot ja saalis', obsList.length + ' merkintää · CSV-vienti ja -tuonti', function () { K.openSheet('obs-list', 'Havainnot ja saalis', renderObsList); }));
  });

  K.defineNav(SEC, {
    main: { label: 'Merkitse', icon: 'pinPlus', sheet: 'obs-new', fn: function () { draft = null; openObsForm(); } },
    info: { label: 'Lupa-alue', icon: 'area', sheet: 'areas', fn: openAreas }
  });

  // ---------------------------------------------------------------------------
  // Osion vaihto
  // ---------------------------------------------------------------------------

  function enter() {
    legend.addTo(map);
    renderObsMarkers();
    drawWindFan();
    loadIndex().then(function () {
      if (!active()) return;
      var fresh = checkNewAreas(), last = store.get('lastArea', null);
      if (last && findArea(last)) selectArea(last, { keepView: true });
      else if (S.areas.length === 1) selectArea(S.areas[0].id);
      else openAreas();
      if (fresh.length) K.toast((fresh.length === 1 ? 'Uusi lupa-alue: ' : 'Uusia lupa-alueita: ') + fresh.map(function (a) { return a.name; }).slice(0, 3).join(', '),
        { label: 'Näytä', fn: openAreas }, 10000);
      var stale = S.areas.filter(function (a) { var r = K.offline.get('alue-' + a.id); return r && r.version !== a.version; });
      if (!fresh.length && stale.length && navigator.onLine) K.toast('Karttapäivitys saatavilla: ' + stale.map(function (a) { return a.name; }).join(', '), { label: 'Näytä', fn: openAreas });
    });
  }
  function leave() {
    S.loadSeq++;
    clearAreaLayers();
    S.area = null;
    map.removeControl(legend);
    renderObsMarkers();
    drawWindFan();
    picking = false;
  }
  K.on('section', function (sec) { if (sec === SEC) enter(); });
  K.on('leave', function (sec) { if (sec === SEC) leave(); });
  K.on('pos', drawWindFan);
  K.on('posoff', drawWindFan);
  K.on('wx', drawWindFan);
  K.on('minute', drawWindFan);

  // Testejä varten
  K.hunt = { S: S, selectArea: selectArea, obs: function () { return obsList; }, currentWind: currentWind };
})();

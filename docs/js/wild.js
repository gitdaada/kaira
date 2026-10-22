/*
 * Kaira / Eränkäynti: autiotuvat, autiokammit, päivätuvat, kodat, laavut ja tulipaikat koko Suomesta
 * (OpenStreetMap, päivittyy kuukausittain) sekä GPX-reittien tuonti. Kohteen kompassi osoittaa
 * kohteen suunnan puhelimen sijainnin ja suunnan mukaan. Reitit tallentuvat vain tähän laitteeseen.
 */
(function () {
  'use strict';

  var K = window.K, JG = window.JG, h = K.h, sv = K.sv, settings = K.settings, map = K.map, store = K.store;
  var SEC = 'erankaynti';
  function active() { return K.section === SEC; }

  // ---------------------------------------------------------------------------
  // Kohteet
  // ---------------------------------------------------------------------------

  var TYPES = {
    autiotupa: { nimi: 'Autiotupa', color: '#9a5b2a', file: 'tuvat', set: 'huts', minZ: 6 },
    kammi: { nimi: 'Autiokammi', color: '#6f7f3a', file: 'tuvat', set: 'huts', minZ: 6 },
    paivatupa: { nimi: 'Päivätupa', color: '#2f6f9a', file: 'tuvat', set: 'dayHuts', minZ: 8 },
    kota: { nimi: 'Kota', color: '#2f6f9a', file: 'tuvat', set: 'dayHuts', minZ: 8 },
    laavu: { nimi: 'Laavu', color: '#0f766e', file: 'laavut', set: 'laavut', minZ: 9 },
    tulipaikka: { nimi: 'Tulipaikka', color: '#dc2626', file: 'tulipaikat', set: 'tulipaikat', minZ: 10 }
  };
  var FILES = ['tuvat', 'laavut', 'tulipaikat'];
  var MAX_MARKERS = 400;
  var D = { files: {}, loading: {}, features: [], markers: {}, layer: L.layerGroup() };

  function iconSvg(tyyppi) {
    var t = TYPES[tyyppi] || TYPES.autiotupa;
    var s = sv('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    var o = { fill: t.color, stroke: '#ffffff', 'stroke-width': 1.8, 'stroke-linejoin': 'round' };
    if (tyyppi === 'kota') {
      sv('path', Object.assign({ d: 'M12 2.5 L21.5 21 H2.5 Z' }, o), s);
      sv('path', { d: 'M10.5 21 L12 15 L13.5 21 Z', fill: '#ffffff' }, s);
    } else if (tyyppi === 'laavu') {
      sv('path', Object.assign({ d: 'M3 21 L9 3.5 L21 21 Z' }, o), s);
      sv('path', { d: 'M9 8 L9 21', stroke: '#ffffff', 'stroke-width': 1.6 }, s);
    } else if (tyyppi === 'tulipaikka') {
      sv('circle', Object.assign({ cx: 12, cy: 12, r: 10 }, o), s);
      sv('path', { d: 'M12 5.5c1.8 2.4 4 4.2 4 7.2a4 4 0 0 1-8 0c0-1.6.8-2.8 1.8-3.8.2 1.3.8 2.1 1.6 2.4-.6-2.2-.2-4 .6-5.8z', fill: '#ffffff' }, s);
    } else {
      sv('path', Object.assign({ d: 'M12 2.5 L22 11 H19 V21 H5 V11 H2 Z' }, o), s);
      sv('path', { d: 'M10 21 V15 H14 V21 Z', fill: '#ffffff' }, s);
    }
    return s;
  }
  function pinIcon(tyyppi) {
    var small = tyyppi === 'tulipaikka' || tyyppi === 'laavu';
    var box = h('div', { class: 'kohde-pin' + (small ? ' small' : '') });
    box.appendChild(iconSvg(tyyppi));
    return L.divIcon({ className: '', html: box, iconSize: [0, 0] });
  }

  /** Vain tunnetut kentät; linkit vain luotettaviin osoitteisiin. */
  function sanitize(gj, file) {
    var okLink = /^https:\/\/([a-z0-9-]+\.)*(luontoon\.fi|metsa\.fi|retkikartta\.fi)\//i;
    return ((gj && gj.features) || []).filter(function (f) {
      var c = f && f.geometry && f.geometry.type === 'Point' && f.geometry.coordinates;
      return c && isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[1]) <= 90 && Math.abs(c[0]) <= 180;
    }).slice(0, 40000).map(function (f, i) {
      var p = f.properties || {}, str = function (v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; };
      var ty = TYPES[p.tyyppi] ? p.tyyppi : (file === 'laavut' ? 'laavu' : (file === 'tulipaikat' ? 'tulipaikka' : 'autiotupa'));
      var osm = /^(node|way|relation)\/\d+$/.test(p.osm || '') ? p.osm : '';
      return { id: osm || file + '-' + i, lat: Number(f.geometry.coordinates[1]), lon: Number(f.geometry.coordinates[0]),
        nimi: str(p.nimi, 80) || TYPES[ty].nimi, tyyppi: ty, maakunta: str(p.maakunta, 30), kuvaus: str(p.kuvaus, 600),
        osm: osm, linkki: okLink.test(p.linkki || '') ? p.linkki : '' };
    });
  }
  function wantedFiles() {
    var out = {};
    Object.keys(TYPES).forEach(function (k) { if (settings[TYPES[k].set]) out[TYPES[k].file] = true; });
    return FILES.filter(function (f) { return out[f]; });
  }
  function loadFile(file) {
    if (D.files[file] || D.loading[file]) return D.loading[file] || Promise.resolve();
    D.loading[file] = K.fetchJSON('data/kohteet/' + file + '.geojson').then(function (gj) {
      D.files[file] = { features: sanitize(gj, file), updated: gj && gj.properties && /^\d{4}-\d{2}-\d{2}$/.test(gj.properties.paivitetty || '') ? gj.properties.paivitetty : '' };
    }).catch(function () { D.files[file] = { features: [], missing: true }; })
      .then(function () { delete D.loading[file]; rebuild(); if (K.sheetName() === 'layers' || K.sheetName() === 'kohteet') K.renderSheet(); });
    return D.loading[file];
  }
  function rebuild() {
    D.features = [];
    FILES.forEach(function (f) { if (D.files[f]) D.features = D.features.concat(D.files[f].features); });
    draw();
  }
  function typeOn(t) { return !!settings[TYPES[t].set]; }

  /** Piirtää näkyvän alueen kohteet: harvemmat tyypit jo kauempaa, tiheät vasta lähempää. */
  function draw() {
    if (!active()) { D.layer.clearLayers(); D.markers = {}; if (map.hasLayer(D.layer)) map.removeLayer(D.layer); return; }
    if (!map.hasLayer(D.layer)) D.layer.addTo(map);
    var z = map.getZoom(), b = map.getBounds().pad(0.15), c = map.getCenter(), list = [];
    D.features.forEach(function (f) {
      if (!typeOn(f.tyyppi) || z < TYPES[f.tyyppi].minZ) return;
      if (f.lat < b.getSouth() || f.lat > b.getNorth() || f.lon < b.getWest() || f.lon > b.getEast()) return;
      list.push(f);
    });
    if (list.length > MAX_MARKERS) {
      list.forEach(function (f) { f._d = (f.lat - c.lat) * (f.lat - c.lat) + (f.lon - c.lng) * (f.lon - c.lng) * 0.2; });
      list.sort(function (a, b2) { return a._d - b2._d; });
      list = list.slice(0, MAX_MARKERS);
    }
    var keep = {};
    list.forEach(function (f) {
      keep[f.id] = true;
      if (D.markers[f.id]) return;
      var m = L.marker([f.lat, f.lon], { icon: pinIcon(f.tyyppi), title: f.nimi, keyboard: false, zIndexOffset: f.tyyppi === 'autiotupa' ? 200 : 0 });
      m.on('click', function (e) { if (K.measuring) { K.measureAdd(e.latlng); return; } openKohde(f); });
      m.addTo(D.layer);
      D.markers[f.id] = m;
    });
    Object.keys(D.markers).forEach(function (id) { if (!keep[id]) { D.layer.removeLayer(D.markers[id]); delete D.markers[id]; } });
  }
  var drawTimer = 0;
  map.on('moveend zoomend', function () { if (!active()) return; clearTimeout(drawTimer); drawTimer = setTimeout(draw, 120); });

  // --- Kohteen paneeli: kompassi, etäisyys ja suunnistus ---
  var cur = null, ui = null;
  function openKohde(f) {
    cur = f;
    K.openSheet('kohde', f.nimi, renderKohde, { onClose: function () { K.orient.use('kohde', false); K.stopGps('kohde'); ui = null; cur = null; } });
    K.startGps(false, 'kohde');
    K.orient.use('kohde', true).then(updateCompass);
  }
  function renderKohde(body) {
    var f = cur;
    if (!f) return;
    var t = TYPES[f.tyyppi];
    var head = t.nimi + (f.maakunta ? ', ' + f.maakunta : '');
    body.appendChild(h('p', { class: 'muted small', text: head }));
    if (f.kuvaus && f.kuvaus.replace(/\.$/, '') !== head) body.appendChild(h('p', { class: 'small', text: f.kuvaus }));
    var fire = K.fireNotice ? K.fireNotice(L.latLng(f.lat, f.lon)) : null;
    if (fire) body.appendChild(fire);
    var svg = sv('svg', { viewBox: '0 0 120 120', class: 'kohde-dial', role: 'img', 'aria-label': 'Suunta kohteeseen' });
    sv('circle', { cx: 60, cy: 60, r: 56, fill: '#191C1E', stroke: 'rgba(140,147,158,0.5)', 'stroke-width': 2 }, svg);
    var dial = sv('g', {}, svg);
    for (var a = 0; a < 360; a += 30) sv('line', { x1: 60, y1: 6, x2: 60, y2: a % 90 ? 11 : 14, stroke: '#A9B0B9', 'stroke-width': a % 90 ? 1.5 : 2.5, transform: 'rotate(' + a + ' 60 60)' }, dial);
    [['P', 0, '#FF6B35'], ['I', 90, '#F4F6F4'], ['E', 180, '#F4F6F4'], ['L', 270, '#F4F6F4']].forEach(function (d) {
      var tx = sv('text', { x: 60, y: 27, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: d[2], transform: 'rotate(' + d[1] + ' 60 60)' }, dial);
      tx.textContent = d[0];
    });
    sv('path', { d: 'M60 0 L64 6 H56 Z', fill: '#4A7C59' }, svg); // puhelimen yläreuna
    var arrow = sv('g', { visibility: 'hidden' }, svg);
    sv('path', { d: 'M60 30 L60 66', stroke: '#FF6B35', 'stroke-width': 4, 'stroke-linecap': 'round' }, arrow);
    sv('path', { d: 'M60 16 L71 38 L60 33 L49 38 Z', fill: '#FF6B35', stroke: '#1A2F25', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }, arrow);
    sv('circle', { cx: 60, cy: 60, r: 4, fill: '#F4F6F4' }, svg);
    var dist = h('div', { class: 'd', text: '–' }), dir = h('div', { class: 'b' }), status = h('div', { class: 's' });
    body.appendChild(h('div', { class: 'kohde-compass' }, svg, h('div', { class: 'kohde-read' }, dist, dir, status)));
    ui = { dial: dial, arrow: arrow, dist: dist, dir: dir, status: status };
    body.appendChild(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Suunnista tänne', onclick: function () { K.setTarget({ lat: f.lat, lng: f.lon, name: f.nimi }); K.closeSheet(); } }),
      h('button', { type: 'button', class: 'btn', text: 'Näytä kartalla', onclick: function () { map.setView([f.lat, f.lon], Math.max(map.getZoom(), 14)); K.closeSheet(); } })));
    var tm = JG.toTM35FIN(f.lat, f.lon);
    body.appendChild(h('p', { class: 'small muted coords', text: 'N ' + JG.fmtDM(f.lat) + ', E ' + JG.fmtDM(f.lon) + ' · ETRS-TM35FIN N ' + Math.round(tm.N) + ' E ' + Math.round(tm.E) }));
    var src = h('p', { class: 'small muted' }, 'Tiedot: © OpenStreetMapin tekijät (ODbL). Tarkista ajantasaiset tiedot ennen retkeä. ');
    if (f.linkki) src.appendChild(h('a', { href: f.linkki, target: '_blank', rel: 'noopener noreferrer', text: 'Kohteen sivu' }));
    if (f.linkki && f.osm) src.appendChild(document.createTextNode(' · '));
    if (f.osm) src.appendChild(h('a', { href: 'https://www.openstreetmap.org/' + f.osm, target: '_blank', rel: 'noopener noreferrer', text: 'OpenStreetMap' }));
    body.appendChild(src);
    updateCompass();
  }
  function updateCompass() {
    if (!ui || !cur || K.sheetName() !== 'kohde') return;
    if (!K.pos) {
      ui.arrow.setAttribute('visibility', 'hidden');
      ui.dist.textContent = '–';
      ui.dir.textContent = 'Odotetaan sijaintia…';
      ui.status.textContent = K.gpsActive() ? 'GPS toimii ilman verkkoa.' : 'Sijainti ei ole päällä.';
      return;
    }
    var d = JG.distance(K.pos.lat, K.pos.lon, cur.lat, cur.lon), brg = JG.bearing(K.pos.lat, K.pos.lon, cur.lat, cur.lon), hd = K.heading;
    ui.dist.textContent = K.fmtDist(d);
    ui.dir.textContent = d < 25 ? 'Olet perillä.' : 'Suunta ' + Math.round(brg) + '° ' + JG.dirName(brg, true);
    ui.arrow.setAttribute('visibility', d < 25 ? 'hidden' : 'visible');
    ui.dial.setAttribute('transform', 'rotate(' + (hd === null ? 0 : -hd).toFixed(1) + ' 60 60)');
    ui.arrow.setAttribute('transform', 'rotate(' + (hd === null ? brg : brg - hd).toFixed(1) + ' 60 60)');
    ui.status.textContent = (hd === null ? 'Puhelimen kompassi ei ole käytössä: nuoli näyttää suunnan pohjoisesta (P ylhäällä).' :
      'Pidä puhelinta vaakatasossa. Kun nuoli osoittaa ylös, kohde on edessäsi.') + (K.pos.acc > 50 ? ' Sijainnin tarkkuus ± ' + Math.round(K.pos.acc) + ' m.' : '');
  }
  K.on('pos', updateCompass);
  K.on('heading', updateCompass);

  // --- Lähimmät kohteet ---
  var listFilter = 'kaikki';
  var FILTERS = [['kaikki', 'Kaikki'], ['tuvat', 'Tuvat'], ['laavut', 'Laavut'], ['tulipaikat', 'Tulipaikat']];
  function inFilter(f) {
    if (listFilter === 'kaikki') return typeOn(f.tyyppi);
    return TYPES[f.tyyppi].file === listFilter;
  }
  function renderKohteet(body) {
    var p = K.wherePoint(10 * 60000);
    body.appendChild(K.seg(FILTERS, listFilter, function (v) {
      listFilter = v;
      if (v !== 'kaikki') loadFile(v);
      K.renderSheet();
    }, { label: 'Kohdetyyppi' }));
    body.appendChild(h('p', { class: 'muted small', text: (p.src === 'gps' ? 'Lähimmät sijainnistasi' : 'Lähimmät kartan keskeltä. Laita sijainti päälle, niin etäisyydet lasketaan sinusta.') }));
    var pending = Object.keys(D.loading).length;
    var items = D.features.filter(inFilter).map(function (f) { return { f: f, d: JG.distance(p.lat, p.lon, f.lat, f.lon) }; })
      .sort(function (a, b) { return a.d - b.d; }).slice(0, 40);
    if (!items.length) body.appendChild(h('p', { class: 'muted', text: pending ? 'Ladataan kohteita…' : 'Ei kohteita. Tarkista Tasot-valikosta, mitkä kohdetyypit ovat päällä.' }));
    items.forEach(function (it) {
      var f = it.f, brg = JG.bearing(p.lat, p.lon, f.lat, f.lon);
      body.appendChild(h('button', { type: 'button', class: 'list-row', onclick: function () { openKohde(f); } },
        h('span', { class: 'lr-ico' }, iconSvg(f.tyyppi)),
        h('span', { class: 'lr-txt' }, h('b', { text: f.nimi }), h('small', { text: TYPES[f.tyyppi].nimi + (f.maakunta ? ', ' + f.maakunta : '') })),
        h('span', { class: 'lr-dist' }, K.fmtDist(it.d), h('small', { text: Math.round(brg) + '° ' + JG.dirName(brg) }))));
    });
    var missing = FILES.filter(function (fl) { return D.files[fl] && D.files[fl].missing; });
    if (missing.length) body.appendChild(h('p', { class: 'muted small', text: 'Osa kohdeaineistosta päivittyy vielä (' + missing.join(', ') + '). Aineisto haetaan OpenStreetMapista kuukausittain.' }));
  }
  function openKohteet() {
    wantedFiles().forEach(loadFile);
    K.openSheet('kohteet', 'Tuvat, laavut ja tulipaikat', renderKohteet);
  }
  K.on('pos', function () { if (K.sheetName() === 'kohteet' && Date.now() - (renderKohteet.last || 0) > 5000) { renderKohteet.last = Date.now(); K.renderSheet(); } });

  // ---------------------------------------------------------------------------
  // GPX-reitit (vain tässä laitteessa)
  // ---------------------------------------------------------------------------

  var MAX_ROUTE_PTS = 6000, MAX_ROUTES = 30, MAX_GPX_BYTES = 8 * 1024 * 1024;
  function sanitizeRoute(r) {
    if (!r || typeof r !== 'object' || !/^r[a-z0-9]{4,20}$/.test(r.id || '')) return null;
    var ok = function (c) { return Array.isArray(c) && isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180; };
    var lines = (Array.isArray(r.lines) ? r.lines : []).map(function (l) { return (Array.isArray(l) ? l : []).filter(ok).map(function (c) { return [Number(c[0]), Number(c[1])]; }); }).filter(function (l) { return l.length > 1; });
    var wpts = (Array.isArray(r.wpts) ? r.wpts : []).filter(function (w) { return w && ok([w.lat, w.lon]); }).slice(0, 500)
      .map(function (w) { return { lat: Number(w.lat), lon: Number(w.lon), name: typeof w.name === 'string' ? w.name.slice(0, 60) : '' }; });
    if (!lines.length && !wpts.length) return null;
    return { id: r.id, name: typeof r.name === 'string' && r.name ? r.name.slice(0, 80) : 'Reitti', lines: lines, wpts: wpts, km: Number(r.km) || 0, added: Number(r.added) || Date.now() };
  }
  var routes = (store.get('routes', []) || []).map(sanitizeRoute).filter(Boolean);
  var routeLayer = L.layerGroup(), routeLayers = {};
  function saveRoutes() { return store.set('routes', routes); }
  function routeBounds(r) {
    var s = 90, w = 180, n = -90, e = -180;
    r.lines.forEach(function (l) { l.forEach(function (c) { s = Math.min(s, c[0]); n = Math.max(n, c[0]); w = Math.min(w, c[1]); e = Math.max(e, c[1]); }); });
    r.wpts.forEach(function (p) { s = Math.min(s, p.lat); n = Math.max(n, p.lat); w = Math.min(w, p.lon); e = Math.max(e, p.lon); });
    return [[s, w], [n, e]];
  }
  function lineKm(l) { var d = 0; for (var i = 1; i < l.length; i++) d += JG.distance(l[i - 1][0], l[i - 1][1], l[i][0], l[i][1]); return d / 1000; }

  /** Douglas–Peucker-yksinkertaistus metreinä (tasoprojektio pienelle alueelle riittää). */
  function simplify(pts, tolM) {
    if (pts.length < 3) return pts.slice();
    var lat0 = pts[0][0] * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540;
    var P = pts.map(function (c) { return [c[1] * kx, c[0] * ky]; }), keep = new Uint8Array(pts.length), stack = [[0, pts.length - 1]];
    keep[0] = keep[pts.length - 1] = 1;
    while (stack.length) {
      var seg = stack.pop(), a = seg[0], b = seg[1], ax = P[a][0], ay = P[a][1], bx = P[b][0], by = P[b][1];
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, maxD = -1, idx = -1;
      for (var i = a + 1; i < b; i++) {
        var t = len2 ? Math.max(0, Math.min(1, ((P[i][0] - ax) * dx + (P[i][1] - ay) * dy) / len2)) : 0;
        var px = ax + t * dx - P[i][0], py = ay + t * dy - P[i][1], dd = px * px + py * py;
        if (dd > maxD) { maxD = dd; idx = i; }
      }
      if (idx > 0 && maxD > tolM * tolM) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    return pts.filter(function (c, i) { return keep[i]; });
  }
  K.simplifyLine = simplify; // testejä varten

  /** GPX (XML) -> {name, lines, wpts}. Vain sijainnit ja nimet luetaan; muu sisältö ohitetaan. */
  function parseGpx(txt, fallbackName) {
    var doc = new DOMParser().parseFromString(txt, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Tiedosto ei ole kelvollinen GPX.');
    var root = doc.documentElement;
    if (!root || root.localName !== 'gpx') throw new Error('Tiedosto ei ole GPX.');
    function pt(el) {
      var lat = Number(el.getAttribute('lat')), lon = Number(el.getAttribute('lon'));
      return isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? [Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5] : null;
    }
    function nameOf(el) { var n = el.getElementsByTagNameNS('*', 'name')[0]; return n ? (n.textContent || '').trim().slice(0, 80) : ''; }
    var lines = [];
    Array.prototype.forEach.call(root.getElementsByTagNameNS('*', 'trkseg'), function (seg) {
      lines.push(Array.prototype.map.call(seg.getElementsByTagNameNS('*', 'trkpt'), pt).filter(Boolean));
    });
    Array.prototype.forEach.call(root.getElementsByTagNameNS('*', 'rte'), function (rte) {
      lines.push(Array.prototype.map.call(rte.getElementsByTagNameNS('*', 'rtept'), pt).filter(Boolean));
    });
    lines = lines.filter(function (l) { return l.length > 1; });
    var total = 0;
    lines = lines.map(function (l) { var s = simplify(l, 4); total += s.length; return s; });
    if (total > MAX_ROUTE_PTS) lines = lines.map(function (l) { return simplify(l, 15); });
    var wpts = Array.prototype.map.call(root.getElementsByTagNameNS('*', 'wpt'), function (w) {
      var c = pt(w);
      return c ? { lat: c[0], lon: c[1], name: (w.getElementsByTagNameNS('*', 'name')[0] || {}).textContent || '' } : null;
    }).filter(Boolean).slice(0, 500);
    if (!lines.length && !wpts.length) throw new Error('GPX-tiedostossa ei ole reittiä eikä pisteitä.');
    var meta = root.getElementsByTagNameNS('*', 'metadata')[0], trk = root.getElementsByTagNameNS('*', 'trk')[0], rte = root.getElementsByTagNameNS('*', 'rte')[0];
    var name = (meta && nameOf(meta)) || (trk && nameOf(trk)) || (rte && nameOf(rte)) || fallbackName;
    return { name: name, lines: lines, wpts: wpts };
  }
  K.parseGpx = parseGpx; // testejä varten

  function importGpx(file) {
    if (file.size > MAX_GPX_BYTES) { K.toast('GPX-tiedosto on liian suuri (yli 8 Mt).'); return; }
    if (routes.length >= MAX_ROUTES) { K.toast('Reittejä voi olla enintään ' + MAX_ROUTES + '. Poista ensin vanhoja.'); return; }
    file.text().then(function (txt) {
      var g = parseGpx(txt, file.name.replace(/\.gpx$/i, '').slice(0, 80) || 'Reitti');
      var r = sanitizeRoute({ id: 'r' + Date.now().toString(36), name: g.name, lines: g.lines, wpts: g.wpts, added: Date.now(),
        km: g.lines.reduce(function (s, l) { return s + lineKm(l); }, 0) });
      if (!r) throw new Error('Reitissä ei ole kelvollisia pisteitä.');
      routes.push(r);
      if (!saveRoutes()) { routes.pop(); K.toast('Tallennustila on täynnä. Poista vanhoja reittejä.'); return; }
      settings.showRoutes = true; K.saveSettings();
      drawRoutes();
      K.closeSheet();
      K.fitBounds(routeBounds(r));
      K.toast('Reitti tuotu: ' + r.name + (r.km ? ' (' + K.fmt1(r.km) + ' km)' : ''));
    }).catch(function (e) { K.toast('Tuonti epäonnistui: ' + (e && e.message ? e.message : 'virheellinen tiedosto'), null, 6000); });
  }
  function drawRoutes() {
    routeLayer.clearLayers(); routeLayers = {};
    if (!active() || !settings.showRoutes) { if (map.hasLayer(routeLayer)) map.removeLayer(routeLayer); return; }
    if (!map.hasLayer(routeLayer)) routeLayer.addTo(map);
    routes.forEach(function (r) {
      if (settings.hidden['reitti-' + r.id]) return;
      var g = L.layerGroup().addTo(routeLayer);
      r.lines.forEach(function (l) {
        L.polyline(l, { pane: 'linePane', color: '#ffffff', weight: 8, opacity: 0.85, interactive: false }).addTo(g);
        L.polyline(l, { pane: 'linePane', color: '#e11d48', weight: 4.5, opacity: 1, bubblingMouseEvents: false })
          .on('click', function (e) { if (K.measuring) { K.measureAdd(e.latlng); return; } K.tapInfo(e.latlng, { title: r.name, detail: 'Reitti' + (r.km ? ', ' + K.fmt1(r.km) + ' km' : ''), targetName: r.name }); })
          .addTo(g);
      });
      r.wpts.forEach(function (w) {
        L.circleMarker([w.lat, w.lon], { pane: 'linePane', radius: 7, color: '#ffffff', weight: 2.5, fillColor: '#e11d48', fillOpacity: 1, bubblingMouseEvents: false })
          .on('click', function (e) { if (K.measuring) { K.measureAdd(e.latlng); return; } K.tapInfo(L.latLng(w.lat, w.lon), { title: w.name || 'Reittipiste', detail: r.name, targetName: w.name || r.name }); })
          .addTo(g);
      });
      routeLayers[r.id] = g;
    });
  }
  function renderRoutes(body) {
    body.appendChild(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn btn-primary', text: 'Tuo GPX-reitti', onclick: function () { K.pickFile('.gpx,application/gpx+xml,application/xml,text/xml', importGpx); } })));
    body.appendChild(h('p', { class: 'muted small', text: 'Tuo reitti esimerkiksi retkikartta.fi:stä, urheilukellosta tai muusta karttasovelluksesta GPX-tiedostona. Reitti tallentuu vain tähän puhelimeen.' }));
    if (!routes.length) { body.appendChild(h('p', { class: 'muted', text: 'Ei tuotuja reittejä.' })); return; }
    body.appendChild(K.toggleRow('Näytä reitit kartalla', null, settings.showRoutes, function (v) { settings.showRoutes = v; K.saveSettings(); drawRoutes(); }));
    routes.slice().sort(function (a, b) { return b.added - a.added; }).forEach(function (r) {
      var b = routeBounds(r), hid = 'reitti-' + r.id;
      var first = r.lines.length ? r.lines[0][0] : [r.wpts[0].lat, r.wpts[0].lon];
      body.appendChild(h('div', { class: 'card' },
        h('button', { type: 'button', class: 'card-main', onclick: function () { K.closeSheet(); if (!settings.showRoutes) { settings.showRoutes = true; K.saveSettings(); } delete settings.hidden[hid]; K.saveSettings(); drawRoutes(); K.fitBounds(b); } },
          h('div', { class: 'card-title', text: r.name }),
          h('div', { class: 'card-sub', text: (r.km ? K.fmt1(r.km) + ' km' : 'Pisteet') + (r.wpts.length ? ' · ' + r.wpts.length + ' reittipistettä' : '') + ' · tuotu ' + K.fmtDate(r.added) })),
        h('div', { class: 'card-foot' },
          K.toggleRow('Näkyvissä', null, !settings.hidden[hid], function (v) { if (v) delete settings.hidden[hid]; else settings.hidden[hid] = true; K.saveSettings(); drawRoutes(); }),
          h('div', { class: 'btn-row' },
            h('button', { type: 'button', class: 'btn', text: 'Suunnista alkuun', onclick: function () { K.closeSheet(); K.setTarget({ lat: first[0], lng: first[1], name: r.name + ': alku' }); } }),
            h('button', { type: 'button', class: 'btn', text: 'Offline', onclick: function () { K.openOfflineFor({ id: 'reitti-' + r.id, name: r.name, kind: 'reitti', bounds: b }); } }),
            h('button', { type: 'button', class: 'btn btn-danger', text: 'Poista', onclick: function () {
              if (!confirm('Poistetaanko reitti ' + r.name + '?')) return;
              routes = routes.filter(function (x) { return x.id !== r.id; });
              delete settings.hidden[hid]; K.saveSettings(); saveRoutes(); drawRoutes();
              if (K.offline.get('reitti-' + r.id)) K.offline.remove('reitti-' + r.id);
              K.renderSheet();
            } })))));
    });
  }
  function openRoutes() { K.openSheet('routes', 'Reitit', renderRoutes); }

  // ---------------------------------------------------------------------------
  // Paneelit ja osion vaihto
  // ---------------------------------------------------------------------------

  K.on('layers', function (body, sec) {
    if (sec !== SEC) return;
    body.appendChild(h('h3', { text: 'Tuvat, laavut ja tulipaikat' }));
    function count(file) { var f = D.files[file]; return f && !f.missing ? f.features.length : null; }
    var nh = count('tuvat'), nl = count('laavut'), nt = count('tulipaikat');
    function tg(key, label, hint) {
      return K.toggleRow(label, hint, settings[key], function (v) { settings[key] = v; K.saveSettings(); wantedFiles().forEach(loadFile); draw(); });
    }
    body.appendChild(tg('huts', 'Autiotuvat ja -kammit', 'Ruskea talo, kammi vihreä'));
    body.appendChild(tg('dayHuts', 'Päivätuvat ja kodat', 'Sininen talo tai kolmio'));
    body.appendChild(tg('laavut', 'Laavut', 'Tumma turkoosi, näkyvät lähempää' + (nl !== null ? ' · ' + K.fmtInt(nl) + ' kohdetta' : '')));
    body.appendChild(tg('tulipaikat', 'Tulipaikat', 'Punainen liekki, näkyvät lähimmästä' + (nt !== null ? ' · ' + K.fmtInt(nt) + ' kohdetta' : '')));
    var upd = D.files.tuvat && D.files.tuvat.updated;
    body.appendChild(h('p', { class: 'muted small', text: (nh !== null ? K.fmtInt(nh) + ' tupaa tai kotaa. ' : '') + 'Lähde: © OpenStreetMapin tekijät (ODbL)' + (upd ? ', päivitetty ' + K.fmtDate(Date.parse(upd)) : '') +
      '. Varaus- ja vuokratuvat eivät ole mukana. Napauta kohdetta, niin näet suunnan ja etäisyyden.' }));
    body.appendChild(h('h3', { text: 'Reitit' }));
    body.appendChild(K.toggleRow('Näytä GPX-reitit', routes.length ? routes.length + ' reittiä' : 'Tuo reitit Reitit-valikosta', settings.showRoutes, function (v) { settings.showRoutes = v; K.saveSettings(); drawRoutes(); }));
  });
  K.on('tools', function (list, sec) {
    if (sec !== SEC) return;
    list.appendChild(K.menuItem('route', 'Tuo GPX-reitti', 'Reitti retkikartta.fi:stä, kellosta tai muusta sovelluksesta', function () { K.pickFile('.gpx,application/gpx+xml,application/xml,text/xml', importGpx); }));
  });
  K.defineNav(SEC, {
    main: { label: 'Kohteet', icon: 'hut', sheet: 'kohteet', fn: openKohteet },
    info: { label: 'Reitit', icon: 'route', sheet: 'routes', fn: openRoutes }
  });

  function enter() { wantedFiles().forEach(loadFile); draw(); drawRoutes(); }
  function leave() { draw(); drawRoutes(); }
  K.on('section', function (sec) { if (sec === SEC) enter(); });
  K.on('leave', function (sec) { if (sec === SEC) leave(); });

  K.kohdeIcon = iconSvg;
  K.wild = { D: D, routes: function () { return routes; }, openKohde: openKohde };
})();

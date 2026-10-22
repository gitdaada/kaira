/*
 * Kaira: sovelluksen runko. Yhteiset palvelut kaikille osioille (metsästys, kalastus, eränkäynti):
 * tallennus, asetukset, kartta, osiot ja alapalkki, paneelit, sijainti, kompassi, suunnistus,
 * offline-tallennus ja hätäkoordinaatit. Osioiden toiminnot ovat omissa tiedostoissaan ja
 * kytkeytyvät tänne tapahtumien (K.on) kautta.
 *
 * Tietosuoja: kaikki käyttäjän tiedot (API-avain, merkinnät, reitit, tasot) pysyvät tässä laitteessa.
 */
(function () {
  'use strict';

  var K = window.K = {};
  K.VERSION = '0.1.0';
  var JG = window.JG, MK = window.MK;

  // ---------------------------------------------------------------------------
  // Tallennus (vain tämä laite)
  // ---------------------------------------------------------------------------

  var PREFIX = 'kaira.';
  K.store = {
    get: function (k, d) {
      try { var v = localStorage.getItem(PREFIX + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) {
      try { localStorage.setItem(PREFIX + k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del: function (k) { try { localStorage.removeItem(PREFIX + k); } catch (e) { /* estetty */ } },
    clearAll: function () {
      try { Object.keys(localStorage).filter(function (k) { return k.indexOf(PREFIX) === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* estetty */ }
    }
  };
  var store = K.store;

  // ---------------------------------------------------------------------------
  // Asetukset
  // ---------------------------------------------------------------------------

  var DEFAULTS = {
    apiKey: '', basemap: 'maastokartta', mapDim: false, maxZoom: 16, offlineOrtho: false, wakeLock: false, gpsOn: false,
    compassFeature: true, showRain: true, rings: false, hidden: {},
    // Metsästys
    oldAge: 80, taimikkoM: 7, treelessM: 0.5, opacity: 0.7, showForest: true, showProtected: true, showMask: true, showCuts: true,
    habitat: 'off', showWind: true, fanLengthM: 200, showScent: true, showObs: true,
    // Kalastus
    water: true, fishLayers: true, showCatch: true, showDepth: true, showIce: true,
    // Eränkäynti
    huts: true, dayHuts: true, laavut: true, tulipaikat: true, showRoutes: true,
    // Metsästys ja eränkäynti
    showFire: true,
    // Kaikki osiot: salamat ja lumensyvyys
    showLightning: true, showSnow: true
  };
  var ENUMS = {
    basemap: ['maastokartta', 'taustakartta', 'ortokuva'], habitat: ['off', 'metso', 'teeri', 'pyy'],
    maxZoom: [15, 16], fanLengthM: [100, 200, 300, 500]
  };
  var RANGES = { oldAge: [20, 250, true], taimikkoM: [1, 15], treelessM: [0, 3], opacity: [0.2, 1] };

  function sanitizeSettings(raw) {
    var s = {}, src = raw && typeof raw === 'object' ? raw : {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var d = DEFAULTS[k], v = src[k];
      if (ENUMS[k]) { s[k] = ENUMS[k].indexOf(v) >= 0 ? v : d; return; }
      if (RANGES[k]) {
        var n = Number(v), r = RANGES[k];
        n = isFinite(n) ? Math.max(r[0], Math.min(r[1], n)) : d;
        s[k] = r[2] ? Math.round(n) : n;
        return;
      }
      if (typeof d === 'boolean') { s[k] = v === undefined ? d : !!v; return; }
      if (k === 'apiKey') { s[k] = JG.sanitizeKey(v); return; }
      if (k === 'hidden') {
        var hdn = {};
        if (v && typeof v === 'object') Object.keys(v).slice(0, 200).forEach(function (id) { if (/^[a-z0-9_-]{1,60}$/i.test(id)) hdn[id] = true; });
        s[k] = hdn; return;
      }
      s[k] = d;
    });
    return s;
  }
  K.settings = sanitizeSettings(store.get('settings', {}));
  K.saveSettings = function () { store.set('settings', K.settings); };
  var settings = K.settings;

  // ---------------------------------------------------------------------------
  // DOM-apurit. Teksti asetetaan aina textContentina. K.icon käyttää vain tämän tiedoston vakiokuvakkeita.
  // ---------------------------------------------------------------------------

  function $(id) { return document.getElementById(id); }
  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (p) { el.style[p] = v[p]; });
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }
  function append(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (cc) { append(el, cc); }); return; }
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  var SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }
  K.$ = $; K.h = h; K.sv = sv; K.SVGNS = SVGNS;

  // Vakiokuvakkeet (luotettu sisältö, ei koskaan käyttäjän tai verkon dataa).
  var ICONS = {
    feather: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 4c-7 0-12 5-13 12l-3 4"/><path d="M20 4c0 7-5 12-12 13"/><path d="M8 16l6-6M11 17l1-4M7 13l4-1"/></svg>',
    fish: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12c3-5 9-6 13-3l5-3v12l-5-3c-4 3-10 2-13-3z"/><circle cx="8" cy="11" r="1" fill="currentColor"/></svg>',
    tent: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3L2 20h20L12 3z"/><path d="M12 3v17M12 12l-4 8M12 12l4 8"/></svg>',
    layers: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/></svg>',
    tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
    pinPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12z"/><path d="M12 6.5v7M8.5 10h7"/></svg>',
    fishPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 13c3-4 8-5 11-2l4-2v9l-4-2c-3 2-8 1-11-3z"/><path d="M19 2v6M16 5h6"/></svg>',
    hut: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M3 11L12 3l9 8"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/></svg>',
    area: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 6l6-3 10 4-2 12-9 2-5-6z"/><circle cx="12" cy="11" r="2" fill="currentColor"/></svg>',
    fly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 14c4-1 9-1 14 0"/><path d="M12 13l-3-8 5 7z" fill="currentColor"/><path d="M18 14c2 0 2 4 0 4s-2-2 0-2"/></svg>',
    route: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8 17c6 0 2-7 8-10" stroke-dasharray="3 3"/></svg>',
    offline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 19h16"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke-linecap="round"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/></svg>',
    ruler: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 18L18 4"/><circle cx="4.5" cy="18" r="2.5" fill="currentColor"/><circle cx="18" cy="5" r="2.5" fill="currentColor"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v5h16v-5"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.2" fill="#fbbf24"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="#c7d2fe"/></svg>',
    drop: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z" fill="#67e8f9"/></svg>',
    arrow: '<svg viewBox="0 0 24 24"><path d="M12 2l6 8h-4v12h-4V10H6z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3c1 3.5 5 6 5 10.5A5 5 0 0 1 7 13.5c0-2 1-3.5 2.2-4.7.2 1.7 1.1 2.8 2.3 3.2C11 9 11.2 5.8 12 3z"/></svg>',
    draw: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M4 7l5-3 9 3 2 9-8 5-7-4z" stroke-dasharray="3 2.5"/><circle cx="4" cy="7" r="1.6" fill="currentColor"/><circle cx="18" cy="7" r="1.6" fill="currentColor"/></svg>'
  };
  K.ICONS = ICONS;
  /** Vakiokuvake span-elementtinä. Vain ICONS-taulukon nimet kelpaavat. */
  K.icon = function (name, cls) {
    var span = document.createElement('span');
    span.className = cls || 'ico';
    span.setAttribute('aria-hidden', 'true');
    if (Object.prototype.hasOwnProperty.call(ICONS, name)) span.innerHTML = ICONS[name];
    return span;
  };

  // ---------------------------------------------------------------------------
  // Muotoilu
  // ---------------------------------------------------------------------------

  K.fmtInt = function (n) { return Math.round(n).toLocaleString('fi-FI'); };
  K.fmt1 = function (n) { return n === null || n === undefined || !isFinite(n) ? '–' : (Math.round(n * 10) / 10).toString().replace('.', ','); };
  K.fmtMB = function (bytes) { var mb = bytes / 1e6; return (mb < 10 ? mb.toFixed(1).replace('.', ',') : K.fmtInt(mb)) + ' Mt'; };
  K.fmtDate = function (ts) { var d = new Date(ts); return d.getDate() + '.' + (d.getMonth() + 1) + '.' + d.getFullYear(); };
  K.hm = function (ms) { return new Date(ms).toLocaleTimeString('fi-FI', { hour: '2-digit', minute: '2-digit' }); };
  K.fmtWhen = function (ms) {
    var d = new Date(ms), now = new Date();
    return (d.toDateString() === now.toDateString() ? 'klo ' : d.getDate() + '.' + (d.getMonth() + 1) + '. klo ') + K.hm(ms);
  };
  K.fmtDur = function (ms) {
    var m = Math.max(0, Math.round(ms / 60000));
    if (m < 1) return 'alle min';
    if (m < 60) return m + ' min';
    return Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  };
  K.fmtDist = function (m) { return JG.fmtDistance(m); };
  K.fmtLatLon = function (lat, lon) { return lat.toFixed(5).replace('.', ',') + ' N, ' + lon.toFixed(5).replace('.', ',') + ' E'; };
  K.pct = function (a, b) { return b ? Math.round(100 * a / b) : 0; };
  K.wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  K.absUrl = function (u) { return new URL(u, location.href).href; };
  K.fetchWithTimeout = function (url, ms, cacheMode) {
    var c = new AbortController(), t = setTimeout(function () { c.abort(); }, ms);
    return fetch(url, { signal: c.signal, credentials: 'omit', cache: cacheMode || 'no-store' })
      .then(function (r) { clearTimeout(t); return r; }, function (e) { clearTimeout(t); throw e; });
  };
  K.fetchJSON = function (url, opts) {
    return fetch(url, Object.assign({ credentials: 'omit' }, opts || {})).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  };
  K.isStandalone = function () { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true; };
  K.isIOS = function () { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); };
  /** Tiedoston lataus laitteelle (vienti). */
  K.download = function (text, name, type) {
    var blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  // ---------------------------------------------------------------------------
  // Tapahtumat
  // ---------------------------------------------------------------------------

  var listeners = {};
  K.on = function (evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); };
  K.emit = function (evt) {
    var args = Array.prototype.slice.call(arguments, 1);
    (listeners[evt] || []).forEach(function (fn) {
      try { fn.apply(null, args); } catch (e) { console.error('Tapahtuma ' + evt + ' epäonnistui:', e); }
    });
  };

  // ---------------------------------------------------------------------------
  // Ilmoitus
  // ---------------------------------------------------------------------------

  var toastTimer = null;
  K.toast = function (msg, action, ms) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('is-tip');
    if (action) t.appendChild(h('button', { type: 'button', text: action.label, onclick: function () { t.hidden = true; action.fn(); } }));
    t.hidden = false;
    clearTimeout(toastTimer);
    if (ms !== 0) toastTimer = setTimeout(function () { t.hidden = true; }, ms || (action ? 8000 : 4000));
  };

  /**
   * Vinkki: näytetään kerran (tai repeatDays välein) vasta, kun aloitusnäkymä ja paneelit ovat kiinni
   * eikä muuta ilmoitusta ole näkyvissä. Näin vinkki ei peitä paneelin sisältöä.
   */
  var tipQueue = [];
  K.tip = function (key, msg, action, o) {
    o = o || {};
    var seen = store.get('tips', {}) || {}, last = Number(seen[key]) || 0;
    if (last && (!o.repeatDays || Date.now() - last < o.repeatDays * 86400000)) return;
    if (tipQueue.some(function (t) { return t.key === key; })) return;
    tipQueue.push({ key: key, msg: msg, action: action, cond: o.cond, until: Date.now() + 180000 });
  };
  setInterval(function () {
    if (!tipQueue.length || !$('start').hidden || currentSheet || !$('toast').hidden || !$('infoCard').hidden || document.visibilityState !== 'visible') return;
    var t = tipQueue.shift();
    if (Date.now() > t.until || (t.cond && !t.cond())) return;
    var seen = store.get('tips', {}) || {};
    seen[t.key] = Date.now(); store.set('tips', seen);
    K.toast(t.msg, t.action, 7000);
    $('toast').classList.add('is-tip');
  }, 1500);
  /** Vinkki väistyy, kun käyttäjä avaa paneelin tai vaihtaa osiota. */
  function hideTip() { var t = $('toast'); if (t.classList.contains('is-tip')) t.hidden = true; }

  // ---------------------------------------------------------------------------
  // Kartta
  // ---------------------------------------------------------------------------

  var CAN_ROTATE = !!window.MKRotate;
  if (CAN_ROTATE) MKRotate.layout($('map'), $('mapView'));
  var view = store.get('view', { c: [64.4, 26.6], z: 5 });
  var map = K.map = L.map('mapView', { zoomControl: false, maxZoom: 18, minZoom: 4, attributionControl: true, zoomSnap: 0.5, keyboard: false });
  map.attributionControl.setPrefix(false);
  map.setView(view.c, view.z);
  var rot = K.rot = CAN_ROTATE ? MKRotate.install(map, $('map'), { threshold: 12 }) : null;
  K.CAN_ROTATE = CAN_ROTATE;
  K.bearing = function () { return rot ? rot.getBearing() : 0; };
  K.fitBounds = function (bounds, o) {
    o = o || { paddingTopLeft: [16, 140], paddingBottomRight: [80, 100] };
    return rot ? rot.fitBounds(bounds, o) : map.fitBounds(bounds, o);
  };
  [['maskPane', 300], ['forestPane', 350], ['habitatPane', 360], ['rainPane', 380], ['cutsPane', 400],
   ['protCasingPane', 410], ['protPane', 420], ['boundaryPane', 430], ['windPane', 435], ['linePane', 440], ['targetPane', 445]]
    .forEach(function (p) { map.createPane(p[0]).style.zIndex = p[1]; });
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.on('moveend', function () {
    var c = map.getCenter();
    store.set('view', { c: [JG.roundCoord(c.lat, 5), JG.roundCoord(c.lng, 5)], z: map.getZoom() });
  });

  // --- Pohjakartta ---
  var MML_BASE = 'https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0';
  var MML_LAYERS = K.MML_LAYERS = {
    maastokartta: { path: 'maastokartta', ext: 'png', estKB: 20, name: 'Maastokartta' },
    taustakartta: { path: 'taustakartta', ext: 'png', estKB: 15, name: 'Taustakartta' },
    ortokuva: { path: 'ortokuva', ext: 'jpg', estKB: 40, name: 'Ilmakuva' }
  };
  K.mmlTemplate = function (layer) {
    var l = MML_LAYERS[layer];
    return MML_BASE + '/' + l.path + '/default/WGS84_Pseudo-Mercator/{z}/{y}/{x}.' + l.ext;
  };
  K.mmlTileKey = function (layer, z, x, y) { return K.mmlTemplate(layer).replace('{z}', z).replace('{y}', y).replace('{x}', x); };
  K.hasKey = function () { return !!settings.apiKey; };
  var baseLayer = null;
  K.setBasemap = function () {
    if (baseLayer) map.removeLayer(baseLayer);
    if (K.hasKey()) {
      baseLayer = L.tileLayer(K.mmlTemplate(settings.basemap) + '?api-key=' + encodeURIComponent(settings.apiKey), {
        maxNativeZoom: 16, maxZoom: 18, keepBuffer: 3, crossOrigin: 'anonymous',
        attribution: '© <a href="https://www.maanmittauslaitos.fi" target="_blank" rel="noopener noreferrer">MML</a>'
      });
    } else {
      // Ilman avainta OpenStreetMap, vain verkossa: OSM ei salli karttojen tallennusta offline-käyttöön.
      baseLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxNativeZoom: 19, maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin',
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>'
      });
    }
    baseLayer.addTo(map);
  };
  K.applyDim = function () { $('map').classList.toggle('map-dim', !!settings.mapDim); };

  $('zoomInBtn').addEventListener('click', function () { map.zoomIn(); });
  $('zoomOutBtn').addEventListener('click', function () { map.zoomOut(); });

  // ---------------------------------------------------------------------------
  // Paneeli (alaosasta nouseva sheet) ja tietokortti
  // ---------------------------------------------------------------------------

  var currentSheet = null;
  K.openSheet = function (name, title, render, opts) {
    var prev = currentSheet;
    currentSheet = { name: name, render: render, onClose: opts && opts.onClose };
    if (prev && prev.onClose && prev.name !== name) prev.onClose();
    hideTip();
    $('sheetTitle').textContent = title;
    $('backdrop').hidden = false;
    $('sheet').hidden = false;
    K.renderSheet();
    $('sheetBody').scrollTop = 0;
    updateNavState();
  };
  K.renderSheet = function () {
    if (!currentSheet) return;
    var body = $('sheetBody'), scroll = body.scrollTop;
    body.textContent = '';
    body.className = 'sheet-body';
    currentSheet.render(body);
    body.scrollTop = scroll;
  };
  K.sheetName = function () { return currentSheet ? currentSheet.name : null; };
  K.closeSheet = function () {
    var prev = currentSheet;
    currentSheet = null;
    $('sheet').hidden = true;
    $('backdrop').hidden = true;
    if (prev && prev.onClose) prev.onClose();
    updateNavState();
  };
  $('sheetClose').addEventListener('click', K.closeSheet);
  $('backdrop').addEventListener('click', K.closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { K.closeSheet(); K.closeCard(); } });

  var tapMarker = null, cardOnClose = null;
  /**
   * Tietokortti alapalkin yläpuolella. o = {title, detail, swatch (css-väri), extras: [el], meta: [teksti],
   * actions: [{label, fn, primary, danger}], ll (napautettu kohta: merkki kartalle), onClose}
   */
  K.showCard = function (o) {
    var card = $('infoCard');
    card.textContent = '';
    var head = h('div', { class: 'info-row' },
      o.swatch ? h('span', { class: 'sw', style: { background: o.swatch } }) : null,
      o.badge || null,
      h('div', null, h('div', { class: 'info-title', text: o.title || '' }),
        o.detail ? h('div', { class: 'info-detail' + (o.detailMuted ? ' muted' : ''), text: o.detail }) : null),
      h('button', { type: 'button', class: 'info-close', 'aria-label': 'Sulje', onclick: K.closeCard }, K.icon('close')));
    card.appendChild(head);
    if (o.extras && o.extras.length) card.appendChild(h('div', { class: 'info-extra' }, o.extras));
    if (o.meta && o.meta.length) card.appendChild(h('div', { class: 'info-meta' }, o.meta.map(function (m) { return h('span', { text: m }); })));
    if (o.actions && o.actions.length) {
      card.appendChild(h('div', { class: 'btn-row' }, o.actions.map(function (a) {
        return h('button', { type: 'button', class: 'btn' + (a.primary ? ' btn-primary' : '') + (a.danger ? ' btn-danger' : ''), text: a.label, onclick: a.fn });
      })));
    }
    card.hidden = false;
    if (cardOnClose) { var f = cardOnClose; cardOnClose = null; f(); }
    cardOnClose = o.onClose || null;
    if (tapMarker) { map.removeLayer(tapMarker); tapMarker = null; }
    if (o.ll) {
      tapMarker = L.marker(o.ll, { interactive: false, keyboard: false,
        icon: L.divIcon({ className: '', html: h('div', { class: 'tap-marker' }), iconSize: [0, 0] }) }).addTo(map);
    }
    K.liftFabs();
  };
  K.closeCard = function () {
    $('infoCard').hidden = true;
    if (tapMarker) { map.removeLayer(tapMarker); tapMarker = null; }
    if (cardOnClose) { var f = cardOnClose; cardOnClose = null; f(); }
    K.liftFabs();
  };

  /** Nostaa oikean reunan painikkeet alareunan korttien ja palkkien yläpuolelle, jos ne menevät päällekkäin. */
  K.liftFabs = function () {
    var fabs = document.querySelector('.fabs'), lift = 0, stack = 0;
    if (!fabs) return;
    var f = fabs.getBoundingClientRect();
    ['infoCard', 'rainBar', 'measureBar', 'drawBar'].forEach(function (id) {
      var el = $(id);
      if (!el || el.hidden) return;
      var b = el.getBoundingClientRect();
      if (!b.width) return;
      var above = Math.ceil(window.innerHeight - b.top + 10);
      stack = Math.max(stack, above);
      if (b.right > f.left - 4) lift = Math.max(lift, above);
    });
    lift = Math.min(lift, Math.max(0, window.innerHeight - 300));
    // --fab-lift: oikean reunan painikkeet; --stack-lift: ilmoitukset, selite ja mittakaava alareunan korttien yläpuolelle.
    document.documentElement.style.setProperty('--fab-lift', lift + 'px');
    document.documentElement.style.setProperty('--stack-lift', Math.min(stack, Math.max(0, window.innerHeight - 200)) + 'px');
  };
  window.addEventListener('resize', function () { K.liftFabs(); });

  /** Etäisyys ja suunta omasta sijainnista tekstinä (tai null). */
  K.fromMe = function (lat, lon) {
    if (!K.pos) return null;
    var d = JG.distance(K.pos.lat, K.pos.lon, lat, lon), b = JG.bearing(K.pos.lat, K.pos.lon, lat, lon);
    return 'Sinusta ' + K.fmtDist(d) + ', ' + Math.round(b) + '° ' + JG.dirName(b);
  };
  /** Kohdan koordinaatit ja etäisyys tietokortin alariville. */
  K.pointMeta = function (lat, lon) {
    var tm = JG.toTM35FIN(lat, lon), out = [K.fmtLatLon(lat, lon), 'TM35 N ' + Math.round(tm.N) + ' E ' + Math.round(tm.E)];
    var fm = K.fromMe(lat, lon);
    if (fm) out.push(fm);
    return out;
  };
  /** Yleinen tietokortti kartan kohdasta: koordinaatit, etäisyys ja suunnistus. */
  K.tapInfo = function (ll, o) {
    o = o || {};
    var extras = (o.extras || []).slice(), fire = K.fireNotice ? K.fireNotice(ll) : null;
    if (fire) extras.unshift(fire); // maastopalovaroitus (metsästys ja eränkäynti) ensimmäisenä
    K.showCard({
      title: o.title || 'Valittu kohta', detail: o.detail, detailMuted: o.detailMuted, swatch: o.swatch, extras: extras, ll: ll,
      meta: K.pointMeta(ll.lat, ll.lng),
      actions: (o.actions || []).concat([{ label: 'Suunnista tänne', primary: !o.actions || !o.actions.length, fn: function () {
        K.setTarget({ lat: ll.lat, lng: ll.lng, name: o.targetName || o.title || 'Valittu kohta' }); K.closeCard();
      } }])
    });
  };

  // --- Kartan napautus: työkalut ja osiot rekisteröivät käsittelijän, jolla on etusija ---
  var clickHandlers = [];
  K.onMapClick = function (fn, prio) { clickHandlers.push({ fn: fn, prio: prio || 0 }); clickHandlers.sort(function (a, b) { return b.prio - a.prio; }); };
  map.on('click', function (e) {
    for (var i = 0; i < clickHandlers.length; i++) {
      try { if (clickHandlers[i].fn(e.latlng, e)) return; } catch (err) { console.error(err); }
    }
    K.tapInfo(e.latlng);
  });

  // ---------------------------------------------------------------------------
  // Osiot ja alapalkki
  // ---------------------------------------------------------------------------

  K.SECTIONS = [
    { id: 'metsastys', name: 'Metsästys', icon: 'feather', desc: 'Metsän ikä, lupa-alueet, kanalintujen elinympäristöt, tuuli ja merkinnät' },
    { id: 'kalastus', name: 'Kalastus', icon: 'fish', desc: 'Perhot ja solmut, jokien vesitilanne, kalapaikat ja saaliit' },
    { id: 'erankaynti', name: 'Eränkäynti', icon: 'tent', desc: 'Autiotuvat, laavut ja tulipaikat, reitit ja suunnistus' }
  ];
  function sectionDef(id) { for (var i = 0; i < K.SECTIONS.length; i++) if (K.SECTIONS[i].id === id) return K.SECTIONS[i]; return null; }
  K.section = null;
  var navDefs = {};
  /** Osion alapalkin painikkeet 3 (päätoiminto) ja 4 (osion tieto): {main: {label, icon, fn}, info: {...}}. */
  K.defineNav = function (sec, def) { navDefs[sec] = def; if (K.section === sec) renderNav(); };

  function setNavBtn(btn, label, icon) {
    var ico = btn.querySelector('.nav-ico');
    ico.textContent = '';
    ico.appendChild(K.icon(icon));
    btn.querySelector('.nav-lbl').textContent = label;
    btn.setAttribute('aria-label', label);
  }
  function renderNav() {
    var d = navDefs[K.section] || {};
    setNavBtn($('navLayers'), 'Tasot', 'layers');
    setNavBtn($('navTools'), 'Työkalut', 'tools');
    setNavBtn($('navMain'), d.main ? d.main.label : 'Merkitse', d.main ? d.main.icon : 'pinPlus');
    setNavBtn($('navInfo'), d.info ? d.info.label : 'Tieto', d.info ? d.info.icon : 'info');
    setNavBtn($('navMenu'), 'Valikko', 'menu');
  }
  var NAV_SHEETS = { navLayers: 'layers', navTools: 'tools', navMenu: 'menu' };
  function updateNavState() {
    var open = K.sheetName();
    Object.keys(NAV_SHEETS).forEach(function (id) { $(id).setAttribute('aria-expanded', String(open === NAV_SHEETS[id])); });
    var d = navDefs[K.section] || {};
    $('navMain').setAttribute('aria-expanded', String(!!(d.main && d.main.sheet && open === d.main.sheet)));
    $('navInfo').setAttribute('aria-expanded', String(!!(d.info && d.info.sheet && open === d.info.sheet)));
  }
  function toggleSheet(name, title, render) {
    if (K.sheetName() === name) { K.closeSheet(); return; }
    K.openSheet(name, title, render);
  }
  $('navLayers').addEventListener('click', function () { toggleSheet('layers', 'Kartta ja tasot', renderLayersSheet); });
  $('navTools').addEventListener('click', function () { toggleSheet('tools', 'Työkalut', renderToolsSheet); });
  $('navMenu').addEventListener('click', function () { toggleSheet('menu', 'Valikko', renderMenuSheet); });
  $('navMain').addEventListener('click', function () {
    var d = navDefs[K.section];
    if (!d || !d.main) return;
    if (d.main.sheet && K.sheetName() === d.main.sheet) { K.closeSheet(); return; }
    d.main.fn();
  });
  $('navInfo').addEventListener('click', function () {
    var d = navDefs[K.section];
    if (!d || !d.info) return;
    if (d.info.sheet && K.sheetName() === d.info.sheet) { K.closeSheet(); return; }
    d.info.fn();
  });

  K.setSection = function (id) {
    if (!sectionDef(id)) id = 'erankaynti';
    var prev = K.section;
    if (prev === id) return;
    hideTip();
    K.closeSheet();
    K.closeCard();
    K.section = id; // vaihdetaan ensin, jotta poistuvan osion tasot tunnistavat olevansa pois käytöstä
    if (prev) K.emit('leave', prev);
    store.set('section', id);
    K.SECTIONS.forEach(function (s) { document.body.classList.remove('sec-' + s.id); });
    document.body.classList.add('sec-' + id);
    var def = sectionDef(id);
    $('sectionName').textContent = def.name;
    var ic = $('sectionIcon');
    ic.textContent = '';
    ic.appendChild(K.icon(def.icon));
    renderNav();
    K.emit('section', id, prev);
  };
  K.inSection = function (id) { return K.section === id; };

  var firstRun = false;
  function renderStart() {
    var box = $('startCards');
    box.textContent = '';
    K.SECTIONS.forEach(function (s) {
      box.appendChild(h('button', { type: 'button', class: 'start-card' + (!firstRun && K.section === s.id ? ' on' : ''), onclick: function () {
        firstRun = false;
        K.hideStart();
        K.setSection(s.id);
      } },
        h('span', { class: 'sc-ico' }, K.icon(s.icon)),
        h('span', null, h('b', { text: s.name }), h('small', { text: s.desc })),
        K.icon('go', 'sc-go')));
    });
  }
  K.showStart = function () { renderStart(); $('start').hidden = false; document.body.classList.add('start-open'); };
  K.hideStart = function () { $('start').hidden = true; document.body.classList.remove('start-open'); };
  $('sectionBtn').addEventListener('click', K.showStart);

  // ---------------------------------------------------------------------------
  // Oma sijainti
  // ---------------------------------------------------------------------------

  K.pos = null;
  var watchId = null, follow = false, firstFix = true, recenterOnFix = true, meLayer = null, meAcc = null, gpsByOthers = {};

  function meIcon(heading) {
    var box = h('div');
    if (heading !== null && heading !== undefined && !isNaN(heading)) box.appendChild(h('div', { class: 'me-arrow', style: { transform: 'rotate(' + Math.round(heading) + 'deg)' } }));
    box.appendChild(h('div', { class: 'me-dot' }));
    return L.divIcon({ className: 'me-marker', html: box, iconSize: [0, 0] });
  }
  function onPos(p) {
    var heading = (p.coords.speed && p.coords.speed > 0.6 && isFinite(p.coords.heading)) ? p.coords.heading : null;
    K.pos = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy || 0, t: p.timestamp || Date.now(), heading: heading };
    var ll = L.latLng(K.pos.lat, K.pos.lon);
    if (!meLayer) {
      meAcc = L.circle(ll, { radius: K.pos.acc, color: '#FF6B35', weight: 1.5, opacity: 0.9, fillColor: '#FF6B35', fillOpacity: 0.1, interactive: false }).addTo(map);
      meLayer = L.marker(ll, { icon: meIcon(heading), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
    } else {
      meAcc.setLatLng(ll).setRadius(K.pos.acc);
      meLayer.setLatLng(ll).setIcon(meIcon(heading));
    }
    var chip = $('gpsChip');
    chip.hidden = false;
    chip.className = 'chip chip-gps';
    chip.textContent = 'GPS ±' + K.fmtInt(K.pos.acc) + ' m';
    if ((firstFix && recenterOnFix) || follow) {
      map.setView(ll, firstFix && follow ? Math.max(map.getZoom(), 14) : map.getZoom(), { animate: !firstFix });
    }
    firstFix = false;
    K.emit('pos', K.pos);
  }
  function onPosErr(err) {
    if (err.code === 1) { K.toast('Sijaintilupa evätty. Salli sijainti selaimen tai puhelimen asetuksista.', null, 7000); K.stopGps(); }
    else if (err.code === 2) K.toast('Sijaintia ei saatu. Onko GPS päällä?');
  }
  /** Käynnistää sijainnin. withFollow: kartta seuraa sijaintia. by: toiminto, joka tarvitsee sijaintia (pysäytetään sen mukana). */
  K.startGps = function (withFollow, by) {
    if (!navigator.geolocation) { K.toast('Laite ei tue sijaintia.'); return; }
    if (by) gpsByOthers[by] = true;
    else { settings.gpsOn = true; K.saveSettings(); $('locateBtn').setAttribute('aria-pressed', 'true'); }
    if (withFollow) setFollow(true);
    if (watchId !== null) return;
    firstFix = true;
    recenterOnFix = !by;
    watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 3000, timeout: 30000 });
    var chip = $('gpsChip');
    chip.hidden = false; chip.className = 'chip'; chip.textContent = 'Haetaan GPS…';
  };
  /**
   * Pysäyttää sijainnin. Ilman by-arvoa käyttäjä sammuttaa sijainnin. by = toiminto (esim. suunnistus), joka
   * käynnisti sijainnin: sijainti pysähtyy vain, jos käyttäjä tai muu toiminto ei enää tarvitse sitä.
   */
  K.stopGps = function (by) {
    if (by) delete gpsByOthers[by];
    else { settings.gpsOn = false; K.saveSettings(); setFollow(false); $('locateBtn').setAttribute('aria-pressed', 'false'); }
    if (settings.gpsOn || Object.keys(gpsByOthers).length) return;
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; K.pos = null;
    setFollow(false);
    if (meLayer) { map.removeLayer(meLayer); map.removeLayer(meAcc); meLayer = meAcc = null; }
    $('gpsChip').hidden = true;
    $('locateBtn').setAttribute('aria-pressed', 'false');
    K.emit('posoff');
  };
  K.gpsActive = function () { return watchId !== null; };
  function setFollow(on) { follow = on; $('locateBtn').classList.toggle('follow', on); }
  map.on('dragstart', function () { if (follow) setFollow(false); });
  $('locateBtn').addEventListener('click', function () {
    if (watchId === null || !settings.gpsOn) { K.startGps(true); if (K.pos) map.setView([K.pos.lat, K.pos.lon], Math.max(map.getZoom(), 14)); return; }
    if (!follow) { setFollow(true); if (K.pos) map.setView([K.pos.lat, K.pos.lon], Math.max(map.getZoom(), 14)); return; }
    K.stopGps();
    K.toast('Sijainti pois päältä.');
  });
  /** Sijainti, jos se on tuore, muuten kartan keskipiste. */
  K.wherePoint = function (maxAgeMs) {
    if (K.pos && Date.now() - K.pos.t < (maxAgeMs || 30 * 60000)) return { lat: K.pos.lat, lon: K.pos.lon, src: 'gps' };
    var c = map.getCenter();
    return { lat: c.lat, lon: c.lng, src: 'map' };
  };

  // ---------------------------------------------------------------------------
  // Puhelimen suunta: kuunnellaan vain, kun jokin toiminto tarvitsee sitä
  // ---------------------------------------------------------------------------

  K.heading = null;
  var orientUsers = {}, smooth = null, lastEmit = 0, gotHeading = 0;
  var ORIENT_EVENT = ('ondeviceorientationabsolute' in window) ? 'deviceorientationabsolute' : 'deviceorientation';
  function screenAngle() {
    var o = window.screen && window.screen.orientation;
    return o && typeof o.angle === 'number' ? o.angle : (typeof window.orientation === 'number' ? window.orientation : 0);
  }
  function onOrient(e) {
    if (e.type === 'deviceorientation' && !e.absolute && typeof e.webkitCompassHeading !== 'number') return;
    var hd = MK.compassHeading(e, screenAngle());
    if (hd === null) return;
    gotHeading = Date.now();
    smooth = smooth === null ? hd : MK.norm360(smooth + MK.angleDiff(smooth, hd) * 0.3);
    var now = Date.now();
    if (now - lastEmit < 66) return;
    lastEmit = now;
    K.heading = smooth;
    K.emit('heading', smooth);
  }
  function listening() { return Object.keys(orientUsers).length > 0; }
  K.orient = {
    /** Ottaa suunnan käyttöön (name) tai pois. Palauttaa lupauksen: saatiinko käyttölupa. */
    use: function (name, on) {
      if (!on) {
        delete orientUsers[name];
        if (!listening()) { window.removeEventListener(ORIENT_EVENT, onOrient); K.heading = null; smooth = null; }
        return Promise.resolve(true);
      }
      if (listening()) { orientUsers[name] = true; return Promise.resolve(true); }
      var ask = (window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') ?
        DeviceOrientationEvent.requestPermission().catch(function () { return 'denied'; }) : Promise.resolve('granted');
      return ask.then(function (st) {
        if (st !== 'granted') return false;
        if (!listening()) { gotHeading = 0; window.addEventListener(ORIENT_EVENT, onOrient); }
        orientUsers[name] = true;
        return true;
      });
    },
    active: function (name) { return !!orientUsers[name]; },
    gotRecently: function () { return Date.now() - gotHeading < 4000; }
  };
  document.addEventListener('visibilitychange', function () {
    if (!listening()) return;
    if (document.visibilityState === 'visible') window.addEventListener(ORIENT_EVENT, onOrient);
    else window.removeEventListener(ORIENT_EVENT, onOrient);
  });
  K.onOrientEvent = onOrient; // testejä varten

  // --- Kartan kääntö ja kompassiseuranta ---
  var compassFollow = false, settingBearing = false, lastRot = 0;
  function isRotated() { var b = K.bearing(); return Math.abs(((b % 360) + 540) % 360 - 180) > 0.5; }
  function updateCompassBtn() {
    var btn = $('compassBtn');
    btn.hidden = !CAN_ROTATE;
    btn.classList.toggle('follow', compassFollow);
    btn.setAttribute('aria-pressed', String(compassFollow));
    btn.setAttribute('aria-label', compassFollow ? 'Lopeta kompassiseuranta' : (isRotated() ? 'Käännä pohjoinen ylös' : 'Käännä kartta katsomasuuntaan'));
    btn.querySelector('svg').style.transform = 'rotate(' + Math.round(K.bearing()) + 'deg)';
  }
  K.on('heading', function (hd) {
    if (!compassFollow || !rot) return;
    var now = Date.now();
    if (now - lastRot < 66) return;
    var target = MK.norm360(-hd);
    if (Math.abs(MK.angleDiff(K.bearing(), target)) < 1) return;
    lastRot = now;
    settingBearing = true;
    try { map.setBearing(target); } finally { settingBearing = false; }
  });
  function startCompassFollow() {
    return K.orient.use('follow', true).then(function (ok) {
      if (!ok) { K.toast('Kompassin käyttölupaa ei saatu.'); return; }
      compassFollow = true;
      updateCompassBtn();
      K.toast('Kartta kääntyy katsomasuuntaasi.');
      setTimeout(function () {
        if (compassFollow && !K.orient.gotRecently()) { stopCompassFollow(); K.toast('Puhelimen kompassia ei saatu käyttöön.'); }
      }, 3000);
    });
  }
  function stopCompassFollow() { compassFollow = false; K.orient.use('follow', false); updateCompassBtn(); }
  if (CAN_ROTATE) {
    $('compassBtn').addEventListener('click', function () {
      if (compassFollow) { stopCompassFollow(); map.setBearing(0); }
      else if (isRotated()) map.setBearing(0);
      else if (settings.compassFeature) startCompassFollow();
      updateCompassBtn();
    });
    map.on('rotate', function () { updateCompassBtn(); K.emit('rotate', K.bearing()); });
    map.on('rotatestart', function () { if (compassFollow) { stopCompassFollow(); K.toast('Kompassiseuranta lopetettu.'); } });
  }
  updateCompassBtn();
  K.stopCompassFollow = function () { if (compassFollow) { stopCompassFollow(); map.setBearing(0); } };

  // ---------------------------------------------------------------------------
  // Suunnistus kohteeseen: katkoviiva kartalla ja suuntakortti
  // ---------------------------------------------------------------------------

  K.target = null;
  var targetLayer = L.layerGroup().addTo(map), targetUI = null;
  K.setTarget = function (t) {
    K.target = { lat: Number(t.lat), lng: Number(t.lng), name: String(t.name || 'Kohde').slice(0, 80) };
    K.startGps(false, 'target');
    K.orient.use('target', true);
    buildTargetCard();
    updateTarget();
    if (K.pos) K.fitBounds([[K.pos.lat, K.pos.lon], [K.target.lat, K.target.lng]], { paddingTopLeft: [40, 250], paddingBottomRight: [90, 130] });
    else map.setView([K.target.lat, K.target.lng], Math.max(map.getZoom(), 13));
  };
  K.clearTarget = function () {
    K.target = null;
    targetLayer.clearLayers();
    $('targetCard').hidden = true;
    targetUI = null;
    K.orient.use('target', false);
    K.stopGps('target');
  };
  function buildTargetCard() {
    var card = $('targetCard');
    card.textContent = '';
    var svg = sv('svg', { viewBox: '0 0 100 100', class: 'target-arrow', 'aria-hidden': 'true' });
    sv('circle', { cx: 50, cy: 50, r: 46, fill: 'none', stroke: 'rgba(140,147,158,0.5)', 'stroke-width': 3 }, svg);
    var g = sv('g', {}, svg);
    sv('path', { d: 'M50 10 L66 58 L50 48 L34 58 Z', fill: '#FF6B35', stroke: '#1A2F25', 'stroke-width': 2, 'stroke-linejoin': 'round' }, g);
    var name = h('div', { class: 'target-name' }), dist = h('div', { class: 'target-dist', text: '–' }), dir = h('div', { class: 'target-dir' });
    card.appendChild(name); card.appendChild(svg); card.appendChild(dist); card.appendChild(dir);
    card.appendChild(h('button', { type: 'button', class: 'btn', text: 'Lopeta', onclick: K.clearTarget }));
    targetUI = { name: name, arrow: g, dist: dist, dir: dir };
    card.hidden = false;
  }
  function updateTarget() {
    if (!K.target || !targetUI) return;
    var t = K.target;
    targetUI.name.textContent = t.name;
    targetLayer.clearLayers();
    if (!K.pos) {
      targetUI.dist.textContent = '–';
      targetUI.dir.textContent = 'Odotetaan sijaintia…';
      targetUI.arrow.setAttribute('visibility', 'hidden');
      L.circleMarker([t.lat, t.lng], { pane: 'targetPane', radius: 9, color: '#1A2F25', weight: 3, fillColor: '#FF6B35', fillOpacity: 1, interactive: false }).addTo(targetLayer);
      return;
    }
    var d = JG.distance(K.pos.lat, K.pos.lon, t.lat, t.lng), brg = JG.bearing(K.pos.lat, K.pos.lon, t.lat, t.lng);
    L.polyline([[K.pos.lat, K.pos.lon], [t.lat, t.lng]], { pane: 'targetPane', color: '#FF6B35', weight: 4, opacity: 0.95, dashArray: '8 9', interactive: false }).addTo(targetLayer);
    L.circleMarker([t.lat, t.lng], { pane: 'targetPane', radius: 9, color: '#1A2F25', weight: 3, fillColor: '#FF6B35', fillOpacity: 1, interactive: false }).addTo(targetLayer);
    targetUI.dist.textContent = K.fmtDist(d);
    var hd = K.heading;
    if (d < 25) {
      targetUI.dir.textContent = 'Olet perillä.';
      targetUI.arrow.setAttribute('visibility', 'hidden');
      return;
    }
    targetUI.arrow.setAttribute('visibility', 'visible');
    // Puhelimen suunnalla nuoli osoittaa kohteeseen, kun puhelinta pidetään vaakatasossa; ilman sitä suunta näytön mukaan.
    var rel = hd !== null ? brg - hd : brg + K.bearing();
    targetUI.arrow.setAttribute('transform', 'rotate(' + rel.toFixed(1) + ' 50 50)');
    targetUI.dir.textContent = Math.round(brg) + '° ' + JG.dirName(brg, true) + (hd === null ? ' · kartan mukaan' : '');
  }
  K.on('pos', updateTarget);
  K.on('heading', function () { if (K.target) updateTarget(); });
  K.on('rotate', function () { if (K.target) updateTarget(); });

  // ---------------------------------------------------------------------------
  // Näyttö päällä (valinnainen)
  // ---------------------------------------------------------------------------

  var wakeLock = null;
  K.applyWakeLock = function () {
    if (settings.wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
      if (wakeLock) return;
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
        l.addEventListener('release', function () { wakeLock = null; });
      }).catch(function () { /* ei tuettu */ });
    } else if (!settings.wakeLock && wakeLock) { wakeLock.release(); wakeLock = null; }
  };
  document.addEventListener('visibilitychange', K.applyWakeLock);

  // ---------------------------------------------------------------------------
  // Offline-tallennus: maastokartan tiilet ja alueen data laitteen välimuistiin
  // ---------------------------------------------------------------------------

  var TILE_CACHE = 'kaira-tiles-v1', DATA_CACHE = 'kaira-data-v1';
  var OFFLINE_ZMIN = 8, TILE_PAD_DEG = 0.004, CONCURRENCY = 6, MAX_TILES = 60000, BIG_MB = 300;
  K.TILE_CACHE = TILE_CACHE; K.DATA_CACHE = DATA_CACHE;
  var offlineRecs = store.get('offline', {});
  if (!offlineRecs || typeof offlineRecs !== 'object') offlineRecs = {};
  function saveOfflineRecs() { store.set('offline', offlineRecs); }
  var dlJob = null;

  function offlineLayers() {
    if (!K.hasKey()) return [];
    return settings.offlineOrtho ? ['maastokartta', 'ortokuva'] : ['maastokartta'];
  }
  function requestPersist() {
    if (navigator.storage && navigator.storage.persist) return navigator.storage.persist().catch(function () { return false; });
    return Promise.resolve(false);
  }
  function fetchTile(url, job, attempt) {
    // cache: 'no-store': service worker ei käsittele tallennushakua, koska tiili tallennetaan tässä itse.
    return fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', signal: job.ctrl.signal }).then(function (r) {
      if (r.ok) { job.ok++; return r; }
      if (r.status === 401 || r.status === 403) job.authFail++;
      if (r.status >= 500 && attempt < 2) return K.wait(800 * (attempt + 1)).then(function () { return fetchTile(url, job, attempt + 1); });
      job.failed++;
      return null;
    }, function (err) {
      if (job.ctrl.signal.aborted) throw err;
      if (attempt < 2) return K.wait(800 * (attempt + 1)).then(function () { return fetchTile(url, job, attempt + 1); });
      if (err instanceof TypeError) job.corsFail++;
      job.failed++;
      return null;
    });
  }

  K.offline = {
    records: function () { return offlineRecs; },
    get: function (id) { return offlineRecs[id] || null; },
    busy: function () { return dlJob; },
    /** Arvio: bounds = [[s, w], [n, e]]. */
    estimate: function (bounds, extraBytes) {
      var layers = offlineLayers(), n = 0, bytes = extraBytes || 0;
      var count = MK.countTiles(bounds, OFFLINE_ZMIN, settings.maxZoom, TILE_PAD_DEG);
      layers.forEach(function (l) { n += count; bytes += count * MML_LAYERS[l].estKB * 1000; });
      return { tiles: n, bytes: bytes, tooBig: n > MAX_TILES };
    },
    /**
     * Tallentaa alueen: spec = {id, name, kind, bounds, dataUrls, version, extraBytes}, ui = {start, update, finish}.
     * Maastokartan tiilet tallentuvat vain MML:n avaimella. Data tallentuu aina.
     */
    save: function (spec, ui) {
      if (dlJob) { K.toast('Tallennus on jo käynnissä.'); return; }
      if (!navigator.onLine) { K.toast('Tallentaminen vaatii verkkoyhteyden.'); return; }
      var est = K.offline.estimate(spec.bounds, spec.extraBytes);
      if (est.tooBig) { K.toast('Alue on liian suuri tallennettavaksi. Valitse tarkkuus 15 tai pienempi alue.', null, 7000); return; }
      if (est.bytes > BIG_MB * 1e6 && !confirm('Tallennus on iso (n. ' + K.fmtMB(est.bytes) + '). Voit pienentää sitä asetuksista valitsemalla tarkkuuden 15. Jatketaanko?')) return;
      var key = settings.apiKey, layers = offlineLayers(), tiles = [];
      layers.forEach(function (l) {
        MK.listTiles(spec.bounds, OFFLINE_ZMIN, settings.maxZoom, TILE_PAD_DEG).forEach(function (t) { tiles.push([l, t[0], t[1], t[2]]); });
      });
      var dataUrls = (spec.dataUrls || []).filter(Boolean).map(K.absUrl);
      var job = { ctrl: new AbortController(), done: 0, failed: 0, total: tiles.length + dataUrls.length, authFail: 0, corsFail: 0, ok: 0, id: spec.id, ui: ui };
      dlJob = job;
      job.ui.start(job);
      var dataCache;
      requestPersist()
        .then(function () { return caches.open(DATA_CACHE); })
        .then(function (dc) {
          dataCache = dc;
          if (!spec.cleanPrefix) return;
          // Saman alueen vanhat versiot pois välimuistista.
          var prefix = K.absUrl(spec.cleanPrefix);
          return dc.keys().then(function (keys) {
            return Promise.all(keys.filter(function (k) { return k.url.indexOf(prefix) === 0 && dataUrls.indexOf(k.url) < 0; }).map(function (k) { return dc.delete(k); }));
          });
        })
        .then(function () {
          return dataUrls.reduce(function (p, u) {
            return p.then(function () {
              return fetch(u, { cache: 'no-cache', signal: job.ctrl.signal }).then(function (r) {
                if (!r.ok) throw new Error('Tiedostoa ei saatu (' + r.status + ')');
                if (/text\/html/i.test(r.headers.get('Content-Type') || '')) throw new Error('Tiedostoa ei löytynyt: ' + u.split('?')[0].split('/').slice(-2).join('/'));
                return dataCache.put(u, r);
              }).then(function () { job.done++; job.ui.update(job); });
            });
          }, Promise.resolve());
        })
        .then(function () { return caches.open(TILE_CACHE); })
        .then(function (tc) {
          var i = 0;
          function worker() {
            if (job.ctrl.signal.aborted || i >= tiles.length) return Promise.resolve();
            var t = tiles[i++], k = K.mmlTileKey(t[0], t[1], t[2], t[3]);
            return tc.match(k).then(function (hit) {
              if (hit) return;
              return fetchTile(k + '?api-key=' + encodeURIComponent(key), job, 0).then(function (r) { if (r) return tc.put(k, r); });
            }).then(function () {
              job.done++;
              if (job.done % 10 === 0 || job.done === job.total) job.ui.update(job);
              if (job.authFail >= 5 && job.ok === 0) { job.ctrl.abort(); throw new Error('Maanmittauslaitos hylkäsi API-avaimen. Tarkista avain asetuksista.'); }
              if (job.corsFail >= 8 && job.ok === 0) { job.ctrl.abort(); throw new Error('Karttatiilien tallennus estettiin. Data tallentui, maastokartta ei.'); }
              return worker();
            });
          }
          var ws = [];
          for (var w = 0; w < CONCURRENCY; w++) ws.push(worker());
          return Promise.all(ws);
        })
        .then(function () {
          if (job.ctrl.signal.aborted) throw new Error('Keskeytetty');
          offlineRecs[spec.id] = { name: spec.name, kind: spec.kind || 'alue', bounds: spec.bounds, version: spec.version || null, date: Date.now(),
            maxZoom: settings.maxZoom, layers: layers, tiles: tiles.length, failed: job.failed, dataUrls: dataUrls };
          saveOfflineRecs();
          dlJob = null;
          job.ui.finish(null, job);
          K.emit('offline-saved', spec.id);
        })
        .catch(function (e) {
          dlJob = null;
          if (e && e.message !== 'Keskeytetty' && e.name !== 'AbortError') console.error(e);
          if (dataUrls.length && job.done >= dataUrls.length && !offlineRecs[spec.id]) {
            offlineRecs[spec.id] = { name: spec.name, kind: spec.kind || 'alue', bounds: spec.bounds, version: spec.version || null, date: Date.now(),
              maxZoom: settings.maxZoom, layers: [], tiles: 0, failed: tiles.length, partial: true, dataUrls: dataUrls };
            saveOfflineRecs();
          }
          job.ui.finish(e, job);
        });
    },
    cancel: function () { if (dlJob) dlJob.ctrl.abort(); },
    remove: function (id) {
      var rec = offlineRecs[id], keep = {};
      Object.keys(offlineRecs).forEach(function (oid) {
        var o = offlineRecs[oid];
        if (oid === id || !o || !o.bounds) return;
        (o.layers || []).forEach(function (l) {
          MK.listTiles(o.bounds, OFFLINE_ZMIN, o.maxZoom || 16, TILE_PAD_DEG).forEach(function (t) { keep[K.mmlTileKey(l, t[0], t[1], t[2])] = 1; });
        });
      });
      return caches.open(TILE_CACHE).then(function (tc) {
        var dels = [];
        if (rec && rec.bounds) (rec.layers || []).forEach(function (l) {
          MK.listTiles(rec.bounds, OFFLINE_ZMIN, rec.maxZoom || 16, TILE_PAD_DEG).forEach(function (t) {
            var k = K.mmlTileKey(l, t[0], t[1], t[2]);
            if (!keep[k]) dels.push(tc.delete(k));
          });
        });
        return Promise.all(dels);
      }).then(function () { return caches.open(DATA_CACHE); }).then(function (dc) {
        var keepData = {};
        Object.keys(offlineRecs).forEach(function (oid) { if (oid !== id) (offlineRecs[oid].dataUrls || []).forEach(function (u) { keepData[u] = 1; }); });
        return Promise.all(((rec && rec.dataUrls) || []).filter(function (u) { return !keepData[u]; }).map(function (u) { return dc.delete(u); }));
      }).then(function () { delete offlineRecs[id]; saveOfflineRecs(); });
    },
    clearAll: function () {
      return Promise.all([caches.delete(TILE_CACHE), caches.delete(DATA_CACHE)]).then(function () { offlineRecs = {}; saveOfflineRecs(); });
    }
  };

  /**
   * Tallennuskortti: tila, painike ja edistyminen. spec kuten K.offline.save. Käytetään alueiden listoissa.
   * opts.onDone(err) kutsutaan, kun tallennus päättyy.
   */
  K.offlineControls = function (spec, opts) {
    opts = opts || {};
    var rec = K.offline.get(spec.id), wrap = h('div', { class: 'card-foot' + (opts.compact ? ' compact' : '') });
    var status;
    if (rec && spec.version && rec.version !== spec.version) status = h('span', { class: 'status status-warn', text: 'Päivitys saatavilla' });
    else if (rec && rec.partial) status = h('span', { class: 'status status-warn', text: 'Tallennettu ilman maastokarttaa' });
    else if (rec) status = h('span', { class: 'status status-ok', text: '✓ Offline ' + K.fmtDate(rec.date) + (rec.layers && rec.layers.length ? ' · tarkkuus ' + rec.maxZoom : '') + (rec.failed ? ' · ' + rec.failed + ' tiiltä puuttuu' : '') });
    else status = h('span', { class: 'status muted', text: opts.compact ? 'Ei offline-käytössä' : 'Ei tallennettu offline-käyttöön' });
    wrap.appendChild(status);
    var row = h('div', { class: 'btn-row' });
    var progress = h('div', { class: 'progress', hidden: true },
      h('div', { class: 'progress-bar' }, h('span')),
      h('div', { class: 'progress-text' }, h('span', { class: 'pt' }), h('button', { type: 'button', class: 'btn', text: 'Keskeytä', onclick: K.offline.cancel })));
    var ui = {
      start: function (job) { row.hidden = true; progress.hidden = false; ui.update(job); },
      update: function (job) {
        var p = Math.min(100, Math.round(100 * job.done / Math.max(1, job.total)));
        progress.querySelector('.progress-bar span').style.width = p + '%';
        progress.querySelector('.pt').textContent = p + ' % · ' + K.fmtInt(job.done) + ' / ' + K.fmtInt(job.total);
      },
      finish: function (err, job) {
        if (err) K.toast(err.name === 'AbortError' || err.message === 'Keskeytetty' ? 'Tallennus keskeytetty.' : err.message, null, 8000);
        else K.toast('Tallennettu offline-käyttöön: ' + spec.name + (job.failed ? ' (' + job.failed + ' tiiltä epäonnistui, yritä uudelleen)' : ''));
        if (opts.onDone) opts.onDone(err);
        K.renderSheet();
      }
    };
    var job = K.offline.busy();
    if (job && job.id === spec.id) { job.ui = ui; row.hidden = true; progress.hidden = false; setTimeout(function () { if (K.offline.busy()) ui.update(K.offline.busy()); }, 0); }
    else if (job) row.appendChild(h('span', { class: 'muted small', text: 'Toinen tallennus käynnissä…' }));
    else if (!rec || (spec.version && rec.version !== spec.version) || rec.partial || rec.failed) {
      var est = K.offline.estimate(spec.bounds, spec.extraBytes);
      var label = rec ? ((spec.version && rec.version !== spec.version) ? 'Päivitä' : 'Täydennä') : 'Tallenna offline';
      row.appendChild(h('button', { type: 'button', class: opts.compact ? 'btn btn-sm btn-accent' : 'btn btn-primary', disabled: est.tooBig,
        text: est.tooBig ? 'Liian suuri alue' : (opts.compact && !rec ? 'Offline' : label) + ' · ' + K.fmtMB(est.bytes),
        onclick: function () { K.offline.save(spec, ui); } }));
    }
    if (rec && !job) row.appendChild(h('button', { type: 'button', class: 'btn btn-danger' + (opts.compact ? ' btn-sm' : ''), text: 'Poista',
      onclick: function () { K.offline.remove(spec.id).then(function () { K.toast('Offline-tiedot poistettu.'); K.renderSheet(); }); } }));
    wrap.appendChild(row);
    wrap.appendChild(progress);
    return wrap;
  };

  // ---------------------------------------------------------------------------
  // Hätäkoordinaatit
  // ---------------------------------------------------------------------------

  function renderSos(body) {
    body.appendChild(h('p', { class: 'sos-big', text: 'Hätätilanteessa soita 112' }));
    body.appendChild(h('p', { class: 'muted', text: 'Kerro hätäkeskukselle nämä koordinaatit.' }));
    if (!K.pos) {
      body.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn btn-primary btn-block', type: 'button', text: K.gpsActive() ? 'Haetaan sijaintia…' : 'Hae sijainti',
        disabled: K.gpsActive(), onclick: function () { K.startGps(false, 'sos'); K.renderSheet(); } })));
      body.appendChild(h('p', { class: 'muted small', text: 'GPS toimii ilman verkkoa. Ensimmäinen paikannus voi kestää hetken.' }));
      return;
    }
    var p = K.pos, tm = JG.toTM35FIN(p.lat, p.lon), wgs = p.lat.toFixed(5) + ', ' + p.lon.toFixed(5);
    function row(label, val, big) { return h('div', { class: 'kv' + (big ? ' kv-big' : '') }, h('span', { text: label }), h('b', { class: 'coords', text: val })); }
    body.appendChild(row('WGS84', wgs, true));
    body.appendChild(row('Asteet, minuutit', 'N ' + JG.fmtDM(p.lat) + ', E ' + JG.fmtDM(p.lon)));
    body.appendChild(row('ETRS-TM35FIN', 'N ' + Math.round(tm.N) + ', E ' + Math.round(tm.E)));
    body.appendChild(row('Tarkkuus', '± ' + Math.round(p.acc) + ' m'));
    body.appendChild(row('Aika', K.hm(p.t)));
    body.appendChild(h('div', { class: 'btn-row', style: { marginTop: '12px' } }, h('button', { class: 'btn btn-primary', type: 'button', text: 'Kopioi koordinaatit', onclick: function () {
      var txt = 'WGS84 ' + wgs + ' / ETRS-TM35FIN N ' + Math.round(tm.N) + ' E ' + Math.round(tm.E);
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { K.toast('Kopioitu.'); }, function () { K.toast('Kopiointi ei onnistunut.'); });
    } })));
  }
  $('sosBtn').addEventListener('click', function () {
    K.openSheet('sos', 'Sijaintini koordinaatteina', renderSos, { onClose: function () { K.stopGps('sos'); } });
    K.startGps(false, 'sos');
  });
  K.on('pos', function () { if (K.sheetName() === 'sos') K.renderSheet(); });

  // ---------------------------------------------------------------------------
  // Lomakeapurit
  // ---------------------------------------------------------------------------

  K.toggleRow = function (label, hint, value, onChange) {
    var input = h('input', { type: 'checkbox', role: 'switch' });
    input.checked = !!value;
    input.addEventListener('change', function () { onChange(input.checked); });
    return h('label', { class: 'toggle' }, h('span', null, label, hint ? h('small', { text: hint }) : null), h('span', { class: 'switch' }, input, h('i')));
  };
  /** Valintapainikkeet: options = [[arvo, teksti], ...]. */
  K.seg = function (options, value, onPick, o) {
    o = o || {};
    var box = h('div', { class: 'seg' + (o.cls ? ' ' + o.cls : ''), role: 'group', 'aria-label': o.label || '' });
    options.forEach(function (op) {
      box.appendChild(h('button', { type: 'button', 'aria-pressed': String(op[0] === value), disabled: op[2] === false, text: op[1], onclick: function () { onPick(op[0]); } }));
    });
    return box;
  };
  K.menuItem = function (icon, title, sub, fn, on) {
    return h('button', { type: 'button', class: 'menu-item' + (on ? ' on' : ''), onclick: fn },
      h('span', { class: 'mi-ico' }, K.icon(icon)), h('span', null, h('b', { text: title }), sub ? h('small', { text: sub }) : null));
  };
  K.numberField = function (id, label, value, min, max, step, hint, set) {
    var input = h('input', { class: 'input', type: 'number', inputmode: 'decimal', id: id, min: String(min), max: String(max), step: String(step), value: String(value) });
    input.addEventListener('change', function () {
      var v = Number(String(input.value).replace(',', '.'));
      if (!isFinite(v)) return;
      v = Math.max(min, Math.min(max, v));
      input.value = String(v);
      set(v); K.saveSettings();
    });
    return h('div', { class: 'field' }, h('label', { for: id, text: label }), input, hint ? h('span', { class: 'hint', text: hint }) : null);
  };

  // ---------------------------------------------------------------------------
  // Tasot, työkalut ja valikko
  // ---------------------------------------------------------------------------

  function renderLayersSheet(body) {
    var hasKey = K.hasKey();
    body.appendChild(h('h3', { text: 'Pohjakartta' }));
    body.appendChild(K.seg(Object.keys(MML_LAYERS).map(function (k) { return [k, MML_LAYERS[k].name, hasKey]; }), hasKey ? settings.basemap : null, function (v) {
      settings.basemap = v; K.saveSettings(); K.setBasemap(); K.renderSheet();
    }, { label: 'Pohjakartta' }));
    if (!hasKey) body.appendChild(h('div', { class: 'notice' }, 'Ilman Maanmittauslaitoksen API-avainta näytetään OpenStreetMap, joka toimii vain verkossa. ',
      h('a', { href: '#', onclick: function (e) { e.preventDefault(); K.openSettings(); }, text: 'Lisää avain asetuksiin' }), '.'));
    body.appendChild(K.toggleRow('Himmennä kartta', 'Yökäyttöön: pohjakartta tummemmaksi', settings.mapDim, function (v) { settings.mapDim = v; K.saveSettings(); K.applyDim(); }));
    K.emit('layers', body, K.section);
  }
  function renderToolsSheet(body) {
    var list = h('div', { class: 'menu-list' });
    body.appendChild(list);
    K.emit('tools', list, K.section);
  }
  function renderMenuSheet(body) {
    var list = h('div', { class: 'menu-list' });
    K.emit('menutop', list, K.section);
    var n = Object.keys(offlineRecs).length;
    list.appendChild(K.menuItem('offline', 'Offline-alueet', n ? n + ' tallennettua aluetta' : 'Ei tallennettuja alueita', function () { K.openSheet('offline', 'Offline-alueet', renderOfflineSheet); }));
    list.appendChild(K.menuItem('gear', 'Asetukset', 'API-avain, offline-tarkkuus, näyttö', K.openSettings));
    K.emit('menu', list, K.section);
    list.appendChild(K.menuItem('shield', 'Tietolähteet ja tietosuoja', 'Mistä tiedot tulevat, mitä laitteesta lähtee', function () { K.openSheet('sources', 'Tietolähteet ja tietosuoja', renderSourcesSheet); }));
    list.appendChild(K.menuItem('gear', 'Tietoa sovelluksesta', 'Versio ' + K.VERSION + ' · päivityksen tarkistus', function () { K.openSheet('about', 'Tietoa sovelluksesta', renderAboutSheet); }));
    body.appendChild(list);
    if (!K.isStandalone()) {
      body.appendChild(h('div', { class: 'notice' }, h('b', { text: K.isIOS() ? 'Lisää Kaira kotinäytölle' : 'Asenna Kaira' }),
        K.isIOS() ? ', jotta tallennetut kartat säilyvät: Safari → Jaa → Lisää Koti-valikkoon.' : ', jotta tallennetut kartat säilyvät: selaimen valikko → Asenna sovellus.'));
    }
  }
  function renderOfflineSheet(body) {
    var ids = Object.keys(offlineRecs);
    if (!K.hasKey()) body.appendChild(h('div', { class: 'notice', text: 'Maastokartan tallennus vaatii MML:n API-avaimen. Ilman avainta tallentuu vain alueen data.' }));
    if (!ids.length) body.appendChild(h('p', { class: 'muted', text: 'Ei tallennettuja alueita. Tallenna alue osion alueluettelosta, tasoista tai Työkalut-valikosta (Tallenna näkymä).' }));
    ids.sort(function (a, b) { return offlineRecs[b].date - offlineRecs[a].date; }).forEach(function (id) {
      var r = offlineRecs[id];
      body.appendChild(h('div', { class: 'card' },
        h('button', { type: 'button', class: 'card-main', onclick: function () { if (r.bounds) { K.closeSheet(); K.fitBounds(r.bounds); } } },
          h('div', { class: 'card-title', text: r.name || id }),
          h('div', { class: 'card-sub', text: 'Tallennettu ' + K.fmtDate(r.date) + (r.layers && r.layers.length ? ' · ' + K.fmtInt(r.tiles) + ' tiiltä, tarkkuus ' + r.maxZoom : ' · vain data') + (r.failed ? ' · ' + r.failed + ' puuttuu' : '') })),
        h('div', { class: 'card-foot' }, h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn', text: 'Näytä', onclick: function () { if (r.bounds) { K.closeSheet(); K.fitBounds(r.bounds); } } }),
          h('button', { type: 'button', class: 'btn btn-danger', text: 'Poista', onclick: function () {
            K.offline.remove(id).then(function () { K.toast('Offline-alue poistettu.'); K.renderSheet(); });
          } })))));
    });
    var storageP = h('p', { class: 'muted small', text: '' });
    body.appendChild(h('h3', { text: 'Tallennustila' }));
    body.appendChild(storageP);
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) {
      storageP.textContent = 'Käytössä ' + K.fmtMB(e.usage || 0) + (e.quota ? ' / saatavilla ' + K.fmtMB(e.quota) : '');
    });
    if (ids.length) body.appendChild(h('button', { type: 'button', class: 'btn btn-danger', text: 'Poista kaikki offline-alueet', onclick: function () {
      if (confirm('Poistetaanko kaikki tallennetut kartat tästä laitteesta?')) K.offline.clearAll().then(function () { K.toast('Offline-kartat poistettu.'); K.renderSheet(); });
    } }));
  }
  K.openSettings = function () { K.openSheet('settings', 'Asetukset', renderSettingsSheet); };
  function renderSettingsSheet(body) {
    body.appendChild(h('h3', { text: 'Maanmittauslaitos' }));
    var keyInput = h('input', { class: 'input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', id: 'apiKey', placeholder: 'API-avain' });
    keyInput.value = settings.apiKey;
    var show = h('button', { type: 'button', class: 'btn', text: 'Näytä', onclick: function () {
      keyInput.type = keyInput.type === 'password' ? 'text' : 'password'; show.textContent = keyInput.type === 'password' ? 'Näytä' : 'Piilota'; } });
    keyInput.addEventListener('change', function () {
      settings.apiKey = JG.sanitizeKey(keyInput.value); keyInput.value = settings.apiKey;
      K.saveSettings(); K.setBasemap(); K.toast(settings.apiKey ? 'API-avain tallennettu tähän laitteeseen.' : 'API-avain poistettu.');
    });
    body.appendChild(h('div', { class: 'field' }, h('label', { for: 'apiKey', text: 'API-avain' }), h('div', { class: 'input-row' }, keyInput, show),
      h('span', { class: 'hint' }, 'Avain tallentuu vain tähän laitteeseen ja lähtee vain Maanmittauslaitokselle. ',
        h('a', { href: 'https://www.maanmittauslaitos.fi/rajapinnat/api-avaimen-ohje', target: '_blank', rel: 'noopener noreferrer', text: 'Näin saat ilmaisen avaimen' }), '.')));

    body.appendChild(h('h3', { text: 'Offline-tallennus' }));
    body.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Maastokartan tarkkuus' }),
      K.seg([[15, 'Tarkkuus 15 (kevyt)'], [16, 'Tarkkuus 16 (tarkin)']], settings.maxZoom, function (v) { settings.maxZoom = v; K.saveSettings(); K.renderSheet(); }),
      h('span', { class: 'hint', text: 'Taso 16 on tarkin avoimesti saatava. Taso 15 vie noin neljänneksen tilasta.' })));
    body.appendChild(K.toggleRow('Tallenna myös ilmakuva', 'Noin kaksinkertaistaa tilantarpeen', settings.offlineOrtho, function (v) { settings.offlineOrtho = v; K.saveSettings(); }));

    body.appendChild(h('h3', { text: 'Näyttö ja kompassi' }));
    body.appendChild(K.toggleRow('Pidä näyttö päällä', 'Kuluttaa akkua', settings.wakeLock, function (v) { settings.wakeLock = v; K.saveSettings(); K.applyWakeLock(); }));
    body.appendChild(K.toggleRow('Kompassiseuranta', 'Kompassipainikkeesta kartta kääntyy katsomasuuntaasi', settings.compassFeature, function (v) {
      settings.compassFeature = v; K.saveSettings(); if (!v) K.stopCompassFollow(); updateCompassBtn();
    }));
    K.emit('settings', body);

    body.appendChild(h('h3', { text: 'Tiedot tässä laitteessa' }));
    body.appendChild(h('p', { class: 'muted small', text: 'Merkinnät, saaliit, reitit, tuodut tasot ja offline-kartat ovat vain tässä laitteessa. Poista ne ennen laitteen luovuttamista.' }));
    body.appendChild(h('button', { type: 'button', class: 'btn btn-danger', text: 'Poista kaikki Kairan tiedot', onclick: function () {
      if (!confirm('Poistetaanko API-avain, merkinnät, saaliit, reitit, tasot ja offline-kartat tästä laitteesta? Tätä ei voi perua.')) return;
      store.clearAll();
      caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k.indexOf('kaira-') === 0; }).map(function (k) { return caches.delete(k); })); })
        .then(function () { location.reload(); });
    } }));
  }
  function renderSourcesSheet(body) {
    body.appendChild(h('h3', { text: 'Tietosuoja' }));
    [
      'Kaira ei kerää, tallenna eikä lähetä henkilötietoja. Siinä ei ole kirjautumista, evästeitä, analytiikkaa eikä ulkopuolisia skriptejä tai fontteja.',
      'Sijaintisi käsitellään vain tässä laitteessa. Sää- ja sadetietoa haettaessa Ilmatieteen laitokselle, MET Norwaylle ja varalla Open-Meteolle lähetetään noin kilometrin tarkkuuteen pyöristetyt koordinaatit. Tietoja haetaan vain, kun sovellus on auki.',
      'API-avain, merkinnät, saaliit, reitit, tuodut tasot ja offline-kartat ovat vain tämän laitteen selaimessa.'
    ].forEach(function (t) { body.appendChild(h('p', { class: 'small', text: t })); });
    body.appendChild(h('h3', { text: 'Tietolähteet' }));
    [
      'Pohjakartta ja ilmakuva: Maanmittauslaitos, CC BY 4.0. Ilman avainta: © OpenStreetMapin tekijät (ODbL).',
      'Sää, tuuli ja sademäärä: Ilmatieteen laitos, CC BY 4.0; varalla Open-Meteo, CC BY 4.0. Sadetutkaennuste: MET Norway, Nowcast 2.0, CC BY 4.0.',
      'Metsätieto: Luonnonvarakeskus, MVMI (CC BY 4.0). Suojelualueet: Syke / Metsähallitus (CC BY 4.0). Uudet hakkuut: Suomen metsäkeskus (CC BY 4.0).',
      'Vesitilanne: Suomen ympäristökeskus (Syke), Hydrologiarajapinta, CC BY 4.0, ja Ilmatieteen laitos, CC BY 4.0. Jokien uomat: © OpenStreetMapin tekijät, ODbL.',
      'Autiotuvat, laavut ja tulipaikat: © OpenStreetMapin tekijät, ODbL. Tarkista ajantasaiset tiedot ylläpitäjältä (useimmiten Metsähallitus, luontoon.fi).',
      'Perhokuvat: Wikimedia Commons, tekijät ja lisenssit kuvien yhteydessä. Solmujen vaiheet: Orvis, Animated Knots ja Bass Pro; animaatiot ovat omia piirroksia.',
      'Metsätieto on satelliittikuviin perustuva arvio, ja lupa-alueiden rajat on piirretty käsin. Viralliset rajat ovat eräluvat.fi:n kartoissa.'
    ].forEach(function (t) { body.appendChild(h('p', { class: 'small', text: t })); });
  }
  function renderAboutSheet(body) {
    body.appendChild(h('p', null, h('b', { text: 'Kaira ' + K.VERSION })));
    body.appendChild(h('p', { class: 'small', text: 'Offline-toimiva karttasovellus metsästykseen, kalastukseen ja eränkäyntiin.' }));
    body.appendChild(h('div', { class: 'notice' }, '© 2026 gitdaada. Ei kaupalliseen käyttöön ilman tekijän kirjallista lupaa. ',
      h('a', { href: '#', onclick: function (e) { e.preventDefault(); if (K.openTerms) K.openTerms(); }, text: 'Käyttöehdot ja lisenssi' }), '.'));
    body.appendChild(h('p', { class: 'small' }, 'Lähdekoodi: ', h('a', { href: 'https://github.com/gitdaada/kaira', target: '_blank', rel: 'noopener noreferrer', text: 'github.com/gitdaada/kaira' })));
    body.appendChild(h('div', { class: 'btn-row' }, h('button', { class: 'btn', type: 'button', text: 'Tarkista päivitys', onclick: checkForUpdate })));
  }

  // ---------------------------------------------------------------------------
  // Verkon tila, service worker ja päivitykset
  // ---------------------------------------------------------------------------

  function updateNet() { $('netChip').hidden = navigator.onLine; }
  window.addEventListener('online', function () { updateNet(); K.emit('online'); });
  window.addEventListener('offline', updateNet);
  var swReg = null;
  function checkForUpdate() {
    if (!swReg) { location.reload(); return; }
    K.toast('Tarkistetaan päivityksiä…');
    swReg.update().then(function () { setTimeout(function () { location.reload(); }, 800); },
      function () { K.toast('Päivitystä ei voitu tarkistaa. Tarkista verkkoyhteys.'); });
  }
  function registerSW() {
    if (!('serviceWorker' in navigator) || !(location.protocol === 'https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname))) return;
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js', { scope: './' }).then(function (reg) {
      swReg = reg;
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && navigator.onLine) reg.update().catch(function () {});
      });
    }).catch(function (e) { console.warn('SW-rekisteröinti epäonnistui', e); });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (hadController) K.toast('Kaira päivitetty.', { label: 'Lataa uudelleen', fn: function () { location.reload(); } }, 0);
      hadController = true;
    });
  }

  // ---------------------------------------------------------------------------
  // Käynnistys (kutsutaan main.js:stä, kun kaikki osiot ovat rekisteröityneet)
  // ---------------------------------------------------------------------------

  K.start = function () {
    K.setBasemap();
    K.applyDim();
    updateNet();
    K.emit('start');
    var sec = store.get('section', null);
    if (sec && sectionDef(sec)) K.setSection(sec);
    else { firstRun = true; K.setSection('erankaynti'); K.showStart(); }
    if (settings.gpsOn) K.startGps(false);
    if (settings.wakeLock) K.applyWakeLock();
    setInterval(function () { K.emit('minute'); }, 60000);
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') K.emit('visible'); else K.emit('hidden'); });
    registerSW();
    if (!K.hasKey()) setTimeout(function () {
      K.tip('mml-avain', 'Lisää Maanmittauslaitoksen API-avain asetuksista, niin saat maastokartan ja offline-tallennuksen.',
        { label: 'Asetuksiin', fn: K.openSettings }, { repeatDays: 7, cond: function () { return !K.hasKey(); } });
    }, 12000);
  };
})();

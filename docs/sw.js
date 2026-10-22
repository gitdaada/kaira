/* Kairan service worker: pitää sovelluksen, datan ja tallennetut kartat käytettävissä ilman verkkoa. */
'use strict';

var SHELL_CACHE = 'kaira-shell-2026-10-22c';
var TILE_CACHE = 'kaira-tiles-v1';
var DATA_CACHE = 'kaira-data-v1';
var ASSET_CACHE = 'kaira-assets-v1';
var SHELL = [
  './',
  'css/kaira.css',
  'js/rotate.js', 'js/core.js', 'js/jcore.js', 'js/solmut.js',
  'js/kaira.js', 'js/weather.js', 'js/tools.js', 'js/hunt.js', 'js/fish.js', 'js/wild.js', 'js/palo.js', 'js/havainnot.js', 'js/marjat.js', 'js/help.js', 'js/main.js',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'fonts/inter.woff2', 'fonts/montserrat.woff2',
  'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

/** Uudelleenohjattua vastausta ei saa käyttää sivulatauksessa (Cloudflare ohjaa index.html -> /), joten kopioidaan se puhtaaksi. */
function clean(r) {
  if (!r.redirected) return Promise.resolve(r);
  return r.blob().then(function (b) { return new Response(b, { status: r.status, statusText: r.statusText, headers: r.headers }); });
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL_CACHE).then(function (c) {
    return Promise.all(SHELL.map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(function (r) {
        if (!r.ok) throw new Error(u + ' ' + r.status);
        return clean(r);
      }).then(function (r) { return c.put(u, r); });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k.indexOf('kaira-shell-') === 0 && k !== SHELL_CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/** Välimuistiin vain onnistunut saman palvelimen vastaus, joka ei ole HTML-sivu (esim. 404- tai varasivu). */
function cacheable(r) {
  return r.ok && r.type === 'basic' && !/text\/html/i.test(r.headers.get('Content-Type') || '');
}

function isTile(url) { return url.pathname.indexOf('/WGS84_Pseudo-Mercator/') >= 0; }

/** Maanmittauslaitoksen karttatiili: tallennettu ensin, sitten verkko. Avain ilman API-avainta. */
function tileResponse(request, url) {
  var key = url.origin + url.pathname;
  return caches.open(TILE_CACHE).then(function (cache) {
    return cache.match(key).then(function (hit) {
      if (hit) return hit;
      return fetch(url.href, { mode: 'cors', credentials: 'omit' }).then(function (r) {
        if (r.ok) cache.put(key, r.clone());
        return r;
      }).catch(function () {
        return fetch(request).catch(function () { return new Response('', { status: 504, statusText: 'Offline' }); });
      });
    });
  });
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (hit) {
    if (hit) return hit;
    return fetch(request).then(function (r) {
      if (cacheable(r)) { var copy = r.clone(); caches.open(cacheName).then(function (c) { c.put(request, copy); }); }
      return r;
    });
  });
}

function networkFirst(request, cacheName, timeoutMs, fallbackBody) {
  return new Promise(function (resolve) {
    var settled = false;
    function fromCache() {
      return caches.match(request).then(function (hit) {
        return hit || new Response(fallbackBody, { status: 200, headers: { 'Content-Type': 'application/json' } });
      });
    }
    var timer = setTimeout(function () { if (!settled) { settled = true; fromCache().then(resolve); } }, timeoutMs);
    fetch(request, { cache: 'no-cache' }).then(function (r) {
      if (cacheable(r)) { var copy = r.clone(); caches.open(cacheName).then(function (c) { c.put(request, copy); }); }
      if (!settled) { settled = true; clearTimeout(timer); resolve(r); }
    }).catch(function () {
      if (!settled) { settled = true; clearTimeout(timer); fromCache().then(resolve); }
    });
  });
}

/** Heti välimuistista, päivitys taustalla. */
function staleWhileRevalidate(request, cacheName, ignoreSearch) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request, { ignoreSearch: !!ignoreSearch }).then(function (hit) {
      var net = fetch(request, { cache: 'no-cache' }).then(function (r) {
        if (cacheable(r)) cache.put(request, r.clone());
        return r;
      }).catch(function () { return hit || new Response('', { status: 504, statusText: 'Offline' }); });
      return hit || net;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  if (isTile(url)) {
    // Vain kartan kuvatiilet: offline-tallennus (fetch) hakee ja tallentaa tiilet itse.
    if (req.destination !== 'image' || req.cache === 'no-store') return;
    e.respondWith(tileResponse(req, url)); return;
  }
  if (url.origin !== self.location.origin) return;

  var scope = new URL(self.registration.scope);
  var path = url.pathname.slice(scope.pathname.length);

  if (path === 'data/areas.json') { e.respondWith(networkFirst(req, DATA_CACHE, 5000, '{"areas":[]}')); return; }
  if (path === 'data/vesitilanne.json') { e.respondWith(networkFirst(req, ASSET_CACHE, 5000, '{"joet":[],"geometriat":[]}')); return; }
  if (path === 'data/maastopalo.json') { e.respondWith(networkFirst(req, ASSET_CACHE, 5000, '{"varoitukset":[]}')); return; }
  if (path === 'data/jaa.json') { e.respondWith(networkFirst(req, ASSET_CACHE, 5000, '{"asemat":[]}')); return; }
  if (path === 'layers/index.json') { e.respondWith(networkFirst(req, ASSET_CACHE, 5000, '{"tasot":[]}')); return; }
  if (/^data\/kohteet\//.test(path) || /^layers\//.test(path) || /^img\//.test(path) || path === 'data/perhot.json') {
    e.respondWith(staleWhileRevalidate(req, ASSET_CACHE, false)); return;
  }
  if (path.indexOf('data/') === 0) { e.respondWith(cacheFirst(req, DATA_CACHE)); return; }
  if (req.mode === 'navigate') {
    // Vain sovelluksen etusivu tulee välimuistista: heti välimuistista (heikko kenttä ei jumita käynnistystä), päivitys taustalla.
    if (path !== '' && path !== 'index.html') return;
    e.respondWith(caches.open(SHELL_CACHE).then(function (c) {
      return c.match('./').then(function (hit) {
        var net = fetch('./', { cache: 'no-cache', credentials: 'same-origin' }).then(clean).then(function (r) {
          if (r.ok) c.put('./', r.clone());
          return r;
        }).catch(function () { return hit; });
        if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
        return net;
      });
    }));
    return;
  }
  e.respondWith(staleWhileRevalidate(req, SHELL_CACHE, true));
});

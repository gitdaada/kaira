/*
 * Kaira: salamahavainnot ja lumensyvyys kaikissa osioissa.
 * Lähde: Ilmatieteen laitoksen avoin data (CC BY 4.0), haetaan puhelimessa suoraan (sama palvelin kuin sää).
 * Säde 20 km sijainnista (ilman sijaintia kartan keskeltä). Sijainti pyöristetään noin kilometrin tarkkuuteen
 * ennen hakua kuten säässä. Lumensyvyyden asemia on harvassa: jos 20 km sisällä ei ole asemaa, kerrotaan lähin
 * enintään 50 km päästä.
 */
(function () {
  'use strict';

  var K = window.K, JG = window.JG, h = K.h, settings = K.settings, map = K.map;
  var FMI = 'https://opendata.fmi.fi/wfs';
  var RADIUS_KM = 20, SNOW_SEARCH_KM = 50;
  var LIGHT_MIN = 60;                 // salamat viimeisen tunnin ajalta
  var LIGHT_REFRESH = 5 * 60000, SNOW_REFRESH = 60 * 60000, MOVE_KM = 5;
  var S = { light: null, snow: null, lightAt: 0, snowAt: 0, lightPt: null, snowPt: null, busy: {} };
  var layer = L.layerGroup();

  function point() {
    var p = K.wherePoint();
    return { lat: JG.roundCoord(p.lat, 2), lon: JG.roundCoord(p.lon, 2), src: p.src };
  }
  function bbox(p, km) {
    var dlat = km / 110.54, dlon = km / (111.32 * Math.cos(p.lat * Math.PI / 180));
    return [p.lon - dlon, p.lat - dlat, p.lon + dlon, p.lat + dlat].map(function (v) { return v.toFixed(3); }).join(',');
  }
  function iso(ms) { return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function url(q) {
    return FMI + '?' + Object.keys(q).map(function (k) { return k + '=' + encodeURIComponent(q[k]); }).join('&');
  }

  /** FMI:n "simple"-vastaus -> [{lat, lon, t, name, value}]. gml:pos on muodossa "lat lon". */
  function parseSimple(xml) {
    var doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Virheellinen vastaus');
    var out = [], els = doc.getElementsByTagNameNS('*', 'BsWfsElement');
    for (var i = 0; i < els.length && i < 20000; i++) {
      var e = els[i], pos = e.getElementsByTagNameNS('*', 'pos')[0], tm = e.getElementsByTagNameNS('*', 'Time')[0];
      var nm = e.getElementsByTagNameNS('*', 'ParameterName')[0], val = e.getElementsByTagNameNS('*', 'ParameterValue')[0];
      if (!pos || !tm) continue;
      var c = pos.textContent.trim().split(/\s+/).map(Number), t = Date.parse(tm.textContent.trim());
      if (c.length < 2 || !isFinite(c[0]) || !isFinite(c[1]) || !isFinite(t)) continue;
      out.push({ lat: c[0], lon: c[1], t: t, name: nm ? nm.textContent.trim() : '', value: val ? Number(val.textContent.trim()) : NaN });
    }
    return out;
  }
  K.parseFmiSimple = parseSimple; // testejä varten

  function fetchXml(u) {
    return K.fetchWithTimeout(u, 20000).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
  }

  function loadLightning(force) {
    if (!settings.showLightning || S.busy.light) return Promise.resolve();
    var p = point(), now = Date.now();
    if (!force && S.light && now - S.lightAt < LIGHT_REFRESH && S.lightPt && JG.distance(p.lat, p.lon, S.lightPt.lat, S.lightPt.lon) < MOVE_KM * 1000) return Promise.resolve();
    S.busy.light = true;
    var u = url({ service: 'WFS', version: '2.0.0', request: 'getFeature', storedquery_id: 'fmi::observations::lightning::simple',
      bbox: bbox(p, RADIUS_KM), starttime: iso(now - LIGHT_MIN * 60000), endtime: iso(now), parameters: 'peak_current' });
    return fetchXml(u).then(function (xml) {
      var seen = {}, list = [];
      parseSimple(xml).forEach(function (r) {
        var key = r.lat.toFixed(4) + ',' + r.lon.toFixed(4) + ',' + r.t;
        if (seen[key]) return;
        seen[key] = 1;
        var d = JG.distance(p.lat, p.lon, r.lat, r.lon);
        if (d <= RADIUS_KM * 1000) list.push({ lat: r.lat, lon: r.lon, t: r.t, d: d });
      });
      list.sort(function (a, b) { return b.t - a.t; });
      S.light = list.slice(0, 500); S.lightAt = Date.now(); S.lightPt = p;
    }).catch(function () { /* verkkovirhe: säilytetään edellinen */ }).then(function () { S.busy.light = false; render(); });
  }

  function loadSnow(force) {
    if (!settings.showSnow || S.busy.snow) return Promise.resolve();
    var p = point(), now = Date.now();
    if (!force && S.snow && now - S.snowAt < SNOW_REFRESH && S.snowPt && JG.distance(p.lat, p.lon, S.snowPt.lat, S.snowPt.lon) < MOVE_KM * 1000) return Promise.resolve();
    S.busy.snow = true;
    var u = url({ service: 'WFS', version: '2.0.0', request: 'getFeature', storedquery_id: 'fmi::observations::weather::simple',
      bbox: bbox(p, SNOW_SEARCH_KM), starttime: iso(now - 6 * 3600000), endtime: iso(now), parameters: 'snow_aws', timestep: '60' });
    return fetchXml(u).then(function (xml) {
      var by = {};
      parseSimple(xml).forEach(function (r) {
        if (!isFinite(r.value)) return;
        var key = r.lat.toFixed(4) + ',' + r.lon.toFixed(4);
        if (!by[key] || by[key].t < r.t) by[key] = { lat: r.lat, lon: r.lon, t: r.t, cm: Math.max(0, Math.round(r.value)) };
      });
      var list = Object.keys(by).map(function (k) { var s = by[k]; s.d = JG.distance(p.lat, p.lon, s.lat, s.lon); return s; })
        .filter(function (s) { return s.d <= SNOW_SEARCH_KM * 1000; }).sort(function (a, b) { return a.d - b.d; });
      S.snow = list; S.snowAt = Date.now(); S.snowPt = p;
    }).catch(function () { /* säilytetään edellinen */ }).then(function () { S.busy.snow = false; render(); });
  }

  function ageMin(t) { return Math.max(0, Math.round((Date.now() - t) / 60000)); }
  function lightColor(t) { var a = ageMin(t); return a < 15 ? '#E5484D' : (a < 30 ? '#FF7A1A' : '#F2C200'); }
  function recentLightning() { return (S.light || []).filter(function (s) { return Date.now() - s.t < LIGHT_MIN * 60000; }); }
  function snowNear() { return (S.snow || []).filter(function (s) { return s.d <= RADIUS_KM * 1000; }); }

  var BOLT = 'M13 2 4 14h6l-1 8 9-12h-6z';
  function render() {
    layer.clearLayers();
    var any = false;
    recentLightning().forEach(function (s) {
      any = true;
      var box = h('div', { class: 'bolt-pin' }), svg = K.sv('svg', { viewBox: '0 0 24 24', width: 22, height: 22 });
      K.sv('path', { d: BOLT, fill: lightColor(s.t), stroke: '#10160f', 'stroke-width': 1.4, 'stroke-linejoin': 'round' }, svg);
      box.appendChild(svg);
      L.marker([s.lat, s.lon], { keyboard: false, interactive: true, icon: L.divIcon({ className: '', iconSize: [0, 0], html: box }) })
        .on('click', function (e) {
          if (K.measuring) { K.measureAdd(e.latlng); return; }
          if (K.drawing) { K.drawAdd(e.latlng); return; }
          K.tapInfo(L.latLng(s.lat, s.lon), { title: 'Salama', detail: ageMin(s.t) + ' min sitten · ' + K.fmtDist(s.d) + ' sijainnista' });
        }).addTo(layer);
    });
    if (settings.showSnow) snowNear().forEach(function (s) {
      any = true;
      L.marker([s.lat, s.lon], { keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: h('div', { class: 'obs-pin obs-lumi', text: String(s.cm) }) }) })
        .on('click', function (e) {
          if (K.measuring) { K.measureAdd(e.latlng); return; }
          if (K.drawing) { K.drawAdd(e.latlng); return; }
          K.tapInfo(L.latLng(s.lat, s.lon), { title: 'Lumensyvyys ' + s.cm + ' cm', detail: 'Sääasema · mitattu klo ' + K.hm(s.t) + ' · ' + K.fmtDist(s.d) + ' sijainnista' });
        }).addTo(layer);
    });
    if (any && !map.hasLayer(layer)) layer.addTo(map);
    if (!any && map.hasLayer(layer)) map.removeLayer(layer);
    if (K.renderWxCard) K.renderWxCard();
  }

  function snowText() {
    if (!S.snow || !S.snow.length) return null;
    var near = snowNear();
    if (near.length) {
      var vals = near.map(function (s) { return s.cm; }), mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals);
      return 'Lumi ' + (mn === mx ? mn : mn + '–' + mx) + ' cm';
    }
    return 'Lumi ' + S.snow[0].cm + ' cm (' + K.fmtDist(S.snow[0].d) + ')';
  }
  K.on('wxcard', function (card) {
    var l = settings.showLightning ? recentLightning() : [];
    if (l.length) {
      var near = Math.min.apply(null, l.map(function (s) { return s.d; }));
      card.appendChild(h('div', { class: 'wx-line wx-bolt' }, h('i', { class: 'dot', style: { background: lightColor(l[0].t) } }),
        h('span', { text: 'Salamat ' + l.length + ', lähin ' + K.fmtDist(near) })));
    }
    var st = settings.showSnow ? snowText() : null;
    if (st && (S.snow.some(function (s) { return s.cm > 0; }))) card.appendChild(h('div', { class: 'wx-line' }, h('i', { class: 'dot', style: { background: '#e8f4ff' } }), h('span', { text: st })));
  });
  K.on('wxsheet', function (body) {
    body.appendChild(h('h3', { text: 'Salamat (20 km, viimeinen tunti)' }));
    if (!settings.showLightning) body.appendChild(h('p', { class: 'muted small', text: 'Salamahavainnot ovat pois päältä (Tasot).' }));
    else if (!S.light) body.appendChild(h('p', { class: 'muted small', text: 'Ei vielä haettu.' }));
    else {
      var l = recentLightning();
      if (!l.length) body.appendChild(h('p', { class: 'small', text: 'Ei salamoita 20 km säteellä viimeisen tunnin aikana.' }));
      else {
        var near = l.slice().sort(function (a, b) { return a.d - b.d; })[0];
        body.appendChild(h('p', { class: 'small', text: l.length + ' salamaa. Lähin ' + K.fmtDist(near.d) + ' (' + ageMin(near.t) + ' min sitten), uusin ' + ageMin(l[0].t) + ' min sitten.' }));
        body.appendChild(h('div', { class: 'notice notice-warn', text: 'Ukkonen lähellä: poistu vesiltä, avoimilta paikoilta ja tuntureiden lakialueilta. Jos kuulet ukkosen, olet salaman ulottuvilla.' }));
      }
    }
    body.appendChild(h('h3', { text: 'Lumensyvyys' }));
    if (!settings.showSnow) body.appendChild(h('p', { class: 'muted small', text: 'Lumensyvyys on pois päältä (Tasot).' }));
    else if (!S.snow) body.appendChild(h('p', { class: 'muted small', text: 'Ei vielä haettu.' }));
    else if (!S.snow.length) body.appendChild(h('p', { class: 'small', text: 'Ei lumensyvyyttä mittaavaa sääasemaa 50 km säteellä.' }));
    else {
      var near20 = snowNear();
      (near20.length ? near20 : S.snow.slice(0, 1)).slice(0, 6).forEach(function (s) {
        body.appendChild(h('div', { class: 'wx-row' }, h('span', { text: s.cm + ' cm' }), h('span', { class: 'muted', text: K.fmtDist(s.d) + ' · klo ' + K.hm(s.t) })));
      });
      if (!near20.length) body.appendChild(h('p', { class: 'muted small', text: '20 km säteellä ei ole lumensyvyyttä mittaavaa asemaa; yllä lähin asema.' }));
    }
    body.appendChild(h('p', { class: 'muted small', text: 'Ilmatieteen laitos, avoin data (CC BY 4.0). Salamat päivittyvät 5 minuutin välein, lumi tunnin välein.' }));
  });

  K.on('layers', function (body) {
    body.appendChild(h('h3', { text: 'Salamat ja lumi' }));
    body.appendChild(K.toggleRow('Salamahavainnot', 'Viimeinen tunti, 20 km säteellä · Ilmatieteen laitos', settings.showLightning, function (v) {
      settings.showLightning = v; K.saveSettings(); if (v) loadLightning(true); else { S.light = null; render(); }
    }));
    body.appendChild(K.toggleRow('Lumensyvyys', 'Sääasemat 20 km säteellä, muuten lähin enintään 50 km', settings.showSnow, function (v) {
      settings.showSnow = v; K.saveSettings(); if (v) loadSnow(true); else render();
    }));
  });

  function refresh(force) { if (document.visibilityState !== 'visible' || !navigator.onLine) return; loadLightning(force); loadSnow(force); }
  K.on('start', function () { setTimeout(function () { refresh(true); }, 1500); });
  K.on('visible', function () { refresh(false); });
  K.on('online', function () { refresh(false); });
  K.on('minute', function () { refresh(false); render(); });
  K.on('pos', function () { if (S.lightPt) refresh(false); });
  map.on('moveend', function () { if (!(K.pos && Date.now() - K.pos.t < 30 * 60000)) refresh(false); });

  K.obsWx = { S: S, load: function () { return Promise.all([loadLightning(true), loadSnow(true)]); }, parse: parseSimple };
})();

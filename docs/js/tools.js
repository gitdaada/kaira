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
          if (K.drawing) { if (!document.body.classList.contains('drawing-free')) K.drawAdd(e.latlng); return; }
          var p = f.properties || {}, ll = e.latlng;
          if (f.geometry.type === 'Point') ll = L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]);
          // Alueen sisällä napautus näyttää ensin pistekohtaisen tiedon (esim. järven syvyys), jos jokin osio tarjoaa sen.
          if (/Polygon/.test(f.geometry.type) && K.pointInfo(ll)) return;
          K.tapInfo(ll, { title: K.featureTitle(p), detail: [TYPE_NAMES[p.tyyppi] || '', p.kuvaus || p.description || ''].filter(Boolean).join(' · '), targetName: K.featureTitle(p) });
        });
      }
    });
  };
  /** Pistekohtaiset tiedot alueen sisällä: osiot rekisteröivät funktion (ll) => true, jos se näytti kortin. */
  var pointHooks = [];
  K.onPointInfo = function (fn) { pointHooks.push(fn); };
  K.pointInfo = function (ll) {
    for (var i = 0; i < pointHooks.length; i++) { try { if (pointHooks[i](ll)) return true; } catch (e) { console.error(e); } }
    return false;
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
  // Alueen piirto: kulmapisteet napauttamalla tai sormella vetämällä.
  // Alue tallentuu omaksi tasoksi tähän laitteeseen. Metsästys- ja kalastusalueen voi lähettää
  // analysoitavaksi: GitHub avautuu valmiiksi täytettynä, ja repon omistaja tallentaa tiedoston.
  // ---------------------------------------------------------------------------

  var REPO_NEW = 'https://github.com/gitdaada/kaira/new/main/areas/';
  var MAX_VERTS = 2000, LINK_VERTS = 200, LINK_MAX = 7000, MAX_HUNT_M2 = 3000e6; // 3 000 km² ≈ 300 000 ha
  K.drawing = false;
  var dpts = [], free = false, stroke = null, drawLayer = L.layerGroup().addTo(map);

  /** Monikulmion pinta-ala neliömetreinä (tasoprojektio pienelle alueelle). */
  function areaM2(ll) {
    if (ll.length < 3) return 0;
    var lat0 = ll[0].lat * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540, s = 0;
    for (var i = 0; i < ll.length; i++) {
      var a = ll[i], b = ll[(i + 1) % ll.length];
      s += a.lng * kx * b.lat * ky - b.lng * kx * a.lat * ky;
    }
    return Math.abs(s / 2);
  }
  function fmtArea(m2) { return m2 >= 1e6 ? K.fmt1(m2 / 1e6) + ' km²' : K.fmtInt(m2 / 1e4) + ' ha'; }
  K.areaM2 = areaM2;

  function redrawDraw() {
    drawLayer.clearLayers();
    var all = stroke ? dpts.concat(stroke) : dpts;
    if (all.length > 2) L.polygon(all, { pane: 'targetPane', color: '#FF6B35', weight: 3, fillColor: '#FF6B35', fillOpacity: 0.12, interactive: false }).addTo(drawLayer);
    else if (all.length > 1) L.polyline(all, { pane: 'targetPane', color: '#FF6B35', weight: 3, interactive: false }).addTo(drawLayer);
    // Pisteet näytetään napautustilassa; sormella piirtäessä niitä on liikaa.
    if (!free || all.length < 40) all.forEach(function (p) {
      L.circleMarker(p, { pane: 'targetPane', radius: 5, color: '#10160f', weight: 2, fillColor: '#FF6B35', fillOpacity: 1, interactive: false }).addTo(drawLayer);
    });
    var t = $('drawText');
    if (!all.length) t.textContent = free ? 'Vedä sormella alueen reuna. Karttaa voi siirtää, kun Sormi-tila on pois.' : 'Napauta alueen kulmapisteet kartalle.';
    else if (all.length < 3) t.textContent = all.length + ' pistettä. Lisää vähintään kolme.';
    else t.textContent = all.length + ' pistettä · ' + fmtArea(areaM2(all)) + '. Paina Valmis, kun alue on piirretty.';
    $('drawDone').disabled = dpts.length < 3;
  }
  function drawAdd(ll) {
    if (dpts.length >= MAX_VERTS) { K.toast('Pisteitä on jo ' + MAX_VERTS + '.'); return; }
    dpts.push(L.latLng(ll.lat, ll.lng)); redrawDraw();
  }
  function setFree(on) {
    free = on; stroke = null;
    $('drawMode').setAttribute('aria-pressed', on ? 'true' : 'false');
    document.body.classList.toggle('drawing-free', on);
    if (on) map.dragging.disable(); else map.dragging.enable();
    redrawDraw();
  }
  function setDrawing(on) {
    if (on && K.measuring) setMeasuring(false);
    K.drawing = on;
    $('drawBar').hidden = !on;
    if (on) { K.closeSheet(); K.closeCard(); dpts = []; }
    else { dpts = []; setFree(false); }
    redrawDraw();
    K.liftFabs();
  }
  K.setDrawing = setDrawing;
  K.drawAdd = drawAdd;
  var _setMeasuring = setMeasuring;
  setMeasuring = function (on) { if (on && K.drawing) setDrawing(false); _setMeasuring(on); };
  K.setMeasuring = setMeasuring;
  K.onMapClick(function (ll) {
    if (!K.drawing) return false;
    if (!free) drawAdd(ll);
    return true; // sormitilassa napautus ei avaa tietokorttia
  }, 101);

  // Sormella piirto: yksi sormi piirtää, toinen sormi peruu vedon (nipistys ja kääntö toimivat silti).
  var mapEl = map.getContainer(), lastXY = null;
  function eventLatLng(e) {
    // Käännettävän kartan säiliö on näyttöä suurempi: kääntömoduuli muuntaa näytön koordinaatit itse.
    if (K.rot) return K.rot.screenToLatLng([e.clientX, e.clientY]);
    var r = mapEl.getBoundingClientRect();
    return map.containerPointToLatLng([e.clientX - r.left, e.clientY - r.top]);
  }
  mapEl.addEventListener('pointerdown', function (e) {
    if (!K.drawing || !free) return;
    if (!e.isPrimary) { stroke = null; lastXY = null; redrawDraw(); return; }
    stroke = [eventLatLng(e)]; lastXY = [e.clientX, e.clientY];
  }, true);
  mapEl.addEventListener('pointermove', function (e) {
    if (!stroke || !e.isPrimary || !lastXY) return;
    var dx = e.clientX - lastXY[0], dy = e.clientY - lastXY[1];
    if (dx * dx + dy * dy < 64) return; // vähintään 8 px edellisestä pisteestä
    lastXY = [e.clientX, e.clientY];
    if (dpts.length + stroke.length < MAX_VERTS) stroke.push(eventLatLng(e));
    redrawDraw();
  }, true);
  function endStroke(e) {
    if (!stroke || (e && !e.isPrimary)) return;
    if (stroke.length > 1) dpts = dpts.concat(stroke);
    stroke = null; lastXY = null; redrawDraw();
  }
  mapEl.addEventListener('pointerup', endStroke, true);
  mapEl.addEventListener('pointercancel', function () { stroke = null; lastXY = null; redrawDraw(); }, true);

  $('drawMode').addEventListener('click', function () { setFree(!free); });
  $('drawUndo').addEventListener('click', function () {
    // Sormitilassa peruu viimeisen vedon kerralla (vähintään 1 piste).
    var n = free && dpts.length > 20 ? Math.max(1, Math.round(dpts.length / 8)) : 1;
    dpts.splice(Math.max(0, dpts.length - n), n); redrawDraw();
  });
  $('drawClear').addEventListener('click', function () { dpts = []; redrawDraw(); });
  $('drawCancel').addEventListener('click', function () { setDrawing(false); });
  $('drawDone').addEventListener('click', function () {
    if (dpts.length < 3) return;
    var ring = dpts.map(function (p) { return [p.lat, p.lng]; });
    setDrawing(false);
    openDrawnSheet(ring);
  });

  /** Douglas–Peucker metreinä renkaalle [[lat, lon], ...] (ei sulkevaa pistettä). */
  function simplifyRing(ring, tolM) {
    if (ring.length < 5 || !K.simplifyLine) return ring.slice();
    var far = 0, best = -1;
    ring.forEach(function (p, i) { var d = JG.distance(ring[0][0], ring[0][1], p[0], p[1]); if (d > best) { best = d; far = i; } });
    var a = K.simplifyLine(ring.slice(0, far + 1), tolM), b = K.simplifyLine(ring.slice(far).concat([ring[0]]), tolM);
    return a.slice(0, -1).concat(b.slice(0, -1));
  }
  function ringToGeoJSON(ring, name) {
    var c = ring.map(function (p) { return [JG.roundCoord(p[1]), JG.roundCoord(p[0])]; });
    c.push(c[0].slice());
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { nimi: name, tyyppi: 'alue' }, geometry: { type: 'Polygon', coordinates: [c] } }] };
  }
  function slugName(name) {
    var s = String(name || '').toLowerCase().replace(/[ä]/g, 'a').replace(/[öø]/g, 'o').replace(/[å]/g, 'a')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
    return s || 'alue';
  }
  /** Analyysilinkki: GitHubin uusi tiedosto valmiiksi täytettynä. Palauttaa null, jos alue on liian monimutkainen. */
  function analysisLink(ring, name, dir) {
    var r = ring, tol = 5;
    while (r.length > LINK_VERTS && tol < 2000) { r = simplifyRing(ring, tol); tol *= 2; }
    var txt = JSON.stringify(ringToGeoJSON(r, name));
    var url = REPO_NEW + dir + '?filename=' + encodeURIComponent(slugName(name) + '.geojson') + '&value=' + encodeURIComponent(txt);
    return url.length <= LINK_MAX ? url : null;
  }

  function openDrawnSheet(ring) {
    var sec = K.section, saved = null;
    var name = h('input', { class: 'input', type: 'text', maxlength: '60', placeholder: 'Alueen nimi', 'aria-label': 'Alueen nimi' });
    K.openSheet('draw-save', 'Piirretty alue', function (body) {
      var ll = ring.map(function (p) { return L.latLng(p[0], p[1]); });
      body.appendChild(h('p', { class: 'muted small', text: ring.length + ' pistettä · ' + fmtArea(areaM2(ll)) }));
      body.appendChild(h('div', { class: 'field' }, h('span', { class: 'label', text: 'Nimi' }), name));
      if (!saved) {
        body.appendChild(h('div', { class: 'btn-row' },
          h('button', { type: 'button', class: 'btn btn-primary', text: 'Tallenna tasoksi', onclick: function () {
            var nm = (name.value || '').trim().slice(0, 60) || 'Piirretty alue';
            saved = saveDrawn(nm, ring);
            if (saved) K.renderSheet();
          } }),
          h('button', { type: 'button', class: 'btn', text: 'Hylkää', onclick: function () { K.closeSheet(); } })));
        body.appendChild(h('p', { class: 'muted small', text: 'Taso tallentuu vain tähän laitteeseen ja näkyy kaikissa osioissa (Tasot > Omat tasot).' }));
        return;
      }
      body.appendChild(h('div', { class: 'notice', text: 'Tallennettu: ' + saved.name + '.' }));
      var b = K.gjBounds(saved.gj);
      body.appendChild(h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn', text: 'Tallenna offline', onclick: function () { openOfflineFor({ id: saved.id, name: saved.name, kind: 'taso', bounds: b }); } }),
        h('button', { type: 'button', class: 'btn', text: 'Lataa GeoJSON', onclick: function () {
          K.download(JSON.stringify(saved.gj), slugName(saved.name) + '.geojson', 'application/geo+json');
        } })));
      var dir = sec === 'metsastys' ? 'metsastys' : sec === 'kalastus' ? 'kalastus' : null;
      if (!dir) return;
      body.appendChild(h('h3', { text: dir === 'metsastys' ? 'Metsäanalyysi' : 'Vesistöanalyysi' }));
      body.appendChild(h('p', { class: 'small', text: dir === 'metsastys'
        ? 'Analyysi tuottaa alueelle metsän iän, suojelualueet, hakkuut ja kanalintujen elinympäristöt. Ne näkyvät Lupa-alue-listassa, kun ajo on valmis (yleensä alle tunnissa).'
        : 'Analyysi hakee alueen joet ja purot, niiden vesitilanteen, jäänpaksuusmittaukset ja mitattujen järvien syvyysalueet. Ne näkyvät Tasot-paneelissa, kun ajo on valmis.' }));
      body.appendChild(h('div', { class: 'notice notice-warn', text: 'Lähetetty alue tallentuu julkiseen GitHub-repoon. Älä lähetä aluetta, joka paljastaa esimerkiksi kotisi tai mökkisi. Saalis- ja havaintotiedot eivät lähde laitteesta.' }));
      // Metsäanalyysin kuvat kasvavat alueen mukana; Cloudflaren ilmaistaso sallii enintään 25 MiB tiedoston.
      var tooBig = dir === 'metsastys' && areaM2(ring.map(function (p) { return L.latLng(p[0], p[1]); })) > MAX_HUNT_M2;
      var url = tooBig ? null : analysisLink(ring, saved.name, dir);
      if (tooBig) {
        body.appendChild(h('p', { class: 'small warn-text', text: 'Alue on liian suuri metsäanalyysiin (yli ' + K.fmtInt(MAX_HUNT_M2 / 1e6) + ' km²). Piirrä pienempi alue tai jaa se osiin.' }));
      } else if (url) {
        body.appendChild(h('button', { type: 'button', class: 'btn btn-primary btn-block', text: 'Lähetä analysoitavaksi (GitHub)', onclick: function () {
          window.open(url, '_blank', 'noopener');
        } }));
        body.appendChild(h('p', { class: 'muted small', text: 'GitHub avautuu valmiiksi täytettynä. Paina siellä "Commit changes". Vain repon omistaja voi tallentaa suoraan; muilla GitHub tekee muutosehdotuksen.' }));
      } else {
        body.appendChild(h('p', { class: 'small', text: 'Alue on liian monimutkainen linkkiin. Lataa GeoJSON ja lisää se GitHubissa kansioon areas/' + dir + '.' }));
      }
    });
    setTimeout(function () { try { name.focus(); } catch (e) { /* ei fokusta */ } }, 50);
  }
  function saveDrawn(nm, ring) {
    var gj = JG.cleanGeoJSON(ringToGeoJSON(ring, nm));
    var id = 'piirretty-' + Date.now().toString(36);
    var list = store.get('imported', []) || [];
    list.push({ id: id, nimi: nm, gj: gj });
    if (!store.set('imported', list)) { K.toast('Tallennustila on täynnä.'); return null; }
    addOwn(id, nm, gj);
    return { id: id, name: nm, gj: gj };
  }

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
      try { if (x && /^(tuotu|piirretty)-[a-z0-9]+$/.test(x.id)) addOwn(x.id, String(x.nimi || 'Tuotu taso').slice(0, 60), JG.cleanGeoJSON(x.gj)); } catch (e) { /* ohitetaan viallinen */ }
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
    if (!ids.length) body.appendChild(h('p', { class: 'muted small', text: 'Ei omia tasoja. Piirrä alue Työkalut-valikosta tai tuo geojson.io:ssa piirretty taso. Oma taso näkyy kaikissa osioissa.' }));
    ids.forEach(function (id) {
      var e = own[id], b = K.gjBounds(e.gj);
      body.appendChild(K.toggleRow(e.name, (/^piirretty-/.test(id) ? 'Piirretty' : 'Tuotu') + ' taso, vain tässä laitteessa', !settings.hidden[id], function (v) {
        if (v) { delete settings.hidden[id]; e.layer.addTo(map); } else { settings.hidden[id] = true; map.removeLayer(e.layer); }
        K.saveSettings();
      }));
      body.appendChild(h('div', { class: 'btn-row btn-row-sub' },
        b ? h('button', { type: 'button', class: 'btn btn-sm', text: 'Näytä', onclick: function () { K.closeSheet(); K.fitBounds(b); } }) : null,
        b ? h('button', { type: 'button', class: 'btn btn-sm', text: K.offline.get(id) ? 'Offline ✓' : 'Offline', onclick: function () { openOfflineFor({ id: id, name: e.name, kind: 'taso', bounds: b }); } }) : null,
        h('button', { type: 'button', class: 'btn btn-sm btn-danger', text: 'Poista', onclick: function () {
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
    list.appendChild(K.menuItem('draw', 'Piirrä alue', K.section === 'erankaynti' ? 'Napauta tai vedä sormella, tallenna omaksi tasoksi' : 'Omaksi tasoksi tai analysoitavaksi', function () { setDrawing(true); }));
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

/*
 * Kaira: sää kaikissa osioissa. Tuntiennuste (Ilmatieteen laitos, varalla Open-Meteo) haetaan aina
 * sijaintiin (ilman GPS:ää kartan keskeltä) ja tallennetaan laitteeseen offline-käyttöä varten.
 * Animoitu sadetutkaennuste 0–2 h (MET Norway) sekä auringon nousu ja lasku.
 * Säärajapinnoille lähetetään vain noin kilometrin tarkkuuteen pyöristetyt koordinaatit.
 */
(function () {
  'use strict';

  var K = window.K, MK = window.MK, JG = window.JG, h = K.h, $ = K.$, settings = K.settings, map = K.map, store = K.store;

  // ---------------------------------------------------------------------------
  // Tuntiennuste
  // ---------------------------------------------------------------------------

  var FMI_WFS = 'https://opendata.fmi.fi/wfs';
  var OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
  var WX_MAX_AGE = 60 * 60 * 1000, WX_MOVE_M = 5000, WX_MIN_GAP = 2 * 60 * 1000;

  function validWx(w) {
    return w && Array.isArray(w.series) && isFinite(w.lat) && isFinite(w.lon) && isFinite(w.fetched) ? w : null;
  }
  var W = K.wx = { data: validWx(store.get('wx', null)), loading: false, lastTry: 0 };

  function wxPoint() {
    var p = K.wherePoint();
    return { lat: JG.roundCoord(p.lat, 2), lon: JG.roundCoord(p.lon, 2), src: p.src };
  }
  function isoHour(ms) { var d = new Date(ms); d.setUTCMinutes(0, 0, 0); return d.toISOString().replace('.000Z', 'Z'); }

  function fetchFmi(lat, lon, params) {
    var now = Date.now();
    var q = 'service=WFS&version=2.0.0&request=getFeature' +
      '&storedquery_id=fmi::forecast::edited::weather::scandinavia::point::simple' +
      '&latlon=' + lat + ',' + lon + '&parameters=' + params + '&timestep=60' +
      '&starttime=' + isoHour(now - 3600000) + '&endtime=' + isoHour(now + 60 * 3600000);
    return K.fetchWithTimeout(FMI_WFS + '?' + q, 15000).then(function (r) { return r.text(); }).then(function (txt) {
      var s = MK.parseFmiWind(txt);
      if (!s.length) throw new Error('FMI: ei säätietoa');
      return s;
    });
  }
  function fetchOpenMeteo(lat, lon) {
    var q = 'latitude=' + lat + '&longitude=' + lon +
      '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,relative_humidity_2m,precipitation' +
      '&wind_speed_unit=ms&timezone=GMT&past_hours=1&forecast_hours=60';
    return K.fetchWithTimeout(OPEN_METEO + '?' + q, 15000).then(function (r) {
      if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      var s = MK.parseOpenMeteoWind(j);
      if (!s.length) throw new Error('Open-Meteo: ei säätietoa');
      return s;
    });
  }

  /** Hakee tuntiennusteen (n. 60 h) sijaintiin. Ei hae, jos tallennettu ennuste on tuore ja lähellä. */
  W.refresh = function (force) {
    if (W.loading || !navigator.onLine || document.visibilityState === 'hidden') return Promise.resolve(false);
    var pt = wxPoint(), d = W.data;
    if (!force && Date.now() - W.lastTry < WX_MIN_GAP) return Promise.resolve(false);
    if (!force && d) {
      var age = Date.now() - d.fetched, far = JG.distance(pt.lat, pt.lon, d.lat, d.lon) > WX_MOVE_M;
      var gpsNow = pt.src === 'gps' && d.src !== 'gps' && JG.distance(pt.lat, pt.lon, d.lat, d.lon) > 1500;
      if (age < WX_MAX_AGE && !far && !gpsNow) return Promise.resolve(false);
    }
    W.loading = true; W.lastTry = Date.now();
    renderCard();
    var src = 'fmi';
    return fetchFmi(pt.lat, pt.lon, 'WindDirection,WindSpeedMS,WindGust,Temperature,Humidity,Precipitation1h')
      .catch(function (e) { if (/^FMI:/.test(e.message)) return fetchFmi(pt.lat, pt.lon, 'WindDirection,WindSpeedMS,WindGust,Temperature'); throw e; })
      .catch(function (e) {
        console.warn('FMI ei käytettävissä, käytetään Open-Meteota:', e && e.message);
        src = 'open-meteo';
        return fetchOpenMeteo(pt.lat, pt.lon);
      })
      .then(function (series) {
        W.data = { lat: pt.lat, lon: pt.lon, src: pt.src, fetched: Date.now(), source: src, series: series };
        store.set('wx', W.data);
        return true;
      })
      .catch(function (e) {
        console.warn('Sääennusteen haku epäonnistui:', e && e.message);
        if (force) K.toast('Sääennustetta ei saatu.');
        return false;
      })
      .then(function (ok) { W.loading = false; K.emit('wx'); renderCard(); if (K.sheetName() === 'weather') K.renderSheet(); return ok; });
  };
  /** Ennustetunti hetkelle t (enintään 90 min päässä) tai null. */
  W.at = function (t) { return W.data ? MK.pickWind(W.data.series, t) : null; };
  W.current = function () { return W.at(Date.now()); };
  W.sourceName = function () { return W.data && W.data.source === 'open-meteo' ? 'Open-Meteo' : 'Ilmatieteen laitos'; };

  // ---------------------------------------------------------------------------
  // Aurinko
  // ---------------------------------------------------------------------------

  function sunPoint() { var p = K.wherePoint(); return p; }
  function sunText(now) {
    var p = sunPoint(), st = MK.sunStatus(now, p.lat, p.lon);
    if (st.polar === 'day') return { txt: 'Aurinko ei laske', icon: 'sun' };
    if (st.polar === 'night') return { txt: 'Aurinko ei nouse', icon: 'moon' };
    if (st.kind === 'rise') return { txt: 'Nousee ' + K.hm(st.at), icon: 'moon' };
    if (st.kind === 'set') return { txt: 'Laskee ' + K.hm(st.at) + ' · ' + K.fmtDur(st.at - now), icon: 'sun' };
    return { txt: 'Hämärä ' + K.hm(st.at) + ' asti', icon: 'moon' };
  }
  function renderSun(body) {
    var p = sunPoint(), now = Date.now(), st = MK.sunStatus(now, p.lat, p.lon), T = st.today, N = st.tomorrow;
    function row(label, val) { return h('div', { class: 'kv' }, h('span', { text: label }), h('b', { text: val })); }
    if (T.polar) body.appendChild(h('p', { text: T.polar === 'day' ? 'Aurinko ei laske tänään.' : 'Aurinko ei nouse tänään (kaamos).' }));
    else {
      body.appendChild(row('Auringonnousu', K.hm(T.rise) + (now < T.rise ? ' (' + K.fmtDur(T.rise - now) + ')' : '')));
      body.appendChild(row('Auringonlasku', K.hm(T.set) + (now < T.set ? ' (' + K.fmtDur(T.set - now) + ')' : ' (laskenut)')));
      if (now >= T.rise && now < T.set) body.appendChild(row('Valoisaa jäljellä', K.fmtDur(T.set - now)));
      if (T.dawn) body.appendChild(row('Hämärä alkaa aamulla', K.hm(T.dawn)));
      if (T.dusk) body.appendChild(row('Hämärä päättyy illalla', K.hm(T.dusk)));
      if (N.rise) body.appendChild(row('Huomenna', 'nousu ' + K.hm(N.rise) + ', lasku ' + K.hm(N.set)));
    }
    body.appendChild(h('p', { class: 'muted small', text: 'Laskettu ' + (p.src === 'gps' ? 'sijaintisi' : 'kartan keskikohdan') +
      ' mukaan puhelimessa, toimii ilman verkkoa. Hämärä = aurinko alle 6° horisontin alla.' }));
  }

  // ---------------------------------------------------------------------------
  // Sadetutka: MET Norwayn nowcast 0–2 h, 5 x 5 pisteen ruudukko ±7,5 km, animoituna kartalla
  // ---------------------------------------------------------------------------

  var MET_NOWCAST = 'https://api.met.no/weatherapi/nowcast/2.0/complete';
  var RAIN_HALF_KM = 7.5, RAIN_N = 5, RAIN_IMG = 72;
  // MET Norwayn ehdot: mobiilisovellus päivittää enintään 10 minuutin välein.
  var RAIN_MAX_AGE = 10 * 60 * 1000, RAIN_MOVE_KM = 2.5, RAIN_MIN_GAP = 2 * 60 * 1000;
  var R = K.rain = { data: null, loading: false, idx: 0, play: 0, pinned: false, open: false, closed: false, layer: null };
  var rainCanvas = document.createElement('canvas');
  rainCanvas.width = rainCanvas.height = RAIN_IMG;

  function canFetchRain() { return settings.showRain && navigator.onLine && document.visibilityState === 'visible'; }

  R.refresh = function (force) {
    if (!canFetchRain() || R.loading) return Promise.resolve(false);
    var c = K.wherePoint(10 * 60000);
    var grid = MK.rainGrid(c.lat, c.lon, RAIN_HALF_KM, RAIN_N);
    // Vähintään 2 min hakujen välillä (myös epäonnistuneiden), ettei rajapintaa kuormiteta.
    if (Date.now() - (R.lastTry || 0) < RAIN_MIN_GAP) return Promise.resolve(false);
    if (R.data && !force) {
      var age = Date.now() - R.data.fetched;
      var moved = map.distance(grid.center, R.data.grid.center) > RAIN_MOVE_KM * 1000;
      var gpsNow = c.src === 'gps' && !R.data.gps;
      if (!(age > RAIN_MAX_AGE || gpsNow || moved)) return Promise.resolve(false);
    }
    R.lastTry = Date.now();
    R.loading = true;
    updateRainUi();
    var results = new Array(grid.points.length), next = 0, failed = 0, covBad = 0;
    function one(k) {
      var p = grid.points[k];
      return K.fetchWithTimeout(MET_NOWCAST + '?lat=' + p.lat + '&lon=' + p.lon, 15000, 'default').then(function (r) {
        if (!r.ok) throw new Error('MET HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        var res = MK.parseNowcast(j);
        if (res.coverage !== 'ok') covBad++;
        results[k] = res;
      }).catch(function (e) { failed++; console.warn('Sadetutkan haku epäonnistui:', e && e.message); });
    }
    // Kolme hakua kerrallaan ja pieni tauko: MET Norwayn kokonaisraja on 20 hakua sekunnissa.
    function worker() {
      if (next >= grid.points.length) return Promise.resolve();
      var k = next++;
      return one(k).then(function () { return K.wait(150); }).then(worker);
    }
    return Promise.all([worker(), worker(), worker()]).then(function () {
      R.loading = false;
      if (failed === grid.points.length) { updateRainUi(); if (force) K.toast('Sadetutkaa ei saatu.'); return false; }
      var fr = MK.rainFrames(results, RAIN_N), mid = Math.floor(grid.points.length / 2);
      var had = !!(R.data && R.data.anyRain);
      R.data = { grid: grid, gps: c.src === 'gps', fetched: Date.now(), times: fr.times, frames: fr.frames,
        center: results[mid] ? results[mid].series : [], coverageBad: covBad, failed: failed };
      buildRainImages();
      if (R.data.anyRain && !had) R.closed = false; // uusi sadealue: palkki näkyviin uudelleen
      R.pinned = false;
      R.idx = currentRainIdx();
      updateRainUi();
      renderCard();
      return true;
    });
  };

  function buildRainImages() {
    var r = R.data, ctx = rainCanvas.getContext('2d'), img = ctx.createImageData(RAIN_IMG, RAIN_IMG);
    r.urls = []; r.has = []; r.anyRain = false;
    r.frames.forEach(function (f) {
      var out = MK.renderRain(f, RAIN_N, RAIN_IMG, img.data);
      ctx.putImageData(img, 0, 0);
      r.urls.push(rainCanvas.toDataURL('image/png'));
      r.has.push(out.any);
      if (out.any) r.anyRain = true;
    });
  }
  function currentRainIdx() {
    var r = R.data, now = Date.now();
    if (!r || !r.times.length) return 0;
    for (var k = 0; k < r.times.length; k++) if (r.times[k] >= now - 150000) return k;
    return -1;
  }
  function rainExpired() { var r = R.data; return !r || !r.times.length || r.times[r.times.length - 1] < Date.now() - 5 * 60000; }
  R.expired = rainExpired;
  /** Sadetutkapalkki ja -kerros näkyvät, kun käyttäjä avasi ne tai lähellä on sadetta (ellei käyttäjä sulkenut). */
  function barVisible() {
    if (!settings.showRain) return false;
    return R.open || (!R.closed && R.data && !rainExpired() && R.data.anyRain);
  }
  function drawRain() {
    var r = R.data, k = R.idx;
    var show = barVisible() && r && r.urls && !rainExpired() && k >= 0 && k < r.urls.length && r.anyRain;
    if (!show) { if (R.layer) { map.removeLayer(R.layer); R.layer = null; } }
    else if (!R.layer) R.layer = L.imageOverlay(r.urls[k], r.grid.bounds, { pane: 'rainPane', interactive: false, className: 'rain-img' }).addTo(map);
    else { R.layer.setBounds(L.latLngBounds(r.grid.bounds)); R.layer.setUrl(r.urls[k]); }
    K.emit('rainlayer', !!R.layer && !!(R.data && R.data.anyRain));
  }
  /** Lyhyt sadetila sääkorttiin ja paneeliin. */
  R.summary = function (short) {
    var r = R.data;
    if (!settings.showRain) return null;
    if (!r || rainExpired()) return R.loading ? 'Haetaan sadetutkaa…' : (navigator.onLine ? null : 'Sadetutka vaatii verkon');
    if (!r.anyRain) return short ? 'Ei sadetta 2 h' : 'Ei sadetta 7,5 km säteellä seuraavan 2 h aikana.';
    var sm = MK.rainSummary(r.center, Date.now()), who = r.gps ? 'Kohdallasi' : 'Kartan keskellä';
    if (!sm) return short ? 'Sadetta lähellä' : 'Sadetta lähistöllä.';
    if (sm.state === 'raining') return short ? 'Sataa nyt' : who + ' sataa nyt' + (sm.until ? ', taukoa n. klo ' + K.hm(sm.until) : '') + '.';
    if (sm.state === 'coming') return short ? 'Sade klo ' + K.hm(sm.at) : who + ' sade alkaa n. klo ' + K.hm(sm.at) + '.';
    return short ? 'Sadetta lähellä' : who + ' ei sada, lähistöllä sadetta.';
  };

  function updateRainUi() {
    var bar = $('rainBar'), slider = $('rainSlider'), play = $('rainPlay'), timeEl = $('rainTime'), here = $('rainHere');
    try {
      if (!barVisible()) { bar.hidden = true; stopRainPlay(); drawRain(); return; }
      bar.hidden = false;
      var r = R.data;
      if (!r || rainExpired()) {
        slider.disabled = true; play.disabled = true; slider.max = '0'; slider.value = '0';
        timeEl.textContent = 'Sadetutka';
        here.textContent = R.loading ? 'Haetaan sadetutkaa…' : (!navigator.onLine ? 'Sadetutka vaatii verkkoyhteyden.' : 'Ei vielä sadetietoa.');
        drawRain();
        return;
      }
      if (!R.pinned && !R.play) R.idx = Math.max(0, currentRainIdx());
      R.idx = Math.max(0, Math.min(R.idx, r.times.length - 1));
      slider.max = String(r.times.length - 1);
      slider.value = String(R.idx);
      slider.disabled = !r.anyRain;
      play.disabled = !r.anyRain;
      var t = r.times[R.idx], mins = Math.round((t - Date.now()) / 60000);
      timeEl.textContent = (mins <= 2 ? 'Nyt' : '+' + mins + ' min') + ' · klo ' + K.hm(t);
      here.textContent = R.summary(false) + (r.coverageBad ? ' Tutkakattavuus osin heikko.' : '') + (R.loading ? ' Päivitetään…' : ' Päivitetty klo ' + K.hm(r.fetched) + '.');
      drawRain();
    } finally { K.liftFabs(); }
  }
  R.updateUi = updateRainUi;
  function setPlayIcon(playing) {
    var b = $('rainPlay');
    b.textContent = '';
    var s = K.sv('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, b);
    K.sv('path', { d: playing ? 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z' : 'M8 5l11 7-11 7z', fill: 'currentColor' }, s);
    b.setAttribute('aria-label', playing ? 'Pysäytä' : 'Toista sadetutka');
  }
  function startRainPlay() {
    if (R.play || !R.data || !R.data.times.length) return;
    R.pinned = true;
    R.play = setInterval(function () {
      if (!R.data || rainExpired()) { stopRainPlay(); return; }
      R.idx = (R.idx + 1) % R.data.times.length;
      updateRainUi();
    }, 450);
    setPlayIcon(true);
  }
  function stopRainPlay() { if (R.play) clearInterval(R.play); R.play = 0; setPlayIcon(false); }
  /** Avaa sadetutkapalkin (sääkortista tai -paneelista). */
  R.openBar = function () {
    if (!settings.showRain) { settings.showRain = true; K.saveSettings(); }
    R.open = true; R.closed = false;
    updateRainUi();
    R.refresh();
    if (R.data && R.data.anyRain) startRainPlay();
  };
  $('rainSlider').addEventListener('input', function () { stopRainPlay(); R.pinned = true; R.idx = Number($('rainSlider').value); updateRainUi(); });
  $('rainPlay').addEventListener('click', function () { if (R.play) stopRainPlay(); else startRainPlay(); });
  $('rainNow').addEventListener('click', function () { stopRainPlay(); R.pinned = false; updateRainUi(); });
  $('rainHide').addEventListener('click', function () { stopRainPlay(); R.open = false; R.closed = true; updateRainUi(); });

  // ---------------------------------------------------------------------------
  // Sääkortti (vasen yläkulma)
  // ---------------------------------------------------------------------------

  function windArrow(dirFrom) {
    var span = K.icon('arrow');
    var svg = span.querySelector('svg');
    if (svg) svg.style.transform = 'rotate(' + Math.round(MK.norm360(dirFrom + 180 + K.bearing())) + 'deg)';
    return span;
  }
  function renderCard() {
    var card = $('wxCard'), e = W.current();
    card.textContent = '';
    if (e) {
      var main = h('div', { class: 'wx-main' },
        h('span', { class: 'wx-temp', text: e.temp !== null && e.temp !== undefined ? Math.round(e.temp) + '°' : '–' }),
        e.dir !== null ? h('span', { class: 'wx-wind' }, windArrow(e.dir), h('span', { text: e.spd !== null ? Math.round(e.spd) + ' m/s' : '' })) : null);
      card.appendChild(main);
      card.setAttribute('aria-label', 'Sää: ' + (e.temp !== null ? K.fmt1(e.temp) + ' astetta, ' : '') + 'tuuli ' + MK.windFromName(e.dir) + (e.spd !== null ? ' ' + K.fmt1(e.spd) + ' m/s' : '') + '. Avaa ennuste.');
    } else {
      card.appendChild(h('div', { class: 'wx-main' }, h('span', { class: 'wx-temp', text: '–' })));
      card.appendChild(h('div', { class: 'wx-empty', text: W.loading ? 'Haetaan säätä…' : (navigator.onLine ? 'Ei säätietoa' : 'Sää vaatii verkon') }));
      card.setAttribute('aria-label', 'Sää: ei tietoa. Avaa ennuste.');
    }
    var rs = R.summary(true);
    if (rs) card.appendChild(h('div', { class: 'wx-line' + (R.data && R.data.anyRain && !rainExpired() ? ' wx-rain' : '') }, K.icon('drop'), h('span', { text: rs })));
    var sn = sunText(Date.now());
    card.appendChild(h('div', { class: 'wx-line' }, K.icon(sn.icon), h('span', { text: sn.txt })));
    K.emit('wxcard', card, K.section);
  }
  K.renderWxCard = renderCard;
  $('wxCard').addEventListener('click', function () {
    if (K.sheetName() === 'weather') { K.closeSheet(); return; }
    K.openSheet('weather', 'Sää ja ennuste', renderSheet);
    W.refresh();
  });

  // ---------------------------------------------------------------------------
  // Sääpaneeli
  // ---------------------------------------------------------------------------

  function renderSheet(body) {
    var e = W.current(), now = Date.now();
    if (e) {
      body.appendChild(h('div', { class: 'wx-now' },
        h('span', { class: 'big', text: e.temp !== null && e.temp !== undefined ? K.fmt1(e.temp) + '°' : '–' }),
        e.dir !== null ? h('span', { class: 'wx-dial' }, windArrow(e.dir)) : null,
        h('div', null,
          h('div', { class: 'wind-title', text: 'Tuuli ' + MK.windFromName(e.dir) + (e.spd !== null ? ' ' + K.fmt1(e.spd) + ' m/s' : '') }),
          h('div', { class: 'muted small', text: (e.gust !== null && e.gust !== undefined ? 'Puuskissa ' + K.fmt1(e.gust) + ' m/s · ' : '') +
            (e.rh !== null && e.rh !== undefined ? 'kosteus ' + Math.round(e.rh) + ' %' : '') }),
          h('div', { class: 'muted small', text: 'Ennuste ' + K.fmtWhen(e.t) }))));
    } else body.appendChild(h('p', { class: 'muted', text: W.loading ? 'Haetaan ennustetta…' : 'Ei voimassa olevaa ennustetta. Ennuste haetaan, kun verkko on käytössä.' }));

    body.appendChild(h('h3', { text: 'Sadetutka 0–2 h' }));
    var rs = R.summary(false);
    body.appendChild(h('p', { text: rs || (settings.showRain ? 'Sadetietoa ei vielä ole.' : 'Sadetutka on pois päältä.') }));
    body.appendChild(h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-primary', text: 'Näytä sadetutka kartalla', disabled: !navigator.onLine && !R.data,
        onclick: function () { K.closeSheet(); R.openBar(); } })));
    body.appendChild(K.toggleRow('Hae sadetutka automaattisesti', 'Haetaan vain, kun sovellus on auki. Palkki avautuu itsestään, kun lähellä sataa.', settings.showRain, function (v) {
      settings.showRain = v; K.saveSettings(); if (v) R.refresh(true); else { R.open = false; stopRainPlay(); } updateRainUi(); renderCard();
    }));

    K.emit('wxsheet', body, K.section);

    body.appendChild(h('h3', { text: 'Ennuste' }));
    if (W.data && W.data.series.length) {
      var rows = W.data.series.filter(function (x) { return x.t >= now - 30 * 60000; }).slice(0, 13);
      var tb = h('tbody');
      rows.forEach(function (x) {
        tb.appendChild(h('tr', null,
          h('td', { text: K.hm(x.t) }),
          h('td', { text: x.temp !== null && x.temp !== undefined ? K.fmt1(x.temp) + '°' : '–' }),
          h('td', null, x.dir !== null ? windArrow(x.dir) : null, ' ' + (x.spd !== null ? K.fmt1(x.spd) : '–') + (x.gust !== null && x.gust !== undefined ? ' (' + K.fmt1(x.gust) + ')' : '')),
          h('td', { text: x.prec !== null && x.prec !== undefined ? K.fmt1(x.prec) : '–' })));
      });
      body.appendChild(h('table', { class: 'wx-table' }, h('thead', null, h('tr', null,
        h('th', { text: 'Klo' }), h('th', { text: 'Lämpö' }), h('th', { text: 'Tuuli m/s' }), h('th', { text: 'Sade mm' }))), tb));
      body.appendChild(h('p', { class: 'muted small', text: W.sourceName() + ' · haettu ' + K.fmtWhen(W.data.fetched) + ' · ' +
        (W.data.src === 'gps' ? 'sijaintisi' : 'kartan keskikohta') + ' (n. 1 km tarkkuus). Nuoli näyttää, mihin tuuli puhaltaa.' }));
    } else body.appendChild(h('p', { class: 'muted small', text: 'Ennustetta ei ole tallennettu.' }));
    body.appendChild(h('div', { class: 'btn-row' }, h('button', { type: 'button', class: 'btn', disabled: !navigator.onLine || W.loading,
      text: navigator.onLine ? (W.loading ? 'Haetaan…' : 'Päivitä ennuste') : 'Päivitys vaatii verkon', onclick: function () { W.refresh(true); } })));

    body.appendChild(h('h3', { text: 'Aurinko' }));
    renderSun(body);
  }

  // ---------------------------------------------------------------------------
  // Ajastukset ja tapahtumat
  // ---------------------------------------------------------------------------

  var moveTimer = 0;
  K.on('start', function () {
    setPlayIcon(false);
    renderCard();
    // Jos GPS on päällä, ensimmäinen haku tehdään sijainnin mukaan; muuten kartan keskeltä.
    setTimeout(function () { W.refresh(); R.refresh(); }, settings.gpsOn ? 6000 : 800);
  });
  K.on('pos', function () { W.refresh(); R.refresh(); });
  K.on('minute', function () { W.refresh(); R.refresh(); updateRainUi(); renderCard(); });
  K.on('visible', function () { W.refresh(); R.refresh(); });
  K.on('hidden', stopRainPlay);
  K.on('online', function () { W.refresh(); R.refresh(); });
  K.on('rotate', renderCard);
  K.on('section', renderCard);
  map.on('moveend', function () {
    if (K.pos) return;
    clearTimeout(moveTimer);
    moveTimer = setTimeout(function () { W.refresh(); R.refresh(); renderCard(); }, 1500);
  });
})();

/*
 * Kaira / Eränkäynti: kansallispuistot, luonnonpuistot, valtion ja seudulliset retkeilyalueet sekä kuntien
 * ulkoilualueet listana (Kohteet → Puistot ja retkialueet). Kohteen sivulla perustiedot, kuva, linkki Metsähallituksen sivulle, raja kartalle ja alueen
 * tuvat ja laavut. Aineisto: data/puistot.json (pipeline/puistot.py); rajat ja kuvat haetaan vasta pyydettäessä.
 */
(function () {
  'use strict';

  var K = window.K, JG = window.JG, MK = window.MK, h = K.h, sv = K.sv, map = K.map;
  var SEC = 'erankaynti';
  var TYPES = {
    kansallispuisto: { nimi: 'Kansallispuisto', mon: 'Kansallispuistot', color: '#2f8f4e' },
    luonnonpuisto: { nimi: 'Luonnonpuisto', mon: 'Luonnonpuistot', color: '#8a5a2b' },
    retkeilyalue: { nimi: 'Valtion retkeilyalue', mon: 'Retkeilyalueet', color: '#2f6f9a' },
    seuturetkeily: { nimi: 'Retkeilyalue', mon: 'Retkeilyalueet', color: '#4f7fb0' },
    ulkoilualue: { nimi: 'Ulkoilualue', mon: 'Ulkoilualueet', color: '#0f766e' }
  };
  var FILTERS = [['kaikki', 'Kaikki'], ['kansallispuisto', 'Kansallispuistot'], ['luonnonpuisto', 'Luonnonpuistot'], ['retkeilyalue', 'Retkeilyalueet'], ['ulkoilualue', 'Ulkoilualueet']];
  var MAX_ROWS = 100, ORGS = ['kunta', 'kuntayhtymä', 'yhdistys', 'yritys', 'säätiö', 'valtio', 'seurakunta'];
  var RE_ID = /^[a-z0-9-]{1,60}$/, RE_RAJA = /^data\/(puistot\/[a-z0-9-]{1,60}|ulkoilualueet\/c-\d{3,4}-\d{1,3})\.geojson(\?v=[a-f0-9]{6,16})?$/;
  var RE_WWW = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{2,5})?(\/[^\s"'<>]{0,280})?$/i;
  var RE_KUVA = /^img\/puistot\/[a-z0-9-]{1,60}\.jpg(\?v=[a-f0-9]{6,16})?$/, RE_COMMONS = /^https:\/\/commons\.wikimedia\.org\/[^\s"'<>]{1,300}$/;
  var RE_LINK = /^https:\/\/(www\.)?(luontoon\.fi|nationalparks\.fi|metsa\.fi)(\/[^\s"'<>]{0,280})?$/i;
  var P = { data: null, loading: null, failed: false, filter: 'kaikki', q: '', cur: null, shown: null, geo: {}, inside: null,
    layer: L.layerGroup() };

  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  /** Vain tunnetut kentät ja tarkistetut osoitteet. */
  function sanitize(j) {
    return ((j && Array.isArray(j.kohteet)) ? j.kohteet : []).filter(function (e) {
      return e && RE_ID.test(e.id) && TYPES[e.tyyppi] && typeof e.nimi === 'string' && num(e.lat) !== null && num(e.lon) !== null &&
        Math.abs(e.lat) <= 90 && Math.abs(e.lon) <= 180;
    }).slice(0, 5000).map(function (e) {
      var k = e.kuva && typeof e.kuva === 'object' && RE_KUVA.test(e.kuva.src) ? e.kuva : null;
      var b = Array.isArray(e.bbox) && e.bbox.length === 4 && e.bbox.every(function (x) { return num(x) !== null; }) ? e.bbox : null;
      return {
        id: e.id, nimi: str(e.nimi, 80), tyyppi: e.tyyppi, lat: e.lat, lon: e.lon,
        ha: num(e.ha), perustettu: num(e.perustettu) && e.perustettu > 1800 && e.perustettu < 2100 ? Math.round(e.perustettu) : null,
        kunnat: (Array.isArray(e.kunnat) ? e.kunnat : []).filter(function (x) { return typeof x === 'string'; }).slice(0, 4).map(function (x) { return x.slice(0, 40); }),
        bbox: b, raja: typeof e.raja === 'string' && RE_RAJA.test(e.raja) ? e.raja : null,
        linkki: typeof e.linkki === 'string' && RE_LINK.test(e.linkki) ? e.linkki : null,
        www: typeof e.www === 'string' && RE_WWW.test(e.www) ? e.www : null,
        kuvaus: str(e.kuvaus, 800), yllapitaja: ORGS.indexOf(e.yllapitaja) >= 0 ? e.yllapitaja : null, lipas: num(e.lipas) !== null,
        kuva: k ? { src: k.src, tekija: str(k.tekija, 80) || 'Tuntematon', lisenssi: str(k.lisenssi, 40), lahde: typeof k.lahde === 'string' && RE_COMMONS.test(k.lahde) ? k.lahde : null } : null
      };
    });
  }
  function load() {
    if (P.data) return Promise.resolve(P.data);
    if (P.loading) return P.loading;
    P.loading = K.fetchJSON('data/puistot.json').then(function (j) {
      P.data = sanitize(j); P.updated = typeof j.paivitetty === 'string' ? j.paivitetty : null; P.failed = false; return P.data;
    }).catch(function () { P.failed = true; return null; }).then(function (d) { P.loading = null; return d; });
    return P.loading;
  }
  function rerender(name) { if (K.sheetName() === name) K.renderSheet(); }

  function fmtArea(ha) {
    if (!ha) return '';
    var km = ha / 100;
    return (km < 10 ? K.fmt1(km) : K.fmtInt(km)) + ' km²';
  }
  function icon(tyyppi) {
    var c = (TYPES[tyyppi] || TYPES.kansallispuisto).color;
    var s = sv('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' });
    sv('circle', { cx: 12, cy: 12, r: 11, fill: c, stroke: '#ffffff', 'stroke-width': 1.5 }, s);
    // Kuusi
    sv('path', { d: 'M12 4.5 L16.5 11 H14 L17.5 16 H13 V19 H11 V16 H6.5 L10 11 H7.5 Z', fill: '#ffffff' }, s);
    return s;
  }
  function distText(e, p) {
    var d = JG.distance(p.lat, p.lon, e.lat, e.lon), brg = JG.bearing(p.lat, p.lon, e.lat, e.lon);
    return { d: d, dist: K.fmtDist(d), dir: Math.round(brg) + '° ' + JG.dirName(brg) };
  }

  // --- Luettelo (Kohteet-paneelin välilehti) ---
  function matches(e) {
    var t = e.tyyppi === 'seuturetkeily' ? 'retkeilyalue' : e.tyyppi;
    if (P.filter !== 'kaikki' && t !== P.filter) return false;
    if (!P.q) return true;
    var q = P.q.toLocaleLowerCase('fi');
    return e.nimi.toLocaleLowerCase('fi').indexOf(q) >= 0 || e.kunnat.some(function (k) { return k.toLocaleLowerCase('fi').indexOf(q) >= 0; });
  }
  function fillList(box, p) {
    box.textContent = '';
    var items = (P.data || []).filter(matches).map(function (e) { return { e: e, t: distText(e, p) }; }).sort(function (a, b) { return a.t.d - b.t.d; });
    if (!items.length) { box.appendChild(h('p', { class: 'muted', text: P.q ? 'Ei osumia haulla "' + P.q + '".' : 'Ei kohteita.' })); return; }
    var more = items.length - MAX_ROWS;
    items.slice(0, MAX_ROWS).forEach(function (it) {
      var e = it.e;
      box.appendChild(h('button', { type: 'button', class: 'list-row', onclick: function () { openPark(e); } },
        h('span', { class: 'lr-ico' }, icon(e.tyyppi)),
        h('span', { class: 'lr-txt' }, h('b', { text: e.nimi }), h('small', { text: TYPES[e.tyyppi].nimi + (e.ha ? ' · ' + fmtArea(e.ha) : '') })),
        h('span', { class: 'lr-dist' }, it.t.dist, h('small', { text: it.t.dir }))));
    });
    if (more > 0) box.appendChild(h('p', { class: 'muted small', text: 'Näytetään ' + MAX_ROWS + ' lähintä, ' + K.fmtInt(more) + ' muuta. Hae nimellä tai kunnalla.' }));
  }
  function renderList(body) {
    if (!P.data) {
      body.appendChild(h('p', { class: 'muted', text: P.failed ? 'Puistoluetteloa ei saatu. Avaa luettelo kerran verkossa, niin se toimii myös ilman verkkoa.' : 'Ladataan puistoja…' }));
      if (!P.failed) load().then(function () { rerender('kohteet'); });
      return;
    }
    var p = K.wherePoint(10 * 60000);
    body.appendChild(K.seg(FILTERS, P.filter, function (v) { P.filter = v; K.renderSheet(); }, { cls: 'seg-wrap', label: 'Alueen tyyppi' }));
    var search = h('input', { class: 'input', type: 'search', placeholder: 'Hae nimellä tai kunnalla', 'aria-label': 'Hae puistoa nimellä tai kunnalla', autocomplete: 'off', enterkeyhint: 'search' });
    search.value = P.q;
    var list = h('div', { class: 'park-list' });
    search.addEventListener('input', function () { P.q = search.value.trim().slice(0, 40); fillList(list, p); });
    body.appendChild(h('div', { class: 'field' }, search));
    body.appendChild(h('p', { class: 'muted small', text: p.src === 'gps' ? 'Lähimmät sijainnistasi' : 'Lähimmät kartan keskeltä. Laita sijainti päälle, niin etäisyydet lasketaan sinusta.' }));
    body.appendChild(list);
    fillList(list, p);
    body.appendChild(h('p', { class: 'muted small', text: 'Lähteet: Syke (CC BY 4.0), LIPAS / Jyväskylän yliopisto (CC BY 4.0), © OpenStreetMapin tekijät (ODbL), Wikidata (CC0). Tarkista ajantasaiset tiedot ja säännöt ylläpitäjän sivuilta.' }));
  }

  // --- Kohteen sivu ---
  function openPark(e) {
    P.cur = e; P.inside = null;
    K.openSheet('puisto', e.nimi, renderPark, { onClose: function () { P.cur = null; P.inside = null; } });
  }
  function linkLabel(u) { return /luontoon\.fi/i.test(u) ? 'Avaa luontoon.fi' : /nationalparks\.fi/i.test(u) ? 'Avaa nationalparks.fi' : 'Metsähallituksen sivu'; }
  function renderPark(body) {
    var e = P.cur;
    if (!e) return;
    if (e.kuva) {
      var cap = h('figcaption', { class: 'park-cap' }, 'Kuva: ' + e.kuva.tekija + (e.kuva.lisenssi ? ', ' + e.kuva.lisenssi : '') + ' · ');
      cap.appendChild(e.kuva.lahde ? h('a', { href: e.kuva.lahde, target: '_blank', rel: 'noopener noreferrer', text: 'Wikimedia Commons' }) : document.createTextNode('Wikimedia Commons'));
      body.appendChild(h('figure', { class: 'park-fig' },
        h('img', { src: e.kuva.src, alt: e.nimi, loading: 'lazy', decoding: 'async', onerror: function () { this.parentNode.hidden = true; } }), cap));
    }
    var facts = [TYPES[e.tyyppi].nimi, e.ha ? fmtArea(e.ha) : '', e.perustettu ? 'perustettu ' + e.perustettu : ''].filter(Boolean);
    body.appendChild(h('p', { class: 'park-type', text: facts.join(' · ') }));
    var who = [e.kunnat.join(', '), e.yllapitaja ? 'ylläpitäjä: ' + e.yllapitaja : ''].filter(Boolean).join(' · ');
    if (who) body.appendChild(h('p', { class: 'small muted', text: who }));
    if (e.kuvaus) body.appendChild(h('p', { class: 'small park-desc', text: e.kuvaus }));
    var p = K.wherePoint(10 * 60000), t = distText(e, p);
    body.appendChild(h('p', { class: 'small', text: (p.src === 'gps' ? 'Sinusta ' : 'Kartan keskeltä ') + t.dist + ', ' + t.dir }));
    if (e.tyyppi === 'luonnonpuisto') body.appendChild(h('div', { class: 'notice', text: 'Luonnonpuistoissa liikkumista on rajoitettu: monissa saa liikkua vain merkityillä reiteillä tai luvalla. Tarkista säännöt ennen retkeä.' }));
    var row = h('div', { class: 'btn-row' });
    var url = e.linkki || e.www;
    if (url) row.appendChild(h('a', { class: 'btn btn-primary', href: url, target: '_blank', rel: 'noopener noreferrer', text: e.linkki ? linkLabel(e.linkki) : 'Ylläpitäjän sivu' }));
    row.appendChild(h('button', { type: 'button', class: 'btn' + (url ? '' : ' btn-primary'), text: 'Näytä kartalla', onclick: function () { showOnMap(e); } }));
    row.appendChild(h('button', { type: 'button', class: 'btn', 'aria-expanded': P.inside ? 'true' : 'false', text: 'Tuvat ja laavut alueella', onclick: function () { listInside(e); } }));
    body.appendChild(row);
    if (P.inside) renderInside(body, e);
    body.appendChild(h('p', { class: 'small muted', text: e.lipas ? 'Tiedot ja raja: LIPAS, Jyväskylän yliopisto (CC BY 4.0). Tarkista ajantasaiset tiedot ja palvelut ylläpitäjältä.' :
      (e.raja ? 'Raja: ' + (e.tyyppi === 'retkeilyalue' ? '© OpenStreetMapin tekijät (ODbL)' : 'Syke (CC BY 4.0)') + '. ' : '') +
      'Perustiedot: Wikidata (CC0). Ajantasaiset palvelut, reitit ja säännöt löytyvät Metsähallituksen sivulta.' }));
  }
  function boundary(e) {
    if (!e.raja) return Promise.resolve(null);
    if (P.geo[e.id]) return Promise.resolve(P.geo[e.id]);
    // LIPASin rajat ovat ruuduittain samassa tiedostossa: vain tämän kohteen alue
    return K.fetchJSON(e.raja).then(function (gj) {
      var fs = gj && Array.isArray(gj.features) ? gj.features : [];
      if (fs.some(function (f) { return f && f.properties && f.properties.id; })) fs = fs.filter(function (f) { return f && f.properties && f.properties.id === e.id; });
      P.geo[e.id] = JG.cleanGeoJSON({ type: 'FeatureCollection', features: fs });
      return P.geo[e.id];
    });
  }
  function showOnMap(e) {
    boundary(e).then(function (gj) {
      P.layer.clearLayers();
      if (!map.hasLayer(P.layer)) P.layer.addTo(map);
      var c = TYPES[e.tyyppi].color;
      if (gj) {
        L.geoJSON(gj, { pane: 'boundaryPane', interactive: false, style: { color: '#ffffff', weight: 5, opacity: 0.5, fill: false } }).addTo(P.layer);
        L.geoJSON(gj, { pane: 'boundaryPane', interactive: false, style: { color: c, weight: 2.5, fillColor: c, fillOpacity: 0.1 } }).addTo(P.layer);
      }
      P.shown = e.id;
      K.closeSheet();
      if (e.bbox) K.fitBounds([[e.bbox[0], e.bbox[1]], [e.bbox[2], e.bbox[3]]]);
      else map.setView([e.lat, e.lon], 11);
      K.toast(gj ? e.nimi + ': raja kartalla' : e.nimi + ' (rajaa ei ole)', { label: 'Piilota', fn: hideBoundary }, 8000);
    }).catch(function () { K.toast('Rajaa ei saatu. Avaa kohde kerran verkossa, niin raja toimii myös ilman verkkoa.'); });
  }
  function hideBoundary() { P.layer.clearLayers(); P.shown = null; }

  function listInside(e) {
    if (P.inside) { P.inside = null; K.renderSheet(); return; }
    P.inside = { loading: true };
    K.renderSheet();
    boundary(e).then(function (gj) {
      var geoms = gj ? gj.features.map(function (f) { return f.geometry; }) : [];
      var feats = (K.wild && K.wild.D && K.wild.D.features) || [];
      var hits = feats.filter(function (f) {
        if (geoms.length) return geoms.some(function (g) { return MK.geometryContains(g, f.lon, f.lat); });
        return JG.distance(e.lat, e.lon, f.lat, f.lon) < 3000; // ei rajaa: 3 km kohteen pisteestä
      });
      P.inside = { list: hits, approx: !geoms.length, total: feats.length };
      rerender('puisto');
    }).catch(function () { P.inside = { error: true }; rerender('puisto'); });
  }
  function renderInside(body, e) {
    var box = h('div', { class: 'park-inside' });
    var I = P.inside;
    if (I.loading) box.appendChild(h('p', { class: 'muted small', text: 'Haetaan…' }));
    else if (I.error) box.appendChild(h('p', { class: 'muted small', text: 'Rajaa ei saatu ilman verkkoa.' }));
    else {
      box.appendChild(h('h3', { text: I.list.length ? I.list.length + ' kohdetta ' + (I.approx ? 'enintään 3 km päässä' : 'alueella') : 'Ei tupia, laavuja tai tulipaikkoja ' + (I.approx ? 'lähellä' : 'alueella') }));
      I.list.slice(0, 60).forEach(function (f) {
        box.appendChild(h('button', { type: 'button', class: 'list-row', onclick: function () { K.wild.openKohde(f); } },
          h('span', { class: 'lr-ico' }, K.kohdeIcon(f.tyyppi)),
          h('span', { class: 'lr-txt' }, h('b', { text: f.nimi }), h('small', { text: K.wild.typeName(f.tyyppi) + (f.maakunta ? ', ' + f.maakunta : '') }))));
      });
      if (!I.total) box.appendChild(h('p', { class: 'muted small', text: 'Kohdeaineisto ei ole vielä latautunut. Laita tuvat ja laavut päälle Tasot-valikosta.' }));
      else box.appendChild(h('p', { class: 'muted small', text: 'Mukana Tasot-valikossa päällä olevat kohdetyypit.' }));
    }
    body.appendChild(box);
  }

  K.on('leave', function (sec) { if (sec === SEC) hideBoundary(); });
  K.parks = { P: P, load: load, renderList: renderList, openPark: openPark, showOnMap: showOnMap, sanitize: sanitize };
})();

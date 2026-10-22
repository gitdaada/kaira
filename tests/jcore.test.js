/* Laskentaytimen testit: node tests/core.test.js */
'use strict';
var assert = require('assert');
var JG = require('../docs/js/jcore.js');
var fs = require('fs');
var path = require('path');

var n = 0;
function test(name, fn) { fn(); n++; console.log('ok - ' + name); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' ' + a + ' vs ' + b); }

test('etäisyys ja suuntima', function () {
  // 1 leveysaste ≈ 111,2 km
  near(JG.distance(69, 21, 70, 21), 111195, 50);
  near(JG.bearing(69, 21, 70, 21), 0, 0.01);
  near(JG.bearing(69, 21, 69, 22), 89.5, 0.5);
  var p = JG.destPoint(69.1, 21.6, 135, 20000);
  near(JG.distance(69.1, 21.6, p[0], p[1]), 20000, 1);
  near(JG.bearing(69.1, 21.6, p[0], p[1]), 135, 0.2);
});

test('kehäpisteet 20 km', function () {
  var pts = JG.ringPoints(69.1, 21.6, 20000);
  assert.strictEqual(pts.length, 9);
  pts.slice(1).forEach(function (q) { near(JG.distance(69.1, 21.6, q.lat, q.lon), 20000, 1); });
});

test('ETRS-TM35FIN vastaa Metsähallituksen ilmoittamia koordinaatteja', function () {
  // Porojärven autiotupa: WGS84 69° 08,9371′ N 21° 33,7112′ E = N 7680549, E 284220 (nationalparks.fi)
  var tm = JG.toTM35FIN(69 + 8.9371 / 60, 21 + 33.7112 / 60);
  near(tm.N, 7680549, 2, 'N'); near(tm.E, 284220, 2, 'E');
  // Isokurkkion autiotupa: 68° 37,7955′ N 22° 16,6728′ E = N 7620466, E 308131 (luontoon.fi)
  tm = JG.toTM35FIN(68 + 37.7955 / 60, 22 + 16.6728 / 60);
  near(tm.N, 7620466, 2, 'N'); near(tm.E, 308131, 2, 'E');
  assert.strictEqual(JG.fmtDM(69 + 8.9371 / 60), '69° 08,937′');
});

test('pyöristys ennen lähetystä', function () {
  assert.strictEqual(JG.roundCoord(69.148952, 2), 69.15);
  assert.strictEqual(JG.roundCoord(21.561853, 2), 21.56);
});

test('aurinko: Poroenolla yötön yö kesäkuussa ja kaamos joulukuussa', function () {
  assert.strictEqual(JG.sunTimes(Date.UTC(2026, 5, 21, 10), 69.12, 21.65).polar, 'day');
  assert.strictEqual(JG.sunTimes(Date.UTC(2026, 11, 21, 10), 69.12, 21.65).polar, 'night');
  var oct = JG.sunTimes(Date.UTC(2026, 9, 21, 10), 69.12, 21.65);
  assert.ok(oct.rise && oct.set && oct.set > oct.rise);
});

test('MET nowcast ja sateen alku', function () {
  var j = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/nowcast.json'), 'utf8'));
  var r = JG.parseNowcast(j);
  assert.strictEqual(r.coverage, 'ok');
  assert.strictEqual(JG.rainStart(r.series, Date.parse('2026-10-21T09:00:00Z')), Date.parse('2026-10-21T09:30:00Z'));
});

test('karttatiilet', function () {
  var b = [21.48, 69.04, 21.86, 69.17];
  var list = JG.tilesForBbox(b, 8, 12);
  assert.strictEqual(list.length, JG.countTiles(b, 8, 12));
  assert.ok(JG.countTiles(b, 8, 15) < 3000);
});

test('GeoJSON-tuonti: vain tunnetut kentät säilyvät, viallinen hylätään', function () {
  var gj = { type: 'FeatureCollection', features: [
    { type: 'Feature', properties: { nimi: 'Koski', tyyppi: 'koski', ylimaarainen: 'ei tallennu', tunniste: 7 }, geometry: { type: 'Point', coordinates: [21.6, 69.1] } },
    { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [999, 69.1] } }
  ] };
  var c = JG.cleanGeoJSON(gj);
  assert.strictEqual(c.features.length, 1);
  assert.deepStrictEqual(c.features[0].properties, { nimi: 'Koski', tyyppi: 'koski' });
  assert.throws(function () { JG.cleanGeoJSON({ type: 'Feature' }); });
});

test('GeoJSON-tason tarkistus ja alueen rajaus (vanhat testitasot)', function () {
  var gj = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/poroeno.geojson'), 'utf8'));
  var c = JG.cleanGeoJSON(gj);
  assert.strictEqual(c.features.length, 3);
  assert.deepStrictEqual(JG.areaBbox(c), [21.53, 68.97, 22.1, 69.165]);
  var h = JG.cleanGeoJSON(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/hossa.geojson'), 'utf8')));
  assert.deepStrictEqual(JG.areaBbox(h), [29.3, 65.27, 29.62, 65.53]);
});

test('perhosuositus kehitysvaiheen mukaan', function () {
  var d = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/data/perhot.json'), 'utf8'));
  assert.deepStrictEqual(JG.pickStages({ surface: true, flying: false }), ['pinturi']);
  assert.deepStrictEqual(JG.pickStages({ surface: true, flying: true }), ['pinturi', 'aikuinen']);
  assert.deepStrictEqual(JG.pickStages({ surface: false, signs: true }), ['nousussa']);
  assert.deepStrictEqual(JG.pickStages({ surface: false, signs: false }), ['pohjalla']);
  var r = JG.recommend(d, 'harjus', 'paivankorennot', { surface: true });
  assert.strictEqual(r[0].vaihe, 'Pinturi');
  assert.strictEqual(r[0].perhot[0].nimi, 'Klinkhamer');
  // Koskikorennolla ei ole pinturivaihetta: näytetään muniva naaras ja selitys
  r = JG.recommend(d, 'harjus', 'koskikorennot', { surface: true });
  assert.strictEqual(r[0].vaihe, 'Muniva naaras');
  assert.ok(/pinturivaihetta ei ole/.test(r[0].huom));
  // Siika: vain lajille kuuluvat ryhmät
  r = JG.recommend(d, 'siika', 'kaikki', { surface: false, signs: false });
  assert.deepStrictEqual(r.map(function (x) { return x.ryhma; }), ['Surviaiset', 'Päivänkorennot']);
  // Valokuvilla on tekijä, lisenssi ja Commons-lähde, ja tiedosto on olemassa
  var photos = 0;
  function checkFly(p) {
    if (!p.kuva) return;
    assert.ok(fs.existsSync(path.join(__dirname, '../docs/img/perhot', p.kuva)), p.kuva);
    if (/\.jpg$/.test(p.kuva)) {
      photos++;
      assert.ok(p.kuvaaja && p.lisenssi && /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/.test(p.lahde), p.nimi);
    }
  }
  Object.keys(d.ryhmat).forEach(function (g) {
    Object.keys(d.ryhmat[g].vaiheet).forEach(function (v) { d.ryhmat[g].vaiheet[v].perhot.forEach(checkFly); });
  });
  Object.keys(d.lohi.tilat).forEach(function (t) { d.lohi.tilat[t].perhot.forEach(checkFly); });
  assert.ok(photos >= 16, 'valokuvia ' + photos);
  // Kaikki kuvatiedostot ovat olemassa
  Object.keys(d.ryhmat).forEach(function (g) {
    Object.keys(d.ryhmat[g].vaiheet).forEach(function (v) {
      assert.ok(fs.existsSync(path.join(__dirname, '../docs/img/perhot', d.ryhmat[g].vaiheet[v].kuva)));
    });
  });
});

test('API-avaimen puhdistus', function () {
  assert.strictEqual(JG.sanitizeKey(' abc-123<script> '), 'abc-123script');
});

test('hätäviesti: puhelinnumeron muoto', function () {
  assert.strictEqual(JG.normPhone('040 123 4567'), '+358401234567');
  assert.strictEqual(JG.normPhone('+358 (0)40-123 4567'), '+358401234567');
  assert.strictEqual(JG.normPhone('00358401234567'), '+358401234567');
  assert.strictEqual(JG.normPhone('358401234567'), '+358401234567');
  assert.strictEqual(JG.normPhone('+46 70 123 45 67'), '+46701234567');
  ['', '123', '401234567', '+0401234567', 'abc', '+358 40 123 4567 8901 2345', '040<script>', null].forEach(function (v) {
    assert.strictEqual(JG.normPhone(v), '', String(v));
  });
});

test('hätäviesti: teksti ja linkit', function () {
  var t = JG.sosText('Nilkka nyrjähti, en pääse kävelemään.', { lat: 65.121874, lon: 28.852071, acc: 8.4 }, '11.26');
  var rows = t.split('\n');
  assert.strictEqual(rows[0], 'Nilkka nyrjähti, en pääse kävelemään.');
  assert.strictEqual(rows[1], 'Sijainti: 65.12187, 28.85207 (± 8 m, klo 11.26)');
  assert.ok(/^ETRS-TM35FIN: N 72\d{5}, E \d{6}$/.test(rows[2]), rows[2]);
  assert.strictEqual(rows[3], 'Kartta: https://www.google.com/maps/search/?api=1&query=65.12187%2C28.85207');
  assert.strictEqual(JG.sosText('  ', null).split('\n')[0], 'Tarvitsen apua.');
  assert.ok(/ei saatavilla/.test(JG.sosText('', null)));
  assert.strictEqual(JG.sosText('a\u0007b\nc', null).split('\n')[0], 'ab');
  assert.strictEqual(JG.waLink('040 123 4567', 'Apua & 1/2'), 'https://wa.me/358401234567?text=Apua%20%26%201%2F2');
  assert.strictEqual(JG.waLink('123', 'x'), null);
  assert.strictEqual(JG.smsLink(['040 123 4567', 'huono', '+46701234567'], 'A\nB', false), 'sms:+358401234567,+46701234567?body=A%0AB');
  assert.strictEqual(JG.smsLink(['040 123 4567', '+46701234567'], 'A', true), 'sms://open?addresses=+358401234567,+46701234567&body=A');
  assert.strictEqual(JG.smsLink([], 'A', false), null);
});

console.log(n + ' testiä läpi');

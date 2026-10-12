// T15 — pomiar po drogach: domena (prędkości, czas, szacunek, mosty, odpowiedź OSRM) i POST /api/route z atrapą routera.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { createRouter } from '../server/route.js';
import {
  MARCH_PROFILES, profileById, profileFromSidc, isNightAt, speedKmh, marchMinutesFor,
  estimateRoute, roadRoute, bridgesOnRoute, routeSummary,
} from '../public/js/domain/roadmarch.js';
import { makeScenario } from './helpers.js';

const TZ = 'Europe/Warsaw';

describe('T15 — domena: typy, prędkości, czas', () => {
  test('prędkości dzień/noc dla każdego typu, noc wolniejsza', () => {
    for (const p of MARCH_PROFILES) {
      assert.ok(p.dayKmh > p.nightKmh && p.nightKmh > 0, p.id);
      assert.equal(speedKmh(p, false), p.dayKmh);
      assert.equal(speedKmh(p, true), p.nightKmh);
    }
    assert.ok(profileById('tracked').dayKmh < profileById('wheeled').dayKmh);
    assert.equal(profileById('nieznany').id, 'wheeled');
  });
  test('czas marszu = km / prędkość', () => {
    const w = profileById('wheeled');
    assert.equal(marchMinutesFor(30, w, false), 60);
    assert.equal(marchMinutesFor(20, w, true), 60);
    assert.equal(marchMinutesFor(20, profileById('tracked'), false), 60);
  });
  test('typ z SIDC: pancerne, zmechanizowane, piechota', () => {
    assert.equal(profileFromSidc('SFGPUCAT---E---').id, 'tracked');
    assert.equal(profileFromSidc('SFGPUCIZ---F---').id, 'wheeled');
    assert.equal(profileFromSidc('SFGPUCI----F---').id, 'foot');
    assert.equal(profileFromSidc('').id, 'wheeled');
  });
  test('dzień/noc wg godziny w strefie scenariusza', () => {
    assert.equal(isNightAt('2026-05-14T08:00:00+02:00', TZ), false);
    assert.equal(isNightAt('2026-05-14T22:00:00+02:00', TZ), true);
    assert.equal(isNightAt('2026-05-14T04:59:00+02:00', TZ), true);
    assert.equal(isNightAt('2026-05-14T05:00:00+02:00', TZ), false);
    assert.equal(isNightAt('2026-05-14T20:00:00Z', TZ), true); // 22:00 lokalnie
    assert.equal(isNightAt(undefined, TZ), false);
  });
  test('szacunek = prosta × 1,3 z oznaczeniem', () => {
    const pts = [[22.9, 54.1], [22.9, 54.2]];
    const r = estimateRoute(pts);
    assert.equal(r.estimate, true);
    assert.equal(r.path, null);
    assert.ok(Math.abs(r.km - r.straightKm * 1.3) < 1e-9);
    assert.match(r.note, /szacunek/);
    assert.match(r.note, /1,3/);
    const sum = routeSummary(r, profileById('wheeled'), { bridges: [{ id: 'b', pos: pts[0], mlc: 1 }] });
    assert.equal(sum.bridgesChecked, false);
    assert.deepEqual(sum.warnings, []);
  });
});

describe('T15 — domena: mosty na trasie', () => {
  const path = [[22.9, 54.1], [22.9, 54.2]];
  const onRoute = [22.9, 54.15];
  const mk = (extra) => ({ id: 'b1', name: 'Most Czarna', pos: onRoute, status: 'intact', ...extra });
  test('mlc 40 t < 60 t (gąsienicowa) daje ostrzeżenie z nazwą; 26 t kołowa brak', () => {
    const w = bridgesOnRoute(path, [mk({ mlc: 40 })], profileById('tracked').massT);
    assert.equal(w.length, 1);
    assert.equal(w[0].level, 'bad');
    assert.match(w[0].text, /Most Czarna/);
    assert.deepEqual(bridgesOnRoute(path, [mk({ mlc: 40 })], profileById('wheeled').massT), []);
    assert.deepEqual(bridgesOnRoute(path, [mk({ mlc: 26 })], 26), []); // mlc == masa: bez ostrzeżenia
    assert.deepEqual(bridgesOnRoute(path, [mk({ mlc: 40 })], 0), []); // piesza
  });
  test('tolerancja 150 m, stany, pusta lista', () => {
    const near = [22.9 + 0.0015, 54.15]; // ~98 m
    const far = [22.9 + 0.003, 54.15]; // ~196 m
    assert.equal(bridgesOnRoute(path, [mk({ pos: near, mlc: 10 })], 26).length, 1);
    assert.equal(bridgesOnRoute(path, [mk({ pos: far, mlc: 10 })], 26).length, 0);
    assert.equal(bridgesOnRoute(path, [mk({ status: 'destroyed' })], 0)[0].level, 'bad');
    assert.equal(bridgesOnRoute(path, [mk({ status: 'damaged' })], 0)[0].level, 'warn');
    assert.deepEqual(bridgesOnRoute(path, [], 60), []);
    assert.deepEqual(bridgesOnRoute(path, undefined, 60), []);
  });
  test('routeSummary: trasa drogowa sprawdza mosty', () => {
    const route = roadRoute(path, { coords: path, km: 11 });
    const sum = routeSummary(route, profileById('tracked'), { night: true, bridges: [mk({ mlc: 40 })] });
    assert.equal(sum.bridgesChecked, true);
    assert.equal(sum.warnings.length, 1);
    assert.equal(sum.speedKmh, 14);
    assert.ok(Math.abs(sum.minutes - (11 / 14) * 60) < 1e-9);
  });
});

describe('T15 — domena: odpowiedź routera', () => {
  const pts = [[22.9, 54.1], [22.9, 54.2]];
  test('poprawna, uszkodzona, brak', () => {
    const ok = roadRoute(pts, { coords: [[22.9, 54.1], [22.91, 54.15], [22.9, 54.2]], km: 12.3 });
    assert.equal(ok.estimate, false);
    assert.equal(ok.km, 12.3);
    assert.equal(roadRoute(pts, { coords: [[1, 2]], km: 1 }), null);
    assert.equal(roadRoute(pts, { coords: [[1, 2], [3, 'x']], km: 1 }), null);
    assert.equal(roadRoute(pts, { coords: [[1, 2], [3, 4]], km: -1 }), null);
    assert.equal(roadRoute(pts, null), null);
  });
});

describe('T15 — serwer: POST /api/route z atrapą routera', () => {
  const OSRM = { code: 'Ok', routes: [{ distance: 12345, geometry: { coordinates: [[22.9, 54.1], [22.95, 54.15], [23, 54.2]] } }] };
  let calls, behaviour, app, server, base;
  const post = (body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(base + '/api/route', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const GOOD = { coords: [[22.9, 54.1], [23, 54.2]] };

  before(async () => {
    const sc = await makeScenario();
    calls = [];
    behaviour = async () => ({ ok: true, json: async () => OSRM });
    const router = createRouter({ fetchImpl: async (url, opt) => { calls.push({ url, opt }); return behaviour(); } });
    ({ server } = createApp(sc.dir, { router }));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
    app = { close: () => new Promise((r) => { server.closeAllConnections(); server.close(r); }) };
  });
  after(() => app.close());

  test('200: trasa, tylko współrzędne w zapytaniu, stały host, cache', async () => {
    const res = await post({ coords: [[22.123456789, 54.1], [23, 54.2]], url: 'http://evil.example' });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.source, 'osrm');
    assert.ok(Math.abs(j.km - 12.345) < 1e-9);
    assert.equal(j.coords.length, 3);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith('https://router.project-osrm.org/route/v1/driving/22.12346,54.1;23,54.2?'));
    assert.equal((await post({ coords: [[22.123456789, 54.1], [23, 54.2]] })).status, 200);
    assert.equal(calls.length, 1, 'drugie zapytanie z cache');
  });
  test('400: liczba punktów, zakres, typ, zły JSON, brak Content-Type JSON', async () => {
    assert.equal((await post({ coords: [[22.9, 54.1]] })).status, 400);
    assert.equal((await post({ coords: Array.from({ length: 26 }, () => [22.9, 54.1]) })).status, 400);
    assert.equal((await post({ coords: [[22.9, 54.1], [200, 54.2]] })).status, 400);
    assert.equal((await post({ coords: [[22.9, 54.1], [22.9, 91]] })).status, 400);
    assert.equal((await post({ coords: [[22.9, 54.1], ['a', 'b']] })).status, 400);
    assert.equal((await post({ coords: [[22.9, 54.1], [22.9, 54.1, 5]] })).status, 400);
    assert.equal((await post({})).status, 400);
    assert.equal((await post('{zly')).status, 400);
    assert.ok((await post(GOOD, { 'Content-Type': 'text/plain' })).status >= 400);
  });
  test('502: błąd routera, przekroczenie czasu, brak drogi', async () => {
    behaviour = async () => { throw new Error('boom'); };
    assert.equal((await post({ coords: [[21, 52], [21.1, 52.1]] })).status, 502);
    behaviour = async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; };
    assert.equal((await post({ coords: [[21, 52], [21.2, 52.1]] })).status, 502);
    behaviour = async () => ({ ok: false, status: 500, json: async () => ({}) });
    assert.equal((await post({ coords: [[21, 52], [21.3, 52.1]] })).status, 502);
    behaviour = async () => ({ ok: true, json: async () => ({ code: 'NoRoute' }) });
    assert.equal((await post({ coords: [[21, 52], [21.4, 52.1]] })).status, 502);
  });
  test('503: router wyłączony (KS_ROUTER=off)', async () => {
    const r = createRouter({ disabled: true, fetchImpl: async () => { throw new Error('nie wolno'); } });
    await assert.rejects(r.route(GOOD.coords), (e) => e.status === 503);
  });
  test('cache ograniczony rozmiarem', async () => {
    const r = createRouter({ max: 3, fetchImpl: async () => ({ ok: true, json: async () => OSRM }) });
    for (let i = 0; i < 6; i++) await r.route([[21 + i / 10, 52], [22, 53]]);
    assert.equal(r.cacheSize(), 3);
  });
});

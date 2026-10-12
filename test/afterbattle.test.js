// T29: tryb po bitwie — czyste funkcje klienta i szczelność serwera (status w locie, traversal, SSE).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isFinished, enemyTruth, truthLabel } from '../public/js/domain/afterbattle.js';
import { isPlayerVisible } from '../server/watch.js';
import { makeScenario, startApp, SECRET } from './helpers.js';

const scen = (status) => ({ id: 'test', title: 'T', turnMinutes: 120, timezone: 'Europe/Warsaw', ...(status ? { status } : {}), channels: [{ id: 'dow', name: 'D', kind: 'superior' }] });

describe('T29 — domain/afterbattle', () => {
  test('isFinished tylko dla status: finished', () => {
    assert.equal(isFinished({ status: 'finished' }), true);
    for (const s of [{ status: 'active' }, {}, null, undefined, { status: 'FINISHED' }]) assert.equal(isFinished(s), false);
  });
  test('enemyTruth bierze strony przeciwne z pozycją', () => {
    const truth = { units: [{ id: 'a', side: 'PL', pos: [1, 2] }, { id: 'b', side: 'RU', pos: [1, 2] }, { id: 'c', side: 'RU' }, null] };
    assert.deepEqual(enemyTruth(truth).map((u) => u.id), ['b']);
    assert.deepEqual(enemyTruth(null), []);
  });
  test('truthLabel: nazwa i siła', () => {
    assert.equal(truthLabel({ name: 'X', strength: 0.5 }), 'X · siła 50%');
    assert.equal(truthLabel({ id: 'y' }), 'y');
  });
});

describe('T29 — szczelność serwera', () => {
  let sc, app;
  before(async () => {
    sc = await makeScenario();
    await sc.write('umpire/aar.md', '# AAR\n' + SECRET);
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('status zmieniany w locie: 403 -> 200 -> 403 (także AAR)', async () => {
    for (const [status, code] of [['active', 403], ['finished', 200], ['active', 403], [null, 403], ['finished', 200]]) {
      await sc.write('scenario.json', scen(status));
      assert.equal((await app.get('/api/truth/0')).status, code, String(status));
      const aar = await app.get('/api/aar');
      assert.equal(aar.status, code, String(status));
      if (code === 403) assert.ok(!(await aar.text()).includes(SECRET));
    }
  });

  test('uszkodzony scenario.json = 403, nie 500 i bez treści', async () => {
    await sc.write('scenario.json', '{ nie json');
    const r = await app.get('/api/truth/0');
    assert.equal(r.status, 403);
    assert.ok(!(await r.text()).includes(SECRET));
    await sc.write('scenario.json', scen('finished'));
  });

  test('traversal i kodowanie: nigdy 200 z prawdą, nigdy SECRET', async () => {
    const paths = ['/api/truth/%2e%2e%2fumpire%2fturns%2f000', '/api/truth/%252e%252e', '/api/truth/0%00', '/api/truth/0%2f..', '/api/truth/..\0',
      '/api/truth/%2e%2e/%2e%2e/scenario', '/api/truth/-1', '/api/truth/1e0', 
      '/scenarios/test/umpire/turns/000.json', '/umpire/aar.md', '/%75mpire/aar.md', '/shared/../scenarios/x', '/data/..%2fscenario.json', '/vendor/%2e%2e/server/app.js'];
    for (const p of paths) {
      const r = await app.get(p);
      const body = await r.text();
      assert.ok(!body.includes(SECRET), p);
      assert.ok(r.status >= 400, `${p} -> ${r.status}`);
    }
  });

  test('POST/PUT/DELETE na /api/truth i /api/aar odrzucone, scenario.json nietknięty', async () => {
    for (const m of ['POST', 'PUT', 'DELETE']) {
      for (const p of ['/api/truth/0', '/api/aar', '/api/scenario']) {
        const r = await fetch(app.base + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'DELETE' ? undefined : JSON.stringify({ status: 'finished' }) });
        assert.ok(r.status >= 400, `${m} ${p}`);
      }
    }
    await sc.write('scenario.json', scen('active'));
    await app.post('/api/outbox', { channel: 'dow', text: 'x', status: 'finished' });
    await fetch(app.base + '/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turn: 0, items: [], status: 'finished' }) });
    assert.equal((await app.get('/api/truth/0')).status, 403);
  });

  test('błędy 404 przy finished nie zdradzają ścieżek poza nazwą pliku', async () => {
    await sc.write('scenario.json', scen('finished'));
    const text = await (await app.get('/api/truth/9')).text();
    assert.ok(!/umpire|[\/]/.test(text), text);
  });

  test('watch: umpire/ niewidoczny, scenario.json widoczny', () => {
    assert.equal(isPlayerVisible('umpire/turns/001.json'), false);
    assert.equal(isPlayerVisible('umpire/aar.md'), false);
    assert.equal(isPlayerVisible('scenario.json'), true);
  });

  test('SSE: zapis w umpire/ nie wysyła zdarzenia, zmiana scenario.json tak', async () => {
    await new Promise((r) => setTimeout(r, 600)); // wygaszenie zdarzeń z poprzednich testów
    const ac = new AbortController();
    const res = await fetch(app.base + '/api/events', { signal: ac.signal });
    const reader = res.body.getReader();
    let seen = '';
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; seen += Buffer.from(value).toString(); } } catch {} })();
    await new Promise((r) => setTimeout(r, 200));
    seen = '';
    await sc.write('umpire/turns/005.json', { x: 1 });
    await sc.write('umpire/log.md', 'wpis');
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(!/event: update/.test(seen), 'zdarzenie po zapisie w umpire/');
    await sc.write('scenario.json', scen('active'));
    await new Promise((r) => setTimeout(r, 900));
    assert.ok(/event: update/.test(seen), 'brak zdarzenia po zmianie scenario.json');
    ac.abort();
  });
});

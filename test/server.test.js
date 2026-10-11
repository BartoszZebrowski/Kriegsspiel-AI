import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeScenario, startApp, SECRET } from './helpers.js';

// Surowe żądanie — fetch normalizuje "..", a chcemy sprawdzić, co dostanie serwer.
function rawGet(base, rawPath) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    http
      .get({ hostname, port, path: rawPath }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });
}

describe('T01 — serwer', () => {
  let app, sc;
  before(async () => {
    sc = await makeScenario();
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('GET / zwraca HTML aplikacji', async () => {
    const res = await app.get('/');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
  });

  test('biblioteki są dostępne pod /vendor/', async () => {
    for (const p of ['/vendor/leaflet/leaflet.js', '/vendor/leaflet/leaflet.css', '/vendor/milsymbol.js', '/vendor/leaflet/images/layers.png']) {
      assert.equal((await app.get(p)).status, 200, p);
    }
  });

  test('nieznany adres zwraca 404', async () => {
    assert.equal((await app.get('/nie-istnieje')).status, 404);
    assert.equal((await app.get('/vendor/leaflet/package.json')).status, 404);
  });

  test('katalog umpire/ jest nieosiągalny', async () => {
    const attempts = [
      '/umpire/turns/000.json',
      '/scenario/umpire/turns/000.json',
      '/../umpire/turns/000.json',
      '/api/../umpire/turns/000.json',
      '/%2e%2e/umpire/turns/000.json',
      '/%2e%2e%2f%2e%2e%2fumpire%2fturns%2f000.json',
      '/..%5cumpire%5cturns%5c000.json',
      '/api/turn/..%2f..%2fumpire%2fturns%2f000',
    ];
    for (const p of attempts) {
      const res = await rawGet(app.base, p);
      assert.notEqual(res.status, 200, p);
      assert.ok(!res.body.includes(SECRET), `wyciek prawdy przez ${p}`);
    }
  });

  test('błędny JSON w pliku daje 500 z komunikatem, serwer działa dalej', async () => {
    await sc.write('player/turns/001.json', '{ zepsute');
    const res = await app.get('/api/turn/1');
    assert.equal(res.status, 500);
    assert.ok((await res.json()).error);
    assert.equal((await app.get('/api/turn/0')).status, 200);
    await sc.write('player/turns/001.json', { turn: 1, time: '2026-05-14T08:00:00+02:00', units: [], contacts: [] });
  });
});

describe('T02 — API scenariusza i tur', () => {
  let app, sc;
  before(async () => {
    sc = await makeScenario();
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('/api/scenario podaje metadane, listę tur i turę bieżącą', async () => {
    const data = await (await app.get('/api/scenario')).json();
    assert.equal(data.scenario.title, 'Test');
    assert.deepEqual(data.turns, [0, 1]);
    assert.equal(data.currentTurn, 1);
  });

  test('/api/turn/1 zwraca plik tury', async () => {
    const data = await (await app.get('/api/turn/1')).json();
    assert.equal(data.turn, 1);
    assert.equal(data.time, '2026-05-14T08:00:00+02:00');
  });

  test('walidacja numeru tury', async () => {
    assert.equal((await app.get('/api/turn/7')).status, 404);
    assert.equal((await app.get('/api/turn/abc')).status, 400);
    assert.equal((await app.get('/api/turn/-1')).status, 400);
    assert.equal((await app.get('/api/turn/1.5')).status, 400);
  });

  test('/api/briefing zwraca odprawę', async () => {
    const res = await app.get('/api/briefing');
    assert.equal(res.status, 200);
    assert.match(await res.text(), /Zadanie: bronić/);
  });
});

describe('T07 — komunikator (API)', () => {
  let app, sc;
  before(async () => {
    sc = await makeScenario();
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('POST tworzy plik outbox bieżącej tury i dopisuje kolejne wiadomości', async () => {
    const r1 = await app.post('/api/outbox', { channel: 'bz15', text: 'Zająć rejon A' });
    assert.equal(r1.status, 201);
    const m1 = await r1.json();
    assert.equal(m1.turn, 1);
    assert.equal(m1.time, '2026-05-14T08:00:00+02:00');
    assert.ok(m1.id && m1.sent);
    await app.post('/api/outbox', { channel: 'dow', text: 'Melduję gotowość' });
    const file = JSON.parse(await fs.readFile(path.join(sc.dir, 'player/outbox/001.json'), 'utf8'));
    assert.equal(file.messages.length, 2);
    assert.equal(file.messages[0].text, 'Zająć rejon A');
  });

  test('walidacja: nieznany kanał, pusta i za długa treść', async () => {
    assert.equal((await app.post('/api/outbox', { channel: 'xyz', text: 'a' })).status, 400);
    assert.equal((await app.post('/api/outbox', { channel: 'dow', text: '   ' })).status, 400);
    assert.equal((await app.post('/api/outbox', { channel: 'dow', text: 'x'.repeat(4001) })).status, 400);
  });

  test('wycofanie: bieżąca tura tak, rozstrzygnięta nie', async () => {
    const m = await (await app.post('/api/outbox', { channel: 'dow', text: 'do wycofania' })).json();
    assert.equal((await app.del('/api/outbox/' + m.id)).status, 200);
    const file = JSON.parse(await fs.readFile(path.join(sc.dir, 'player/outbox/001.json'), 'utf8'));
    assert.ok(!file.messages.some((x) => x.id === m.id));

    await sc.write('player/outbox/000.json', { messages: [{ id: 'old-1', channel: 'dow', turn: 0, time: '2026-05-14T06:00:00+02:00', text: 'stary' }] });
    assert.equal((await app.del('/api/outbox/old-1')).status, 409);
    assert.equal((await app.del('/api/outbox/brak')).status, 404);
  });

  test('/api/messages łączy inbox i outbox, sortuje po czasie', async () => {
    const { messages } = await (await app.get('/api/messages')).json();
    const times = messages.map((m) => Date.parse(m.time));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.equal(messages[0].id, 'in-1');
    assert.equal(messages[0].direction, 'in');
    assert.ok(messages.some((m) => m.direction === 'out'));
  });
});

describe('T08 — odświeżanie na żywo', () => {
  let app, sc;
  before(async () => {
    sc = await makeScenario();
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  async function waitForUpdate(ms, action) {
    const ctrl = new AbortController();
    const res = await fetch(app.base + '/api/events', { signal: ctrl.signal });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    await reader.read(); // "retry:" — strumień gotowy
    const got = (async () => {
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return false;
        buf += decoder.decode(value);
        if (buf.includes('event: update')) return true;
      }
    })().catch(() => false);
    await new Promise((r) => setTimeout(r, 100));
    await action();
    const timeout = new Promise((r) => setTimeout(() => r(false), ms));
    const result = await Promise.race([got, timeout]);
    ctrl.abort();
    return result;
  }

  test('zmiana w player/ wysyła zdarzenie update', async () => {
    const ok = await waitForUpdate(2000, () => sc.write('player/inbox/001.json', { messages: [] }));
    assert.equal(ok, true);
  });

  test('zmiana w umpire/ nie wysyła zdarzenia', async () => {
    const ok = await waitForUpdate(1000, () => sc.write('umpire/turns/001.json', { secret: 1 }));
    assert.equal(ok, false);
  });
});

describe('T12 — szkice gracza (API)', () => {
  let app, sc;
  const put = (body) =>
    fetch(app.base + '/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const areaA = {
    id: 'n-a',
    kind: 'area',
    name: 'Rejon A',
    color: 'blue',
    geometry: { type: 'Polygon', coordinates: [[[22.8, 54.2], [22.9, 54.2], [22.9, 54.3], [22.8, 54.2]]] },
  };
  before(async () => {
    sc = await makeScenario();
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('PUT zapisuje szkice bieżącej tury, GET je zwraca', async () => {
    const res = await put({ turn: 1, items: [areaA] });
    assert.equal(res.status, 200);
    const file = JSON.parse(await fs.readFile(path.join(sc.dir, 'player/notes/001.json'), 'utf8'));
    assert.equal(file.items[0].name, 'Rejon A');
    const got = await (await app.get('/api/notes/1')).json();
    assert.equal(got.items.length, 1);
    assert.equal(got.inheritedFrom, null);
  });

  test('brak szkiców dla tury — przeniesienie z ostatniej wcześniejszej', async () => {
    await sc.write('player/turns/002.json', { turn: 2, time: '2026-05-14T10:00:00+02:00', units: [], contacts: [] });
    const got = await (await app.get('/api/notes/2')).json();
    assert.equal(got.inheritedFrom, 1);
    assert.equal(got.items[0].id, 'n-a');
    const none = await (await app.get('/api/notes/0')).json();
    assert.deepEqual(none.items, []);
  });

  test('PUT w archiwalnej turze — 409, błędne dane — 400', async () => {
    assert.equal((await put({ turn: 1, items: [areaA] })).status, 409);
    assert.equal((await put({ turn: 2, items: [{ ...areaA, kind: 'xyz' }] })).status, 400);
    assert.equal((await put({ turn: 2, items: [{ ...areaA, geometry: { type: 'Point', coordinates: [1, 2] } }] })).status, 400);
    assert.equal((await put({ turn: 2, items: [{ ...areaA, name: 'x'.repeat(61) }] })).status, 400);
    assert.equal((await put({ turn: 2, items: [areaA, areaA] })).status, 400);
  });

  test('wiadomość z załącznikami zapisuje kopię rysunku; nieistniejący — 400', async () => {
    assert.equal((await app.post('/api/outbox', { channel: 'bz15', text: 'Zająć rejon', attachments: ['brak'] })).status, 400);
    const res = await app.post('/api/outbox', { channel: 'bz15', text: 'Zająć Rejon A wg szkicu', attachments: ['n-a'] });
    assert.equal(res.status, 201);
    const msg = await res.json();
    assert.equal(msg.attachments[0].name, 'Rejon A');
    assert.deepEqual(msg.attachments[0].geometry, areaA.geometry);
  });
});

describe('T13 — kanały jednostek (kompanie)', () => {
  let app, sc;
  before(async () => {
    sc = await makeScenario();
    await sc.write('player/turns/001.json', {
      turn: 1,
      time: '2026-05-14T08:00:00+02:00',
      units: [
        { id: 'bz15', name: '15 BZ', sidc: 'SFGPUCIZ---F---', pos: [22.9, 54.1] },
        { id: 'bz15-1k', name: '1k 15bz', sidc: 'SFGPUCIZ---E---', parent: 'bz15', pos: [22.9, 54.12] },
      ],
      contacts: [],
    });
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('POST do kanału kompanii (jednostka z bieżącej tury) daje 201', async () => {
    const res = await app.post('/api/outbox', { channel: 'bz15-1k', text: 'Zająć rejon A' });
    assert.equal(res.status, 201);
    assert.equal((await res.json()).channel, 'bz15-1k');
  });
  test('nieznane id daje 400', async () => {
    assert.equal((await app.post('/api/outbox', { channel: 'bz15-9k', text: 'x' })).status, 400);
  });
});

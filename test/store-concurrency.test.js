import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeScenario, startApp } from './helpers.js';

const outboxFile = (dir) => path.join(dir, 'player', 'outbox', '001.json');
const readOutbox = async (dir) => JSON.parse(await fs.readFile(outboxFile(dir), 'utf8')).messages;

describe('T12.5 — równoległe zapisy nie gubią danych', () => {
  let app, sc;
  before(async () => {
    sc = await makeScenario();
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('20 równoległych POST /api/outbox → 20× 201 i 20 wiadomości na dysku', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => app.post('/api/outbox', { channel: 'dow', text: `rozkaz ${i}` })));
    assert.deepEqual(results.map((r) => r.status), Array(20).fill(201));
    const messages = await readOutbox(sc.dir);
    assert.equal(messages.length, 20);
    assert.equal(new Set(messages.map((m) => m.id)).size, 20);
    assert.deepEqual(new Set(messages.map((m) => m.text)), new Set(Array.from({ length: 20 }, (_, i) => `rozkaz ${i}`)));
    const left = (await fs.readdir(path.dirname(outboxFile(sc.dir)))).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(left, [], 'brak pozostałych plików tymczasowych');
  });

  test('mieszanka równoległych wycofań i wysyłek zostaje spójna', async () => {
    const before = await readOutbox(sc.dir);
    const toWithdraw = before.slice(0, 10).map((m) => m.id);
    const ops = [
      ...toWithdraw.map((id) => app.del('/api/outbox/' + id)),
      ...Array.from({ length: 10 }, (_, i) => app.post('/api/outbox', { channel: 'bz15', text: `nowy ${i}` })),
    ];
    const results = await Promise.all(ops);
    assert.deepEqual(results.map((r) => r.status), [...Array(10).fill(200), ...Array(10).fill(201)]);
    const after = await readOutbox(sc.dir);
    assert.equal(after.length, 20);
    for (const id of toWithdraw) assert.ok(!after.some((m) => m.id === id), id);
    assert.equal(after.filter((m) => m.text.startsWith('nowy ')).length, 10);
  });

  test('równoległe zapisy szkiców i wiadomości nie psują plików', async () => {
    const note = (id) => ({ id, kind: 'point', name: id, geometry: { type: 'Point', coordinates: [22.9, 54.1] } });
    const puts = Array.from({ length: 10 }, (_, i) =>
      fetch(app.base + '/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turn: 1, items: [note('n' + i)] }) }),
    );
    const posts = Array.from({ length: 10 }, (_, i) => app.post('/api/outbox', { channel: 'dow', text: `z ${i}` }));
    const all = await Promise.all([...puts, ...posts]);
    assert.ok(all.every((r) => r.ok));
    const notes = JSON.parse(await fs.readFile(path.join(sc.dir, 'player', 'notes', '001.json'), 'utf8'));
    assert.equal(notes.items.length, 1);
    assert.equal((await readOutbox(sc.dir)).length, 30);
  });
});

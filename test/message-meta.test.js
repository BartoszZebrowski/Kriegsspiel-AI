// T12.7 — rodzaj i priorytet wiadomości: schemat, serwer, walidator.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeScenario, startApp } from './helpers.js';
import { validateScenario } from '../tools/validate.js';
import { MESSAGE_TYPES, MESSAGE_PRIORITIES, PLAYER_MESSAGE_FIELDS, checkMessageMeta, extraFields } from '../shared/schema.js';

describe('Schemat: type i priority', () => {
  test('dozwolone wartości i brak pól = poprawnie', () => {
    assert.deepEqual(MESSAGE_TYPES, ['rozkaz', 'zarzadzenie', 'meldunek', 'wiadomosc']);
    assert.deepEqual(MESSAGE_PRIORITIES, ['normal', 'urgent']);
    assert.equal(checkMessageMeta({}), null);
    assert.equal(checkMessageMeta({ type: 'rozkaz', priority: 'urgent' }), null);
    assert.match(checkMessageMeta({ type: 'rozkazz' }), /Nieznany rodzaj/);
    assert.match(checkMessageMeta({ priority: 'pilne' }), /Nieznany priorytet/);
    assert.deepEqual(extraFields({ id: 'a', type: 'meldunek', priority: 'normal', side: 'PL' }, PLAYER_MESSAGE_FIELDS), ['side']);
  });
});

describe('Serwer: POST /api/outbox z type i priority', () => {
  let sc;
  let app;
  before(async () => {
    sc = await makeScenario({ turns: [0, 1] });
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('zapisuje wybrany rodzaj i priorytet w pliku outbox', async () => {
    const r = await app.post('/api/outbox', { channel: 'dow', text: 'Zająć rejon A', type: 'rozkaz', priority: 'urgent' });
    assert.equal(r.status, 201);
    const m = await r.json();
    assert.equal(m.type, 'rozkaz');
    assert.equal(m.priority, 'urgent');
    const file = JSON.parse(await fs.readFile(path.join(sc.dir, 'player/outbox/001.json'), 'utf8'));
    assert.equal(file.messages.at(-1).type, 'rozkaz');
    assert.equal(file.messages.at(-1).priority, 'urgent');
  });
  test('domyślnie wiadomosc / normal', async () => {
    const m = await (await app.post('/api/outbox', { channel: 'dow', text: 'zwykła' })).json();
    assert.equal(m.type, 'wiadomosc');
    assert.equal(m.priority, 'normal');
  });
  test('nieznany rodzaj lub priorytet → 400', async () => {
    assert.equal((await app.post('/api/outbox', { channel: 'dow', text: 'x', type: 'tajne' })).status, 400);
    assert.equal((await app.post('/api/outbox', { channel: 'dow', text: 'x', priority: 'panika' })).status, 400);
  });
  test('GET /api/messages zwraca type i priority', async () => {
    const { messages } = await (await app.get('/api/messages')).json();
    assert.ok(messages.some((m) => m.direction === 'out' && m.type === 'rozkaz' && m.priority === 'urgent'));
  });
});

describe('Walidator: type i priority w inboxie i outboxie', () => {
  test('poprawne wartości przechodzą, błędne dają błąd', async () => {
    const sc = await makeScenario({ turns: [0] });
    await sc.write('player/inbox/000.json', {
      messages: [{ id: 'in-1', channel: 'dow', from: 'Dowództwo', time: '2026-05-14T05:30:00+02:00', type: 'rozkaz', priority: 'urgent', text: 'ok' }],
    });
    assert.deepEqual((await validateScenario(sc.dir)).errors.filter((e) => /rodzaj|priorytet/i.test(e)), []);
    await sc.write('player/inbox/000.json', {
      messages: [{ id: 'in-1', channel: 'dow', from: 'Dowództwo', time: '2026-05-14T05:30:00+02:00', type: 'rozkazy', priority: 'urgent', text: 'zły' }],
    });
    const errs = (await validateScenario(sc.dir)).errors;
    assert.ok(errs.some((e) => /rodzaj/i.test(e)), errs.join('\n'));
  });
});

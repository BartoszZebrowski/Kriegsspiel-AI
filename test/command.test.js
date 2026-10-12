// T45: pomijanie szczebli dowodzenia — logika (domain/command.js), schemat (checkCommandRules) i blokada na serwerze.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { makeScenario, startApp } from './helpers.js';
import { skipEchelonMode, skippedEchelons, assessSkip, skipMessage } from '../public/js/domain/command.js';
import { checkCommandRules, SKIP_ECHELON_MODES } from '../shared/schema.js';

const UNITS = [
  { id: 'bat', name: 'Batalion', parent: 'hq' },
  { id: 'kmp', name: 'Kompania', parent: 'bat' },
  { id: 'plt', name: 'Pluton', parent: 'kmp' },
  { id: 'sas', name: 'Sąsiad' },
  { id: 'mamry-1b', name: '1 bzmot', formation: 'sas' },
  { id: 'mamry-1k', name: 'Kompania sąsiada', parent: 'mamry-1b' },
];
const sc = (mode) => ({ commandRules: mode ? { skipEchelon: mode } : undefined });

describe('skippedEchelons', () => {
  test('batalion 0, kompania 1, pluton 2 pominięcia', () => {
    assert.equal(skippedEchelons(UNITS, 'bat').count, 0);
    assert.deepEqual(skippedEchelons(UNITS, 'kmp').skipped.map((u) => u.id), ['bat']);
    assert.deepEqual(skippedEchelons(UNITS, 'plt').skipped.map((u) => u.id), ['kmp', 'bat']);
  });
  test('sąsiedzi, formacje, nieznane id i jednostki bez parent = 0', () => {
    for (const id of ['sas', 'mamry-1b', 'mamry-1k', 'nie-ma']) assert.equal(skippedEchelons(UNITS, id).count, 0);
    assert.equal(skippedEchelons(undefined, 'x').count, 0);
  });
});

describe('tryby i assessSkip', () => {
  test('domyślny tryb to soft; nieznany też', () => {
    assert.equal(skipEchelonMode(sc()), 'soft');
    assert.equal(skipEchelonMode(sc('xyz')), 'soft');
    assert.equal(skipEchelonMode(undefined), 'soft');
  });
  test('off: zawsze none', () => {
    assert.equal(assessSkip({ scenario: sc('off'), units: UNITS, channelId: 'plt' }).level, 'none');
  });
  test('soft: warn dla kompanii i plutonu, none dla batalionu', () => {
    const a = (id) => assessSkip({ scenario: sc('soft'), units: UNITS, channelId: id });
    assert.equal(a('bat').level, 'none');
    assert.equal(a('kmp').level, 'warn');
    assert.equal(a('kmp').count, 1);
    assert.equal(a('plt').count, 2);
    assert.match(skipMessage(a('plt')), /pomijasz dowódców Kompania, Batalion/);
  });
  test('hard: block poza urgent, warn z urgent', () => {
    const a = (priority) => assessSkip({ scenario: sc('hard'), units: UNITS, channelId: 'kmp', priority });
    assert.equal(a('normal').level, 'block');
    assert.equal(a(undefined).level, 'block');
    assert.equal(a('urgent').level, 'warn');
    assert.match(skipMessage(a('normal')), /poza łańcuchem dowodzenia/);
    assert.equal(skipMessage({ level: 'none' }), '');
  });
  test('kanały nie-podwładne (przełożony) i kanał scenariusza z polem unit', () => {
    const channels = [
      { id: 'dow', kind: 'superior' },
      { id: 'k-log', kind: 'logistics', unit: 'kmp' },
      { id: 'k-sub', kind: 'subordinate', unit: 'kmp' },
    ];
    const a = (channelId) => assessSkip({ scenario: sc('hard'), units: UNITS, channels, channelId });
    assert.equal(a('dow').level, 'none');
    assert.equal(a('k-log').level, 'none');
    assert.equal(a('k-sub').level, 'block');
  });
});

describe('checkCommandRules', () => {
  test('poprawne i brak sekcji', () => {
    assert.deepEqual(checkCommandRules(undefined), []);
    assert.deepEqual(checkCommandRules({}), []);
    for (const m of SKIP_ECHELON_MODES) assert.deepEqual(checkCommandRules({ skipEchelon: m }), []);
  });
  test('błędy: tryb, nieznane pole, zły typ', () => {
    assert.equal(checkCommandRules({ skipEchelon: 'twardo' }).length, 1);
    assert.equal(checkCommandRules({ foo: 1 }).length, 1);
    assert.equal(checkCommandRules(null).length, 1);
    assert.equal(checkCommandRules([]).length, 1);
    assert.equal(checkCommandRules('hard').length, 1);
  });
});

describe('serwer: POST /api/outbox w trybie hard', () => {
  let app;
  before(async () => {
    const s = await makeScenario({ turns: [0] });
    const file = path.join(s.dir, 'scenario.json');
    const scenario = JSON.parse(await fs.readFile(file, 'utf8'));
    scenario.commandRules = { skipEchelon: 'hard' };
    await fs.writeFile(file, JSON.stringify(scenario));
    await s.write('player/turns/000.json', {
      turn: 0,
      time: '2026-05-14T06:00:00+02:00',
      units: [
        { id: 'bat', name: 'Batalion', sidc: 'SFGPUCIZ---F---', pos: [22, 53], strength: 1, status: 'ok', task: 'obrona', parent: 'hq' },
        { id: 'kmp', name: 'Kompania', sidc: 'SFGPUCIZ---E---', pos: [22, 53], strength: 1, status: 'ok', task: 'obrona', parent: 'bat' },
      ],
      contacts: [],
    });
    app = await startApp(s.dir);
  });
  after(() => app.close());

  test('kompania bez urgent → 403', async () => {
    const r = await app.post('/api/outbox', { channel: 'kmp', text: 'Zająć rejon' });
    assert.equal(r.status, 403);
  });
  test('kompania z urgent → 201', async () => {
    const r = await app.post('/api/outbox', { channel: 'kmp', text: 'Zająć rejon', priority: 'urgent' });
    assert.equal(r.status, 201);
  });
  test('batalion i kanał przełożonego bez urgent → 201', async () => {
    assert.equal((await app.post('/api/outbox', { channel: 'bat', text: 'Zająć rejon' })).status, 201);
    assert.equal((await app.post('/api/outbox', { channel: 'dow', text: 'Melduję' })).status, 201);
  });
});

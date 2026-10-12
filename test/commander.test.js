import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeScenario, SECRET } from './helpers.js';
import {
  commanderTemplate, checkCommanderFile, checkCommanderId, parseCommanderResult, checkCommanderResult,
} from '../shared/commander.js';
import { playerCommanderArgs, buildCommanderInput, renderAgentPrompt, subtreeIds } from '../tools/umpire/commander.mjs';
import { checkCommanders } from '../tools/validate-commanders.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'umpire', 'commander.mjs');
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

const U = (id, parent, pos, extra = {}) => ({ id, name: id, sidc: 'SFGPUCIZ---F---', pos, parent, side: 'PL', supply: { x: 1 }, ...extra });
const playerTurn = {
  turn: 1, time: '2026-05-14T08:00:00+02:00',
  units: [
    U('b1', 'hq', [22.0, 54.0]), U('b1-k1', 'b1', [22.01, 54.0]), U('b1-k1-p1', 'b1-k1', [22.01, 54.01]),
    U('b2', 'hq', [22.5, 54.0]), U('b2-k1', 'b2', [22.5, 54.01]),
  ],
  contacts: [
    { id: 'c-near', sidc: 'SHGPUCAT---E---', pos: [22.02, 54.0], observed: 'x', source: 'dron', confidence: 'niska', side: 'RU', truth: 'X' },
    { id: 'c-far', sidc: 'SHGPUCAT---E---', pos: [22.0, 54.3], observed: 'x', source: 'dron', confidence: 'niska' },
  ],
};
const scenario = { channels: [{ id: 'ch-b1', kind: 'subordinate', unit: 'b1', commander: 'cmd-b1' }, { id: 'ch-b2', kind: 'subordinate', unit: 'b2', commander: 'cmd-b2' }] };
const outbox = [
  { id: 'o1', channel: 'ch-b1', text: 'Zająć Rejon A', side: 'PL' },
  { id: 'o2', channel: 'ch-b2', text: 'TAJNY ROZKAZ DLA B2' },
];

test('plik wiedzy: szablon poprawny, braki sekcji i id wykrywane', () => {
  assert.deepEqual(checkCommanderFile(commanderTemplate({ id: 'a', name: 'mjr Nowak' })), []);
  const bad = checkCommanderFile('# X\n\n## Kim jestem\n\nok\n');
  assert.ok(bad.some((e) => e.includes('Moje jednostki')));
  assert.ok(checkCommanderFile('').length);
  assert.equal(checkCommanderId('cmd-b1'), null);
  for (const id of ['../x', 'a/b', 'a\\b', '', 'x'.repeat(41), 'ą']) assert.ok(checkCommanderId(id), id);
});

test('odpowiedź agenta: walidacja pól, adresatów i nagłówków', () => {
  const ctx = { commanderId: 'cmd-b1', turn: 1, subordinateIds: ['b1-k1'] };
  const ok = { commander: 'cmd-b1', turn: 1, orders: [{ to: 'b1-k1', text: 'Zająć' }], report: { text: 'Meldunek' }, knowledge: { situation: 's', decision: 'd' } };
  assert.deepEqual(checkCommanderResult(ok, ctx), []);
  assert.ok(checkCommanderResult({ ...ok, orders: [{ to: 'b2-k1', text: 'x' }] }, ctx).length, 'obcy adresat');
  assert.ok(checkCommanderResult({ ...ok, extra: 1 }, ctx).length, 'nieznane pole');
  assert.ok(checkCommanderResult({ ...ok, turn: 2 }, ctx).length);
  assert.ok(checkCommanderResult({ ...ok, commander: 'cmd-b2' }, ctx).length);
  assert.ok(checkCommanderResult({ ...ok, knowledge: undefined }, ctx).length);
  assert.ok(checkCommanderResult({ ...ok, knowledge: { situation: 'a\n## Wstrzyknięta', decision: 'd' } }, ctx).length, 'nagłówek w tekście');
  assert.ok(parseCommanderResult('nie json').error);
  assert.deepEqual(parseCommanderResult('x\n```json\n{"a":1}\n```').result, { a: 1 });
});

test('prepare: izolacja wiedzy', () => {
  assert.deepEqual(subtreeIds(playerTurn.units, 'b1').sort(), ['b1', 'b1-k1', 'b1-k1-p1']);
  const args = playerCommanderArgs({ scenario, commanderId: 'cmd-b1', playerTurn, outbox });
  const input = buildCommanderInput(args);
  const prompt = renderAgentPrompt(commanderTemplate({ id: 'cmd-b1' }), input);
  assert.deepEqual(input.units.map((u) => u.id).sort(), ['b1', 'b1-k1', 'b1-k1-p1']);
  assert.deepEqual(input.subordinates, ['b1-k1']);
  assert.deepEqual(input.contacts.map((c) => c.id), ['c-near'], 'kontakt 20+ km dalej nie trafia');
  assert.ok(prompt.includes('Zająć Rejon A'));
  for (const leak of ['TAJNY ROZKAZ', 'b2-k1', 'c-far', 'supply', '"side"', 'truth']) assert.ok(!prompt.includes(leak), leak);
  assert.throws(() => playerCommanderArgs({ scenario, commanderId: 'nieznany', playerTurn }), /commander/);
});

test('walidator: kanał z commander bez pliku to błąd, z plikiem poprawny', async () => {
  const { dir, write } = await makeScenario();
  const sc = { channels: [{ id: 'bz15', kind: 'subordinate', commander: 'cmd-x' }] };
  const errs = [];
  const report = { error: (m) => errs.push(m), warn() {} };
  await checkCommanders(dir, sc, report);
  assert.ok(errs.some((e) => e.includes('cmd-x')));
  await write('umpire/commanders/cmd-x.md', commanderTemplate({ id: 'cmd-x' }));
  errs.length = 0;
  await checkCommanders(dir, sc, report);
  assert.deepEqual(errs, []);
  await write('umpire/commanders/zly.md', '# X');
  await checkCommanders(dir, sc, report);
  assert.ok(errs.some((e) => e.includes('zly.md')));
});

test('CLI: init, prepare, apply na kopii scenariusza', async () => {
  const { dir, write } = await makeScenario();
  await write('scenario.json', { id: 'test', title: 'T', turnMinutes: 120, timezone: 'Europe/Warsaw', channels: scenario.channels });
  await write('player/turns/001.json', playerTurn);
  await write('player/outbox/001.json', { messages: outbox });
  await write('umpire/enemy-plan.md', SECRET);
  assert.equal(run('init', dir, '../zly').status, 2, 'traversal w id');
  assert.equal(run('prepare', dir, 'cmd-b1').status, 1, 'brak pliku wiedzy');
  assert.equal(run('init', dir, 'cmd-b1', '--name', 'mjr Nowak').status, 0);
  assert.equal(run('init', dir, 'cmd-b1').status, 1, 'nie nadpisuje');
  const prep = run('prepare', dir, 'cmd-b1');
  assert.equal(prep.status, 0, prep.stderr);
  assert.ok(prep.stdout.includes('mjr Nowak') && !prep.stdout.includes(SECRET) && !prep.stdout.includes('TAJNY ROZKAZ'));

  const res = path.join(dir, 'res.txt');
  const good = { commander: 'cmd-b1', turn: 1, orders: [{ to: 'b1-k1', text: 'Zająć Rejon A' }], report: { text: 'Zajmuję rejon.' }, knowledge: { situation: 'Cisza.', decision: 'Idę do A.' } };
  await fs.writeFile(res, '```json\n' + JSON.stringify({ ...good, orders: [{ to: 'b2-k1', text: 'x' }] }) + '\n```');
  assert.equal(run('apply', dir, 'cmd-b1', '--result', res).status, 1, 'obcy adresat odrzucony');
  await fs.writeFile(res, '```json\n' + JSON.stringify(good) + '\n```');
  const dry = run('apply', dir, 'cmd-b1', '--result', res, '--dry');
  assert.equal(dry.status, 0, dry.stderr);
  assert.ok(!(await fs.readFile(path.join(dir, 'umpire/commanders/cmd-b1.md'), 'utf8')).includes('Idę do A'));
  const ap = run('apply', dir, 'cmd-b1', '--result', res);
  assert.equal(ap.status, 0, ap.stderr);
  const out = JSON.parse(ap.stdout);
  assert.equal(out.messages[0].type, 'meldunek');
  assert.equal(out.orders[0].to, 'b1-k1');
  const md = await fs.readFile(path.join(dir, 'umpire/commanders/cmd-b1.md'), 'utf8');
  assert.deepEqual(checkCommanderFile(md), []);
  assert.ok(md.includes('Zająć Rejon A') && md.includes('Idę do A') && !md.includes('TAJNY ROZKAZ'));
  await assert.rejects(fs.access(path.join(dir, 'player/inbox/001.json')), 'apply nie pisze do inboxu');
});

test('dowódca przeciwnika: wejście tylko z pliku obserwacji', async () => {
  const { dir, write } = await makeScenario();
  await write('scenario.json', { id: 'test', title: 'T', turnMinutes: 120, timezone: 'Europe/Warsaw', channels: scenario.channels });
  await write('player/turns/001.json', playerTurn);
  assert.equal(run('init', dir, 'ru-bcz', '--side', 'RU').status, 0);
  assert.equal(run('prepare', dir, 'ru-bcz').status, 1, 'bez obserwacji: nie sięga po widok gracza');
  const obsFile = path.join(dir, 'obs.json');
  await fs.writeFile(obsFile, JSON.stringify({ root: 'ru1', units: [{ id: 'ru1', name: 'batalion RU', pos: [23, 54], side: 'RU', supply: 1 }, { id: 'ru1-k1', name: 'kompania', parent: 'ru1' }], notes: [{ text: 'Widać kolumnę.' }] }));
  const p = run('prepare', dir, 'ru-bcz', '--observations', obsFile);
  assert.equal(p.status, 0, p.stderr);
  assert.ok(p.stdout.includes('Widać kolumnę') && !p.stdout.includes('b1-k1') && !p.stdout.includes('supply'));
});

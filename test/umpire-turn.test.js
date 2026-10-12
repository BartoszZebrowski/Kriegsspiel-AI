// Testy narzędzia tury sędziego (tools/umpire/turn.mjs) i limitu czasu Overpass. Tylko katalogi tymczasowe, bez sieci zewnętrznej.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildInbox, buildTurn, nextTime, writeTurn } from '../tools/umpire/turn.mjs';
import { main as pickMain, waterWarnings } from '../tools/umpire/pick.mjs';

const A = [22.9, 54.1];
const B = [22.95, 54.12];

function fixtures() {
  const prevUmpire = {
    turn: 1, time: '2026-05-01T06:00:00+02:00',
    units: [
      { id: 'bn', name: 'Batalion', sidc: 'SFGPUCIZ---F---', pos: A, strength: 1, status: 'ok', task: 't', side: 'PL', supply: { dos: 2 } },
      { id: 'st', name: 'Stoi', sidc: 'SFGPUCIZ---D---', pos: B, strength: 1, status: 'ok', task: 't', side: 'PL', supply: { dos: 2 } },
      { id: 'en', name: 'Wróg', sidc: 'SHGPUCIZ---F---', pos: [23, 54.3], strength: 1, side: 'RU' },
    ],
    assets: [{ id: 'dron', name: 'Dron', type: 'uav', sidc: 'SFAPMFQ--------', pos: A, status: 'gotowy', side: 'PL', endurance_min: 60 }],
    events: [{ text: 'sekret' }],
  };
  const prevPlayer = {
    turn: 1, time: '2026-05-01T06:00:00+02:00',
    units: [
      { id: 'bn', name: 'Batalion', sidc: 'SFGPUCIZ---F---', pos: A, strength: 1, status: 'ok', task: 't' },
      { id: 'st', name: 'Stoi', sidc: 'SFGPUCIZ---D---', pos: B, strength: 1, status: 'ok', task: 't' },
    ],
    contacts: [], assets: [{ id: 'dron', name: 'Dron', type: 'uav', sidc: 'SFAPMFQ--------', status: 'gotowy' }], lines: [],
  };
  return { prevUmpire, prevPlayer };
}

const hasLeak = (o) => /"(side|supply|events|endurance_min)"/.test(JSON.stringify(o));

test('tura bez ruchu nie ma track, czas +turnMinutes ze strefą', () => {
  const { prevUmpire, prevPlayer } = fixtures();
  const r = buildTurn({ prevUmpire, prevPlayer, plan: {}, turnMinutes: 30 });
  assert.equal(r.turn, 2);
  assert.equal(r.time, '2026-05-01T06:30:00+02:00');
  assert.ok(r.player.units.every((u) => u.track === undefined));
  assert.deepEqual(r.moved, []);
});

test('tura z ruchem: track od starej do nowej pozycji, tylko dla ruszonej', () => {
  const { prevUmpire, prevPlayer } = fixtures();
  const mid = [22.92, 54.11];
  const r = buildTurn({ prevUmpire, prevPlayer, plan: { units: { bn: { pos: B, route: [mid] } } }, turnMinutes: 60 });
  const bn = r.player.units.find((u) => u.id === 'bn');
  assert.deepEqual(bn.track, [A, mid, B]);
  assert.deepEqual(bn.pos, B);
  assert.equal(r.player.units.find((u) => u.id === 'st').track, undefined);
  assert.equal(r.umpire.units.find((u) => u.id === 'bn').track, undefined);
  assert.equal(r.umpire.units.find((u) => u.id === 'bn').route, undefined);
});

test('pola sędziego nie trafiają do gracza (units, addUnits, assets, kontakty)', () => {
  const { prevUmpire, prevPlayer } = fixtures();
  const plan = {
    units: { bn: { status: 'marsz' } },
    addUnits: [{ id: 'nowy', name: 'Nowy', sidc: 'SFGPUCIZ---D---', pos: A, side: 'PL', supply: { dos: 1 }, parent: 'bn' }],
    events: [{ text: 'x' }],
    player: {
      addUnits: [{ id: 'sas', name: 'Sąsiad', sidc: 'SFGPUCIZ---F---', pos: B, side: 'PL', supply: { dos: 1 }, events: [] }],
      contacts: { set: [{ id: 'k1', sidc: 'SHGPUCIZ---F---', pos: B, observed: '2026-05-01T06:10:00+02:00', source: 's', confidence: 'niska', side: 'RU', endurance_min: 5 }] },
    },
  };
  const r = buildTurn({ prevUmpire, prevPlayer, plan, turnMinutes: 30 });
  assert.ok(!hasLeak(r.player), JSON.stringify(r.player));
  assert.ok(!hasLeak(r.inbox));
  assert.ok(r.player.units.some((u) => u.id === 'nowy'), 'nowa jednostka PL trafia do widoku gracza (bez pól sędziego)');
  assert.equal(r.umpire.units.find((u) => u.id === 'bn').side, 'PL'); // prawda zostaje po stronie sędziego
  assert.equal(r.umpire.events.length, 1);
});

test('inbox posortowany po czasie (stabilnie), bez pól sędziego', () => {
  const { messages, warnings } = buildInbox([
    { id: 'b', channel: 'bn', from: 'A', time: '2026-05-01T06:20:00+02:00', text: 'drugi', side: 'RU' },
    { id: 'a', channel: 'bn', from: 'A', time: '2026-05-01T06:05:00+02:00', text: 'pierwszy' },
    { id: 'c', channel: 'bn', from: 'A', time: '2026-05-01T06:20:00+02:00', text: 'trzeci' },
  ]);
  assert.deepEqual(messages.map((m) => m.id), ['a', 'b', 'c']);
  assert.ok(messages.every((m) => m.side === undefined));
  assert.ok(warnings.some((w) => /side/.test(w)));
});

test('nextTime zachowuje strefę', () => {
  assert.equal(nextTime('2026-05-01T23:30:00+02:00', 60), '2026-05-02T00:30:00+02:00');
  assert.equal(nextTime('2026-05-01T23:30:00Z', 60), '2026-05-02T00:30:00+00:00');
});

test('writeTurn zapisuje pliki i odmawia nadpisania bez force', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'turn-'));
  try {
    const { prevUmpire, prevPlayer } = fixtures();
    for (const d of ['umpire/turns', 'player/turns', 'player/inbox']) await mkdir(path.join(dir, d), { recursive: true });
    await writeFile(path.join(dir, 'scenario.json'), JSON.stringify({ turnMinutes: 30, side: 'PL' }));
    await writeFile(path.join(dir, 'umpire/turns/001.json'), JSON.stringify(prevUmpire));
    await writeFile(path.join(dir, 'player/turns/001.json'), JSON.stringify(prevPlayer));
    const plan = { units: { bn: { pos: B } }, messages: [{ id: 'in-002-01', channel: 'bn', from: 'X', time: '2026-05-01T06:10:00+02:00', text: 'ok' }], log: 'test' };

    const dry = await writeTurn(dir, plan, { dry: true });
    assert.equal(dry.turn, 2);
    assert.ok(!existsSync(path.join(dir, 'player/turns/002.json')));

    await writeTurn(dir, plan);
    for (const f of ['umpire/turns/002.json', 'player/inbox/002.json', 'player/turns/002.json', 'umpire/log.md']) assert.ok(existsSync(path.join(dir, f)), f);
    const pl = JSON.parse(await readFile(path.join(dir, 'player/turns/002.json'), 'utf8'));
    assert.ok(!hasLeak(pl));
    assert.deepEqual(pl.units.find((u) => u.id === 'bn').track.at(-1), B);

    await assert.rejects(() => writeTurn(dir, plan, { fromTurn: 1 }), /już istnieje/);
    await writeTurn(dir, plan, { fromTurn: 1, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Serwer, który przyjmuje połączenia i milczy — symuluje zawieszony Overpass (bez realnej sieci).
async function silentServer() {
  const sockets = new Set();
  const server = net.createServer((s) => { sockets.add(s); s.on('error', () => {}); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}/api/interpreter`,
    async close() {
      for (const s of sockets) s.destroy();
      await new Promise((r) => server.close(r));
    },
  };
}

test('waterWarnings przy niedostępnym Overpass: OVERPASS_UNAVAILABLE w limicie czasu', async () => {
  const srv = await silentServer();
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'ovp-'));
  const t0 = Date.now();
  try {
    await assert.rejects(
      () => waterWarnings({ u: [22.9, 54.1] }, { timeoutMs: 2000, endpoints: [srv.url], cacheDir, retries: 0 }),
      (err) => err.code === 'OVERPASS_UNAVAILABLE',
    );
    assert.ok(Date.now() - t0 < 30000, `trwało ${Date.now() - t0} ms`);
  } finally {
    await srv.close();
    await rm(cacheDir, { recursive: true, force: true });
  }
});

test('pick --check-water przy niedostępnym Overpass kończy się kodem 0 z ostrzeżeniem „tryb offline”', async () => {
  const srv = await silentServer();
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pick-'));
  const warns = [];
  const origWarn = console.warn;
  const origLog = console.log;
  console.warn = (...a) => warns.push(a.join(' '));
  console.log = () => {};
  const t0 = Date.now();
  try {
    const meta = path.join(dir, 'm.png.json');
    const turn = path.join(dir, 't.json');
    await writeFile(meta, JSON.stringify({ center: [22.9, 54.1], zoom: 13, size: [1200, 900], crs: 'EPSG:3857', tileSize: 256 }));
    await writeFile(turn, JSON.stringify({ turn: 1, units: [{ id: 'u1', pos: A }] }));
    const code = await pickMain(['--meta', meta, '--turn', turn, '--set', 'u1=600,450', '--check-water', '--overpass-timeout', '2'], { endpoints: [srv.url], cacheDir: path.join(dir, 'cache'), retries: 0 });
    assert.equal(code, 0);
    assert.ok(warns.some((w) => /tryb offline/.test(w)), warns.join('\n'));
    assert.ok(Date.now() - t0 < 30000);
  } finally {
    console.warn = origWarn;
    console.log = origLog;
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
});

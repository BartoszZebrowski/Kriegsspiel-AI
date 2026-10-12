// Testy T27 — wojska inżynieryjne: kalkulator, walidator, scalanie w turn.mjs (bez wycieku prawdy).
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkEngineering } from '../shared/engineering.js';
import { PLAYER_FIELDS } from '../shared/schema.js';
import { checkPlayerFields } from '../tools/validate-checks.js';
import { minefieldTime, laneTime, bridgeTime, demolitionTime, progressPercent, progressReport, runCli, parseArgs } from '../tools/umpire/engineer.mjs';
import { buildTurn } from '../tools/umpire/turn.mjs';

const T = '2026-05-01T07:00:00+02:00';
const ring = [[22.9, 54.1], [22.91, 54.1], [22.91, 54.11], [22.9, 54.1]];
const mf = (o = {}) => ({ id: 'ZAPORA-1', kind: 'minefield', owner: 'own', state: 'done', coords: ring, ...o });

test('kalkulator: pole minowe 800 m, kompania saperów (60 ludzi), znana wartość i determinizm', () => {
  const a = minefieldTime({ length_m: 800, rows: 3, personnel: 60 });
  assert.equal(a.minutes, 30 + Math.round((2400 / 360) * 60)); // 30 + 400
  assert.deepEqual(a, minefieldTime({ length_m: 800, rows: 3, personnel: 60 }));
  assert.ok(minefieldTime({ length_m: 800, personnel: 60, night: true }).minutes > a.minutes);
  assert.ok(minefieldTime({ length_m: 800, personnel: 60, under_fire: true }).minutes > a.minutes);
  assert.ok(minefieldTime({ length_m: 800, method: 'mechanical', vehicles: 2 }).minutes < a.minutes);
  assert.throws(() => minefieldTime({ length_m: 800 }), /personnel/);
});

test('kalkulator: most składany 20 m = 45 min przy pełnej obsadzie; mniejsza obsada wydłuża', () => {
  assert.equal(bridgeTime({ span_m: 20, type: 'folding', personnel: 12 }).minutes, 45);
  assert.ok(bridgeTime({ span_m: 20, personnel: 6 }).minutes > 45);
  assert.ok(bridgeTime({ span_m: 100, type: 'pontoon', personnel: 40, current: 'strong' }).minutes > bridgeTime({ span_m: 100, type: 'pontoon', personnel: 40 }).minutes);
  assert.throws(() => bridgeTime({ span_m: 20, type: 'x', personnel: 12 }), /rodzaj/);
});

test('kalkulator: przejście, zniszczenie mostu, postęp, CLI', () => {
  assert.ok(laneTime({ depth_m: 150, personnel: 30 }).minutes > laneTime({ depth_m: 150, method: 'mechanical' }).minutes);
  assert.ok(demolitionTime({ span_m: 25, prepared: true }).minutes < demolitionTime({ span_m: 25 }).minutes);
  assert.equal(demolitionTime({ span_m: 25, full: true }).outcome, 'destroyed');
  assert.equal(progressPercent({ started: '2026-05-01T06:00:00+02:00', now: '2026-05-01T08:00:00+02:00', total_min: 240 }), 50);
  assert.equal(progressPercent({ started: T, now: T, total_min: 60, paused_min: 10 }), 0);
  assert.equal(progressReport('ZAPORA-1', 60), 'ZAPORA-1: 60%');
  assert.equal(runCli('bridge', parseArgs(['--span', '20', '--personnel', '12'])).minutes, 45);
  assert.throws(() => runCli('x', {}));
  assert.throws(() => minefieldTime({ length_m: 100, personnel: 10, terrain: 'moon' }), /teren/);
});

test('walidator: poprawne obiekty przechodzą, zły rodzaj/stan/geometria dają błąd', () => {
  const ok = [mf(), { id: 'M1', kind: 'bridge', owner: 'own', state: 'intact', pos: [22.9, 54.1] }, { id: 'P1', kind: 'lane', owner: 'own', state: 'building', progress: 40, coords: ring.slice(0, 2) }];
  assert.deepEqual(checkEngineering(ok, { player: true, turnTime: T }).errors, []);
  const bad = (o) => checkEngineering([o], { player: true, turnTime: T }).errors.join('|');
  assert.match(bad(mf({ kind: 'bunker' })), /kind/);
  assert.match(bad(mf({ state: 'intact' })), /state/);
  assert.match(bad({ id: 'B', kind: 'bridge', owner: 'own', state: 'done', pos: [22.9, 54.1] }), /state/);
  assert.match(bad(mf({ coords: ring.slice(0, 3) })), /zamkniętego/);
  assert.match(bad(mf({ coords: undefined })), /coords/);
  assert.match(bad({ id: 'B', kind: 'bridge', owner: 'own', state: 'intact' }), /pos/);
  assert.match(bad(mf({ state: 'building', progress: 140 })), /progress/);
  assert.match(bad(mf({ owner: 'RU' })), /owner/);
  assert.match(bad(mf({ owner: 'enemy' })), /observed/);
  assert.match(bad(mf({ owner: 'enemy', observed: '2026-05-01T09:00:00+02:00' })), /późniejszy/);
  assert.match(checkEngineering([mf(), mf()], {}).errors.join(), /zduplikowane/);
});

test('walidator: pole sędziego w engineering pliku gracza → błąd strażnika; w prawdzie dozwolone', () => {
  const errors = [];
  checkPlayerFields('p', { engineering: [mf({ changed_by: 'x', side: 'PL' })] }, { error: (e) => errors.push(e), warn() {} });
  assert.ok(errors.some((e) => e.includes('changed_by')) && errors.some((e) => e.includes('side')));
  assert.deepEqual(checkEngineering([mf({ owner: 'PL', changed_by: 'x', started: T })], { player: false }).errors, []);
  assert.ok(!PLAYER_FIELDS.engineering.includes('side') && !PLAYER_FIELDS.engineering.includes('changed_at'));
});

function fx() {
  const prevUmpire = {
    turn: 1, time: '2026-05-01T06:00:00+02:00',
    units: [{ id: 'bn', name: 'B', sidc: 'SFGPUCIZ---F---', pos: [22.9, 54.1], strength: 1, status: 'ok', task: 't', side: 'PL', supply: { dos: 2 } }],
    engineering: [
      mf({ owner: 'PL', changed_by: 'sap-1', started: '2026-05-01T04:00:00+02:00' }),
      { id: 'ZAPORA-WROG', kind: 'minefield', owner: 'RU', state: 'done', coords: ring, secret: 'TAJNE' },
      { id: 'MOST-RU', kind: 'bridge', owner: 'RU', state: 'intact', pos: [22.95, 54.12] },
      { id: 'MOST-PL', kind: 'bridge', owner: 'PL', state: 'intact', pos: [22.92, 54.11] },
    ],
  };
  const prevPlayer = { turn: 1, time: prevUmpire.time, units: [{ id: 'bn', name: 'B', sidc: 'SFGPUCIZ---F---', pos: [22.9, 54.1], strength: 1, status: 'ok', task: 't' }] };
  return { prevUmpire, prevPlayer };
}

test('turn: własne obiekty z prawdy przechodzą bez pól sędziego, wrogie (prawda) nie wyciekają', () => {
  const { prevUmpire, prevPlayer } = fx();
  const r = buildTurn({ prevUmpire, prevPlayer, plan: {}, turnMinutes: 60 });
  assert.deepEqual(r.player.engineering.map((x) => x.id).sort(), ['MOST-PL', 'ZAPORA-1']);
  const json = JSON.stringify(r.player);
  for (const s of ['ZAPORA-WROG', 'MOST-RU', 'TAJNE', 'changed_by', 'started', '"RU"', '"PL"']) assert.ok(!json.includes(s), s);
  assert.equal(r.player.engineering.find((x) => x.id === 'ZAPORA-1').owner, 'own');
  assert.equal(r.umpire.engineering.length, 4);
});

test('turn: wrogi obiekt dociera do gracza tylko z plan.player.engineering i jest dziedziczony', () => {
  const { prevUmpire, prevPlayer } = fx();
  const enemy = { id: 'KONTAKT-MIN', kind: 'minefield', owner: 'enemy', state: 'done', coords: ring, observed: '2026-05-01T06:30:00+02:00', source: 'dron', confidence: 'średnia', hidden: 'x' };
  const r1 = buildTurn({ prevUmpire, prevPlayer, plan: { player: { engineering: { set: [enemy] } } }, turnMinutes: 60 });
  const e = r1.player.engineering.find((x) => x.id === 'KONTAKT-MIN');
  assert.ok(e && !('hidden' in e));
  const r2 = buildTurn({ prevUmpire: r1.umpire, prevPlayer: r1.player, plan: {}, turnMinutes: 60 });
  assert.ok(r2.player.engineering.some((x) => x.id === 'KONTAKT-MIN'));
  const r3 = buildTurn({ prevUmpire: r2.umpire, prevPlayer: r2.player, plan: { player: { engineering: { remove: ['KONTAKT-MIN'] } } }, turnMinutes: 60 });
  assert.ok(!r3.player.engineering.some((x) => x.id === 'KONTAKT-MIN'));
});

test('turn: stan mostu synchronizowany do logistics.bridges; gracz widzi tylko mosty swojej strony', () => {
  const { prevUmpire, prevPlayer } = fx();
  const bridges = [{ id: 'MOST-PL', name: 'M', pos: [22.92, 54.11], status: 'intact' }, { id: 'MOST-RU', name: 'R', pos: [22.95, 54.12], status: 'intact' }];
  prevUmpire.logistics = { bridges: bridges.map((b) => ({ ...b })) };
  prevPlayer.logistics = { bridges: bridges.map((b) => ({ ...b })) };
  const plan = { engineering: { patch: { 'MOST-PL': { state: 'destroyed' }, 'MOST-RU': { state: 'destroyed' } } } };
  const r = buildTurn({ prevUmpire, prevPlayer, plan, turnMinutes: 60 });
  const st = (l, id) => l.bridges.find((b) => b.id === id).status;
  assert.equal(st(r.umpire.logistics, 'MOST-PL'), 'destroyed');
  assert.equal(st(r.umpire.logistics, 'MOST-RU'), 'destroyed');
  assert.equal(st(r.player.logistics, 'MOST-PL'), 'destroyed');
  assert.equal(st(r.player.logistics, 'MOST-RU'), 'intact');
});

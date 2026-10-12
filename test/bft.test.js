// T49: pozycje własnych sił z BFT — walidator pos_time, funkcje domeny i zamrożenie pozycji w turn.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkPosTime } from '../shared/schema.js';
import { posAgeMin, isPosStale, posOpacity, bftStatus, BFT_STALE_MIN, BFT_STALE_OPACITY } from '../public/js/domain/bft.js';
import { buildTurn } from '../tools/umpire/turn.mjs';

const T = '2026-05-01T07:00:00+02:00';

test('checkPosTime: późniejszy → błąd, poza okresem → uwaga, w okresie → OK', () => {
  assert.ok(checkPosTime('2026-05-01T07:10:00+02:00', T, 30).error);
  assert.ok(checkPosTime('2026-05-01T06:00:00+02:00', T, 30).warn);
  assert.deepEqual(checkPosTime('2026-05-01T06:45:00+02:00', T, 30), {});
  assert.deepEqual(checkPosTime(T, T, 30), {});
  assert.ok(checkPosTime('nie-czas', T, 30).error);
});

test('domena: brak pos_time = świeża; wiek i próg', () => {
  assert.equal(posAgeMin({}, T), 0);
  assert.equal(isPosStale({}, T), false);
  const old = { pos_time: '2026-05-01T06:00:00+02:00' };
  assert.equal(posAgeMin(old, T), 60);
  assert.equal(isPosStale(old, T), true);
  assert.equal(posOpacity(old, T), BFT_STALE_OPACITY);
  const edge = { pos_time: '2026-05-01T06:30:00+02:00' }; // równo próg: jeszcze świeża
  assert.equal(posAgeMin(edge, T), BFT_STALE_MIN);
  assert.equal(isPosStale(edge, T), false);
  assert.equal(posOpacity(edge, T), 1);
  const st = bftStatus(old, T, 'Europe/Warsaw');
  assert.ok(st.stale && st.text.startsWith('pozycja z '));
  assert.equal(bftStatus({}, T).text, '');
});

const A = [22.9, 54.1];
const TRUE_B = [22.95, 54.12];
function fixtures() {
  const prevUmpire = { turn: 1, time: '2026-05-01T06:00:00+02:00', units: [{ id: 'bn', name: 'Batalion', sidc: 'SFGPUCIZ---F---', pos: A, strength: 1, status: 'ok', task: 't', side: 'PL', supply: { dos: 2 } }] };
  const prevPlayer = { turn: 1, time: '2026-05-01T06:00:00+02:00', units: [{ id: 'bn', name: 'Batalion', sidc: 'SFGPUCIZ---F---', pos: A, strength: 1, status: 'ok', task: 't' }] };
  return { prevUmpire, prevPlayer };
}

test('turn.mjs: zamrożona pozycja gracza przy innej prawdzie, bez wycieku', () => {
  const { prevUmpire, prevPlayer } = fixtures();
  const frozen = '2026-05-01T06:00:00+02:00';
  const plan = { units: { bn: { pos: TRUE_B, route: [[22.92, 54.11]] } }, player: { units: { bn: { pos: A, pos_time: frozen } } } };
  const r = buildTurn({ prevUmpire, prevPlayer, plan, turnMinutes: 60 });
  const pu = r.player.units[0];
  assert.deepEqual(pu.pos, A);
  assert.equal(pu.pos_time, frozen);
  assert.deepEqual(r.umpire.units[0].pos, TRUE_B); // prawda zostaje u sędziego
  assert.ok(!JSON.stringify(r.player).includes(String(TRUE_B[0])), 'prawdziwa pozycja nie może być w widoku gracza');
  assert.equal(pu.track, undefined); // pozycja gracza się nie ruszyła
  assert.equal(r.umpire.units[0].pos_time, undefined);
});

test('turn.mjs: track kończy się na pozycji BFT (nie na prawdzie)', () => {
  const { prevUmpire, prevPlayer } = fixtures();
  const bft = [22.92, 54.11];
  const plan = { units: { bn: { pos: TRUE_B } }, player: { units: { bn: { pos: bft, pos_time: '2026-05-01T06:30:00+02:00' } } } };
  const r = buildTurn({ prevUmpire, prevPlayer, plan, turnMinutes: 60 });
  const pu = r.player.units[0];
  assert.deepEqual(pu.track[0], A);
  assert.deepEqual(pu.track.at(-1), bft);
  assert.ok(!JSON.stringify(r.player).includes(String(TRUE_B[0])));
});

test('turn.mjs: bez łatki pos = prawda, pos_time nie jest dziedziczone; pos_time = czas tury znika', () => {
  const { prevUmpire, prevPlayer } = fixtures();
  prevPlayer.units[0].pos_time = '2026-05-01T05:00:00+02:00';
  const r = buildTurn({ prevUmpire, prevPlayer, plan: { units: { bn: { pos: TRUE_B } } }, turnMinutes: 60 });
  assert.deepEqual(r.player.units[0].pos, TRUE_B);
  assert.equal(r.player.units[0].pos_time, undefined);
  const r2 = buildTurn({ prevUmpire, prevPlayer, plan: { player: { units: { bn: { pos_time: '2026-05-01T07:00:00+02:00' } } } }, turnMinutes: 60 });
  assert.equal(r2.player.units[0].pos_time, undefined);
});

test('turn.mjs: pos_time późniejszy niż tura → ostrzeżenie', () => {
  const { prevUmpire, prevPlayer } = fixtures();
  const r = buildTurn({ prevUmpire, prevPlayer, plan: { player: { units: { bn: { pos_time: '2026-05-01T09:00:00+02:00' } } } }, turnMinutes: 60 });
  assert.ok(r.warnings.some((w) => /pos_time późniejszy/.test(w)));
});

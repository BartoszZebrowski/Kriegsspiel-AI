// Testy T25/T26: strefy REW, kontakty-nadajniki, doręczenia, strażnik wycieku, turn.mjs, domain/ewzones.js.
import assert from 'node:assert/strict';
import test from 'node:test';
import { checkEwZone, checkEmitterContact, checkDeliveries, checkEw } from '../shared/ew.js';
import { buildTurn } from '../tools/umpire/turn.mjs';
import { validateScenario } from '../tools/validate.js';
import { ewZones, ewZoneLabel } from '../public/js/domain/ewzones.js';
import { makeScenario } from './helpers.js';

const T = '2026-05-01T08:00:00+02:00';
const RING = [[22.9, 54.1], [22.95, 54.1], [22.95, 54.15], [22.9, 54.1]];
const zone = (o = {}) => ({ id: 'z1', kind: 'ew_zone', label: 'Zagłuszanie', coords: RING, observed: '2026-05-01T06:40:00+02:00', ...o });

test('ew_zone: zamknięty wielokąt przyjęty, zła geometria i brak pól to błędy', () => {
  assert.deepEqual(checkEwZone(zone(), T), []);
  assert.ok(checkEwZone(zone({ coords: RING.slice(0, 3) }), T).length);
  assert.ok(checkEwZone(zone({ coords: [...RING.slice(0, 3), [22.0, 54.0]] }), T).some((e) => /niezamknięty/.test(e)));
  assert.ok(checkEwZone(zone({ observed: undefined }), T).length);
  assert.ok(checkEwZone(zone({ observed: '2026-05-01T09:00:00+02:00' }), T).some((e) => /późniejszy/.test(e)));
  assert.deepEqual(checkEwZone({ kind: 'flot' }, T), []);
});

test('kontakt-nadajnik wymaga statusu A', () => {
  assert.equal(checkEmitterContact({ sidc: 'SHGAUUMSEI-----' }), null);
  assert.ok(checkEmitterContact({ sidc: 'SHGPUUMSEI-----' }));
  assert.equal(checkEmitterContact({ sidc: 'SHGPUCIZ---F---' }), null);
});

test('checkDeliveries: lost z delivered, delivered < sent, poprawne', () => {
  const ok = { msg_id: 'o1', to: 'bn', sent: '2026-05-01T06:00:00+02:00', delivered: '2026-05-01T06:10:00+02:00', means: 'radio' };
  assert.deepEqual(checkDeliveries([ok]).errors, []);
  assert.deepEqual(checkDeliveries([{ ...ok, means: 'lost', delivered: null }]).errors, []);
  assert.ok(checkDeliveries([{ ...ok, means: 'lost' }]).errors.length);
  assert.ok(checkDeliveries([{ ...ok, delivered: '2026-05-01T05:00:00+02:00' }]).errors.some((e) => /wcześniejsze/.test(e)));
  assert.ok(checkDeliveries([{ ...ok, means: 'pigeon' }]).errors.length);
  assert.ok(checkDeliveries({}).errors.length);
});

test('checkEw: strefy sędziego', () => {
  assert.deepEqual(checkEw({ zones: [{ id: 'a', kind: 'jamming', owner: 'RU', coords: RING }] }), []);
  assert.ok(checkEw({ zones: [{ id: 'a', kind: 'x', owner: 'RU', coords: RING }] }).length);
});

test('turn.mjs: deliveries i ew trafiają tylko do umpire', () => {
  const prevUmpire = { turn: 1, time: '2026-05-01T06:00:00+02:00', units: [{ id: 'bn', name: 'B', sidc: 'SFGPUCIZ---F---', pos: [22.9, 54.1], strength: 1, status: 'ok', task: 't', side: 'PL', supply: { dos: 2 } }], assets: [] };
  const prevPlayer = { turn: 1, time: prevUmpire.time, units: [{ id: 'bn', name: 'B', sidc: 'SFGPUCIZ---F---', pos: [22.9, 54.1], strength: 1, status: 'ok', task: 't' }], contacts: [], assets: [], lines: [] };
  const deliveries = [{ msg_id: 'o1', to: 'bn', sent: prevUmpire.time, delivered: '2026-05-01T06:30:00+02:00', means: 'courier' }];
  const plan = { deliveries, ew: { zones: { set: [{ id: 'z1', kind: 'jamming', owner: 'RU', coords: RING }] } }, player: { lines: { set: [zone()] } } };
  const r = buildTurn({ prevUmpire, prevPlayer, plan, turnMinutes: 120 });
  assert.deepEqual(r.umpire.deliveries, deliveries);
  assert.equal(r.umpire.ew.zones[0].id, 'z1');
  assert.ok(!('deliveries' in r.player) && !('ew' in r.player));
  assert.equal(r.player.lines[0].observed, zone().observed);
  const next = buildTurn({ prevUmpire: r.umpire, prevPlayer: r.player, plan: {}, turnMinutes: 120 });
  assert.equal(next.umpire.deliveries, undefined);
  assert.equal(next.umpire.ew.zones.length, 1);
});

test('walidator: deliveries/ew w pliku gracza to błąd (strażnik wycieku)', async () => {
  const { dir, write } = await makeScenario({ turns: [0] });
  await write('player/turns/000.json', { turn: 0, time: '2026-05-14T06:00:00+02:00', units: [], contacts: [], deliveries: [], ew: { zones: [] } });
  const r = await validateScenario(dir);
  assert.ok(r.errors.some((e) => /deliveries/.test(e)), r.errors.join('\n'));
  assert.ok(r.errors.some((e) => /„ew”/.test(e)));
});

test('domain/ewzones: wybór stref, etykieta z wiekiem', () => {
  const zs = ewZones([zone(), { id: 'f', kind: 'flot', coords: RING }], T);
  assert.equal(zs.length, 1);
  assert.match(ewZoneLabel(zs[0]), /^Zagłuszanie · meldunek .+/);
  assert.equal(ewZoneLabel(ewZones([zone({ observed: undefined, label: '' })], T)[0]), 'strefa zagłuszenia (REW)');
});

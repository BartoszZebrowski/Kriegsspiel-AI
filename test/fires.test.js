import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkMessageFire } from '../shared/fire.js';
import { fireTasks, canTransition } from '../public/js/domain/fires.js';
import { validateScenario } from '../tools/validate.js';
import { makeScenario } from './helpers.js';

const T = '2026-05-14T06:20:00+02:00';
const out = { id: 'out-1', direction: 'out', channel: 'dow', time: '2026-05-14T06:00:00+02:00', form: { kind: 'fire', fields: { target: { type: 'Point', coordinates: [22, 53] } } } };
const rep = (status, time, extra = {}) => ({ id: 'in-' + status, direction: 'in', time, fire: { request_id: 'out-1', status, time, ...extra } });

describe('T52 — zgłoszenia ognia', () => {
  test('cykl statusów', () => {
    assert.ok(canTransition('sent', 'accepted') && canTransition('accepted', 'done') && canTransition('sent', 'refused'));
    assert.ok(!canTransition('refused', 'done') && !canTransition('done', 'accepted'));
    assert.equal(fireTasks([out])[0].status, 'sent');
    const t = fireTasks([out, rep('accepted', T), rep('done', '2026-05-14T06:30:00+02:00', { rounds: 12 })])[0];
    assert.equal(t.status, 'done');
    assert.equal(t.rounds, 12);
    assert.equal(fireTasks([out, rep('refused', T, { reason: 'brak amunicji' }), rep('done', '2026-05-14T06:30:00+02:00')])[0].status, 'refused');
  });

  test('checkMessageFire', () => {
    const f = (fire) => checkMessageFire({ fire });
    assert.equal(f(undefined), null);
    assert.equal(f({ request_id: 'out-1', status: 'accepted', time: T }), null);
    assert.ok(f({ request_id: 'out-1', status: 'refused', time: T }), 'odmowa bez reason');
    assert.equal(f({ request_id: 'out-1', status: 'refused', time: T, reason: 'zajęte' }), null);
    assert.ok(f({ request_id: 'out-1', status: 'done', time: T, effect: 'zniszczono 3' }), 'nieznane pole');
    assert.ok(f({ request_id: 'out-1', status: 'accepted', time: T, rounds: 3 }));
  });

  test('walidator: fire w outbox = błąd, request_id bez zgłoszenia = uwaga', async () => {
    let s = await makeScenario();
    await s.write('player/outbox/000.json', { messages: [{ id: 'm-1', channel: 'dow', time: T, text: 'x', fire: { request_id: 'a', status: 'accepted', time: T } }] });
    let r = await validateScenario(s.dir);
    assert.ok((r.errors ?? []).some((e) => e.includes('fire')), JSON.stringify(r.errors));
    s = await makeScenario();
    await s.write('player/inbox/000.json', { messages: [{ id: 'm-2', channel: 'dow', from: 'dca', time: T, text: 'Przyjęto.', fire: { request_id: 'brak', status: 'accepted', time: T } }] });
    r = await validateScenario(s.dir);
    assert.ok(!(r.errors ?? []).some((e) => e.includes('fire')), JSON.stringify(r.errors));
    assert.ok((r.warnings ?? r.warns ?? []).some((e) => e.includes('request_id')), JSON.stringify(r));
  });
});

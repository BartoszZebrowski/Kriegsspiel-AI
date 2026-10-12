import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkOverlay } from '../shared/overlay.js';
import { overlaysOf, overlayNotes } from '../public/js/domain/overlays.js';
import { validateScenario } from '../tools/validate.js';
import { makeScenario } from './helpers.js';

const feat = (id, extra = {}) => ({ id, kind: 'line', name: 'Granica', color: 'blue', geometry: { type: 'LineString', coordinates: [[22, 53], [22.1, 53.1]] }, ...extra });
const ov = (extra = {}) => ({ id: 'ov-1', name: 'Granice', features: [feat('f1')], ...extra });
const msg = (id, overlay, time, turn = 0) => ({ id, direction: 'in', time, turn, from: 'dca', channel: 'dow', overlay });

describe('T51 — nakładki', () => {
  test('checkOverlay: poprawna, nieznany znak, obce pole, duplikat id', () => {
    assert.equal(checkOverlay(ov()), null);
    assert.ok(checkOverlay(ov({ features: [feat('f1', { graphic: 'nie-ma-takiego' })] })));
    assert.ok(checkOverlay(ov({ x: 1 })));
    assert.ok(checkOverlay(ov({ features: [feat('f1'), feat('f1')] })));
    assert.ok(checkOverlay(ov({ features: [] })));
  });

  test('overlaysOf: nowsza o tym samym id zastępuje starszą', () => {
    const r = overlaysOf([
      msg('a', ov({ name: 'v1' }), '2026-05-14T06:00:00+02:00'),
      msg('b', ov({ name: 'v2' }), '2026-05-14T07:00:00+02:00'),
      msg('c', ov({ id: 'ov-2', name: 'inna' }), '2026-05-14T06:30:00+02:00'),
    ]);
    assert.equal(r.length, 2);
    assert.equal(r.find((o) => o.id === 'ov-1').name, 'v2');
    assert.equal(r[0].id, 'ov-1');
  });

  test('overlayNotes: nowe unikalne id, limit', () => {
    const r = overlayNotes(ov(), [{ id: 'ov-1-1' }]);
    assert.equal(r.notes.length, 1);
    assert.notEqual(r.notes[0].id, 'ov-1-1');
    assert.ok(overlayNotes(ov(), new Array(500).fill({ id: 'x' }), 500).error);
  });

  test('walidator: overlay z nieznanym znakiem i overlay w outbox = błąd', async () => {
    for (const [kind, o] of [['inbox', ov({ features: [feat('f1', { graphic: 'zly' })] })], ['outbox', ov()]]) {
      const { dir, write } = await makeScenario();
      const m = { id: 'm-1', channel: 'dow', from: 'dca', time: '2026-05-14T05:40:00+02:00', text: 'x', overlay: o };
      await write(`player/${kind}/${kind === 'inbox' ? '000' : '000'}.json`, { messages: [m] });
      const rep = await validateScenario(dir);
      assert.ok((rep.errors ?? []).some((e) => e.includes('overlay')), `${kind}: ${JSON.stringify(rep.errors)}`);
    }
  });
});

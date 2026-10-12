// T44 — rozkaz graficzny: logika domeny, zgodność z shared/order.js, walidator scenariusza i API serwera.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORDER_TASKS as SERVER_TASKS, checkOrderAttachment, MAX_ORDER_UNITS } from '../shared/order.js';
import {
  ORDER_TASKS, ORDER_KINDS, kindOfGeometry, orderGraphic, selectableUnits, unitsInBounds, toggleUnit, mergeUnits,
  geometryFromPoints, deliveryGroups, buildOrderAttachments, addDraftOrders, removeDraftOrder, allDraftOrders,
} from '../public/js/domain/order.js';
import { mergeChannels } from '../public/js/domain/orbat.js';
import { validateScenario } from '../tools/validate.js';
import { makeScenario, startApp } from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SCENARIO = path.join(ROOT, 'scenarios', '00-test-przesmyk');

async function trimToTurnZero(dir) {
  for (const sub of ['player/turns', 'player/inbox', 'player/outbox', 'player/notes', 'umpire/turns']) {
    let names = [];
    try {
      names = await fs.readdir(path.join(dir, sub));
    } catch {
      continue;
    }
    for (const n of names) if (/^\d{3}\.json$/.test(n) && n !== '000.json') await fs.rm(path.join(dir, sub, n), { force: true });
  }
}

const u = (id, parent, pos = [22.5, 54.1], extra = {}) => ({ id, name: id, parent, pos, ...extra });
const UNITS = [
  { id: 'hq', name: 'hq', pos: [22.5, 54.1] },
  u('A', 'hq'), u('A1', 'A'), u('A2', 'A', [22.6, 54.2]), u('B', 'hq'), u('B1', 'B'),
  { id: 'dd', name: 'dd', pos: [22.0, 54.0] },
  { id: 'zt', name: 'zt', pos: [21.0, 54.0] },
  { id: 'zt-1', name: 'zt-1', formation: 'zt', pos: [21.0, 54.1] },
];
const SCEN_CH = [
  { id: 'dd', name: 'dd', kind: 'superior' },
  { id: 'zt', name: 'zt', kind: 'neighbor' },
  { id: 'A', name: 'A', kind: 'subordinate' },
  { id: 'B', name: 'B', kind: 'subordinate' },
];
const CH = mergeChannels(SCEN_CH, UNITS);

describe('T44 — domena rozkazu graficznego', () => {
  test('ORDER_TASKS klienta zgodne z shared/order.js (zadania i typy geometrii)', () => {
    assert.deepEqual(ORDER_TASKS.map((t) => t.id).sort(), Object.keys(SERVER_TASKS).sort());
    for (const t of ORDER_TASKS) {
      const types = new Set(t.kinds.map((k) => ORDER_KINDS[k].type));
      assert.deepEqual([...types].sort(), [...SERVER_TASKS[t.id]].sort(), t.id);
      assert.deepEqual(Object.keys(t.glyph).sort(), [...t.kinds].sort(), `${t.id}: glify`);
    }
  });

  test('zaznaczenie + punkt/rubież → poprawny załącznik przyjmowany przez serwer', () => {
    const pts = selectableUnits(UNITS, CH);
    assert.deepEqual(pts.map((x) => x.id).sort(), ['A', 'A1', 'A2', 'B', 'B1', 'hq']);
    let sel = toggleUnit([], 'A1');
    sel = toggleUnit(sel, 'B1', { toggle: true });
    assert.deepEqual(sel, ['A1', 'B1']);
    assert.deepEqual(toggleUnit(sel, 'B1', { toggle: true }), ['A1']);
    assert.deepEqual(toggleUnit(sel, 'A'), ['A']);
    assert.deepEqual(mergeUnits(['A'], ['A', 'B']), ['A', 'B']);
    let n = 0;
    const newId = () => `o${++n}`;
    for (const [task, kind, points] of [
      ['move', 'point', [[22.5, 54.1]]],
      ['defend', 'line', [[22.5, 54.1], [22.6, 54.1]]],
      ['occupy', 'area', [[22.5, 54.1], [22.6, 54.1], [22.6, 54.2]]],
    ]) {
      const { geometry, error } = geometryFromPoints(kind, points);
      assert.ok(geometry, error);
      const { items } = buildOrderAttachments({ units: sel, task, geometry }, { units: UNITS, channels: CH, newId });
      assert.equal(items.length, 2);
      for (const it of items) {
        const r = checkOrderAttachment(it.attachment, UNITS.map((x) => x.id));
        assert.ok(!r.error, r.error);
        assert.equal(it.attachment.kind, 'order');
      }
    }
  });

  test('geometryFromPoints: za mało punktów, domknięcie pierścienia, duplikaty', () => {
    assert.ok(geometryFromPoints('line', [[1, 1]]).error);
    assert.ok(geometryFromPoints('area', [[1, 1], [2, 2]]).error);
    assert.ok(geometryFromPoints('xyz', []).error);
    const ring = geometryFromPoints('area', [[1, 1], [2, 1], [2, 2]]).geometry.coordinates[0];
    assert.equal(ring.length, 4);
    assert.deepEqual(ring[0], ring[3]);
    assert.ok(geometryFromPoints('line', [[1, 1], [1, 1]]).error);
  });

  test('kindOfGeometry i orderGraphic', () => {
    assert.equal(kindOfGeometry('defend', 'LineString'), 'line');
    assert.equal(kindOfGeometry('move', 'LineString'), 'route');
    assert.ok(orderGraphic('attack', 'Polygon'));
    assert.equal(orderGraphic('nic', 'Point'), null);
  });

  test('unitsInBounds', () => {
    const c = selectableUnits(UNITS, CH);
    assert.deepEqual(unitsInBounds(c, { west: 22.55, south: 54.15, east: 22.7, north: 54.3 }), ['A2']);
  });

  test('deliveryGroups: own — każda do własnego kanału, sąsiedzi i przełożony pomijani', () => {
    const r = deliveryGroups(['A1', 'B1', 'zt-1', 'zt', 'dd', 'hq'], UNITS, CH, 'own');
    assert.deepEqual(r.groups.map((g) => [g.channelId, g.unitIds]), [['A1', ['A1']], ['B1', ['B1']]]);
    assert.deepEqual(r.skipped.sort(), ['dd', 'hq', 'zt', 'zt-1']);
  });

  test('deliveryGroups: common — wspólny przełożony, a bez jego kanału jak own', () => {
    const same = deliveryGroups(['A1', 'A2'], UNITS, CH, 'common');
    assert.deepEqual(same.groups, [{ channelId: 'A', unitIds: ['A1', 'A2'] }]);
    const mixed = deliveryGroups(['A1', 'B1'], UNITS, CH, 'common'); // wspólny: hq, bez kanału podwładnego
    assert.equal(mixed.groups.length, 2);
    const withParent = deliveryGroups(['A', 'A1'], UNITS, CH, 'common');
    assert.deepEqual(withParent.groups, [{ channelId: 'A', unitIds: ['A', 'A1'] }]);
    const single = deliveryGroups(['A1'], UNITS, CH, 'common');
    assert.deepEqual(single.groups, [{ channelId: 'A1', unitIds: ['A1'] }]);
  });

  test('szkice: dodawanie, deduplikacja, usuwanie, allDraftOrders', () => {
    const a = { id: 'o1', kind: 'order' };
    let d = addDraftOrders({}, 'A', [a]);
    d = addDraftOrders(d, 'A', [a, { id: 'o2' }]);
    assert.equal(d.A.orders.length, 2);
    assert.deepEqual(allDraftOrders(d).map((x) => x.order.id), ['o1', 'o2']);
    d = removeDraftOrder(d, 'A', 'o1');
    assert.deepEqual(d.A.orders.map((x) => x.id), ['o2']);
  });
});

describe('T44 — checkOrderAttachment', () => {
  const good = { id: 'o-1', kind: 'order', name: 'Marsz', units: ['A'], task: 'move', geometry: { type: 'Point', coordinates: [22, 54] } };
  const bad = (patch) => checkOrderAttachment({ ...good, ...patch }, ['A']).error;
  test('poprawny i błędne warianty', () => {
    assert.ok(!bad({}));
    assert.ok(bad({ task: 'fly' }));
    assert.ok(bad({ task: 'toString' }));
    assert.ok(bad({ task: 'occupy' })); // Point nie dla occupy
    assert.ok(bad({ units: [] }));
    assert.ok(bad({ units: ['A', 'A'] }));
    assert.ok(bad({ units: ['X'] }));
    assert.ok(bad({ units: Array.from({ length: MAX_ORDER_UNITS + 1 }, (_, i) => `u${i}`) }));
    assert.ok(bad({ name: '' }));
    assert.ok(bad({ id: 'a b' }));
    assert.ok(bad({ geometry: { type: 'Point', coordinates: [999, 54] } }));
    assert.ok(bad({ task: 'defend', geometry: { type: 'LineString', coordinates: [[1, 1]] } }));
  });
  test('wynik nie zawiera pól spoza schematu', () => {
    const r = checkOrderAttachment({ ...good, side: 'RU', extra: 1 }, ['A']);
    assert.deepEqual(Object.keys(r.order).sort(), ['geometry', 'id', 'kind', 'name', 'task', 'units']);
  });
});

describe('T44 — walidator scenariusza przyjmuje załącznik rozkazu', () => {
  async function scenarioWith(attachments) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-ord-'));
    await fs.cp(TEST_SCENARIO, dir, { recursive: true });
    await trimToTurnZero(dir);
    await fs.writeFile(
      path.join(dir, 'player/outbox/000.json'),
      JSON.stringify({ messages: [{ id: 'out-000-01', channel: '1bzmot', time: '2026-05-14T06:10:00+02:00', priority: 'normal', text: 'Zadanie wg znaku', attachments }] }),
    );
    return validateScenario(dir);
  }
  const att = (patch = {}) => ({ id: 'o-1', kind: 'order', name: 'Marsz do', units: ['1bzmot'], task: 'move', geometry: { type: 'Point', coordinates: [22.5, 54.1] }, ...patch });
  test('poprawny', async () => {
    const { errors } = await scenarioWith([att()]);
    assert.deepEqual(errors, []);
  });
  test('zły (nieznana jednostka, zła geometria dla zadania)', async () => {
    assert.ok((await scenarioWith([att({ units: ['nie-ma'] })])).errors.some((e) => e.includes('rozkaz graficzny')));
    assert.ok((await scenarioWith([att({ task: 'occupy' })])).errors.some((e) => e.includes('rozkaz graficzny')));
  });
});

describe('T44 — API: POST /api/outbox z orders', () => {
  let app;
  const order = (patch = {}) => ({ id: 'o-1', kind: 'order', name: 'Marsz do', units: ['u1'], task: 'move', geometry: { type: 'Point', coordinates: [22.5, 54.1] }, ...patch });
  const post = (orders) => app.post('/api/outbox', { channel: 'bz15', text: 'Wg znaku', orders });
  before(async () => {
    const sc = await makeScenario();
    await sc.write('player/turns/001.json', {
      turn: 1,
      time: '2026-05-14T08:00:00+02:00',
      units: [
        { id: 'u1', name: 'u1', sidc: 'SFGPUCIZ---F---', pos: [22.5, 54.1], parent: 'hq' },
        { id: 'zt', name: 'zt', sidc: 'SFGPUCIZ---F---', pos: [21, 54] },
        { id: 'zt-1', name: 'zt-1', sidc: 'SFGPUCIZ---F---', formation: 'zt', pos: [21, 54.1] },
      ],
      contacts: [],
    });
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('poprawny rozkaz zapisany jako załącznik', async () => {
    const res = await post([order()]);
    assert.equal(res.status, 201);
    const m = await res.json();
    assert.equal(m.attachments[0].kind, 'order');
    assert.deepEqual(m.attachments[0].units, ['u1']);
  });
  test('odrzuca: nieznana jednostka, sąsiad, zły typ, zła geometria, nie-tablica, limit, duplikaty', async () => {
    for (const orders of [
      [order({ units: ['nie-ma'] })],
      [order({ units: ['zt-1'] })],
      [order({ task: 'occupy' })],
      [order({ geometry: { type: 'Point', coordinates: ['a', 'b'] } })],
      [order({ units: 5 })],
      'tekst',
      { id: 'o' },
      Array.from({ length: 21 }, (_, i) => order({ id: `o-${i}` })),
      [order(), order()],
    ]) {
      assert.equal((await post(orders)).status, 400, JSON.stringify(orders).slice(0, 80));
    }
  });
});

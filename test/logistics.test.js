// T17 [A] — warstwa logistyczna po stronie klienta: model karty, wiek danych, elementy tury, animacja konwoju, findEntity.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { logisticsElements, findLogisticsItem, logisticsPos, dataAge, logisticsCard, logisticsCardHtml, statusInfo, routeColor, ROUTE_COLORS } from '../public/js/domain/logistics.js';
import { buildPlan } from '../public/js/domain/motion.js';
import { findEntity, entityPos } from '../public/js/domain/entities.js';

const T = '2026-05-14T06:00:00+02:00';
const turn = (extra = {}) => ({
  turn: 1,
  time: T,
  units: [{ id: 'u1', pos: [21, 54] }],
  logistics: {
    depots: [{ id: 'd1', name: 'Skład <b>A</b>', pos: [21.1, 54.1], status: 'operational', as_of: '2026-05-14T05:00:00+02:00', stock: { fuel: 40, ammo: 25, general: 10 }, notes: '<img src=x onerror=alert(1)>' }],
    routes: [{ id: 'r1', name: 'MSR Alfa', kind: 'MSR', status: 'open', coords: [[21, 54], [21, 54.2]] }],
    bridges: [{ id: 'b1', name: 'Most', pos: [21.2, 54.2], status: 'damaged', mlc: 30, as_of: '2026-05-14T02:00:00+02:00' }],
    convoys: [{ id: 'c1', name: 'Konwój 1', pos: [21.3, 54.3], status: 'moving', from: 'A', to: 'B', cargo: { fuel: 5, ammo: 2, general: 1 } }],
  },
  ...extra,
});

describe('T17 — logistics (klient)', () => {
  test('logisticsElements: kolejność i brak logistics → []', () => {
    assert.deepEqual(logisticsElements(turn()).map((x) => x.kind), ['depot', 'route', 'bridge', 'convoy']);
    assert.deepEqual(logisticsElements({ turn: 1 }), []);
    assert.deepEqual(logisticsElements(null), []);
    assert.deepEqual(logisticsElements({ logistics: { depots: 'zle', routes: [null, {}] } }), []);
  });

  test('findLogisticsItem i logisticsPos (środek trasy)', () => {
    assert.equal(findLogisticsItem(turn(), 'c1').kind, 'convoy');
    assert.equal(findLogisticsItem(turn(), 'nope'), null);
    const r = findLogisticsItem(turn(), 'r1');
    assert.deepEqual(logisticsPos('route', r.item), [21, 54.1]);
    assert.equal(logisticsPos('route', { coords: [[1, 2]] }), null);
    assert.equal(logisticsPos('depot', { pos: 'x' }), null);
  });

  test('dataAge: świeże, stare (> 1 tura), brak as_of', () => {
    assert.deepEqual(dataAge('2026-05-14T05:00:00+02:00', T, 120), { ageMin: 60, stale: false });
    assert.deepEqual(dataAge('2026-05-14T04:00:00+02:00', T, 120), { ageMin: 120, stale: false });
    assert.deepEqual(dataAge('2026-05-14T03:59:00+02:00', T, 120), { ageMin: 121, stale: true });
    assert.deepEqual(dataAge(undefined, T), { ageMin: null, stale: false });
    assert.equal(dataAge('2026-05-14T07:00:00+02:00', T).ageMin, 0, 'przyszłość nie daje ujemnego wieku');
  });

  test('statusInfo i kolory tras', () => {
    assert.deepEqual(statusInfo('route', 'closed'), { label: 'zamknięta', level: 'bad' });
    assert.deepEqual(statusInfo('depot', 'xyz'), { label: 'xyz', level: 'neutral' });
    assert.equal(routeColor('open'), ROUTE_COLORS.open);
    assert.ok(routeColor('???'));
  });

  test('logisticsCard: skład świeży, most nieaktualny', () => {
    const ctx = { turnTime: T, turnMinutes: 120 };
    const d = logisticsCard('depot', turn().logistics.depots[0], ctx);
    assert.equal(d.statusLabel, 'czynny');
    assert.equal(d.stale, false);
    assert.equal(d.ageMin, 60);
    assert.deepEqual(d.rows[0], ['Paliwo', '40 t']);
    const b = logisticsCard('bridge', turn().logistics.bridges[0], ctx);
    assert.equal(b.stale, true);
    assert.equal(b.level, 'warn');
    assert.deepEqual(b.rows, [['Nośność (MLC)', '30 t']]);
    const r = logisticsCard('route', turn().logistics.routes[0], ctx);
    assert.equal(r.ageMin, null);
    assert.equal(r.stale, false);
    assert.ok(r.rows.some(([k]) => k === 'Długość'));
  });

  test('logisticsCardHtml: ucieczka HTML z nazw i uwag, znacznik nieaktualności', () => {
    const ctx = { turnTime: T, turnMinutes: 120 };
    const html = logisticsCardHtml(logisticsCard('depot', turn().logistics.depots[0], ctx));
    assert.ok(!html.includes('<img'), html);
    assert.ok(html.includes('&lt;img'));
    assert.ok(!html.includes('data-stale'));
    const stale = logisticsCardHtml(logisticsCard('bridge', { ...turn().logistics.bridges[0], name: '<script>x</script>' }, ctx));
    assert.ok(stale.includes('data-stale="1"'));
    assert.ok(!stale.includes('<script>'));
  });

  test('buildPlan: konwój z track jedzie po trasie; bez ruchu i bez logistics bez błędów', () => {
    const prev = turn();
    const next = turn();
    next.logistics.convoys[0] = { ...next.logistics.convoys[0], pos: [21.5, 54.3], track: [[21.3, 54.3], [21.4, 54.35], [21.5, 54.3]] };
    const plan = buildPlan(prev, next);
    const m = plan.moves.find((x) => x.id === 'c1');
    assert.equal(m.kind, 'convoy');
    assert.equal(m.route.length, 3);
    assert.equal(m.tracked, true);
    assert.equal(buildPlan(prev, turn()).moves.length, 0);
    assert.doesNotThrow(() => buildPlan({ turn: 1, units: [] }, next));
    assert.doesNotThrow(() => buildPlan(prev, { turn: 2, units: [] }));
    // bez track: prosta linia
    delete next.logistics.convoys[0].track;
    assert.equal(buildPlan(prev, next).moves.find((x) => x.id === 'c1').route.length, 2);
  });

  test('findEntity: elementy logistyczne, pierwszeństwo jednostek, entityPos', () => {
    const t = turn();
    assert.equal(findEntity(t, 'd1').kind, 'depot');
    assert.equal(findEntity(t, 'c1').kind, 'convoy');
    assert.deepEqual(entityPos(findEntity(t, 'r1')), [21, 54.1]);
    assert.deepEqual(entityPos(findEntity(t, 'u1')), [21, 54]);
    assert.equal(findEntity(t, 'brak'), null);
    assert.equal(findEntity({ units: [] }, 'd1'), null);
    t.logistics.depots[0].id = 'u1';
    assert.equal(findEntity(t, 'u1').kind, 'unit');
  });
});

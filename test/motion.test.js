import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { easeInOut, pathLength, pointAt, slicePath, routeFor, isSequential, buildPlan, planIsEmpty, positionsAt, ANIMATION_MS } from '../public/js/domain/motion.js';
import { distanceKm } from '../public/js/domain/geo.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const nearPt = (p, q, eps = 1e-9) => {
  near(p[0], q[0], eps);
  near(p[1], q[1], eps);
};

describe('T12.8 — matematyka animacji (domain/motion.js)', () => {
  test('wygładzenie: 0 → 0, 1 → 1, 0.5 → 0.5, rośnie monotonicznie, obcina poza zakresem', () => {
    assert.equal(easeInOut(0), 0);
    assert.equal(easeInOut(1), 1);
    near(easeInOut(0.5), 0.5);
    assert.equal(easeInOut(-3), 0);
    assert.equal(easeInOut(7), 1);
    assert.equal(easeInOut(Number.NaN), 0);
    let prev = 0;
    for (let t = 0.05; t <= 1; t += 0.05) {
      assert.ok(easeInOut(t) >= prev);
      prev = easeInOut(t);
    }
    assert.ok(easeInOut(0.1) < 0.1, 'łagodny start');
    assert.ok(easeInOut(0.9) > 0.9, 'łagodne hamowanie');
  });

  test('długość łamanej to suma odcinków', () => {
    const pts = [[21, 54], [21.1, 54], [21.1, 54.1]];
    near(pathLength(pts), distanceKm(pts[0], pts[1]) + distanceKm(pts[1], pts[2]), 1e-9);
    assert.equal(pathLength([[21, 54]]), 0);
  });

  test('punkt na łamanej: początek, koniec, połowa długości, obcinanie ułamka', () => {
    const pts = [[0, 0], [1, 0], [1, 1]]; // dwa odcinki ~ po 111 km (równik)
    nearPt(pointAt(pts, 0), [0, 0]);
    nearPt(pointAt(pts, 1), [1, 1]);
    nearPt(pointAt(pts, -2), [0, 0]);
    nearPt(pointAt(pts, 5), [1, 1]);
    nearPt(pointAt(pts, 0.5), [1, 0], 1e-3); // połowa długości ≈ róg
    const quarter = pointAt(pts, 0.25);
    assert.ok(quarter[0] > 0.4 && quarter[0] < 0.6 && Math.abs(quarter[1]) < 1e-9, 'ćwierć drogi leży na pierwszym odcinku');
  });

  test('trasa zerowej długości i pojedynczy punkt nie psują interpolacji', () => {
    assert.deepEqual(pointAt([[5, 5], [5, 5]], 0.5), [5, 5]);
    assert.deepEqual(pointAt([[5, 5]], 0.7), [5, 5]);
    assert.equal(pointAt([], 0.5), null);
  });

  test('ślad: początek łamanej do ułamka (z interpolowanym końcem)', () => {
    const pts = [[0, 0], [1, 0], [1, 1]];
    assert.deepEqual(slicePath(pts, 0), [[0, 0]]);
    assert.deepEqual(slicePath(pts, 1), pts);
    const part = slicePath(pts, 0.75);
    assert.equal(part.length, 3);
    nearPt(part[1], [1, 0]);
    assert.ok(part[2][1] > 0.4 && part[2][1] < 0.6);
    assert.equal(slicePath(pts, 0.25).length, 2);
  });

  test('trasa jednostki: track domykany pozycjami tur; brak lub zły track = linia prosta', () => {
    const from = [21, 54];
    const to = [21.2, 54.1];
    assert.deepEqual(routeFor(from, to, undefined), [from, to]);
    assert.deepEqual(routeFor(from, to, [[21, 54]]), [from, to]);
    assert.deepEqual(routeFor(from, to, [[21, 54], ['x', 1]]), [from, to]);
    const ok = [[21, 54], [21.1, 54.05], [21.2, 54.1]];
    assert.deepEqual(routeFor(from, to, ok), ok);
    const r = routeFor(from, to, [[21.05, 54.02], [21.1, 54.05]]); // nie zaczyna się w from ani nie kończy w to
    assert.deepEqual(r[0], from);
    assert.deepEqual(r.at(-1), to);
    assert.equal(r.length, 4);
  });

  test('kolejność tur: tylko N → N+1 z listy dostępnych tur', () => {
    assert.equal(isSequential(1, 2, [0, 1, 2, 3]), true);
    assert.equal(isSequential(0, 2, [0, 1, 2, 3]), false);
    assert.equal(isSequential(3, 2, [0, 1, 2, 3]), false);
    assert.equal(isSequential(1, 1, [0, 1]), false);
    assert.equal(isSequential(5, 6, [0, 1]), false);
  });
});

describe('T12.8 — plan ruchu między turami', () => {
  const prev = {
    units: [
      { id: 'a', pos: [21, 54] },
      { id: 'b', pos: [21.5, 54.5] },
      { id: 'still', pos: [22, 55] },
      { id: 'hq', pos: [20, 53] },
    ],
    assets: [{ id: 'drone', pos: [21, 54.1] }, { id: 'ground', sidc: 'x' }],
    contacts: [
      { id: 'c-1', sidc: 'SHGAUCAT---E---', pos: [23, 54.5] },
      { id: 'c-2', sidc: 'SHGAUCAT---E---', pos: [23.5, 54.5] },
    ],
  };
  const next = {
    units: [
      { id: 'a', pos: [21.2, 54.1], track: [[21, 54], [21.1, 54.02], [21.2, 54.1]] },
      { id: 'b', pos: [21.6, 54.6] },
      { id: 'still', pos: [22, 55.0000001] },
      { id: 'new', pos: [20, 53] },
    ],
    assets: [{ id: 'drone', pos: [21.3, 54.1] }, { id: 'ground', pos: [1, 1] }],
    contacts: [
      { id: 'c-1', sidc: 'SHGAUCAT---E---', pos: [23.1, 54.6] },
      { id: 'c-2', sidc: 'SHGAUCAT---E---', pos: [23.5, 54.5] },
      { id: 'c-3', sidc: 'SHGAUCAT---E---', pos: [24, 54.5] },
    ],
  };

  test('porusza się tylko to, co zmieniło pozycję i istniało w obu turach', () => {
    const plan = buildPlan(prev, next);
    assert.deepEqual(plan.moves.map((m) => m.id).sort(), ['a', 'b', 'drone']);
    assert.ok(!plan.moves.some((m) => ['still', 'hq', 'new', 'ground'].includes(m.id)));
  });

  test('jednostka z track jedzie po trasie, bez track po linii prostej', () => {
    const plan = buildPlan(prev, next);
    const a = plan.moves.find((m) => m.id === 'a');
    const b = plan.moves.find((m) => m.id === 'b');
    assert.equal(a.route.length, 3);
    assert.equal(a.tracked, true);
    assert.deepEqual(b.route, [[21.5, 54.5], [21.6, 54.6]]);
    assert.equal(b.tracked, false);
    assert.ok(a.lengthKm >= distanceKm([21, 54], [21.2, 54.1]) - 1e-9, 'trasa nie jest krótsza niż linia prosta');
  });

  test('kontakty nie jadą — tylko „duch” starej pozycji dla kontaktu o tym samym id, który się przesunął', () => {
    const plan = buildPlan(prev, next);
    assert.equal(plan.ghosts.length, 1);
    assert.deepEqual(plan.ghosts[0], { id: 'c-1', sidc: 'SHGAUCAT---E---', from: [23, 54.5], to: [23.1, 54.6] });
    assert.ok(!plan.moves.some((m) => m.id.startsWith('c-')));
  });

  test('wszystkie obiekty kończą razem: w t=0 na starcie, w t=1 na pozycji końcowej, w środku różne ułamki trasy', () => {
    const plan = buildPlan(prev, next);
    nearPt(positionsAt(plan, 0).get('a'), [21, 54]);
    const end = positionsAt(plan, 1);
    nearPt(end.get('a'), [21.2, 54.1]);
    nearPt(end.get('b'), [21.6, 54.6]);
    nearPt(end.get('drone'), [21.3, 54.1]);
    nearPt(positionsAt(plan, 0.5).get('b'), [21.55, 54.55], 1e-6);
    assert.ok(ANIMATION_MS >= 2000 && ANIMATION_MS <= 3000);
  });

  test('pusty plan: brak zmian, brak tury poprzedniej', () => {
    assert.equal(planIsEmpty(buildPlan(prev, prev)), true);
    assert.equal(planIsEmpty(buildPlan(null, next)), true);
    assert.equal(planIsEmpty(buildPlan(prev, next)), false);
  });
});

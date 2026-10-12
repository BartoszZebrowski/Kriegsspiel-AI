import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dosLevel, dosScore, dosIndicators, worstIndicator, dosAgeMin, isDosStale, resolveDos, dosRows, sortDosRows, formatDosValue, dosBarPct, DOS_STALE_MIN } from '../public/js/domain/dos.js';

const T = '2026-05-14T12:00:00+02:00';
const at = (min) => new Date(Date.parse(T) - min * 60000).toISOString();
const U = (id, extra = {}) => ({ id, name: id, sidc: 'SFGPUCIZ---F---', ...extra });

describe('DOS — progi kolorów', () => {
  test('dni: ≥2 ok, [1,2) warn, <1 bad (granice)', () => {
    for (const k of ['fuel', 'ammo', 'general']) {
      assert.equal(dosLevel(k, 2), 'ok');
      assert.equal(dosLevel(k, 1.99), 'warn');
      assert.equal(dosLevel(k, 1), 'warn');
      assert.equal(dosLevel(k, 0.99), 'bad');
      assert.equal(dosLevel(k, 0), 'bad');
    }
  });
  test('sprawność: ≥0,8 ok, [0,5;0,8) warn, <0,5 bad', () => {
    assert.equal(dosLevel('readiness', 0.8), 'ok');
    assert.equal(dosLevel('readiness', 0.79), 'warn');
    assert.equal(dosLevel('readiness', 0.5), 'warn');
    assert.equal(dosLevel('readiness', 0.49), 'bad');
  });
  test('brak wartości → null; formatowanie i pasek', () => {
    assert.equal(dosLevel('fuel', undefined), null);
    assert.equal(dosLevel('fuel', NaN), null);
    assert.equal(formatDosValue('fuel', 1.5), '1,5 d');
    assert.equal(formatDosValue('readiness', 0.855), '86%');
    assert.equal(formatDosValue('fuel', null), '—');
    assert.equal(dosBarPct('fuel', 6), 100);
    assert.equal(dosBarPct('fuel', -1), 0);
    assert.equal(dosBarPct('readiness', 0.5), 50);
  });
  test('najgorszy wskaźnik wg znormalizowanego score', () => {
    const dos = { fuel: 2, ammo: 1, general: 3, readiness: 0.3 };
    assert.equal(dosIndicators(dos).length, 4);
    assert.equal(worstIndicator(dos).kind, 'readiness'); // 0.3/0.8 < 1/2
    assert.equal(dosScore('fuel', 2), 1);
    assert.equal(worstIndicator(null), null);
    assert.equal(worstIndicator({ as_of: T }), null);
  });
});

describe('DOS — wiek meldunku', () => {
  test('wiek i przestarzałość (granica DOS_STALE_MIN)', () => {
    assert.equal(dosAgeMin({ fuel: 1, as_of: at(45) }, T), 45);
    assert.equal(dosAgeMin({ fuel: 1 }, T), null);
    assert.equal(isDosStale({ fuel: 1, as_of: at(DOS_STALE_MIN) }, T), false);
    assert.equal(isDosStale({ fuel: 1, as_of: at(DOS_STALE_MIN + 1) }, T), true);
    assert.equal(isDosStale({ fuel: 1 }, T), false);
  });
});

describe('DOS — agregacja z podwładnych', () => {
  const units = [
    U('b', { dos: { fuel: 3, ammo: 2, general: 2, readiness: 0.9, as_of: at(30) } }),
    U('b-1k', { parent: 'b' }),
    U('b-1k-1p', { parent: 'b-1k', dos: { fuel: 1.2, ammo: 3, as_of: at(200) } }),
    U('b-1k-2p', { parent: 'b-1k', dos: { fuel: 2.5, ammo: 0.5, readiness: 0.6, as_of: at(20) } }),
    U('hq', { }),
    U('c', { parent: 'hq' }),
    U('c-1', { parent: 'c', dos: { fuel: 4, as_of: at(10) } }),
    U('empty'),
  ];
  test('własny dos: derived=false', () => {
    const r = resolveDos(units[0], units);
    assert.equal(r.derived, false);
    assert.equal(r.dos.fuel, 3);
  });
  test('minimum rekurencyjnie, najstarszy as_of, derived=true', () => {
    const r = resolveDos(units[1], units);
    assert.equal(r.derived, true);
    assert.deepEqual({ ...r.dos }, { fuel: 1.2, ammo: 0.5, readiness: 0.6, as_of: at(200) });
    const top = resolveDos(units.find((u) => u.id === 'hq'), units);
    assert.equal(top.dos.fuel, 4);
    assert.equal(top.derived, true);
  });
  test('brak danych → null; pętla w parent nie zawiesza', () => {
    assert.equal(resolveDos(units.find((u) => u.id === 'empty'), units), null);
    const loop = [U('x', { parent: 'y' }), U('y', { parent: 'x' })];
    assert.equal(resolveDos(loop[0], loop), null);
  });
});

describe('DOS — wiersze i sortowanie', () => {
  test('najgorsze na górze, bez danych na końcu, sąsiedzi pominięci', () => {
    const units = [
      U('ok', { dos: { fuel: 3, ammo: 3, general: 3, readiness: 1, as_of: at(10) } }),
      U('nodata'),
      U('bad', { dos: { fuel: 0.4, ammo: 3, as_of: at(400) } }),
      U('warn', { dos: { fuel: 1.5, as_of: at(10) } }),
      U('nb', { formation: 'zt-mamry', dos: { fuel: 0.1 } }),
    ];
    const rows = dosRows(units, T);
    assert.deepEqual(rows.map((r) => r.unit.id), ['bad', 'warn', 'ok', 'nodata']);
    assert.equal(rows[0].level, 'bad');
    assert.equal(rows[0].stale, true);
    assert.equal(rows[1].stale, false);
    assert.equal(rows[3].worst, null);
    assert.equal(rows[3].ageMin, null);
  });
  test('sortDosRows: remis po nazwie, nie mutuje wejścia', () => {
    const mk = (name, score) => ({ unit: { id: name, name }, worst: score === null ? null : { score } });
    const rows = [mk('B', 1), mk('A', 1), mk('C', null), mk('D', 0.2)];
    const sorted = sortDosRows(rows);
    assert.deepEqual(sorted.map((r) => r.unit.id), ['D', 'A', 'B', 'C']);
    assert.equal(rows[0].unit.id, 'B');
  });
});

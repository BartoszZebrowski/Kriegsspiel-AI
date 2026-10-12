// T32: statystyki końcowe AAR, dopasowanie kontaktów do prawdy i ciągłość prawdy po zakończeniu bitwy.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { battleDay, summarizeLosses } from '../public/js/domain/aarstats.js';
import { matchContactsToTruth } from '../public/js/domain/afterbattle.js';
import { checkFinishedContinuity, checkFinishedAar } from '../tools/validate-realism.js';

const u = (id, side, pers, extra = {}) => ({ id, side, personnel: { current: pers }, ...extra });

describe('T32 — battleDay', () => {
  test('dni kalendarzowe w strefie scenariusza', () => {
    const start = '2026-05-14T06:00:00+02:00';
    assert.equal(battleDay('2026-05-14T23:00:00+02:00', start, 'Europe/Warsaw'), 0);
    assert.equal(battleDay('2026-05-15T00:30:00+02:00', start, 'Europe/Warsaw'), 1);
    assert.equal(battleDay('2026-05-14T22:30:00Z', start, 'Europe/Warsaw'), 1);
    assert.equal(battleDay('nonsens', start, 'Europe/Warsaw'), 0);
  });
});

describe('T32 — summarizeLosses', () => {
  const t = (time, units) => ({ time, units });
  const turns = [
    t('2026-05-14T20:00:00+02:00', [u('pl-b', 'PL', 100, { supply: { ammo: 3 }, equipment: [{ name: 'KTO', current: 10 }] }), u('ru-b', 'RU', 200), u('by-b', 'BY', 50)]),
    t('2026-05-14T22:00:00+02:00', [u('pl-b', 'PL', 90, { supply: { ammo: 2.5 }, equipment: [{ name: 'KTO', current: 8 }] }), u('ru-b', 'RU', 150), u('by-b', 'BY', 50)]),
    t('2026-05-15T02:00:00+02:00', [u('pl-b', 'PL', 85, { supply: { ammo: 3.5 }, equipment: [{ name: 'KTO', current: 8 }] }), u('ru-b', 'RU', 140), u('by-b', 'BY', 45)]),
  ];
  const opts = { start: turns[0].time, timezone: 'Europe/Warsaw', ownSide: 'PL' };

  test('podział na dni i strony; wzrost zapasu to nie zużycie', () => {
    const r = summarizeLosses(turns, opts);
    assert.deepEqual(r.sides, ['PL', 'BY', 'RU']);
    assert.deepEqual(r.days.map((d) => d.day), [0, 1]);
    assert.equal(r.days[0].sides.PL.personnel, 10);
    assert.equal(r.days[0].sides.PL.ammo, 0.5);
    assert.deepEqual(r.days[0].sides.PL.equipment, { KTO: 2 });
    assert.equal(r.days[0].sides.RU.personnel, 50);
    assert.equal(r.days[1].sides.PL.ammo, 0);
    assert.equal(r.days[1].sides.BY.personnel, 5);
    assert.equal(r.totals.RU.personnel, 60);
    assert.equal(r.totals.PL.personnel, 15);
  });

  test('bez podwójnego liczenia batalionu i kompanii; reszta poza kompaniami liczy się osobno', () => {
    const a = [u('bn', 'PL', 100), u('k1', 'PL', 60, { parent: 'bn' }), u('k2', 'PL', 40, { parent: 'bn' })];
    const b = [u('bn', 'PL', 85), u('k1', 'PL', 52, { parent: 'bn' }), u('k2', 'PL', 33, { parent: 'bn' })];
    const r = summarizeLosses([{ time: turns[0].time, units: a }, { time: turns[1].time, units: b }], opts);
    assert.equal(r.totals.PL.personnel, 15);
    const c = [u('bn', 'PL', 80), u('k1', 'PL', 52, { parent: 'bn' }), u('k2', 'PL', 33, { parent: 'bn' })];
    const r2 = summarizeLosses([{ time: turns[0].time, units: a }, { time: turns[1].time, units: c }], opts);
    assert.equal(r2.totals.PL.personnel, 20);
  });

  test('puste i jednoturowe dane nie wywracają liczenia', () => {
    assert.deepEqual(summarizeLosses([], opts).days, []);
    assert.deepEqual(summarizeLosses([turns[0]], opts).days, []);
  });
});

describe('T32 — matchContactsToTruth', () => {
  const p = (id, pos) => ({ id, pos });
  test('zachłanne najbliższe, jeden do jednego', () => {
    const m = matchContactsToTruth([p('c1', [22, 54]), p('c2', [22.01, 54])], [p('t1', [22.002, 54]), p('t2', [22.011, 54])]);
    assert.deepEqual(m.map((x) => [x.contact.id, x.truth.id]).sort(), [['c1', 't1'], ['c2', 't2']]);
  });
  test('poza promieniem i bez pozycji: brak pary', () => {
    assert.equal(matchContactsToTruth([p('c1', [22, 54])], [p('t1', [23, 54])], 15000).length, 0);
    assert.equal(matchContactsToTruth([{ id: 'x' }], [p('t1', [22, 54])]).length, 0);
    assert.equal(matchContactsToTruth(null, null).length, 0);
  });
  test('jednostka prawdy dopasowana tylko raz', () => {
    assert.equal(matchContactsToTruth([p('c1', [22, 54]), p('c2', [22.001, 54])], [p('t1', [22.0005, 54])]).length, 1);
  });
});

describe('T32 — walidator zakończonej bitwy', () => {
  test('ciągłość i zgodność z turami gracza', () => {
    assert.deepEqual(checkFinishedContinuity({ status: 'finished' }, [0, 1, 2], [0, 1, 2]), []);
    assert.equal(checkFinishedContinuity({ status: 'finished' }, [0, 1], [0, 2]).length, 2);
    assert.equal(checkFinishedContinuity({ status: 'finished' }, [0, 1, 2], [0, 1]).length, 1);
    assert.deepEqual(checkFinishedContinuity({ status: 'active' }, [0, 1], [0, 5]), []);
  });
  test('finished bez aar.md zgłaszane', () => {
    assert.equal(checkFinishedAar({ status: 'finished' }, false).length, 1);
    assert.equal(checkFinishedAar({ status: 'finished' }, true).length, 0);
    assert.equal(checkFinishedAar({ status: 'active' }, false).length, 0);
  });
});

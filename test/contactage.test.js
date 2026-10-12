// T16: starzenie się kontaktów — klasy wieku z SIDC, krycie liniowe, napis „informacja sprzed …”.
import assert from 'node:assert/strict';
import test from 'node:test';
import { contactAgeClassKey, contactAgeClass, opacityForAge, contactFreshness, AGE_CLASSES, CONTACT_MIN_OPACITY } from '../public/js/domain/contactage.js';

const T = '2026-05-01T12:00:00+02:00';
const ago = (min) => new Date(new Date(T).getTime() - min * 60000).toISOString();
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const SIDC = {
  dron: 'SHAPMFQ--------',
  czolg: 'SHGPUCAT---E---',
  ppanc: 'SHGPUCAA---E---',
  zmech: 'SHGPUCIZ---F---',
  rozp: 'SHGPUCR----D---',
  piechota: 'SHGPUCI----E---',
  haubica: 'SHGPUCFH---E---',
  opl: 'SHGPUCD----E---',
  rew: 'SHGPUUMSED-E---',
  saperzy: 'SHGPUCE----E---',
  logistyka: 'SHGPUSS----E---',
};

test('klasa wieku z SIDC: dron, pancerne, rozpoznanie, artyleria, OPL, REW, logistyka, nieznany', () => {
  assert.equal(contactAgeClassKey(SIDC.dron), 'drone');
  for (const k of ['czolg', 'ppanc', 'zmech', 'rozp']) assert.equal(contactAgeClassKey(SIDC[k]), 'fast', k);
  for (const k of ['piechota', 'haubica', 'opl', 'rew', 'saperzy']) assert.equal(contactAgeClassKey(SIDC[k]), 'slow', k);
  assert.equal(contactAgeClassKey(SIDC.logistyka), 'static');
  assert.equal(contactAgeClassKey('SUGP-----------'), 'other');
  assert.equal(contactAgeClassKey(undefined), 'other');
  assert.equal(contactAgeClass(SIDC.czolg), AGE_CLASSES.fast);
});

test('progi klas zgodne z WA', () => {
  assert.deepEqual([AGE_CLASSES.drone.fresh, AGE_CLASSES.drone.old], [10, 30]);
  assert.deepEqual([AGE_CLASSES.fast.fresh, AGE_CLASSES.fast.old], [30, 120]);
  assert.deepEqual([AGE_CLASSES.slow.fresh, AGE_CLASSES.slow.old], [60, 360]);
  assert.deepEqual([AGE_CLASSES.static.fresh, AGE_CLASSES.static.old], [180, 720]);
  assert.deepEqual([AGE_CLASSES.other.fresh, AGE_CLASSES.other.old], [45, 180]);
});

test('krycie: 1 do progu świeżego, liniowo, minimum od progu starego', () => {
  const c = AGE_CLASSES.fast;
  near(opacityForAge(0, c), 1);
  near(opacityForAge(30, c), 1);
  near(opacityForAge(75, c), (1 + CONTACT_MIN_OPACITY) / 2); // połowa przedziału
  near(opacityForAge(75, c), 0.675);
  near(opacityForAge(120, c), CONTACT_MIN_OPACITY);
  near(opacityForAge(5000, c), CONTACT_MIN_OPACITY);
  near(opacityForAge(null, c), 1);
});

test('ten sam wiek: czołgi bledsze niż artyleria', () => {
  const tank = contactFreshness({ sidc: SIDC.czolg, observed: ago(100) }, T);
  const art = contactFreshness({ sidc: SIDC.haubica, observed: ago(100) }, T);
  assert.ok(tank.opacity < art.opacity);
});

test('napis „informacja sprzed …” tylko od progu starego', () => {
  const c = { sidc: SIDC.czolg };
  assert.equal(contactFreshness({ ...c, observed: ago(119) }, T).text, '');
  assert.equal(contactFreshness({ ...c, observed: ago(119) }, T).old, false);
  const f = contactFreshness({ ...c, observed: ago(130) }, T);
  assert.equal(f.old, true);
  assert.equal(f.text, 'informacja sprzed 2 h 10 min');
  assert.equal(contactFreshness({ ...c, observed: ago(120) }, T).text, 'informacja sprzed 2 h');
});

test('przypadki brzegowe: brak observed, observed z przyszłości, błędna data, brak czasu tury', () => {
  const c = { sidc: SIDC.czolg };
  const none = contactFreshness(c, T);
  assert.deepEqual([none.ageMin, none.opacity, none.text, none.old], [null, 1, '', false]);
  const fut = contactFreshness({ ...c, observed: ago(-45) }, T);
  assert.deepEqual([fut.ageMin, fut.opacity, fut.text], [0, 1, '']);
  assert.equal(contactFreshness({ ...c, observed: 'nie-data' }, T).ageMin, null);
  assert.equal(contactFreshness({ ...c, observed: ago(500) }, undefined).opacity, 1);
  assert.equal(contactFreshness(undefined, T).opacity, 1);
});

test('dron: stary już po 30 min', () => {
  const f = contactFreshness({ sidc: SIDC.dron, observed: ago(30) }, T);
  near(f.opacity, CONTACT_MIN_OPACITY);
  assert.equal(f.text, 'informacja sprzed 30 min');
});

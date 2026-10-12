import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchItem, unitRanges, contactRanges, coverageRings } from '../public/js/domain/ranges.js';

const catalog = JSON.parse(readFileSync(new URL('../data/equipment.json', import.meta.url), 'utf8'));
const bn = (id, equipment, extra = {}) => ({ id, name: id, sidc: 'SFGPUCIZ---F---', pos: [23, 53], equipment, ...extra });

test('Spike + Piorun: pierścienie ppanc 4 km i plot 6,5 km', () => {
  const u = bn('b', [{ name: 'wyrzutnie ppk Spike', current: 12, authorized: 12 }, { name: 'przenośne zestawy Piorun', current: 6, authorized: 6 }]);
  const r = unitRanges(u, catalog);
  assert.equal(r.find((x) => x.kind === 'ppanc').range_m, 4000);
  assert.equal(r.find((x) => x.kind === 'plot').range_m, 6500);
  assert.equal(r.find((x) => x.kind === 'pośredni'), undefined);
});

test('brak broni danego rodzaju, zerowy stan i sprzęt bez broni -> brak pierścienia', () => {
  assert.deepEqual(unitRanges(bn('b', [{ name: 'samochody ciężarowe Jelcz', current: 5, authorized: 5 }]), catalog), []);
  assert.deepEqual(unitRanges(bn('b', [{ name: 'wyrzutnie ppk Spike', current: 0, authorized: 12 }]), catalog), []);
  assert.deepEqual(unitRanges(bn('b', undefined), catalog), []);
});

test('dopasowanie po nazwie (przykłady ze scenariusza)', () => {
  const id = (name) => matchItem({ name }, catalog)?.id;
  assert.equal(id('czołgi Leopard 2PL'), 'pl-leopard-2pl');
  assert.equal(id('KTO Rosomak (30 mm)'), 'pl-rosomak-30');
  assert.equal(id('armatohaubice Krab 155 mm'), 'pl-krab');
  assert.equal(id('wyrzutnie ppk Spike'), 'pl-spike-lr');
  assert.equal(id('samobieżne zestawy Poprad'), 'pl-poprad');
  assert.equal(id('przenośne zestawy Piorun'), 'pl-piorun');
  assert.equal(id('moździerze samobieżne RAK 120 mm'), 'pl-rak-120');
  assert.equal(id('wozy amunicyjne'), undefined);
  assert.equal(matchItem({ name: 'cokolwiek', ref: 'pl-krab' }, catalog).id, 'pl-krab');
  assert.equal(matchItem({ name: 'Krab', ref: 'nie-ma' }, catalog), null);
});

test('kontakt: pierścienie tylko z estimate_equipment, z niepewnością', () => {
  const c = { id: 'c1', uncertainty_m: 800, estimate_equipment: [{ name: 'Kornet (zestaw ppk)', count: 2, approx: true }], equipment: [{ name: 'Tor-M2', current: 9 }] };
  const r = contactRanges(c, catalog);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].kind, r[0].range_m, r[0].estimate, r[0].uncertainty_m], ['ppanc', 5500, true, 800]);
  assert.deepEqual(contactRanges({ id: 'c2' }, catalog), []);
});

test('hq bez własnej broni nie dostaje pierścieni z podwładnych', () => {
  const hq = bn('hq', [{ name: 'stacje radiowe dalekiego zasięgu', current: 4 }], { sidc: 'SFGPUCIZ--AH---' });
  assert.deepEqual(unitRanges(hq, catalog), []);
});

test('coverageRings: najniższy widoczny szczebel, bez dublowania rodzic+podwładni', () => {
  const krab = (n) => [{ name: 'armatohaubice Krab 155 mm', current: n }];
  const units = [
    bn('hq', [], { sidc: 'SFGPUCIZ--AH---' }),
    bn('d', krab(8), { parent: 'hq' }),
    bn('d-1', krab(4), { parent: 'd', sidc: 'SFGPUCIZ---E---' }),
    bn('d-1p', krab(2), { parent: 'd-1', sidc: 'SFGPUCIZ---D---' }),
    bn('n', krab(4), { formation: 'zt-x' }),
  ];
  const ids = (level) => coverageRings(units, catalog, 'pośredni', level).map((r) => r.id);
  assert.deepEqual(ids('platoon'), ['d-1p']);
  assert.deepEqual(ids('battalion'), ['d']);
  assert.equal(coverageRings(units, catalog, 'plot', 'platoon').length, 0);
});

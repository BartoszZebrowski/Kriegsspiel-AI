import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { promises as fs } from 'node:fs';
import { checkCatalog, indexCatalog as sharedIndex, checkEquipmentRef } from '../shared/equipment.js';
import { checkEquipmentRefs, loadCatalogIndex, CATALOG_FILE } from '../tools/validate-equipment.js';
import { groupEquipment, subordinateTotals, portableSummary, formatRange, indexCatalog, OTHER_CATEGORY } from '../public/js/domain/equipment.js';
import { makeScenario, startApp } from './helpers.js';

const catalog = {
  categories: [{ id: 'czołg' }, { id: 'ppk', portable: true }, { id: 'broń zespołowa', portable: true }],
  weaponKinds: { ppanc: 'przeciwpancerna', ogólny: 'ogólna' },
  items: [
    { id: 't1', name: 'Czołg 1', side: 'PL', category: 'czołg', weapons: [{ name: 'armata', range_m: 4000, kind: 'ppanc' }] },
    { id: 'p1', name: 'Pirat', side: 'PL', category: 'ppk', weapons: [{ name: 'Pirat', range_m: 2500, kind: 'ppanc' }] },
    { id: 'u1', name: 'UKM-2000', side: 'PL', category: 'broń zespołowa', weapons: [{ name: 'UKM', range_m: 800, kind: 'ogólny' }] },
  ],
};
const clone = () => structuredClone(catalog);
const report = () => { const errors = []; return { errors, error: (m) => errors.push(m) }; };

describe('T46 — walidator katalogu', () => {
  test('poprawny katalog bez błędów', () => assert.deepEqual(checkCatalog(catalog), []));
  test('prawdziwy data/equipment.json jest poprawny', async () => {
    const r = report();
    const idx = await loadCatalogIndex(r, CATALOG_FILE);
    assert.deepEqual(r.errors, []);
    assert.ok(idx.size > 30);
  });
  test('broń bez range_m (lub <= 0) to błąd', () => {
    const c = clone(); delete c.items[0].weapons[0].range_m;
    assert.match(checkCatalog(c).join('\n'), /range_m/);
    c.items[0].weapons[0].range_m = 0;
    assert.match(checkCatalog(c).join('\n'), /range_m/);
  });
  test('nieznana kategoria, kind, duplikat id i side', () => {
    const c = clone(); c.items[0].category = 'x'; c.items[1].weapons[0].kind = 'zły'; c.items[2].id = 't1'; c.items[2].side = 'DE';
    const text = checkCatalog(c).join('\n');
    assert.match(text, /kategoria/); assert.match(text, /kind/); assert.match(text, /zduplikowane/); assert.match(text, /side/);
  });
  test('ref do nieistniejącej pozycji → błąd, bez ref → ok', () => {
    const idx = sharedIndex(catalog);
    assert.equal(checkEquipmentRef({ name: 'a' }, idx), null);
    assert.equal(checkEquipmentRef({ ref: 't1' }, idx), null);
    assert.match(checkEquipmentRef({ ref: 'nie-ma' }, idx), /nie istnieje/);
    assert.match(checkEquipmentRef({ ref: '' }, idx), /ref/);
    const r = report();
    checkEquipmentRefs('tura 1', {
      units: [{ id: 'a', equipment: [{ name: 'x', ref: 'zle', current: 1, authorized: 1 }] }],
      contacts: [{ id: 'c', estimate_equipment: [{ name: 'y', ref: 'zle2', count: 1 }] }],
    }, sharedIndex(catalog), r);
    assert.equal(r.errors.length, 2);
  });
});

describe('T46 — logika domeny', () => {
  const list = [
    { name: 'Pirat', ref: 'p1', current: 2, authorized: 3 },
    { name: 'Czołg', ref: 't1', current: 10, authorized: 14 },
    { name: 'Łopata', current: 5, authorized: 5 },
    { name: 'UKM', ref: 'u1', current: 3, authorized: 3 },
  ];
  test('grupowanie wg kolejności kategorii, „inne” na końcu', () => {
    const g = groupEquipment(list, catalog);
    assert.deepEqual(g.map((x) => x.category), ['czołg', 'ppk', 'broń zespołowa', OTHER_CATEGORY]);
    assert.equal(g[0].rows[0].weapons[0].range, '4 km');
    assert.equal(g[0].rows[0].weapons[0].label, 'przeciwpancerna');
    assert.equal(g[1].portable, true);
  });
  test('bez katalogu wszystko w „inne”', () => {
    assert.deepEqual(groupEquipment(list, null).map((x) => x.category), [OTHER_CATEGORY]);
  });
  test('suma z bezpośrednich podwładnych', () => {
    const units = [
      { id: 'b', equipment: [{ name: 'Czołg', ref: 't1', current: 10, authorized: 14 }] },
      { id: 'k1', parent: 'b', equipment: [{ ref: 't1', name: 'Czołg', current: 4, authorized: 5 }, { name: 'Łopata', current: 1, authorized: 1 }] },
      { id: 'k2', parent: 'b', equipment: [{ ref: 't1', name: 'Czołg', current: 3, authorized: 5 }] },
      { id: 'p', parent: 'k1', equipment: [{ ref: 't1', name: 'Czołg', current: 99, authorized: 99 }] },
    ];
    const t = subordinateTotals(units, 'b');
    assert.deepEqual(t.get('t1'), { current: 7, authorized: 10 });
    assert.deepEqual(t.get('Łopata'), { current: 1, authorized: 1 });
  });
  test('portableSummary i formatRange', () => {
    assert.equal(portableSummary(list, catalog), '2 × Pirat, 3 × UKM');
    assert.equal(portableSummary([], catalog), '');
    assert.equal(formatRange(800), '800 m');
    assert.equal(formatRange(6500), '6,5 km');
    assert.equal(formatRange(4000), '4 km');
    assert.equal(indexCatalog(catalog).get('p1').name, 'Pirat');
  });
});

function rawGet(base, rawPath) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ hostname, port, path: rawPath }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
}

describe('T46 — endpoint /data/', () => {
  let app;
  before(async () => { app = await startApp((await makeScenario()).dir); });
  after(() => app.close());

  test('200 dla equipment.json z poprawnym katalogiem', async () => {
    const res = await app.get('/data/equipment.json');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /json/);
    assert.deepEqual(await res.json(), JSON.parse(await fs.readFile(CATALOG_FILE, 'utf8')));
  });
  test('404 dla innych ścieżek /data/ i prób traversal', async () => {
    for (const p of ['/data/', '/data/other.json', '/data/constructor', '/data/__proto__', '/data/toString', '/data/..%2Fpackage.json', '/data/../package.json', '/data/%2e%2e/package.json']) {
      const status = await rawGet(app.base, p);
      assert.equal(status, 404, p);
    }
  });
});

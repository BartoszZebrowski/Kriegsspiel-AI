import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkHierarchySums, unitsInWater, loadWaterPolygons, inboxOutOfOrder, enemyNameLeaks, checkFinishedAar,
} from '../tools/validate.js';

const pl = (id, name, parent, cur, auth, eq) => ({
  id, name, parent, sidc: 'SFGPUCIZ---E---', personnel: { current: cur, authorized: auth },
  ...(eq ? { equipment: [{ name: 'KTO', current: eq[0], authorized: eq[1] }] } : {}),
});

describe('T37 — walidator: spójność i realizm', () => {
  test('1. suma dzieci > stan rodzica → uwaga; mniejsza suma (dowództwo kompanii) jest OK', () => {
    const ok = [pl('k', 'kompania', 'b', 120, 130, [10, 12]), pl('p1', 'pluton 1', 'k', 30, 35, [4, 4]), pl('p2', 'pluton 2', 'k', 30, 35, [4, 4])];
    assert.deepEqual(checkHierarchySums('t', ok), []);
    const bad = [pl('k', 'kompania', 'b', 50, 130, [6, 12]), pl('p1', 'pluton 1', 'k', 30, 35, [4, 4]), pl('p2', 'pluton 2', 'k', 30, 35, [4, 4])];
    const w = checkHierarchySums('t', bad);
    assert.ok(w.some((x) => x.includes('units[k]') && x.includes('personnel.current')), w.join('\n'));
    assert.ok(w.some((x) => x.includes('equipment[KTO]') && x.includes('current')), w.join('\n'));
  });

  test('1b. działa na każdym poziomie (batalion → kompanie)', () => {
    const bad = [{ ...pl('b', 'batalion', 'hq', 100, 100), sidc: 'SFGPUCIZ---F---' }, pl('k1', 'k1', 'b', 70, 70), pl('k2', 'k2', 'b', 70, 70)];
    assert.equal(checkHierarchySums('t', bad).length, 2);
  });

  test('2. jednostka w wodzie', () => {
    const lake = [{ outer: [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]] }];
    const units = [{ id: 'a', pos: [0.5, 0.5] }, { id: 'b', pos: [2, 2] }];
    assert.deepEqual(unitsInWater(units, lake), ['a']);
    assert.deepEqual(unitsInWater([{ id: 'b', pos: [2, 2] }], lake), []);
  });

  test('2b. loadWaterPolygons: brak cache → [], cache obejmujący punkt → poligony', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-water-'));
    try {
      assert.deepEqual(await loadWaterPolygons([[0.5, 0.5]], path.join(dir, 'nie-ma')), []);
      const poly = { outer: [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]] };
      await fs.writeFile(path.join(dir, 'water-x.json'), JSON.stringify({ bbox: [0, 0, 1, 1], polygons: [poly] }));
      assert.equal((await loadWaterPolygons([[0.5, 0.5]], dir)).length, 1);
      assert.equal((await loadWaterPolygons([[5, 5]], dir)).length, 0);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('3. inbox poza kolejnością czasu', () => {
    const m = (id, time) => ({ id, time });
    assert.deepEqual(inboxOutOfOrder([m('a', '2025-01-01T08:00:00+01:00'), m('b', '2025-01-01T08:10:00+01:00')]), []);
    assert.deepEqual(inboxOutOfOrder([m('a', '2025-01-01T08:10:00+01:00'), m('b', '2025-01-01T08:00:00+01:00')]), ['b']);
  });

  test('4. nazwa wroga zawiera nazwę własnej jednostki (cała fraza, granice słowa)', () => {
    const own = [{ id: 'bcz', name: 'batalion czołgów' }, { id: '1bzmot', name: '1 bzmot' }];
    const leaks = (name) => enemyNameLeaks(own, [{ id: 'e1', name }]);
    assert.equal(leaks('bcz (RU)').length, 1);
    assert.equal(leaks('1 bzmot RU').length, 1);
    assert.equal(leaks('1bzmot').length, 1);
    assert.equal(leaks('batalion zmechanizowany RU').length, 0); // słowa ogólne nie liczą się
    assert.equal(leaks('batalion rozpoznawczy').length, 0);
    assert.equal(leaks('bczx').length, 0); // granica słowa
  });

  test('5. finished bez umpire/aar.md', () => {
    assert.equal(checkFinishedAar({ status: 'finished' }, false).length, 1);
    assert.deepEqual(checkFinishedAar({ status: 'finished' }, true), []);
    assert.deepEqual(checkFinishedAar({ status: 'active' }, false), []);
  });

  test('czysty zestaw danych → 0 uwag', () => {
    const units = [pl('k', 'kompania', 'b', 120, 130, [10, 12]), pl('p1', 'pluton 1', 'k', 30, 35, [4, 4])];
    assert.deepEqual(checkHierarchySums('t', units), []);
    assert.deepEqual(unitsInWater([{ id: 'a', pos: [5, 5] }], []), []);
    assert.deepEqual(inboxOutOfOrder([{ id: 'a', time: '2025-01-01T08:00:00+01:00' }]), []);
    assert.deepEqual(enemyNameLeaks([{ id: 'bcz', name: 'batalion czołgów' }], [{ id: 'e', name: 'zgrupowanie pancerne RU' }]), []);
    assert.deepEqual(checkFinishedAar({ status: 'active' }, false), []);
  });
});

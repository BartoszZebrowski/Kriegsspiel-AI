import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeScenario, startApp } from './helpers.js';
import { validateScenario } from '../tools/validate.js';
import * as schema from '../shared/schema.js';
import { NOTE_GRAPHICS } from '../server/store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'scenarios', '00-test-przesmyk');

async function patchJson(file, fn) {
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  fn(data);
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

describe('T12.5 — shared/schema.js', () => {
  test('store re-eksportuje stałe ze wspólnego modułu', () => {
    assert.equal(NOTE_GRAPHICS, schema.NOTE_GRAPHICS);
  });

  test('isCoord i checkNote', () => {
    assert.ok(schema.isCoord([22.9, 54.1]));
    assert.ok(!schema.isCoord([200, 0]));
    assert.ok(!schema.isCoord([1]));
    const ok = schema.checkNote({ id: 'a', kind: 'point', name: 'A', geometry: { type: 'Point', coordinates: [1, 2] } });
    assert.equal(ok.note.color, 'black');
    assert.match(schema.checkNote({ id: 'a', kind: 'toString', name: 'A' }).error, /rodzaj/);
    assert.throws(() => schema.validateNote({ id: 'x' }), /Rysunek x/);
  });

  test('biała lista pól gracza nie zawiera pól sędziego', () => {
    for (const list of Object.values(schema.PLAYER_FIELDS)) {
      for (const f of ['side', 'supply', 'events', 'endurance_min']) assert.ok(!list.includes(f), f);
    }
  });

  test('moduł jest czysty: bez importów', async () => {
    const src = await fs.readFile(path.join(ROOT, 'shared', 'schema.js'), 'utf8');
    assert.ok(!/^\s*import\s/m.test(src));
  });

  test('GET /shared/schema.js serwuje moduł, inne pliki — 404', async () => {
    const sc = await makeScenario();
    const app = await startApp(sc.dir);
    try {
      const res = await app.get('/shared/schema.js');
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /javascript/);
      assert.match(await res.text(), /SCHEMA_VERSION/);
      assert.equal((await app.get('/shared/other.js')).status, 404);
      assert.equal((await app.get('/shared/')).status, 404);
    } finally {
      await app.close();
    }
  });
});

describe('T12.5 — walidator: strażnik wycieku i szkice', () => {
  let dir;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-schema-'));
    await fs.cp(REAL, dir, { recursive: true });
  });
  after(() => fs.rm(dir, { recursive: true, force: true }));
  const turnFile = () => path.join(dir, 'player', 'turns', '000.json');
  const reset = () => fs.copyFile(path.join(REAL, 'player', 'turns', '000.json'), turnFile());

  test('scenariusz wzorcowy jest poprawny i ma schemaVersion', async () => {
    const { errors, warnings } = await validateScenario(dir);
    assert.deepEqual(errors, []);
    // T37: na scenariuszu wzorcowym zostają tylko uwagi spójności/realizmu (dane 2bzmot, nazwy wroga) — nic spoza nich
    const t37 = /suma podwładnych|poza kolejnością|nazwa wroga zawiera|pozycja w wodzie|finished/;
    assert.deepEqual(warnings.filter((w) => !t37.test(w)), []);
  });

  test('supply w jednostce gracza → błąd (bez wartości w komunikacie)', async () => {
    await patchJson(turnFile(), (d) => (d.units[0].supply = { dos: 'TAJNE-123' }));
    const { errors } = await validateScenario(dir);
    assert.ok(errors.some((e) => e.includes('supply') && e.includes('units[')), errors.join('\n'));
    assert.ok(!errors.join('\n').includes('TAJNE-123'));
    await reset();
  });

  test('side w kontakcie, events na górze pliku, nieznane pole w linii → błędy', async () => {
    await patchJson(turnFile(), (d) => {
      d.contacts[0].side = 'RU';
      d.events = [{ text: 'x' }];
      d.lines[0].truth = true;
    });
    const { errors } = await validateScenario(dir);
    for (const f of ['side', 'events', 'truth']) assert.ok(errors.some((e) => e.includes(`„${f}”`)), f);
    await reset();
  });

  test('pole sędziego w wiadomości gracza → błąd', async () => {
    const file = path.join(dir, 'player', 'inbox', '000.json');
    const orig = await fs.readFile(file, 'utf8');
    await patchJson(file, (d) => (d.messages[0].truth = 'x'));
    const { errors } = await validateScenario(dir);
    assert.ok(errors.some((e) => e.includes('„truth”')));
    await fs.writeFile(file, orig);
  });

  test('niepoprawny szkic w player/notes → błąd', async () => {
    const file = path.join(dir, 'player', 'notes', '000.json');
    const orig = await fs.readFile(file, 'utf8');
    await patchJson(file, (d) => d.items.push({ id: 'zly', kind: 'area', name: 'Z', geometry: { type: 'Point', coordinates: [1, 1] } }));
    const { errors } = await validateScenario(dir);
    assert.ok(errors.some((e) => e.includes('notes/000') && e.includes('zly')), errors.join('\n'));
    await fs.writeFile(file, orig);
  });

  test('schemaVersion: brak → uwaga, obca wersja → błąd', async () => {
    const file = path.join(dir, 'scenario.json');
    const orig = await fs.readFile(file, 'utf8');
    await patchJson(file, (d) => delete d.schemaVersion);
    let r = await validateScenario(dir);
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((w) => w.includes('schemaVersion')));
    await patchJson(file, (d) => (d.schemaVersion = 99));
    r = await validateScenario(dir);
    assert.ok(r.errors.some((e) => e.includes('schemaVersion')));
    await fs.writeFile(file, orig);
  });
});

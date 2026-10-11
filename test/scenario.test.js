import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScenario } from '../tools/validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SCENARIO = path.join(ROOT, 'scenarios', '00-test-przesmyk');

// Testy walidatora zakładają scenariusz z samą turą 0: rozgrywana kampania ma kolejne tury, więc kopię obcinamy.
export async function trimToTurnZero(dir) {
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

async function copyScenario() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-val-'));
  await fs.cp(TEST_SCENARIO, dir, { recursive: true });
  await trimToTurnZero(dir);
  return dir;
}

async function editJson(file, fn) {
  const data = JSON.parse(await fs.readFile(file, 'utf8'));
  fn(data);
  await fs.writeFile(file, JSON.stringify(data));
}

describe('T10 — walidator scenariusza', () => {
  test('scenariusz testowy jest poprawny', async () => {
    const { errors } = await validateScenario(TEST_SCENARIO);
    assert.deepEqual(errors, []);
  });

  test('wykrywa nieznany kanał wiadomości', async () => {
    const dir = await copyScenario();
    await editJson(path.join(dir, 'player/inbox/000.json'), (d) => (d.messages[0].channel = 'nie-ma'));
    const { errors } = await validateScenario(dir);
    assert.ok(errors.some((e) => e.includes('nieznany kanał')), errors.join('\n'));
  });

  test('wykrywa zduplikowane id jednostki', async () => {
    const dir = await copyScenario();
    await editJson(path.join(dir, 'player/turns/000.json'), (d) => d.units.push({ ...d.units[0] }));
    const { errors } = await validateScenario(dir);
    assert.ok(errors.some((e) => e.includes('zduplikowane id')), errors.join('\n'));
  });

  test('wykrywa niepoprawny SIDC i lukę w numeracji tur', async () => {
    const dir = await copyScenario();
    await editJson(path.join(dir, 'player/turns/000.json'), (d) => (d.units[0].sidc = 'XXXX'));
    await fs.copyFile(path.join(dir, 'player/turns/000.json'), path.join(dir, 'player/turns/002.json'));
    const { errors } = await validateScenario(dir);
    assert.ok(errors.some((e) => e.includes('SIDC')), errors.join('\n'));
    assert.ok(errors.some((e) => e.includes('nieciągła')), errors.join('\n'));
  });
});

describe('T12.1/T13 — walidacja stanów i hierarchii', () => {
  const run = async (mutate) => {
    const dir = await copyScenario();
    await editJson(path.join(dir, 'player/turns/000.json'), mutate);
    return validateScenario(dir);
  };

  test('ujemna liczba sprzętu daje błąd', async () => {
    const { errors } = await run((d) => (d.units[1].equipment[0].current = -1));
    assert.ok(errors.some((e) => e.includes('całkowite ≥ 0')), errors.join('\n'));
  });
  test('current > authorized daje uwagę, nie błąd', async () => {
    const { errors, warnings } = await run((d) => (d.units[1].personnel.current = 9999));
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('personnel.current')), warnings.join('\n'));
  });
  test('pusta nazwa sprzętu i zły szacunek kontaktu dają błąd', async () => {
    const { errors } = await run((d) => {
      d.units[1].equipment[0].name = ' ';
      d.contacts[0].estimate_equipment[0].count = 1.5;
    });
    assert.ok(errors.some((e) => e.includes('pusta nazwa')), errors.join('\n'));
    assert.ok(errors.some((e) => e.includes('count')), errors.join('\n'));
  });
  test('nieistniejący parent daje błąd', async () => {
    const { errors } = await run((d) => (d.units[1].parent = 'nie-ma'));
    assert.ok(errors.some((e) => e.includes('nie istnieje')), errors.join('\n'));
  });
  test('cykl A→B→A daje błąd', async () => {
    const { errors } = await run((d) => {
      d.units.find((u) => u.id === 'hq').parent = '1bzmot'; // 1bzmot → hq → 1bzmot
    });
    assert.ok(errors.some((e) => e.includes('cykl')), errors.join('\n'));
  });
  test('wiadomość do kompanii (jednostka z tury) jest poprawna, do nieznanego id nie', async () => {
    const dir = await copyScenario();
    await editJson(path.join(dir, 'player/inbox/000.json'), (d) => (d.messages[0].channel = '1bzmot-1k'));
    assert.deepEqual((await validateScenario(dir)).errors, []);
    await editJson(path.join(dir, 'player/inbox/000.json'), (d) => (d.messages[0].channel = 'brak-takiej'));
    assert.ok((await validateScenario(dir)).errors.some((e) => e.includes('nieznany kanał')));
  });
  test('scenariusz testowy ma kompanie z rodzicami', async () => {
    const d = JSON.parse(await fs.readFile(path.join(TEST_SCENARIO, 'player/turns/000.json'), 'utf8'));
    assert.ok(d.units.some((u) => u.id === '1bzmot-1k' && u.parent === '1bzmot'));
    assert.equal(d.units.find((u) => u.id === '1bzmot').parent, 'hq');
  });
});

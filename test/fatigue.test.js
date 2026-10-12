// T28 — zmęczenie i morale: progi, walidator, narzędzie tury sędziego, karta jednostki.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { fatigueLevel, checkFatigue, checkUmpireFatigue, FATIGUE_LEVELS } from '../shared/fatigue.js';
import { fatigueInfo, fatigueBlock } from '../public/js/domain/fatigue.js';
import { validateScenario } from '../tools/validate.js';
import { buildTurn } from '../tools/umpire/turn.mjs';
import { makeScenario } from './helpers.js';

const A = [22.9, 54.1];
const unit = (extra = {}) => ({ id: 'u', name: 'U', sidc: 'SFGPUCIZ---F---', pos: A, strength: 1, status: 's', task: 't', ...extra });
const base = { turn: 1, time: '2026-05-14T08:00:00+02:00', contacts: [] };

describe('T28 — progi i walidatory', () => {
  test('fatigueLevel: progi 720 i 240 min, zła wartość = null', () => {
    assert.equal(fatigueLevel(1440), 'wypoczęta');
    assert.equal(fatigueLevel(720), 'wypoczęta');
    assert.equal(fatigueLevel(719), 'zmęczona');
    assert.equal(fatigueLevel(240), 'zmęczona');
    assert.equal(fatigueLevel(239), 'wyczerpana');
    assert.equal(fatigueLevel(0), 'wyczerpana');
    for (const bad of [-1, NaN, '100', null, undefined]) assert.equal(fatigueLevel(bad), null);
  });
  test('checkFatigue: tylko kategorie z listy', () => {
    for (const l of FATIGUE_LEVELS) assert.equal(checkFatigue(l), null);
    assert.ok(checkFatigue('śpiąca'));
  });
  test('checkUmpireFatigue: morale poza 0–1 i ujemna wytrzymałość to błąd', () => {
    assert.deepEqual(checkUmpireFatigue({ stamina_min: 600, morale: 0.7 }), []);
    assert.deepEqual(checkUmpireFatigue({}), []);
    assert.equal(checkUmpireFatigue({ morale: 1.2 }).length, 1);
    assert.equal(checkUmpireFatigue({ morale: -0.1 }).length, 1);
    assert.equal(checkUmpireFatigue({ stamina_min: -5 }).length, 1);
  });
  test('validateScenario: fatigue poprawne OK, zła kategoria i pola sędziego w pliku gracza = błąd', async () => {
    const { dir, write } = await makeScenario({ turns: [0] });
    await write('player/turns/000.json', { ...base, turn: 0, units: [unit({ fatigue: 'zmęczona' })] });
    assert.ok(!(await validateScenario(dir)).errors.some((e) => /fatigue|stamina|morale/.test(e)));
    await write('player/turns/000.json', { ...base, turn: 0, units: [unit({ fatigue: 'śpiąca' })] });
    assert.ok((await validateScenario(dir)).errors.some((e) => e.includes('fatigue')));
    for (const f of ['stamina_min', 'morale']) {
      await write('player/turns/000.json', { ...base, turn: 0, units: [unit({ [f]: 0.5 })] });
      assert.ok((await validateScenario(dir)).errors.some((e) => e.includes(f)), f);
    }
  });
  test('validateScenario: morale poza 0–1 w umpire/turns to błąd', async () => {
    const { dir, write } = await makeScenario({ turns: [0] });
    await write('player/turns/000.json', { ...base, turn: 0, units: [unit()] });
    await write('umpire/turns/000.json', { ...base, turn: 0, units: [unit({ side: 'PL', morale: 1.5 })] });
    assert.ok((await validateScenario(dir)).errors.some((e) => e.includes('morale')));
    await write('umpire/turns/000.json', { ...base, turn: 0, units: [unit({ side: 'PL', morale: 0.6, stamina_min: 500 })] });
    assert.ok(!(await validateScenario(dir)).errors.some((e) => e.includes('morale')));
  });
});

describe('T28 — narzędzie tury sędziego', () => {
  const prevUmpire = { turn: 1, time: '2026-05-01T06:00:00+02:00', units: [
    unit({ id: 'a', side: 'PL', supply: { fuel: 1 }, stamina_min: 100, morale: 0.4 }),
    unit({ id: 'b', side: 'PL', supply: { fuel: 1 }, stamina_min: 1300, morale: 0.9 }),
    unit({ id: 'c', side: 'PL', supply: { fuel: 1 } }),
  ], assets: [] };
  const prevPlayer = { turn: 1, time: prevUmpire.time, units: [unit({ id: 'a' }), unit({ id: 'b' }), unit({ id: 'c' })], contacts: [], assets: [], lines: [] };
  test('fatigue gracza wyliczone z prawdy, liczby nie wyciekają', () => {
    const r = buildTurn({ prevUmpire, prevPlayer, plan: {}, turnMinutes: 60 });
    const f = Object.fromEntries(r.player.units.map((u) => [u.id, u.fatigue]));
    assert.deepEqual(f, { a: 'wyczerpana', b: 'wypoczęta', c: undefined });
    assert.ok(!/stamina_min|morale/.test(JSON.stringify(r.player)));
    assert.equal(r.umpire.units.find((u) => u.id === 'a').stamina_min, 100);
  });
});

describe('T28 — karta jednostki', () => {
  test('kategoria, ton, brak pola i escape', () => {
    assert.equal(fatigueInfo('wyczerpana').tone, 'bad');
    assert.equal(fatigueInfo('zmęczona').tone, 'warn');
    assert.equal(fatigueInfo('wypoczęta').tone, 'ok');
    assert.equal(fatigueInfo('<b>'), null);
    assert.equal(fatigueInfo('constructor'), null);
    assert.match(fatigueBlock({ fatigue: 'wyczerpana' }), /fatigue--bad[\s\S]*wyczerpana/);
    assert.equal(fatigueBlock({}), '');
    assert.equal(fatigueBlock({ fatigue: '<img onerror=x>' }), '');
  });
});

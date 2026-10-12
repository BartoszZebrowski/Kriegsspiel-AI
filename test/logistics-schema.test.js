// T17/T18 — warstwa danych: logistics i dos (schemat, walidator, turn.mjs, fixture).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../shared/schema.js';
import { validateScenario } from '../tools/validate.js';
import { buildTurn } from '../tools/umpire/turn.mjs';
import { loadSample, resolveSample, injectLogisticsSample } from './fixtures/logistics-sample.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL = path.join(ROOT, 'scenarios', '00-test-przesmyk');
const T = '2026-05-14T06:00:00+02:00';
const clone = (v) => JSON.parse(JSON.stringify(v));

const sampleRaw = await loadSample();
const baseline = (await validateScenario(REAL)).errors.length;
const good = () => clone(resolveSample(sampleRaw, T));

describe('checkLogistics', () => {
  test('poprawne dane z fixture → 0 błędów (strict i luźno)', () => {
    for (const strict of [true, false]) {
      const r = schema.checkLogistics(good().logistics, { strict });
      assert.deepEqual(r.errors, []);
      assert.deepEqual(r.warnings, []);
    }
  });

  test('zły status elementu → błąd (każda lista)', () => {
    for (const list of ['depots', 'routes', 'bridges', 'convoys']) {
      const l = good().logistics;
      l[list][0].status = 'nie-ma-takiego';
      const r = schema.checkLogistics(l);
      assert.ok(r.errors.some((e) => e.includes(`logistics.${list}[`) && e.includes('status')), list + ': ' + r.errors.join('|'));
    }
  });

  test('zły rodzaj trasy, współrzędne, stock, cargo → błąd', () => {
    const l = good().logistics;
    l.routes[0].kind = 'XSR';
    l.depots[0].pos = [200, 0];
    l.depots[1].stock.fuel = -1;
    l.convoys[0].cargo = { fuel: 1, ammo: 1 };
    const r = schema.checkLogistics(l);
    assert.equal(r.errors.length, 4, r.errors.join('\n'));
  });

  test('duplikat id (też między listami) → błąd', () => {
    const l = good().logistics;
    l.bridges[1].id = l.bridges[0].id;
    assert.ok(schema.checkLogistics(l).errors.some((e) => e.includes('zduplikowane id')));
    const l2 = good().logistics;
    l2.convoys[0].id = l2.depots[0].id;
    assert.ok(schema.checkLogistics(l2).errors.some((e) => e.includes('zduplikowane id')));
  });

  test('track konwoju: za krótki → błąd; zły koniec → uwaga', () => {
    const l = good().logistics;
    l.convoys[0].track = [[22.8, 53.9]];
    assert.ok(schema.checkLogistics(l).errors.some((e) => e.includes('track')));
    const l2 = good().logistics;
    l2.convoys[0].track = [[22.8, 53.9], [22.9, 54.0]];
    const r = schema.checkLogistics(l2);
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1);
  });

  test('strict: pole sędziego w elemencie gracza → błąd; luźno OK', () => {
    const l = good().logistics;
    l.depots[0].true_stock = { fuel: 1, ammo: 1, general: 1 };
    assert.ok(schema.checkLogistics(l, { strict: true }).errors.some((e) => e.includes('true_stock')));
    assert.deepEqual(schema.checkLogistics(l, { strict: false }).errors, []);
  });

  test('stałe enumów eksportowane', () => {
    assert.deepEqual(schema.ROUTE_STATUSES, ['open', 'threatened', 'closed']);
    assert.deepEqual(schema.BRIDGE_STATUSES, ['intact', 'damaged', 'destroyed']);
    assert.ok(schema.CONVOY_STATUSES.includes('moving') && schema.DEPOT_STATUSES.includes('operational'));
    assert.ok(schema.PLAYER_TURN_FIELDS.includes('logistics') && schema.PLAYER_FIELDS.units.includes('dos'));
  });
});

describe('checkDos', () => {
  const ok = { fuel: 1.5, ammo: 2, general: 3, readiness: 0.8, as_of: T };
  test('poprawny dos → null (też częściowy)', () => {
    assert.equal(schema.checkDos(ok), null);
    assert.equal(schema.checkDos({ readiness: 0.5, as_of: T }), null);
  });
  test('ujemne, readiness > 1, zły as_of, brak wskaźnika, nieznane pole → błąd', () => {
    assert.match(schema.checkDos({ ...ok, fuel: -0.1 }), /fuel/);
    assert.match(schema.checkDos({ ...ok, ammo: 'x' }), /ammo/);
    assert.match(schema.checkDos({ ...ok, readiness: 1.2 }), /readiness/);
    assert.match(schema.checkDos({ ...ok, readiness: -0.1 }), /readiness/);
    assert.match(schema.checkDos({ ...ok, as_of: 'wczoraj' }), /as_of/);
    assert.match(schema.checkDos({ as_of: T }), /wskaźnik/);
    assert.match(schema.checkDos({ ...ok, supply: 3 }), /supply/);
  });
});

describe('walidator scenariusza z logistics/dos', () => {
  async function copyWithSample(mutate) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-log-'));
    await fs.cp(REAL, dir, { recursive: true });
    const file = await injectLogisticsSample(dir);
    if (mutate) {
      const data = JSON.parse(await fs.readFile(file, 'utf8'));
      mutate(data);
      await fs.writeFile(file, JSON.stringify(data, null, 2));
    }
    return dir;
  }

  test('fixture wstrzyknięty do kopii → liczba błędów bez zmian', async () => {
    const dir = await copyWithSample();
    try {
      const { errors } = await validateScenario(dir);
      assert.equal(errors.length, baseline, errors.join('\n'));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('dos ujemne / readiness > 1 / supply w jednostce gracza → błąd', async () => {
    const dir = await copyWithSample((d) => {
      const [a, b, c] = d.units.filter((u) => u.dos);
      a.dos.fuel = -2;
      b.dos.readiness = 1.5;
      c.supply = { fuel: 3 };
    });
    try {
      const { errors } = await validateScenario(dir);
      assert.ok(errors.some((e) => e.includes('dos.fuel')), errors.join('\n'));
      assert.ok(errors.some((e) => e.includes('dos.readiness')));
      assert.ok(errors.some((e) => e.includes('„supply”')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('zły status / duplikat id w player logistics → błąd; supply w pliku → błąd', async () => {
    const dir = await copyWithSample((d) => {
      d.logistics.routes[0].status = 'zablokowana';
      d.logistics.bridges[1].id = d.logistics.bridges[0].id;
      d.supply = { fuel: 1 };
      d.logistics.depots[0].supply = 5;
    });
    try {
      const { errors } = await validateScenario(dir);
      assert.ok(errors.some((e) => e.includes('routes[msr-1]') && e.includes('status')));
      assert.ok(errors.some((e) => e.includes('zduplikowane id')));
      assert.ok(errors.some((e) => e.includes('pole „supply” spoza schematu')));
      assert.ok(errors.some((e) => e.includes('depots[sk-blog]') && e.includes('„supply”')));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('turn.mjs: logistics i dos', () => {
  const A = [22.9, 54.1];
  const mk = () => {
    const prevUmpire = {
      turn: 1, time: T,
      units: [{ id: 'bn', name: 'Batalion', sidc: 'SFGPUCIZ---F---', pos: A, strength: 1, status: 'ok', task: 't', side: 'PL', supply: { fuel: 2 }, dos: { fuel: 9 } }],
      logistics: {
        depots: [{ id: 'd1', name: 'Skład', pos: A, stock: { fuel: 50, ammo: 50, general: 50 }, status: 'operational', as_of: T, true_note: 'TAJNE' }],
        convoys: [{ id: 'k1', name: 'Konwój', pos: [22.8, 54.0], from: 'd1', to: 'bn', cargo: { fuel: 5, ammo: 5, general: 5 }, status: 'moving' }],
      },
      events: [],
    };
    const prevPlayer = {
      turn: 1, time: T,
      units: [{ id: 'bn', name: 'Batalion', sidc: 'SFGPUCIZ---F---', pos: A, strength: 1, status: 'ok', task: 't', dos: { fuel: 1, ammo: 1, general: 1, readiness: 0.9, as_of: T } }],
      logistics: {
        depots: [{ id: 'd1', name: 'Skład', pos: A, stock: { fuel: 40, ammo: 40, general: 40 }, status: 'operational', as_of: T }],
        convoys: [{ id: 'k1', name: 'Konwój', pos: [22.8, 54.0], from: 'd1', to: 'bn', cargo: { fuel: 5, ammo: 5, general: 5 }, status: 'moving' }],
      },
      contacts: [], assets: [], lines: [],
    };
    return { prevUmpire, prevPlayer };
  };

  test('bez planu: logistics gracza dziedziczone, prawda nie przecieka, dos z prawdy ignorowany', () => {
    const { prevUmpire, prevPlayer } = mk();
    const r = buildTurn({ prevUmpire, prevPlayer, plan: {}, turnMinutes: 30 });
    assert.deepEqual(r.player.logistics.depots[0].stock, { fuel: 40, ammo: 40, general: 40 });
    assert.ok(!JSON.stringify(r.player).includes('TAJNE'));
    assert.equal(r.player.units[0].dos.fuel, 1);
    assert.ok(!('supply' in r.player.units[0]));
    assert.equal(r.umpire.logistics.depots[0].true_note, 'TAJNE');
    assert.ok(!r.warnings.some((w) => w.includes('logistics')), r.warnings.join('\n'));
  });

  test('plan.logistics zmienia prawdę, plan.player.logistics widok gracza; track konwoju liczony', () => {
    const { prevUmpire, prevPlayer } = mk();
    const plan = {
      logistics: { depots: { patch: { d1: { stock: { fuel: 10, ammo: 50, general: 50 } } } }, convoys: { patch: { k1: { pos: [22.86, 54.05], route: [[22.83, 54.02]] } } } },
      player: { logistics: {
        depots: { patch: { d1: { status: 'limited', as_of: '2026-05-01T06:30:00+02:00' } } },
        convoys: { patch: { k1: { pos: [22.84, 54.03] } } },
        bridges: { add: [{ id: 'b1', name: 'Most', pos: A, mlc: 30, status: 'damaged', true_state: 'zburzony' }] },
      } },
    };
    const r = buildTurn({ prevUmpire, prevPlayer, plan, turnMinutes: 30 });
    assert.equal(r.umpire.logistics.depots[0].stock.fuel, 10);
    assert.equal(r.player.logistics.depots[0].stock.fuel, 40); // gracz wie swoje
    assert.equal(r.player.logistics.depots[0].status, 'limited');
    assert.deepEqual(r.umpire.logistics.convoys[0].track, [[22.8, 54.0], [22.83, 54.02], [22.86, 54.05]]);
    // widok gracza: trasa pośrednia z łatki sędziego jako zapas, koniec = pos gracza
    assert.deepEqual(r.player.logistics.convoys[0].track, [[22.8, 54.0], [22.83, 54.02], [22.84, 54.03]]);
    assert.equal(r.player.logistics.bridges[0].true_state, undefined);
    assert.ok(!JSON.stringify(r.player).includes('TAJNE'));
    assert.equal(schema.checkLogistics(r.player.logistics, { strict: true }).errors.length, 0);
  });

  test('dos z łatki jednostki gracza; usunięcie konwoju przez null; konwój bez ruchu bez track', () => {
    const { prevUmpire, prevPlayer } = mk();
    const plan = {
      player: {
        units: { bn: { dos: { fuel: 0.4, ammo: 0.9, general: 1, readiness: 0.6, as_of: '2026-05-01T06:30:00+02:00' } } },
        logistics: { convoys: { patch: { k1: null } } },
      },
    };
    const r = buildTurn({ prevUmpire, prevPlayer, plan, turnMinutes: 30 });
    assert.equal(r.player.units[0].dos.fuel, 0.4);
    assert.equal(r.player.logistics.convoys.length, 0);
    assert.equal(r.umpire.logistics.convoys[0].track, undefined);
  });

  test('resolveSample daje ISO w strefie tury', () => {
    const s = resolveSample(sampleRaw, T);
    assert.equal(s.logistics.depots[0].as_of, '2026-05-14T05:30:00+02:00');
    assert.equal(s.logistics.convoys[0].eta, '2026-05-14T07:30:00+02:00');
  });
});

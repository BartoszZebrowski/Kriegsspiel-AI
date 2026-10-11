import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import * as o from '../public/js/domain/orbat.js';
import { searchOmnibox } from '../public/js/domain/omnibox.js';
import { unitCard } from '../public/js/domain/cards.js';
import { checkTrack, PLAYER_FIELDS } from '../shared/schema.js';
import { validateScenario } from '../tools/validate.js';
import { isNeighbourFormationUnit } from '../server/store.js';
import { makeScenario, startApp } from './helpers.js';

const units = [
  { id: 'hq', name: 'ZT Hańcza', sidc: 'SFGPUCIZ--AH---', pos: [22.9, 54.1] },
  { id: 'b1', name: '1 bzmot', sidc: 'SFGPUCIZ---F---', parent: 'hq', pos: [22.87, 54.19] },
  { id: 'b1-1k', name: '1k 1bzmot', sidc: 'SFGPUCIZ---E---', parent: 'b1', pos: [22.84, 54.23] },
  { id: 'dd', name: 'Dywizja', sidc: 'SFGPUCIZ--AI---', pos: [22.5, 54.0] },
  { id: 'zt-mamry', name: 'ZT Mamry', sidc: 'SFGPUCIZ--AH---', pos: [22.0, 54.2] },
  { id: 'mamry-1bzmot', name: '1 bzmot (ZT Mamry)', sidc: 'SFGPUCIZ---F---', formation: 'zt-mamry', pos: [22.1, 54.25] },
  { id: 'mamry-1bzmot-1k', name: '1k (ZT Mamry)', sidc: 'SFGPUCIZ---E---', parent: 'mamry-1bzmot', pos: [22.12, 54.26] },
  { id: 'mamry-2bzmot', name: '2 bzmot (ZT Mamry)', sidc: 'SFGPUCIZ---F---', formation: 'zt-mamry', pos: [22.2, 54.2] },
];
const channels = [
  { id: 'dd', name: 'Dywizja', kind: 'superior' },
  { id: 'zt-mamry', name: 'ZT Mamry', kind: 'neighbor' },
];
const byId = o.indexById(units);

describe('T13.2 — formacje sąsiadów: ORBAT', () => {
  test('formationRootId: wprost i przez łańcuch parent; własne siły → null', () => {
    assert.equal(o.formationRootId(byId.get('mamry-1bzmot'), byId), 'zt-mamry');
    assert.equal(o.formationRootId(byId.get('mamry-1bzmot-1k'), byId), 'zt-mamry');
    assert.equal(o.formationRootId(byId.get('b1-1k'), byId), null);
    assert.equal(o.formationRootId(byId.get('zt-mamry'), byId), null);
    assert.equal(o.isNeighbourUnit(byId.get('mamry-2bzmot'), byId), true);
  });

  test('mergeChannels: jednostki formacji sąsiada nie dostają kanałów, własne tak', () => {
    const ids = o.mergeChannels(channels, units).map((c) => c.id);
    assert.ok(ids.includes('b1') && ids.includes('b1-1k'));
    assert.ok(!ids.some((id) => id.startsWith('mamry-')), ids.join(','));
    assert.ok(ids.includes('zt-mamry'), 'sam sąsiad ma kanał ze scenariusza');
  });

  test('mergeChannels: nawet pluton podległy (parent) jednostce sąsiada nie ma kanału', () => {
    const ids = o.mergeChannels([], units).map((c) => c.id);
    assert.ok(!ids.includes('mamry-1bzmot-1k'));
  });

  test('splitUnits: formacja osobno, własne siły bez jednostek sąsiada, dowództwo sąsiada w „external”', () => {
    const { own, external, formation } = o.splitUnits(units, channels);
    assert.deepEqual(own.map((u) => u.id), ['hq', 'b1', 'b1-1k']);
    assert.deepEqual(external.map((e) => e.unit.id), ['dd', 'zt-mamry']);
    assert.deepEqual(formation.map((u) => u.id), ['mamry-1bzmot', 'mamry-1bzmot-1k', 'mamry-2bzmot']);
  });

  test('splitUnits: dowództwo znane tylko z formation (bez kanału) też trafia do „external”', () => {
    const { external, own } = o.splitUnits(units, []);
    assert.deepEqual(external.map((e) => [e.unit.id, e.channel]), [['zt-mamry', null]]);
    assert.ok(own.some((u) => u.id === 'dd'));
  });

  test('formationTree: korzeń = sąsiad, dzieci = jego jednostki (i ich podwładni)', () => {
    const { formation } = o.splitUnits(units, channels);
    const tree = o.formationTree(byId.get('zt-mamry'), formation);
    assert.equal(tree.unit.id, 'zt-mamry');
    assert.deepEqual(tree.children.map((c) => c.unit.id), ['mamry-1bzmot', 'mamry-2bzmot']);
    assert.deepEqual(tree.children[0].children.map((c) => c.unit.id), ['mamry-1bzmot-1k']);
    assert.equal(o.formationTree(byId.get('dd'), formation).children.length, 0);
  });

  test('buildTree i childrenOf uwzględniają formation jak parent', () => {
    const mamry = o.buildTree(units).find((r) => r.unit.id === 'zt-mamry');
    assert.deepEqual(mamry.children.map((c) => c.unit.id), ['mamry-1bzmot', 'mamry-2bzmot']);
    assert.deepEqual(o.childrenOf(units, 'zt-mamry').map((u) => u.id), ['mamry-1bzmot', 'mamry-2bzmot']);
  });

  test('widoczność wg poziomu: batalion sąsiada widoczny, jego kompania dopiero na poziomie kompanii', () => {
    const vis = (id, level) => o.isUnitVisible(byId.get(id), byId, level);
    assert.equal(vis('mamry-1bzmot', 'battalion'), true);
    assert.equal(vis('mamry-1bzmot-1k', 'battalion'), false);
    assert.equal(vis('mamry-1bzmot-1k', 'company'), true);
  });

  test('linie hierarchii: dowództwo sąsiada → jego jednostki oznaczone jako neighbour, własne bez', () => {
    const links = o.hierarchyLinks(units, 'company');
    const find = (p, c) => links.find((l) => l.parent === p && l.child === c);
    assert.equal(find('zt-mamry', 'mamry-1bzmot').neighbour, true);
    assert.equal(find('zt-mamry', 'mamry-2bzmot').neighbour, true);
    assert.equal(find('mamry-1bzmot', 'mamry-1bzmot-1k').neighbour, true);
    assert.equal(find('hq', 'b1').neighbour, false);
    assert.ok(!o.hierarchyLinks(units, 'battalion').some((l) => l.child === 'mamry-1bzmot-1k'));
  });
});

describe('T13.2 — omnibox i karta jednostki sąsiada', () => {
  const data = { units, channels, contacts: [], assets: [], places: [], notes: [] };

  test('omnibox grupuje formacje sąsiadów i ich dowództwo w „Sąsiedzi”', () => {
    const res = searchOmnibox('mamry', 'all', data);
    const nb = res.filter((r) => r.group === 'neighbour');
    assert.ok(nb.length >= 3);
    assert.ok(nb.some((r) => r.id === 'mamry-1bzmot' && /sąsiad/.test(r.sub)));
    assert.ok(!res.some((r) => r.group === 'unit' && r.id.includes('mamry')));
    assert.deepEqual(searchOmnibox('hancza', 'all', data).map((r) => r.group), ['unit']);
  });
  test('filtr „Jednostki” obejmuje też sąsiadów', () => {
    assert.ok(searchOmnibox('mamry', 'unit', data).some((r) => r.group === 'neighbour'));
  });

  test('karta jednostki sąsiada ma adnotację „Sąsiad — brak dowodzenia”, własnej jednostki — nie', () => {
    const html = unitCard(byId.get('mamry-1bzmot'), byId, o.childrenOf(units, 'mamry-1bzmot'), { neighbour: true, header: false });
    assert.ok(html.includes('Sąsiad — brak dowodzenia'));
    assert.ok(html.includes('ZT Mamry'), 'przełożony z formation widoczny w podporządkowaniu');
    assert.ok(!unitCard(byId.get('b1'), byId, [], { header: false }).includes('brak dowodzenia'));
  });
});

describe('T12.8/T13.2 — schemat i walidator', () => {
  test('biała lista pól gracza zawiera track i formation (jednostki) oraz formation (linie)', () => {
    assert.ok(PLAYER_FIELDS.units.includes('track') && PLAYER_FIELDS.units.includes('formation'));
    assert.ok(PLAYER_FIELDS.lines.includes('formation'));
  });

  test('checkTrack: ≥ 2 poprawne punkty, ostatni = pos', () => {
    assert.ok(checkTrack([[21, 54]], [21, 54]).error);
    assert.ok(checkTrack([[21, 54], [200, 0]], [21, 54]).error);
    assert.ok(checkTrack('x', [21, 54]).error);
    assert.deepEqual(checkTrack([[21, 54], [21.1, 54.1]], [21.1, 54.1]), {});
    assert.ok(checkTrack([[21, 54], [21.1, 54.1]], [21.5, 54.1]).warn);
    assert.deepEqual(checkTrack([[21, 54], [21.1, 54.1000005]], [21.1, 54.1]), {}, 'tolerancja 1e-6');
  });

  describe('walidator na kopii scenariusza', () => {
    let sc;
    const writeTurn = (n, mutate) => {
      const base = {
        turn: n,
        time: `2026-05-14T0${6 + n * 2}:00:00+02:00`,
        units: [
          { id: 'hq', name: 'ZT', sidc: 'SFGPUCIZ--AH---', pos: [22.9, 54.1] },
          { id: 'zt-mamry', name: 'ZT Mamry', sidc: 'SFGPUCIZ--AH---', pos: [22.0, 54.2] },
          { id: 'mamry-1', name: '1 bzmot (Mamry)', sidc: 'SFGPUCIZ---F---', formation: 'zt-mamry', pos: [22.1, 54.25] },
        ],
        contacts: [],
        lines: [],
      };
      mutate?.(base);
      return sc.write(`player/turns/${String(n).padStart(3, '0')}.json`, base);
    };
    before(async () => {
      sc = await makeScenario({ turns: [] });
      await fs.rm(path.join(sc.dir, 'umpire'), { recursive: true, force: true });
      await sc.write('scenario.json', { schemaVersion: 1, id: 'test', title: 'T', timezone: 'Europe/Warsaw', start: '2026-05-14T06:00:00+02:00', turnMinutes: 120, channels: [{ id: 'dow', name: 'D', kind: 'superior' }] });
    });
    after(() => fs.rm(sc.dir, { recursive: true, force: true }));

    test('poprawna formacja sąsiada przechodzi', async () => {
      await writeTurn(0);
      assert.deepEqual((await validateScenario(sc.dir)).errors, []);
    });
    test('formation wskazuje nieistniejącą jednostkę → błąd', async () => {
      await writeTurn(0, (d) => (d.units[2].formation = 'nie-ma'));
      assert.ok((await validateScenario(sc.dir)).errors.some((e) => e.includes('formation') && e.includes('nie istnieje')));
    });
    test('formation na samą siebie, na jednostkę z formation i jednoczesne parent+formation → błąd', async () => {
      await writeTurn(0, (d) => (d.units[2].formation = 'mamry-1'));
      assert.ok((await validateScenario(sc.dir)).errors.some((e) => e.includes('cykl')));
      await writeTurn(0, (d) => d.units.push({ id: 'mamry-2', name: 'x', sidc: 'SFGPUCIZ---F---', formation: 'mamry-1', pos: [22.3, 54.3] }));
      assert.ok((await validateScenario(sc.dir)).errors.some((e) => e.includes('musi wskazywać jednostkę bez parent')));
      await writeTurn(0, (d) => (d.units[2].parent = 'hq'));
      assert.ok((await validateScenario(sc.dir)).errors.some((e) => e.includes('jednocześnie parent i formation')));
    });
    test('linia z formation: poprawna przechodzi, wskazująca nieistniejącą jednostkę — błąd', async () => {
      await writeTurn(0, (d) => d.lines.push({ id: 'flot-m', kind: 'flot', label: 'FLOT Mamry', coords: [[22, 54], [22.2, 54.3]], formation: 'zt-mamry' }));
      assert.deepEqual((await validateScenario(sc.dir)).errors, []);
      await writeTurn(0, (d) => d.lines.push({ id: 'flot-m', kind: 'flot', label: 'x', coords: [[22, 54], [22.2, 54.3]], formation: 'brak' }));
      assert.ok((await validateScenario(sc.dir)).errors.some((e) => e.includes('lines[flot-m]')));
    });
    test('track: za krótki → błąd; ostatni punkt ≠ pos → uwaga; początek ≠ poprzednia pozycja → uwaga; poprawny bez uwag', async () => {
      await writeTurn(0);
      const move = (track) =>
        writeTurn(1, (d) => {
          d.units[0].pos = [22.95, 54.12];
          d.units[0].track = track;
        });
      await move([[22.9, 54.1], [22.95, 54.12]]);
      let r = await validateScenario(sc.dir);
      assert.deepEqual(r.errors, []);
      assert.deepEqual(r.warnings.filter((w) => w.includes('track')), []);
      await move([[22.95, 54.12]]);
      assert.ok((await validateScenario(sc.dir)).errors.some((e) => e.includes('track')));
      await move([[22.9, 54.1], [22.96, 54.12]]);
      r = await validateScenario(sc.dir);
      assert.deepEqual(r.errors, []);
      assert.ok(r.warnings.some((w) => w.includes('ostatni punkt track')));
      await move([[23.5, 54.5], [22.95, 54.12]]);
      assert.ok((await validateScenario(sc.dir)).warnings.some((w) => w.includes('pierwszy punkt track')));
    });
    test('biała lista: nieznane pole jednostki nadal błędem, track i formation nie', async () => {
      await writeTurn(0, (d) => (d.units[0].supply = { fuel: 1 }));
      const r = await validateScenario(sc.dir);
      assert.ok(r.errors.some((e) => e.includes('„supply”')));
      assert.ok(!r.errors.some((e) => e.includes('„track”') || e.includes('„formation”')));
    });
  });
});

describe('T13.2 — serwer: brak kanału do jednostki sąsiada', () => {
  let app, sc;
  before(async () => {
    sc = await makeScenario();
    await sc.write('scenario.json', {
      id: 'test',
      title: 'T',
      turnMinutes: 120,
      timezone: 'Europe/Warsaw',
      channels: [{ id: 'dow', name: 'D', kind: 'superior' }, { id: 'zt-mamry', name: 'ZT Mamry', kind: 'neighbor' }],
    });
    await sc.write('player/turns/001.json', { turn: 1, time: '2026-05-14T08:00:00+02:00', units, contacts: [] });
    app = await startApp(sc.dir);
  });
  after(async () => {
    await app.close();
    await fs.rm(sc.dir, { recursive: true, force: true });
  });

  test('POST do jednostki z formation → 400, do jej podwładnego przez parent → 400', async () => {
    for (const channel of ['mamry-1bzmot', 'mamry-1bzmot-1k', 'mamry-2bzmot']) {
      const res = await app.post('/api/outbox', { channel, text: 'Rozkaz' });
      assert.equal(res.status, 400, channel);
      assert.match((await res.json()).error, /sąsiad/i);
    }
  });
  test('własna kompania, kanał przełożonego i kanał sąsiada ze scenariusza nadal działają', async () => {
    for (const channel of ['b1-1k', 'dow', 'zt-mamry']) {
      assert.equal((await app.post('/api/outbox', { channel, text: 'Meldunek' })).status, 201, channel);
    }
  });
  test('isNeighbourFormationUnit: pętla w parent nie zawiesza', () => {
    const loop = [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }];
    assert.equal(isNeighbourFormationUnit(loop, 'a'), false);
    assert.equal(isNeighbourFormationUnit(units, 'mamry-1bzmot'), true);
    assert.equal(isNeighbourFormationUnit(units, 'b1'), false);
  });
});

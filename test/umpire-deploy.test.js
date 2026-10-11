import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { deploy, deployTree, distanceM, bearingDeg, toMeters, normalizeFormation } from '../tools/umpire/deploy.mjs';
import { pointInPolygon, nudgeOutOfWater, preferCover, elementsToPolygons } from '../tools/umpire/terrain.mjs';

const C = [22.88, 54.27];
const PLT = 'SFGPUCIZ---D---';
const platoons = (n = 3) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, sidc: PLT }));
const bat = () => [
  { id: 'k1', sidc: 'SFGPUCIZ---E---' }, { id: 'k2', sidc: 'SFGPUCIZ---E---' }, { id: 'k3', sidc: 'SFGPUCIZ---E---' },
  { id: 'kw', sidc: 'SFGPUCFM---E---' },
];

/** Współrzędne [f, l] elementu względem środka w układzie azymutu `facing` (f do przodu, l w prawo). */
function local(pos, facing, center = C) {
  const [e, n] = toMeters(center, pos);
  const t = (facing * Math.PI) / 180;
  return [e * Math.sin(t) + n * Math.cos(t), e * Math.cos(t) - n * Math.sin(t)];
}
const pairwise = (ps) => {
  const d = [];
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) d.push(distanceM(ps[i], ps[j]));
  return d.sort((a, b) => a - b);
};
const minPair = (ps) => Math.min(...pairwise(ps));
const relDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]) / Math.max(x, b[i])));

describe('deploy: geodezja', () => {
  test('metry i stopnie: 1000 m na wschód to ok. 0,015 stopnia długości na 54,27 N', () => {
    const r = deploy({ center: C, formation: 'marsz', facing: 90, children: platoons(2), seed: 'g', spacing_m: 1000 });
    const d = distanceM(r.p1, r.p2);
    assert.ok(d > 850 && d < 1150, `d=${d}`);
    assert.ok(Math.abs(r.p1[0] - r.p2[0]) > 0.012);
  });
  test('aliasy formacji', () => {
    assert.equal(normalizeFormation('defense'), 'obrona');
    assert.equal(normalizeFormation('Wyczekujące'), 'wyczekujace');
    assert.throws(() => normalizeFormation('szyk-klinowy'));
  });
});

describe('deploy: obrona i natarcie', () => {
  test('elementy przednie dalej wzdłuż azymutu niż odwód i wsparcie', () => {
    for (const facing of [0, 90, 200, 330]) {
      for (const seed of ['a', 'b', 'c', 'd']) {
        const ch = [...platoons(3), { id: 'kw', sidc: 'SFGPUCFM---E---' }];
        const r = deploy({ center: C, formation: 'obrona', facing, frontage_m: 1800, children: ch, seed });
        const f = (id) => local(r[id], facing)[0];
        const m = r._meta;
        for (const fw of m.forward) for (const dp of m.depth) assert.ok(f(fw) > f(dp) + 200, `${seed}/${facing}: ${fw} vs ${dp}`);
        for (const fw of m.forward) assert.ok(f(fw) > f('kw') + 400);
        assert.equal(m.forward.length + m.depth.length, 3);
      }
    }
  });
  test('rozstaw: odwód 500–800 m za centrum, wsparcie 800–1500 m, dowództwo 300–500 m', () => {
    const r = deploy({ center: C, formation: 'obrona', facing: 0, frontage_m: 2000, children: [...platoons(3), { id: 'kw', sidc: 'SFGPUCFM---E---' }], seed: 'rng' });
    const m = r._meta;
    const depF = m.depth.map((id) => local(r[id], 0)[0]);
    const kwF = local(r.kw, 0)[0];
    assert.ok(-depF[0] > 450 && -depF[0] < 850, `depth f=${depF[0]}`);
    assert.ok(-kwF > 700 && -kwF < 1600, `kw f=${kwF}`);
    const hq = local(r._hq, 0)[0];
    assert.ok(-hq > 250 && -hq < 550, `hq f=${hq}`);
    assert.ok(minPair(m.forward.map((id) => r[id])) > 300);
  });
  test('szeroki odcinek (3500 m): trzy plutony w linii; forward:3 też; wąski: 2 + odwód', () => {
    const wide = deploy({ center: C, formation: 'obrona', facing: 0, frontage_m: 3500, children: platoons(3), seed: 's' });
    assert.equal(wide._meta.forward.length, 3);
    assert.equal(wide._meta.variant, 'w-linii');
    const f3 = deploy({ center: C, formation: 'obrona', facing: 0, frontage_m: 1500, forward: 3, children: platoons(3), seed: 's' });
    assert.equal(f3._meta.depth.length, 0);
    const narrow = deploy({ center: C, formation: 'obrona', facing: 0, frontage_m: 1500, children: platoons(3), seed: 's' });
    assert.equal(narrow._meta.forward.length, 2);
  });
  test('natarcie: front ok. 1000 m dla kompanii, 3000 m dla batalionu; skierowane na azymut', () => {
    const r = deploy({ center: C, formation: 'natarcie', facing: 45, children: platoons(3), seed: 'n1', variant: 'dwa-i-odwod' });
    const m = r._meta;
    assert.ok(m.frontage_m >= 900 && m.frontage_m <= 1100);
    for (const fw of m.forward) for (const dp of m.depth) assert.ok(local(r[fw], 45)[0] > local(r[dp], 45)[0]);
    const b = deploy({ center: C, formation: 'natarcie', facing: 45, children: bat(), seed: 'n2' });
    assert.ok(b._meta.frontage_m >= 2700 && b._meta.frontage_m <= 3300);
    assert.equal(b._meta.level, 'battalion');
  });
  test('batalion w obronie: front 4000–6000 m, wsparcie głębiej niż w kompanii', () => {
    const b = deploy({ center: C, formation: 'obrona', facing: 330, children: bat(), seed: 'b' });
    assert.ok(b._meta.frontage_m >= 4000 && b._meta.frontage_m <= 6000);
    assert.ok(-local(b.kw, 330)[0] > 1100);
  });
});

describe('deploy: determinizm i jitter', () => {
  const run = (seed, facing = 120) => deploy({ center: C, formation: 'obrona', facing, frontage_m: 2000, children: platoons(3), seed });
  test('to samo ziarno daje ten sam układ, inne ziarno inny', () => {
    assert.deepEqual(run('x'), run('x'));
    assert.notDeepEqual(run('x'), run('y'));
  });
  test('orientacja układu odchyla się od zadanej o co najwyżej 10 stopni', () => {
    for (const seed of ['1', '2', '3', '4', '5', '6', '7', '8']) {
      const r = deploy({ center: C, formation: 'marsz', facing: 90, spacing_m: 500, children: platoons(2), seed });
      const b = bearingDeg(r.p2, r.p1);
      assert.ok(Math.abs(b - 90) <= 12, `seed ${seed}: ${b}`);
      assert.ok(Math.abs(r._meta.facing - 90) <= 10 + 1e-9);
    }
  });
  test('położenia ograniczone parametrami i faktycznie zróżnicowane', () => {
    const xs = [];
    for (let i = 0; i < 20; i++) {
      const r = deploy({ center: C, formation: 'obrona', facing: 0, frontage_m: 2000, forward: 3, children: platoons(3), seed: `j${i}` });
      for (const id of ['p1', 'p2', 'p3']) {
        const [f, l] = local(r[id], 0);
        assert.ok(Math.abs(f) < 800 && Math.abs(l) < 1300, `${f}/${l}`);
      }
      xs.push(local(r.p2, 0)[0]);
    }
    assert.ok(Math.max(...xs) - Math.min(...xs) > 50);
  });
});

describe('deploy: marsz', () => {
  const route = [[22.8, 54.2], [22.85, 54.22], [22.9, 54.23], [22.95, 54.26], [23.0, 54.27]];
  const arcOf = (p) => {
    let best = { d: Infinity, s: 0 };
    let acc = 0;
    for (let i = 1; i < route.length; i++) {
      const [ax, ay] = toMeters(p, route[i - 1]);
      const [bx, by] = toMeters(p, route[i]);
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy);
      const t = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / (len * len)));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d < best.d) best = { d, s: acc + t * len };
      acc += len;
    }
    return best.s;
  };
  test('kolumna wzdłuż trasy: zachowuje kolejność, rozstaw plutonów 150–300 m (±15%)', () => {
    for (const seed of ['m1', 'm2', 'm3']) {
      const ch = platoons(4);
      const r = deploy({ center: [22.9, 54.23], formation: 'marsz', route, children: ch, seed });
      const arcs = ch.map((c) => arcOf(r[c.id]));
      for (let i = 1; i < arcs.length; i++) {
        const gap = arcs[i - 1] - arcs[i];
        assert.ok(gap > 150 * 0.85 - 30 && gap < 300 * 1.15 + 30, `gap ${gap}`);
      }
      for (const c of ch) assert.ok(distanceM(r[c.id], [22.9, 54.23]) < 1200);
    }
  });
  test('marsz bez trasy: wzdłuż azymutu, pierwszy na czele; kompanie 1–2 km', () => {
    const r = deploy({ center: C, formation: 'marsz', facing: 270, children: bat().slice(0, 3), seed: 'q' });
    assert.ok(local(r.k1, 270)[0] > local(r.k2, 270)[0]);
    assert.ok(local(r.k2, 270)[0] > local(r.k3, 270)[0]);
    const gap = local(r.k1, 270)[0] - local(r.k2, 270)[0];
    assert.ok(gap > 800 && gap < 2400, `gap ${gap}`);
  });
});

describe('deploy: wyczekiwanie, artyleria, obserwacja', () => {
  test('rejon wyczekujący: promień do 700 m, min. 150 m odstępu', () => {
    for (let i = 0; i < 20; i++) {
      const r = deploy({ center: C, formation: 'wyczekujace', children: platoons(3), seed: `w${i}` });
      for (const id of ['p1', 'p2', 'p3']) assert.ok(distanceM(r[id], C) <= 701);
      assert.ok(minPair(['p1', 'p2', 'p3'].map((k) => r[k])) >= 150 - 1e-6);
    }
  });
  test('artyleria: 300–600 m między stanowiskami, nie na jednej prostej', () => {
    for (let i = 0; i < 15; i++) {
      const ch = Array.from({ length: 3 }, (_, k) => ({ id: `b${k}`, sidc: 'SFGPUCFHE--D---' }));
      const r = deploy({ center: C, formation: 'artyleria', facing: 10, children: ch, seed: `a${i}` });
      const pts = ch.map((c) => toMeters(C, r[c.id]));
      const area = Math.abs((pts[1][0] - pts[0][0]) * (pts[2][1] - pts[0][1]) - (pts[2][0] - pts[0][0]) * (pts[1][1] - pts[0][1])) / 2;
      assert.ok(area > 15000, `area ${area}`);
      const d01 = distanceM(r.b0, r.b1);
      assert.ok(d01 > 280 && d01 < 900, `d ${d01}`);
    }
  });
  test('obserwacja: posterunki 800–2500 m od siebie wzdłuż linii prostopadłej do azymutu', () => {
    const ch = Array.from({ length: 3 }, (_, k) => ({ id: `r${k}`, sidc: 'SFGPUCR----D---' }));
    const r = deploy({ center: C, formation: 'obserwacja', facing: 0, children: ch, seed: 'o' });
    const l = ch.map((c) => local(r[c.id], 0)[1]);
    for (let i = 1; i < 3; i++) {
      const g = Math.abs(l[i] - l[i - 1]);
      assert.ok(g > 650 && g < 2900, `g ${g}`);
    }
  });
});

describe('deploy: brak jednego kanonicznego kształtu', () => {
  const ch = platoons(3);
  const scen = {
    'obrona szeroka': { formation: 'obrona', facing: 330, frontage_m: 3400, seed: 'A' },
    'obrona wąska': { formation: 'obrona', facing: 90, frontage_m: 1500, seed: 'B' },
    natarcie: { formation: 'natarcie', facing: 200, seed: 'C' },
    wyczekujące: { formation: 'wyczekujace', facing: 0, seed: 'D' },
    obserwacja: { formation: 'obserwacja', facing: 45, seed: 'E' },
    artyleria: { formation: 'artyleria', facing: 270, seed: 'F' },
    marsz: { formation: 'marsz', facing: 15, seed: 'G' },
  };
  test('kompanie o różnych zadaniach mają wyraźnie różne układy względne (nie obrócone kopie)', () => {
    const sigs = Object.entries(scen).map(([name, s]) => [name, pairwise(Object.values(deploy({ center: C, children: ch, ...s })))]);
    for (let i = 0; i < sigs.length; i++) {
      for (let j = i + 1; j < sigs.length; j++) {
        const d = relDiff(sigs[i][1], sigs[j][1]);
        assert.ok(d > 0.2, `${sigs[i][0]} ~ ${sigs[j][0]}: ${d.toFixed(2)}`);
      }
    }
  });
  test('to samo zadanie, inne azymuty i ziarna: różne proporcje (nie sztywny wzór)', () => {
    const sigs = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].map((seed, i) => pairwise(Object.values(deploy({ center: C, children: ch, formation: 'obrona', facing: i * 60, seed }))));
    let different = 0;
    for (let i = 0; i < sigs.length; i++) for (let j = i + 1; j < sigs.length; j++) if (relDiff(sigs[i], sigs[j]) > 0.15) different++;
    assert.ok(different >= 10, `różnych par: ${different}/15`);
  });
  test('warianty zależne od ziarna: obrona (w linii lub 2 + odwód), natarcie (3 warianty), odwód za lewym, środkiem lub prawym', () => {
    const od = new Set();
    const na = new Set();
    const sides = new Set();
    for (let i = 0; i < 60; i++) {
      const o = deploy({ center: C, children: ch, formation: 'obrona', facing: 0, seed: `v${i}` });
      od.add(o._meta.variant);
      const n = deploy({ center: C, children: ch, formation: 'natarcie', facing: 0, seed: `v${i}` });
      na.add(n._meta.variant);
      if (o._meta.depth.length) {
        const dl = local(o[o._meta.depth[0]], 0)[1];
        const fl = o._meta.forward.map((id) => local(o[id], 0)[1]).sort((a, b) => a - b);
        sides.add(dl < fl[0] + 200 ? 'L' : dl > fl.at(-1) - 200 ? 'P' : 'S');
      }
    }
    assert.ok(od.has('w-linii') && od.has('dwa-i-odwod'), [...od].join());
    assert.ok(na.size >= 3, [...na].join());
    assert.ok(sides.size >= 2, [...sides].join());
  });
  test('rozstaw w linii jest nierówny', () => {
    let uneven = 0;
    for (let i = 0; i < 20; i++) {
      const r = deploy({ center: C, children: ch, formation: 'obrona', facing: 0, frontage_m: 3600, seed: `u${i}` });
      const l = ['p1', 'p2', 'p3'].map((id) => local(r[id], 0)[1]).sort((a, b) => a - b);
      const g1 = l[1] - l[0];
      const g2 = l[2] - l[1];
      if (Math.abs(g1 - g2) / Math.max(g1, g2) > 0.12) uneven++;
    }
    assert.ok(uneven >= 8, `nierównych: ${uneven}/20`);
  });
});

describe('deployTree', () => {
  const units = [
    { id: 'bn', sidc: 'SFGPUCIZ---F---', pos: C },
    ...[1, 2, 3].map((k) => ({ id: `k${k}`, parent: 'bn', sidc: 'SFGPUCIZ---E---', pos: C })),
    ...[1, 2, 3].flatMap((k) => [1, 2, 3].map((p) => ({ id: `k${k}p${p}`, parent: `k${k}`, sidc: PLT, pos: C }))),
  ];
  test('rozstawia batalion, kompanie i plutony rekurencyjnie, deterministycznie', () => {
    const plan = { bn: { formation: 'obrona', facing: 330, frontage_m: 5000, seed: 'T' } };
    const a = deployTree(units, 'bn', plan);
    assert.deepEqual(a, deployTree(units, 'bn', plan));
    assert.equal(Object.keys(a).length, 12);
    for (const k of [1, 2, 3]) {
      for (let p = 1; p <= 3; p++) assert.ok(distanceM(a[`k${k}`], a[`k${k}p${p}`]) < 2500);
    }
  });
  test('marsz batalionu dziedziczy formację po przełożonym', () => {
    const route = [[22.7, 54.2], [22.9, 54.3]];
    const a = deployTree(units, 'bn', { bn: { formation: 'marsz', route, seed: 'M' } });
    assert.equal(Object.keys(a).length, 12);
  });
});

describe('terrain: woda i las', () => {
  const lake = {
    outer: [[22.90, 54.20], [22.92, 54.20], [22.92, 54.21], [22.90, 54.21], [22.90, 54.20]],
    holes: [[[22.908, 54.204], [22.912, 54.204], [22.912, 54.206], [22.908, 54.206], [22.908, 54.204]]],
  };
  test('punkt w poligonie, dziura jest wyspą', () => {
    assert.equal(pointInPolygon([22.91, 54.2075], lake), true);
    assert.equal(pointInPolygon([22.91, 54.205], lake), false);
    assert.equal(pointInPolygon([22.95, 54.205], lake), false);
  });
  test('nudgeOutOfWater: punkt z wody ląduje ok. 60 m od brzegu, punkty na lądzie bez zmian', async () => {
    const land = [22.95, 54.205];
    const inLake = [22.9195, 54.2050];
    const out = await nudgeOutOfWater({ a: inLake, b: land }, null, { polygons: [lake] });
    assert.deepEqual(out.b, land);
    assert.equal(pointInPolygon(out.a, lake), false);
    assert.ok(out.a[0] > 22.92);
    const dist = distanceM([22.92, 54.205], out.a);
    assert.ok(dist > 45 && dist < 80, `dist ${dist}`);
    assert.equal(out.moved.length, 1);
    const arr = await nudgeOutOfWater([[22.905, 54.2075]], null, { polygons: [lake] });
    assert.equal(pointInPolygon(arr[0], lake), false);
  });
  test('preferCover: punkt w pobliżu lasu trafia do lasu, daleki zostaje', async () => {
    const forest = { outer: [[22.93, 54.20], [22.95, 54.20], [22.95, 54.21], [22.93, 54.21], [22.93, 54.20]], holes: [] };
    const out = await preferCover({ near: [22.926, 54.205], far: [22.8, 54.3] }, 500, null, { polygons: [forest] });
    assert.equal(pointInPolygon(out.near, forest), true);
    assert.deepEqual(out.far, [22.8, 54.3]);
  });
  test('elementsToPolygons skleja relację multipolygon z odcinków', () => {
    const g = (pts) => pts.map(([lon, lat]) => ({ lon, lat }));
    const polys = elementsToPolygons([{
      type: 'relation',
      members: [
        { type: 'way', role: 'outer', geometry: g([[0, 0], [1, 0], [1, 1]]) },
        { type: 'way', role: 'outer', geometry: g([[1, 1], [0, 1], [0, 0]]) },
      ],
    }]);
    assert.equal(polys.length, 1);
    assert.equal(pointInPolygon([0.5, 0.5], polys[0]), true);
  });
});

describe('CLI', () => {
  test('--write zmienia tylko pos potomków, zachowuje resztę pliku', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ks-deploy-'));
    const file = path.join(dir, 'turn.json');
    const data = {
      turn: 4,
      units: [
        { id: 'k', name: 'K', sidc: 'SFGPUCIZ---E---', pos: C, strength: 1, extra: { a: 1 } },
        ...[1, 2, 3].map((i) => ({ id: `k-${i}p`, name: `P${i}`, parent: 'k', sidc: PLT, pos: C, strength: 0.9 })),
        { id: 'other', name: 'O', sidc: PLT, pos: [23, 54.1] },
      ],
    };
    await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'umpire', 'deploy-cli.mjs');
    execFileSync('node', [cli, file, '--unit', 'k', '--formation', 'obrona', '--facing', '340', '--write'], { stdio: 'pipe' });
    const raw = await readFile(file, 'utf8');
    const after = JSON.parse(raw);
    assert.deepEqual(after.units[0], data.units[0]);
    assert.deepEqual(after.units[4], data.units[4]);
    for (const i of [1, 2, 3]) {
      assert.notDeepEqual(after.units[i].pos, C);
      assert.equal(after.units[i].strength, 0.9);
    }
    assert.ok(raw.endsWith('}\n'));
  });
});

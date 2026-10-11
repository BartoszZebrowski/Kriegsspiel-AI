// Testy narzędzia ręcznego rozstawiania: matematyka rzutowania i CLI pick.mjs (bez sieci i bez Chrome).
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { applyPicks, fitZoom, lonLatToPixel, main, parseAssign, pixelToLonLat, project, snapCenter } from '../tools/umpire/pick.mjs';
import { classify, collectUnits } from '../tools/umpire/terrain-view.mjs';

const SUWALKI = [22.9279, 54.0991];
const meta = { center: [22.9, 54.1], zoom: 13, size: [1200, 900], crs: 'EPSG:3857', tileSize: 256 };
const r6 = (v) => Math.round(v * 1e6) / 1e6;

// niezależny wzór (Mercator przez ln tan) do porównania
const refWorld = (lon, lat, z) => {
  const s = 256 * 2 ** z;
  const phi = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * s, (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * s];
};

test('środek widoku leży w środku zrzutu', () => {
  const [x, y] = lonLatToPixel(meta, ...meta.center);
  assert.ok(Math.abs(x - 600) < 1e-6 && Math.abs(y - 450) < 1e-6);
  const [lon, lat] = pixelToLonLat(meta, 600, 450);
  assert.ok(Math.abs(lon - 22.9) < 1e-9 && Math.abs(lat - 54.1) < 1e-9);
});

test('znany punkt (Suwałki) ląduje w oczekiwanym pikselu', () => {
  const [cx, cy] = refWorld(...meta.center, meta.zoom);
  const [sx, sy] = refWorld(...SUWALKI, meta.zoom);
  const [x, y] = lonLatToPixel(meta, ...SUWALKI);
  assert.ok(Math.abs(x - (600 + sx - cx)) < 1e-6);
  assert.ok(Math.abs(y - (450 + sy - cy)) < 1e-6);
  // zoom 13, szer. ~54°: ok. 11,2 m/px; 0,0279° długości ≈ 1820 m ≈ 163 px na E od środka
  assert.ok(x > 740 && x < 780, `x=${x}`);
  assert.ok(y > 440 && y < 460, `y=${y}`);
});

test('przesunięcie o 100 px na E/S daje właściwy kierunek i skalę', () => {
  const [lon, lat] = pixelToLonLat(meta, 700, 550);
  assert.ok(lon > meta.center[0] && lat < meta.center[1]);
  const mpp = (40075016.686 * Math.cos((54.1 * Math.PI) / 180)) / (256 * 2 ** 13);
  const dxM = (lon - meta.center[0]) * (Math.PI / 180) * 6378137 * Math.cos((54.1 * Math.PI) / 180);
  assert.ok(Math.abs(dxM - 100 * mpp) / (100 * mpp) < 0.01);
});

test('round trip piksel → lonlat → piksel: błąd < 0.5 px (także po zaokrągleniu do 6 miejsc)', () => {
  for (const z of [8, 11, 13, 15, 17]) {
    const m = { ...meta, zoom: z };
    for (const [x, y] of [[0, 0], [1200, 900], [412, 236], [599.5, 449.5], [1033, 17], [5, 880]]) {
      const [lon, lat] = pixelToLonLat(m, x, y);
      const [bx, by] = lonLatToPixel(m, lon, lat);
      assert.ok(Math.hypot(bx - x, by - y) < 1e-6, `z${z} ${x},${y}`);
      const [bx2, by2] = lonLatToPixel(m, r6(lon), r6(lat));
      assert.ok(Math.hypot(bx2 - x, by2 - y) < 0.5, `z${z} zaokr. ${x},${y}`);
    }
  }
});

test('snapCenter daje całkowity piksel początku widoku; fitZoom mieści bbox', () => {
  const c = snapCenter([22.88512, 54.25601], 13, [1200, 900]);
  const p = project(c[0], c[1], 13);
  assert.ok(Math.abs(p.x - 600 - Math.round(p.x - 600)) < 1e-6);
  assert.ok(Math.abs(p.y - 450 - Math.round(p.y - 450)) < 1e-6);
  const z = fitZoom([22.8, 54.2, 23.0, 54.3], [1200, 900]);
  const a = project(22.8, 54.3, z);
  const b = project(23.0, 54.2, z);
  assert.ok(b.x - a.x <= 1200 && b.y - a.y <= 900);
  const a1 = project(22.8, 54.3, z + 1);
  const b1 = project(23.0, 54.2, z + 1);
  assert.ok(b1.x - a1.x > 1200 || b1.y - a1.y > 900);
});

test('parseAssign: poprawne i błędne zapisy', () => {
  assert.deepEqual(parseAssign('a-1=10,20'), { id: 'a-1', pts: [[10, 20]] });
  assert.deepEqual(parseAssign('k=1,2;3.5,4'), { id: 'k', pts: [[1, 2], [3.5, 4]] });
  assert.throws(() => parseAssign('brak'));
  assert.throws(() => parseAssign('a=1'));
});

const turn = () => ({
  turn: 5,
  extra: { zachowaj: [1, 2, 3] },
  units: [
    { id: 'k', sidc: 'SFGPUCIZ---E---', pos: [22.9, 54.1], name: 'Kompania', strength: 0.9 },
    { id: 'k-1p', sidc: 'SFGPUCIZ---D---', pos: [22.9, 54.1], parent: 'k', status: 'x' },
    { id: 'k-2p', sidc: 'SFGPUCIZ---D---', pos: [22.91, 54.11], parent: 'k' },
    { id: 'e1', side: 'RU', sidc: 'SHGPUCIZ---F---', pos: [22.8, 54.3] },
  ],
});

test('applyPicks zmienia tylko pos/track wskazanych jednostek', () => {
  const t = turn();
  const r = applyPicks(t, meta, { 'k-1p': [412, 236], nieistnieje: [1, 1] }, { k: [[100, 200], [300, 230], [500, 250]] });
  assert.deepEqual(r.missing, ['nieistnieje']);
  assert.deepEqual(t.units[2], turn().units[2]);
  assert.deepEqual(t.units[1].pos, r.picks['k-1p']);
  assert.deepEqual(t.units[0].pos, [22.9, 54.1]);
  assert.deepEqual(t.units[0].track.at(-1), [22.9, 54.1]); // koniec trasy = pos jednostki
  assert.equal(t.units[0].track.length, 3);
});

test('CLI pick: bez --write nic nie zapisuje, z --write zachowuje resztę pliku', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ks-pick-'));
  const log = console.log;
  const errLog = console.error;
  console.log = () => {};
  try {
    const metaPath = path.join(dir, 'v.png.json');
    const turnPath = path.join(dir, 'turn.json');
    await writeFile(metaPath, JSON.stringify(meta));
    const original = `${JSON.stringify(turn(), null, 2)}\n`;
    await writeFile(turnPath, original);

    const base = ['--meta', metaPath, '--turn', turnPath, '--set', 'k-1p=412,236', '--set', 'k-2p=530,198', '--track', 'k=100,200;150,230;200,250'];
    assert.equal(await main(base), 0);
    assert.equal(await readFile(turnPath, 'utf8'), original);

    assert.equal(await main([...base, '--write']), 0);
    const text = await readFile(turnPath, 'utf8');
    assert.ok(text.endsWith('}\n') && !text.endsWith('\n\n'));
    const out = JSON.parse(text);
    const orig = turn();
    assert.deepEqual(out.extra, orig.extra);
    assert.deepEqual(out.units[3], orig.units[3]);
    assert.equal(out.units[1].status, 'x');
    assert.equal(out.units[1].parent, 'k');
    assert.deepEqual(out.units[1].pos, pixelToLonLat(meta, 412, 236).map(r6));
    assert.deepEqual(out.units[2].pos, pixelToLonLat(meta, 530, 198).map(r6));
    assert.deepEqual(out.units[0].pos, orig.units[0].pos);
    assert.equal(out.units[0].track.length, 3);
    assert.deepEqual(out.units[0].track.at(-1), orig.units[0].pos);
    assert.equal(text, `${JSON.stringify(out, null, 2)}\n`);

    // nieznana jednostka = błąd, plik bez zmian
    const before = await readFile(turnPath, 'utf8');
    console.error = () => {};
    assert.equal(await main(['--meta', metaPath, '--turn', turnPath, '--set', 'zzz=1,1', '--write']), 1);
    assert.equal(await readFile(turnPath, 'utf8'), before);
  } finally {
    console.log = log;
    console.error = errLog;
    await rm(dir, { recursive: true, force: true });
  }
});

test('terrain-view: klasyfikacja jednostek i filtr --show', () => {
  const t = turn();
  t.units.push({ id: 'zt-mamry', sidc: 'SFGPUCIZ--AH---', pos: [23, 54] }, { id: 'm-1', formation: 'zt-mamry', sidc: 'SFGPUCIZ---F---', pos: [23, 54] });
  t.contacts = [{ id: 'c-1', sidc: 'SHGPUCIZ---F---', pos: [22.8, 54.3], uncertainty_m: 500 }];
  assert.equal(classify(t.units[3]), 'enemy');
  assert.equal(classify(t.units[0]), 'own');
  assert.equal(classify(t.units[4]), 'neighbor');
  assert.equal(classify(t.units[5]), 'neighbor');
  const ids = (show) => collectUnits({ turn: t, show: new Set(show), highlight: new Set(['k']) }).map((u) => u.id);
  assert.deepEqual(ids(['enemy']), ['e1']);
  assert.deepEqual(ids(['own']), ['k', 'k-1p', 'k-2p']);
  assert.deepEqual(ids(['contacts']), ['c-1']);
  assert.equal(collectUnits({ turn: t, show: new Set(['own']), highlight: new Set(['k']) })[0].highlight, true);
});

// Rozstawianie ręczne ze zrzutu mapy: przeliczanie pikseli ze zrzutu (terrain-view.mjs) na [lon, lat].
//
// node tools/umpire/pick.mjs --meta <out.png.json> --turn <turn.json> \
//   --set "1bzmot-2k-1p=412,236" --set "1bzmot-2k-2p=530,198" [--track "1bzmot-2k=100,200;150,230"] \
//   [--check-water] [--write]
//
// Bez --write tylko drukuje wyniki. Z --write zmienia WYŁĄCZNIE `pos` (i `track`) wskazanych jednostek,
// reszta pliku zostaje; zapis: JSON z wcięciem 2 spacje i końcowym newline.
// Matematyka: Web Mercator (EPSG:3857) jak w Leaflet, kafelek 256 px; współrzędne [długość, szerokość].
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TILE = 256;
const MAX_LAT = 85.0511287798;

/** Rozmiar świata w pikselach przy zoomie. */
export const worldSize = (zoom, tile = TILE) => tile * 2 ** zoom;

/** [lon, lat] → piksel świata (początek w NW rogu świata) przy zoomie. */
export function project(lon, lat, zoom, tile = TILE) {
  const s = worldSize(zoom, tile);
  const la = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const sin = Math.sin((la * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * s,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s,
  };
}

/** Piksel świata → [lon, lat]. */
export function unproject(x, y, zoom, tile = TILE) {
  const s = worldSize(zoom, tile);
  const lon = (x / s) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / s))) * 180) / Math.PI;
  return [lon, lat];
}

/** Piksel zrzutu (x w prawo, y w dół, 0,0 = lewy górny róg) → [lon, lat]. */
export function pixelToLonLat(meta, x, y) {
  const [w, h] = meta.size;
  const c = project(meta.center[0], meta.center[1], meta.zoom, meta.tileSize || TILE);
  return unproject(c.x + (x - w / 2), c.y + (y - h / 2), meta.zoom, meta.tileSize || TILE);
}

/** [lon, lat] → piksel zrzutu [x, y] (ułamkowy). */
export function lonLatToPixel(meta, lon, lat) {
  const [w, h] = meta.size;
  const t = meta.tileSize || TILE;
  const c = project(meta.center[0], meta.center[1], meta.zoom, t);
  const p = project(lon, lat, meta.zoom, t);
  return [w / 2 + (p.x - c.x), h / 2 + (p.y - c.y)];
}

/** Środek zaokrąglony tak, by lewy górny róg widoku leżał na całkowitym pikselu świata (Leaflet niczego nie zaokrągla). */
export function snapCenter(center, zoom, size, tile = TILE) {
  const p = project(center[0], center[1], zoom, tile);
  const snap = (v, dim) => Math.round(v - dim / 2) + dim / 2;
  return unproject(snap(p.x, size[0]), snap(p.y, size[1]), zoom, tile);
}

/** Największy zoom, przy którym bbox [minLon,minLat,maxLon,maxLat] mieści się w widoku. */
export function fitZoom(bbox, size, maxZoom = 17, tile = TILE) {
  for (let z = maxZoom; z >= 1; z--) {
    const a = project(bbox[0], bbox[3], z, tile);
    const b = project(bbox[2], bbox[1], z, tile);
    if (b.x - a.x <= size[0] && b.y - a.y <= size[1]) return z;
  }
  return 1;
}

/** Odległość w metrach (haversine). */
export function distM(a, b) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]);
  const dLon = rad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** "412,236" → [412, 236]; rzuca wyjątek przy złym formacie. */
export function parsePixel(str) {
  const m = String(str).trim().split(/[,\s]+/).map(Number);
  if (m.length !== 2 || m.some((v) => !Number.isFinite(v))) throw new Error(`Zły piksel: "${str}" (oczekiwano x,y)`);
  return m;
}

/** Parsuje "id=x,y;x,y;…" (też dla --set: "id=x,y"). */
export function parseAssign(str) {
  const i = String(str).indexOf('=');
  if (i < 1) throw new Error(`Zły zapis "${str}" (oczekiwano id=x,y)`);
  const id = str.slice(0, i).trim();
  const pts = str
    .slice(i + 1)
    .split(';')
    .filter((s) => s.trim())
    .map(parsePixel);
  return { id, pts };
}

/**
 * Nakłada wybory na turę (w miejscu). sets: { id: [x,y] }, tracks: { id: [[x,y],…] }.
 * Zwraca { picks: {id:[lon,lat]}, tracks: {id:[[lon,lat],…]}, missing: [id] }.
 */
export function applyPicks(turn, meta, sets = {}, tracks = {}) {
  const byId = new Map((turn.units || []).map((u) => [u.id, u]));
  const picks = {};
  const trk = {};
  const missing = [];
  for (const [id, [x, y]] of Object.entries(sets)) {
    const u = byId.get(id);
    if (!u) { missing.push(id); continue; }
    const [lon, lat] = pixelToLonLat(meta, x, y);
    picks[id] = [round6(lon), round6(lat)];
    u.pos = picks[id];
  }
  for (const [id, pts] of Object.entries(tracks)) {
    const u = byId.get(id);
    if (!u) { if (!missing.includes(id)) missing.push(id); continue; }
    const ll = pts.map(([x, y]) => pixelToLonLat(meta, x, y).map(round6));
    if (u.pos) ll[ll.length - 1] = [...u.pos]; // ostatni punkt = pozycja jednostki
    trk[id] = ll;
    u.track = ll;
  }
  return { picks, tracks: trk, missing };
}

// ---------- CLI ----------

function parseArgs(argv) {
  const f = { set: [], track: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    const val = next === undefined || next.startsWith('--') ? true : (i++, next);
    if (key === 'set' || key === 'track') f[key].push(val);
    else f[key] = val;
  }
  return f;
}

async function waterWarnings(picks) {
  const { findWater, pointInAny } = await import('./terrain.mjs');
  const pts = Object.values(picks);
  if (!pts.length) return [];
  const pad = 0.02;
  const bbox = [
    Math.min(...pts.map((p) => p[0])) - pad,
    Math.min(...pts.map((p) => p[1])) - pad,
    Math.max(...pts.map((p) => p[0])) + pad,
    Math.max(...pts.map((p) => p[1])) + pad,
  ];
  const water = await findWater(bbox);
  return Object.entries(picks).filter(([, p]) => pointInAny(p, water)).map(([id]) => id);
}

export async function main(argv) {
  const f = parseArgs(argv);
  if (!f.meta || !f.turn || (!f.set.length && !f.track.length)) {
    console.error('Użycie: node tools/umpire/pick.mjs --meta <out.png.json> --turn <turn.json> --set "id=x,y" [--set …] [--track "id=x,y;x,y;…"] [--check-water] [--write]');
    return 1;
  }
  const meta = JSON.parse(await readFile(f.meta, 'utf8'));
  const turn = JSON.parse(await readFile(f.turn, 'utf8'));
  const sets = {};
  for (const s of f.set) {
    const { id, pts } = parseAssign(s);
    if (pts.length !== 1) throw new Error(`--set "${s}": podaj jeden punkt`);
    sets[id] = pts[0];
  }
  const tracks = {};
  for (const s of f.track) {
    const { id, pts } = parseAssign(s);
    if (pts.length < 2) throw new Error(`--track "${s}": potrzeba ≥ 2 punktów`);
    tracks[id] = pts;
  }
  const before = new Map((turn.units || []).map((u) => [u.id, u.pos]));
  const { picks, tracks: trk, missing } = applyPicks(turn, meta, sets, tracks);
  for (const [id, p] of Object.entries(picks)) {
    const old = before.get(id);
    const shift = old ? `, przesunięcie ${Math.round(distM(old, p))} m` : '';
    const [bx, by] = lonLatToPixel(meta, p[0], p[1]);
    console.log(`${id}: [${p[0]}, ${p[1]}]  (piksel ${sets[id][0]},${sets[id][1]} → ${bx.toFixed(1)},${by.toFixed(1)}${shift})`);
  }
  for (const [id, pts] of Object.entries(trk)) console.log(`${id}: track ${pts.length} pkt, koniec [${pts[pts.length - 1].join(', ')}]`);
  if (missing.length) {
    console.error(`BŁĄD: brak jednostek w turze: ${missing.join(', ')}`);
    return 1;
  }
  for (const [id, [x, y]] of Object.entries(sets)) {
    if (x < 0 || y < 0 || x > meta.size[0] || y > meta.size[1]) console.warn(`UWAGA: ${id} poza zrzutem (${x},${y})`);
  }
  if (f['check-water']) {
    try {
      const wet = await waterWarnings(picks);
      for (const id of wet) console.warn(`UWAGA: ${id} leży w wodzie`);
      if (!wet.length) console.log('Woda: brak punktów w wodzie.');
    } catch (err) {
      console.warn(`Nie sprawdzono wody: ${err.message}`);
    }
  }
  if (f.write) {
    await writeFile(f.turn, `${JSON.stringify(turn, null, 2)}\n`);
    console.log(`Zapisano ${Object.keys(picks).length} pozycji w ${f.turn}`);
  } else {
    console.log('(bez --write: plik niezmieniony)');
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { console.error(err.message); process.exit(1); },
  );
}

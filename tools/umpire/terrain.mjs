// Kontrola terenu dla rozstawiania pododdziałów: woda i las z OpenStreetMap (Overpass API).
// Zapytanie o bbox idzie raz, wynik ląduje w tools/umpire/.cache/ i dalej działa offline.
// bbox = [minLon, minLat, maxLon, maxLat]. Poligon = { outer: [[lon,lat],…], holes: [[[lon,lat],…],…] }.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fromMeters, toMeters } from './deploy.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(HERE, '.cache');
const ENDPOINT = 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'KriegsspielAI-umpire-tool/0.1 (lokalna gra sztabowa; kontakt: b.zebrowski16@wp.pl)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Geometria ----------

/** Punkt w pierścieniu (even-odd). */
export function pointInRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Punkt w poligonie z dziurami. */
export function pointInPolygon(pt, poly) {
  if (!pointInRing(pt, poly.outer)) return false;
  return !(poly.holes ?? []).some((h) => pointInRing(pt, h));
}

export const pointInAny = (pt, polys) => polys.some((p) => pointInPolygon(pt, p));

/** Najbliższy punkt odcinka ab do p (w metrach lokalnych względem p). */
function nearestOnSegment(origin, p, a, b) {
  const [ax, ay] = toMeters(origin, a);
  const [bx, by] = toMeters(origin, b);
  const px = 0;
  const py = 0;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const x = ax + t * dx;
  const y = ay + t * dy;
  return { x, y, d: Math.hypot(x, y) };
}

/** Najbliższy punkt na granicy poligonu (obrys i dziury): { x, y, d } w metrach względem p. */
function nearestOnBoundary(p, poly) {
  let best = { d: Infinity, x: 0, y: 0 };
  for (const ring of [poly.outer, ...(poly.holes ?? [])]) {
    for (let i = 1; i < ring.length; i++) {
      const r = nearestOnSegment(p, p, ring[i - 1], ring[i]);
      if (r.d < best.d) best = r;
    }
  }
  return best;
}

// ---------- Overpass ----------

const bboxHash = (kind, bbox) => createHash('sha1').update(`${kind}|${bbox.map((v) => v.toFixed(4)).join(',')}`).digest('hex').slice(0, 12);

// Główny serwer, potem lustra (gdy główny jest przeciążony: 429/504).
const ENDPOINTS = [ENDPOINT, 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

/** Domyślny łączny limit czasu zapytania Overpass (wszystkie serwery i ponowienia razem), ms. */
export const DEFAULT_OVERPASS_TIMEOUT_MS = 20000;

/** Łączny limit czasu (ms): opts.timeoutMs, env OVERPASS_TIMEOUT_MS, domyślnie 20 s. */
export function overpassTimeoutMs(opts = {}) {
  const v = Number(opts.timeoutMs ?? process.env.OVERPASS_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_OVERPASS_TIMEOUT_MS;
}

/** Lista serwerów: opts.endpoints, env OVERPASS_ENDPOINTS (adresy po przecinku), domyślnie główny + lustra. */
export function overpassEndpoints(opts = {}) {
  if (opts.endpoints?.length) return opts.endpoints;
  const env = (process.env.OVERPASS_ENDPOINTS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return env.length ? env : ENDPOINTS;
}

// Obietnica z twardym limitem czasu (działa też dla fetchImpl, który ignoruje AbortSignal).
function withTimeout(promise, ms, onTimeout) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { onTimeout?.(); reject(new Error('timeout')); }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Zapytanie Overpass z łącznym limitem czasu (opts.timeoutMs / env OVERPASS_TIMEOUT_MS), dzielonym po równo
 * między serwery. Po jego przekroczeniu rzuca błąd z code 'OVERPASS_UNAVAILABLE' — wywołujący przechodzi
 * w tryb offline.
 */
async function overpass(query, opts = {}) {
  const { fetchImpl = fetch, retries = 1, backoffMs = 8000 } = opts;
  const endpoints = overpassEndpoints(opts);
  const total = overpassTimeoutMs(opts);
  const deadline = Date.now() + total;
  let lastStatus = 0;
  for (let i = 0; i < endpoints.length; i++) {
    const url = endpoints[i];
    const endpointDeadline = Date.now() + Math.ceil((deadline - Date.now()) / (endpoints.length - i));
    for (let attempt = 0; attempt <= retries; attempt++) {
      const left = endpointDeadline - Date.now();
      if (left <= 0) break;
      const ctrl = new AbortController();
      let res;
      try {
        const work = (async () => {
          const r = await fetchImpl(url, {
            method: 'POST',
            headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: `data=${encodeURIComponent(query)}`,
            signal: ctrl.signal,
          });
          return r.ok ? { res: r, json: await r.json() } : { res: r };
        })();
        const out = await withTimeout(work, left, () => ctrl.abort());
        if (out.res.ok) return out.json;
        res = out.res;
      } catch {
        break; // błąd sieci lub przekroczenie czasu: następne lustro
      }
      lastStatus = res.status;
      const wait = backoffMs * (attempt + 1);
      if ((res.status === 429 || res.status === 504) && attempt < retries && wait < endpointDeadline - Date.now()) {
        await sleep(wait); // jedna ponowna próba z wycofaniem
        continue;
      }
      break;
    }
  }
  const err = new Error(`Overpass niedostępny (limit ${Math.round(total / 100) / 10} s, ostatni status ${lastStatus || 'brak odpowiedzi'})`);
  err.code = 'OVERPASS_UNAVAILABLE';
  throw err;
}

const bboxClause = (bbox) => `${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}`; // south,west,north,east

const toRing = (geom) => geom.map((g) => [g.lon, g.lat]);
const isClosed = (r) => r.length > 3 && r[0][0] === r.at(-1)[0] && r[0][1] === r.at(-1)[1];

/** Skleja odcinki (ways) w zamknięte pierścienie. */
function joinRings(segments) {
  const rings = [];
  const pool = segments.map((s) => s.slice()).filter((s) => s.length > 1);
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (pool.length) {
    let cur = pool.pop();
    let grew = true;
    while (!isClosed(cur) && grew) {
      grew = false;
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        if (same(cur.at(-1), s[0])) cur = cur.concat(s.slice(1));
        else if (same(cur.at(-1), s.at(-1))) cur = cur.concat(s.slice(0, -1).reverse());
        else if (same(cur[0], s.at(-1))) cur = s.concat(cur.slice(1));
        else if (same(cur[0], s[0])) cur = s.slice(1).reverse().concat(cur);
        else continue;
        pool.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (isClosed(cur)) rings.push(cur);
  }
  return rings;
}

/** Odpowiedź Overpass (`out geom`) → poligony. */
export function elementsToPolygons(elements) {
  const polys = [];
  for (const el of elements ?? []) {
    if (el.type === 'way' && el.geometry) {
      const ring = toRing(el.geometry);
      if (isClosed(ring)) polys.push({ outer: ring, holes: [] });
    } else if (el.type === 'relation' && el.members) {
      const outers = joinRings(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => toRing(m.geometry)));
      const inners = joinRings(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => toRing(m.geometry)));
      for (const outer of outers) {
        polys.push({ outer, holes: inners.filter((h) => pointInRing(h[0], outer)) });
      }
    }
  }
  return polys;
}

async function cachedQuery(kind, bbox, filters, opts = {}) {
  const dir = opts.cacheDir ?? CACHE_DIR;
  const file = path.join(dir, `${kind}-${bboxHash(kind, bbox)}.json`);
  if (!opts.refresh && existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const bb = bboxClause(bbox);
  const parts = filters.flatMap((f) => [`way${f}(${bb});`, `relation${f}(${bb});`]).join('');
  const json = await overpass(`[out:json][timeout:90];(${parts});out geom;`, opts);
  const polygons = elementsToPolygons(json.elements);
  await mkdir(dir, { recursive: true });
  await writeFile(file, JSON.stringify({ kind, bbox, fetched: new Date().toISOString(), polygons }));
  return { kind, bbox, polygons };
}

/** Poligony wód (natural=water, water=*, waterway=riverbank) w bbox; cache na dysku. */
export async function findWater(bbox, opts = {}) {
  const r = await cachedQuery('water', bbox, ['["natural"="water"]', '["water"]', '["waterway"="riverbank"]'], opts);
  return r.polygons;
}

/** Poligony lasów (landuse=forest, natural=wood) w bbox; cache na dysku. */
export async function findForest(bbox, opts = {}) {
  const r = await cachedQuery('forest', bbox, ['["landuse"="forest"]', '["natural"="wood"]'], opts);
  return r.polygons;
}

// ---------- Korekty pozycji ----------

function mapPoints(points, fn) {
  if (Array.isArray(points)) return points.map(fn);
  return Object.fromEntries(Object.entries(points).map(([k, v]) => [k, fn(v, k)]));
}

/**
 * Punkty leżące w wodzie przesuwa na najbliższy brzeg + `inland_m` (60 m) w głąb lądu,
 * prosto od wody. Przyjmuje tablicę [lon,lat] albo mapę id → [lon,lat].
 * Poligony można wstrzyknąć: opts.polygons (wtedy bez sieci i cache).
 */
export async function nudgeOutOfWater(points, bbox, opts = {}) {
  const polys = opts.polygons ?? (await findWater(bbox, opts));
  const inland = opts.inland_m ?? 60;
  const moved = [];
  const result = mapPoints(points, (p, key) => {
    const poly = polys.find((pg) => pointInPolygon(p, pg));
    if (!poly) return p;
    // brzeg: najbliższy punkt granicy dowolnego poligonu, który zawiera punkt
    const b = nearestOnBoundary(p, poly);
    const len = b.d || 1;
    const ux = b.x / len;
    const uy = b.y / len;
    let out = fromMeters(p, b.x + ux * inland, b.y + uy * inland);
    for (let extra = inland; pointInAny(out, polys) && extra < inland * 20; extra += inland) {
      out = fromMeters(p, b.x + ux * extra, b.y + uy * extra); // wąska cieśnina / wyspa: idź dalej
    }
    moved.push({ key, from: p, to: out, shift_m: Math.round(len + inland) });
    return [Math.round(out[0] * 1e5) / 1e5, Math.round(out[1] * 1e5) / 1e5];
  });
  Object.defineProperty(result, 'moved', { value: moved, enumerable: false });
  return result;
}

/**
 * Punkty poza lasem przesuwa do lasu, jeśli jest w promieniu `radius_m` (skraj lasu + 40 m w głąb).
 * Poligony: opts.polygons albo z findForest(bbox). Omija wodę, jeśli podano opts.water.
 */
export async function preferCover(points, radius_m, bbox, opts = {}) {
  const forests = opts.polygons ?? (await findForest(bbox, opts));
  const water = opts.water ?? [];
  const into = opts.into_m ?? 40;
  const moved = [];
  const result = mapPoints(points, (p, key) => {
    if (pointInAny(p, forests)) return p;
    let best = null;
    for (const poly of forests) {
      const b = nearestOnBoundary(p, poly);
      if (b.d <= radius_m && (!best || b.d < best.d)) best = b;
    }
    if (!best) return p;
    const len = best.d || 1;
    const out = fromMeters(p, best.x + (best.x / len) * into, best.y + (best.y / len) * into);
    if (!pointInAny(out, forests) || pointInAny(out, water)) return p; // cienki pas lasu lub woda: bez zmian
    moved.push({ key, from: p, to: out });
    return [Math.round(out[0] * 1e5) / 1e5, Math.round(out[1] * 1e5) / 1e5];
  });
  Object.defineProperty(result, 'moved', { value: moved, enumerable: false });
  return result;
}

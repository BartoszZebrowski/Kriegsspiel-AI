// T37: spójność i realizm scenariusza (same uwagi, nie błędy): sumy stanów, jednostki w wodzie, kolejność skrzynki, wycieki nazw wroga.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pointInAny, CACHE_DIR } from './umpire/terrain.mjs';
import { isCoord, isCount, isValidTime as validTime } from '../shared/schema.js';

const sizeOf = (u) => (typeof u?.sidc === 'string' ? u.sidc[11] : undefined);

/** Suma dzieci większa niż stan rodzica (każdy poziom; rodzic ma też dowództwo/drużyny, więc mniejsza suma jest normalna). */
export function checkHierarchySums(label, units) {
  const out = [];
  if (!Array.isArray(units)) return out;
  const kids = new Map();
  for (const u of units) {
    if (!u?.id || typeof u.parent !== 'string') continue;
    if (!kids.has(u.parent)) kids.set(u.parent, []);
    kids.get(u.parent).push(u);
  }
  for (const p of units) {
    const ch = kids.get(p?.id);
    if (!ch || 'HIJKL'.includes(sizeOf(p) ?? '-')) continue; // dowództwo brygady i wyżej liczy tylko własny sztab
    for (const f of ['current', 'authorized']) {
      const withData = ch.filter((c) => isCount(c.personnel?.[f]));
      if (!isCount(p.personnel?.[f]) || !withData.length) continue;
      const sum = withData.reduce((a, c) => a + c.personnel[f], 0);
      if (sum > p.personnel[f]) out.push(`${label} units[${p.id}]: personnel.${f} (${p.personnel[f]}) < suma podwładnych (${sum})`);
    }
    if (!Array.isArray(p.equipment)) continue;
    for (const f of ['current', 'authorized']) {
      const sums = new Map();
      for (const c of ch) for (const e of c.equipment ?? []) if (e?.name && isCount(e[f])) sums.set(e.name, (sums.get(e.name) ?? 0) + e[f]);
      for (const e of p.equipment) {
        if (!sums.has(e?.name) || !isCount(e[f]) || sums.get(e.name) <= e[f]) continue;
        out.push(`${label} units[${p.id}] equipment[${e.name}]: ${f} (${e[f]}) < suma podwładnych (${sums.get(e.name)})`);
      }
    }
  }
  return out;
}

/** Id jednostek (z pos) leżących w którymś z poligonów wody. */
export function unitsInWater(units, polygons) {
  if (!Array.isArray(units) || !polygons?.length) return [];
  return units.filter((u) => u?.id && isCoord(u.pos) && pointInAny(u.pos, polygons)).map((u) => u.id);
}

/** Poligony wód z cache terrain.mjs obejmujące któryś z punktów (bez sieci; brak cache → []). */
export async function loadWaterPolygons(points, cacheDir = CACHE_DIR) {
  let names;
  try {
    names = (await fs.readdir(cacheDir)).filter((n) => /^water-.*\.json$/.test(n));
  } catch {
    return [];
  }
  const pts = points.filter(isCoord);
  const polys = [];
  for (const n of names) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(cacheDir, n), 'utf8'));
      const [x0, y0, x1, y1] = c.bbox ?? [];
      if (pts.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) polys.push(...(c.polygons ?? []));
    } catch {
      /* uszkodzony cache — pomiń */
    }
  }
  return polys;
}

/** Wiadomości skrzynki: czas nie powinien maleć w kolejności pliku. Zwraca id wiadomości cofających czas. */
export function inboxOutOfOrder(messages) {
  const bad = [];
  let prev = -Infinity;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!validTime(m?.time)) continue;
    const t = Date.parse(m.time);
    if (t < prev) bad.push(m.id ?? '?');
    else prev = t;
  }
  return bad;
}

const norm = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Frazy własnych jednostek (całe id i cała nazwa, też bez nawiasu / z rozdzielonym numerem) → id jednostki. */
export function ownNameKeys(ownUnits) {
  const keys = new Map();
  const add = (phrase, id) => {
    const p = norm(phrase);
    if (p.length >= 3 && /\p{L}/u.test(p) && !keys.has(p)) keys.set(p, id);
  };
  for (const u of ownUnits ?? []) {
    if (u?.id) {
      const id = String(u.id);
      add(id, u.id);
      add(id.replace(/-/g, ' '), u.id);
      add(id.replace(/^(\d+)(?=\p{L})/u, '$1 '), u.id);
    }
    if (u?.name) {
      add(u.name, u.id);
      add(String(u.name).replace(/\s*\([^)]*\)\s*/g, ' '), u.id);
    }
  }
  return keys;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);

/** Elementy wroga/kontaktów, których name lub id zawiera całą frazę (id lub nazwę) własnej jednostki z granicami słowa. Zwraca [{ id, word }]. */
export function enemyNameLeaks(ownUnits, enemyItems) {
  const keys = [...ownNameKeys(ownUnits)].map(([k]) => [k, new RegExp(`(?<![\\p{L}\\p{N}])${escRe(k)}(?![\\p{L}\\p{N}])`, 'u')]);
  const out = [];
  for (const e of enemyItems ?? []) {
    const text = norm(e?.name);
    const hit = keys.find(([, re]) => re.test(text));
    if (hit) out.push({ id: e.id, word: hit[0] });
  }
  return out;
}

/** status: finished wymaga umpire/aar.md. Zwraca listę uwag. */
export function checkFinishedAar(scenario, hasAar) {
  return scenario?.status === 'finished' && !hasAar ? ['scenario.json: status „finished” bez umpire/aar.md'] : [];
}

// Rozstawianie pododdziałów (narzędzie sędziego). Czyste funkcje, bez I/O.
// Współrzędne zawsze [długość, szerokość]; azymut w stopniach (0 = N, 90 = E).
// Opis formacji i uzasadnienie doktrynalne: docs/UMPIRE-TOOLS.md
//
// Zasada projektowa: żadnego jednego „kanonicznego” kształtu. Układ zależy od formacji,
// szerokości odcinka, liczby elementów, ziarna oraz wariantu (np. natarcie: dwa w pierwszym
// rzucie z odwodem za lewym/prawym/środkiem, rzut skośny albo szyk jednolity).

// ---------- Geodezja ----------

/** Metry na stopień szerokości i długości na szerokości `lat` (WGS84, wzory przybliżone). */
export function metersPerDegree(lat) {
  const p = (lat * Math.PI) / 180;
  return {
    lat: 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lon: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  };
}

/** Przesunięcie [wschód_m, północ_m] od `origin` do `pos`. */
export function toMeters(origin, pos) {
  const m = metersPerDegree(origin[1]);
  return [(pos[0] - origin[0]) * m.lon, (pos[1] - origin[1]) * m.lat];
}

/** Punkt oddalony od `origin` o [wschód_m, północ_m]. */
export function fromMeters(origin, east, north) {
  const m = metersPerDegree(origin[1]);
  return [origin[0] + east / m.lon, origin[1] + north / m.lat];
}

/** Odległość w metrach (płaska aproksymacja lokalna). */
export function distanceM(a, b) {
  const [e, n] = toMeters(a, b);
  return Math.hypot(e, n);
}

/** Azymut z a do b w stopniach (0–360). */
export function bearingDeg(a, b) {
  const [e, n] = toMeters(a, b);
  return ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360;
}

// ---------- Losowość z ziarnem ----------

function hashSeed(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Generator mulberry32; zwraca funkcję () => [0,1). */
export function makeRng(seed) {
  let a = hashSeed(String(seed));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (rng, lo, hi) => lo + (hi - lo) * rng();
const jit = (rng, amount) => (rng() * 2 - 1) * amount;
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

// ---------- Formacje i aliasy ----------

const ALIASES = {
  obrona: 'obrona', defense: 'obrona', defence: 'obrona', obronny: 'obrona',
  natarcie: 'natarcie', attack: 'natarcie',
  marsz: 'marsz', kolumna: 'marsz', march: 'marsz',
  wyczekujace: 'wyczekujace', 'wyczekujące': 'wyczekujace', rejon: 'wyczekujace', assembly: 'wyczekujace', koncentracja: 'wyczekujace',
  artyleria: 'artyleria', ogniowe: 'artyleria', artillery: 'artyleria',
  obserwacja: 'obserwacja', rozpoznanie: 'obserwacja', ubezpieczenie: 'obserwacja', screen: 'obserwacja', recon: 'obserwacja',
};

export const FORMATIONS = ['obrona', 'natarcie', 'marsz', 'wyczekujace', 'artyleria', 'obserwacja'];

export function normalizeFormation(name) {
  const f = ALIASES[String(name ?? '').toLowerCase().trim()];
  if (!f) throw new Error(`Nieznana formacja: "${name}" (dostępne: ${FORMATIONS.join(', ')})`);
  return f;
}

// Poziom rozstawianego oddziału (wg wielkości podwładnych): skala odległości.
const LEVELS = {
  company: { frontDef: [1500, 2500], frontAtk: [900, 1100], wide: 2200, depth: 1, radius: [400, 700], minSpacing: 150, platoonGap: [150, 300] },
  battalion: { frontDef: [4000, 6000], frontAtk: [2700, 3300], wide: 5500, depth: 1.6, radius: [1300, 1700], minSpacing: 350, platoonGap: [1000, 2000] },
  brigade: { frontDef: [10000, 15000], frontAtk: [6000, 9000], wide: 13500, depth: 2.5, radius: [3500, 4500], minSpacing: 800, platoonGap: [3000, 5000] },
};

const ECHELON_LEVEL = { D: 'company', E: 'battalion', F: 'brigade', G: 'brigade' };
const ECHELON_ORDER = 'ABCDEFGHI';

export const echelonOf = (sidc) => (sidc && sidc.length >= 12 ? sidc[11] : '-');

function levelFromChildren(children) {
  let best = 'D';
  const main = children.filter((c) => !['hq', 'support'].includes(roleOf(c)));
  for (const c of main.length ? main : children) {
    const e = echelonOf(c.sidc);
    if (ECHELON_ORDER.indexOf(e) > ECHELON_ORDER.indexOf(best)) best = e;
  }
  return ECHELON_LEVEL[best] ?? 'company';
}

/** Rola elementu: jawna `role` albo z funkcji w SIDC (znaki 5–10). */
export function roleOf(child) {
  if (child.role) return child.role;
  const fn = (child.sidc ?? '').slice(4, 10);
  if (fn.startsWith('UCF') || fn.startsWith('UCD') || fn.startsWith('US')) return 'support'; // moździerze, artyleria, OPL, zaopatrzenie
  return 'forward';
}

const isArmor = (child) => (child.sidc ?? '').slice(4, 8) === 'UCAT';

// ---------- Układ lokalny ----------
// f = do przodu (wzdłuż azymutu), l = w prawo od azymutu. Wynik w metrach od środka.

function toLonLat(center, facing, f, l) {
  const t = (facing * Math.PI) / 180;
  return fromMeters(center, f * Math.sin(t) + l * Math.cos(t), f * Math.cos(t) - l * Math.sin(t));
}

const round5 = (p) => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];

/** Środki `k` pasów o nierównej szerokości (wagi 0.5–1.5) na odcinku `width`; zwraca też szerokości. */
function unevenSlots(rng, k, width) {
  const w = Array.from({ length: k }, () => 0.5 + 1.0 * rng());
  const sum = w.reduce((a, b) => a + b, 0);
  const widths = w.map((x) => (x / sum) * width);
  let edge = -width / 2;
  const centers = widths.map((wd) => {
    const c = edge + wd / 2;
    edge += wd;
    return c;
  });
  return { centers, widths };
}

/** Podział elementów na przednie / w głębi / wsparcie / dowództwo. `k` = ile w pierwszym rzucie (null = decyduje funkcja). */
function splitRoles(children, k) {
  const hq = children.filter((c) => roleOf(c) === 'hq');
  const support = children.filter((c) => roleOf(c) === 'support');
  const rest = children.filter((c) => !['hq', 'support'].includes(roleOf(c)));
  const explicitDepth = rest.filter((c) => c.role === 'depth');
  const explicitFwd = rest.filter((c) => c.role === 'forward');
  if (explicitDepth.length || explicitFwd.length) {
    return { forward: rest.filter((c) => c.role !== 'depth'), depth: explicitDepth, support, hq, explicit: true };
  }
  const n = rest.length;
  const kk = Math.min(n, Math.max(n ? 1 : 0, k ?? n));
  // pancerni chętniej jako odwód (w głębi)
  const ordered = [...rest.filter((c) => !isArmor(c)), ...rest.filter(isArmor)];
  const fwdSet = new Set(ordered.slice(0, kk));
  return { forward: rest.filter((c) => fwdSet.has(c)), depth: rest.filter((c) => !fwdSet.has(c)), support, hq };
}

function countRest(children) {
  return children.filter((c) => !['hq', 'support'].includes(roleOf(c))).length;
}

// ---------- Obrona i natarcie ----------

function lineFormation(kind, opts, ctx) {
  const { rng, lv, children } = ctx;
  const atk = kind === 'natarcie';
  const frontage = opts.frontage_m ?? between(rng, ...(atk ? lv.frontAtk : lv.frontDef));
  const n = countRest(children);

  // Wybór wariantu układu (zależny od szerokości odcinka, parametrów i ziarna).
  let variant = opts.variant;
  let k;
  if (opts.forward != null) {
    k = opts.forward;
    variant ??= k >= n ? (atk ? pick(rng, ['szyk', 'rzut-skosny']) : 'w-linii') : 'dwa-i-odwod';
  } else if (n <= 2) {
    k = n;
    variant ??= 'w-linii';
  } else if (atk) {
    const r = rng();
    variant ??= r < 0.5 ? 'dwa-i-odwod' : r < 0.8 ? 'rzut-skosny' : 'szyk';
    k = variant === 'dwa-i-odwod' ? Math.max(2, Math.round((n * 2) / 3)) : n;
  } else {
    variant ??= frontage > lv.wide ? 'w-linii' : 'dwa-i-odwod'; // szeroki odcinek: wszyscy w linii
    k = variant === 'w-linii' ? n : Math.max(2, Math.round((n * 2) / 3));
  }

  const { forward, depth, support, hq } = splitRoles(children, k);
  const out = {};
  const slot = unevenSlots(rng, forward.length, frontage);
  const avgW = frontage / Math.max(1, forward.length);
  const dRange = (atk ? [300, 500] : [500, 800]).map((d) => d * lv.depth);
  const sRange = (atk ? [600, 1000] : [800, 1500]).map((d) => d * lv.depth);
  const hRange = (atk ? [200, 300] : [300, 500]).map((d) => d * lv.depth);
  if (opts.depth_m != null) {
    const s = opts.depth_m / dRange[1];
    dRange[0] *= s; dRange[1] *= s;
  }

  // Wysunięcie poszczególnych elementów pierwszego rzutu: niezależne, nie wg wzoru.
  let fwdF;
  if (variant === 'rzut-skosny' && forward.length > 1) {
    const dir = pick(rng, [1, -1]); // w lewo lub w prawo
    const step = between(rng, 250, 450);
    fwdF = forward.map((c, i) => (dir > 0 ? -i : i - (forward.length - 1)) * step + jit(rng, step * 0.2));
  } else if (variant === 'szyk') {
    fwdF = forward.map(() => jit(rng, 60));
  } else {
    const amp = atk ? 140 : 230; // w obronie wysunięcie zależy od terenu: większy rozrzut
    fwdF = forward.map(() => jit(rng, amp));
  }
  forward.forEach((c, i) => { out[c.id] = [fwdF[i], slot.centers[i] + jit(rng, slot.widths[i] * 0.1)]; });

  // Odwód: za środkiem, za lewym lub za prawym elementem (ziarno).
  depth.forEach((c, i) => {
    let lat;
    const side = pick(rng, ['lewy', 'srodek', 'prawy']);
    if (forward.length < 2 || side === 'srodek') lat = jit(rng, avgW * 0.3);
    else lat = slot.centers[side === 'lewy' ? 0 : forward.length - 1] + jit(rng, avgW * 0.15);
    lat += (i - (depth.length - 1) / 2) * 250;
    out[c.id] = [-between(rng, ...dRange), lat];
  });
  support.forEach((c) => {
    out[c.id] = [-between(rng, ...sRange), jit(rng, frontage * 0.3)];
  });
  hq.forEach((c, i) => { out[c.id] = [-between(rng, ...hRange), (i - (hq.length - 1) / 2) * 150 + jit(rng, 80)]; });
  const hqPos = [-between(rng, ...hRange), jit(rng, frontage * 0.1)];
  return { local: out, hq: hqPos, meta: { variant, frontage_m: frontage, forward: forward.map((c) => c.id), depth: depth.map((c) => c.id) } };
}

// ---------- Marsz ----------

function polylineMeters(route, origin) {
  const pts = route.map((p) => toMeters(origin, p));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  return { pts, cum };
}

/** Długość łuku punktu łamanej najbliższego początku układu (środka oddziału). */
function projectOnPolyline({ pts, cum }) {
  let best = { d: Infinity, s: 0 };
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, s: cum[i - 1] + t * Math.sqrt(len2) };
  }
  return best.s;
}

/** Punkt na łamanej w odległości s od początku (poza końcami: przedłużenie skrajnych odcinków). */
function pointAtArc({ pts, cum }, s) {
  const last = pts.length - 1;
  let i = 1;
  if (s >= cum[last]) i = last;
  else if (s > 0) while (cum[i] < s) i++;
  const [ax, ay] = pts[i - 1];
  const [bx, by] = pts[i];
  const len = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / len;
  return { e: ax + (bx - ax) * t, n: ay + (by - ay) * t, dirE: (bx - ax) / len, dirN: (by - ay) / len };
}

function marchFormation(opts, ctx) {
  const { rng, lv, children } = ctx;
  const gaps = [];
  for (let i = 1; i < children.length; i++) {
    gaps.push((opts.spacing_m ?? between(rng, ...lv.platoonGap)) * (1 + jit(rng, 0.12)));
  }
  const total = gaps.reduce((a, b) => a + b, 0);
  const along = []; // położenie wzdłuż kolumny względem środka; czoło = +
  let acc = total / 2;
  children.forEach((c, i) => {
    along.push(acc);
    if (i < gaps.length) acc -= gaps[i];
  });
  const out = {};
  if (Array.isArray(opts.route) && opts.route.length >= 2) {
    const poly = polylineMeters(opts.route, ctx.center);
    const s0 = projectOnPolyline(poly);
    children.forEach((c, i) => {
      const p = pointAtArc(poly, s0 + along[i]);
      const lat = jit(rng, 12); // boczne rozsunięcie na poboczu
      out[c.id] = { abs: [p.e + p.dirN * lat, p.n - p.dirE * lat] };
    });
    const p0 = pointAtArc(poly, s0);
    return { local: out, hqAbs: [p0.e, p0.n], meta: { length_m: total } };
  }
  children.forEach((c, i) => { out[c.id] = [along[i], jit(rng, 12)]; });
  return { local: out, hq: [0, 0], meta: { length_m: total } };
}

// ---------- Rejon wyczekiwania ----------

function assemblyFormation(opts, ctx) {
  const { rng, lv, children } = ctx;
  const radius = opts.radius_m ?? (opts.frontage_m != null ? opts.frontage_m / 2 : between(rng, ...lv.radius));
  let minSp = opts.min_spacing_m ?? lv.minSpacing;
  const placed = [];
  for (let ci = 0; ci < children.length; ci++) {
    let p = null;
    for (let attempt = 0; attempt < 400 && !p; attempt++) {
      if (attempt && attempt % 100 === 0) minSp *= 0.8; // zagęszczenie, gdy brak miejsca
      const r = radius * Math.sqrt(rng());
      const a = rng() * 2 * Math.PI;
      const cand = [r * Math.cos(a), r * Math.sin(a)];
      if (placed.every((q) => Math.hypot(q[0] - cand[0], q[1] - cand[1]) >= minSp)) p = cand;
    }
    placed.push(p ?? [radius * rng(), radius * rng()]);
  }
  const out = {};
  children.forEach((c, i) => { out[c.id] = placed[i]; });
  return { local: out, hq: [jit(rng, radius * 0.2), jit(rng, radius * 0.2)], meta: { radius_m: radius, min_spacing_m: minSp } };
}

// ---------- Artyleria ----------

function maxTriangleArea(pts) {
  let maxA = 0;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) for (let k = j + 1; k < pts.length; k++) {
    const a = Math.abs((pts[j][0] - pts[i][0]) * (pts[k][1] - pts[i][1]) - (pts[k][0] - pts[i][0]) * (pts[j][1] - pts[i][1])) / 2;
    if (a > maxA) maxA = a;
  }
  return maxA;
}

function artilleryFormation(opts, ctx) {
  const { rng, children } = ctx;
  const n = children.length;
  let pts;
  for (let attempt = 0; attempt < 50; attempt++) {
    const gaps = Array.from({ length: Math.max(0, n - 1) }, () => (opts.spacing_m ?? between(rng, 300, 600)) * (1 + jit(rng, 0.1)));
    let l = -gaps.reduce((a, b) => a + b, 0) / 2;
    pts = children.map((c, i) => {
      const p = [jit(rng, 220) + (i % 2 ? -1 : 1) * 60, l]; // rozrzut w głębi, bez jednej linii
      if (i < gaps.length) l += gaps[i];
      return p;
    });
    if (n < 3 || maxTriangleArea(pts) > 20000) break; // nie leżą na jednej prostej
  }
  const out = {};
  children.forEach((c, i) => { out[c.id] = pts[i]; });
  return { local: out, hq: [-between(rng, 250, 400), jit(rng, 100)], meta: {} };
}

// ---------- Obserwacja / ubezpieczenie ----------

function observationFormation(opts, ctx) {
  const { rng, children } = ctx;
  const gaps = Array.from({ length: Math.max(0, children.length - 1) }, () => (opts.spacing_m ?? between(rng, 800, 2500)) * (1 + jit(rng, 0.1)));
  let l = -gaps.reduce((a, b) => a + b, 0) / 2;
  const out = {};
  children.forEach((c, i) => {
    out[c.id] = [jit(rng, 250), l];
    if (i < gaps.length) l += gaps[i];
  });
  return { local: out, hq: [-between(rng, 600, 1200), jit(rng, 150)], meta: {} };
}

// ---------- Publiczne API ----------

/**
 * Rozstawia podwładnych wokół `center`.
 * @param {object} p
 * @param {[number,number]} p.center  środek oddziału [lon, lat]
 * @param {string} p.formation  obrona | natarcie | marsz | wyczekujace | artyleria | obserwacja (lub alias)
 * @param {number} [p.facing=0]  azymut frontu / kierunku działania
 * @param {number} [p.frontage_m]  szerokość odcinka (obrona/natarcie) lub 2*promień (wyczekujace)
 * @param {number} [p.depth_m]  maks. głębokość odwodu (obrona/natarcie)
 * @param {number} [p.forward]  ile elementów w pierwszym rzucie
 * @param {string} [p.variant]  w-linii | dwa-i-odwod (obrona, natarcie); szyk | rzut-skosny (natarcie)
 * @param {number} [p.spacing_m]  nadpisanie rozstawu (marsz/artyleria/obserwacja)
 * @param {[number,number][]} [p.route]  trasa marszu (łamana)
 * @param {{id:string, role?:string, sidc?:string}[]} p.children
 * @param {string} [p.seed]
 * @returns {Object<string,[number,number]>}  pozycje podwładnych; ukryte własności `_hq` (miejsce dowództwa) i `_meta` (parametry układu)
 */
export function deploy(p) {
  const { center, children = [], seed = 'seed' } = p;
  if (!Array.isArray(center) || center.length !== 2) throw new Error('deploy: brak center [lon, lat]');
  const formation = normalizeFormation(p.formation);
  const rng = makeRng(`${seed}|${formation}`);
  const level = p.level ?? levelFromChildren(children);
  const lv = LEVELS[level] ?? LEVELS.company;
  const facing = ((p.facing ?? 0) + jit(rng, 10) + 360) % 360; // ±10° od zadanego azymutu
  const ctx = { rng, lv, children, center };
  let res;
  if (formation === 'obrona' || formation === 'natarcie') res = lineFormation(formation, p, ctx);
  else if (formation === 'marsz') res = marchFormation(p, ctx);
  else if (formation === 'wyczekujace') res = assemblyFormation(p, ctx);
  else if (formation === 'artyleria') res = artilleryFormation(p, ctx);
  else res = observationFormation(p, ctx);

  const result = {};
  for (const c of children) {
    const loc = res.local[c.id];
    result[c.id] = round5(loc.abs ? fromMeters(center, loc.abs[0], loc.abs[1]) : toLonLat(center, facing, loc[0], loc[1]));
  }
  const hq = res.hqAbs ? round5(fromMeters(center, res.hqAbs[0], res.hqAbs[1])) : round5(toLonLat(center, facing, res.hq[0], res.hq[1]));
  Object.defineProperty(result, '_hq', { value: hq, enumerable: false });
  Object.defineProperty(result, '_meta', { value: { formation, level, facing, ...res.meta }, enumerable: false });
  return result;
}

function inheritFormation(f) {
  if (!f) return 'obrona';
  const n = normalizeFormation(f);
  return ['marsz', 'natarcie', 'wyczekujace'].includes(n) ? n : 'obrona';
}

/**
 * Rozstawia rekurencyjnie wszystkie podwładne jednostki `rootId`.
 * @param {{id:string, parent?:string, sidc?:string, pos:[number,number]}[]} units  wszystkie jednostki tury
 * @param {string} rootId
 * @param {Object<string, object>} plan  per jednostka: { formation, facing, frontage_m, depth_m, forward, variant, center, route, seed, roles:{id:role}, parentAtHq }.
 *   Wpis '*' to wartości domyślne. Jednostka bez wpisu dziedziczy facing, a formację
 *   (marsz/natarcie/wyczekujace) od przełożonego; w pozostałych przypadkach obronę.
 *   Kompania w pierwszym rzucie dostaje pas = szerokość batalionu / liczba elementów.
 * @param {{seedBase?:string}} [opts]
 * @returns {Object<string,[number,number]>}  nowe pozycje potomków (oraz roota, gdy plan podaje center)
 */
export function deployTree(units, rootId, plan = {}, opts = {}) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out = {};
  const seedBase = opts.seedBase ?? '';
  const defaults = plan['*'] ?? {};

  function walk(id, inherited, center, slot) {
    const children = units.filter((u) => u.parent === id);
    if (!children.length) return;
    let spec;
    if (plan[id] != null) spec = { ...defaults, ...plan[id] };
    else spec = { ...defaults, formation: inheritFormation(inherited.formation), facing: inherited.facing, route: inherited.route };
    if (!spec.formation) spec.formation = 'obrona';
    const nf = normalizeFormation(spec.formation);
    if (slot && spec.frontage_m == null && ['obrona', 'natarcie'].includes(nf)) spec.frontage_m = slot.frontage_m;
    const roles = spec.roles ?? {};
    const res = deploy({
      ...spec,
      center,
      children: children.map((c) => ({ id: c.id, sidc: c.sidc, role: roles[c.id] ?? c.role })),
      seed: spec.seed ?? `${seedBase}${id}`,
    });
    const m = res._meta;
    const fwd = m.forward ?? [];
    const lineSlot = fwd.length && m.frontage_m ? { frontage_m: (m.frontage_m / fwd.length) * 0.9 } : null;
    for (const c of children) {
      out[c.id] = res[c.id];
      walk(c.id, { ...spec, formation: nf, facing: m.facing }, res[c.id], fwd.includes(c.id) ? lineSlot : null);
    }
    if (spec.parentAtHq) out[id] = res._hq;
  }

  const rootUnit = byId.get(rootId);
  if (!rootUnit) throw new Error(`deployTree: brak jednostki ${rootId}`);
  const rootPlan = plan[rootId] ?? {};
  const center = rootPlan.center ?? rootUnit.pos;
  if (rootPlan.center) out[rootId] = rootPlan.center;
  walk(rootId, {}, center, null);
  return out;
}

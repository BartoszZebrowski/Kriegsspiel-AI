// Kalkulator zadań saperskich (T27): czas pola minowego, przejścia w polu, mostu składanego / pontonowego,
// zniszczenia mostu oraz postęp zadania. Czyste, deterministyczne funkcje (bez losowości) + cienkie CLI.
// Wartości to praktyka sędziowska (rząd wielkości dla saperów PL/NATO), nie przepisy; tabele poniżej są jedynym źródłem.
//
//   node tools/umpire/engineer.mjs minefield --length 800 --personnel 60 [--rows 3] [--method manual|mechanical] [--terrain open] [--night] [--fire]
//   node tools/umpire/engineer.mjs lane --depth 150 --personnel 30 [--method manual|mechanical] [--terrain open]
//   node tools/umpire/engineer.mjs bridge --span 20 --personnel 30 [--type folding|pontoon] [--current calm|medium|strong]
//   node tools/umpire/engineer.mjs demolition --span 25 [--prepared] [--full] --personnel 12
//   node tools/umpire/engineer.mjs progress --started 2026-05-14T06:00:00+02:00 --now 2026-05-14T08:00:00+02:00 --total 240
// Wynik: JSON { minutes, hours, ... }. Dokumentacja: docs/UMPIRE-TOOLS.md.
import { pathToFileURL } from 'node:url';

// Mnożnik czasu wg terenu (otwarty = 1).
export const TERRAIN_FACTORS = { open: 1, rough: 1.3, forest: 1.4, urban: 1.2, frozen: 1.25, marsh: 1.8 };
// Mnożniki okoliczności.
export const NIGHT_FACTOR = 1.25;
export const UNDER_FIRE_FACTOR = 2;
export const CURRENT_FACTORS = { calm: 1, medium: 1.3, strong: 1.8 };

// Pole minowe: rzędy min · metry frontu na sapera na godzinę (ręcznie) albo na pojazd-minoukładacz (mechanicznie).
export const MINE_RATE_MANUAL = 6; // m·rząd / (saper · h)
export const MINE_RATE_MECHANICAL = 1000; // m·rząd / (pojazd · h)
export const MINE_PREP_MIN = 30; // rozpoznanie, wytyczenie, odbiór
// Przejście: ręcznie ok. 1,5 min na metr głębi pola na sekcję (10 ludzi); mechanicznie (trał, ładunek wydłużony).
export const LANE_MANUAL_MIN_PER_M = 1.5;
export const SECTION_SIZE = 10;
export const LANE_MECHANICAL_FIXED_MIN = 20;
export const LANE_MECHANICAL_MIN_PER_M = 0.1;
export const LANE_PREP_MIN = 15;
// Mosty: obsada referencyjna i czas wg rodzaju.
export const BRIDGE_TYPES = {
  folding: { crew: 12, base_min: 15, min_per_m: 1.5 }, // most składany: 20 m → 45 min
  pontoon: { crew: 40, base_min: 30, min_per_m: 1.2 }, // most pontonowy: 100 m → 150 min
};
// Zniszczenie mostu: przygotowane komory minerskie vs ładunki zakładane na miejscu.
export const DEMOLITION_PREPARED_MIN = 10;
export const DEMOLITION_PREP_MIN = 20;
export const DEMOLITION_MIN_PER_10M = 10;
export const DEMOLITION_FULL_FACTOR = 1.5; // całkowite zburzenie (nie samo uszkodzenie przęsła)

const round = (n) => Math.round(n);
const need = (v, name) => {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`Parametr ${name} musi być liczbą > 0`);
  return v;
};
const terrainFactor = (terrain = 'open') => {
  const f = TERRAIN_FACTORS[terrain];
  if (f === undefined) throw new Error(`Nieznany teren „${terrain}” (dozwolone: ${Object.keys(TERRAIN_FACTORS).join(', ')})`);
  return f;
};
const conditions = ({ night = false, under_fire = false } = {}) => (night ? NIGHT_FACTOR : 1) * (under_fire ? UNDER_FIRE_FACTOR : 1);
const result = (minutes, extra = {}) => ({ minutes: round(minutes), hours: Math.round((minutes / 60) * 10) / 10, ...extra });

/** Efektywna liczba ludzi: stan osobowy × siła (0–1) jednostki. */
export const effectivePersonnel = (personnel, strength = 1) => need(personnel, 'personnel') * Math.min(1, Math.max(0, strength));

/**
 * Pole minowe o długości frontu `length_m` i `rows` rzędach (domyślnie 3).
 * method `manual`: personnel (ludzie) · strength; `mechanical`: vehicles (minoukładacze).
 */
export function minefieldTime({ length_m, rows = 3, method = 'manual', personnel, strength = 1, vehicles, terrain = 'open', night, under_fire } = {}) {
  need(length_m, 'length_m');
  need(rows, 'rows');
  if (method !== 'manual' && method !== 'mechanical') throw new Error(`Nieznana metoda „${method}” (manual | mechanical)`);
  const work = length_m * rows;
  const rate = method === 'mechanical' ? MINE_RATE_MECHANICAL * need(vehicles, 'vehicles') : MINE_RATE_MANUAL * effectivePersonnel(personnel, strength);
  const minutes = (MINE_PREP_MIN + (work / rate) * 60 * terrainFactor(terrain)) * conditions({ night, under_fire });
  return result(minutes, { work_m_rows: work });
}

/** Przejście przez pole minowe o głębokości `depth_m`. method `manual` (sekcje po 10 ludzi) albo `mechanical` (trał / ładunek). */
export function laneTime({ depth_m, method = 'manual', personnel, strength = 1, terrain = 'open', night, under_fire } = {}) {
  need(depth_m, 'depth_m');
  let minutes;
  if (method === 'mechanical') minutes = LANE_PREP_MIN + (LANE_MECHANICAL_FIXED_MIN + depth_m * LANE_MECHANICAL_MIN_PER_M) * terrainFactor(terrain);
  else if (method === 'manual') {
    const sections = Math.max(1, Math.floor(effectivePersonnel(personnel, strength) / SECTION_SIZE));
    minutes = LANE_PREP_MIN + ((depth_m * LANE_MANUAL_MIN_PER_M) / sections) * terrainFactor(terrain);
  } else throw new Error(`Nieznana metoda „${method}” (manual | mechanical)`);
  return result(minutes * conditions({ night, under_fire }));
}

/**
 * Most składany (`folding`) albo pontonowy (`pontoon`) o rozpiętości / szerokości przeszkody `span_m`.
 * Obsada mniejsza od referencyjnej wydłuża czas (do ×3), większa skraca (nie poniżej ×0,6). Pontony: prąd (`current`).
 */
export function bridgeTime({ span_m, type = 'folding', personnel, strength = 1, current = 'calm', terrain = 'open', night, under_fire } = {}) {
  need(span_m, 'span_m');
  const t = BRIDGE_TYPES[type];
  if (!t) throw new Error(`Nieznany rodzaj mostu „${type}” (${Object.keys(BRIDGE_TYPES).join(' | ')})`);
  const cur = CURRENT_FACTORS[current];
  if (cur === undefined) throw new Error(`Nieznany prąd „${current}” (${Object.keys(CURRENT_FACTORS).join(' | ')})`);
  const crewFactor = Math.min(3, Math.max(0.6, t.crew / effectivePersonnel(personnel, strength)));
  const minutes = (t.base_min + t.min_per_m * span_m) * crewFactor * (type === 'pontoon' ? cur : 1) * terrainFactor(terrain) * conditions({ night, under_fire });
  return result(minutes, { crew_factor: Math.round(crewFactor * 100) / 100 });
}

/** Zniszczenie mostu o rozpiętości `span_m`: `prepared` = komory minerskie gotowe; `full` = całkowite zburzenie (inaczej uszkodzenie). */
export function demolitionTime({ span_m, prepared = false, full = false, personnel, strength = 1, night, under_fire } = {}) {
  need(span_m, 'span_m');
  const base = prepared ? DEMOLITION_PREPARED_MIN : DEMOLITION_PREP_MIN + (span_m / 10) * DEMOLITION_MIN_PER_10M;
  // Obsada względem sekcji (10 ludzi); mniejsza wydłuża czas, większa nie skraca poniżej ×0,6.
  const crewFactor = personnel === undefined ? 1 : Math.min(3, Math.max(0.6, SECTION_SIZE / effectivePersonnel(personnel, strength)));
  const minutes = base * (full ? DEMOLITION_FULL_FACTOR : 1) * crewFactor * conditions({ night, under_fire });
  return result(minutes, { outcome: full ? 'destroyed' : 'damaged' });
}

/** Postęp zadania w %, 0–100 (całkowite), z czasu rozpoczęcia, bieżącego i łącznego (minuty); `paused_min` = przerwa (np. ogień, rozkaz). */
export function progressPercent({ started, now, total_min, paused_min = 0 }) {
  need(total_min, 'total_min');
  const done = (Date.parse(now) - Date.parse(started)) / 60000 - paused_min;
  if (!Number.isFinite(done)) throw new Error('started i now muszą być czasami ISO');
  return Math.max(0, Math.min(100, Math.floor((done / total_min) * 100)));
}

/** Tekst meldunku „ZAPORA-1: 60%”. */
export const progressReport = (label, percent) => `${label}: ${percent}%`;

// ---------- CLI ----------
const NUMERIC = new Set(['length', 'rows', 'personnel', 'strength', 'vehicles', 'depth', 'span', 'total', 'paused']);
const FLAGS = new Set(['night', 'fire', 'prepared', 'full']);

export function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const key = argv[i].slice(2);
    if (FLAGS.has(key)) out[key] = true;
    else out[key] = NUMERIC.has(key) ? Number(argv[++i]) : argv[++i];
  }
  return out;
}

export function runCli(cmd, a) {
  const common = { personnel: a.personnel, strength: a.strength, terrain: a.terrain, night: a.night, under_fire: a.fire };
  switch (cmd) {
    case 'minefield': return minefieldTime({ ...common, length_m: a.length, rows: a.rows, method: a.method, vehicles: a.vehicles });
    case 'lane': return laneTime({ ...common, depth_m: a.depth, method: a.method });
    case 'bridge': return bridgeTime({ ...common, span_m: a.span, type: a.type, current: a.current });
    case 'demolition': return demolitionTime({ ...common, span_m: a.span, prepared: a.prepared, full: a.full });
    case 'progress': return { percent: progressPercent({ started: a.started, now: a.now, total_min: a.total, paused_min: a.paused }) };
    default: throw new Error('Użycie: engineer.mjs minefield|lane|bridge|demolition|progress [--parametry]');
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    console.log(JSON.stringify(runCli(process.argv[2], parseArgs(process.argv.slice(3))), null, 2));
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

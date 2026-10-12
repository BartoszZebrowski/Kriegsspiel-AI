// Pomiar po drogach (T15): typy marszu, czas dzień/noc, szacunek bez routera i mosty na trasie.
// Czysta logika bez DOM i sieci (testowana w Node). Sieć: server/route.js + core/api.js.
import { distanceKm, pathLengthKm } from './geo.js';
import { formatClock } from './format.js';
import { dayPhase, isNightPhase } from './daylight.js';
import { groundSpeedFactor } from './weather.js';

// Prędkości marszowe po drodze (km/h) i masa typowego sprzętu (t). Masa: kołowa = Rosomak (~22–26 t), gąsienicowa = Leopard 2 (~60 t).
export const MARCH_PROFILES = [
  { id: 'wheeled', name: 'kołowa', example: 'Rosomak ~26 t', dayKmh: 30, nightKmh: 20, massT: 26 },
  { id: 'tracked', name: 'gąsienicowa', example: 'Leopard 2 ~60 t', dayKmh: 20, nightKmh: 14, massT: 60 },
  { id: 'foot', name: 'piesza', example: 'piechota', dayKmh: 4, nightKmh: 3, massT: 0 },
];
export const CURVATURE_FACTOR = 1.3; // droga ≈ 1,3 × linia prosta (gdy brak routera)
export const BRIDGE_TOLERANCE_M = 150;
export const NIGHT_FROM = 21; // noc: 21:00–05:00 czasu scenariusza
export const NIGHT_TO = 5;

export const profileById = (id) => MARCH_PROFILES.find((p) => p.id === id) || MARCH_PROFILES[0];

// Typ marszu z SIDC (znaki 5–10 = funkcja): pancerne → gąsienicowa, piechota → piesza, reszta → kołowa.
export function profileFromSidc(sidc) {
  const fn = String(sidc || '').slice(4, 10).toUpperCase();
  if (fn.startsWith('UCA')) return profileById('tracked');
  if (fn.startsWith('UCI') && !fn.startsWith('UCIZ') && !fn.startsWith('UCIM')) return profileById('foot');
  return profileById('wheeled');
}

// Z położeniem (pos = [lon, lat]) noc wynika ze słońca (T30), bez niego ze stałych godzin.
export function isNightAt(iso, timeZone, pos) {
  if (!iso) return false;
  if (Array.isArray(pos) && pos.length >= 2) return isNightPhase(dayPhase(iso, pos));
  const hour = Number(formatClock(iso, timeZone).slice(0, 2));
  return Number.isFinite(hour) && (hour >= NIGHT_FROM || hour < NIGHT_TO);
}

export const speedKmh = (profile, night) => (night ? profile.nightKmh : profile.dayKmh);
// weather (opcjonalnie): rozmokły teren po opadzie wydłuża marsz (groundSpeedFactor).
export const marchMinutesFor = (km, profile, night, weather) => (km / (speedKmh(profile, night) * groundSpeedFactor(weather))) * 60;

// Szacunek bez routera: prosta × współczynnik krętości. `estimate: true` wymusza oznaczenie w widoku.
export function estimateRoute(points) {
  const straightKm = pathLengthKm(points);
  return { estimate: true, source: 'szacunek', km: straightKm * CURVATURE_FACTOR, straightKm, path: null, note: `szacunek (linia prosta × ${String(CURVATURE_FACTOR).replace('.', ',')})` };
}

// Odpowiedź routera ({ coords, km }) → wynik z linią drogową; zła odpowiedź → null (widok liczy szacunek).
export function roadRoute(points, res) {
  const ok = Array.isArray(res?.coords) && res.coords.length >= 2 && res.coords.every((c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite));
  if (!ok || !Number.isFinite(res.km) || res.km < 0) return null;
  return { estimate: false, source: res.source || 'osrm', km: res.km, straightKm: pathLengthKm(points), path: res.coords, note: 'trasa drogowa (OSRM)' };
}

// Odległość punktu od odcinka (m), przybliżenie płaskie wystarczające na skalę 100 m.
function pointToSegmentM(p, a, b) {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110574;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

export function distanceToPathM(pos, path) {
  if (!Array.isArray(path) || path.length === 0) return Infinity;
  if (path.length === 1) return distanceKm(pos, path[0]) * 1000;
  let best = Infinity;
  for (let i = 1; i < path.length; i++) best = Math.min(best, pointToSegmentM(pos, path[i - 1], path[i]));
  return best;
}

// Mosty na trasie drogowej i ostrzeżenia dla sprzętu o masie `massT`: [{ id, name, level, text }] (level: bad / warn).
export function bridgesOnRoute(path, bridges, massT, tolerance = BRIDGE_TOLERANCE_M) {
  const out = [];
  for (const b of Array.isArray(bridges) ? bridges : []) {
    if (!b || !Array.isArray(b.pos) || distanceToPathM(b.pos, path) > tolerance) continue;
    const name = b.name || b.id;
    if (b.status === 'destroyed') out.push({ id: b.id, name, level: 'bad', text: `${name}: most zburzony` });
    else if (Number.isFinite(b.mlc) && b.mlc < massT) out.push({ id: b.id, name, level: 'bad', text: `${name}: nośność ${b.mlc} t < ${massT} t sprzętu` });
    else if (b.status === 'damaged') out.push({ id: b.id, name, level: 'warn', text: `${name}: most uszkodzony` });
  }
  return out;
}

// Wynik dla widoku: trasa + czas marszu + ostrzeżenia (mosty sprawdzane tylko przy trasie drogowej).
export function routeSummary(route, profile, { night = false, bridges = [], weather } = {}) {
  const warnings = route.estimate ? [] : bridgesOnRoute(route.path, bridges, profile.massT);
  return {
    ...route,
    profile,
    night,
    speedKmh: speedKmh(profile, night),
    minutes: marchMinutesFor(route.km, profile, night, weather),
    warnings,
    bridgesChecked: !route.estimate,
  };
}

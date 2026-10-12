// Animacja przemieszczeń między turami: czysta matematyka (długość i punkt na łamanej, wygładzenie czasu)
// oraz budowa planu ruchu z dwóch kolejnych tur. Bez DOM i bez Leaflet — działa też w testach Node.
// Widok mapy tylko odtwarza plan (views/map/motion.js); zob. docs/ARCHITECTURE.md.
import { distanceKm } from './geo.js';

export const ANIMATION_MS = 2500; // czas całej animacji (wszystkie jednostki kończą razem)
export const TRAIL_FADE_MS = 3000; // po tylu ms od końca ślad i duch kontaktu znikają
export const MIN_MOVE_KM = 0.005; // mniejsza zmiana pozycji (5 m) to brak ruchu
const TRACK_JOIN_KM = 0.02; // tolerancja zgodności końców trasy z pozycjami tur (20 m)

const isCoord = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite);

// Wygładzenie czasu: łagodny start i hamowanie (smoothstep), t ∈ [0, 1].
export function easeInOut(t) {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// Długość łamanej [[lon, lat], …] w km.
export function pathLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += distanceKm(points[i - 1], points[i]);
  return sum;
}

// Punkt na łamanej po ułamku jej długości (0 = początek, 1 = koniec); ułamek poza zakresem jest obcinany.
export function pointAt(points, fraction, length = pathLength(points)) {
  if (!points.length) return null;
  if (points.length === 1 || !(length > 0) || !(fraction > 0)) return points[0].slice();
  if (fraction >= 1) return points[points.length - 1].slice();
  let left = fraction * length;
  for (let i = 1; i < points.length; i++) {
    const seg = distanceKm(points[i - 1], points[i]);
    if (left <= seg && seg > 0) {
      const k = left / seg;
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      return [x1 + (x2 - x1) * k, y1 + (y2 - y1) * k];
    }
    left -= seg;
  }
  return points[points.length - 1].slice();
}

// Początek łamanej do ułamka jej długości (ślad za jednostką): punkty pośrednie plus interpolowany koniec.
export function slicePath(points, fraction, length = pathLength(points)) {
  if (!points.length) return [];
  if (!(fraction > 0) || !(length > 0)) return [points[0].slice()];
  if (fraction >= 1) return points.map((p) => p.slice());
  let left = fraction * length;
  const out = [points[0].slice()];
  for (let i = 1; i < points.length; i++) {
    const seg = distanceKm(points[i - 1], points[i]);
    if (left <= seg && seg > 0) {
      const k = left / seg;
      const [x1, y1] = points[i - 1];
      const [x2, y2] = points[i];
      out.push([x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]);
      return out;
    }
    left -= seg;
    out.push(points[i].slice());
  }
  return out;
}

// Trasa jednostki: pole track z nowej tury, domknięta pozycjami z obu tur (jeśli końce odbiegają o > 20 m),
// albo prosta linia od poprzedniej do nowej pozycji, gdy trasy brak lub jest niepoprawna.
export function routeFor(from, to, track) {
  if (!Array.isArray(track) || track.length < 2 || !track.every(isCoord)) return [from.slice(), to.slice()];
  const route = track.map((p) => p.slice());
  if (distanceKm(from, route[0]) > TRACK_JOIN_KM) route.unshift(from.slice());
  if (distanceKm(route[route.length - 1], to) > TRACK_JOIN_KM) route.push(to.slice());
  return route;
}

const hasPos = (x) => isCoord(x?.pos);

// Animacja dotyczy tylko kolejnych tur (N → N+1 wg listy dostępnych tur); skok o więcej tur i cofanie są natychmiastowe.
export function isSequential(from, to, turns) {
  const i = turns.indexOf(from);
  return i >= 0 && turns[i + 1] === to;
}

// Plan ruchu między turami:
//  - moves: jednostki i środki z pozycją w obu turach, które się przesunęły; track = trasa do pokonania,
//  - ghosts: kontakty o tym samym id, które zmieniły zameldowaną pozycję (bez ciągłego ruchu — mgła wojny:
//    wróg pokazuje tylko meldunki, więc rysujemy „ducha” starego położenia i linię do nowego).
export function buildPlan(prev, next) {
  const moves = [];
  const ghosts = [];
  if (!prev || !next) return { moves, ghosts };
  for (const kind of ['units', 'assets']) {
    const before = new Map((prev[kind] || []).filter(hasPos).map((x) => [x.id, x]));
    for (const u of next[kind] || []) {
      const old = before.get(u.id);
      if (!old || !hasPos(u) || distanceKm(old.pos, u.pos) <= MIN_MOVE_KM) continue;
      const route = routeFor(old.pos, u.pos, u.track);
      moves.push({ id: u.id, kind: kind === 'units' ? 'unit' : 'asset', route, lengthKm: pathLength(route), tracked: route.length > 2 || Boolean(u.track) });
    }
  }
  // Konwoje warstwy logistycznej (T17) jadą jak jednostki (pole track); id elementów logistycznych są osobną przestrzenią.
  const beforeConvoys = new Map((prev.logistics?.convoys || []).filter(hasPos).map((x) => [x.id, x]));
  for (const c of next.logistics?.convoys || []) {
    const old = beforeConvoys.get(c.id);
    if (!old || !hasPos(c) || distanceKm(old.pos, c.pos) <= MIN_MOVE_KM) continue;
    const route = routeFor(old.pos, c.pos, c.track);
    moves.push({ id: c.id, kind: 'convoy', route, lengthKm: pathLength(route), tracked: route.length > 2 || Boolean(c.track) });
  }
  const before = new Map((prev.contacts || []).filter(hasPos).map((c) => [c.id, c]));
  for (const c of next.contacts || []) {
    const old = before.get(c.id);
    if (!old || !hasPos(c) || distanceKm(old.pos, c.pos) <= MIN_MOVE_KM) continue;
    ghosts.push({ id: c.id, sidc: old.sidc, from: old.pos.slice(), to: c.pos.slice() });
  }
  return { moves, ghosts };
}

export const planIsEmpty = (plan) => !plan || (!plan.moves.length && !plan.ghosts.length);

// Położenia wszystkich poruszających się obiektów w chwili t ∈ [0, 1] animacji (po wygładzeniu): Map id → [lon, lat].
// Każdy obiekt ma własną prędkość (trasa różnej długości), ale wszystkie kończą w t = 1.
export function positionsAt(plan, t) {
  const f = easeInOut(t);
  return new Map(plan.moves.map((m) => [m.id, pointAt(m.route, f, m.lengthKm)]));
}

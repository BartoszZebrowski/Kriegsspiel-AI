// Czas tury i dni kampanii (T31). Czysty JS (serwer, walidator, sędzia). Opis pól: docs/SCHEMA.md.
// `duration_min` w pliku tury = długość okresu, który ta tura otwiera (od jej `time` do `time` następnej); brak = `turnMinutes`.
// `phases` w scenario.json = dni kampanii: [{ id: 'D+0', start: ISO, title? }], rosnące w czasie.
import { isValidTime } from './schema.js';

export const MAX_DURATION_MIN = 24 * 60;
export const PHASE_FIELDS = ['id', 'start', 'title'];

/** Długość okresu otwieranego przez turę (minuty). */
export function turnDurationMin(turn, scenario) {
  const d = turn?.duration_min;
  return Number.isFinite(d) && d > 0 ? d : scenario?.turnMinutes;
}

/** Oczekiwany czas następnej tury (ms) albo null, gdy brak danych. */
export function expectedNextMs(turn, scenario) {
  const t = Date.parse(turn?.time);
  const d = turnDurationMin(turn, scenario);
  return Number.isFinite(t) && Number.isFinite(d) ? t + d * 60000 : null;
}

/** Błąd (tekst) albo null: `duration_min` to liczba > 0 i ≤ 24 h. */
export function checkDuration(v) {
  if (v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > MAX_DURATION_MIN) return `duration_min musi być liczbą 1–${MAX_DURATION_MIN} (minuty)`;
  return null;
}

/** Lista błędów (teksty) dla `scenario.phases`; pusta = poprawne albo brak pola. */
export function checkPhases(phases, scenario) {
  if (phases === undefined) return [];
  if (!Array.isArray(phases) || !phases.length) return ['phases musi być niepustą listą'];
  const errors = [];
  const ids = new Set();
  let prev = -Infinity;
  for (const [i, p] of phases.entries()) {
    const where = `phases[${p?.id ?? i}]`;
    if (!p || typeof p !== 'object') { errors.push(`${where}: musi być obiektem`); continue; }
    const extra = Object.keys(p).filter((k) => !PHASE_FIELDS.includes(k));
    if (extra.length) errors.push(`${where}: pola spoza schematu: ${extra.join(', ')}`);
    if (typeof p.id !== 'string' || !p.id.trim()) errors.push(`${where}: brak id`);
    else if (ids.has(p.id)) errors.push(`${where}: zduplikowane id`);
    else ids.add(p.id);
    if (!isValidTime(p.start)) { errors.push(`${where}: start musi być czasem ISO`); continue; }
    const t = Date.parse(p.start);
    if (t <= prev) errors.push(`${where}: start nie jest późniejszy niż poprzedniej fazy`);
    if (i === 0 && isValidTime(scenario?.start) && t < Date.parse(scenario.start)) errors.push(`${where}: pierwsza faza zaczyna się przed startem scenariusza`);
    prev = t;
    if (p.title !== undefined && (typeof p.title !== 'string' || p.title.length > 200)) errors.push(`${where}: title musi być tekstem (maks. 200 znaków)`);
  }
  return errors;
}

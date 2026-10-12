// CCIR i cykl meldunków (T48) — wspólny schemat: serwer, walidator i testy. Czysty JS, bez DOM i Node.
// Opis formatu: docs/SCHEMA.md (player/ccir.json, scenario.reportCycle, pola ccir i report wiadomości).
import { isCoord, isValidTime, extraFields } from './schema.js';

export const CCIR_KINDS = ['PIR', 'FFIR'];
export const CCIR_MIN_ITEMS = 3; // zalecane minimum (mniej = uwaga walidatora)
export const CCIR_MAX_ITEMS = 7;
export const CCIR_TEXT_MAX = 200;
export const CCIR_ID_PATTERN = /^(PIR|FFIR)-\d{1,2}$/;
export const CCIR_ITEM_FIELDS = ['id', 'kind', 'text', 'geometry'];
export const CCIR_FILE_FIELDS = ['items'];

// Meldunki cykliczne: SITREP (sytuacyjny), LOGSTAT (logistyczny).
export const REPORT_KINDS = ['sitrep', 'logstat'];
export const REPORT_CYCLE_FIELDS = ['sitrep', 'logstat', 'anchor'];

const GEOMETRY_TYPES = ['Point', 'LineString', 'Polygon'];

/** Geometria pozycji CCIR: Point | LineString (≥ 2 punkty) | Polygon (pierścienie ≥ 4 punkty). Tekst błędu albo null. */
export function checkCcirGeometry(g) {
  if (!g || typeof g !== 'object' || !GEOMETRY_TYPES.includes(g.type)) return `geometria: dozwolone typy ${GEOMETRY_TYPES.join(', ')}`;
  const c = g.coordinates;
  if (g.type === 'Point') return isCoord(c) ? null : 'geometria: nieprawidłowy punkt [lon, lat]';
  if (g.type === 'LineString') return Array.isArray(c) && c.length >= 2 && c.every(isCoord) ? null : 'geometria: linia wymaga co najmniej 2 punktów';
  return Array.isArray(c) && c.length >= 1 && c.every((r) => Array.isArray(r) && r.length >= 4 && r.every(isCoord)) ? null : 'geometria: nieprawidłowy wielokąt';
}

/** Jedna pozycja: { item } (oczyszczona) albo { error } (tekst bez prefiksu). Id musi pasować do rodzaju (PIR-2 → PIR). */
export function checkCcirItem(it) {
  const fail = (error) => ({ error });
  if (!it || typeof it !== 'object' || Array.isArray(it)) return fail('nieprawidłowy obiekt');
  const extra = extraFields(it, CCIR_ITEM_FIELDS);
  if (extra.length) return fail(`pole „${extra[0]}” spoza schematu`);
  if (!CCIR_KINDS.includes(it.kind)) return fail(`kind „${it.kind}” (dozwolone: ${CCIR_KINDS.join(', ')})`);
  if (typeof it.id !== 'string' || !CCIR_ID_PATTERN.test(it.id) || !it.id.startsWith(it.kind + '-')) return fail(`id musi mieć postać ${it.kind}-N`);
  if (typeof it.text !== 'string' || !it.text.trim() || it.text.length > CCIR_TEXT_MAX) return fail(`text wymagany, maks. ${CCIR_TEXT_MAX} znaków`);
  const clean = { id: it.id, kind: it.kind, text: it.text.trim() };
  if (it.geometry !== undefined) {
    const g = checkCcirGeometry(it.geometry);
    if (g) return fail(g);
    clean.geometry = { type: it.geometry.type, coordinates: it.geometry.coordinates };
  }
  return { item: clean };
}

/** Plik player/ccir.json (`{items}`): { errors, warnings, items } (items — oczyszczone pozycje poprawne). */
export function checkCcir(data) {
  const errors = [];
  const warnings = [];
  const items = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { errors: ['ccir: plik musi być obiektem {items}'], warnings, items };
  for (const f of extraFields(data, CCIR_FILE_FIELDS)) errors.push(`ccir: nieznane pole „${f}”`);
  if (!Array.isArray(data.items)) return { errors: [...errors, 'ccir: brak listy items'], warnings, items };
  if (data.items.length > CCIR_MAX_ITEMS) errors.push(`ccir: maksymalnie ${CCIR_MAX_ITEMS} pozycji (jest ${data.items.length})`);
  else if (data.items.length > 0 && data.items.length < CCIR_MIN_ITEMS) warnings.push(`ccir: zalecane ${CCIR_MIN_ITEMS}–${CCIR_MAX_ITEMS} pozycji (jest ${data.items.length})`);
  const ids = new Set();
  for (const it of data.items) {
    const r = checkCcirItem(it);
    if (r.error) errors.push(`ccir [${it?.id ?? '?'}]: ${r.error}`);
    else items.push(r.item);
    if (it?.id && ids.has(it.id)) errors.push(`ccir: zduplikowane id „${it.id}”`);
    if (it?.id) ids.add(it.id);
  }
  return { errors, warnings, items };
}

/** scenario.reportCycle: `{ sitrep, logstat }` w minutach czasu gry (liczby całkowite > 0), opcjonalnie `anchor` (godzina odniesienia ISO). */
export function checkReportCycle(rc) {
  if (rc === undefined) return [];
  if (!rc || typeof rc !== 'object' || Array.isArray(rc)) return ['reportCycle musi być obiektem'];
  const errors = extraFields(rc, REPORT_CYCLE_FIELDS).map((f) => `reportCycle: nieznane pole „${f}”`);
  for (const k of REPORT_KINDS) if (rc[k] !== undefined && !(Number.isInteger(rc[k]) && rc[k] > 0)) errors.push(`reportCycle.${k}: liczba całkowita minut > 0`);
  if (rc.anchor !== undefined && !isValidTime(rc.anchor)) errors.push('reportCycle.anchor: czas ISO');
  return errors;
}

/** Pola `ccir` i `report` wiadomości (opcjonalne): tekst błędu albo null. `ccirIds` — zbiór id pozycji (nieobecna pozycja to osobna uwaga walidatora). */
export function checkMessageReport(m) {
  if (m?.ccir !== undefined && (typeof m.ccir !== 'string' || !CCIR_ID_PATTERN.test(m.ccir))) return 'ccir musi być id pozycji (np. PIR-2)';
  if (m?.report !== undefined && !REPORT_KINDS.includes(m.report)) return `nieznany report (dozwolone: ${REPORT_KINDS.join(', ')})`;
  return null;
}

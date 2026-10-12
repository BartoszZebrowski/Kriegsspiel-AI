// Odprawa sztabu (T28.1): `staff` w player/turns/NNN.json. Czysty JS (serwer, walidator, sędzia).
// Opis pól: docs/SCHEMA.md. Osobny plik, bo shared/schema.js ma jednego właściciela naraz.
import { isValidTime } from './schema.js';

export const STAFF_ROLES = ['s2', 's3', 's4'];
export const STAFF_MAX_ITEMS = 3;
export const STAFF_MAX_TEXT = 300;
export const STAFF_FIELDS = ['role', 'name', 'text', 'time'];

/**
 * Sprawdza listę `staff` tury: ≤ 3 pozycje, role z listy i unikalne, `name` i `text` (≤ 300 znaków), `time` ISO.
 * `time` poza okresem tury (czas tury − turnMinutes … czas tury) to uwaga (gdy znane `turnTime` i `turnMinutes`).
 * Zwraca { errors, warnings } (listy tekstów bez prefiksu).
 */
export function checkStaff(staff, turnTime, turnMinutes) {
  const errors = [];
  const warnings = [];
  if (staff === undefined) return { errors, warnings };
  if (!Array.isArray(staff)) return { errors: ['staff musi być listą'], warnings };
  if (staff.length > STAFF_MAX_ITEMS) errors.push(`staff: najwyżej ${STAFF_MAX_ITEMS} pozycje`);
  const roles = new Set();
  const now = Date.parse(turnTime);
  for (const [i, s] of staff.entries()) {
    const where = `staff[${s?.role ?? i}]`;
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      errors.push(`${where}: pozycja musi być obiektem`);
      continue;
    }
    for (const f of Object.keys(s)) if (!STAFF_FIELDS.includes(f)) errors.push(`${where}: pole „${f}” spoza schematu`);
    if (!STAFF_ROLES.includes(s.role)) errors.push(`${where}: role „${s.role}” (dozwolone: ${STAFF_ROLES.join(', ')})`);
    else if (roles.has(s.role)) errors.push(`${where}: zduplikowana rola`);
    else roles.add(s.role);
    if (typeof s.name !== 'string' || !s.name.trim()) errors.push(`${where}: brak name (stopień nazwisko, funkcja)`);
    if (typeof s.text !== 'string' || !s.text.trim()) errors.push(`${where}: brak text`);
    else if (s.text.length > STAFF_MAX_TEXT) errors.push(`${where}: text dłuższy niż ${STAFF_MAX_TEXT} znaków`);
    if (!isValidTime(s.time)) errors.push(`${where}: time musi być czasem ISO`);
    else if (Number.isFinite(now) && turnMinutes > 0) {
      const t = Date.parse(s.time);
      if (t > now || t < now - turnMinutes * 60000) warnings.push(`${where}: time poza okresem tury`);
    }
  }
  return { errors, warnings };
}

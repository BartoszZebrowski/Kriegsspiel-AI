// Nakładki od przełożonego (T51) — wspólny schemat: walidator i testy. Czysty JS, bez DOM i Node.
// Opis formatu: docs/SCHEMA.md (pole `overlay` wiadomości w player/inbox). Elementy nakładki to szkice (checkNote).
import { checkNote, extraFields } from './schema.js';

export const OVERLAY_FIELDS = ['id', 'name', 'features'];
export const OVERLAY_ID_PATTERN = /^[\w-]{1,30}$/;
export const OVERLAY_NAME_MAX = 60;
export const OVERLAY_MAX_FEATURES = 60;

/** Błąd (tekst) albo null. `overlay` = { id, name, features: [szkic…] }; nieznany znak taktyczny w elemencie = błąd. */
export function checkOverlay(overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return 'overlay musi być obiektem';
  const extra = extraFields(overlay, OVERLAY_FIELDS);
  if (extra.length) return `overlay: pole „${extra[0]}” spoza schematu`;
  if (typeof overlay.id !== 'string' || !OVERLAY_ID_PATTERN.test(overlay.id)) return 'overlay.id: 1–30 znaków (litery, cyfry, _ i -)';
  if (typeof overlay.name !== 'string' || !overlay.name.trim() || overlay.name.length > OVERLAY_NAME_MAX) return `overlay.name: wymagana, maks. ${OVERLAY_NAME_MAX} znaków`;
  const f = overlay.features;
  if (!Array.isArray(f) || f.length < 1 || f.length > OVERLAY_MAX_FEATURES) return `overlay.features: lista 1–${OVERLAY_MAX_FEATURES} elementów`;
  const ids = new Set();
  for (const n of f) {
    const r = checkNote(n);
    if (r.error) return `overlay.features [${n?.id ?? '?'}]: ${r.error}`;
    if (ids.has(n.id)) return `overlay.features: zduplikowane id „${n.id}”`;
    ids.add(n.id);
  }
  return null;
}

// Formularze meldunków i rozkazów (T50) — wspólny schemat struktury `form: { kind, fields }` wiadomości
// (serwer, walidator, testy). Czysty JS, bez DOM i Node. Pola szablonów i wymagalność: public/js/domain/forms.js.
import { checkCcirGeometry } from './ccir.js';

// Lustro FORM_IDS z domain/forms.js (`domain/` nie importuje z `shared/`; test pilnuje zgodności).
export const FORM_KINDS = ['spotrep', 'logstat', 'frago', 'fire'];
export const FORM_FIELDS = ['kind', 'fields'];
export const MAX_FORM_FIELDS = 20;
export const MAX_FORM_VALUE = 1000;

/** Struktura `form`: tekst błędu albo null. Wartość pola: tekst (≤ 1000 znaków), liczba skończona albo geometria. */
export function checkFormShape(form) {
  if (!form || typeof form !== 'object' || Array.isArray(form)) return 'form musi być obiektem { kind, fields }';
  for (const k of Object.keys(form)) if (!FORM_FIELDS.includes(k)) return `form: pole „${k}” spoza schematu`;
  if (!FORM_KINDS.includes(form.kind)) return `form: nieznany kind (dozwolone: ${FORM_KINDS.join(', ')})`;
  const f = form.fields;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return 'form.fields musi być obiektem';
  const entries = Object.entries(f);
  if (entries.length > MAX_FORM_FIELDS) return `form.fields: najwyżej ${MAX_FORM_FIELDS} pól`;
  for (const [id, v] of entries) {
    if (typeof v === 'string') {
      if (v.length > MAX_FORM_VALUE) return `form.fields.${id}: tekst dłuższy niż ${MAX_FORM_VALUE} znaków`;
    } else if (typeof v === 'number') {
      if (!Number.isFinite(v)) return `form.fields.${id}: liczba musi być skończona`;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const err = checkCcirGeometry(v);
      if (err) return `form.fields.${id}: ${err}`;
    } else return `form.fields.${id}: dozwolony tekst, liczba albo geometria`;
  }
  return null;
}

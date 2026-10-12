// Status zgłoszenia ognia (T52) — pole `fire` wiadomości `player/inbox` (odpowiedź sędziego na formularz `fire`).
// Czysty JS, bez DOM i Node. Pole niesie WYŁĄCZNIE status zgłoszenia, nigdy skutek ognia (skutek: obserwacja i meldunki).
import { isValidTime } from './schema.js';

export const FIRE_STATUSES = ['accepted', 'refused', 'done'];
export const FIRE_FIELDS = ['request_id', 'status', 'time', 'rounds', 'reason'];
export const MAX_FIRE_REASON = 300;

/** Pole `fire` wiadomości: tekst błędu albo null (brak pola = null). */
export function checkMessageFire(m) {
  const f = m?.fire;
  if (f === undefined) return null;
  if (!f || typeof f !== 'object' || Array.isArray(f)) return 'fire musi być obiektem { request_id, status, time }';
  for (const k of Object.keys(f)) if (!FIRE_FIELDS.includes(k)) return `fire: pole „${k}” spoza schematu (skutek ognia nie należy do statusu)`;
  if (typeof f.request_id !== 'string' || !f.request_id) return 'fire.request_id: id wiadomości ze zgłoszeniem (tekst)';
  if (!FIRE_STATUSES.includes(f.status)) return `fire.status: dozwolone ${FIRE_STATUSES.join(', ')}`;
  if (!isValidTime(f.time)) return 'fire.time: czas ISO ze strefą';
  if (f.rounds !== undefined) {
    if (f.status !== 'done') return 'fire.rounds: tylko przy statusie done';
    if (!Number.isInteger(f.rounds) || f.rounds < 0) return 'fire.rounds: liczba całkowita ≥ 0';
  }
  if (f.reason !== undefined) {
    if (typeof f.reason !== 'string' || f.reason.length > MAX_FIRE_REASON) return `fire.reason: tekst do ${MAX_FIRE_REASON} znaków`;
    if (f.status !== 'refused') return 'fire.reason: tylko przy statusie refused';
  }
  if (f.status === 'refused' && !f.reason) return 'fire.reason: wymagany przy odmowie';
  return null;
}

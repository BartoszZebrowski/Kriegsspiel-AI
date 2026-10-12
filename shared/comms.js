// Utrata łączności (T19). Czysty JS (serwer, walidator, sędzia). Opis pól: docs/SCHEMA.md.
// Gracz (player/turns): `comms: {status, last_contact}` — wiedza sztabu. Prawda sędziego (umpire/turns):
// `comms_true: {status, since, cause}`.
import { isValidTime } from './schema.js';

export const COMMS_STATUSES = ['ok', 'degraded', 'lost'];

/** Plik gracza: błąd (tekst) albo null. `turnTime` – czas tury (ISO). */
export function checkComms(comms, turnTime) {
  if (!comms || typeof comms !== 'object' || Array.isArray(comms)) return 'comms musi być obiektem {status, last_contact}';
  if (!COMMS_STATUSES.includes(comms.status)) return `comms.status „${comms.status}” (dozwolone: ${COMMS_STATUSES.join(', ')})`;
  if (comms.last_contact === undefined) return comms.status === 'ok' ? null : 'comms.last_contact wymagany przy degraded/lost';
  if (!isValidTime(comms.last_contact)) return 'comms.last_contact musi być czasem ISO';
  if (turnTime && Date.parse(comms.last_contact) > Date.parse(turnTime)) return 'comms.last_contact późniejszy niż czas tury';
  return null;
}

/** Prawda sędziego (jednostka): lista błędów (teksty bez prefiksu). */
export function checkUmpireComms(unit) {
  const t = unit?.comms_true;
  if (t === undefined) return [];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return ['comms_true musi być obiektem {status, since, cause}'];
  const errors = [];
  if (!COMMS_STATUSES.includes(t.status)) errors.push(`comms_true.status „${t.status}” (dozwolone: ${COMMS_STATUSES.join(', ')})`);
  if (t.since !== undefined && !isValidTime(t.since)) errors.push('comms_true.since musi być czasem ISO');
  if (t.cause !== undefined && typeof t.cause !== 'string') errors.push('comms_true.cause musi być tekstem');
  return errors;
}

/** Widok gracza z prawdy: `comms` albo null, gdy łączność ok. */
export function commsFromTruth(truth) {
  if (!truth || truth.status === 'ok' || !COMMS_STATUSES.includes(truth.status)) return null;
  return truth.since ? { status: truth.status, last_contact: truth.since } : { status: truth.status };
}

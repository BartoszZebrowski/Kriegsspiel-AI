// Łączność jednostek własnych (T19): `comms: {status, last_contact}` z pliku gracza → opis do mapy, karty i komunikatora.
// Czyste funkcje, bez DOM. Brak pola = łączność ok. Lista statusów lustrzana do shared/comms.js (domain/ nie importuje z shared/).
// Prawda łączności (comms_true) jest tylko w umpire/ — klient jej nie zna.
import { ageMinutes, formatClock, formatAgeShort } from './format.js';
import { channelUnitId } from './orbat.js';

const STATUSES = ['ok', 'degraded', 'lost'];
const TONE = { ok: 'ok', degraded: 'warn', lost: 'bad' };

// → { status, lost, degraded, tone, lastContact (ISO|null), ageMin (min|null), clock ('06:12'|''), text }
// `text`: '' dla ok; 'brak łączności od 06:12' / 'łączność słaba (ostatni kontakt 06:12)'.
export function commsInfo(unit, turnTime, tz) {
  const c = unit?.comms;
  const status = STATUSES.includes(c?.status) ? c.status : 'ok';
  const lastContact = status !== 'ok' && c?.last_contact ? c.last_contact : null;
  const ageMin = lastContact && turnTime ? ageMinutes(lastContact, turnTime) : null;
  const clock = lastContact ? formatClock(lastContact, tz) : '';
  let text = '';
  if (status === 'lost') text = clock ? `brak łączności od ${clock}` : 'brak łączności';
  else if (status === 'degraded') text = clock ? `łączność słaba (ostatni kontakt ${clock})` : 'łączność słaba';
  return { status, lost: status === 'lost', degraded: status === 'degraded', tone: TONE[status], lastContact, ageMin, clock, text };
}

// Ostrzeżenie pod polem wiadomości; '' gdy łączność ok.
export function commsWarning(unit, turnTime, tz) {
  const i = commsInfo(unit, turnTime, tz);
  if (i.lost) return `${i.text} — doręczenie niepewne`;
  if (i.degraded) return `${i.text} — doręczenie może być opóźnione`;
  return '';
}

// Jednostka, do której prowadzi kanał (lub null) → jej commsInfo; do znaczników na liście kanałów.
export function channelComms(channel, units = [], turnTime, tz) {
  const id = channelUnitId(channel);
  const unit = id ? units.find((u) => u.id === id) : null;
  return unit ? commsInfo(unit, turnTime, tz) : commsInfo(null, turnTime, tz);
}

// Wiersz karty: 'brak łączności od 06:12 (48 min)'; '' dla ok.
export const commsCardText = (info) => (info.text ? (info.ageMin != null && info.ageMin > 0 ? `${info.text} (${formatAgeShort(info.ageMin)})` : info.text) : '');

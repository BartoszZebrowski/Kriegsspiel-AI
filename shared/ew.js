// Walka radioelektroniczna (T26) i doręczanie rozkazów (T25): stałe i walidatory. Opis: docs/SCHEMA.md.
// Czysty JS jak schema.js (serwer, walidator, narzędzia sędziego). Zależy tylko od shared/schema.js.
import { isCoord, isValidTime, extraFields } from './schema.js';

// --- Walka radioelektroniczna (T26): strefy zagłuszenia i nadajniki ---

// `ew_zone` (lines[] gracza i sędziego): zamknięty wielokąt (≥ 4 punkty, pierwszy == ostatni), `label`,
// `observed` (czas meldunku ISO; nie późniejszy niż czas tury — to meldunek, nie prawda).
// Zwraca listę błędów (puste = poprawna). Dla innych rodzajów linii niczego nie sprawdza.
export function checkEwZone(line, turnTime) {
  const errors = [];
  if (line?.kind !== 'ew_zone') return errors;
  const c = line.coords;
  if (!Array.isArray(c) || c.length < 4 || !c.every(isCoord)) errors.push('ew_zone wymaga zamkniętego wielokąta (co najmniej 4 punkty [lon, lat])');
  else if (c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1]) errors.push('ew_zone: wielokąt niezamknięty (pierwszy punkt musi równać się ostatniemu)');
  if (typeof line.label !== 'string' || !line.label.trim()) errors.push('ew_zone: brak label');
  if (!isValidTime(line.observed)) errors.push('ew_zone: observed musi być czasem ISO (czas meldunku)');
  else if (isValidTime(turnTime) && Date.parse(line.observed) > Date.parse(turnTime)) errors.push('ew_zone: observed późniejszy niż czas tury');
  return errors;
}

// Kontakt-nadajnik: funkcja SIDC `UUMSEI` (pozycje 5–10). Namierzony nadajnik to zawsze kontakt niepotwierdzony
// (status `A`, ramka przerywana): DF daje pozycję z błędem, nie obserwację.
export const EMITTER_FUNCTION = 'UUMSEI';
export const isEmitterSidc = (sidc) => typeof sidc === 'string' && sidc.length === 15 && sidc.slice(4, 10).replace(/-+$/, '') === EMITTER_FUNCTION;
/** Błąd (tekst) albo null: kontakt-nadajnik musi mieć status `A` (4. znak SIDC). */
export const checkEmitterContact = (c) => (isEmitterSidc(c?.sidc) && c.sidc[3] !== 'A' ? 'kontakt-nadajnik musi mieć status A w SIDC (4. znak)' : null);

// --- Doręczanie rozkazów (T25) i prawdziwy obraz REW: TYLKO umpire/turns ---

export const DELIVERY_MEANS = ['radio', 'relay', 'courier', 'lost'];
export const DELIVERY_FIELDS = ['msg_id', 'to', 'sent', 'delivered', 'means', 'note'];
export const EW_ZONE_KINDS = ['jamming', 'df', 'decoy'];

/**
 * Walidacja `deliveries` (umpire/turns): lista { msg_id, to, sent, delivered|null, means, note? }.
 * `delivered` = godzina doręczenia (może wypaść po czasie tury, gdy rozkaz jest jeszcze w drodze); null tylko dla `lost`.
 * Zwraca { errors, warnings }.
 */
export function checkDeliveries(list) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(list)) return { errors: ['deliveries musi być listą'], warnings };
  for (const [i, d] of list.entries()) {
    const where = `deliveries[${d?.msg_id ?? i}]`;
    if (!d || typeof d !== 'object' || Array.isArray(d)) { errors.push(`${where}: nieprawidłowy element`); continue; }
    for (const f of extraFields(d, DELIVERY_FIELDS)) errors.push(`${where}: pole „${f}” spoza schematu`);
    if (typeof d.msg_id !== 'string' || !d.msg_id) errors.push(`${where}: brak msg_id`);
    if (typeof d.to !== 'string' || !d.to) errors.push(`${where}: brak to (id jednostki lub kanału adresata)`);
    if (!isValidTime(d.sent)) errors.push(`${where}: sent musi być czasem ISO`);
    if (!DELIVERY_MEANS.includes(d.means)) errors.push(`${where}: means „${d.means}” (dozwolone: ${DELIVERY_MEANS.join(', ')})`);
    if (d.means === 'lost') {
      if (d.delivered !== null) errors.push(`${where}: zgubiony rozkaz (lost) musi mieć delivered: null`);
    } else if (!isValidTime(d.delivered)) errors.push(`${where}: delivered musi być czasem ISO (null tylko dla lost)`);
    else if (isValidTime(d.sent) && Date.parse(d.delivered) < Date.parse(d.sent)) errors.push(`${where}: delivered wcześniejsze niż sent`);
    if (d.note !== undefined && typeof d.note !== 'string') errors.push(`${where}: note musi być tekstem`);
  }
  return { errors, warnings };
}

/**
 * Walidacja `ew` (umpire/turns): prawdziwy obraz REW { zones: [{ id, kind, owner, coords, … }] }.
 * Strefa: zamknięty wielokąt jak ew_zone; `kind` ∈ EW_ZONE_KINDS; `owner` tekst (np. 'RU', 'PL'); opcjonalne `from`/`until` (ISO).
 * Pola dodatkowe w strefie dozwolone. Zwraca listę błędów.
 */
export function checkEw(ew) {
  const errors = [];
  if (!ew || typeof ew !== 'object' || Array.isArray(ew)) return ['ew musi być obiektem'];
  for (const k of Object.keys(ew)) if (k !== 'zones') errors.push(`ew: nieznane pole „${k}”`);
  if (ew.zones === undefined) return errors;
  if (!Array.isArray(ew.zones)) return [...errors, 'ew.zones musi być listą'];
  const ids = new Set();
  for (const [i, z] of ew.zones.entries()) {
    const where = `ew.zones[${z?.id ?? i}]`;
    if (!z || typeof z !== 'object') { errors.push(`${where}: nieprawidłowy element`); continue; }
    if (typeof z.id !== 'string' || !z.id) errors.push(`${where}: brak id`);
    else if (ids.has(z.id)) errors.push(`${where}: zduplikowane id`);
    else ids.add(z.id);
    if (!EW_ZONE_KINDS.includes(z.kind)) errors.push(`${where}: kind „${z.kind}” (dozwolone: ${EW_ZONE_KINDS.join(', ')})`);
    if (typeof z.owner !== 'string' || !z.owner) errors.push(`${where}: brak owner`);
    const c = z.coords;
    if (!Array.isArray(c) || c.length < 4 || !c.every(isCoord) || c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1]) errors.push(`${where}: coords wymaga zamkniętego wielokąta (≥ 4 punkty, pierwszy == ostatni)`);
    for (const f of ['from', 'until']) if (z[f] !== undefined && !isValidTime(z[f])) errors.push(`${where}: ${f} musi być czasem ISO`);
  }
  return errors;
}

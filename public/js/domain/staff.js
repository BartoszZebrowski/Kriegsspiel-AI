// Odprawa sztabu (T28.1): karty S2/S3/S4 z `turn.staff`, kanał postaci i stan panelu (zamknięte tury). Czyste funkcje.
// Role lustrzane do shared/staff.js (domain/ nie importuje spoza domain/).
import { formatDtg } from './format.js';

export const STAFF_ROLES = ['s2', 's3', 's4'];

export const STAFF_ROLE_INFO = {
  s2: { badge: 'S2', title: 'Wywiad' },
  s3: { badge: 'S3', title: 'Operacje' },
  s4: { badge: 'S4', title: 'Logistyka' },
};

// Kanał postaci dla roli: kanał o id = rola, a gdy go brak — kanał o rodzaju z rezerwy (s2 → rozpoznanie, s4 → logistyka).
// S3 nie ma rezerwy (dowództwo to nie „osobny” kanał): bez własnego kanału karta jest tylko do czytania.
const FALLBACK_KIND = { s2: 'recon', s3: null, s4: 'logistics' };
export function staffChannelId(role, channels) {
  const list = channels || [];
  const own = list.find((c) => c.id === role);
  if (own) return own.id;
  const kind = FALLBACK_KIND[role];
  return (kind && list.find((c) => c.kind === kind)?.id) || null;
}

/** Karty odprawy w kolejności S2, S3, S4: { role, badge, title, name, text, time, dtg, channel }. Nieznane role pomijamy. */
export function staffCards(staff, channels, timezone) {
  if (!Array.isArray(staff)) return [];
  return STAFF_ROLES.flatMap((role) => {
    const s = staff.find((x) => x?.role === role);
    if (!s || typeof s.text !== 'string') return [];
    const { badge, title } = STAFF_ROLE_INFO[role];
    return [{ role, badge, title, name: s.name || badge, text: s.text, time: s.time, dtg: s.time ? formatDtg(s.time, timezone) : '', channel: staffChannelId(role, channels) }];
  });
}

// ---------- stan panelu ----------
// `closed` — tury zamknięte w trybie bieżącym (zapamiętane), `recalled` — tury przywołane w archiwum (tylko sesja).
export const emptyStaffUi = () => ({ closed: [], recalled: [] });

/** Czy panel jest otwarty: bieżąca tura otwiera się sama, dopóki jej nie zamknięto; archiwum tylko na żądanie. */
export function isStaffOpen({ cards, staffUi, viewTurn, archive }) {
  if (!cards?.length) return false;
  return archive ? staffUi.recalled.includes(viewTurn) : !staffUi.closed.includes(viewTurn);
}

const without = (list, n) => list.filter((x) => x !== n);
const withTurn = (list, n) => (list.includes(n) ? list : [...list, n]);

/** Zamknięcie panelu oglądanej tury → nowy `staffUi`. */
export function closeStaff(staffUi, viewTurn, archive) {
  return archive ? { ...staffUi, recalled: without(staffUi.recalled, viewTurn) } : { ...staffUi, closed: withTurn(staffUi.closed, viewTurn) };
}

/** Przywołanie panelu oglądanej tury → nowy `staffUi`. */
export function openStaff(staffUi, viewTurn, archive) {
  return archive ? { ...staffUi, recalled: withTurn(staffUi.recalled, viewTurn) } : { ...staffUi, closed: without(staffUi.closed, viewTurn) };
}

/** Lista zamkniętych tur z zapisu (odporna na śmieci w localStorage). */
export const sanitizeClosed = (v) => (Array.isArray(v) ? v.filter((n) => Number.isInteger(n) && n >= 0) : []);

// Pozycje własnych sił z BFT (Blue Force Tracking, T49): `pos` jednostki w widoku gracza to OSTATNIA ZAMELDOWANA
// pozycja, a `pos_time` — czas raportu. Brak `pos_time` = pozycja z czasu tury (zgodność wstecz). Czyste funkcje,
// bez DOM; widok mapy przygasza symbol, a karta pokazuje czas ostatniego raportu. Prawda o pozycji jest tylko w umpire/.
import { ageMinutes, formatClock, formatAgeShort } from './format.js';

export const BFT_STALE_MIN = 30; // pozycja starsza niż tyle minut jest „nieświeża”: symbol przygaszony
export const BFT_STALE_OPACITY = 0.5;

// Czas raportu pozycji jednostki (ISO): `pos_time` albo czas tury.
export const posTimeOf = (unit, turnTime) => unit?.pos_time || turnTime;

// Wiek pozycji w minutach względem czasu tury (0 = świeża; null, gdy czasy są nieczytelne).
export function posAgeMin(unit, turnTime) {
  if (!unit?.pos_time || !turnTime) return 0;
  return ageMinutes(unit.pos_time, turnTime);
}

export function isPosStale(unit, turnTime, threshold = BFT_STALE_MIN) {
  const age = posAgeMin(unit, turnTime);
  return age !== null && age > threshold;
}

// Krycie symbolu na mapie: pełne, a dla nieświeżej pozycji przygaszone.
export const posOpacity = (unit, turnTime, threshold = BFT_STALE_MIN) => (isPosStale(unit, turnTime, threshold) ? BFT_STALE_OPACITY : 1);

// Opis do podpowiedzi i karty; `text` jest pusty, gdy pozycja jest świeża.
// → { stale, ageMin, reportedAt (ISO), text: 'pozycja z 06:12 (48 min temu)' | '' }
export function bftStatus(unit, turnTime, tz, threshold = BFT_STALE_MIN) {
  const ageMin = posAgeMin(unit, turnTime);
  const stale = ageMin !== null && ageMin > threshold;
  const reportedAt = posTimeOf(unit, turnTime);
  const text = stale ? `pozycja z ${formatClock(reportedAt, tz)} (${formatAgeShort(ageMin)} temu)` : '';
  return { stale, ageMin, reportedAt, text };
}

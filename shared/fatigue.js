// Zmęczenie i morale (T28). Czysty JS (serwer, walidator, sędzia). Opis pól: docs/SCHEMA.md.
// Prawda sędziego (umpire/turns): `stamina_min` (reszta wytrzymałości, minuty) i `morale` (0–1).
// Gracz widzi w player/turns wyłącznie kategorię `fatigue`.

export const FATIGUE_LEVELS = ['wypoczęta', 'zmęczona', 'wyczerpana'];
export const FATIGUE_TIRED_BELOW_MIN = 720; // < 12 h wytrzymałości: zmęczona
export const FATIGUE_EXHAUSTED_BELOW_MIN = 240; // < 4 h: wyczerpana

const isNonNeg = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Kategoria widoczna dla gracza z `stamina_min` albo null, gdy wartość niepoprawna. */
export function fatigueLevel(enduranceMin) {
  if (!isNonNeg(enduranceMin)) return null;
  if (enduranceMin < FATIGUE_EXHAUSTED_BELOW_MIN) return 'wyczerpana';
  if (enduranceMin < FATIGUE_TIRED_BELOW_MIN) return 'zmęczona';
  return 'wypoczęta';
}

/** Plik gracza: błąd (tekst) albo null. */
export function checkFatigue(fatigue) {
  return FATIGUE_LEVELS.includes(fatigue) ? null : `fatigue „${fatigue}” (dozwolone: ${FATIGUE_LEVELS.join(', ')})`;
}

/** Prawda sędziego (jednostka): lista błędów (teksty bez prefiksu). */
export function checkUmpireFatigue(unit) {
  const errors = [];
  if (unit?.stamina_min !== undefined && !isNonNeg(unit.stamina_min)) errors.push('stamina_min musi być liczbą ≥ 0 (minuty)');
  if (unit?.morale !== undefined && !(isNonNeg(unit.morale) && unit.morale <= 1)) errors.push('morale musi być liczbą 0–1');
  return errors;
}

// Strefy REW (lines[].kind = 'ew_zone', T26): czysta logika widoku: wybór stref z linii tury i etykieta z wiekiem meldunku.
import { formatAge } from './format.js';

export const EW_ZONE_KIND = 'ew_zone';
export const EW_ZONE_NAME = 'strefa zagłuszenia (REW)';

/** Strefy REW z `lines` tury → [{ id, coords, label, age }]; `age` = „1 h 20 min temu” (puste bez observed lub czasu tury). */
export function ewZones(lines, turnTime) {
  return (lines || [])
    .filter((l) => l?.kind === EW_ZONE_KIND && Array.isArray(l.coords) && l.coords.length >= 4)
    .map((l) => ({
      id: l.id,
      coords: l.coords,
      label: l.label || EW_ZONE_NAME,
      age: l.observed && turnTime ? formatAge(l.observed, turnTime) : '',
    }));
}

/** Etykieta strefy na mapie: „nazwa · meldunek 1 h 20 min temu”. */
export const ewZoneLabel = (z) => (z.age ? `${z.label} · meldunek ${z.age}` : z.label);

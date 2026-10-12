// Wojska inżynieryjne (T27): obiekty inżynieryjne (zapory, przejścia, mosty) — stałe i walidatory. Opis: docs/SCHEMA.md.
// Czysty JS jak schema.js (serwer, walidator, narzędzia sędziego). Lista pól gracza leży w PLAYER_FIELDS.engineering;
// pola spoza niej w pliku gracza zgłasza strażnik wycieku (checkPlayerFields w tools/validate-checks.js).
import { isCoord, isValidTime } from './schema.js';

// Rodzaj → geometria: polygon = zamknięty wielokąt `coords`, line = łamana `coords` (≥ 2 punkty), point = `pos`.
export const ENGINEERING_GEOMETRY = {
  minefield: 'polygon', // pole minowe
  obstacle: 'line', // linia zapór (rowy, zawały, zapory inżynieryjne)
  lane: 'line', // przejście w zaporze
  temp_bridge: 'point', // most składany / pontonowy (budowany lub gotowy)
  bridge: 'point', // most stały (stan: cały / uszkodzony / zburzony)
};
export const ENGINEERING_KINDS = Object.keys(ENGINEERING_GEOMETRY);
export const WORK_STATES = ['planned', 'building', 'done']; // planowane / wykonywane / gotowe
export const BRIDGE_STATES = ['intact', 'damaged', 'destroyed']; // jak BRIDGE_STATUSES w schema.js
export const PLAYER_ENGINEERING_OWNERS = ['own', 'enemy'];
export const CONFIDENCE_LEVELS = ['wysoka', 'średnia', 'niska'];

/** Dozwolone stany dla rodzaju (most stały: stan mostu; reszta: stan zadania). */
export const statesFor = (kind) => (kind === 'bridge' ? BRIDGE_STATES : WORK_STATES);

function checkGeometry(item, where, errors) {
  const g = ENGINEERING_GEOMETRY[item.kind];
  if (g === 'point') {
    if (!isCoord(item.pos)) errors.push(`${where}: nieprawidłowe pos [lon, lat]`);
    return;
  }
  const c = item.coords;
  if (!Array.isArray(c) || !c.every(isCoord)) return errors.push(`${where}: coords wymaga punktów [lon, lat]`);
  if (g === 'line' && c.length < 2) errors.push(`${where}: coords wymaga co najmniej 2 punktów`);
  if (g === 'polygon' && (c.length < 4 || c[0][0] !== c[c.length - 1][0] || c[0][1] !== c[c.length - 1][1])) errors.push(`${where}: ${item.kind} wymaga zamkniętego wielokąta (≥ 4 punkty, pierwszy == ostatni)`);
}

/**
 * Walidacja listy `engineering`.
 *  - prawda (`umpire/turns`, player = false): `owner` = tekst (strona: 'PL', 'RU'…), pola dodatkowe dozwolone;
 *  - widok gracza (`player: true`): pola spoza PLAYER_FIELDS.engineering łapie strażnik wycieku, `owner` ∈ own | enemy;
 *    obiekt wrogi to wiedza z rozpoznania — wymaga `observed` (ISO, nie późniejszy niż czas tury).
 * `progress` (0–100, %) ma sens przy stanie `building`. Zwraca { errors, warnings }.
 */
export function checkEngineering(list, { player = false, turnTime } = {}) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(list)) return { errors: ['engineering musi być listą'], warnings };
  const ids = new Set();
  for (const [i, it] of list.entries()) {
    const where = `engineering[${it?.id ?? i}]`;
    if (!it || typeof it !== 'object' || Array.isArray(it)) { errors.push(`${where}: nieprawidłowy element`); continue; }
    if (typeof it.id !== 'string' || !it.id) errors.push(`${where}: brak id`);
    else if (ids.has(it.id)) errors.push(`${where}: zduplikowane id`);
    else ids.add(it.id);
    if (!ENGINEERING_KINDS.includes(it.kind)) { errors.push(`${where}: kind „${it.kind}” (dozwolone: ${ENGINEERING_KINDS.join(', ')})`); continue; }
    if (player ? !PLAYER_ENGINEERING_OWNERS.includes(it.owner) : (typeof it.owner !== 'string' || !it.owner)) {
      errors.push(player ? `${where}: owner „${it.owner}” (dozwolone: ${PLAYER_ENGINEERING_OWNERS.join(', ')})` : `${where}: brak owner (strona, np. PL, RU)`);
    }
    if (!statesFor(it.kind).includes(it.state)) errors.push(`${where}: state „${it.state}” dla ${it.kind} (dozwolone: ${statesFor(it.kind).join(', ')})`);
    checkGeometry(it, where, errors);
    if (it.progress !== undefined) {
      if (typeof it.progress !== 'number' || !(it.progress >= 0 && it.progress <= 100)) errors.push(`${where}: progress musi być liczbą 0–100 (%)`);
      else if (it.state !== 'building') warnings.push(`${where}: progress ma sens tylko przy stanie building`);
    } else if (it.state === 'building') warnings.push(`${where}: stan building bez progress`);
    if (it.label !== undefined && typeof it.label !== 'string') errors.push(`${where}: label musi być tekstem`);
    if (it.unit !== undefined && typeof it.unit !== 'string') errors.push(`${where}: unit musi być tekstem (id jednostki saperskiej)`);
    for (const f of ['observed', 'changed_at', 'started', 'until']) if (it[f] !== undefined && !isValidTime(it[f])) errors.push(`${where}: ${f} musi być czasem ISO`);
    if (it.confidence !== undefined && !CONFIDENCE_LEVELS.includes(it.confidence)) errors.push(`${where}: confidence „${it.confidence}” (dozwolone: ${CONFIDENCE_LEVELS.join(', ')})`);
    if (player && it.owner === 'enemy') {
      if (!isValidTime(it.observed)) errors.push(`${where}: obiekt przeciwnika wymaga observed (czas meldunku ISO)`);
      if (typeof it.source !== 'string' || !it.source.trim()) warnings.push(`${where}: obiekt przeciwnika bez source (skąd wiadomo?)`);
    }
    if (isValidTime(turnTime) && isValidTime(it.observed) && Date.parse(it.observed) > Date.parse(turnTime)) errors.push(`${where}: observed późniejszy niż czas tury`);
  }
  return { errors, warnings };
}

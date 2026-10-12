// Rozkaz graficzny (T44): schemat załącznika strukturalnego do wiadomości gracza.
// Czysty JS (bez DOM i bez API Node) — używają go serwer, walidator scenariusza i testy. Opis: docs/SCHEMA.md.
import { isCoord } from './schema.js';

// Zadanie → dozwolone typy geometrii GeoJSON. Nazwy i znaki taktyczne dla UI: public/js/domain/order.js (te same id).
export const ORDER_TASKS = {
  move: ['Point', 'LineString'], // marsz do (punkt albo trasa)
  occupy: ['Polygon'], // zajmij rejon
  defend: ['LineString'], // broń rubieży
  attack: ['Point', 'LineString', 'Polygon'], // natarcie na (cel, oś albo rejon)
  recon: ['Point', 'LineString', 'Polygon'], // rozpoznanie
};
export const MAX_ORDER_UNITS = 12;
export const MAX_ORDER_NAME = 80;
export const ORDER_FIELDS = ['id', 'kind', 'name', 'units', 'task', 'geometry'];

const validGeometry = (g) => {
  if (!g || typeof g !== 'object') return false;
  const c = g.coordinates;
  if (g.type === 'Point') return isCoord(c);
  if (g.type === 'LineString') return Array.isArray(c) && c.length >= 2 && c.every(isCoord);
  if (g.type === 'Polygon') return Array.isArray(c) && c.length >= 1 && c.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isCoord));
  return false;
};

/**
 * Walidacja załącznika rozkazu graficznego. Zwraca { order } (oczyszczony) albo { error } (komunikat po polsku).
 * `knownUnits` (opcjonalnie, tablica/zbiór id): jednostki muszą należeć do tego zbioru.
 */
export function checkOrderAttachment(a, knownUnits) {
  const fail = (error) => ({ error });
  if (!a || typeof a !== 'object') return fail('nieprawidłowy obiekt');
  if (typeof a.id !== 'string' || !/^[\w-]{1,40}$/.test(a.id)) return fail('nieprawidłowe id');
  if (a.kind !== undefined && a.kind !== 'order') return fail('kind musi być „order”');
  if (typeof a.name !== 'string' || !a.name.trim() || a.name.length > MAX_ORDER_NAME) return fail(`nazwa wymagana, maks. ${MAX_ORDER_NAME} znaków`);
  if (!Object.hasOwn(ORDER_TASKS, a.task)) return fail(`nieznane zadanie (dozwolone: ${Object.keys(ORDER_TASKS).join(', ')})`);
  if (!Array.isArray(a.units) || !a.units.length || a.units.length > MAX_ORDER_UNITS) return fail(`units: od 1 do ${MAX_ORDER_UNITS} jednostek`);
  if (!a.units.every((u) => typeof u === 'string' && u) || new Set(a.units).size !== a.units.length) return fail('units: id jednostek (tekst) bez powtórzeń');
  if (knownUnits) {
    const known = knownUnits instanceof Set ? knownUnits : new Set(knownUnits);
    const missing = a.units.find((u) => !known.has(u));
    if (missing) return fail(`nieznana jednostka „${missing}”`);
  }
  if (!validGeometry(a.geometry)) return fail('nieprawidłowa geometria');
  if (!ORDER_TASKS[a.task].includes(a.geometry.type)) return fail(`zadanie „${a.task}” nie przyjmuje geometrii ${a.geometry.type}`);
  return {
    order: { id: a.id, kind: 'order', name: a.name.trim(), units: [...a.units], task: a.task, geometry: { type: a.geometry.type, coordinates: a.geometry.coordinates } },
  };
}

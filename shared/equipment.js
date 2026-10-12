// Walidacja katalogu wyposażenia (data/equipment.json) i odwołań `ref` — czysty JS, bez DOM i Node.
// Struktura i uzasadnienie: docs/ARCHITECTURE.md („Katalog wyposażenia”), pola jednostek: docs/SCHEMA.md.

export const EQUIPMENT_SIDES = ['PL', 'RU'];

const isText = (v) => typeof v === 'string' && v.trim().length > 0;
const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Sprawdza katalog; zwraca listę błędów (puste = poprawny). */
export function checkCatalog(catalog) {
  const errors = [];
  if (!isObject(catalog)) return ['katalog musi być obiektem'];
  const categories = new Set();
  if (!Array.isArray(catalog.categories) || !catalog.categories.length) errors.push('categories: wymagana niepusta lista');
  for (const [i, c] of (Array.isArray(catalog.categories) ? catalog.categories : []).entries()) {
    if (!isText(c?.id)) errors.push(`categories[${i}]: brak id`);
    else if (categories.has(c.id)) errors.push(`categories: zduplikowana kategoria „${c.id}”`);
    else categories.add(c.id);
  }
  const kinds = isObject(catalog.weaponKinds) ? Object.keys(catalog.weaponKinds) : [];
  if (!kinds.length) errors.push('weaponKinds: wymagany obiekt {rodzaj: opis}');
  if (!Array.isArray(catalog.items)) return [...errors, 'items: wymagana lista'];
  const ids = new Set();
  for (const [i, it] of catalog.items.entries()) {
    const where = `items[${it?.id ?? i}]`;
    if (!isObject(it)) { errors.push(`${where}: nieprawidłowy element`); continue; }
    if (!isText(it.id)) errors.push(`${where}: brak id`);
    else if (ids.has(it.id)) errors.push(`${where}: zduplikowane id`);
    else ids.add(it.id);
    if (!isText(it.name)) errors.push(`${where}: brak nazwy`);
    if (!EQUIPMENT_SIDES.includes(it.side)) errors.push(`${where}: side „${it.side}” (dozwolone: ${EQUIPMENT_SIDES.join(', ')})`);
    if (!categories.has(it.category)) errors.push(`${where}: kategoria „${it.category}” spoza katalogu`);
    if (it.crew !== undefined && !(Number.isInteger(it.crew) && it.crew >= 0)) errors.push(`${where}: crew musi być całkowite ≥ 0`);
    if (it.weapons === undefined) continue;
    if (!Array.isArray(it.weapons)) { errors.push(`${where}: weapons musi być listą`); continue; }
    for (const [j, w] of it.weapons.entries()) {
      const ww = `${where} weapons[${w?.name ?? j}]`;
      if (!isText(w?.name)) errors.push(`${ww}: brak nazwy`);
      if (!(Number.isFinite(w?.range_m) && w.range_m > 0)) errors.push(`${ww}: range_m musi być liczbą > 0 (zasięg w metrach)`);
      if (!kinds.includes(w?.kind)) errors.push(`${ww}: kind „${w?.kind}” (dozwolone: ${kinds.join(', ')})`);
    }
  }
  return errors;
}

/** Indeks id → pozycja katalogu. */
export const indexCatalog = (catalog) => new Map((catalog?.items ?? []).filter((it) => it?.id).map((it) => [it.id, it]));

/**
 * Sprawdza `ref` jednego wpisu sprzętu (equipment[] / estimate_equipment[]). Zwraca tekst błędu albo null.
 * Wpis bez `ref` jest poprawny (zgodność wstecz).
 */
export function checkEquipmentRef(entry, index) {
  if (entry?.ref === undefined) return null;
  if (!isText(entry.ref)) return 'ref musi być niepustym tekstem (id z katalogu wyposażenia)';
  if (!index.has(entry.ref)) return `ref „${entry.ref}” nie istnieje w katalogu wyposażenia`;
  return null;
}

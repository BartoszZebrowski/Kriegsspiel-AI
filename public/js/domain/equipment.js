// Wyposażenie jednostek (T46): grupowanie wg kategorii katalogu, zasięgi, sumy z podwładnych (czyste funkcje).
// Katalog (data/equipment.json) dostaje wołający jako parametr — domain/ nie importuje spoza domain/.
// Walidacja katalogu: shared/equipment.js.

export const OTHER_CATEGORY = 'inne';

const memo = new WeakMap();

/** Indeks id → pozycja katalogu (pamiętany per obiekt katalogu). Brak katalogu → pusty indeks. */
export function indexCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object') return new Map();
  let idx = memo.get(catalog);
  if (!idx) {
    idx = new Map((catalog.items ?? []).filter((it) => it?.id).map((it) => [it.id, it]));
    memo.set(catalog, idx);
  }
  return idx;
}

/** Klucz sumowania wpisu: `ref`, a bez niego nazwa. */
export const equipmentKey = (entry) => entry?.ref ?? entry?.name ?? '';

/** Zasięg czytelnie: 800 → „800 m”, 4000 → „4 km”, 6500 → „6,5 km”. */
export function formatRange(m) {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = Math.round(m / 100) / 10;
  return `${String(km).replace('.', ',')} km`;
}

/** Broń pozycji katalogu: [{name, range_m, kind, label, range}] (label = opis rodzaju z katalogu). */
export function weaponsOf(item, catalog) {
  const kinds = catalog?.weaponKinds ?? {};
  return (item?.weapons ?? []).map((w) => ({ ...w, label: kinds[w.kind] ?? w.kind, range: formatRange(w.range_m) }));
}

/**
 * Wpisy sprzętu pogrupowane wg kategorii katalogu (kolejność z `catalog.categories`), wpisy bez `ref`
 * (albo spoza katalogu) w grupie „inne” na końcu. Wiersz: {key, name, current, authorized, count?, item, weapons}.
 * `count` zamiast current/authorized to szacunek wroga (estimate_equipment).
 * Zwraca [{category, portable, rows}] — tylko niepuste grupy.
 */
export function groupEquipment(list, catalog) {
  const index = indexCatalog(catalog);
  const order = (catalog?.categories ?? []).map((c) => c.id);
  const groups = new Map();
  for (const entry of list ?? []) {
    const item = entry?.ref ? index.get(entry.ref) ?? null : null;
    const category = item?.category ?? OTHER_CATEGORY;
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category).push({ ...entry, key: equipmentKey(entry), name: entry?.name || item?.name || '', item, weapons: weaponsOf(item, catalog) });
  }
  const portable = new Set((catalog?.categories ?? []).filter((c) => c.portable).map((c) => c.id));
  const known = order.filter((c) => groups.has(c));
  const rest = [...groups.keys()].filter((c) => !order.includes(c) && c !== OTHER_CATEGORY);
  return [...known, ...rest, ...(groups.has(OTHER_CATEGORY) ? [OTHER_CATEGORY] : [])].map((category) => ({
    category,
    portable: portable.has(category),
    rows: groups.get(category),
  }));
}

/**
 * Suma sprzętu bezpośrednich podwładnych jednostki: Map klucz → {current, authorized}. Stan jednostki obejmuje
 * jej podwładnych (docs/SCHEMA.md), więc sumujemy tylko jeden szczebel niżej, bez podwójnego liczenia.
 */
export function subordinateTotals(units, id) {
  const totals = new Map();
  for (const u of units ?? []) {
    if (u?.parent !== id) continue;
    for (const e of u.equipment ?? []) {
      const key = equipmentKey(e);
      if (!key) continue;
      const t = totals.get(key) ?? { current: 0, authorized: 0 };
      t.current += Number.isFinite(e.current) ? e.current : 0;
      t.authorized += Number.isFinite(e.authorized) ? e.authorized : 0;
      totals.set(key, t);
    }
  }
  return totals;
}

/**
 * Uzbrojenie przenośne/zespołowe jednostki jako tekst „3 × UKM-2000, 2 × Pirat” (kategorie `portable` katalogu,
 * liczby bieżące). Pusty tekst, gdy brak takich wpisów.
 */
export function portableSummary(list, catalog) {
  return groupEquipment(list, catalog)
    .filter((g) => g.portable)
    .flatMap((g) => g.rows)
    .filter((r) => Number.isFinite(r.current) && r.current > 0)
    .map((r) => `${r.current} × ${r.name}`)
    .join(', ');
}

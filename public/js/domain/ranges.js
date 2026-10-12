// Zasięgi ognia (T47): pierścienie zasięgu jednostki lub kontaktu wg rodzaju broni (ppanc, plot, ogólny, pośredni).
// Czysta logika; katalog (data/equipment.json) dostaje wołający jako parametr. Wersja 2 (sektory ognia, martwe
// pola z liniami widoczności z danych wysokościowych, T43) jest poza zakresem: promień to zasięg skuteczny „na płasko”.
import { indexCatalog } from './equipment.js';
import { indexById, isNeighbourUnit, isUnitVisible } from './orbat.js';

/** Rodzaje broni na mapie: kolejność przełączników i kolory (opis rodzaju bierzemy z `catalog.weaponKinds`). */
export const RANGE_KINDS = [
  { kind: 'ppanc', color: '#ef4444', short: 'ppanc' },
  { kind: 'plot', color: '#38bdf8', short: 'plot' },
  { kind: 'ogólny', color: '#facc15', short: 'ogólna' },
  { kind: 'pośredni', color: '#a78bfa', short: 'pośredni' },
];
const KIND_INDEX = new Map(RANGE_KINDS.map((k, i) => [k.kind, i]));
const FALLBACK_COLOR = '#9ca3af';

export const rangeColor = (kind) => RANGE_KINDS.find((k) => k.kind === kind)?.color ?? FALLBACK_COLOR;
export const rangeKindLabel = (kind, catalog) => catalog?.weaponKinds?.[kind] ?? RANGE_KINDS.find((k) => k.kind === kind)?.short ?? kind;
/** Klucz warstwy „wszystkie jednostki” dla rodzaju (store.layers). */
export const allLayerKey = (kind) => `range:${kind}`;

// ---------- dopasowanie wpisu sprzętu do katalogu ----------
// Wpis z `ref` — wprost. Bez `ref` (istniejące scenariusze) — po nazwie: słowa kluczowe pozycji katalogu (nazwa bez
// nawiasów, tokeny > 2 znaki, bez diakrytyków) muszą wystąpić w nazwie wpisu (zgodność przedrostkowa: „moździerze” ~
// „moździerz”). Wygrywa pozycja z największą liczbą słów kluczowych, potem najdłuższa.
const memoKeys = new WeakMap();
const fold = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');
const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2);
const tokenHit = (a, b) => a === b || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)));

function keysOf(catalog) {
  let keys = memoKeys.get(catalog);
  if (!keys) {
    keys = (catalog.items ?? [])
      .map((item) => ({ item, toks: tokens(String(item.name ?? '').replace(/\(.*?\)/g, ' ')) }))
      .filter((k) => k.toks.length)
      .sort((a, b) => b.toks.length - a.toks.length || b.toks.join('').length - a.toks.join('').length);
    memoKeys.set(catalog, keys);
  }
  return keys;
}

/** Pozycja katalogu dla wpisu sprzętu: po `ref`, a bez niego po nazwie. Brak dopasowania → null. */
export function matchItem(entry, catalog) {
  if (!entry || !catalog) return null;
  if (entry.ref) return indexCatalog(catalog).get(entry.ref) ?? null;
  const words = tokens(entry.name);
  if (!words.length) return null;
  const hit = keysOf(catalog).find((k) => k.toks.every((t) => words.some((w) => tokenHit(w, t))));
  return hit?.item ?? null;
}

// ---------- pierścienie ----------
function maxByKind(items) {
  const best = new Map();
  for (const { item, count } of items) {
    for (const w of item.weapons ?? []) {
      if (!(w.range_m > 0)) continue;
      const cur = best.get(w.kind);
      if (!cur || w.range_m > cur.range_m) best.set(w.kind, { kind: w.kind, range_m: w.range_m, weapon: w.name, equipment: item.name, count });
    }
  }
  return [...best.values()].sort((a, b) => (KIND_INDEX.get(a.kind) ?? 99) - (KIND_INDEX.get(b.kind) ?? 99));
}

/**
 * Pierścienie zasięgu jednostki własnej: maksymalny zasięg na rodzaj broni z JEJ WŁASNEGO sprzętu (current > 0).
 * Sprzęt podwładnych nie jest sumowany: stany szczebli nadrzędnych już obejmują podwładnych, a dowództwo bez
 * własnej broni (brygada, hq) nie ma pierścieni — inaczej 40 km ognia pośredniego narysowałoby się ze środka SD.
 * Zwraca [{kind, range_m, weapon, equipment, count}]; rodzaj bez broni → brak pierścienia.
 */
export function unitRanges(unit, catalog) {
  const items = [];
  for (const e of unit?.equipment ?? []) {
    if (!(e.current > 0)) continue;
    const item = matchItem(e, catalog);
    if (item) items.push({ item, count: e.current });
  }
  return maxByKind(items);
}

/**
 * Pierścienie kontaktu wroga wyłącznie z SZACUNKU gracza (`estimate_equipment`, count > 0) — nigdy z prawdy.
 * Wynik jak w `unitRanges` plus `estimate: true` i `uncertainty_m` (niepewność położenia: zewnętrzna obwódka).
 */
export function contactRanges(contact, catalog) {
  const items = [];
  for (const e of contact?.estimate_equipment ?? []) {
    if (!(e.count > 0)) continue;
    const item = matchItem(e, catalog);
    if (item) items.push({ item, count: e.count });
  }
  return maxByKind(items).map((r) => ({ ...r, estimate: true, uncertainty_m: contact.uncertainty_m > 0 ? contact.uncertainty_m : 0 }));
}

/** Pierścienie obiektu `{kind, item}` z `findEntity` (jednostka albo kontakt); inne rodzaje → []. */
export function entityRanges(entity, turn, catalog) {
  if (!entity || !catalog) return [];
  if (entity.kind === 'unit') return unitRanges(entity.item, catalog);
  if (entity.kind === 'contact') return contactRanges(entity.item, catalog);
  return [];
}

/**
 * Tryb „wszystkie jednostki” dla rodzaju: [{id, name, pos, range_m, weapon}] dla widocznych (wg szczegółowości)
 * jednostek własnych z pozycją i bronią tego rodzaju; sąsiedzi pominięci (nie znamy ich uzbrojenia). Bez dublowania
 * rodzic+podwładni: bierze się najniższy widoczny szczebel z daną bronią.
 */
export function coverageRings(units, catalog, kind, level) {
  const byId = indexById(units ?? []);
  const rows = [];
  for (const u of units ?? []) {
    if (!Array.isArray(u.pos) || isNeighbourUnit(u, byId) || !isUnitVisible(u, byId, level)) continue;
    const r = unitRanges(u, catalog).find((x) => x.kind === kind);
    if (r) rows.push({ id: u.id, name: u.name, pos: u.pos, range_m: r.range_m, weapon: r.weapon, parent: u.parent });
  }
  // Stany nadrzędnych obejmują podwładnych: gdy widoczny jest podwładny z tą bronią, rodzic nie dubluje pierścienia.
  const withKind = new Set(rows.map((r) => r.id));
  const covered = new Set();
  for (const r of rows) for (let p = r.parent, n = 0; p && n < 12; p = byId.get(p)?.parent, n++) if (withKind.has(p)) covered.add(p);
  return rows.filter((r) => !covered.has(r.id)).map(({ parent, ...r }) => r);
}

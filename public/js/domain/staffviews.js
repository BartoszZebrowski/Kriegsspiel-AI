// Widok według komórki sztabu (T28.1, WA6): gotowe ustawienia warstw mapy i paneli dla S2, S3, S4 i wsparcia ogniowego.
// Czyste funkcje: bierzą bieżące `layers` i `popover`, zwracają łatkę stanu oraz zapamiętane ustawienia gracza do przywrócenia.
// Preset dotyka tylko wymienionych warstw (podkłady i nakładki kafelkowe zostają), a klik w aktywny preset albo „Moje” cofa zmiany.
import { RANGE_KINDS, allLayerKey } from './ranges.js';

const ranges = (on) => Object.fromEntries(RANGE_KINDS.map((k) => [allLayerKey(k.kind), on]));

export const STAFF_VIEWS = [
  {
    id: 's2',
    code: 'Digit1', // skrót: Shift + 1
    label: 'S2',
    title: 'S2 — wywiad: kontakty, strefy REW, środki rozpoznania, pozycje CCIR',
    layers: { units: true, hierarchy: false, contacts: true, assets: true, lines: true, ccir: true, logistics: false, notes: false, fires: false, ...ranges(false) },
    popover: null,
  },
  {
    id: 's3',
    code: 'Digit2', // skrót: Shift + 2
    label: 'S3',
    title: 'S3 — operacje: własne siły, linie i granice, szkice i rozkazy',
    layers: { units: true, hierarchy: true, contacts: true, assets: false, lines: true, ccir: false, logistics: false, notes: true, fires: false, ...ranges(false) },
    popover: null,
  },
  {
    id: 's4',
    code: 'Digit3', // skrót: Shift + 3
    label: 'S4',
    title: 'S4 — logistyka: składy, trasy, konwoje i panel DOS',
    layers: { units: true, hierarchy: true, contacts: false, assets: false, lines: false, ccir: false, logistics: true, notes: false, fires: false, ...ranges(false) },
    popover: 'dos',
  },
  {
    id: 'fires',
    code: 'Digit4', // skrót: Shift + 4
    label: 'Ogień',
    title: 'Wsparcie ogniowe — zasięgi ognia i zgłoszenia ognia',
    layers: { units: true, hierarchy: false, contacts: true, assets: false, lines: false, ccir: false, logistics: false, notes: false, fires: true, ...ranges(true) },
    popover: null,
  },
];

export const emptyStaffView = () => ({ active: null, saved: null });
export const RESTORE_CODE = 'Digit0'; // Shift + 0 = „Moje”
export const staffViewByCode = (code) => STAFF_VIEWS.find((v) => v.code === code) ?? null;
export const staffViewById = (id) => STAFF_VIEWS.find((v) => v.id === id) ?? null;

/**
 * Włącza preset. `state` = { layers, popover, staffView }. Zwraca łatkę store: { layers, popover, staffView }.
 * Pierwsze włączenie zapamiętuje ustawienia gracza dla dotykanych warstw i panelu; przełączenie preset → preset
 * dopisuje tylko warstwy, których poprzedni preset nie ruszał (zapamiętane wartości gracza nie są nadpisywane).
 * Nieznany id → null (bez zmian).
 */
export function activateStaffView(state, id) {
  const view = staffViewById(id);
  if (!view) return null;
  const prev = state.staffView?.saved;
  const saved = { layers: { ...(prev?.layers ?? {}) }, popover: prev ? prev.popover : state.popover ?? null };
  for (const key of Object.keys(view.layers)) if (!(key in saved.layers)) saved.layers[key] = state.layers[key];
  return { layers: { ...state.layers, ...view.layers }, popover: view.popover, staffView: { active: view.id, saved } };
}

/** Przywraca ustawienia gracza sprzed pierwszego presetu. Brak aktywnego presetu → null (bez zmian). */
export function restoreStaffView(state) {
  const saved = state.staffView?.saved;
  if (!saved) return null;
  const layers = { ...state.layers };
  for (const [key, value] of Object.entries(saved.layers)) {
    if (value === undefined) delete layers[key];
    else layers[key] = value;
  }
  return { layers, popover: saved.popover ?? null, staffView: emptyStaffView() };
}

/** Przełącznik: ten sam preset co aktywny cofa zmiany, inny — włącza. */
export function toggleStaffView(state, id) {
  return state.staffView?.active === id ? restoreStaffView(state) : activateStaffView(state, id);
}

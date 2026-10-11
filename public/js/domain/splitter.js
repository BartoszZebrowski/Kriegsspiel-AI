// Splittery (zmiana rozmiaru paneli): ograniczanie wartości, zwijanie do szyny, krok klawiatury (czyste funkcje).

// Konfiguracja splitterów wg docs/UI-DESIGN.md §3.4. `max` może zależeć od wymiarów okna (funkcja).
export const SPLITTERS = {
  l: { axis: 'x', min: 220, max: 520, def: 312, inverted: false, collapse: true, label: 'Szerokość lewego panelu' },
  r: { axis: 'x', min: 300, max: 640, def: 392, inverted: true, collapse: true, label: 'Szerokość prawego panelu' },
  t: { axis: 'y', min: 64, max: 240, def: 98, inverted: true, collapse: false, label: 'Wysokość osi czasu' },
  i: { axis: 'y', min: 120, max: null, def: null, inverted: false, collapse: false, label: 'Wysokość struktury i inspektora' },
  c: { axis: 'y', min: 56, max: 320, def: 78, inverted: true, collapse: false, label: 'Wysokość pola wiadomości' },
};

export const COLLAPSE_MARGIN = 60; // przeciągnięcie o tyle poniżej minimum zwija dok do szyny
export const RAIL_WIDTH = 40;
export const MIN_MAP_WIDTH = 320;
export const KEY_STEP = 16;
export const KEY_STEP_BIG = 48;
export const INSPECTOR_MIN_RESERVE = 152; // wysokość docka − tyle = maksymalna wysokość struktury

// Przycina wartość do [min, max] i zaokrągla. max === null → bez górnej granicy.
export function clampSize(value, { min, max = null }) {
  const v = Math.round(Number.isFinite(value) ? value : min);
  const hi = max === null ? Infinity : Math.max(min, max);
  return Math.min(Math.max(v, min), hi);
}

// Górna granica szerokości docka tak, by mapa miała co najmniej `minMap` px
// (windowWidth − szerokość drugiego docka − minMap), nie więcej niż `max` ze specyfikacji.
export function maxDockWidth({ max, windowWidth, otherWidth, minMap = MIN_MAP_WIDTH }) {
  return Math.min(max, Math.max(0, windowWidth - otherWidth - minMap));
}

// Czy przeciągnięcie `raw` (surowa, nieprzycięta szerokość) ma zwinąć dok do szyny.
export function shouldCollapse(raw, min, margin = COLLAPSE_MARGIN) {
  return raw < min - margin;
}

// Wartość po przeciągnięciu: start + przesunięcie (odwrócone dla splitterów od prawej/dołu krawędzi).
export function dragValue(start, delta, inverted) {
  return start + (inverted ? -delta : delta);
}

// Krok klawiatury dla klawisza strzałki (znak: kierunek wzdłuż osi ekranu → zmiana wartości).
// Zwraca nową wartość albo null, gdy klawisz nie dotyczy tej osi.
export function keyboardValue(key, current, { axis, inverted }, shift = false) {
  const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  const i = keys.indexOf(key);
  if (i < 0) return null;
  const step = (shift ? KEY_STEP_BIG : KEY_STEP) * (i ? 1 : -1) * (inverted ? -1 : 1);
  return current + step;
}

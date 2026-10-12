// Zmęczenie jednostki (T28): kategoria z pliku gracza → etykieta, ton i sekcja karty. Czyste funkcje, bez DOM.
// Lista kategorii lustrzana do shared/fatigue.js (domain/ nie importuje z shared/).
import { escapeHtml } from './markdown.js';

const INFO = {
  wypoczęta: { tone: 'ok', note: 'Gotowa do działania.' },
  zmęczona: { tone: 'warn', note: 'Spada tempo i jakość wykonania rozkazów.' },
  wyczerpana: { tone: 'bad', note: 'Potrzebuje odpoczynku; ryzyko zatrzymania lub samowolnego odwrotu.' },
};

/** { level, tone, note } dla znanej kategorii albo null. */
export function fatigueInfo(level) {
  return Object.hasOwn(INFO, level) ? { level, ...INFO[level] } : null;
}

/** Sekcja karty jednostki: wskaźnik z kolorem. Pusty tekst, gdy jednostka nie ma `fatigue`. */
export function fatigueBlock(unit) {
  const info = fatigueInfo(unit?.fatigue);
  if (!info) return '';
  return `<div class="kv" data-fatigue="${info.level}"><div class="cap">Zmęczenie</div>
    <div class="fatigue fatigue--${info.tone}"><i></i><b>${escapeHtml(info.level)}</b></div><div class="muted">${escapeHtml(info.note)}</div></div>`;
}

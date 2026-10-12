// CCIR (krytyczne potrzeby informacyjne dowódcy) i meldunki cykliczne (T48): model, dopasowanie wiadomości,
// filtr „tylko CCIR” i grupowanie SITREP/LOGSTAT. Czyste funkcje, bez DOM.
// Stałe lustrzane do shared/ccir.js (domain/ nie importuje z shared/) — walidację robi serwer i walidator.
import { geometryFromPoints } from './order.js';

export const CCIR_KINDS = {
  PIR: { name: 'PIR', long: 'o przeciwniku', hint: 'np. czołgi przeciwnika na wschód od linii Wiżajny–Rutka-Tartak' },
  FFIR: { name: 'FFIR', long: 'o własnych siłach', hint: 'np. zapas paliwa batalionu poniżej 1 dnia zaopatrzenia' },
};
export const CCIR_MAX = 7;
export const CCIR_MIN = 3;
export const CCIR_TEXT_MAX = 200;

// Rodzaj wskazania na mapie → typ geometrii (geometryFromPoints z domain/order.js).
export const CCIR_SHAPES = { point: 'Punkt', line: 'Linia', area: 'Rejon' };
const SHAPE_OF_TYPE = { Point: 'point', LineString: 'line', Polygon: 'area' };

export const REPORT_LABELS = { sitrep: 'SITREP', logstat: 'LOGSTAT' };
export const REPORT_TITLES = { sitrep: 'Meldunek sytuacyjny', logstat: 'Meldunek logistyczny' };

export const shapeOf = (item) => SHAPE_OF_TYPE[item?.geometry?.type] ?? null;

/** Kolejny wolny numer id dla rodzaju (PIR-1, PIR-2…); numery użytych id nie wracają, dopóki są wolne mniejsze. */
export function nextCcirId(items, kind) {
  const used = new Set(items.filter((i) => i.kind === kind).map((i) => i.id));
  for (let n = 1; n < 100; n += 1) if (!used.has(`${kind}-${n}`)) return `${kind}-${n}`;
  return `${kind}-99`;
}

export const canAddCcir = (items) => items.length < CCIR_MAX;

/** Dodaje pozycję danego rodzaju (nowa lista) albo zwraca { error }. */
export function addCcirItem(items, kind, text = '') {
  if (!CCIR_KINDS[kind]) return { error: 'Nieznany rodzaj pozycji' };
  if (!canAddCcir(items)) return { error: `Maksymalnie ${CCIR_MAX} pozycji CCIR` };
  return { items: [...items, { id: nextCcirId(items, kind), kind, text }] };
}

export const removeCcirItem = (items, id) => items.filter((i) => i.id !== id);
export const updateCcirItem = (items, id, patch) => items.map((i) => (i.id === id ? { ...i, ...patch } : i));

/** Ustawia (geometry) albo usuwa (null) geometrię pozycji. */
export function setCcirGeometry(items, id, geometry) {
  return items.map((i) => {
    if (i.id !== id) return i;
    const { geometry: _old, ...rest } = i;
    return geometry ? { ...rest, geometry } : rest;
  });
}

/** Geometria z klikniętych punktów dla rodzaju wskazania (point/line/area): { geometry } | { error }. */
export const ccirGeometry = (shape, points) => geometryFromPoints(shape, points);

/** Pozycje gotowe do zapisu: bez pustych tekstów (zwraca { items, dropped }). */
export function cleanCcirItems(items) {
  const kept = items.filter((i) => String(i.text ?? '').trim());
  return { items: kept.map((i) => ({ ...i, text: i.text.trim() })), dropped: items.length - kept.length };
}

/** Uwagi do listy (do pokazania w edytorze): za mało pozycji itd. */
export function ccirAdvice(items) {
  if (!items.length) return 'Brak pozycji. Zdefiniuj 3–7 pytań, o których dowódca ma być alarmowany.';
  if (items.length < CCIR_MIN) return `Zalecane ${CCIR_MIN}–${CCIR_MAX} pozycji (jest ${items.length}).`;
  return '';
}

export const ccirById = (items) => new Map(items.map((i) => [i.id, i]));

/** Pozycja CCIR, do której odwołuje się wiadomość (`m.ccir`); null, gdy brak odwołania albo pozycji już nie ma. */
export const ccirOf = (m, items) => (m?.ccir ? (items.find((i) => i.id === m.ccir) ?? null) : null);

/** Filtr „tylko CCIR”: wiadomości z odwołaniem do pozycji CCIR (także do usuniętej). */
export const filterCcir = (messages, ccirOnly) => (ccirOnly ? messages.filter((m) => Boolean(m.ccir)) : messages);

export const countCcir = (messages) => messages.reduce((n, m) => n + (m.ccir ? 1 : 0), 0);

/** Wiadomości przychodzące z odwołaniem do pozycji, dla każdej pozycji: Map id → liczba. */
export function ccirHits(messages) {
  const out = new Map();
  for (const m of messages) if (m.direction === 'in' && m.ccir) out.set(m.ccir, (out.get(m.ccir) ?? 0) + 1);
  return out;
}

/** Znaczniki karty wiadomości dotyczące CCIR i meldunku cyklicznego: [{ cls, label, title? }]. */
export function ccirTags(m, items = []) {
  const tags = [];
  if (m.ccir) {
    const it = items.find((i) => i.id === m.ccir);
    tags.push({ cls: 'ccir', label: m.ccir, title: it ? `CCIR: ${it.text}` : 'CCIR (pozycja usunięta)' });
  }
  if (m.report && REPORT_LABELS[m.report]) tags.push({ cls: 'rpt', label: REPORT_LABELS[m.report], title: REPORT_TITLES[m.report] });
  return tags;
}

/**
 * Grupuje meldunki cykliczne do osi czasu: jeden element na (rodzaj meldunku, tura) —
 * { report, turn, count, time (najwcześniejszy), ids }. Wiadomości bez `report` są pomijane. Wynik wg czasu.
 */
export function groupReports(messages) {
  const groups = new Map();
  for (const m of messages) {
    if (!m.report || m.direction !== 'in') continue;
    const key = `${m.report}:${m.turn}`;
    const g = groups.get(key) ?? { report: m.report, turn: m.turn, count: 0, time: m.time, ids: [] };
    g.count += 1;
    g.ids.push(m.id);
    if (Date.parse(m.time) < Date.parse(g.time)) g.time = m.time;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

/** Rytm meldunków ze scenariusza: [{ report, minutes }] (tylko poprawne dodatnie wartości). */
export function reportCycleOf(scenario) {
  const rc = scenario?.reportCycle;
  if (!rc) return [];
  return Object.keys(REPORT_LABELS).filter((k) => Number.isInteger(rc[k]) && rc[k] > 0).map((k) => ({ report: k, minutes: rc[k] }));
}

/** Tekst rytmu do podpowiedzi, np. „SITREP co 4 h, LOGSTAT co 24 h”. */
export function reportCycleText(scenario) {
  const fmt = (m) => (m % 60 === 0 ? `${m / 60} h` : `${m} min`);
  return reportCycleOf(scenario).map((c) => `${REPORT_LABELS[c.report]} co ${fmt(c.minutes)}`).join(', ');
}

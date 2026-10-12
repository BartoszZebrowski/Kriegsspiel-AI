// Formularze meldunków i rozkazów (T50): definicje szablonów (SPOTREP, LOGSTAT, FRAGO, zapotrzebowanie na ogień),
// wymagalność pól, etykiety PL, walidacja treści i generowanie czytelnego tekstu. Czysta logika (bez DOM).
// Id rodzajów lustrzane do FORM_KINDS w shared/form.js (`domain/` nie importuje z `shared/`; test pilnuje zgodności).
import { mgrsOf } from './mgrs.js';

const CERTAINTY = ['niska', 'średnia', 'wysoka'];
const DIRECTIONS = ['stoi', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Typ pola: text | textarea | select | geo. Pole `geo` ma `shapes` (dozwolone rodzaje wskazania na mapie: point | line | area).
// `type` — domyślny rodzaj wiadomości (domain/compose.js MESSAGE_TYPES), `short` — nazwa w menu.
export const FORMS = {
  spotrep: {
    name: 'SPOTREP — meldunek o spotkaniu',
    short: 'SPOTREP',
    type: 'meldunek',
    fields: [
      { id: 'what', label: 'Co', type: 'text', required: true, hint: 'np. kolumna pojazdów gąsienicowych' },
      { id: 'count', label: 'Ile', type: 'text', required: true, hint: 'np. ~10 pojazdów' },
      { id: 'where', label: 'Gdzie', type: 'geo', shapes: ['point', 'area'], required: true },
      { id: 'when', label: 'Kiedy', type: 'text', required: true, hint: 'np. 07:22' },
      { id: 'direction', label: 'Kierunek', type: 'select', options: DIRECTIONS },
      { id: 'certainty', label: 'Pewność', type: 'select', options: CERTAINTY, required: true },
      { id: 'notes', label: 'Uwagi', type: 'textarea' },
    ],
  },
  logstat: {
    name: 'LOGSTAT — stan logistyczny',
    short: 'LOGSTAT',
    type: 'meldunek',
    fields: [
      { id: 'fuel', label: 'Paliwo', type: 'text', required: true, hint: 'np. 1,5 DOS' },
      { id: 'ammo', label: 'Amunicja', type: 'text', required: true, hint: 'np. 2 DOS, brak ppanc' },
      { id: 'personnel', label: 'Ludzie', type: 'text', required: true, hint: 'np. 92% stanu, 6 rannych' },
      { id: 'equipment', label: 'Sprzęt', type: 'text', hint: 'np. 11/14 KTO sprawnych' },
      { id: 'needs', label: 'Potrzeby', type: 'textarea', required: true, hint: 'co i na kiedy' },
    ],
  },
  frago: {
    name: 'FRAGO — rozkaz fragmentaryczny',
    short: 'FRAGO',
    type: 'rozkaz',
    fields: [
      { id: 'task', label: 'Zadanie', type: 'textarea', required: true },
      { id: 'area', label: 'Rejon', type: 'geo', shapes: ['area', 'point', 'line'], required: true },
      { id: 'time', label: 'Czas', type: 'text', required: true, hint: 'np. do 09:30' },
      { id: 'coordination', label: 'Współdziałanie', type: 'textarea' },
    ],
  },
  fire: {
    name: 'Zapotrzebowanie na ogień',
    short: 'Zapotrzebowanie na ogień',
    type: 'rozkaz',
    fields: [
      { id: 'target', label: 'Cel', type: 'geo', shapes: ['point', 'area'], required: true },
      { id: 'targetKind', label: 'Rodzaj celu', type: 'text', required: true, hint: 'np. czołgi w ugrupowaniu' },
      { id: 'effect', label: 'Efekt', type: 'select', options: ['obezwładnienie', 'zniszczenie', 'dymy', 'oświetlenie'], required: true },
      { id: 'time', label: 'Czas', type: 'text', required: true, hint: 'np. natychmiast, 08:15' },
      { id: 'priority', label: 'Priorytet', type: 'select', options: ['zwykły', 'pilny', 'natychmiastowy'], required: true },
      { id: 'support', label: 'Środek wsparcia', type: 'text', hint: 'np. dart, kanał artylerii' },
    ],
  },
};

export const FORM_IDS = Object.keys(FORMS);
export const formDef = (kind) => FORMS[kind] ?? null;
export const FORM_MENU = FORM_IDS.map((id) => [id, FORMS[id].name]);

const SHAPE_NAME = { point: 'Punkt', line: 'Linia', area: 'Rejon' };
export const shapeName = (shape) => SHAPE_NAME[shape] ?? shape;

const isGeometry = (v) => Boolean(v) && typeof v === 'object' && typeof v.type === 'string';
const isBlank = (v) => v === undefined || v === null || (typeof v === 'string' && !v.trim()) || (typeof v === 'number' && Number.isNaN(v));

// ---------- stan formularza ----------
export const emptyForm = (kind) => (FORMS[kind] ? { kind, fields: {} } : null);

// Nowy formularz z ustawionym (lub usuniętym, gdy puste) polem; nie zmienia argumentu.
export function setFormField(form, id, value) {
  if (!form || !formDef(form.kind)?.fields.some((f) => f.id === id)) return form;
  const { [id]: _old, ...rest } = form.fields ?? {};
  return { ...form, fields: isBlank(value) ? rest : { ...rest, [id]: typeof value === 'string' ? value : value } };
}

// Etykiety brakujących pól wymaganych.
export function missingFields(form) {
  const def = formDef(form?.kind);
  if (!def) return [];
  return def.fields.filter((f) => f.required && isBlank(form.fields?.[f.id])).map((f) => f.label);
}

// Błąd treści (nieznane pole, wartość spoza opcji, geometria niedozwolonego rodzaju) albo null. Braki wymaganych → `missingFields`.
export function checkFormContent(form) {
  const def = formDef(form?.kind);
  if (!def) return `Nieznany formularz (dozwolone: ${FORM_IDS.join(', ')})`;
  for (const [id, v] of Object.entries(form.fields ?? {})) {
    const f = def.fields.find((x) => x.id === id);
    if (!f) return `Formularz ${form.kind}: nieznane pole „${id}”`;
    if (f.type === 'geo' ? !isGeometry(v) : isGeometry(v)) return `Formularz ${form.kind}: pole „${id}” ma wartość nieodpowiedniego rodzaju`;
    if (f.type === 'select' && !f.options.includes(v)) return `Formularz ${form.kind}: pole „${id}” — dozwolone: ${f.options.join(', ')}`;
    if (f.type === 'geo' && !f.shapes.map(shapeOfGeometryType).includes(shapeOfGeometryType(v.type))) return `Formularz ${form.kind}: pole „${id}” nie przyjmuje geometrii ${v.type}`;
  }
  return null;
}
const shapeOfGeometryType = (t) => ({ Point: 'point', LineString: 'line', Polygon: 'area' })[t] ?? t;

// ---------- tekst i tabelka ----------
const pt = (c) => mgrsOf(c, 4) ?? `${c[0].toFixed(4)}, ${c[1].toFixed(4)}`;

// Geometria jako krótki tekst: punkt → MGRS, linia → „linia (n pkt): od … do …”, rejon → „rejon (n pkt), środek …”.
export function geometryText(g) {
  if (!isGeometry(g)) return '';
  if (g.type === 'Point') return pt(g.coordinates);
  if (g.type === 'LineString') {
    const c = g.coordinates;
    return `linia (${c.length} pkt): od ${pt(c[0])} do ${pt(c.at(-1))}`;
  }
  const ring = g.coordinates[0].slice(0, -1);
  const mid = [ring.reduce((a, p) => a + p[0], 0) / ring.length, ring.reduce((a, p) => a + p[1], 0) / ring.length];
  return `rejon (${ring.length} pkt), środek ${pt(mid)}`;
}

export const valueText = (field, value) => (isBlank(value) ? '' : field.type === 'geo' ? geometryText(value) : String(value));

// Wiersze tabelki: [{ label, value }] — tylko wypełnione pola, w kolejności szablonu.
export function formRows(form) {
  const def = formDef(form?.kind);
  if (!def) return [];
  return def.fields.map((f) => ({ label: f.label, value: valueText(f, form.fields?.[f.id]) })).filter((r) => r.value);
}

// Czytelny tekst wiadomości: „SPOTREP\nCo: …\nGdzie: …”.
export function formText(form) {
  const def = formDef(form?.kind);
  if (!def) return '';
  return [def.short.toUpperCase(), ...formRows(form).map((r) => `${r.label}: ${r.value}`)].join('\n');
}

// Dopiska do formularza: część tekstu wiadomości wykraczająca poza `formText`; sam tekst, gdy nie zaczyna się od niego.
export function textBeyondForm(m) {
  if (!m?.form) return m?.text ?? '';
  const base = formText(m.form);
  const text = m.text ?? '';
  return text === base ? '' : text.startsWith(base) ? text.slice(base.length).trim() : text;
}

// Tekst wiadomości do wysłania: tekst formularza + dopiska gracza.
export const composeFormMessage = (form, extra = '') => [formText(form), String(extra).trim()].filter(Boolean).join('\n\n');

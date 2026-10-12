// Omnibox (Ctrl K): indeks wyszukiwania i ranking wyników (czyste funkcje, bez DOM).
import { mgrsOf } from './mgrs.js';
import { ageMinutes, formatAgeShort } from './format.js';
import { describeSidc } from './sidc.js';
import { indexById, formationRootId, parentIdOf } from './orbat.js';

export const FILTERS = [
  ['all', 'Wszystko'],
  ['unit', 'Jednostki'],
  ['contact', 'Kontakty'],
  ['place', 'Miejsca'],
  ['command', 'Polecenia'],
];

// Polecenia omniboxu: id → opis. Wykonuje je widok (przez intencje kontrolera).
export const COMMANDS = [
  { id: 'turn-current', title: 'Przejdź do tury bieżącej', key: '.' },
  { id: 'replay', title: 'Odtwórz turę (animacja przemieszczeń)', key: '' },
  { id: 'briefing', title: 'Otwórz odprawę', key: 'B' },
  { id: 'ccir', title: 'Edytuj CCIR (krytyczne potrzeby informacyjne)', key: '' },
  { id: 'legend', title: 'Pokaż legendę', key: '?' },
  { id: 'layers', title: 'Warstwy i podkład', key: 'W' },
  { id: 'dos', title: 'Panel DOS (zaopatrzenie jednostek)', key: 'D' },
  { id: 'measure', title: 'Rozpocznij pomiar odległości', key: 'M' },
  { id: 'fit', title: 'Pokaż wszystkie siły własne', key: 'F' },
  { id: 'view3d', title: 'Widok 3D terenu (bieżący rejon mapy)', key: '' },
  { id: 'base-dark', title: 'Podkład: ciemny', key: '' },
  { id: 'base-sat', title: 'Podkład: satelitarny', key: '' },
  { id: 'base-topo', title: 'Podkład: topograficzny', key: '' },
  { id: 'dock-l', title: 'Pokaż / ukryj lewy panel', key: 'Alt 1' },
  { id: 'dock-r', title: 'Pokaż / ukryj prawy panel', key: 'Alt 2' },
];

const fold = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l');
const compact = (s) => fold(s).replace(/[^a-z0-9]/g, '');

// Wynik dopasowania zapytania do tekstu: 0 = brak; wyżej = lepiej.
// Dokładna zgodność > początek > początek słowa > fragment; kolejne dopasowania na „zwiniętym” tekście
// (bez spacji i znaków specjalnych) mają niższą wagę.
export function matchScore(query, text) {
  const q = fold(query).trim();
  if (!q) return 1;
  const t = fold(text);
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 60;
  if (t.includes(q)) return 45;
  const cq = compact(query);
  const ct = compact(text);
  if (cq && ct === cq) return 90;
  if (cq && ct.startsWith(cq)) return 55;
  if (cq && ct.includes(cq)) return 30;
  return 0;
}

const bestScore = (query, texts) => Math.max(0, ...texts.filter(Boolean).map((t) => matchScore(query, t)));

// Podświetlenie dopasowania: zwraca [przed, trafienie, po] albo null (trafienie szukane bez wielkości liter).
export function splitMatch(text, query) {
  const q = query.trim();
  if (!q) return null;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return null;
  return [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)];
}

const GROUP_LIMIT_ALL = { unit: 4, neighbour: 3, contact: 2, asset: 2, place: 3, sketch: 2, command: 3 };
const GROUP_LIMIT_ONE = 14;
export const GROUP_TITLES = { unit: 'Jednostki', neighbour: 'Sąsiedzi', contact: 'Kontakty przeciwnika', asset: 'Środki rozpoznania', place: 'Miejsca', sketch: 'Szkice', command: 'Polecenia' };
const GROUP_ORDER = ['unit', 'neighbour', 'contact', 'asset', 'place', 'sketch', 'command'];
const FILTER_GROUPS = { all: GROUP_ORDER, unit: ['unit', 'neighbour', 'asset'], contact: ['contact'], place: ['place'], command: ['command'] };

// Buduje listę wyników. data: { units, contacts, assets, places, notes, turnTime, channels }.
// Grupa „Sąsiedzi”: formacje sąsiadów (units[].formation), ich dowództwa i jednostki z kanału kind = neighbor.
// Zwraca [{ group, kind, id, title, sub, right, score, ref }] w kolejności grup, w grupie wg wyniku.
export function searchOmnibox(query, filter, data) {
  const { units = [], contacts = [], assets = [], places = [], notes = [], turnTime = null, channels = [] } = data;
  const byId = indexById(units);
  const heads = new Set(units.map((u) => formationRootId(u, byId)).filter(Boolean));
  for (const c of channels) if (c.kind === 'neighbor') heads.add(c.unit ?? c.id);
  const q = query.trim();
  const groups = FILTER_GROUPS[filter] || GROUP_ORDER;
  const out = [];
  const add = (group, item) => {
    if (item.score > 0) out.push({ group, ...item });
  };

  if (groups.includes('unit') || groups.includes('neighbour')) {
    for (const u of units) {
      const neighbour = heads.has(u.id) || formationRootId(u, byId) !== null;
      const group = neighbour ? 'neighbour' : 'unit';
      if (!groups.includes(group)) continue;
      const pid = parentIdOf(u);
      const parent = pid ? byId.get(pid) : null;
      add(group, {
        kind: 'unit',
        id: u.id,
        title: u.name || u.id,
        sub: [describeSidc(u.sidc), neighbour ? (parent ? `sąsiad: ${parent.name || parent.id}` : 'sąsiad') : parent ? `podległa: ${parent.name || parent.id}` : null].filter(Boolean).join(' · '),
        right: mgrsOf(u.pos, 4) || '',
        score: bestScore(q, [u.name, u.id]) || Math.min(20, bestScore(q, [u.task, describeSidc(u.sidc)])),
        ref: u,
      });
    }
  }
  if (groups.includes('contact')) {
    for (const c of contacts) {
      const age = turnTime && c.observed ? formatAgeShort(ageMinutes(c.observed, turnTime)) : '';
      add('contact', {
        kind: 'contact',
        id: c.id,
        title: c.id,
        sub: [c.estimate || describeSidc(c.sidc), age && `${age} temu`, c.source].filter(Boolean).join(' · '),
        right: c.confidence ? `pewność ${c.confidence}` : '',
        score: bestScore(q, [c.id, c.estimate, c.source]),
        ref: c,
      });
    }
  }
  if (groups.includes('asset')) {
    for (const a of assets) {
      add('asset', {
        kind: 'asset',
        id: a.id,
        title: a.name || a.id,
        sub: [a.type, a.status].filter(Boolean).join(' · '),
        right: Array.isArray(a.pos) ? mgrsOf(a.pos, 4) || '' : 'brak pozycji',
        score: bestScore(q, [a.name, a.id, a.type]),
        ref: a,
      });
    }
  }
  if (groups.includes('place')) {
    for (const p of places) {
      add('place', {
        kind: 'place',
        id: p.id,
        title: p.name,
        sub: [p.kind, p.note].filter(Boolean).join(' · '),
        right: '',
        score: bestScore(q, [p.name, ...(p.forms || [])]) || 0,
        ref: p,
      });
    }
  }
  if (groups.includes('sketch')) {
    for (const n of notes) {
      add('sketch', { kind: 'sketch', id: n.id, title: n.name, sub: `Szkic${n.description ? ' · ' + n.description : ''}`, right: '', score: bestScore(q, [n.name, n.description]), ref: n });
    }
  }
  if (groups.includes('command')) {
    for (const c of COMMANDS) {
      add('command', { kind: 'command', id: c.id, title: c.title, sub: '', right: c.key, score: matchScore(q, c.title), ref: c });
    }
  }

  const limit = filter === 'all' ? (g) => GROUP_LIMIT_ALL[g] : () => GROUP_LIMIT_ONE;
  const result = [];
  for (const g of groups) {
    const items = out
      .filter((x) => x.group === g)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'pl'));
    // Bez zapytania na liście „Wszystko” pokazujemy tylko polecenia i pierwsze jednostki.
    result.push(...items.slice(0, limit(g)));
  }
  return result;
}

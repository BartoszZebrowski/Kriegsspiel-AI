// Czyste pomocniki narzędzia tury: scalanie list wg planu, łatki, trasy ruchu, logistyka, skrzynka wiadomości.
// Używa ich buildTurn (turn.mjs); eksporty publiczne turn.mjs są stąd re-eksportowane.
import { PLAYER_MESSAGE_FIELDS, LOGISTICS_LISTS, checkLogistics, extraFields, isCoord, isValidTime, checkMessageMeta, checkMessageText } from '../../shared/schema.js';

/** Minimalne przesunięcie (stopnie), od którego jednostka uchodzi za przemieszczoną (~0,01 m). */
export const MOVE_EPSILON = 1e-7;

export const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
export const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
export const pad3 = (n) => String(n).padStart(3, '0');

/** Kopia obiektu z samymi polami z listy `allowed` (bez undefined). */
export function pickFields(obj, allowed) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (allowed.includes(k) && obj[k] !== undefined) out[k] = clone(obj[k]); // zachowuje kolejność pól źródła
  return out;
}

/**
 * Płytkie scalenie łatki z obiektem: `null` usuwa pole, reszta zastępuje. Pola specjalne (route) pomija —
 * obsługuje je wywołujący. Zwraca nowy obiekt.
 */
export function applyPatch(obj, patch, skip = []) {
  const out = { ...obj };
  for (const [k, v] of Object.entries(patch || {})) {
    if (skip.includes(k)) continue;
    if (v === null) delete out[k];
    else out[k] = clone(v);
  }
  return out;
}

/** Czy pozycje różnią się o więcej niż MOVE_EPSILON. */
export function moved(a, b) {
  return isCoord(a) && isCoord(b) && (Math.abs(a[0] - b[0]) > MOVE_EPSILON || Math.abs(a[1] - b[1]) > MOVE_EPSILON);
}

/**
 * Trasa przejechana w turze: [from, …pośrednie, to]. Zwraca undefined, gdy jednostka się nie przesunęła.
 * `via` = własne punkty pośrednie (bez początku i końca); `explicit` = pełna trasa z planu (jej początek i koniec
 * zostają dopasowane do from/to).
 */
export function computeTrack(from, to, via = [], explicit = null) {
  if (!moved(from, to)) return undefined;
  const mid = (explicit && explicit.length ? explicit.slice(1, -1) : via).filter(isCoord);
  return [[...from], ...mid.map((p) => [...p]), [...to]];
}

/** Zapis czasu ISO z podanym przesunięciem strefy (np. `+02:00`) dla chwili `ms`. */
export function formatWithOffset(ms, offset) {
  const m = /([+-])(\d\d):?(\d\d)$/.exec(offset || '');
  if (!m) return new Date(ms).toISOString();
  const off = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const d = new Date(ms + off * 60000).toISOString().slice(0, 19);
  return `${d}${m[1]}${m[2]}:${m[3]}`;
}

/** Czas następnej tury = czas poprzedniej + turnMinutes (to samo przesunięcie strefy). */
export function nextTime(prevTime, turnMinutes) {
  const offset = /([+-]\d\d:?\d\d|Z)$/.exec(prevTime)?.[1];
  return formatWithOffset(Date.parse(prevTime) + turnMinutes * 60000, offset === 'Z' ? '+00:00' : offset);
}

// Lista elementów z id → scalenie według planu: patches {id: łatka|null}, additions [obiekty].
export function mergeById(list, patches = {}, additions = [], { skip = [], onApply } = {}) {
  const out = [];
  for (const item of list) {
    if (!Object.hasOwn(patches, item.id)) { out.push(item); continue; }
    const p = patches[item.id];
    if (p === null) continue; // usunięta
    const next = applyPatch(item, p, skip);
    onApply?.(next, item, p);
    out.push(next);
  }
  for (const a of additions) out.push(clone(a));
  return out;
}

export function checkIds(kind, list, warnings) {
  const seen = new Set();
  for (const it of list) {
    if (typeof it.id !== 'string' || !it.id) warnings.push(`${kind}: element bez id`);
    else if (seen.has(it.id)) warnings.push(`${kind}: zduplikowane id ${it.id}`);
    else seen.add(it.id);
  }
}

export function patchMissing(kind, patches, list, warnings) {
  const ids = new Set(list.map((x) => x.id));
  for (const id of Object.keys(patches || {})) if (!ids.has(id)) warnings.push(`plan: ${kind} "${id}" nie istnieje (łatka pominięta)`);
}

/**
 * Warstwa logistyczna po zmianach planu. `prev` = logistics z tury N (albo undefined), `ch` = plan:
 *   { depots|routes|bridges|convoys: { patch: { id: łatka | null }, add: [obiekty] } }
 * Łatka scala pola (null usuwa pole), `null` zamiast łatki usuwa element; konwój może mieć `route` (punkty pośrednie)
 * albo pełny `track`. Track konwoju liczony jak dla jednostek (od pozycji z tury N). Zwraca { logistics|undefined, warnings }.
 * `fallbackRoutes` = trasy z innego widoku (np. sędziego), użyte, gdy łatka nie podaje własnej.
 */
export function applyLogistics(prev, ch, { fallbackRoutes = {}, fields = null } = {}) {
  const warnings = [];
  if (prev === undefined && !ch) return { logistics: undefined, warnings, routes: {} };
  const out = {};
  const routes = {};
  for (const list of LOGISTICS_LISTS) {
    const before = clone(prev?.[list] || []).map((x) => { const { track, ...rest } = x; return list === 'convoys' ? rest : x; });
    const prevPos = new Map((prev?.[list] || []).map((x) => [x.id, x.pos]));
    const spec = ch?.[list] || {};
    patchMissing(`logistics.${list}`, spec.patch, before, warnings);
    let items = mergeById(before, spec.patch, spec.add, { skip: ['route', 'track'], onApply: (next, _o, p) => { if (p.route) routes[next.id] = p.route; } });
    if (list === 'convoys') {
      items = items.map((c) => {
        const { track: _t, ...rest } = c;
        const explicit = spec.patch?.[c.id]?.track ?? spec.add?.find((a) => a.id === c.id)?.track ?? null;
        const track = computeTrack(prevPos.get(c.id), c.pos, routes[c.id] ?? fallbackRoutes[c.id] ?? [], explicit);
        return track ? { ...rest, track } : rest;
      });
    }
    checkIds(`logistics.${list}`, items, warnings);
    if (fields) items = items.map((x) => pickFields(x, fields[list]));
    if (items.length || prev?.[list] || spec.add) out[list] = items;
  }
  if (!Object.keys(out).length) return { logistics: undefined, warnings, routes };
  const chk = checkLogistics(out);
  for (const e of chk.errors) warnings.push(e);
  return { logistics: out, warnings, routes };
}

/** Wiadomości sędziego → sama biała lista pól, posortowane po czasie (stabilnie). Zwraca { messages, warnings }. */
export function buildInbox(messages = [], { after, upTo } = {}) {
  const warnings = [];
  const out = messages.map((m, i) => ({ m: pickFields(m, PLAYER_MESSAGE_FIELDS), i, src: m }));
  for (const { m, src } of out) {
    const extra = extraFields(src, PLAYER_MESSAGE_FIELDS);
    if (extra.length) warnings.push(`wiadomość ${m.id}: pominięto pola ${extra.join(', ')}`);
    if (!m.id) warnings.push('wiadomość bez id');
    if (!m.channel) warnings.push(`wiadomość ${m.id}: brak channel`);
    if (!isValidTime(m.time)) warnings.push(`wiadomość ${m.id}: nieprawidłowy time`);
    else {
      if (after && Date.parse(m.time) < Date.parse(after)) warnings.push(`wiadomość ${m.id}: time przed turą poprzednią`);
      if (upTo && Date.parse(m.time) > Date.parse(upTo)) warnings.push(`wiadomość ${m.id}: time po czasie tury`);
    }
    const bad = checkMessageText(m.text) || checkMessageMeta(m);
    if (bad) warnings.push(`wiadomość ${m.id}: ${bad}`);
  }
  out.sort((a, b) => (Date.parse(a.m.time) || 0) - (Date.parse(b.m.time) || 0) || a.i - b.i);
  return { messages: out.map((x) => x.m), warnings };
}

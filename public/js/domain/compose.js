// Logika komponowania wiadomości (czysta, bez DOM): szkice per kanał, domyślny rodzaj,
// ostrzeżenie o innej jednostce w treści, nazwy spoza gazetera, lista kanałów z wyszukiwaniem.
import { buildCandidates, findMentions } from './linkify.js';
import { groupChannels } from './messages.js';

export const MESSAGE_TYPES = ['rozkaz', 'zarzadzenie', 'meldunek', 'wiadomosc'];

// Domyślny rodzaj wiadomości dla kanału: do podwładnych — rozkaz; do przełożonego — meldunek; reszta — wiadomość.
export function defaultTypeForChannel(channel) {
  if (!channel) return 'rozkaz';
  if (channel.kind === 'subordinate') return 'rozkaz';
  if (channel.kind === 'superior') return 'meldunek';
  return 'wiadomosc';
}

// ---------- szkice per kanał ----------
// Szkic: { text, type (null = domyślny dla kanału), urgent, attachIds }. Mapa szkiców: { [channelId]: szkic }.
export const emptyDraft = () => ({ text: '', type: null, urgent: false, attachIds: [] });

export const getDraft = (drafts, channelId) => (channelId && drafts?.[channelId]) || emptyDraft();

// Rodzaj do pokazania: wybrany jawnie albo domyślny dla kanału.
export const draftType = (draft, channel) => draft?.type || defaultTypeForChannel(channel);

// Zwraca NOWĄ mapę szkiców ze scalonym `patch` w szkicu kanału (bez zmiany pozostałych kanałów).
export function updateDraft(drafts, channelId, patch) {
  if (!channelId) return drafts || {};
  const next = { ...getDraft(drafts, channelId), ...patch };
  return { ...drafts, [channelId]: next };
}

// Zwraca NOWĄ mapę bez szkicu kanału (po wysłaniu).
export function clearDraft(drafts, channelId) {
  if (!drafts || !(channelId in drafts)) return drafts || {};
  const { [channelId]: _gone, ...rest } = drafts;
  return rest;
}

// Czy szkic zawiera cokolwiek wartego zapamiętania.
// `orders` (opcjonalne): załączniki rozkazu graficznego (domain/order.js), kopiowane do wiadomości przy wysłaniu.
export const isDraftEmpty = (draft) => !draft || (!draft.text?.trim() && !draft.attachIds?.length && !draft.orders?.length && !draft.form && !draft.urgent && !draft.type);

// ---------- wzmianki w treści ----------
// Własne jednostki wymienione w treści, które nie są adresatem (ani jego podwładnymi — o nich dowódca wie).
// Zwraca [{ id, name }] bez powtórzeń, w kolejności występowania.
export function foreignUnitMentions(text, channelUnitId, units = []) {
  if (!text || !units.length) return [];
  const known = new Set(units.map((u) => u.id));
  const subtree = new Set(channelUnitId ? [channelUnitId] : []);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      if (!subtree.has(u.id) && u.parent && subtree.has(u.parent)) {
        subtree.add(u.id);
        grew = true;
      }
    }
  }
  const out = [];
  const seen = new Set();
  for (const { cand } of findMentions(text, buildCandidates({ units }))) {
    if (cand.kind !== 'unit' || !known.has(cand.id) || subtree.has(cand.id) || seen.has(cand.id)) continue;
    seen.add(cand.id);
    out.push({ id: cand.id, name: units.find((u) => u.id === cand.id)?.name || cand.id });
  }
  return out;
}

const PLACE_PREP = String.raw`(?:do|w|we|na|przez|koło|pod|nad|ku|za|przed|rejon|rejonie|rejonu|miejscowość|miejscowości|m\.|k\.)`;
// Nazwy własne po przyimku, które nie są niczym znanym (gazeter, jednostki, kontakty, środki): kandydaci na
// „wskaż na mapie”. Heurystyka celowo prosta. Zwraca [{ text, start, end }] bez powtórzeń.
export function unknownPlaceNames(text, context = {}) {
  if (!text) return [];
  const spans = findMentions(text, buildCandidates(context));
  const re = new RegExp(String.raw`(?<![\p{L}\p{N}])${PLACE_PREP}\s+(\p{Lu}[\p{L}-]{2,}(?:\s+\p{Lu}[\p{L}-]{2,})?)`, 'gu');
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(re)) {
    const name = m[1];
    const start = m.index + m[0].length - name.length;
    const end = start + name.length;
    if (spans.some((s) => start < s.end && s.start < end)) continue;
    if (/^[\p{Lu}]{2,}$/u.test(name)) continue; // skrót wielkimi literami (np. MSR, DOS) — nie miejscowość
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ text: name, start, end });
  }
  return out;
}

// ---------- lista kanałów z wyszukiwaniem ----------
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

// Model listy kanałów: grupy (przełożony, sztab, sąsiedzi, podwładni). Bez zapytania automatyczne kanały
// (kompanie, plutony) są ukryte — pojawiają się po wyszukaniu; kanał aktywny jest zawsze widoczny.
export function channelListModel(channels = [], { query = '', activeId = null } = {}) {
  const q = norm(query).trim();
  const visible = channels.filter((c) => {
    if (c.id === activeId) return true;
    if (!q) return !c.auto;
    return [c.name, c.short, c.id, c.unit, c.description].some((f) => norm(f).includes(q));
  });
  return groupChannels(visible);
}

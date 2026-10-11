// Linkifier komunikatora: zamienia nazwy miejsc i jednostek w tekście na klikalne przyciski.
// Moduł czysty (bez DOM): tekst + gazeter + encje bieżącej tury -> bezpieczny HTML.
import { escapeHtml } from './markdown.js';

const WORD = '[\\p{L}\\p{N}]';
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Warianty zapisu nazwy: „ZT Biebrza" bywa pisane jako ZT „Biebrza".
function nameVariants(name) {
  const out = new Set([name]);
  const m = /^([A-ZŁŚŻŹĆŃÓ]{2,}) ([^\s„”"]+)$/u.exec(name);
  if (m) {
    out.add(`${m[1]} „${m[2]}”`);
    out.add(`${m[1]} "${m[2]}"`);
  }
  return [...out];
}

// Kandydaci do dopasowania: { text, kind, id, caseSensitive, title }.
export function buildCandidates({ places = [], units = [], contacts = [], assets = [] } = {}) {
  const list = [];
  for (const p of places) {
    for (const f of new Set([p.name, ...(p.forms || [])])) {
      if (typeof f === 'string' && f.trim()) list.push({ text: f, kind: 'place', id: p.id, caseSensitive: false, title: p.kind || '' });
    }
  }
  for (const u of units) {
    const title = [u.name, u.task || u.status].filter(Boolean).join(' — ');
    const names = new Set();
    if (u.name) for (const v of nameVariants(u.name)) names.add(v);
    if (u.id && u.id.length >= 3) names.add(u.id);
    for (const t of names) list.push({ text: t, kind: 'unit', id: u.id, caseSensitive: true, title });
  }
  for (const a of assets) {
    if (!Array.isArray(a.pos)) continue; // środek bez pozycji nie ma gdzie lecieć
    const title = [a.name, a.task].filter(Boolean).join(' — ');
    for (const t of new Set([a.name, a.id])) if (t && t.length >= 3) list.push({ text: t, kind: 'asset', id: a.id, caseSensitive: true, title });
  }
  for (const c of contacts) {
    if (!c.id) continue;
    const title = [c.estimate || 'kontakt', c.confidence ? `pewność ${c.confidence}` : ''].filter(Boolean).join(' — ');
    list.push({ text: c.id, kind: 'contact', id: c.id, caseSensitive: true, title });
  }
  return list;
}

const CLASS_OF = { place: 'place', unit: 'own', asset: 'own', contact: 'enemy' };
const RANK = { unit: 0, asset: 1, contact: 2, place: 3 };

// Zwraca listę nienakładających się trafień { start, end, cand }, najdłuższe mają pierwszeństwo.
export function findMentions(text, candidates) {
  const spans = [];
  for (const cand of candidates) {
    const re = new RegExp(`(?<!${WORD})${escapeRe(cand.text)}(?!${WORD})`, cand.caseSensitive ? 'gu' : 'giu');
    for (const m of text.matchAll(re)) {
      // Miejsca tylko z wielkiej litery (żeby „sejny” małą literą nie było miastem).
      if (cand.kind === 'place' && m[0] === m[0].toLowerCase()) continue;
      spans.push({ start: m.index, end: m.index + m[0].length, cand });
    }
  }
  spans.sort((a, b) => b.end - b.start - (a.end - a.start) || RANK[a.cand.kind] - RANK[b.cand.kind] || a.start - b.start);
  const taken = [];
  for (const s of spans) {
    if (taken.some((t) => s.start < t.end && t.start < s.end)) continue;
    taken.push(s);
  }
  return taken.sort((a, b) => a.start - b.start);
}

export function linkify(text, context) {
  const src = String(text ?? '');
  const mentions = findMentions(src, buildCandidates(context));
  let html = '';
  let pos = 0;
  for (const { start, end, cand } of mentions) {
    html += escapeHtml(src.slice(pos, start));
    const title = cand.title ? ` title="${escapeHtml(cand.title)}"` : '';
    html += `<button type="button" class="mention mention--${CLASS_OF[cand.kind]}" data-mention-kind="${cand.kind}" data-mention-id="${escapeHtml(cand.id)}"${title}>${escapeHtml(src.slice(start, end))}</button>`;
    pos = end;
  }
  return html + escapeHtml(src.slice(pos));
}

// Podpowiedzi przy pisaniu: `@` wskazuje jednostkę (lub kontakt), `#` miejsce z gazetera (czyste funkcje).
import { matchScore } from './omnibox.js';

// Znajduje rozpoczęte oznaczenie tuż przed kursorem: { trigger: '@' | '#', query, start } albo null.
// Znak wyzwalający musi stać na początku tekstu albo po białym znaku; zapytanie (do 30 znaków) może zawierać
// spacje (nazwy jednostek: „1 bzmot”), ale nie nową linię ani kolejny znak wyzwalający.
export function activeTrigger(text, caret) {
  const before = text.slice(0, caret);
  const m = /(^|\s)([@#])([^\n@#]{0,30})$/u.exec(before);
  if (!m) return null;
  return { trigger: m[2], query: m[3], start: before.length - m[3].length - 1 };
}

// Lista podpowiedzi dla wyzwalacza: [{ kind, id, text, sub, sidc? }] (maks. `limit`).
export function mentionSuggestions(trigger, query, { units = [], contacts = [], assets = [], places = [] }, limit = 7) {
  const out = [];
  if (trigger === '@') {
    for (const u of units) out.push({ kind: 'unit', id: u.id, text: u.name || u.id, sub: u.status || '', sidc: u.sidc, score: Math.max(matchScore(query, u.name), matchScore(query, u.id)) });
    for (const a of assets) if (Array.isArray(a.pos)) out.push({ kind: 'asset', id: a.id, text: a.name || a.id, sub: a.type || '', sidc: a.sidc, score: Math.max(matchScore(query, a.name), matchScore(query, a.id)) });
    for (const c of contacts) out.push({ kind: 'contact', id: c.id, text: c.id, sub: c.estimate || '', sidc: c.sidc, score: matchScore(query, c.id) });
  } else {
    for (const p of places) out.push({ kind: 'place', id: p.id, text: p.name, sub: p.kind || '', score: Math.max(matchScore(query, p.name), ...(p.forms || []).map((f) => matchScore(query, f))) });
  }
  return out
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text, 'pl'))
    .slice(0, limit);
}

// Wstawia wybraną podpowiedź w miejsce oznaczenia; zwraca { text, caret }.
export function applySuggestion(text, trig, caret, suggestion) {
  const insert = suggestion.text + ' ';
  const next = text.slice(0, trig.start) + insert + text.slice(caret);
  return { text: next, caret: trig.start + insert.length };
}

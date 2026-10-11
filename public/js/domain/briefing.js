// Odprawa jako dokument: podział markdown na sekcje `##` (spis treści) i render HTML (czyste funkcje).
import { renderMarkdown, escapeHtml } from './markdown.js';

// Zwraca { title, lead, toc: [{ id, title }], html }. Sekcje `## 1. Sytuacja` dostają numer i id `s1`…
// Tytuł `#` jest nagłówkiem dokumentu; cytat tuż po nim (`> …`) staje się akapitem wstępnym.
export function briefingDocument(markdown) {
  const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  const intro = [];
  const sections = [];
  let cur = null;
  for (const line of lines) {
    let m;
    if ((m = /^#\s+(.*)$/.exec(line)) && !title && !cur) {
      title = m[1].trim();
    } else if ((m = /^##\s+(.*)$/.exec(line))) {
      cur = { title: m[1].replace(/^\d+\.\s*/, '').trim(), body: [] };
      sections.push(cur);
    } else if (cur) cur.body.push(line);
    else intro.push(line);
  }
  const toc = sections.map((s, i) => ({ id: `s${i + 1}`, title: s.title }));
  let html = '';
  if (title) html += `<h1>${escapeHtml(title)}</h1>`;
  if (intro.join('').trim()) html += `<div class="br-intro">${renderMarkdown(intro.join('\n'))}</div>`;
  sections.forEach((s, i) => {
    html += `<h2 id="s${i + 1}"><b>${i + 1}</b>${escapeHtml(s.title)}</h2>${renderMarkdown(s.body.join('\n'))}`;
  });
  if (!sections.length && !intro.join('').trim()) html += renderMarkdown(lines.join('\n'));
  return { title, toc, html };
}

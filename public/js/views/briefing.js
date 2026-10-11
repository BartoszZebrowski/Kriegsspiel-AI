// Widok: odprawa jako pełnoekranowy dokument — spis treści z nagłówków `##`, treść, karta odprawy z miejscami.
// Otwiera się, gdy store.briefing.open; zamknięcie (✕, Esc) zgłasza kontrolerowi.
import { briefingDocument } from '../domain/briefing.js';
import { escapeHtml as e } from '../domain/markdown.js';
import { findMentions, buildCandidates } from '../domain/linkify.js';
import { formatDuration, formatGameTime } from '../domain/format.js';
import { ic } from '../lib/icons.js';

export function createBriefingView({ store, controller, root = document }) {
  const overlay = root.getElementById('brief');
  const body = root.getElementById('briefing-body');
  const toc = root.getElementById('br-toc');
  const side = root.getElementById('br-side');
  const docEl = root.getElementById('br-doc');

  root.getElementById('briefing-close').addEventListener('click', () => controller.closeBriefing());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && overlay.classList.contains('open')) {
      ev.preventDefault();
      controller.closeBriefing();
    }
  });

  function sideHtml(s, text) {
    const sc = s.scenario || {};
    const kv = (k, v) => `<div class="kvr"><span>${k}</span><span>${e(v)}</span></div>`;
    // Wspomniane miejsca: nazwy z gazetera znalezione w tekście odprawy.
    const found = new Map();
    for (const m of findMentions(text || '', buildCandidates({ places: s.places }))) if (m.cand.kind === 'place') found.set(m.cand.id, s.places.find((p) => p.id === m.cand.id));
    const chips = [...found.values()].map((p) => `<button type="button" class="mention mention--place" data-place="${e(p.id)}">${ic('pin')}${e(p.name)}</button>`).join('');
    return `<div class="cap">Karta odprawy</div>
      ${kv('Strona', sc.side || '—')}${kv('Skala', sc.scale || '—')}${kv('Tura', sc.turnMinutes ? formatDuration(sc.turnMinutes) : '—')}${kv('Start', sc.start ? formatGameTime(sc.start, sc.timezone) : '—')}
      ${chips ? `<div class="lp-div"></div><div class="cap">Wspomniane miejsca</div><div class="chips">${chips}</div>` : ''}`;
  }

  function render(s) {
    const { briefing } = s;
    overlay.classList.toggle('open', briefing.open);
    if (!briefing.open) return;
    if (briefing.error) {
      body.innerHTML = `<p>${e(briefing.error)}</p>`;
      toc.innerHTML = '';
      side.innerHTML = '';
      return;
    }
    const doc = briefingDocument(briefing.text || '');
    root.getElementById('br-title').textContent = 'Odprawa' + (s.scenario ? ` · ${s.scenario.title}` : '');
    body.innerHTML = doc.html;
    toc.innerHTML = `<div class="cap">Spis treści</div>` + doc.toc.map((t, i) => `<a role="link" tabindex="0" class="${i === 0 ? 'on' : ''}" data-s="${t.id}">${i + 1}. ${e(t.title)}</a>`).join('');
    side.innerHTML = sideHtml(s, briefing.text);
    docEl.scrollTop = 0;
  }

  const goto = (a) => {
    for (const x of toc.querySelectorAll('a')) x.classList.toggle('on', x === a);
    root.getElementById(a.dataset.s)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  toc.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[data-s]');
    if (a) goto(a);
  });
  toc.addEventListener('keydown', (ev) => {
    const a = ev.target.closest('a[data-s]');
    if (a && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      goto(a);
    }
  });
  side.addEventListener('click', (ev) => {
    const chip = ev.target.closest('[data-place]');
    if (!chip) return;
    controller.closeBriefing();
    controller.mentionClick('place', chip.dataset.place);
  });
  // Aktywna sekcja spisu treści podąża za przewijaniem dokumentu.
  docEl.addEventListener('scroll', () => {
    const heads = [...body.querySelectorAll('h2[id]')];
    const top = docEl.getBoundingClientRect().top + 24;
    let cur = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top <= top) cur = h;
    for (const a of toc.querySelectorAll('a')) a.classList.toggle('on', cur && a.dataset.s === cur.id);
  });

  store.subscribe(['briefing', 'scenario', 'places'], render, { immediate: true });
}

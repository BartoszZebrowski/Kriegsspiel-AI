// Widok: podpowiedzi (tooltip) dla elementów z `data-tip` (opcjonalnie `data-k` — skrót klawiszowy, `data-pos` — r | l).
// Czysta warstwa DOM, bez stanu aplikacji. Pojawia się natychmiast, znika po opuszczeniu elementu.
import { escapeHtml as e } from '../domain/markdown.js';

export function createTooltipsView({ root = document } = {}) {
  const tip = root.getElementById('tip');

  function show(target) {
    tip.innerHTML = e(target.dataset.tip) + (target.dataset.k ? ` <kbd>${e(target.dataset.k)}</kbd>` : '');
    tip.classList.add('on');
    const r = target.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let x;
    let y;
    if (target.dataset.pos === 'r') {
      x = r.right + 8;
      y = r.top + (r.height - h) / 2;
    } else if (target.dataset.pos === 'l') {
      x = r.left - w - 8;
      y = r.top + (r.height - h) / 2;
    } else {
      x = r.left + (r.width - w) / 2;
      y = r.bottom + 6;
      if (y + h > window.innerHeight - 4) y = r.top - h - 6;
    }
    x = Math.max(6, Math.min(x, window.innerWidth - w - 6));
    tip.style.left = x + 'px';
    tip.style.top = Math.max(4, y) + 'px';
  }

  document.addEventListener('mouseover', (ev) => {
    const target = ev.target.closest?.('[data-tip]');
    if (target) show(target);
    else tip.classList.remove('on');
  });
  document.addEventListener('mouseleave', () => tip.classList.remove('on'));
  document.addEventListener('mousedown', () => tip.classList.remove('on'));
}

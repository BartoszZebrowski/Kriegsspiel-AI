// Widok: omówienie ćwiczenia (AAR) po bitwie — pełnoekranowy dokument ze spisem treści, jak odprawa (T29).
// Ten sam parser (domain/briefing.js) i style `br-*`; otwiera się, gdy store.aar.open. Tylko podgląd.
import { briefingDocument } from '../domain/briefing.js';
import { escapeHtml as e } from '../domain/markdown.js';

const SIDE_NAME = { PL: 'Strona własna', RU: 'Przeciwnik' };
const num = (n) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(n);

// Sekcja „Statystyki końcowe”: straty i zużycie amunicji po dniach (D+n) i stronach, z kategoriami sprzętu.
function statsHtml(stats) {
  const head = '<h2 id="aar-stats">Statystyki końcowe</h2>';
  if (!stats) return head + '<p class="muted">Liczenie statystyk…</p>';
  if (stats.empty || !stats.days?.length) return head + '<p class="muted">Brak danych z tur do podsumowania strat.</p>';
  const name = (s) => SIDE_NAME[s] || s;
  const equipOf = (b) => Object.entries(b?.equipment || {}).map(([k, v]) => `${e(k)} ${v}`).join(', ') || '—';
  const row = (label, s, b) => `<tr><td>${label}</td><td>${e(name(s))}</td><td>${b ? b.personnel : 0}</td><td>${equipOf(b)}</td><td>${num(b?.ammo || 0)}</td></tr>`;
  const rows = [];
  for (const d of stats.days) for (const s of stats.sides) rows.push(row(`D+${d.day}`, s, d.sides[s]));
  for (const s of stats.sides) rows.push(row('<strong>Razem</strong>', s, stats.totals[s]));
  return `${head}<p class="muted">Straty liczone z różnic stanów jednostek w kolejnych turach prawdy (personel, sprzęt); amunicja jako spadek zapasu w DOS.</p>
<table><thead><tr><th>Dzień</th><th>Strona</th><th>Straty osobowe</th><th>Straty sprzętu</th><th>Amunicja (DOS)</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

export function createAarView({ store, controller, root = document }) {
  const overlay = root.getElementById('aar');
  const body = root.getElementById('aar-body');
  const toc = root.getElementById('aar-toc');
  const side = root.getElementById('aar-side');
  const docEl = root.getElementById('aar-doc');

  root.getElementById('aar-close').addEventListener('click', () => controller.closeAar());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && overlay.classList.contains('open')) {
      ev.preventDefault();
      controller.closeAar();
    }
  });

  function render(s) {
    const { aar } = s;
    overlay.classList.toggle('open', aar.open);
    if (!aar.open) return;
    if (aar.error) {
      body.innerHTML = `<p>${e(aar.error)}</p>`;
      toc.innerHTML = '';
      side.innerHTML = '';
      return;
    }
    const doc = briefingDocument(aar.text || '');
    const toc2 = [...doc.toc, { id: 'aar-stats', title: 'Statystyki końcowe' }];
    body.innerHTML = doc.html + statsHtml(aar.stats);
    toc.innerHTML = `<div class="cap">Spis treści</div>` + toc2.map((t, i) => `<a role="link" tabindex="0" class="${i === 0 ? 'on' : ''}" data-s="${t.id}">${i + 1}. ${e(t.title)}</a>`).join('');
    side.innerHTML = `<div class="cap">Po bitwie</div><p class="muted">Warstwa „Prawda” w panelu Warstw pokazuje przeciwnika na prawdziwych pozycjach. Komunikator działa tylko jako podgląd.</p>`;
    if (!aar.stats) docEl.scrollTop = 0; // dopływ statystyk nie cofa przewinięcia
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
  docEl.addEventListener('scroll', () => {
    const heads = [...body.querySelectorAll('h2[id]')];
    const top = docEl.getBoundingClientRect().top + 24;
    let cur = heads[0];
    for (const h of heads) if (h.getBoundingClientRect().top <= top) cur = h;
    for (const a of toc.querySelectorAll('a')) a.classList.toggle('on', cur && a.dataset.s === cur.id);
  });

  store.subscribe(['aar'], render, { immediate: true });
}

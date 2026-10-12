// Widok: panel „Odprawa sztabu” (T28.1) — trzy karty S2/S3/S4 z odznaką roli, nazwą, tekstem i DTG.
// Klik w kartę otwiera kanał postaci. Zamknięcie (✕) i przywołanie (ikona przy zegarze) idą przez kontroler;
// stan panelu leży w store (`staffOpen`, `staffUi`). Działa też w archiwum (odprawa oglądanej tury).
import { escapeHtml as e } from '../domain/markdown.js';

export function createStaffView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);
  const panel = $('staff-panel');
  const body = $('staff-body');
  const toggle = $('tb-staff');

  const card = (c) => {
    const tip = c.channel ? 'Otwórz kanał rozmowy' : 'Brak osobnego kanału łączności';
    return `<article class="staff-card" data-role="${e(c.role)}" tabindex="0" role="button" data-linked="${c.channel ? '1' : '0'}" aria-label="${e(c.badge + ' ' + c.name)}. ${e(tip)}" title="${e(tip)}">
      <header><span class="staff-badge staff-${e(c.role)}">${e(c.badge)}</span><span class="staff-name">${e(c.name)}</span><time class="staff-dtg mono">${e(c.dtg)}</time></header>
      <p>${e(c.text)}</p></article>`;
  };

  function render(s) {
    const open = s.staffOpen;
    panel.classList.toggle('open', open);
    toggle.classList.toggle('on', open);
    toggle.disabled = s.staff.length === 0;
    toggle.setAttribute('aria-pressed', String(open));
    $('staff-turn').textContent = s.turn ? `TURA ${s.viewTurn}${s.archive ? ' · archiwum' : ''}` : '';
    body.innerHTML = open ? s.staff.map(card).join('') : '';
  }

  const pick = (el) => el && controller.openStaffChannel(el.dataset.role);
  body.addEventListener('click', (ev) => pick(ev.target.closest('.staff-card')));
  body.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      pick(ev.target.closest('.staff-card'));
    }
  });
  $('staff-x').addEventListener('click', () => controller.closeStaffPanel());
  toggle.addEventListener('click', () => controller.toggleStaffPanel());

  store.subscribe(['staff', 'staffOpen', 'turn', 'viewTurn', 'archive'], render, { immediate: true });
}

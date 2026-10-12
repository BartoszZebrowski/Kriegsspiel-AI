// Widok: pasek górny — scenariusz, omnibox, zegar z DTG i nawigacją po turach, skrzynka, odprawa,
// powiadomienia (dzwonek), legenda i przełączniki docków.
import { formatDayClock, formatDtg, formatDuration } from '../domain/format.js';
import { escapeHtml } from '../domain/markdown.js';

export function createTopbarView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);

  $('t-prev').addEventListener('click', () => controller.prevTurn());
  $('t-next').addEventListener('click', () => controller.nextTurn());
  $('t-cur').addEventListener('click', () => controller.showCurrent());
  $('omni-open').addEventListener('click', () => controller.openOmnibox());
  $('tb-brief').addEventListener('click', () => controller.openBriefing());
  $('tb-ccir').addEventListener('click', () => controller.toggleCcirEditor());
  $('tb-help').addEventListener('click', () => controller.togglePopover('legend'));
  $('tb-l').addEventListener('click', () => controller.toggleDock('l'));
  $('tb-r').addEventListener('click', () => controller.toggleDock('r'));
  $('tb-bell').addEventListener('click', (e) => {
    e.stopPropagation();
    controller.togglePopover('bell');
  });
  // Klik poza dzwonkiem zamyka jego popover.
  document.addEventListener('click', (e) => {
    if (store.get().popover === 'bell' && !e.target.closest('#bell-pop')) controller.setPopover(null);
  });

  function renderClock(s) {
    const { scenario, turn, turns, viewTurn, currentTurn, archive } = s;
    if (!scenario) return;
    const tz = scenario.timezone;
    $('scenario-title').textContent = scenario.title;
    $('clk-turn').textContent = (archive ? 'ARCHIWUM · ' : '') + `TURA ${viewTurn}`;
    $('clk-time').textContent = turn ? formatDayClock(turn.time, tz) : '—';
    $('clk-dtg').textContent = turn ? `${formatDtg(turn.time, tz)} · tura ${formatDuration(scenario.turnMinutes)}` : '';
    $('t-prev').disabled = turns.indexOf(viewTurn) <= 0;
    $('t-next').disabled = viewTurn >= currentTurn;
    $('t-cur').hidden = !archive;
    document.body.classList.toggle('archive', archive);
  }

  function renderOutbox({ outboxCount, currentTurn }) {
    const pill = $('outbox-pill');
    pill.textContent = `SKRZYNKA · ${outboxCount}`;
    pill.dataset.tip = `Rozkazy gracza w turze ${currentTurn}: ${outboxCount}. Zostaną rozpatrzone po „koniec tury”`;
  }

  function renderUnread({ unread, scenario }) {
    document.title = (unread.total ? `(${unread.total}) ` : '') + (scenario?.title || 'Kriegsspiel AI');
  }

  function renderDocks({ ui }) {
    $('tb-l').classList.toggle('on', !ui.leftCollapsed);
    $('tb-r').classList.toggle('on', !ui.rightCollapsed);
  }

  function renderBell({ notices, noticesSeen, popover }) {
    const unseen = notices.filter((n) => n.id > noticesSeen).length;
    const badge = $('bell-badge');
    badge.hidden = unseen === 0;
    badge.textContent = unseen;
    $('tb-bell').classList.toggle('on', popover === 'bell');
    const pop = $('bell-pop');
    pop.classList.toggle('open', popover === 'bell');
    if (popover !== 'bell') return;
    pop.innerHTML = notices.length
      ? notices
          .slice(0, 12)
          .map((n) => `<div class="bn${n.error ? ' err' : ''}${n.urgent ? ' urg' : ''}"><b>${escapeHtml(n.title || (n.error ? 'Błąd' : 'Komunikat'))}</b><span>${escapeHtml(n.text)}</span></div>`)
          .join('')
      : '<div class="bn-none">Brak powiadomień</div>';
  }

  store.subscribe(['scenario', 'turn', 'turns', 'viewTurn', 'currentTurn', 'archive'], renderClock, { immediate: true });
  store.subscribe(['outboxCount', 'currentTurn'], renderOutbox, { immediate: true });
  store.subscribe(['unread', 'scenario'], renderUnread, { immediate: true });
  store.subscribe('ui', renderDocks, { immediate: true });
  store.subscribe(['notices', 'noticesSeen', 'popover'], renderBell, { immediate: true });
}

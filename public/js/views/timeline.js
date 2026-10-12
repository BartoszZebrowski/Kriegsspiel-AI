// Widok: oś czasu tur pod mapą — węzły tur (przeszłość, bieżąca, przyszłość, archiwum w kolorze bursztynu),
// ścieżki zdarzeń (wiadomości, rozkazy, kontakty), znacznik oglądanej tury i zablokowany przełącznik „Po bitwie”.
// Klik w przeszłą turę = podgląd archiwalny (controller.showTurn).
import { dayPhase, isNightPhase } from '../domain/daylight.js';
import { buildTimeline, tickCount, hourStep, showTurnLabel, lanesVisible } from '../domain/timeline.js';
import { formatClock } from '../domain/format.js';
import { buildSchedule, dayStarts } from '../domain/campaign.js';
import { REPORT_LABELS } from '../domain/ccir.js';
import { escapeHtml as e } from '../domain/markdown.js';

export function createTimelineView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);
  const axis = $('tl-axis');
  const mid = $('tl-mid');
  const section = $('timeline');
  const S = () => store.get();

  function render() {
    const s = S();
    if (!s.scenario) return;
    const { scenario } = s;
    const tz = scenario.timezone;
    const width = Math.max(0, mid.clientWidth - 40);
    const sched = buildSchedule(scenario, s.schedule, Math.max(0, tickCount(s.currentTurn) - (s.schedule || []).length));
    const offsets = sched.map((x) => x.offsetMin);
    const tl = buildTimeline({
      turns: s.turns,
      currentTurn: s.currentTurn,
      viewTurn: s.viewTurn,
      start: scenario.start,
      turnMinutes: scenario.turnMinutes,
      messages: s.messages,
      contacts: s.turn?.contacts || [],
      offsets,
      days: dayStarts(scenario, sched),
      nightAt: (min) => isNightPhase(dayPhase(new Date((sched[0]?.ms ?? Date.parse(scenario.start)) + min * 60000).toISOString(), scenario.map?.center)),
    });
    const step = hourStep(width);
    const t0 = sched[0]?.ms ?? Date.parse(scenario.start);
    const clock = (i) => formatClock(new Date(t0 + (offsets[i] ?? i * scenario.turnMinutes) * 60000).toISOString(), tz);
    let h = '<div class="tl-hours">';
    for (const t of tl.ticks) if (t.turn % step === 0) h += `<span style="left:${t.pct}%">${clock(t.turn)}</span>`;
    h += '</div>';
    for (const d of tl.days) h += `<div class="tl-day" style="left:${d.pct}%" data-tip="${e(d.title || d.id)}"><b>${e(d.id)}</b></div>`;
    h += `<div class="tl-line"></div><div class="tl-fut" style="left:${tl.futurePct}%"></div><div class="tl-past" style="width:${tl.pastPct}%"></div>`;
    for (const t of tl.ticks) {
      const cls = [t.state === 'fut' ? 'fut' : '', t.state === 'cur' ? 'cur' : '', t.view ? 'view' : '', t.night ? 'night' : ''].filter(Boolean).join(' ');
      const tip = `Tura ${t.turn} · ${clock(t.turn)}${t.state === 'fut' ? ' (przyszła)' : t.state === 'cur' ? ' (bieżąca)' : ''}${t.night ? ' · noc' : ''}`;
      h += `<button type="button" class="tl-node ${cls}" data-turn="${t.turn}" ${t.clickable ? '' : 'tabindex="-1" aria-disabled="true"'} style="left:${t.pct}%" data-tip="${e(tip)}" aria-label="${e(tip)}"><em${showTurnLabel(t.turn, width) ? '' : ' style="display:none"'}>T${t.turn}</em><i></i></button>`;
    }
    const repTip = (x) => (x.report ? ` data-tip="${REPORT_LABELS[x.report]}${x.count > 1 ? ` ×${x.count}` : ''}"` : '');
    const lane = (cls, items) => `<div class="tl-lane ${cls}">${items.map((x) => `<i class="${x.urgent ? 'u' : ''}${x.late ? ' late' : ''}${x.report ? ` rep rep-${x.report}` : ''}" style="left:${x.pct}%"${repTip(x)}></i>`).join('')}</div>`;
    h += lane('msgs', tl.lanes.msgs) + lane('ords', tl.lanes.ords) + lane('cons', tl.lanes.cons);
    h += `<div class="tl-play" style="left:${tl.playheadPct}%"></div>`;
    axis.innerHTML = h;

    $('tl-info').textContent = `T${s.viewTurn}${s.archive ? ' · archiwum' : ' · bieżąca'}`;
    $('tl-prev').disabled = s.turns.indexOf(s.viewTurn) <= 0;
    $('tl-next').disabled = s.viewTurn >= s.currentTurn;
    $('tl-cur').disabled = !s.archive;
    $('tl-replay').disabled = s.turns.indexOf(s.viewTurn) <= 0;
    section.classList.toggle('compact', !lanesVisible(section.offsetHeight));
    const finished = scenario.status === 'finished';
    $('ab-btn').disabled = !finished;
    $('afterbattle').classList.toggle('locked', !finished);
  }

  axis.addEventListener('click', (ev) => {
    const node = ev.target.closest('.tl-node');
    if (!node || node.getAttribute('aria-disabled') === 'true') return;
    controller.showTurn(+node.dataset.turn);
  });
  $('tl-prev').addEventListener('click', () => controller.prevTurn());
  $('tl-next').addEventListener('click', () => controller.nextTurn());
  $('tl-cur').addEventListener('click', () => controller.showCurrent());
  $('tl-replay').addEventListener('click', () => controller.replayTurn());
  // Tryb „po bitwie” (T29): po zakończeniu scenariusza przycisk otwiera omówienie ćwiczenia (AAR); pełny suwak czasu i warstwy: T32.
  $('ab-btn').addEventListener('click', () => controller.openAar());

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => render()).observe(section);
  store.subscribe(['scenario', 'turns', 'currentTurn', 'viewTurn', 'messages', 'turn', 'archive'], render, { immediate: true });
}

// Widok: lewy dok, panel „Inspektor” — karta zaznaczonego obiektu (jednostka, kontakt, środek rozpoznania).
// Czyta store.selection i dane tury; akcje (wiadomość, wycentruj, rozkaz) zgłasza kontrolerowi.
import { symbolSvg } from '../lib/symbols.js';
import { ic } from '../lib/icons.js';
import { describeSidc } from '../domain/sidc.js';
import { escapeHtml as e } from '../domain/markdown.js';
import { findEntity } from '../domain/entities.js';
import { indexById, childrenOf, channelForUnit, isNeighbourUnit } from '../domain/orbat.js';
import { readinessRatio } from '../domain/strength.js';
import { inspectorHead, unitCard, contactCard, assetCard, supplyCard, historyCard } from '../domain/cards.js';

export function createInspectorView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);
  const body = $('insp-body');
  const tabs = $('in-tabs');
  const S = () => store.get();
  let tabState = 'ov'; // Przegląd | Zaopatrzenie | Historia — stan lokalny widoku

  const symbolOf = (sidc, size) => (sidc ? symbolSvg(sidc, { size }).svg : '');

  function emptyHtml() {
    return `<div class="insp-empty">${ic('crosshair')}<b>Nic nie zaznaczono</b><span>Kliknij jednostkę na mapie lub w strukturze,<br>albo wciśnij <kbd>Ctrl K</kbd>.</span></div>`;
  }

  function actions(list) {
    return `<div class="insp-actions">${list.join('')}</div>`;
  }
  const btn = (act, label, icon, cls = '', disabled = false) =>
    `<button type="button" class="btn ${cls}" data-act="${act}"${disabled ? ' disabled' : ''}>${icon ? ic(icon, 's') : ''}${label}</button>`;

  function render() {
    const s = S();
    const sel = s.selection;
    const entity = sel && s.turn ? findEntity(s.turn, sel.id) : null;
    $('in-aim').disabled = !entity;
    $('in-x').disabled = !sel;
    if (!entity) {
      tabs.hidden = true;
      body.innerHTML = emptyHtml();
      return;
    }
    const { item, kind } = entity;
    const tz = s.scenario?.timezone;
    const ctx = { symbolOf, turnTime: s.turn.time, tz, header: false };
    const units = s.turn.units || [];
    // Jednostka formacji sąsiada: tylko odczyt (bez wiadomości, rozkazów i dziennika rozmów).
    const neighbour = kind === 'unit' && isNeighbourUnit(item, indexById(units));
    tabs.hidden = kind !== 'unit' || neighbour;
    const tab = neighbour ? 'ov' : tabState;
    let html;
    if (kind === 'unit') {
      const ch = neighbour ? null : channelForUnit(s.channels, item.id);
      const ratio = item.personnel ? readinessRatio(item.personnel.current, item.personnel.authorized) : typeof item.strength === 'number' ? item.strength : null;
      html = inspectorHead({ symbol: symbolOf(item.sidc, 44), title: item.name || item.id, sub: describeSidc(item.sidc), sidc: item.sidc, status: item.status, ratio });
      html += neighbour ? actions([btn('aim', 'Wycentruj', 'aim', 'pri')]) : actions([btn('msg', 'Wiadomość', 'msg', 'pri', !ch), btn('aim', 'Wycentruj', 'aim'), btn('ord', 'Rozkaz…', '', '', !ch)]);
      if (tab === 'ov') html += unitCard(item, indexById(units), childrenOf(units, item.id), { ...ctx, neighbour });
      else if (tab === 'sup') html += supplyCard();
      else {
        const msgs = ch ? s.visibleMessages.filter((m) => m.channel === ch.id) : [];
        html += historyCard(msgs, tz);
      }
    } else if (kind === 'contact') {
      html = inspectorHead({ symbol: symbolOf(item.sidc, 44), title: item.id, sub: `Kontakt · ${item.estimate || describeSidc(item.sidc)}`, sidc: item.sidc });
      const s2 = s.channels.find((c) => c.kind === 'recon');
      html += actions([btn('aim', 'Wycentruj', 'aim', 'pri'), btn('s2', 'Zapytaj S2', 'msg', '', !s2), btn('hyp', 'Hipoteza')]);
      html += contactCard(item, s.turn.time, tz, ctx);
    } else {
      html = inspectorHead({ symbol: symbolOf(item.sidc, 44), title: item.name || item.id, sub: item.type || describeSidc(item.sidc), sidc: item.sidc || '', status: item.status });
      html += actions([btn('aim', 'Wycentruj', 'aim', 'pri')]);
      html += assetCard(item, ctx);
    }
    const keepScroll = body.dataset.id === sel.id ? body.scrollTop : 0;
    body.innerHTML = html;
    body.dataset.id = sel.id;
    body.scrollTop = keepScroll;
    for (const b of tabs.querySelectorAll('button')) {
      b.classList.toggle('on', b.dataset.t === tabState);
      b.setAttribute('aria-selected', String(b.dataset.t === tabState));
    }
  }

  tabs.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-t]');
    if (!b) return;
    tabState = b.dataset.t;
    render();
  });

  $('in-aim').addEventListener('click', () => controller.focusEntity(S().selection?.id));
  $('in-x').addEventListener('click', () => controller.clearSelection());

  body.addEventListener('click', (ev) => {
    const T = ev.target;
    const act = T.closest('[data-act]');
    const id = S().selection?.id;
    if (act && id) {
      const a = act.dataset.act;
      if (a === 'msg') controller.openUnitChannel(id);
      else if (a === 'aim') controller.focusEntity(id);
      else if (a === 'ord') {
        if (controller.openUnitChannel(id)) controller.command('compose', { type: 'rozkaz' });
      } else if (a === 's2') {
        const ch = S().channels.find((c) => c.kind === 'recon');
        if (ch) controller.openChannel(ch.id);
      } else if (a === 'hyp') controller.command('tool', 'symbol');
      return;
    }
    const chip = T.closest('[data-unit]');
    if (chip) {
      controller.selectEntity(chip.dataset.unit);
      return;
    }
    const copy = T.closest('[data-copy]');
    if (copy) {
      try {
        navigator.clipboard?.writeText(copy.dataset.copy);
        controller.notify('Skopiowano: ' + copy.dataset.copy);
      } catch {
        // schowek niedostępny
      }
    }
  });
  body.addEventListener('keydown', (ev) => {
    const chip = ev.target.closest?.('[data-unit]');
    if (chip && (ev.key === 'Enter' || ev.key === ' ')) {
      ev.preventDefault();
      controller.selectEntity(chip.dataset.unit);
    }
  });

  store.subscribe(['selection', 'turn', 'scenario', 'channels', 'visibleMessages'], render, { immediate: true });
}

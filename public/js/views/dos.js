// Widok: zbiorczy panel DOS (popover mapy `#dos-panel`) — tabela jednostek własnych, najgorszy wskaźnik na górze.
// Klik w wiersz zaznacza jednostkę (karta w inspektorze). Otwarcie to store.popover === 'dos' (przycisk, klawisz D, omnibox).
import { symbolSvg } from '../lib/symbols.js';
import { escapeHtml as e } from '../domain/markdown.js';
import { dosRows, dosIndicators, formatDosValue, DOS_LABELS, DOS_KINDS } from '../domain/dos.js';
import { formatAgeShort } from '../domain/format.js';

const SHORT = { fuel: 'Pal.', ammo: 'Amun.', general: 'Ogól.', readiness: 'Spr.' };

export function createDosView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);
  const panel = $('dos-panel');
  const body = $('dos-body');

  function cell(row, kind) {
    const v = row.dos?.[kind];
    if (typeof v !== 'number') return '<td class="dos-c">—</td>';
    const ind = dosIndicators(row.dos).find((i) => i.kind === kind);
    return `<td class="dos-c dos-${ind.level}" title="${e(DOS_LABELS[kind])}">${e(formatDosValue(kind, v))}</td>`;
  }

  function render() {
    const s = store.get();
    panel.classList.toggle('open', s.popover === 'dos');
    $('b-dos')?.classList.toggle('on', s.popover === 'dos');
    if (s.popover !== 'dos' || !s.turn) return;
    const rows = dosRows(s.turn.units || [], s.turn.time);
    if (!rows.length) {
      body.innerHTML = '<p class="muted pad">Brak jednostek własnych.</p>';
      return;
    }
    const head = `<tr><th>Jednostka</th>${DOS_KINDS.map((k) => `<th class="dos-c" title="${e(DOS_LABELS[k])}">${SHORT[k]}</th>`).join('')}<th class="dos-c">Wiek</th></tr>`;
    const trs = rows
      .map((r) => {
        const sym = r.unit.sidc ? symbolSvg(r.unit.sidc, { size: 18 }).svg : '';
        const age = r.ageMin === null ? '—' : formatAgeShort(r.ageMin);
        const lvl = r.level ? ` data-level="${r.level}"` : ' data-level="none"';
        const calc = r.derived ? '<span class="pill" title="Wyliczone: minimum z podwładnych">wyl.</span>' : '';
        return `<tr class="dos-row" tabindex="0" data-unit="${e(r.unit.id)}"${lvl}><td class="dos-u"><span class="dos-sym">${sym}</span><span class="dos-name">${e(r.unit.name || r.unit.id)}</span>${calc}</td>${DOS_KINDS.map((k) => cell(r, k)).join('')}<td class="dos-c mono${r.stale ? ' age' : ''}">${e(age)}</td></tr>`;
      })
      .join('');
    body.innerHTML = `<table class="dos-t"><thead>${head}</thead><tbody>${trs}</tbody></table>`;
  }

  function pick(row) {
    if (!row) return;
    if (store.get().ui.leftCollapsed) controller.setDock('l', false);
    controller.selectEntity(row.dataset.unit, { pan: false });
    if (store.get().ui.narrow) controller.setPopover(null);
  }
  body.addEventListener('click', (ev) => pick(ev.target.closest('.dos-row')));
  body.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      pick(ev.target.closest('.dos-row'));
    }
  });
  $('dos-x').addEventListener('click', () => controller.setPopover(null));
  $('b-dos')?.addEventListener('click', () => controller.togglePopover('dos'));
  store.subscribe(['popover', 'turn'], render, { immediate: true });
}

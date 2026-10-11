// Widok: omnibox (Ctrl K) — jedno okno do wyszukiwania jednostek, kontaktów, środków rozpoznania, miejsc
// z gazetera, szkiców i poleceń. Indeks i ranking to czysta funkcja (domain/omnibox.js); widok renderuje wyniki
// i zgłasza kontrolerowi intencje (zaznacz + leć, otwórz kanał, przelot do miejsca, polecenie).
import { searchOmnibox, FILTERS, GROUP_TITLES, splitMatch } from '../domain/omnibox.js';
import { symbolSvg } from '../lib/symbols.js';
import { ic } from '../lib/icons.js';
import { escapeHtml as e } from '../domain/markdown.js';

export function createOmniboxView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);
  const overlay = $('omni');
  const input = $('o-q');
  const list = $('o-list');
  const seg = $('o-seg');
  const S = () => store.get();

  let filter = 'all';
  let sel = 0;
  let items = [];

  seg.innerHTML = FILTERS.map(([id, label]) => `<button type="button" data-f="${id}" class="${id === filter ? 'on' : ''}">${label}</button>`).join('');

  function data() {
    const s = S();
    return {
      units: s.turn?.units || [],
      contacts: s.turn?.contacts || [],
      assets: s.turn?.assets || [],
      places: s.places || [],
      notes: s.notes || [],
      channels: s.channels || [],
      turnTime: s.turn?.time ?? null,
    };
  }

  function glyph(it) {
    if (it.kind === 'place') return ic('pin');
    if (it.kind === 'command') return ic('cmd');
    if (it.kind === 'sketch') return ic('flag');
    return it.ref.sidc ? symbolSvg(it.ref.sidc, { size: 24 }).svg.replace('<svg', '<svg class="ms"') : '';
  }

  function highlight(text, query) {
    const parts = splitMatch(text, query);
    return parts ? `${e(parts[0])}<mark>${e(parts[1])}</mark>${e(parts[2])}` : e(text);
  }

  function render() {
    const query = input.value;
    items = searchOmnibox(query, filter, data());
    sel = Math.min(sel, Math.max(0, items.length - 1));
    if (!items.length) {
      list.innerHTML = `<div class="o-none">Brak wyników dla „${e(query)}”</div>`;
      return;
    }
    let group = '';
    let html = '';
    items.forEach((it, i) => {
      if (it.group !== group) {
        group = it.group;
        html += `<div class="o-g cap">${GROUP_TITLES[group]}</div>`;
      }
      html += `<div class="o-i${i === sel ? ' sel' : ''}" role="option" aria-selected="${i === sel}" data-i="${i}"><div class="s">${glyph(it)}</div><div><div class="t">${highlight(it.title, query)}</div>${it.sub ? `<div class="u">${e(it.sub)}</div>` : ''}</div><div class="r">${it.kind === 'command' && it.right ? `<kbd>${e(it.right)}</kbd>` : `<span class="mono">${e(it.right)}</span>`}${i === sel ? '<kbd>↵</kbd>' : ''}</div></div>`;
    });
    list.innerHTML = html;
    list.querySelector('.o-i.sel')?.scrollIntoView({ block: 'nearest' });
  }

  // Wykonanie wyniku. alt (Shift+Enter): otwórz kanał rozmowy z jednostką zamiast „przejdź”.
  function run(i, alt = false) {
    const it = items[i];
    if (!it) return;
    controller.closeOmnibox();
    if (it.kind === 'unit') {
      if (alt) {
        if (!controller.openUnitChannel(it.id)) controller.selectEntity(it.id);
        else controller.selectEntity(it.id, { pan: false });
      } else controller.selectEntity(it.id);
    } else if (it.kind === 'contact' || it.kind === 'asset') controller.selectEntity(it.id);
    else if (it.kind === 'place') controller.flyToPlace(it.ref);
    else if (it.kind === 'sketch') controller.showAttachment(it.ref);
    else if (it.kind === 'command') controller.runCommand(it.id);
  }

  function open() {
    overlay.classList.add('open');
    input.value = '';
    sel = 0;
    filter = 'all';
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset.f === 'all');
    render();
    setTimeout(() => input.focus(), 10);
  }
  function close() {
    overlay.classList.remove('open');
  }

  input.addEventListener('input', () => {
    sel = 0;
    render();
  });
  list.addEventListener('click', (ev) => {
    const row = ev.target.closest('.o-i');
    if (row) run(+row.dataset.i, ev.shiftKey);
  });
  list.addEventListener('mousemove', (ev) => {
    const row = ev.target.closest('.o-i');
    if (row && +row.dataset.i !== sel) {
      sel = +row.dataset.i;
      for (const r of list.querySelectorAll('.o-i')) r.classList.toggle('sel', r === row);
    }
  });
  seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    for (const x of seg.querySelectorAll('button')) x.classList.toggle('on', x === b);
    sel = 0;
    render();
    input.focus();
  });
  overlay.addEventListener('mousedown', (ev) => {
    if (!ev.target.closest('.omni-box')) controller.closeOmnibox();
  });
  overlay.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.preventDefault();
      controller.closeOmnibox();
    } else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      sel = Math.min(items.length - 1, sel + 1);
      render();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      sel = Math.max(0, sel - 1);
      render();
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      run(sel, ev.shiftKey);
    } else if (ev.key === 'Tab') {
      // Tab przełącza filtry (Shift+Tab wstecz) — fokus zostaje w polu.
      ev.preventDefault();
      const ids = FILTERS.map((f) => f[0]);
      const n = (ids.indexOf(filter) + (ev.shiftKey ? -1 : 1) + ids.length) % ids.length;
      seg.querySelector(`[data-f="${ids[n]}"]`).click();
    }
  });

  store.subscribe(
    'omnibox',
    ({ omnibox }) => {
      if (omnibox.open && !overlay.classList.contains('open')) open();
      else if (!omnibox.open && overlay.classList.contains('open')) close();
    },
    { immediate: true },
  );
}

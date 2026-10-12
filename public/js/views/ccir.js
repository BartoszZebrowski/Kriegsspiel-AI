// Widok: edytor CCIR (T48) — pływający panel z listą krytycznych potrzeb informacyjnych dowódcy:
// PIR (o przeciwniku) i FFIR (o własnych siłach), 3–7 pozycji, opcjonalna geometria wskazana na mapie.
// Edytowana kopia leży w store.ccirEditor; „Zapisz” zapisuje player/ccir.json przez kontroler.
// Wskazywanie geometrii (kliknięcia na mapie) obsługuje views/map/ccir.js — przez store.ccirEditor.pick.
import { escapeHtml as e } from '../domain/markdown.js';
import { CCIR_KINDS, CCIR_MAX, CCIR_SHAPES, CCIR_TEXT_MAX, shapeOf, ccirAdvice, reportCycleText } from '../domain/ccir.js';
import { ic } from '../lib/icons.js';

export function createCcirView({ store, controller, root = document }) {
  const panel = root.getElementById('ccir-panel');
  const S = () => store.get();
  let sig = '';

  const itemHtml = (it, pick) => {
    const shape = shapeOf(it);
    const shapes = Object.entries(CCIR_SHAPES)
      .map(([k, name]) => `<button type="button" class="sw${pick?.id === it.id && pick.shape === k ? ' on' : ''}" data-pick="${k}" data-id="${e(it.id)}" title="Wskaż na mapie: ${name.toLowerCase()}">${name}</button>`)
      .join('');
    const geo = shape ? `<span class="ccir-geo" title="Geometria na mapie">${e(CCIR_SHAPES[shape])}<a role="button" tabindex="0" data-geo-clear="${e(it.id)}" aria-label="Usuń geometrię">${ic('x', 's')}</a></span>` : '';
    return `<li class="ccir-item" data-item="${e(it.id)}">
      <div class="ccir-row"><span class="tag ccir">${e(it.id)}</span>
        <input type="text" data-text="${e(it.id)}" maxlength="${CCIR_TEXT_MAX}" value="${e(it.text)}" placeholder="${e(CCIR_KINDS[it.kind].hint)}" aria-label="Treść ${e(it.id)}">
        <button type="button" class="ibtn" data-remove="${e(it.id)}" aria-label="Usuń pozycję ${e(it.id)}" data-tip="Usuń">${ic('x', 's')}</button></div>
      <div class="ccir-row ccir-geoRow"><span class="cap">Mapa</span>${shapes}${geo}</div></li>`;
  };

  function render() {
    const s = S();
    const { open, draft, pick } = s.ccirEditor;
    panel.hidden = !open;
    if (!open) {
      sig = '';
      return;
    }
    const nextSig = JSON.stringify([draft.map((i) => [i.id, shapeOf(i)]), pick]);
    if (nextSig === sig) {
      // Zmienił się tylko tekst (wpisywany w polu): nie przebudowujemy panelu, żeby nie gubić kursora.
      for (const inp of panel.querySelectorAll('input[data-text]')) {
        const it = draft.find((i) => i.id === inp.dataset.text);
        if (it && inp !== root.activeElement && inp.value !== it.text) inp.value = it.text;
      }
      return;
    }
    sig = nextSig;
    const section = (kind) => {
      const list = draft.filter((i) => i.kind === kind);
      return `<section><div class="ccir-h"><b>${kind}</b><span>${e(CCIR_KINDS[kind].long)}</span><span class="grow"></span>
        <button type="button" class="sw" data-add="${kind}"${draft.length >= CCIR_MAX ? ' disabled' : ''}>${ic('plus', 's')}Dodaj</button></div>
        <ul class="ccir-list">${list.map((i) => itemHtml(i, pick)).join('') || `<li class="ccir-empty">Brak pozycji ${kind}.</li>`}</ul></section>`;
    };
    const cycle = reportCycleText(s.scenario);
    const advice = ccirAdvice(draft);
    const banner = pick ? `<div class="ccir-pick">Wskaż na mapie: ${e(CCIR_SHAPES[pick.shape].toLowerCase())} dla ${e(pick.id)}. Esc anuluje${pick.shape === 'point' ? '.' : '; dwuklik lub Enter zatwierdza.'}</div>` : '';
    panel.innerHTML = `<div class="ccir-top"><strong>CCIR</strong><span class="ccir-sub">${draft.length} / ${CCIR_MAX}</span><span class="grow"></span>
        <button type="button" class="btn ghost sm" data-act="close" aria-label="Zamknij edytor CCIR">${ic('x', 's')}</button></div>
      <p class="ccir-note">O czym dowódca ma być alarmowany natychmiast. Postacie meldują pilnie tylko to, co spełnia CCIR; resztę w meldunkach cyklicznych${cycle ? ` (${e(cycle)})` : ''}.</p>
      ${section('PIR')}${section('FFIR')}${banner}
      ${advice ? `<div class="ccir-advice">${e(advice)}</div>` : ''}
      <div class="ccir-actions"><button type="button" class="btn sm" data-act="close">Anuluj</button><button type="button" class="btn pri sm" data-act="save">Zapisz</button></div>`;
  }

  panel.addEventListener('input', (ev) => {
    const inp = ev.target.closest('input[data-text]');
    if (inp) controller.ccirEdit(inp.dataset.text, { text: inp.value });
  });
  panel.addEventListener('click', (ev) => {
    const t = ev.target;
    const add = t.closest('[data-add]');
    const rm = t.closest('[data-remove]');
    const pick = t.closest('[data-pick]');
    const clear = t.closest('[data-geo-clear]');
    const act = t.closest('[data-act]')?.dataset.act;
    if (add) {
      const id = controller.ccirAdd(add.dataset.add);
      if (id) queueMicrotask(() => panel.querySelector(`input[data-text="${id}"]`)?.focus());
    } else if (rm) controller.ccirRemove(rm.dataset.remove);
    else if (pick) controller.ccirPickStart(pick.dataset.id, pick.dataset.pick);
    else if (clear) controller.ccirSetGeometry(clear.dataset.geoClear, null);
    else if (act === 'close') controller.closeCcirEditor();
    else if (act === 'save') controller.ccirSave();
  });
  panel.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      if (S().ccirEditor.pick) controller.ccirPickCancel();
      else controller.closeCcirEditor();
    }
  });
  store.subscribe(['ccirEditor', 'scenario'], render, { immediate: true });
}

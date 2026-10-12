// Widok: skróty klawiszowe (docs/UI-DESIGN.md §6.1). Tylko tłumaczy klawisze na intencje kontrolera;
// skróty literowe nie działają w polach tekstowych ani przy otwartym omniboksie / odprawie / oknie edycji.
import { staffViewByCode, RESTORE_CODE } from '../domain/staffviews.js';

const TOOL_KEYS = { v: 'select', a: 'arrow', l: 'line', r: 'area', p: 'point', y: 'symbol', g: 'gfx', m: 'measure' };
const DETAIL_KEYS = { 1: null, 2: 'battalion', 3: 'company', 4: 'platoon' };

export function createHotkeysView({ store, controller }) {
  const S = () => store.get();

  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'k') {
      e.preventDefault();
      if (S().omnibox.open) controller.closeOmnibox();
      else controller.openOmnibox();
      return;
    }
    if (S().omnibox.open || S().briefing.open) return;
    if (k === 'Escape') {
      if (S().popover) controller.setPopover(null);
      return;
    }
    const t = e.target;
    const inField = t?.closest?.('input, textarea, select, [contenteditable="true"], dialog[open]');
    if (inField) return;

    if (e.altKey && (e.code === 'Digit1' || e.code === 'Digit2')) {
      e.preventDefault();
      controller.toggleDock(e.code === 'Digit1' ? 'l' : 'r');
      return;
    }
    // Widoki komórek sztabu (T28.1): Shift + 1…4 (S2, S3, S4, ogień), Shift + 0 = moje ustawienia.
    if (e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.code === RESTORE_CODE || staffViewByCode(e.code))) {
      e.preventDefault();
      controller.setStaffView(e.code === RESTORE_CODE ? null : staffViewByCode(e.code).id);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    const key = k.toLowerCase();
    if (k === '/') {
      e.preventDefault();
      if (S().ui.leftCollapsed) controller.setDock('l', false);
      if (S().ui.narrow) controller.setMobile('tree');
      controller.command('treeFilter');
    } else if (key === 'b') controller.openBriefing();
    else if (k === '?') controller.togglePopover('legend');
    else if (key === 'w') controller.togglePopover('layers');
    else if (key === 'd') controller.togglePopover('dos');
    else if (key === 'f') controller.command('fit');
    else if (key === 'o') controller.toggleOrderMode();
    else if (k === ',') controller.prevTurn();
    else if (k === '.') controller.nextTurn();
    else if (TOOL_KEYS[key]) controller.command('tool', TOOL_KEYS[key]);
    else if (k in DETAIL_KEYS) controller.setDetail(DETAIL_KEYS[k]);
  });
}

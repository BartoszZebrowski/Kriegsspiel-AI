// Widok: układ okna — splittery (zmiana rozmiaru paneli, zapis w localStorage), zwijanie dosów do szyny 40 px,
// dolny pasek zakładek na telefonie. Stan zwinięcia docków leży w store.ui (czyta go m.in. kontroler).
// Rozmiary paneli to czysto lokalne preferencje układu: zmienne CSS + klucze `ks.split.<id>`.
import { load, save } from '../lib/storage.js';
import { SPLITTERS, clampSize, maxDockWidth, shouldCollapse, dragValue, keyboardValue, INSPECTOR_MIN_RESERVE } from '../domain/splitter.js';

const PHONE = '(max-width: 760px)';

export function createDocksView({ store, controller, root = document }) {
  const $ = (id) => root.getElementById(id);
  const rootEl = document.documentElement;
  const dockL = $('dock-l');
  const dockR = $('dock-r');

  // Dostęp do wartości każdego splittera: odczyt aktualnego rozmiaru, zapis, granice zależne od okna.
  const ctl = {
    l: {
      get: () => dockL.offsetWidth,
      set: (v) => cssVar('--dock-l', v),
      max: () => maxDockWidth({ max: SPLITTERS.l.max, windowWidth: window.innerWidth, otherWidth: dockR.offsetWidth }),
    },
    r: {
      get: () => dockR.offsetWidth,
      set: (v) => cssVar('--dock-r', v),
      max: () => maxDockWidth({ max: SPLITTERS.r.max, windowWidth: window.innerWidth, otherWidth: dockL.offsetWidth }),
    },
    t: {
      get: () => $('timeline').offsetHeight,
      set: (v) => cssVar('--tl-h', v),
      max: () => SPLITTERS.t.max,
    },
    i: {
      get: () => $('p-tree').offsetHeight,
      set: (v) => {
        const a = $('p-tree');
        const b = $('p-insp');
        a.style.flex = v == null ? '' : `0 0 ${v}px`;
        b.style.flex = v == null ? '' : '1 1 0';
      },
      max: () => dockL.querySelector('.dock-body').offsetHeight - INSPECTOR_MIN_RESERVE,
    },
    c: {
      get: () => $('compose-text').offsetHeight,
      set: (v) => ($('compose-text').style.height = v == null ? '' : v + 'px'),
      max: () => SPLITTERS.c.max,
    },
  };
  // Zmienna CSS ustawiana inline tylko po zmianie przez użytkownika (domyślne wartości i RWD zostają w CSS).
  function cssVar(name, v) {
    if (v == null) rootEl.style.removeProperty(name);
    else rootEl.style.setProperty(name, v + 'px');
  }
  const stored = (k) => {
    const v = load(`ks.split.${k}`, null);
    return Number.isFinite(v) ? v : null;
  };

  // Ustawia rozmiar splittera k (null = domyślny). persist: zapis w localStorage.
  function apply(k, value, persist = false) {
    const cfg = SPLITTERS[k];
    const c = ctl[k];
    if (value == null) {
      c.set(null);
      if (persist) save(`ks.split.${k}`, null);
    } else {
      const v = clampSize(value, { min: cfg.min, max: c.max() });
      c.set(v);
      if (persist) save(`ks.split.${k}`, v);
    }
    const el = $(`sp-${k}`);
    el.setAttribute('aria-valuenow', String(c.get()));
    el.setAttribute('aria-valuemin', String(cfg.min));
    if (cfg.max) el.setAttribute('aria-valuemax', String(cfg.max));
  }

  for (const [k, cfg] of Object.entries(SPLITTERS)) {
    const el = $(`sp-${k}`);
    el.setAttribute('aria-label', cfg.label);
    const saved = stored(k);
    if (saved != null) apply(k, saved);
    else apply(k, null);

    let start = 0;
    let v0 = 0;
    let raw = 0;
    el.addEventListener('pointerdown', (e) => {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // zdarzenie syntetyczne bez aktywnego wskaźnika
      }
      el.classList.add('drag');
      document.body.classList.add('dragging', cfg.axis === 'x' ? 'dx' : 'dy');
      start = cfg.axis === 'x' ? e.clientX : e.clientY;
      v0 = ctl[k].get();
      raw = v0;
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.classList.contains('drag')) return;
      raw = dragValue(v0, (cfg.axis === 'x' ? e.clientX : e.clientY) - start, cfg.inverted);
      apply(k, raw);
    });
    const end = () => {
      if (!el.classList.contains('drag')) return;
      el.classList.remove('drag');
      document.body.classList.remove('dragging', 'dx', 'dy');
      if (cfg.collapse && shouldCollapse(raw, cfg.min)) {
        apply(k, v0, true); // po rozwinięciu wracamy do rozmiaru sprzed zwinięcia
        controller.setDock(k, true);
      } else apply(k, ctl[k].get(), true);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('dblclick', () => apply(k, null, true));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Home') {
        e.preventDefault();
        apply(k, null, true);
        return;
      }
      const next = keyboardValue(e.key, ctl[k].get(), cfg, e.shiftKey);
      if (next === null) return;
      e.preventDefault();
      apply(k, next, true);
    });
  }

  // Po zmianie rozmiaru okna zachowaj minimalną szerokość mapy (przytnij docki).
  window.addEventListener('resize', () => {
    for (const k of ['l', 'r']) if (!document.body.classList.contains(`${k}-collapsed`)) apply(k, ctl[k].get());
    apply('t', ctl.t.get());
  });

  // ---------- zwijanie do szyny ----------
  for (const [id, side] of [['rail-l-tree', 'l'], ['rail-l-insp', 'l'], ['rail-r-msg', 'r']]) {
    $(id).addEventListener('click', () => controller.setDock(side, false));
  }
  store.subscribe(
    'ui',
    ({ ui }) => {
      document.body.classList.toggle('l-collapsed', ui.leftCollapsed);
      document.body.classList.toggle('r-collapsed', ui.rightCollapsed);
      document.body.dataset.m = ui.mobile;
      for (const b of root.querySelectorAll('#tabbar button')) b.classList.toggle('on', b.dataset.m === ui.mobile);
    },
    { immediate: true },
  );
  store.subscribe(
    'unread',
    ({ unread }) => {
      for (const id of ['rail-l-badge', 'rail-r-badge', 'tab-badge']) {
        const b = $(id);
        b.hidden = unread.total === 0;
        b.textContent = unread.total;
      }
      $('cnt-unread').textContent = unread.total ? `${unread.total} ${unread.total === 1 ? 'nowa' : 'nowe'}` : 'brak nowych';
    },
    { immediate: true },
  );

  // ---------- telefon: dolny pasek zakładek ----------
  for (const b of root.querySelectorAll('#tabbar button')) b.addEventListener('click', () => controller.setMobile(b.dataset.m));
  const mq = window.matchMedia(PHONE);
  controller.setNarrow(mq.matches);
  mq.addEventListener?.('change', (e) => controller.setNarrow(e.matches));

  return { apply };
}

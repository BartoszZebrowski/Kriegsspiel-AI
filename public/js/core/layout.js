// Intencje układu: docki, zakładka telefonu, linia komunikatora, animacje, popovery i omnibox. Bez DOM.
// `readIfVisible` — zmiana układu może odsłonić komunikator, więc aktywny kanał trzeba oznaczyć jako przeczytany.
export function createLayout({ store, storage, S, markNoticesSeen, readIfVisible }) {
  const setPopover = (name) => {
    if (S().popover !== (name ?? null)) store.set({ popover: name ?? null });
    if (name === 'bell') markNoticesSeen();
  };
  const togglePopover = (name) => setPopover(S().popover === name ? null : name);
  const openOmnibox = () => store.set({ omnibox: { open: true }, popover: null });
  const closeOmnibox = () => store.set({ omnibox: { open: false } });

  function setDock(side, collapsed) {
    const key = side === 'l' ? 'leftCollapsed' : 'rightCollapsed';
    storage.save(`ks:dock-${side}-collapsed`, collapsed);
    store.set({ ui: { ...S().ui, [key]: collapsed } });
    readIfVisible();
  }
  const toggleDock = (side) => setDock(side, !S().ui[side === 'l' ? 'leftCollapsed' : 'rightCollapsed']);
  function setMobile(pane) {
    store.set({ ui: { ...S().ui, mobile: pane } });
    readIfVisible();
  }
  function setNarrow(narrow) {
    if (S().ui.narrow === narrow) return;
    store.set({ ui: { ...S().ui, narrow } });
    readIfVisible();
  }
  function toggleLeader() {
    const leader = !S().ui.leader;
    storage.save('ks:leader', leader);
    store.set({ ui: { ...S().ui, leader } });
  }

  function setAnimations(on) {
    storage.save('ks:animations', Boolean(on));
    store.set({ ui: { ...S().ui, animations: Boolean(on) } });
  }
  // Systemowe „ogranicz ruch” (matchMedia) zgłasza main.js — także przy zmianie w trakcie pracy.
  function setReducedMotion(reduced) {
    if (S().ui.reducedMotion !== Boolean(reduced)) store.set({ ui: { ...S().ui, reducedMotion: Boolean(reduced) } });
  }

  return { setPopover, togglePopover, openOmnibox, closeOmnibox, setDock, toggleDock, setMobile, setNarrow, toggleLeader, setAnimations, setReducedMotion };
}

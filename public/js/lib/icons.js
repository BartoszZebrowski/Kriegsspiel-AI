// Ikony z sprite'a SVG w index.html (`<symbol id="i-…">`), kreska 1,6 px, kolor z `currentColor`.

// ic('msg') → <svg class="i"><use href="#i-msg"/></svg>; cls: 's' (13 px) lub dowolne klasy.
export const ic = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

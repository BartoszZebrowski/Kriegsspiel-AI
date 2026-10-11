// Rysowanie symboli NATO (milsymbol, ładowany globalnie jako `ms`).
/* global ms, L */

const cache = new Map();

export function symbolSvg(sidc, options = {}) {
  const key = JSON.stringify([sidc, options]);
  if (!cache.has(key)) {
    const sym = new ms.Symbol(sidc, { size: 30, ...options });
    const size = sym.getSize();
    cache.set(key, { svg: sym.asSVG(), width: size.width, height: size.height, anchor: sym.getAnchor() });
  }
  return cache.get(key);
}

export function symbolIcon(sidc, options = {}) {
  const s = symbolSvg(sidc, options);
  return L.divIcon({
    html: s.svg,
    className: 'ms-icon',
    iconSize: [s.width, s.height],
    iconAnchor: [s.anchor.x, s.anchor.y],
  });
}

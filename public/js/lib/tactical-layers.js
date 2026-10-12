// Zamiana opisu znaku taktycznego (wynik `buildGraphic` z domain/tactical.js, współrzędne w pikselach) na warstwy Leaflet.
// Jedna implementacja dla szkiców gracza (views/draw/shapes.js) i podglądu rozkazu graficznego (views/map/order-preview.js).
// `lib/` nie importuje `domain/`, więc `built` dostaje jako dane.
/* global L */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * Zwraca listę warstw Leaflet (kształty i etykiety) dla `built`.
 * `color` — kolor znaku, `toLL(punkt{x,y})` — przeliczenie pikseli warstwy mapy na LatLng.
 */
export function builtLayers(built, color, toLL) {
  const out = [];
  for (const s of built.shapes) {
    if (!s.parts.length) continue;
    const base = { interactive: false, color, weight: s.weight, dashArray: s.dash, lineJoin: 'round' };
    if (s.role === 'fill') out.push(L.polygon(s.parts[0].map(toLL), { interactive: false, stroke: false, fillColor: color, fillOpacity: s.fillOpacity }));
    else if (s.closed) out.push(L.polygon(s.parts.map((p) => [p.map(toLL)]), { ...base, fill: !!s.solid, fillColor: color, fillOpacity: 1 }));
    else out.push(L.polyline(s.parts.map((p) => p.map(toLL)), { ...base, fill: false }));
  }
  for (const lb of built.labels) {
    const html = `<span class="tac-label tac-label--${lb.cls} tac-label--${lb.anchor}" style="color:${color};--a:${lb.angle}deg">${esc(lb.text).replace(/\n/g, '<br>')}</span>`;
    out.push(L.marker(toLL(lb), { icon: L.divIcon({ className: 'tac-lbl', html, iconSize: [0, 0] }), interactive: false, keyboard: false }));
  }
  return out;
}

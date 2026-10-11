// Warstwa podporządkowania: linie przełożony → widoczny podwładny, pod symbolami.
// Magenta z ciemną obwódką — kolor niewystępujący na podkładach (zieleń, drogi, woda, satelita).
/* global L */
import { hierarchyLinks } from '../../domain/orbat.js';

const LINK_STYLE = { color: '#ff2bd6', weight: 2.5, opacity: 0.95, dashArray: '7 5', interactive: false };
const LINK_STYLE_HL = { color: '#ff7ae8', weight: 4, opacity: 1, dashArray: null };
const LINK_CASING = { color: '#1b0016', weight: 5, opacity: 0.55, interactive: false };
const LINK_CASING_HL = { weight: 7, opacity: 0.7 };
// Formacje sąsiadów (nie podlegają graczowi): cienka, szara, przerywana — bez magenty i bez obwódki.
const NEIGHBOUR_STYLE = { color: '#9aa6b5', weight: 1.5, opacity: 0.8, dashArray: '3 5', interactive: false };
const NEIGHBOUR_STYLE_HL = { color: '#c3ccd8', weight: 2, opacity: 1 };
const NEIGHBOUR_CASING = { color: '#000', weight: 0, opacity: 0, interactive: false };

export function createHierarchyLayer(group) {
  let links = []; // { parent, child, line, casing }

  // Wyróżnione: linie wybranej (selectedId) lub wskazanej myszą jednostki — do podwładnych i do przełożonego.
  function style(selectedId, hoveredId) {
    for (const l of links) {
      const hl = [selectedId, hoveredId].some((id) => id && (l.parent === id || l.child === id));
      if (l.neighbour) {
        l.line.setStyle(hl ? { ...NEIGHBOUR_STYLE, ...NEIGHBOUR_STYLE_HL } : NEIGHBOUR_STYLE);
        if (hl) l.line.bringToFront();
        continue;
      }
      l.line.setStyle(hl ? LINK_STYLE_HL : LINK_STYLE);
      l.casing.setStyle(hl ? { ...LINK_CASING, ...LINK_CASING_HL } : LINK_CASING);
      if (hl) {
        l.casing.bringToFront();
        l.line.bringToFront();
      }
    }
  }

  // markers: Map id → L.Marker (końce linii).
  function draw(units, level, markers) {
    group.clearLayers();
    links = hierarchyLinks(units, level).map(({ parent, child, neighbour }) => {
      const ends = [markers.get(parent).getLatLng(), markers.get(child).getLatLng()];
      const casing = L.polyline(ends, neighbour ? NEIGHBOUR_CASING : LINK_CASING);
      const line = L.polyline(ends, neighbour ? NEIGHBOUR_STYLE : LINK_STYLE);
      group.addLayer(casing).addLayer(line);
      return { parent, child, neighbour, line, casing };
    });
  }

  // Linie podążają za symbolami w trakcie animacji przemieszczeń (końce z bieżących położeń markerów).
  function follow(markers) {
    for (const l of links) {
      const ends = [markers.get(l.parent).getLatLng(), markers.get(l.child).getLatLng()];
      l.line.setLatLngs(ends);
      l.casing.setLatLngs(ends);
    }
  }

  return { draw, style, follow };
}

// Warstwa mapy: nakładki od przełożonego (T51). Każda nakładka z `store.overlays` jest rysowana tylko wtedy, gdy włączono
// jej przełącznik (`layers['ov:<id>']`, panel „Warstwy”). Elementy to szkice (te same znaki co w views/draw), ale tylko do
// odczytu: kolory z `color`, znaki przez `buildGraphic` + `builtLayers`, przeliczanie pikseli po zoomie.
/* global L */
import { toLatLng } from '../../domain/geo.js';
import { escapeHtml } from '../../domain/markdown.js';
import { buildGraphic, mainStyle, pointIconSvg } from '../../domain/tactical.js';
import { overlayLayerKey } from '../../domain/overlays.js';
import { builtLayers } from '../../lib/tactical-layers.js';
import { symbolIcon } from '../../lib/symbols.js';

const COLORS = { blue: '#2f7bff', red: '#ff2a2a', black: '#111111' };
const DEFAULT_GRAPHIC = { arrow: 'direction', line: 'line', area: 'generic' };

export function createOverlaysLayer({ store, map }) {
  const S = () => store.get();
  const group = L.layerGroup().addTo(map);

  const toPx = (latlngs) => latlngs.map((ll) => {
    const p = map.latLngToLayerPoint(ll);
    return { x: p.x, y: p.y };
  });
  const toLL = (p) => map.layerPointToLatLng(L.point(p.x, p.y));

  // Warstwy Leaflet jednego elementu nakładki (lista).
  function featureLayers(note) {
    const color = COLORS[note.color] || COLORS.black;
    const enemy = note.color === 'red';
    const g = note.geometry;
    const tip = escapeHtml(note.name);
    if (note.kind === 'point') {
      const m = L.marker(toLatLng(g.coordinates), {
        icon: L.divIcon({ className: 'tac-icon', html: pointIconSvg(note.graphic || 'point', color), iconSize: [28, 28], iconAnchor: [14, 14] }),
        keyboard: false,
      });
      m.bindTooltip(tip, { permanent: true, direction: 'right', offset: [14, 0], className: `note-label note-label--${note.color || 'black'}` });
      return [m];
    }
    if (note.kind === 'symbol') {
      return [L.marker(toLatLng(g.coordinates), { icon: symbolIcon(note.sidc, { size: 26, uniqueDesignation: note.name }), keyboard: false })];
    }
    const graphic = note.graphic || DEFAULT_GRAPHIC[note.kind];
    const st = mainStyle(note.kind, graphic, enemy);
    const latlngs = note.kind === 'area' ? g.coordinates[0].slice(0, -1).map(toLatLng) : g.coordinates.map(toLatLng);
    const main = note.kind === 'area'
      ? L.polygon(latlngs, { interactive: false, color, weight: st.weight, dashArray: st.dash, fillColor: color, fillOpacity: enemy ? 0.06 : 0.12 })
      : L.polyline(latlngs, st.hidden ? { interactive: false, color, weight: st.weight, opacity: 0 } : { interactive: false, color, weight: st.weight, dashArray: st.dash });
    const built = buildGraphic(note.kind, graphic, toPx(latlngs), { enemy, flip: !!note.flip, echelon: note.echelon, name: note.name });
    return [main, ...builtLayers(built, color, toLL)];
  }

  function render() {
    group.clearLayers();
    const { overlays, layers } = S();
    for (const o of overlays) {
      if (!layers[overlayLayerKey(o.id)]) continue;
      for (const f of o.features) for (const l of featureLayers(f)) group.addLayer(l);
    }
  }

  store.subscribe(['overlays', 'layers'], render, { immediate: true });
  map.on('zoomend', render);
  return { render };
}

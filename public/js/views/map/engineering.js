// Warstwa „Zapory i mosty” (T27): obiekty inżynieryjne z `turn.engineering` — pola minowe, linie zapór, przejścia, mosty.
// Znaki taktyczne z domain/tactical.js (buildGraphic + builtLayers), stan pokazuje kreskowanie i etykieta („ZAPORA-1: wykonywane 60%”):
// planowane = cienko i kreskowo, wykonywane = kreskowo, gotowe = linia ciągła. Obiekty przeciwnika (z rozpoznania) na czerwono.
// Własna L.layerGroup, widoczność przełącznikiem `layers.engineering`. Subskrybuje store, nie zna innych widoków.
/* global L */
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng } from '../../domain/geo.js';
import { buildGraphic, mainStyle } from '../../domain/tactical.js';
import { builtLayers } from '../../lib/tactical-layers.js';
import { engineeringItems, engineeringLabel, engineeringTip, engineeringTone, isEnemyWork, KIND_GRAPHICS, OWN_COLOR, ENEMY_COLOR } from '../../domain/engineering.js';

const STATE_STYLE = {
  planned: { dashArray: '2 7', opacity: 0.55, fillOpacity: 0.05 },
  building: { dashArray: '8 6', opacity: 0.85, fillOpacity: 0.1 },
  done: { dashArray: undefined, opacity: 1, fillOpacity: 0.16 },
};
const GLYPH = { minefield: 'M', obstacle: '▲', lane: '⇉', temp_bridge: '⌓', bridge: '≍' };

export function createEngineeringLayer({ store, map }) {
  const group = L.layerGroup().addTo(map);
  const S = () => store.get();

  const toPx = (latlngs) => latlngs.map((ll) => {
    const p = map.latLngToLayerPoint(ll);
    return { x: p.x, y: p.y };
  });
  const toLL = (p) => map.layerPointToLatLng(L.point(p.x, p.y));
  const tipHtml = (x, time) => engineeringTip(x, time).map(escapeHtml).join('<br>');

  function pointLayers(x, color, time) {
    const html = `<span class="eng-mark eng-mark--${engineeringTone(x)}${isEnemyWork(x) ? ' eng-mark--enemy' : ''}" style="--ec:${color}"><span class="eng-mark__g">${GLYPH[x.kind]}</span><span class="eng-mark__lbl">${escapeHtml(engineeringLabel(x))}</span></span>`;
    const icon = L.divIcon({ className: 'eng-icon', html, iconSize: [0, 0] });
    return [L.marker(toLatLng(x.pos), { icon, keyboard: false }).bindTooltip(tipHtml(x, time), { className: 'sym-tip', direction: 'top' })];
  }

  function shapeLayers(x, color, time) {
    const spec = KIND_GRAPHICS[x.kind];
    const enemy = isEnemyWork(x);
    const st = STATE_STYLE[x.state] || STATE_STYLE.planned;
    const ring = spec.kind === 'area' ? x.coords.slice(0, -1) : x.coords;
    const latlngs = ring.map(toLatLng);
    const base = { color, weight: mainStyle(spec.kind, spec.graphic, enemy).weight, dashArray: st.dashArray, opacity: st.opacity };
    const main = spec.kind === 'area'
      ? L.polygon(latlngs, { ...base, fillColor: color, fillOpacity: st.fillOpacity })
      : L.polyline(latlngs, base);
    main.bindTooltip(tipHtml(x, time), { className: 'sym-tip', sticky: true });
    const built = buildGraphic(spec.kind, spec.graphic, toPx(latlngs), { enemy, name: engineeringLabel(x) });
    return [main, ...builtLayers(built, color, toLL)];
  }

  function render() {
    group.clearLayers();
    const { layers, turn } = S();
    if (layers.engineering === false) return;
    for (const x of engineeringItems(turn)) {
      const color = isEnemyWork(x) ? ENEMY_COLOR : OWN_COLOR;
      const layersOf = KIND_GRAPHICS[x.kind].point ? pointLayers(x, color, turn.time) : shapeLayers(x, color, turn.time);
      for (const l of layersOf) group.addLayer(l);
    }
  }

  store.subscribe(['turn', 'layers'], render, { immediate: true });
  map.on('zoomend', render);
  return { group, render };
}

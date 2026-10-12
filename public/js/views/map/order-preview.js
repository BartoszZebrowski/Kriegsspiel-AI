// Warstwa mapy: podgląd niewysłanych rozkazów graficznych (T44) znakiem taktycznym — strzałka, rubież, rejon, punkt —
// razem z cienką przerywaną linią od jednostki do celu. Źródło: załączniki w szkicach wiadomości (store.drafts);
// po wysłaniu szkic znika, więc podgląd też (wysłany załącznik pokazuje się na żądanie z wątku komunikatora).
/* global L */
import { toLatLng } from '../../domain/geo.js';
import { escapeHtml } from '../../domain/markdown.js';
import { buildGraphic, mainStyle, pointIconSvg } from '../../domain/tactical.js';
import { allDraftOrders, orderPreviewNote } from '../../domain/order.js';
import { builtLayers } from '../../lib/tactical-layers.js';

const COLOR = '#2f7bff'; // „własne” jak w szkicach (views/draw/graphics.js)

export function createOrderPreview({ store, map }) {
  const group = L.layerGroup().addTo(map);
  const S = () => store.get();

  const toPx = (latlngs) => latlngs.map((ll) => {
    const p = map.latLngToLayerPoint(ll);
    return { x: p.x, y: p.y };
  });
  const toLL = (p) => map.layerPointToLatLng(L.point(p.x, p.y));
  const anchorOf = (g) => (g.type === 'Point' ? g.coordinates : g.type === 'LineString' ? g.coordinates[0] : g.coordinates[0][0]);

  function drawOrder(order, note, unitsById) {
    const g = note.geometry;
    const tip = `<strong>${escapeHtml(order.name)}</strong><br>projekt rozkazu — do wysłania`;
    if (g.type === 'Point') {
      const m = L.marker(toLatLng(g.coordinates), {
        icon: L.divIcon({ className: 'tac-icon', html: pointIconSvg(note.graphic, COLOR), iconSize: [28, 28], iconAnchor: [14, 14] }),
        keyboard: false,
      });
      m.bindTooltip(tip, { direction: 'right', offset: [14, 0], className: 'sym-tip' });
      group.addLayer(m);
    } else {
      const latlngs = g.type === 'LineString' ? g.coordinates.map(toLatLng) : g.coordinates[0].slice(0, -1).map(toLatLng);
      const st = mainStyle(note.kind, note.graphic, false);
      const main = g.type === 'LineString'
        ? L.polyline(latlngs, st.hidden ? { color: COLOR, weight: st.weight, opacity: 0 } : { color: COLOR, weight: st.weight, dashArray: st.dash })
        : L.polygon(latlngs, { color: COLOR, weight: st.weight, dashArray: st.dash, fillColor: COLOR, fillOpacity: 0.12 });
      main.bindTooltip(tip, { sticky: true, className: 'sym-tip' });
      group.addLayer(main);
      const built = buildGraphic(note.kind, note.graphic, toPx(latlngs), { name: note.name });
      for (const l of builtLayers(built, COLOR, toLL)) group.addLayer(l);
    }
    // Od jednostek do celu: cienka przerywana linia (kto wykona).
    for (const id of order.units) {
      const u = unitsById.get(id);
      if (Array.isArray(u?.pos)) group.addLayer(L.polyline([toLatLng(u.pos), toLatLng(anchorOf(g))], { color: COLOR, weight: 1.5, dashArray: '2 6', opacity: 0.8, interactive: false }));
    }
  }

  // Szkic zmienia się przy każdym znaku wpisanym w wiadomości — przerysowujemy tylko, gdy zmieniły się rozkazy.
  let lastKey = null;
  function render(force = false) {
    const { drafts, archive, turn } = S();
    const key = archive ? '' : JSON.stringify([turn?.turn, allDraftOrders(drafts).map((x) => x.order)]);
    if (force !== true && key === lastKey) return;
    lastKey = key;
    group.clearLayers();
    if (archive) return;
    const unitsById = new Map((turn?.units ?? []).map((u) => [u.id, u]));
    for (const { order } of allDraftOrders(drafts)) {
      const note = orderPreviewNote(order);
      if (note) drawOrder(order, note, unitsById);
    }
  }

  map.on('zoomend', () => render(true)); // dekoracje znaków liczone w pikselach
  store.subscribe(['drafts', 'archive', 'turn'], render, { immediate: true });
  return { render };
}

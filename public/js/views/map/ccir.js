// Warstwa mapy CCIR (T48): nakładka z geometrią pozycji (PIR / FFIR) oraz wskazywanie geometrii dla edytora.
// Rysuje zapisane pozycje (store.ccir), a przy otwartym edytorze jego kopię roboczą (store.ccirEditor.draft).
// Wskazywanie: gdy store.ccirEditor.pick = { id, shape }, kliknięcia na mapie zbierają punkty; wynik trafia do
// controller.ccirSetGeometry (punkt: jedno kliknięcie; linia i rejon: dwuklik lub Enter; Esc anuluje).
/* global L */
import { toLatLng } from '../../domain/geo.js';
import { ccirGeometry } from '../../domain/ccir.js';

const COLORS = { PIR: '#ff9f43', FFIR: '#4cc9f0' };
const GUIDE = '#ffd54a';

export function createCcirLayer({ store, controller, map }) {
  const S = () => store.get();
  const layer = L.layerGroup();
  const guide = L.layerGroup().addTo(map);
  let points = [];
  let cursor = null;

  function latlngs(geometry) {
    if (geometry.type === 'Point') return toLatLng(geometry.coordinates);
    if (geometry.type === 'LineString') return geometry.coordinates.map(toLatLng);
    return geometry.coordinates.map((ring) => ring.map(toLatLng));
  }

  function renderItems() {
    layer.clearLayers();
    const { ccirEditor, ccir, layers } = S();
    // Przy otwartym edytorze warstwa jest widoczna zawsze, inaczej gracz nie zobaczyłby wskazanej geometrii.
    const show = layers.ccir !== false || ccirEditor.open;
    if (show && !map.hasLayer(layer)) layer.addTo(map);
    else if (!show && map.hasLayer(layer)) map.removeLayer(layer);
    const items = ccirEditor.open ? ccirEditor.draft : ccir;
    for (const it of items) {
      if (!it.geometry) continue;
      const color = COLORS[it.kind] ?? GUIDE;
      const ll = latlngs(it.geometry);
      const style = { color, weight: 2.5, dashArray: '8 6', fillColor: color, fillOpacity: 0.08, interactive: false };
      const shape = it.geometry.type === 'Point' ? L.circleMarker(ll, { ...style, radius: 7, dashArray: null, fillOpacity: 0.35 }) : it.geometry.type === 'LineString' ? L.polyline(ll, style) : L.polygon(ll, style);
      shape.bindTooltip(it.id, { permanent: true, direction: 'center', className: 'ccir-label', interactive: false });
      layer.addLayer(shape);
    }
  }

  const pick = () => S().ccirEditor.pick;
  const mapContainer = map.getContainer();

  function renderGuide() {
    guide.clearLayers();
    const p = pick();
    if (!p || !points.length) return;
    const ll = points.map(toLatLng);
    const live = cursor && p.shape !== 'point' ? [...ll, cursor] : ll;
    if (p.shape === 'area' && live.length >= 3) guide.addLayer(L.polygon(live, { color: GUIDE, weight: 2, dashArray: '6 5', fillOpacity: 0.1, interactive: false }));
    else if (live.length >= 2) guide.addLayer(L.polyline(live, { color: GUIDE, weight: 2.5, dashArray: '6 5', interactive: false }));
    for (const x of ll) guide.addLayer(L.circleMarker(x, { radius: 4, color: GUIDE, weight: 2, fillColor: '#111', fillOpacity: 1, interactive: false }));
  }
  const reset = () => {
    points = [];
    cursor = null;
    guide.clearLayers();
  };

  function finish() {
    const p = pick();
    if (!p) return;
    const r = ccirGeometry(p.shape, points);
    if (r.error) return controller.notify(r.error, true);
    reset();
    controller.ccirSetGeometry(p.id, r.geometry);
  }

  map.on('click', (ev) => {
    const p = pick();
    if (!p) return;
    points = [...points, [ev.latlng.lng, ev.latlng.lat]];
    if (p.shape === 'point') finish();
    else renderGuide();
  });
  map.on('dblclick', (ev) => {
    const p = pick();
    if (!p || p.shape === 'point') return;
    L.DomEvent.stop(ev.originalEvent);
    finish();
  });
  map.on('mousemove', (ev) => {
    if (!pick() || !points.length) return;
    cursor = ev.latlng;
    renderGuide();
  });
  document.addEventListener('keydown', (ev) => {
    if (!pick()) return;
    if (ev.key === 'Escape') {
      ev.stopPropagation();
      reset();
      controller.ccirPickCancel();
    } else if (ev.key === 'Enter' && !ev.target?.closest?.('input, textarea, select')) {
      ev.preventDefault();
      finish();
    }
  });

  let wasPicking = false;
  store.subscribe('ccirEditor', () => {
    const p = pick();
    mapContainer.classList.toggle('is-ccir-pick', Boolean(p));
    map.doubleClickZoom[p && p.shape !== 'point' ? 'disable' : 'enable']();
    if (p && !wasPicking) {
      // Wskazywanie wyklucza się z innymi narzędziami mapy (szkic, rozkaz graficzny).
      controller.command('tool', 'select');
      if (S().orderMode) controller.stopOrderMode();
    }
    if (!p) reset();
    else if (!wasPicking) points = [];
    wasPicking = Boolean(p);
    renderItems();
  }, { immediate: true });
  store.subscribe(['ccir', 'layers'], renderItems);

  return { layer };
}

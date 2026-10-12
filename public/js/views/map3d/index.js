// Widok 3D terenu (T43): MapLibre GL JS w pełnoekranowej nakładce, tylko do odczytu.
// Otwiera się, gdy store.view3d.open; zamknięcie (✕, Esc) zgłasza kontrolerowi i wraca do mapy 2D.
// Bez importów z views/map/; dane sceny liczy domain/map3d.js. Biblioteka ładowana leniwie z /vendor/maplibre/.
/* global maplibregl */
import { buildScene, cameraFor, linesToGeoJson, zonesToGeoJson, TERRAIN_TILES, TERRAIN_MAXZOOM, BASE_TILES, BUILDINGS_TILEJSON, ATTRIBUTION_3D } from '../../domain/map3d.js';
import { symbolSvg } from '../../lib/symbols.js';

const LIB_JS = '/vendor/maplibre/maplibre-gl.js';
const LIB_CSS = '/vendor/maplibre/maplibre-gl.css';
let libPromise = null;

function loadLib() {
  if (typeof maplibregl !== 'undefined') return Promise.resolve();
  libPromise ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = LIB_CSS;
    document.head.appendChild(css);
    const js = document.createElement('script');
    js.src = LIB_JS;
    js.onload = () => resolve();
    js.onerror = () => {
      libPromise = null;
      reject(new Error('nie wczytano biblioteki MapLibre'));
    };
    document.head.appendChild(js);
  });
  return libPromise;
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function styleSpec() {
  return {
    version: 8,
    sources: {
      osm: { type: 'raster', tiles: [BASE_TILES], tileSize: 256, maxzoom: 19, attribution: ATTRIBUTION_3D },
      dem: { type: 'raster-dem', tiles: [TERRAIN_TILES], tileSize: 256, maxzoom: TERRAIN_MAXZOOM, encoding: 'terrarium' },
      buildings: { type: 'vector', url: BUILDINGS_TILEJSON },
      lines: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      zones: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#10141a' } },
      { id: 'osm', type: 'raster', source: 'osm', paint: { 'raster-opacity': 0.95 } },
      { id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#0b0f14' } },
      {
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'buildings',
        'source-layer': 'building',
        minzoom: 14,
        paint: {
          'fill-extrusion-color': '#9aa0a6',
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.8,
        },
      },
      { id: 'zones-fill', type: 'fill', source: 'zones', paint: { 'fill-color': '#e8b339', 'fill-opacity': 0.18 } },
      { id: 'zones-line', type: 'line', source: 'zones', paint: { 'line-color': '#e8b339', 'line-width': 2, 'line-dasharray': [3, 2] } },
      { id: 'lines-halo', type: 'line', source: 'lines', paint: { 'line-color': 'rgba(0,0,0,.6)', 'line-width': ['+', ['get', 'width'], 3] } },
      { id: 'lines', type: 'line', source: 'lines', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'] } },
    ],
  };
}

function markerElement(m) {
  const el = document.createElement('div');
  el.className = `m3-marker m3-${m.kind}`;
  el.style.opacity = String(m.opacity ?? 1);
  if (m.sidc) {
    try {
      el.innerHTML = symbolSvg(m.sidc, { size: 28 }).svg;
    } catch {
      el.textContent = '?';
    }
  } else {
    const c = m.color || '#9aa5b1';
    el.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><rect x="1" y="1" width="22" height="22" rx="4" fill="#161b22" stroke="${c}" stroke-width="2"/><path d="M4 15h16M6 15v-4a6 6 0 0 1 12 0v4M12 9v6" fill="none" stroke="${c}" stroke-width="1.6"/></svg>`;
  }
  el.title = [m.name, m.tip].filter(Boolean).join(' — ');
  el.setAttribute('aria-label', m.name || '');
  return el;
}

export function createMap3dView({ store, controller, root = document }) {
  const overlay = root.getElementById('map3d');
  const canvas = root.getElementById('map3d-canvas');
  const msg = root.getElementById('map3d-msg');
  const S = () => store.get();
  let map = null;
  let ready = false;
  let markers = [];
  let session = 0; // numer otwarcia: spóźnione ładowanie po zamknięciu jest ignorowane

  const showMessage = (text) => {
    msg.textContent = text;
    msg.hidden = !text;
  };

  function renderScene() {
    if (!map || !ready) return;
    const { turn, level, layers, scenario } = S();
    const scene = buildScene(turn, { level, layers, turnMinutes: scenario?.turnMinutes });
    map.getSource('lines')?.setData(linesToGeoJson(scene.lines));
    map.getSource('zones')?.setData(zonesToGeoJson(scene.zones));
    for (const mk of markers) mk.remove();
    markers = scene.markers.map((m) => {
      const mk = new maplibregl.Marker({ element: markerElement(m), anchor: 'center' }).setLngLat(m.pos).addTo(map);
      mk.getElement().addEventListener('click', () => controller.selectEntity(m.id, { pan: false }));
      return mk;
    });
  }

  function destroy() {
    for (const mk of markers) mk.remove();
    markers = [];
    ready = false;
    if (map) {
      try {
        map.remove();
      } catch {
        /* biblioteka już posprzątała */
      }
      map = null;
    }
    canvas.textContent = '';
    showMessage('');
  }

  async function open(view) {
    const mine = ++session;
    overlay.classList.add('open');
    showMessage('');
    if (!hasWebGL()) {
      showMessage('Brak WebGL: przeglądarka nie obsługuje grafiki 3D. Zamknij widok i użyj mapy 2D.');
      return;
    }
    try {
      await loadLib();
    } catch (err) {
      if (mine === session) showMessage('Nie udało się wczytać widoku 3D: ' + err.message);
      return;
    }
    if (mine !== session) return;
    const cam = cameraFor(view);
    if (!cam) {
      showMessage('Brak rejonu mapy do pokazania w 3D.');
      return;
    }
    try {
      map = new maplibregl.Map({
        container: canvas,
        style: styleSpec(),
        center: cam.center,
        zoom: 9,
        pitch: cam.pitch,
        bearing: cam.bearing,
        maxPitch: 80,
        attributionControl: { compact: true },
      });
      map.fitBounds(cam.bounds, { padding: 40, pitch: cam.pitch, bearing: cam.bearing, animate: false });
      map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
      map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
      // Błędy kafli (offline, brak danych) nie są błędami aplikacji: widok działa na tym, co się wczytało.
      map.on('error', () => {});
      map.on('load', () => {
        if (mine !== session || !map) return;
        map.setTerrain({ source: 'dem', exaggeration: 1.3 });
        ready = true;
        renderScene();
      });
    } catch (err) {
      destroy();
      showMessage('Nie udało się uruchomić widoku 3D: ' + (err?.message || err));
    }
  }

  function close() {
    session++;
    overlay.classList.remove('open');
    destroy();
  }

  root.getElementById('map3d-close').addEventListener('click', () => controller.close3d());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && overlay.classList.contains('open')) {
      ev.preventDefault();
      controller.close3d();
    }
  });

  store.subscribe('view3d', ({ view3d }) => (view3d.open ? open(view3d.view) : close()), { immediate: true });
  store.subscribe(['turn', 'layers', 'level'], () => renderScene());
  return { isOpen: () => overlay.classList.contains('open') };
}

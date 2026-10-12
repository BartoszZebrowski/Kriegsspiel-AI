// Widok 3D (T43): czyste przekształcenia tury w obiekty sceny 3D (bez DOM i bez biblioteki mapy).
// Scena to zwykłe dane: znaczniki (symbole NATO), linie i strefy; widok `views/map3d/` tylko je rysuje.
import { indexById, isUnitVisible } from './orbat.js';
import { contactFreshness } from './contactage.js';
import { ewZones, ewZoneLabel, EW_ZONE_KIND } from './ewzones.js';
import { logisticsElements, logisticsCard, routeColor, dataAge, LG_SIDC } from './logistics.js';

const isCoord = (c) => Array.isArray(c) && c.length === 2 && c.every(Number.isFinite);

export const LINE_STYLES_3D = {
  boundary: { color: '#f2f2f2', width: 3, dash: null },
  flot: { color: '#3b82f6', width: 3, dash: [2, 2] },
  enemy_flot: { color: '#ef4444', width: 3, dash: [2, 2] },
  phase: { color: '#f2f2f2', width: 2, dash: [4, 2] },
  axis: { color: '#3b82f6', width: 2, dash: [3, 2] },
  enemy_axis: { color: '#ef4444', width: 2, dash: [3, 2] },
};
export const BRIDGE_COLORS_3D = { intact: '#43b581', damaged: '#e8b339', destroyed: '#ef4444' };

// Źródła danych 3D (bez klucza API). Licencje i atrybucja: docs/MAP3D.md.
export const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
export const TERRAIN_MAXZOOM = 15;
export const BASE_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const BUILDINGS_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const ATTRIBUTION_3D = [
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  'Wysokości: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles (AWS)</a> z danych USGS 3DEP, SRTM, GMTED',
  'Budynki: <a href="https://openfreemap.org">OpenFreeMap</a> &copy; OpenMapTiles',
].join(' | ');

/** Wysokość (m) z piksela kafla Terrarium. */
export const terrariumHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** Widok kamery 3D dla prostokąta mapy 2D `bounds` = [zach, płd, wsch, płn]: środek, pochylenie, obrót, a zoom wylicza biblioteka z `bounds`. */
export function cameraFor(view, { pitch = 60, bearing = 0 } = {}) {
  const b = view?.bounds;
  if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return null;
  return { bounds: b, center: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], pitch, bearing };
}

/**
 * Tura → scena 3D.
 * @param {object} turn dane oglądanej tury
 * @param {{ level?: string, layers?: object, turnMinutes?: number }} opts
 * @returns {{ markers: object[], lines: object[], zones: object[] }}
 */
export function buildScene(turn, { level = 'platoon', layers = {}, turnMinutes = 120 } = {}) {
  const scene = { markers: [], lines: [], zones: [] };
  if (!turn) return scene;
  const on = (name) => layers[name] !== false;

  if (on('units')) {
    const byId = indexById(turn.units || []);
    for (const u of turn.units || []) {
      if (!isCoord(u.pos) || !isUnitVisible(u, byId, level)) continue;
      scene.markers.push({ id: u.id, kind: 'unit', name: u.name || u.id, sidc: u.sidc, pos: u.pos, opacity: 1, tip: u.status || '' });
    }
  }
  if (on('contacts')) {
    for (const c of turn.contacts || []) {
      if (!isCoord(c.pos)) continue;
      const fr = contactFreshness(c, turn.time);
      scene.markers.push({ id: c.id, kind: 'contact', name: c.name || c.id, sidc: c.sidc, pos: c.pos, opacity: fr.opacity, tip: fr.text || c.estimate || '' });
    }
  }
  if (on('lines')) {
    for (const z of ewZones(turn.lines, turn.time)) scene.zones.push({ id: z.id, coords: z.coords, label: ewZoneLabel(z) });
    for (const [i, l] of (turn.lines || []).entries()) {
      if (l.kind === EW_ZONE_KIND || !Array.isArray(l.coords) || l.coords.length < 2 || !l.coords.every(isCoord)) continue;
      const st = LINE_STYLES_3D[l.kind] || LINE_STYLES_3D.phase;
      scene.lines.push({ id: l.id || `line-${i}`, kind: l.kind, coords: l.coords, label: l.label || '', ...st });
    }
  }
  if (on('logistics')) {
    const ctx = { turnTime: turn.time, turnMinutes };
    for (const { kind, item } of logisticsElements(turn)) {
      const card = logisticsCard(kind, item, ctx);
      if (kind === 'route') {
        if (!Array.isArray(item.coords) || item.coords.length < 2 || !item.coords.every(isCoord)) continue;
        scene.lines.push({ id: item.id, kind: 'logistics', coords: item.coords, label: card.title, color: routeColor(item.status), width: 4, dash: item.kind === 'ASR' ? [3, 2] : null });
      } else if (isCoord(item.pos)) {
        const stale = item.status === 'destroyed' || dataAge(item.as_of, turn.time, turnMinutes).stale;
        scene.markers.push({
          id: item.id,
          kind: kind === 'bridge' ? 'bridge' : 'logistics',
          name: card.title,
          sidc: LG_SIDC[kind] || null,
          color: kind === 'bridge' ? BRIDGE_COLORS_3D[item.status] || '#9aa5b1' : null,
          pos: item.pos,
          opacity: stale ? 0.6 : 1,
          tip: card.statusLabel || '',
        });
      }
    }
  }
  return scene;
}

/** Linie sceny → FeatureCollection GeoJSON (współrzędne [długość, szerokość]). */
export function linesToGeoJson(lines) {
  return {
    type: 'FeatureCollection',
    features: lines.map((l) => ({
      type: 'Feature',
      properties: { id: l.id, kind: l.kind, color: l.color, width: l.width, label: l.label },
      geometry: { type: 'LineString', coordinates: l.coords },
    })),
  };
}

/** Strefy sceny → FeatureCollection wielokątów (pierścień jest domykany). */
export function zonesToGeoJson(zones) {
  return {
    type: 'FeatureCollection',
    features: zones.map((z) => {
      const ring = z.coords.slice();
      const [a, b] = [ring[0], ring[ring.length - 1]];
      if (a[0] !== b[0] || a[1] !== b[1]) ring.push(a);
      return { type: 'Feature', properties: { id: z.id, label: z.label }, geometry: { type: 'Polygon', coordinates: [ring] } };
    }),
  };
}

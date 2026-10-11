// Obliczenia geometryczne: odległości, czasy marszu, grot strzałki.
import { formatDuration } from './format.js';

const R = 6371.0088; // średni promień Ziemi, km

// Odległość po kole wielkim między [lon, lat] w km.
export function distanceKm([lon1, lat1], [lon2, lat2]) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function pathLengthKm(coords) {
  let sum = 0;
  for (let i = 1; i < coords.length; i++) sum += distanceKm(coords[i - 1], coords[i]);
  return sum;
}

// Prędkości marszu (km/h) po drodze; w terenie — połowa.
export const MARCH_SPEEDS = [
  { id: 'foot', name: 'piesza', road: 4 },
  { id: 'wheeled', name: 'kołowa', road: 30 },
  { id: 'tracked', name: 'gąsienicowa', road: 20 },
];

export function marchMinutes(km, speedKmh) {
  return (km / speedKmh) * 60;
}

export function marchTable(km) {
  return MARCH_SPEEDS.map((s) => ({
    ...s,
    roadMin: marchMinutes(km, s.road),
    offroadMin: marchMinutes(km, s.road / 2),
  }));
}

export function formatKm(km) {
  return km < 10 ? km.toFixed(2).replace('.', ',') + ' km' : km.toFixed(1).replace('.', ',') + ' km';
}

export function formatMarch(minutes) {
  return formatDuration(Math.max(1, Math.round(minutes)));
}

// Grot strzałki w płaskich współrzędnych (np. pikselach): [lewy, czubek, prawy].
export function arrowHead(from, to, length = 16, width = 10) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const bx = to.x - ux * length;
  const by = to.y - uy * length;
  const half = width / 2;
  return [
    { x: bx - uy * half, y: by + ux * half },
    { x: to.x, y: to.y },
    { x: bx + uy * half, y: by - ux * half },
  ];
}

// Przycina odcinek from→to do prostokąta rect {left, top, right, bottom} (linia od kanału do jednostki).
// Zwraca { x, y, clipped }; gdy `to` jest w środku — bez zmian.
export function clipToRect(from, to, rect) {
  const inside = to.x >= rect.left && to.x <= rect.right && to.y >= rect.top && to.y <= rect.bottom;
  if (inside) return { x: to.x, y: to.y, clipped: false };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t = 1;
  if (dx < 0) t = Math.min(t, (rect.left - from.x) / dx);
  if (dx > 0) t = Math.min(t, (rect.right - from.x) / dx);
  if (dy < 0) t = Math.min(t, (rect.top - from.y) / dy);
  if (dy > 0) t = Math.min(t, (rect.bottom - from.y) / dy);
  t = Math.max(0, t);
  return { x: from.x + dx * t, y: from.y + dy * t, clipped: true };
}

// [długość, szerokość] (GeoJSON) → [szerokość, długość] (Leaflet).
export const toLatLng = ([lon, lat]) => [lat, lon];

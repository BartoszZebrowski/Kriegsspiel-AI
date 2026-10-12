// Pośrednik do routera drogowego OSRM (T15): serwer gry pyta publiczny router o trasę po drogach.
// Wysyła WYŁĄCZNIE współrzędne punktów [długość, szerokość]. Limit czasu, pamięć podręczna, wyłącznik (KS_ROUTER=off).
import { StoreError } from './store.js';

export const DEFAULT_BASE = 'https://router.project-osrm.org';
export const MIN_POINTS = 2;
export const MAX_POINTS = 25;

// Poprawne punkty → zaokrąglone do 5 miejsc po przecinku; w przeciwnym razie StoreError 400.
export function normalizePoints(coords) {
  if (!Array.isArray(coords) || coords.length < MIN_POINTS || coords.length > MAX_POINTS) {
    throw new StoreError(400, `Trasa wymaga ${MIN_POINTS}–${MAX_POINTS} punktów`);
  }
  return coords.map((c) => {
    if (!Array.isArray(c) || c.length !== 2 || !c.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      throw new StoreError(400, 'Punkt trasy musi mieć postać [długość, szerokość]');
    }
    const [lon, lat] = c;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new StoreError(400, 'Współrzędne poza zakresem');
    return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
  });
}

export function createRouter({ fetchImpl = globalThis.fetch, baseUrl = DEFAULT_BASE, timeoutMs = 4000, ttlMs = 3600_000, max = 200, disabled = false, now = Date.now } = {}) {
  const cache = new Map(); // klucz → { at, value }

  async function route(coords) {
    const points = normalizePoints(coords);
    if (disabled || typeof fetchImpl !== 'function') throw new StoreError(503, 'Routing wyłączony');
    const key = points.map((p) => p.join(',')).join(';');
    const hit = cache.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;

    const url = `${baseUrl}/route/v1/driving/${key}?overview=full&geometries=geojson&steps=false`;
    let data;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'error', headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (err) {
      throw new StoreError(502, `Router niedostępny: ${err.name === 'TimeoutError' ? 'przekroczono czas' : err.message}`);
    }
    const r = data?.code === 'Ok' ? data.routes?.[0] : null;
    const line = r?.geometry?.coordinates;
    if (!r || !Number.isFinite(r.distance) || !Array.isArray(line) || line.length < 2) {
      throw new StoreError(502, 'Router nie znalazł trasy');
    }
    const value = { source: 'osrm', km: r.distance / 1000, coords: line.map(([lon, lat]) => [lon, lat]) };
    if (cache.size >= max) cache.delete(cache.keys().next().value);
    cache.set(key, { at: now(), value });
    return value;
  }

  return { route, cacheSize: () => cache.size };
}

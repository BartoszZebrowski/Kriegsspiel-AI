// Dzień i noc z czasu i położenia (T30). Czysta logika, algorytm NOAA (równanie czasu i deklinacja), bez zależności.
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
export const SUNRISE_ELEVATION = -0.833; // tarcza słońca na horyzoncie z refrakcją
export const CIVIL_TWILIGHT_ELEVATION = -6; // poniżej: noc

/** Wysokość słońca nad horyzontem (stopnie) w chwili `ms` (UTC) w punkcie lat/lon. */
export function solarElevation(ms, lat, lon) {
  const jd = ms / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;
  const l0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const mr = m * RAD;
  const c = Math.sin(mr) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * mr) * (0.019993 - 0.000101 * t) + Math.sin(3 * mr) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = (l0 + c - 0.00569 - 0.00478 * Math.sin(omega * RAD)) * RAD;
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega * RAD)) * RAD;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const y = Math.tan(eps / 2) ** 2;
  const l0r = l0 * RAD;
  const eqTime = 4 * DEG * (y * Math.sin(2 * l0r) - 2 * e * Math.sin(mr) + 4 * e * y * Math.sin(mr) * Math.cos(2 * l0r) - 0.5 * y * y * Math.sin(4 * l0r) - 1.25 * e * e * Math.sin(2 * mr));
  const utcMin = (((ms % 86400000) + 86400000) % 86400000) / 60000;
  const tst = (((utcMin + eqTime + 4 * lon) % 1440) + 1440) % 1440;
  const ha = (tst / 4 - 180) * RAD;
  const latR = lat * RAD;
  return Math.asin(Math.sin(latR) * Math.sin(decl) + Math.cos(latR) * Math.cos(decl) * Math.cos(ha)) * DEG;
}

function crossing(lo, hi, lat, lon, level) {
  const rising = solarElevation(hi, lat, lon) > solarElevation(lo, lat, lon);
  if ((solarElevation(lo, lat, lon) - level) * (solarElevation(hi, lat, lon) - level) > 0) return null;
  let a = lo, b = hi;
  for (let i = 0; i < 40; i++) {
    const mid = (a + b) / 2;
    const above = solarElevation(mid, lat, lon) > level;
    if (above === rising) b = mid; else a = mid;
  }
  return Math.round((a + b) / 2);
}

/** Wschód i zachód słońca (ms UTC) tej doby słonecznej, w której leży `ms`; null przy dniu/nocy polarnej. */
export function sunTimes(ms, lat, lon, level = SUNRISE_ELEVATION) {
  const offset = (lon / 15) * 3600000;
  const noon = Math.floor((ms + offset) / 86400000) * 86400000 - offset + 43200000;
  return { sunrise: crossing(noon - 43200000, noon, lat, lon, level), sunset: crossing(noon, noon + 43200000, lat, lon, level) };
}

/** 'day' | 'twilight' | 'night' (pozycja [lon, lat], czas ISO). Brak danych → 'day'. */
export function dayPhase(iso, pos) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !Array.isArray(pos) || pos.length < 2 || !pos.every(Number.isFinite)) return 'day';
  const el = solarElevation(ms, pos[1], pos[0]);
  if (el > SUNRISE_ELEVATION) return 'day';
  return el > CIVIL_TWILIGHT_ELEVATION ? 'twilight' : 'night';
}

export const isNightPhase = (phase) => phase === 'night';
export const PHASE_LABELS = { day: 'dzień', twilight: 'zmierzch / świt', night: 'noc' };

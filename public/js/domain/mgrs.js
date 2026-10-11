// Współrzędne: WGS84 → UTM → MGRS oraz zapis stopnie/minuty/sekundy (czyste funkcje).
const A = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const BANDS = 'CDEFGHJKLMNPQRSTUVWX';
const COL_SETS = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'];
const ROWS = 'ABCDEFGHJKLMNPQRSTUV';

const rad = (d) => (d * Math.PI) / 180;

// Zwraca { zone, band, easting, northing } albo null poza zakresem (80°S–84°N).
export function toUtm(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -80 || lat > 84) return null;
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32; // Norwegia
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  const lam0 = rad((zone - 1) * 6 - 180 + 3);
  const phi = rad(lat);
  const lam = rad(lon) - lam0;
  const n = F / (2 - F);
  const Ahat = (A / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const alpha = [n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16, (13 * n ** 2) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240];
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xi0 = Math.atan2(t, Math.cos(lam));
  const eta0 = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
  let xi = xi0;
  let eta = eta0;
  alpha.forEach((a, i) => {
    const j = 2 * (i + 1);
    xi += a * Math.sin(j * xi0) * Math.cosh(j * eta0);
    eta += a * Math.cos(j * xi0) * Math.sinh(j * eta0);
  });
  const easting = 500000 + K0 * Ahat * eta;
  let northing = K0 * Ahat * xi;
  if (lat < 0) northing += 10000000;
  const band = BANDS[Math.min(19, Math.floor((lat + 80) / 8))];
  return { zone, band, easting, northing };
}

// MGRS (domyślnie z dokładnością do 1 m: 5 cyfr) — „34U FE 12345 67890”; null poza zakresem.
export function toMgrs(lat, lon, precision = 5) {
  const u = toUtm(lat, lon);
  if (!u) return null;
  const col = COL_SETS[(u.zone - 1) % 3][Math.floor(u.easting / 100000) - 1];
  const rowOffset = u.zone % 2 === 0 ? 5 : 0;
  const row = ROWS[(Math.floor(u.northing / 100000) + rowOffset) % 20];
  if (!col) return null;
  const div = 10 ** (5 - precision);
  const e = String(Math.floor((u.easting % 100000) / div)).padStart(precision, '0');
  const n = String(Math.floor((u.northing % 100000) / div)).padStart(precision, '0');
  return `${u.zone}${u.band} ${col}${row} ${e} ${n}`;
}

// MGRS z pozycji gry [długość, szerokość].
export const mgrsOf = (pos, precision = 5) => (Array.isArray(pos) ? toMgrs(pos[1], pos[0], precision) : null);

// Stopnie dziesiętne: „54.1500°N 22.9500°E”
export function formatLatLon(lat, lon, digits = 4) {
  return `${Math.abs(lat).toFixed(digits)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(digits)}°${lon >= 0 ? 'E' : 'W'}`;
}

// Stopnie/minuty/sekundy: „54°06′42″N 22°56′03″E”
export function formatDms(pos) {
  if (!Array.isArray(pos)) return '—';
  const one = (v, plus, minus) => {
    const s = v < 0 ? minus : plus;
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.floor((a - d) * 60);
    let sec = Math.round(((a - d) * 60 - m) * 60);
    if (sec === 60) {
      sec = 0;
      m += 1;
    }
    if (m === 60) {
      m = 0;
      d += 1;
    }
    return `${d}°${String(m).padStart(2, '0')}′${String(sec).padStart(2, '0')}″${s}`;
  };
  return `${one(pos[1], 'N', 'S')} ${one(pos[0], 'E', 'W')}`;
}

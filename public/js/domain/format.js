// Formatowanie czasu gry. Zawsze w strefie scenariusza, niezależnie od strefy komputera.

export const DEFAULT_TZ = 'Europe/Warsaw';

function parts(date, timeZone, options) {
  const fmt = new Intl.DateTimeFormat('pl-PL', { timeZone, ...options });
  return Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
}

// „czw. 14.05.2026, 08:00”
export function formatGameTime(iso, timeZone = DEFAULT_TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, timeZone, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const weekday = p.weekday.endsWith('.') ? p.weekday : p.weekday + '.';
  return `${weekday} ${p.day}.${p.month}.${p.year}, ${p.hour}:${p.minute}`;
}

// „08:00”
export function formatClock(iso, timeZone = DEFAULT_TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, timeZone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${p.hour}:${p.minute}`;
}

export function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

// „2 h”, „90 min” → „1 h 30 min”
export function formatDuration(minutes) {
  const m = Math.round(minutes);
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const min = m % 60;
  const out = [];
  if (d) out.push(`${d} d`);
  if (h) out.push(`${h} h`);
  if (min || out.length === 0) out.push(`${min} min`);
  return out.join(' ');
}

// Wiek informacji: „1 h 38 min temu”
export function formatAge(observedIso, nowIso) {
  const diff = (new Date(nowIso).getTime() - new Date(observedIso).getTime()) / 60000;
  if (Number.isNaN(diff)) return '—';
  if (diff < 0) return 'z przyszłości?';
  if (diff < 1) return 'przed chwilą';
  return formatDuration(Math.floor(diff)) + ' temu';
}

// Wiek informacji w minutach (ujemny → 0).
export function ageMinutes(observedIso, nowIso) {
  const diff = (new Date(nowIso).getTime() - new Date(observedIso).getTime()) / 60000;
  return Number.isNaN(diff) ? null : Math.max(0, Math.floor(diff));
}

// Wiek zwięźle: „25 min”, „1 h 38 min”, „2 d 3 h”.
export function formatAgeShort(minutes) {
  if (minutes === null || minutes === undefined) return '—';
  if (minutes < 1) return '0 min';
  return formatDuration(minutes);
}

const MONTHS_DTG = ['STY', 'LUT', 'MAR', 'KWI', 'MAJ', 'CZE', 'LIP', 'SIE', 'WRZ', 'PAŹ', 'LIS', 'GRU'];
const WEEKDAYS = ['NDZ', 'PON', 'WT', 'ŚR', 'CZW', 'PT', 'SOB'];

// Przesunięcie strefy w minutach względem UTC w danej chwili.
function zoneOffsetMinutes(date, timeZone) {
  const p = parts(date, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// Litera strefy czasowej NATO: Z = UTC, A = +1 … I = +9 (bez J), K = +10 … M = +12, N = -1 … Y = -12.
export function natoZoneLetter(offsetMinutes) {
  const h = Math.round(offsetMinutes / 60);
  if (h === 0) return 'Z';
  if (h > 0 && h <= 9) return 'ABCDEFGHI'[h - 1];
  if (h >= 10 && h <= 12) return 'KLM'[h - 10];
  if (h < 0 && h >= -12) return 'NOPQRSTUVWXY'[-h - 1];
  return 'Z';
}

// Grupa data-czas (DTG) w strefie scenariusza: „141000B MAJ 26”.
export function formatDtg(iso, timeZone = DEFAULT_TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const letter = natoZoneLetter(zoneOffsetMinutes(d, timeZone));
  return `${p.day}${p.hour}${p.minute}${letter} ${MONTHS_DTG[+p.month - 1]} ${p.year.slice(-2)}`;
}

// DTG bez miesiąca i roku — do kart wiadomości: „140940B”.
export function formatDtgShort(iso, timeZone = DEFAULT_TZ) {
  const full = formatDtg(iso, timeZone);
  return full === '—' ? full : full.split(' ')[0];
}

// „CZW 14.05 · 10:00”
export function formatDayClock(iso, timeZone = DEFAULT_TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const p = parts(d, timeZone, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const wd = WEEKDAYS[new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay()];
  return `${wd} ${p.day}.${p.month} · ${p.hour}:${p.minute}`;
}

// Klucz dnia „2026-05-14” w strefie scenariusza (separatory dni w komunikatorze).
export function dayKey(iso, timeZone = DEFAULT_TZ) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = parts(d, timeZone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${p.year}-${p.month}-${p.day}`;
}

// „czw. 14.05.2026”
export function formatDay(iso, timeZone = DEFAULT_TZ) {
  const s = formatGameTime(iso, timeZone);
  return s === '—' ? s : s.split(',')[0];
}

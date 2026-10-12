// Pogoda w kliencie (T30): opis do zegara i karty, werdykt lotu BSP, wpływ na marsz. Czysta logika bez DOM.
// Listy kategorii lustrzane do shared/weather.js (domain/ nie importuje spoza domain/).
import { escapeHtml } from './markdown.js';
import { dayPhase, PHASE_LABELS } from './daylight.js';

export const WEATHER_PRECIP = ['brak', 'mżawka', 'deszcz', 'ulewa', 'śnieg'];
export const WEATHER_FOG = ['brak', 'lekka', 'gęsta'];
export const WEATHER_WIND = ['słaby', 'umiarkowany', 'silny'];
export const COLD_BELOW_C = -5; // zimą poniżej tej temperatury rośnie zużycie wytrzymałości (reguła sędziego, tu tylko ostrzeżenie)

const PRECIP_ICON = { mżawka: '🌦', deszcz: '🌧', ulewa: '⛈', śnieg: '❄' };

/** Opis pogody: { icon, label, tone: ok|warn|bad, details[] }. Brak pogody → null. */
export function weatherInfo(w) {
  if (!w || typeof w !== 'object') return null;
  const precip = w.precip && w.precip !== 'brak' ? w.precip : null;
  const fog = w.fog && w.fog !== 'brak' ? w.fog : null;
  const wind = w.wind === 'silny' || w.wind === 'umiarkowany' ? w.wind : null;
  const icon = precip ? PRECIP_ICON[precip] || '🌧' : fog ? '🌫' : w.wind === 'silny' ? '💨' : '☀';
  const details = [];
  if (precip) details.push(precip);
  if (fog) details.push(`mgła ${fog}`);
  if (wind) details.push(`wiatr ${wind}`);
  if (Number.isFinite(w.temp_c)) details.push(`${w.temp_c} °C`);
  if (Number.isFinite(w.visibility_km)) details.push(`widzialność ${w.visibility_km} km`);
  const bad = precip === 'ulewa' || fog === 'gęsta' || w.wind === 'silny' || (Number.isFinite(w.visibility_km) && w.visibility_km < 1);
  const warn = precip || fog || w.wind === 'umiarkowany' || (Number.isFinite(w.temp_c) && w.temp_c < COLD_BELOW_C) || (Number.isFinite(w.visibility_km) && w.visibility_km < 4);
  return { icon, label: String(w.text || ''), tone: bad ? 'bad' : warn ? 'warn' : 'ok', details };
}

/** Czy BSP może latać: { ok, reason }. Reguła orientacyjna; ostateczną decyzję o locie podaje sędzia w meldunku. */
export function droneFlightVerdict(w) {
  if (!w) return { ok: true, reason: '' };
  if (w.wind === 'silny') return { ok: false, reason: 'silny wiatr' };
  if (w.precip === 'ulewa' || w.precip === 'śnieg') return { ok: false, reason: w.precip === 'śnieg' ? 'opady śniegu' : 'ulewa' };
  if (w.fog === 'gęsta' || (Number.isFinite(w.visibility_km) && w.visibility_km < 1)) return { ok: false, reason: 'gęsta mgła, widzialność poniżej 1 km' };
  const limited = [];
  if (w.precip === 'deszcz' || w.precip === 'mżawka') limited.push('opad');
  if (w.wind === 'umiarkowany') limited.push('wiatr');
  if (w.fog === 'lekka') limited.push('mgła');
  return { ok: true, reason: limited.length ? `ograniczona skuteczność (${limited.join(', ')})` : '' };
}

/** Mnożnik prędkości poza drogami i na drogach gruntowych (rozmokły teren po opadzie); 1 = bez zmian. */
export function groundSpeedFactor(w) {
  if (!w) return 1;
  if (w.precip === 'ulewa' || w.precip === 'śnieg') return 0.7;
  if (w.precip === 'deszcz') return 0.85;
  return 1;
}

/** Opis do podpowiedzi zegara: pogoda + faza doby. */
export function weatherSummaryText(w, phase) {
  const info = weatherInfo(w);
  const day = `Pora doby: ${PHASE_LABELS[phase] || PHASE_LABELS.day}`;
  if (!info) return day;
  return `${info.label}${info.details.length ? ` (${info.details.join(', ')})` : ''}. ${day}.${w.forecast ? ` Prognoza: ${w.forecast}` : ''}`;
}

/** Fragment HTML do karty tury / środka: pogoda i werdykt lotu. */
export function weatherBlockHtml(w, iso, pos) {
  const info = weatherInfo(w);
  const phase = dayPhase(iso, pos);
  const e = escapeHtml;
  const rows = [`<div class="kvr"><span>Pora doby</span><span>${e(PHASE_LABELS[phase])}</span></div>`];
  if (info) {
    rows.push(`<div class="kvr"><span>Pogoda</span><span>${e(info.icon)} ${e(info.label)}</span></div>`);
    if (info.details.length) rows.push(`<div class="kvr"><span>Warunki</span><span>${e(info.details.join(', '))}</span></div>`);
    if (w.forecast) rows.push(`<div class="kvr"><span>Prognoza</span><span>${e(w.forecast)}</span></div>`);
  }
  return `<div class="kv" data-weather><div class="cap">Pogoda i pora doby</div>${rows.join('')}</div>`;
}

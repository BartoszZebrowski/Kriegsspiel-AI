// Karta tury (T30 pkt 4, T31): DTG, dzień kampanii, pora doby, wschód i zachód słońca, pogoda i prognoza. Czysta logika (HTML jako tekst).
import { escapeHtml as e } from './markdown.js';
import { formatDtg, formatClock, formatDuration } from './format.js';
import { sunTimes } from './daylight.js';
import { dayOf } from './campaign.js';
import { weatherBlockHtml } from './weather.js';

const kv = (label, value) => `<div class="kvr"><span>${e(label)}</span><span>${e(value)}</span></div>`;

/** Wschód i zachód słońca doby czasu `iso` w strefie `tz` ("04:41"/"20:12") albo null (brak położenia lub dzień polarny). */
export function sunLabels(iso, pos, tz) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || !Array.isArray(pos) || pos.length < 2) return null;
  const { sunrise, sunset } = sunTimes(ms, pos[1], pos[0]);
  if (sunrise == null || sunset == null) return null;
  return { sunrise: formatClock(new Date(sunrise).toISOString(), tz), sunset: formatClock(new Date(sunset).toISOString(), tz) };
}

/** HTML karty tury: { turn, scenario, durationMin? } → nagłówek + dane tury + blok pogody. */
export function turnCardHtml({ turn, scenario, durationMin }) {
  if (!turn) return '';
  const tz = scenario?.timezone;
  const pos = scenario?.map?.center;
  const day = dayOf(turn.time, scenario);
  const sun = sunLabels(turn.time, pos, tz);
  const rows = [kv('DTG', formatDtg(turn.time, tz))];
  if (day) rows.push(kv('Dzień', `${day.id}${day.title ? ` — ${day.title}` : ''}`));
  if (durationMin > 0) rows.push(kv('Okres tury', formatDuration(durationMin)));
  if (sun) rows.push(kv('Słońce', `wschód ${sun.sunrise}, zachód ${sun.sunset}`));
  const head = `<div class="insp-top"><div class="insp-info"><div class="insp-title">Tura ${e(turn.turn)}</div><div class="insp-sub">Karta tury${day ? ` · ${e(day.id)}` : ''}</div></div></div>`;
  return `${head}<div class="kv" data-turncard><div class="cap">Czas</div>${rows.join('')}</div>${weatherBlockHtml(turn.weather, turn.time, pos)}`;
}

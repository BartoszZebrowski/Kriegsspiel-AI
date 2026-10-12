// Oś czasu kampanii w kliencie (T31): czasy tur o zmiennej długości i dni bojowe (D+0…). Czysta logika bez DOM.
// Reguły lustrzane do shared/campaign.js (domain/ nie importuje spoza domain/).

/**
 * Oś tur: `entries` = [{ turn, time, duration_min? }] z serwera (znane tury). Wynik: [{ turn, time, ms, offsetMin, durationMin }],
 * znane tury plus `ahead` przyszłych (długość = ostatnia znana lub turnMinutes). `offsetMin` liczony od czasu tury 0.
 */
export function buildSchedule(scenario, entries = [], ahead = 0) {
  const base = scenario?.turnMinutes > 0 ? scenario.turnMinutes : 120;
  const sorted = [...entries].filter((e) => Number.isFinite(Date.parse(e?.time))).sort((a, b) => a.turn - b.turn);
  const t0 = sorted.length ? Date.parse(sorted[0].time) : Date.parse(scenario?.start);
  const out = [];
  const push = (turn, ms, dur) => out.push({ turn, ms, time: new Date(ms).toISOString(), offsetMin: Number.isFinite(t0) ? (ms - t0) / 60000 : 0, durationMin: dur });
  for (const e of sorted) push(e.turn, Date.parse(e.time), e.duration_min > 0 ? e.duration_min : base);
  if (!out.length && Number.isFinite(t0)) push(0, t0, base);
  for (let i = 0; i < ahead && out.length; i++) {
    const last = out[out.length - 1];
    push(last.turn + 1, last.ms + last.durationMin * 60000, base);
  }
  return out;
}

/** Długość okresu otwieranego przez turę (z surowej listy `schedule` ze store: [{ turn, time, duration_min? }]). */
export function turnDurationMin(scenario, entries, turn) {
  const d = (entries || []).find((e) => e.turn === turn)?.duration_min;
  return d > 0 ? d : scenario?.turnMinutes;
}

/** Czas tury (ISO): z listy `schedule`, a dla nieznanej tury start + N × turnMinutes (scenariusz bez zmiennej długości). */
export function turnTimeIso(scenario, entries, turn) {
  const t = (entries || []).find((e) => e.turn === turn)?.time;
  return t || new Date(Date.parse(scenario?.start) + turn * (scenario?.turnMinutes || 0) * 60000).toISOString();
}

/** Długość okresu, który kończy się w turze `turn` (czyli długość poprzedniej tury). */
export const previousPeriodMin = (scenario, entries, turn) => turnDurationMin(scenario, entries, turn - 1);

/** Dzień kampanii dla czasu: { id: 'D+1', index, title } albo null (bez `phases` albo przed pierwszą fazą). */
export function dayOf(iso, scenario) {
  const phases = scenario?.phases;
  const t = Date.parse(iso);
  if (!Array.isArray(phases) || !phases.length || !Number.isFinite(t)) return null;
  let found = -1;
  for (const [i, p] of phases.entries()) if (Date.parse(p.start) <= t) found = i;
  return found < 0 ? null : { id: phases[found].id, index: found, title: phases[found].title || '' };
}

/** Czy `iso` jest w innym dniu kampanii niż `prevIso` (nowy dzień bojowy). */
export function isNewDay(prevIso, iso, scenario) {
  const a = dayOf(prevIso, scenario);
  const b = dayOf(iso, scenario);
  return Boolean(b && (!a || a.index !== b.index));
}

/** Początki dni na osi: [{ id, title, offsetMin }] (offset względem czasu tury 0 z osi). Pomija dni przed osią. */
export function dayStarts(scenario, schedule) {
  const phases = scenario?.phases;
  if (!Array.isArray(phases) || !schedule.length) return [];
  const t0 = schedule[0].ms - schedule[0].offsetMin * 60000;
  return phases.map((p) => ({ id: p.id, title: p.title || '', offsetMin: (Date.parse(p.start) - t0) / 60000 })).filter((d) => Number.isFinite(d.offsetMin) && d.offsetMin >= 0);
}

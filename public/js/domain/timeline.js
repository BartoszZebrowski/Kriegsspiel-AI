// Oś czasu tur: pozycje węzłów i ścieżek zdarzeń (czyste funkcje, bez DOM).
import { groupReports } from './ccir.js';

export const MIN_TICKS = 13; // makieta: T0…T12
export const FUTURE_TICKS = 6; // ile tur „przyszłych” pokazać za bieżącą

const minutesBetween = (aIso, bIso) => (new Date(bIso).getTime() - new Date(aIso).getTime()) / 60000;

// Liczba węzłów na osi.
export function tickCount(currentTurn) {
  return Math.max(MIN_TICKS, currentTurn + FUTURE_TICKS + 1);
}

// Ilu etykiet godzin nie nakładać: co ile węzłów pokazać godzinę, zależnie od szerokości osi (px).
export function hourStep(axisWidth) {
  if (axisWidth < 420) return 4;
  if (axisWidth < 560) return 3;
  return 2;
}

// Czy pokazywać etykietę „T#” przy węźle i; przy wąskiej osi co drugą, przy bardzo wąskiej wcale.
export function showTurnLabel(i, axisWidth) {
  if (axisWidth < 290) return false;
  if (axisWidth < 420) return i % 2 === 0;
  return true;
}

// Wysokość osi < 80 px: znikają ścieżki zdarzeń (zostają węzły tur).
export const lanesVisible = (height) => height >= 80;

// Budowa osi. Wejście: { turns, currentTurn, viewTurn, start (ISO), turnMinutes, messages, contacts }.
// Wynik: { ticks, lanes: { msgs, ords, cons }, playheadPct, pastPct, futurePct, archive }.
export function buildTimeline({ turns = [], currentTurn = 0, viewTurn = 0, start, turnMinutes = 120, messages = [], contacts = [] }) {
  const count = tickCount(currentTurn);
  const span = (count - 1) * turnMinutes || 1;
  const pct = (m) => Math.max(0, Math.min(100, (m / span) * 100));
  const archive = viewTurn !== currentTurn;
  const ticks = [];
  for (let i = 0; i < count; i++) {
    let state = 'fut';
    if (i === currentTurn) state = 'cur';
    else if (i < currentTurn) state = 'past';
    // Dostępna do obejrzenia = istnieje plik tury (klikalna).
    const clickable = turns.includes(i);
    ticks.push({ turn: i, minutes: i * turnMinutes, pct: pct(i * turnMinutes), state, view: archive && i === viewTurn, clickable });
  }
  const playheadMin = viewTurn * turnMinutes;
  const toMin = (iso) => (start && iso ? minutesBetween(start, iso) : null);
  const lane = (items) => items.filter((x) => x.min !== null).map((x) => ({ pct: pct(x.min), urgent: Boolean(x.urgent), late: x.min > playheadMin + 0.01, ...(x.report ? { report: x.report, count: x.count } : {}) }));
  const isOrder = (m) => m.direction === 'out' && (m.type === 'rozkaz' || m.type === 'zarzadzenie');
  const lanes = {
    // Meldunki cykliczne (SITREP, LOGSTAT) z jednej tury i rodzaju zlewają się w jeden znacznik (T48).
    msgs: lane([
      ...messages.filter((m) => !isOrder(m) && !(m.report && m.direction === 'in')).map((m) => ({ min: toMin(m.time), urgent: m.priority === 'urgent' })),
      ...groupReports(messages).map((g) => ({ min: toMin(g.time), report: g.report, count: g.count })),
    ]),
    ords: lane(messages.filter(isOrder).map((m) => ({ min: toMin(m.time), urgent: m.priority === 'urgent' }))),
    cons: lane(contacts.map((c) => ({ min: toMin(c.observed) }))),
  };
  return {
    ticks,
    lanes,
    archive,
    playheadPct: pct(playheadMin),
    pastPct: pct(currentTurn * turnMinutes),
    futurePct: pct(currentTurn * turnMinutes),
  };
}

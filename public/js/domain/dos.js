// DOS jednostek (T18): progi kolorów, najgorszy wskaźnik, agregacja minimum z podwładnych, wiersze panelu zbiorczego.
// Czyste funkcje. `dos` = meldowany stan {fuel, ammo, general (dni zaopatrzenia), readiness (0–1), as_of} — to meldunek, nie prawda.
import { ageMinutes } from './format.js';
import { isNeighbourUnit, indexById } from './orbat.js';

const DOS_KEYS = ['fuel', 'ammo', 'general']; // jak shared/schema.js DOS_KEYS

export const DOS_LABELS = { fuel: 'Paliwo', ammo: 'Amunicja', general: 'Ogólne', readiness: 'Sprawność' };
export const DOS_KINDS = [...DOS_KEYS, 'readiness'];
// Progi poziomów: [dolna granica „ok”, dolna granica „warn”] — poniżej drugiej „bad”.
export const DOS_THRESHOLDS = { days: [2, 1], readiness: [0.8, 0.5] };
// Meldunek starszy niż tyle minut jest oznaczany jako przestarzały.
export const DOS_STALE_MIN = 180;
const LEVEL_RANK = { ok: 0, warn: 1, bad: 2 };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Poziom wskaźnika: 'ok' (zielony) | 'warn' (żółty) | 'bad' (czerwony); null, gdy brak wartości.
export function dosLevel(kind, value) {
  if (!isNum(value)) return null;
  const [ok, warn] = kind === 'readiness' ? DOS_THRESHOLDS.readiness : DOS_THRESHOLDS.days;
  return value >= ok ? 'ok' : value >= warn ? 'warn' : 'bad';
}

// Wartość znormalizowana do progu „ok” (1,0 = dokładnie próg zielony); mniejsza = gorsza. Do porównań różnych wskaźników.
export function dosScore(kind, value) {
  if (!isNum(value)) return null;
  return value / (kind === 'readiness' ? DOS_THRESHOLDS.readiness[0] : DOS_THRESHOLDS.days[0]);
}

// Lista wskaźników obecnych w `dos`: [{kind, label, value, level, score}] w kolejności paliwo, amunicja, ogólne, sprawność.
export function dosIndicators(dos) {
  if (!dos) return [];
  return DOS_KINDS.filter((k) => isNum(dos[k])).map((k) => ({ kind: k, label: DOS_LABELS[k], value: dos[k], level: dosLevel(k, dos[k]), score: dosScore(k, dos[k]) }));
}

// Najgorszy wskaźnik (najniższy score) albo null.
export function worstIndicator(dos) {
  let worst = null;
  for (const ind of dosIndicators(dos)) if (!worst || ind.score < worst.score) worst = ind;
  return worst;
}

// Wiek meldunku w minutach względem czasu tury (null, gdy brak `as_of`).
export function dosAgeMin(dos, turnTime) {
  return dos?.as_of && turnTime ? ageMinutes(dos.as_of, turnTime) : null;
}
export const isDosStale = (dos, turnTime) => {
  const a = dosAgeMin(dos, turnTime);
  return a !== null && a > DOS_STALE_MIN;
};

function mergeMin(list) {
  const out = {};
  for (const k of DOS_KINDS) {
    const vals = list.map((d) => d[k]).filter(isNum);
    if (vals.length) out[k] = Math.min(...vals);
  }
  const times = list.map((d) => d.as_of).filter(Boolean);
  if (times.length) out.as_of = times.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)); // najstarszy meldunek
  return Object.keys(out).some((k) => k !== 'as_of') ? out : null;
}

// DOS jednostki: własny (derived=false) albo minimum z podwładnych po `parent`, rekurencyjnie (derived=true);
// null, gdy brak danych w całym poddrzewie. Jednostki formacji sąsiada nie wchodzą do agregacji.
export function resolveDos(unit, units) {
  const kids = new Map();
  for (const u of units || []) {
    const p = u.parent;
    if (p) (kids.get(p) || kids.set(p, []).get(p)).push(u);
  }
  const walk = (u, seen) => {
    if (u.dos) return { dos: u.dos, derived: false };
    if (seen.has(u.id)) return null;
    seen.add(u.id);
    const parts = (kids.get(u.id) || []).map((c) => walk(c, seen)).filter(Boolean).map((r) => r.dos);
    const dos = parts.length ? mergeMin(parts) : null;
    return dos ? { dos, derived: true } : null;
  };
  return walk(unit, new Set());
}

// Wiersze panelu zbiorczego: jednostki własne (bez sąsiadów), najgorsze na górze; bez danych na końcu.
// Wiersz: {unit, dos, derived, worst, level, ageMin, stale}.
export function dosRows(units, turnTime) {
  const byId = indexById(units || []);
  const rows = [];
  for (const unit of units || []) {
    if (isNeighbourUnit(unit, byId)) continue;
    const r = resolveDos(unit, units);
    const worst = r ? worstIndicator(r.dos) : null;
    rows.push({ unit, dos: r?.dos ?? null, derived: !!r?.derived, worst, level: worst?.level ?? null, ageMin: r ? dosAgeMin(r.dos, turnTime) : null, stale: r ? isDosStale(r.dos, turnTime) : false });
  }
  return sortDosRows(rows);
}

export function sortDosRows(rows) {
  return [...rows].sort((a, b) => {
    if (!a.worst !== !b.worst) return a.worst ? -1 : 1;
    if (a.worst && a.worst.score !== b.worst.score) return a.worst.score - b.worst.score;
    return String(a.unit.name || a.unit.id).localeCompare(String(b.unit.name || b.unit.id), 'pl');
  });
}

// Wartość do wyświetlenia: dni „1,5 d”, sprawność „85%”.
export function formatDosValue(kind, value) {
  if (!isNum(value)) return '—';
  if (kind === 'readiness') return `${Math.round(value * 100)}%`;
  return `${(Math.round(value * 10) / 10).toString().replace('.', ',')} d`;
}

// Szerokość paska (0–100%): dni skalowane do 3 d, sprawność do 100%.
export function dosBarPct(kind, value) {
  if (!isNum(value)) return 0;
  const r = kind === 'readiness' ? value : value / 3;
  return Math.max(0, Math.min(100, Math.round(r * 100)));
}

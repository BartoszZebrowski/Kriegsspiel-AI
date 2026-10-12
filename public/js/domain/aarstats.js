// Statystyki końcowe AAR (T32): straty i zużycie amunicji z kolejnych tur prawdy (umpire/turns), po stronach i dniach.
// Czyste funkcje, bez DOM. Liczone po liściach hierarchii; jednostka z podwładnymi dokłada tylko stratę nieujętą w nich.

/** Numer dnia bojowego (D+n) tury `iso` względem startu scenariusza, w strefie `timezone` (dni kalendarzowe). */
export function battleDay(iso, startIso, timezone = 'UTC') {
  const key = (v) => {
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
    }
  };
  const a = key(startIso);
  const b = key(iso);
  if (!a || !b) return 0;
  return Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 86400000));
}

const emptyBucket = () => ({ personnel: 0, ammo: 0, equipment: {} });
const num = (v) => (Number.isFinite(v) ? v : 0);

function addBucket(into, from) {
  into.personnel += from.personnel;
  into.ammo += from.ammo;
  for (const [k, v] of Object.entries(from.equipment)) into.equipment[k] = (into.equipment[k] || 0) + v;
}

// Spadki stanu jednostki między turami. Amunicja = spadek zapasu w DOS (dowóz w tej samej turze go maskuje).
function lossOf(p, u) {
  const equipment = {};
  const now = new Map((u.equipment || []).map((e) => [e.name, num(e.current)]));
  for (const e of p.equipment || []) {
    if (!now.has(e.name)) continue;
    const lost = Math.max(0, num(e.current) - now.get(e.name));
    if (lost) equipment[e.name] = lost;
  }
  return {
    personnel: Math.max(0, num(p.personnel?.current) - num(u.personnel?.current)),
    ammo: Math.max(0, num(p.supply?.ammo) - num(u.supply?.ammo)),
    equipment,
  };
}

// Straty tury: liście w całości, jednostka z podwładnymi tylko resztą (sztab, elementy bez własnego wpisu). Zapas DOS tylko z liści.
function unitLosses(prevUnits, curUnits) {
  const before = new Map((prevUnits || []).filter((u) => u?.id).map((u) => [u.id, u]));
  const units = (curUnits || []).filter((u) => u?.id && u.side && before.has(u.id));
  const raw = new Map(units.map((u) => [u.id, lossOf(before.get(u.id), u)]));
  const kids = new Map();
  for (const u of units) if (u.parent && raw.has(u.parent)) kids.set(u.parent, [...(kids.get(u.parent) || []), u.id]);
  return units.map((u) => {
    const l = raw.get(u.id);
    const ch = kids.get(u.id);
    if (!ch) return { side: u.side, ...l };
    const own = { personnel: l.personnel, ammo: 0, equipment: { ...l.equipment } };
    for (const c of ch) {
      own.personnel -= raw.get(c).personnel;
      for (const [k, v] of Object.entries(raw.get(c).equipment)) if (own.equipment[k]) own.equipment[k] -= v;
    }
    own.personnel = Math.max(0, own.personnel);
    for (const k of Object.keys(own.equipment)) if (own.equipment[k] <= 0) delete own.equipment[k];
    return { side: u.side, ...own };
  });
}

/**
 * @param {object[]} turns prawda tur w kolejności (pełne pliki umpire/turns)
 * @returns {{sides: string[], days: {day:number, sides: object}[], totals: object}}
 *   bucket = { personnel, ammo (spadek zapasu amunicji w DOS), equipment: {nazwa: sztuk} }
 */
export function summarizeLosses(turns, { start, timezone = 'UTC', ownSide = 'PL' } = {}) {
  const byDay = new Map();
  const seen = new Set([ownSide]);
  for (let i = 1; i < (turns || []).length; i++) {
    const prev = turns[i - 1];
    const cur = turns[i];
    if (!prev || !cur) continue;
    const day = battleDay(cur.time, start || turns[0]?.time, timezone);
    const row = byDay.get(day) || {};
    for (const l of unitLosses(prev.units, cur.units)) {
      seen.add(l.side);
      addBucket((row[l.side] ||= emptyBucket()), l);
    }
    byDay.set(day, row);
  }
  const sides = [ownSide, ...[...seen].filter((s) => s !== ownSide).sort()];
  const days = [...byDay.keys()].sort((a, b) => a - b).map((day) => ({ day, sides: byDay.get(day) }));
  const totals = {};
  for (const s of sides) {
    totals[s] = emptyBucket();
    for (const d of days) if (d.sides[s]) addBucket(totals[s], d.sides[s]);
  }
  return { sides, days, totals };
}

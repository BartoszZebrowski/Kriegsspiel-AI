// Tryb po bitwie (T29): czyste funkcje — kiedy prawda jest dostępna i które jednostki z prawdy pokazać.
import { distanceKm } from './geo.js';
// Lista statusów lustrzana do shared/status.js (domain/ nie importuje spoza domain/).

/** Bitwa zakończona: serwer zwalnia prawdę i AAR. */
export const isFinished = (scenario) => scenario?.status === 'finished';

/** Jednostki strony przeciwnej z prawdy (umpire/turns): wszystko, co nie jest po stronie gracza. */
export function enemyTruth(truth, ownSide = 'PL') {
  return (truth?.units || []).filter((u) => u && u.side && u.side !== ownSide && Array.isArray(u.pos));
}

/** Podpis jednostki z prawdy do podpowiedzi: nazwa i siła. */
export function truthLabel(unit) {
  const s = Number.isFinite(unit?.strength) ? ` · siła ${Math.round(unit.strength * 100)}%` : '';
  return `${unit?.name || unit?.id || '?'}${s}`;
}

const dist = (a, b) => distanceKm(a, b) * 1000;

/**
 * Pary kontakt gracza ↔ jednostka z prawdy (T32): zachłanne najbliższe, jeden do jednego, w promieniu `maxM`.
 * Kontakt nie niesie id prawdziwej jednostki, więc to heurystyka do pokazania przesunięcia, nie dowód tożsamości.
 * @returns {{contact: object, truth: object, distanceM: number}[]}
 */
export function matchContactsToTruth(contacts, truthUnits, maxM = 15000) {
  const pairs = [];
  for (const c of contacts || []) {
    if (!Array.isArray(c?.pos)) continue;
    for (const t of truthUnits || []) pairs.push({ contact: c, truth: t, distanceM: dist(c.pos, t.pos) });
  }
  pairs.sort((a, b) => a.distanceM - b.distanceM);
  const usedC = new Set();
  const usedT = new Set();
  const out = [];
  for (const p of pairs) {
    if (p.distanceM > maxM) break;
    if (usedC.has(p.contact) || usedT.has(p.truth)) continue;
    usedC.add(p.contact);
    usedT.add(p.truth);
    out.push(p);
  }
  return out;
}

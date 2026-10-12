// Tryb po bitwie (T29): czyste funkcje — kiedy prawda jest dostępna i które jednostki z prawdy pokazać.
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

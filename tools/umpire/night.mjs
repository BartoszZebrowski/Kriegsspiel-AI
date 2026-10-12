// Tryb nocny sędziego (T31): regeneracja wytrzymałości po długiej, cichej turze. Czyste funkcje, bez zapisu plików.
// Reguła (CLAUDE.md, T28): noc w spokoju lub odwód = +1× czasu okresu do maksimum. DOS i konwoje nadal planem sędziego.

export const STAMINA_MAX = 1440; // pełny odpoczynek (minuty), jak w CLAUDE.md „Zmęczenie i morale”

/**
 * Regeneruje `stamina_min` jednostek (obu stron). `night` = true albo { factor?, exclude?: [id], max? }.
 * Pomija jednostki z listy `exclude` oraz te, którym plan ustawił `stamina_min` ręcznie (`patches`).
 * Zwraca { regenerated: [id], warnings }; zmienia `units` w miejscu.
 */
export function applyNightRegen(units, minutes, night, patches = {}) {
  const warnings = [];
  const regenerated = [];
  if (!night) return { regenerated, warnings };
  const opts = night === true ? {} : night;
  const factor = Number.isFinite(opts.factor) && opts.factor >= 0 ? opts.factor : 1;
  const max = Number.isFinite(opts.max) ? opts.max : STAMINA_MAX;
  const exclude = new Set(opts.exclude || []);
  if (!(minutes > 0)) {
    warnings.push('plan.night: brak długości okresu (minutes) — regeneracji nie policzono');
    return { regenerated, warnings };
  }
  const ids = new Set(units.map((u) => u.id));
  for (const id of exclude) if (!ids.has(id)) warnings.push(`plan.night.exclude: nieznana jednostka "${id}"`);
  for (const u of units) {
    if (!Number.isFinite(u.stamina_min) || exclude.has(u.id) || patches[u.id]?.stamina_min !== undefined) continue;
    const next = Math.min(max, Math.round(u.stamina_min + minutes * factor));
    if (next > u.stamina_min) {
      u.stamina_min = next;
      regenerated.push(u.id);
    }
  }
  return { regenerated, warnings };
}

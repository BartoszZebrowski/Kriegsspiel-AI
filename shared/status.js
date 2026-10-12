// Status scenariusza (scenario.json: status). `finished` zwalnia prawdę i AAR (T29, server/truth.js).
export const SCENARIO_STATUSES = ['active', 'finished'];

/** Tekst błędu dla złego statusu albo null (brak pola = active). */
export function checkScenarioStatus(status) {
  if (status === undefined || SCENARIO_STATUSES.includes(status)) return null;
  return `status „${status}” (dozwolone: ${SCENARIO_STATUSES.join(', ')})`;
}

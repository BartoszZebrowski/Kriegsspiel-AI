// Walidacja CCIR i cyklu meldunków (T48): player/ccir.json, scenario.reportCycle, pola ccir i report w wiadomościach.
import { checkCcir, checkReportCycle, checkMessageReport } from '../shared/ccir.js';

/** Sprawdza plik CCIR (może być undefined = brak). Zwraca zbiór id poprawnych pozycji. */
export function checkCcirFile(data, report) {
  if (data === undefined || data === null) return new Set();
  const r = checkCcir(data);
  for (const e of r.errors) report.error('player/ccir.json: ' + e);
  for (const w of r.warnings) report.warn('player/ccir.json: ' + w);
  return new Set(r.items.map((i) => i.id));
}

export function checkReportCycleField(scenario, report) {
  for (const e of checkReportCycle(scenario?.reportCycle)) report.error('scenario.json: ' + e);
}

/** Pola `ccir`/`report` wiadomości przychodzącej; odwołanie do nieistniejącej pozycji to uwaga (gracz mógł ją usunąć). */
export function checkMessageCcirFields(where, m, ccirIds, report) {
  const err = checkMessageReport(m);
  if (err) report.error(`${where}: ${err}`);
  else if (m.ccir !== undefined && !ccirIds.has(m.ccir)) report.warn(`${where}: ccir „${m.ccir}” nie istnieje w player/ccir.json`);
}

// Walidacja dowódców-agentów (T14): kanały z `commander` i pliki `umpire/commanders/<id>.md`.
// Wypisuje tylko identyfikatory i nazwy sekcji, nigdy treści plików sędziego.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { checkCommanderId, checkCommanderFile } from '../shared/commander.js';

/**
 * Sprawdza dowódców scenariusza. `report` = { error(msg), warn(msg) }.
 * - kanał z `commander`: poprawne id, istniejący plik, poprawna struktura pliku;
 * - każdy plik w umpire/commanders/ (także dowódcy przeciwnika, bez kanału): poprawna struktura;
 * - plik bez kanału i bez wpisu w enemy-plan.md nie jest błędem (dowódcy przeciwnika są poza scenario.json).
 */
export async function checkCommanders(dir, scenario, report) {
  const cdir = path.join(dir, 'umpire', 'commanders');
  let files = [];
  try {
    files = (await fs.readdir(cdir)).filter((f) => f.endsWith('.md'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const seen = new Map();
  for (const c of scenario.channels || []) {
    if (c.commander === undefined) continue;
    const idError = checkCommanderId(c.commander);
    if (idError) { report.error(`scenario.json: kanał „${c.id}”: ${idError}`); continue; }
    if (seen.has(c.commander)) report.error(`scenario.json: dowódca „${c.commander}” przypisany do kanałów „${seen.get(c.commander)}” i „${c.id}”`);
    seen.set(c.commander, c.id);
    if (c.kind !== 'subordinate') report.warn(`scenario.json: kanał „${c.id}” ma commander, ale rodzaj „${c.kind}” (oczekiwano subordinate)`);
    if (!files.includes(c.commander + '.md')) report.error(`scenario.json: kanał „${c.id}”: brak pliku umpire/commanders/${c.commander}.md`);
  }
  for (const f of files) {
    const text = await fs.readFile(path.join(cdir, f), 'utf8');
    for (const e of checkCommanderFile(text)) report.error(`umpire/commanders/${f}: ${e}`);
  }
}

// Strażnik prawdy: jedyne miejsce w serwerze, które zna katalog umpire/ (T29).
// Odczyt jest możliwy wyłącznie przy `status: "finished"` w scenario.json; status czytamy przy każdym wywołaniu.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { StoreError, turnFileName } from './store.js';

export function createTruth(scenarioDir) {
  // Jedyna droga do plików sędziego: sprawdza status, potem czyta wskazany plik względem umpire/.
  async function openUmpire(...segments) {
    let scenario;
    try {
      scenario = JSON.parse(await fs.readFile(path.join(scenarioDir, 'scenario.json'), 'utf8'));
    } catch {
      throw new StoreError(403, 'Prawda jest dostępna dopiero po zakończeniu bitwy');
    }
    if (scenario?.status !== 'finished') throw new StoreError(403, 'Prawda jest dostępna dopiero po zakończeniu bitwy');
    try {
      return await fs.readFile(path.join(scenarioDir, 'umpire', ...segments), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(404, 'Nie znaleziono: ' + segments.at(-1));
      throw new StoreError(500, `Błąd odczytu ${segments.at(-1)}: ${err.message}`);
    }
  }

  return {
    async readTruthTurn(n) {
      const raw = await openUmpire('turns', turnFileName(n));
      try {
        return JSON.parse(raw);
      } catch {
        throw new StoreError(500, 'Uszkodzony plik prawdy tury ' + n);
      }
    },
    readAar: () => openUmpire('aar.md'),
  };
}

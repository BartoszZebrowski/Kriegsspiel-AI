// Przykładowe dane T17/T18 do ręcznych testów i smoke. NIE modyfikuje scenariuszy w repo.
//
//   import { injectLogisticsSample } from './fixtures/logistics-sample.mjs';
//   await injectLogisticsSample(scenarioDir);          // do ostatniej tury gracza (i prawdy sędziego, jeśli istnieje)
//
// CLI (kopia scenariusza do oglądania w przeglądarce):
//   node test/fixtures/logistics-sample.mjs <katalog-docelowy> [scenariusz-źródłowy]
//   PORT=8090 npm start -- <katalog-docelowy>        (katalog absolutny; ścieżka względna nie zadziała)
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
export const SAMPLE_FILE = path.join(HERE, 'logistics-sample.json');

/** Wczytuje surowy szablon (napisy "T±min" jeszcze nierozwiązane). */
export async function loadSample() {
  const { _comment, ...sample } = JSON.parse(await fs.readFile(SAMPLE_FILE, 'utf8'));
  return sample;
}

function shift(time, minutes) {
  const off = /([+-]\d\d:?\d\d)$/.exec(time)?.[1] ?? '+00:00';
  const m = /([+-])(\d\d):?(\d\d)/.exec(off);
  const offMin = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  return `${new Date(Date.parse(time) + minutes * 60000 + offMin * 60000).toISOString().slice(0, 19)}${m[1]}${m[2]}:${m[3]}`;
}

/** Zamienia napisy "T-30" / "T+45" / "T+0" na ISO względem `turnTime`. Zwraca głęboką kopię. */
export function resolveSample(sample, turnTime) {
  const walk = (v) => {
    if (typeof v === 'string') {
      const m = /^T([+-]\d+)$/.exec(v);
      return m ? shift(turnTime, Number(m[1])) : v;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(sample);
}

async function latest(dir) {
  const names = (await fs.readdir(dir).catch(() => [])).filter((n) => /^\d{3}\.json$/.test(n)).sort();
  return names.length ? path.join(dir, names.at(-1)) : null;
}

/** Wstrzykuje `logistics` i `dos` do ostatniej tury gracza (oraz `logistics` do ostatniej tury sędziego). Zwraca ścieżkę pliku gracza. */
export async function injectLogisticsSample(scenarioDir, sample) {
  const raw = sample ?? (await loadSample());
  const playerFile = await latest(path.join(scenarioDir, 'player', 'turns'));
  if (!playerFile) throw new Error('Brak tur gracza w ' + scenarioDir);
  const player = JSON.parse(await fs.readFile(playerFile, 'utf8'));
  const data = resolveSample(raw, player.time);
  player.logistics = data.logistics;
  for (const u of player.units || []) if (data.dos[u.id]) u.dos = data.dos[u.id];
  await fs.writeFile(playerFile, JSON.stringify(player, null, 2) + '\n');
  const umpireFile = await latest(path.join(scenarioDir, 'umpire', 'turns'));
  if (umpireFile) {
    const truth = JSON.parse(await fs.readFile(umpireFile, 'utf8'));
    truth.logistics = data.logistics;
    await fs.writeFile(umpireFile, JSON.stringify(truth, null, 2) + '\n');
  }
  return playerFile;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) {
    console.error('Użycie: node test/fixtures/logistics-sample.mjs <katalog-docelowy> [scenariusz-źródłowy]');
    process.exit(1);
  }
  const src = path.resolve(process.argv[3] || path.join(ROOT, 'scenarios', '00-test-przesmyk'));
  const dest = path.resolve(out);
  await fs.cp(src, dest, { recursive: true });
  const f = await injectLogisticsSample(dest);
  console.log(`Kopia: ${dest}\nWstrzyknięto do: ${f}\nUruchom: PORT=8090 npm start -- "${dest}"   (potem http://localhost:8090)`);
}

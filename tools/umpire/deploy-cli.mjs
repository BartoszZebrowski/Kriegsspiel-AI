// CLI rozstawiania pododdziałów w pliku tury sędziego.
// node tools/umpire/deploy-cli.mjs <turn.json> --unit 1bzmot-2k --formation obrona --facing 340
//   [--frontage 1800] [--depth m] [--forward n] [--variant nazwa] [--center lon,lat]
//   [--route "lon,lat;lon,lat;…"] [--seed x] [--plan plan.json] [--terrain] [--cover m] [--write]
import { readFile, writeFile } from 'node:fs/promises';
import { deployTree, distanceM } from './deploy.mjs';

const args = process.argv.slice(2);
const file = args[0];
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith('--')) continue;
  const next = args[i + 1];
  if (next === undefined || next.startsWith('--')) flags[args[i].slice(2)] = true;
  else { flags[args[i].slice(2)] = next; i++; }
}

if (!file || file.startsWith('--') || !flags.unit) {
  console.error('Użycie: node tools/umpire/deploy-cli.mjs <turn.json> --unit <id> --formation <nazwa> --facing <azymut> [--frontage m] [--depth m] [--forward n] [--variant v] [--center lon,lat] [--route "lon,lat;lon,lat"] [--seed s] [--plan plan.json] [--terrain] [--cover m] [--write]');
  process.exit(1);
}

const pair = (s) => s.split(',').map(Number);
const data = JSON.parse(await readFile(file, 'utf8'));
const units = data.units;
const unit = units.find((u) => u.id === flags.unit);
if (!unit) { console.error(`Brak jednostki ${flags.unit} w ${file}`); process.exit(1); }

const spec = {};
if (flags.formation) spec.formation = flags.formation;
if (flags.facing != null) spec.facing = Number(flags.facing);
if (flags.frontage) spec.frontage_m = Number(flags.frontage);
if (flags.depth) spec.depth_m = Number(flags.depth);
if (flags.forward) spec.forward = Number(flags.forward);
if (flags.variant) spec.variant = flags.variant;
if (flags.route) spec.route = String(flags.route).split(';').map(pair);
if (flags.center) spec.center = pair(flags.center);
spec.seed = flags.seed ?? `${flags.unit}-t${data.turn ?? 0}`;
let plan = { [flags.unit]: spec };
if (flags.plan) plan = { ...JSON.parse(await readFile(flags.plan, 'utf8')), [flags.unit]: { ...(JSON.parse(await readFile(flags.plan, 'utf8'))[flags.unit] ?? {}), ...spec } };
if (!plan[flags.unit].formation) { console.error('Podaj --formation (obrona|natarcie|marsz|wyczekujace|artyleria|obserwacja)'); process.exit(1); }

let positions = deployTree(units, flags.unit, plan, { seedBase: `${flags.seed ?? ''}${data.turn ?? ''}|` });

if (flags.terrain || flags.cover) {
  const { findWater, nudgeOutOfWater, findForest, preferCover } = await import('./terrain.mjs');
  const all = Object.values(positions);
  const lons = all.map((p) => p[0]);
  const lats = all.map((p) => p[1]);
  const m = 0.03; // ok. 2–3 km marginesu
  const bbox = [Math.min(...lons) - m, Math.min(...lats) - m, Math.max(...lons) + m, Math.max(...lats) + m];
  const water = await findWater(bbox);
  console.error(`Teren: ${water.length} akwenów w bbox ${bbox.map((v) => v.toFixed(3)).join(',')}`);
  if (flags.cover) {
    const forest = await findForest(bbox);
    positions = await preferCover(positions, Number(flags.cover), bbox, { polygons: forest, water });
  }
  const nudged = await nudgeOutOfWater(positions, bbox, { polygons: water });
  for (const mv of nudged.moved) console.error(`  ${mv.key}: z wody przesunięto o ~${mv.shift_m} m`);
  positions = nudged;
}

const byId = new Map(units.map((u) => [u.id, u]));
for (const [id, pos] of Object.entries(positions)) {
  const old = byId.get(id)?.pos;
  console.log(`${id.padEnd(22)} [${pos[0].toFixed(5)}, ${pos[1].toFixed(5)}]${old ? `  (przesunięcie ${Math.round(distanceM(old, pos))} m)` : ''}`);
}

if (flags.write) {
  for (const [id, pos] of Object.entries(positions)) {
    const u = byId.get(id);
    if (u) u.pos = pos;
  }
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  console.error(`Zapisano ${Object.keys(positions).length} pozycji w ${file}`);
} else {
  console.error('(podgląd; --write zapisze pos w pliku)');
}

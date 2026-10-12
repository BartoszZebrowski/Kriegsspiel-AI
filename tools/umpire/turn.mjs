// Narzędzie tury sędziego: z tury N i pliku planu buduje turę N+1 (prawda sędziego, widok gracza, wiadomości).
//
//   node tools/umpire/turn.mjs <scenariusz> <plan.json> [--dry] [--force] [--turn N]
//
// Zapis w kolejności: umpire/turns → player/inbox → player/turns (nowa tura przełącza aplikację).
// Widok gracza powstaje wyłącznie z pól białej listy (PLAYER_FIELDS z shared/schema.js), więc pola
// sędziego (side, supply, events, endurance_min…) nie mają jak wyciec. Format planu: docs/UMPIRE-TOOLS.md.
// Logika to czyste funkcje (buildTurn, computeTrack, …); CLI jest cienką warstwą nad nimi.
import { readFile, writeFile, readdir, mkdir, rename, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYER_FIELDS, PLAYER_TURN_FIELDS, LOGISTICS_FIELDS, extraFields, isCoord, isValidTime, checkTrack, checkPosTime } from '../../shared/schema.js';
import { checkDeliveries, checkEw, checkEwZone } from '../../shared/ew.js';
import { checkStaff, STAFF_FIELDS } from '../../shared/staff.js';
import { applyEngineering, syncBridgeStatus } from './engineering-merge.mjs';
import { clone, pad3, pickFields, moved, computeTrack, nextTime, mergeById, checkIds, patchMissing, applyLogistics, buildInbox } from './turn-merge.mjs';

// Publiczne API (kiedyś w tym pliku): pomocniki żyją w turn-merge.mjs.
export { MOVE_EPSILON, pickFields, applyPatch, moved, computeTrack, formatWithOffset, nextTime, applyLogistics, buildInbox } from './turn-merge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/**
 * Buduje turę N+1. Wejście:
 *   prevUmpire  — umpire/turns/NNN.json tury N,
 *   prevPlayer  — player/turns/NNN.json tury N,
 *   plan        — zmiany (format w docs/UMPIRE-TOOLS.md),
 *   turnMinutes — z scenario.json (gdy plan nie podaje `time`),
 *   playerSide  — strona gracza (domyślnie 'PL'; scenario.side).
 * Zwraca { umpire, player, inbox: {messages}, time, turn, warnings, moved: [id] }. Niczego nie zapisuje.
 */
export function buildTurn({ prevUmpire, prevPlayer, plan = {}, turnMinutes, playerSide = 'PL' }) {
  const warnings = [];
  const turn = prevUmpire.turn + 1;
  if (prevPlayer.turn !== prevUmpire.turn) warnings.push(`tura gracza (${prevPlayer.turn}) różni się od tury sędziego (${prevUmpire.turn})`);
  const time = plan.time ?? (Number.isFinite(turnMinutes) ? nextTime(prevUmpire.time, turnMinutes) : null);
  if (!time) throw new Error('Brak czasu tury: podaj plan.time albo turnMinutes');
  if (!isValidTime(time)) throw new Error(`Nieprawidłowy czas tury: ${time}`);

  const routes = {}; // id → punkty pośrednie z łatek sędziego
  const collectRoute = (next, _old, patch) => { if (patch.route) routes[next.id] = patch.route; };
  const stripTrack = (list) => list.map((u) => { const { track, ...rest } = u; return rest; });

  // --- prawda sędziego ---
  patchMissing('jednostka', plan.units, prevUmpire.units || [], warnings);
  patchMissing('środek', plan.assets, prevUmpire.assets || [], warnings);
  const uUnits = mergeById(stripTrack(clone(prevUmpire.units || [])), plan.units, plan.addUnits, { skip: ['route', 'track'], onApply: collectRoute });
  const uAssets = mergeById(clone(prevUmpire.assets || []), plan.assets, plan.addAssets);
  checkIds('jednostki sędziego', uUnits, warnings);
  checkIds('środki sędziego', uAssets, warnings);
  const umpire = { ...clone(prevUmpire), turn, time, units: uUnits, events: clone(plan.events ?? []) };
  if (prevUmpire.assets || plan.addAssets) umpire.assets = uAssets;
  delete umpire.logistics;
  const uLog = applyLogistics(prevUmpire.logistics, plan.logistics);
  warnings.push(...uLog.warnings.map((w) => `sędzia ${w}`));
  if (uLog.logistics) umpire.logistics = uLog.logistics;

  // Doręczenia rozkazów (T25): zdarzenia tej tury, nie dziedziczone. Tylko umpire/turns, nigdy widok gracza.
  delete umpire.deliveries;
  if (plan.deliveries !== undefined) {
    const dl = checkDeliveries(plan.deliveries);
    warnings.push(...dl.errors.map((e) => `plan ${e}`), ...dl.warnings.map((w) => `plan ${w}`));
    if (Array.isArray(plan.deliveries)) umpire.deliveries = clone(plan.deliveries);
  }
  // Prawdziwy obraz REW (T26): dziedziczony z tury N, zmieniany planem { zones: { set: [strefy], remove: [id] } }.
  delete umpire.ew;
  const zones = new Map((prevUmpire.ew?.zones || []).map((z) => [z.id, clone(z)]));
  for (const id of plan.ew?.zones?.remove ?? []) if (!zones.delete(id)) warnings.push(`plan: usuwana strefa REW "${id}" nie istnieje`);
  for (const z of plan.ew?.zones?.set ?? []) zones.set(z.id, clone(z));
  if (zones.size || prevUmpire.ew) {
    umpire.ew = { zones: [...zones.values()] };
    warnings.push(...checkEw(umpire.ew).map((e) => `sędzia ${e}`));
  }

  // --- widok gracza ---
  const pl = plan.player || {};
  const prevPlayerPos = new Map((prevPlayer.units || []).map((u) => [u.id, u.pos]));
  const prevUmpirePos = new Map((prevUmpire.units || []).map((u) => [u.id, u.pos]));
  const umpireIds = new Set(uUnits.map((u) => u.id));

  // Jednostki własne z prawdy (side = strona gracza) + jednostki tylko-gracza (sąsiedzi, przełożony) z tury N.
  const base = [];
  const seen = new Set();
  const prevById = new Map((prevPlayer.units || []).map((u) => [u.id, u]));
  for (const u of uUnits) {
    if (u.side !== playerSide) continue;
    // Pola widoku gracza, których sędzia nie prowadzi (np. notes), dziedziczymy z poprzedniej tury gracza.
    // pos_time (BFT, T49) nie jest dziedziczone: bez łatki widok gracza = prawda, z czasem raportu = czas tury.
    const { pos_time: _bft, ...inherited } = prevById.get(u.id) || {};
    base.push({ ...inherited, ...pickFields(u, PLAYER_FIELDS.units.filter((f) => f !== 'dos')) }); // dos to meldunek gracza: nie z prawdy
    seen.add(u.id);
  }
  for (const u of prevPlayer.units || []) if (!seen.has(u.id) && !umpireIds.has(u.id)) base.push(clone(u));
  // pola `track` z poprzedniej tury nie przechodzą dalej
  const playerPatches = { ...(pl.units || {}) };
  patchMissing('jednostka gracza', playerPatches, base, warnings);
  const movedIds = [];
  const pUnitsRaw = mergeById(stripTrack(base), playerPatches, pl.addUnits, { skip: ['route'], onApply: (next, _o, p) => { if (p.route) routes[next.id] = p.route; } });
  const pUnits = pUnitsRaw.map((u) => {
    const out = pickFields(u, PLAYER_FIELDS.units);
    const from = prevPlayerPos.get(u.id) ?? prevUmpirePos.get(u.id);
    const explicit = playerPatches[u.id]?.track ?? null;
    const track = computeTrack(from, u.pos, routes[u.id] ?? [], explicit);
    if (track) { out.track = track; movedIds.push(u.id); } else delete out.track;
    return out;
  });
  checkIds('jednostki gracza', pUnits, warnings);
  // Pozycja BFT (T49): plan.player.units.<id> = { pos: <ostatnio zameldowana>, pos_time } zamiast prawdy (zagłuszenie, cisza radiowa, utrata łączności).
  for (const u of pUnits) {
    const patch = playerPatches[u.id];
    if (patch?.pos !== undefined && patch.pos_time === undefined) warnings.push(`jednostka ${u.id}: pos BFT bez pos_time (przyjęto czas tury)`);
    if (u.pos_time === undefined) continue;
    const r = checkPosTime(u.pos_time, time, turnMinutes);
    if (r.error) warnings.push(`jednostka ${u.id}: ${r.error}`);
    else if (r.warn && !patch?.pos_time) warnings.push(`jednostka ${u.id}: ${r.warn}`);
    else if (Date.parse(u.pos_time) === Date.parse(time)) delete u.pos_time; // równy czasowi tury = domyślny
  }
  for (const u of pUnits) {
    if (!isCoord(u.pos)) warnings.push(`jednostka ${u.id}: brak poprawnego pos`);
    if (u.track) {
      const r = checkTrack(u.track, u.pos);
      if (r.error) warnings.push(`jednostka ${u.id}: ${r.error}`);
    }
  }

  // Środki: strona gracza z prawdy + dziedziczone pola widoku (opis statusu można nadpisać w plan.player.assets).
  const prevAssets = new Map((prevPlayer.assets || []).map((a) => [a.id, a]));
  const baseAssets = uAssets.filter((a) => a.side === playerSide).map((a) => ({ ...prevAssets.get(a.id), ...pickFields(a, PLAYER_FIELDS.assets) }));
  patchMissing('środek gracza', pl.assets, baseAssets, warnings);
  const pAssets = mergeById(baseAssets, pl.assets, pl.addAssets).map((a) => pickFields(a, PLAYER_FIELDS.assets));

  // Kontakty i linie: dziedziczone z tury N gracza, zmieniane tylko planem (to wiedza gracza, nie prawda).
  const upsert = (list, ch) => {
    const map = new Map(list.map((x) => [x.id, x]));
    for (const id of ch?.remove ?? []) {
      if (!map.delete(id)) warnings.push(`plan: usuwany element "${id}" nie istnieje`);
    }
    for (const x of ch?.set ?? []) map.set(x.id, clone(x));
    return [...map.values()];
  };
  const contacts = upsert(prevPlayer.contacts || [], pl.contacts).map((c) => pickFields(c, PLAYER_FIELDS.contacts));
  const lines = upsert(prevPlayer.lines || [], pl.lines).map((l) => pickFields(l, PLAYER_FIELDS.lines));
  checkIds('kontakty', contacts, warnings);
  for (const l of lines) for (const e of checkEwZone(l, time)) warnings.push(`linia ${l.id}: ${e}`);
  for (const c of contacts) if (isValidTime(c.observed) && Date.parse(c.observed) > Date.parse(time)) warnings.push(`kontakt ${c.id}: observed późniejszy niż czas tury`);

  // Logistyka gracza: tylko z poprzedniej tury gracza + plan.player.logistics (nie z prawdy). Trasy konwojów z planu sędziego jako zapas.
  const pLog = applyLogistics(prevPlayer.logistics, pl.logistics, { fallbackRoutes: uLog.routes, fields: LOGISTICS_FIELDS });
  warnings.push(...pLog.warnings.map((w) => `gracz ${w}`));
  // Wojska inżynieryjne (T27): prawda dziedziczona z tury N i zmieniana planem; widok gracza = własne obiekty z prawdy + rozpoznane wrogie.
  // Stan mostu stałego z prawdy trafia do logistics.bridges (routing); u gracza tylko dla mostów jego strony.
  delete umpire.engineering;
  const eng = applyEngineering({ prevUmpire, prevPlayer, plan, playerSide, time, logisticsBridgeIds: new Set((pLog.logistics?.bridges || []).map((b) => b.id)) });
  warnings.push(...eng.warnings);
  if (eng.umpire) umpire.engineering = eng.umpire;
  syncBridgeStatus(umpire.logistics, eng.bridgeStates, time);
  syncBridgeStatus(pLog.logistics, eng.ownBridgeStates, time);
  const player = { turn, time, units: pUnits };
  if (pLog.logistics) player.logistics = pLog.logistics;
  if (contacts.length || prevPlayer.contacts) player.contacts = contacts;
  if (pAssets.length || prevPlayer.assets) player.assets = pAssets;
  if (lines.length || prevPlayer.lines) player.lines = lines;
  if (eng.player && (eng.player.length || prevPlayer.engineering)) player.engineering = eng.player;
  // Odprawa sztabu (T28.1): dotyczy jednej tury, nie jest dziedziczona. plan.player.staff = [{ role, name, text, time }] (bez prawdy!).
  if (Array.isArray(pl.staff) && pl.staff.length) {
    player.staff = pl.staff.map((s) => pickFields(s, STAFF_FIELDS));
    const st = checkStaff(player.staff, time, turnMinutes);
    warnings.push(...st.errors.map((e) => `plan ${e}`), ...st.warnings.map((w) => `plan ${w}`));
  }
  const leaked = extraFields(player, PLAYER_TURN_FIELDS);
  if (leaked.length) throw new Error(`Wyciek pól do widoku gracza: ${leaked.join(', ')}`);

  const inbox = buildInbox(plan.messages, { after: prevUmpire.time, upTo: time });
  warnings.push(...inbox.warnings);
  return { umpire, player, inbox: { messages: inbox.messages }, time, turn, warnings, moved: movedIds };
}

// ---------- Pliki ----------

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function writeJsonAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`);
  await rename(tmp, file);
}

/** Numer najwyższej tury gracza w katalogu scenariusza. */
export async function latestTurn(scenarioDir) {
  const names = await readdir(path.join(scenarioDir, 'player', 'turns'));
  const nums = names.map((n) => /^(\d{3})\.json$/.exec(n)).filter(Boolean).map((m) => Number(m[1]));
  if (!nums.length) throw new Error('Brak tur w player/turns');
  return Math.max(...nums);
}

/**
 * Tworzy turę N+1 w katalogu scenariusza i zapisuje ją: umpire/turns → player/inbox → player/turns
 * (+ opcjonalny wpis `plan.log` do umpire/log.md). opts: { dry, force, fromTurn }.
 * Zwraca wynik buildTurn + { files }.
 */
export async function writeTurn(scenarioDir, plan, opts = {}) {
  const N = opts.fromTurn ?? (await latestTurn(scenarioDir));
  const scenario = await readJson(path.join(scenarioDir, 'scenario.json'));
  const prevUmpire = await readJson(path.join(scenarioDir, 'umpire', 'turns', `${pad3(N)}.json`));
  const prevPlayer = await readJson(path.join(scenarioDir, 'player', 'turns', `${pad3(N)}.json`));
  const res = buildTurn({ prevUmpire, prevPlayer, plan, turnMinutes: scenario.turnMinutes, playerSide: scenario.side || 'PL' });
  const n = pad3(res.turn);
  const files = {
    umpire: path.join(scenarioDir, 'umpire', 'turns', `${n}.json`),
    inbox: path.join(scenarioDir, 'player', 'inbox', `${n}.json`),
    player: path.join(scenarioDir, 'player', 'turns', `${n}.json`),
  };
  if (!opts.dry) {
    if (!opts.force) {
      for (const f of Object.values(files)) if (existsSync(f)) throw new Error(`Plik już istnieje: ${f} (użyj --force, by nadpisać)`);
    }
    await writeJsonAtomic(files.umpire, res.umpire);
    await writeJsonAtomic(files.inbox, res.inbox);
    await writeJsonAtomic(files.player, res.player);
    if (plan.log) {
      const hhmm = res.time.slice(11, 16);
      await appendFile(path.join(scenarioDir, 'umpire', 'log.md'), `\n## Tura ${res.turn} (${hhmm})\n\n${String(plan.log).trim()}\n`);
    }
  }
  return { ...res, files };
}

// ---------- CLI ----------

export async function main(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      flags[key] = next === undefined || next.startsWith('--') ? true : (i++, next);
    } else pos.push(argv[i]);
  }
  if (pos.length < 2) {
    console.error('Użycie: node tools/umpire/turn.mjs <scenariusz> <plan.json> [--dry] [--force] [--turn N]');
    return 1;
  }
  const dir = existsSync(pos[0]) ? pos[0] : path.join(ROOT, 'scenarios', pos[0]);
  const plan = await readJson(pos[1]);
  const res = await writeTurn(dir, plan, { dry: !!flags.dry, force: !!flags.force, fromTurn: flags.turn ? Number(flags.turn) : undefined });
  console.log(`Tura ${res.turn} (${res.time}): ${res.umpire.units.length} jednostek sędziego, ${res.player.units.length} w widoku gracza, ${res.inbox.messages.length} wiadomości, track dla ${res.moved.length}.`);
  for (const w of res.warnings) console.warn(`UWAGA: ${w}`);
  console.log(flags.dry ? '(--dry: nic nie zapisano)' : `Zapisano: ${Object.values(res.files).map((f) => path.relative(ROOT, f)).join(', ')}. Teraz: npm run validate -- ${path.basename(dir)}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { console.error(err.message); process.exit(1); },
  );
}

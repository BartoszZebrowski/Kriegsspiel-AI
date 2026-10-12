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
import {
  PLAYER_FIELDS, PLAYER_TURN_FIELDS, PLAYER_MESSAGE_FIELDS, LOGISTICS_LISTS, LOGISTICS_FIELDS, checkLogistics, extraFields,
  isCoord, isValidTime, checkMessageMeta, checkMessageText, checkTrack,
} from '../../shared/schema.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/** Minimalne przesunięcie (stopnie), od którego jednostka uchodzi za przemieszczoną (~0,01 m). */
export const MOVE_EPSILON = 1e-7;

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const pad3 = (n) => String(n).padStart(3, '0');

/** Kopia obiektu z samymi polami z listy `allowed` (bez undefined). */
export function pickFields(obj, allowed) {
  const out = {};
  for (const k of Object.keys(obj || {})) if (allowed.includes(k) && obj[k] !== undefined) out[k] = clone(obj[k]); // zachowuje kolejność pól źródła
  return out;
}

/**
 * Płytkie scalenie łatki z obiektem: `null` usuwa pole, reszta zastępuje. Pola specjalne (route) pomija —
 * obsługuje je wywołujący. Zwraca nowy obiekt.
 */
export function applyPatch(obj, patch, skip = []) {
  const out = { ...obj };
  for (const [k, v] of Object.entries(patch || {})) {
    if (skip.includes(k)) continue;
    if (v === null) delete out[k];
    else out[k] = clone(v);
  }
  return out;
}

/** Czy pozycje różnią się o więcej niż MOVE_EPSILON. */
export function moved(a, b) {
  return isCoord(a) && isCoord(b) && (Math.abs(a[0] - b[0]) > MOVE_EPSILON || Math.abs(a[1] - b[1]) > MOVE_EPSILON);
}

/**
 * Trasa przejechana w turze: [from, …pośrednie, to]. Zwraca undefined, gdy jednostka się nie przesunęła.
 * `via` = własne punkty pośrednie (bez początku i końca); `explicit` = pełna trasa z planu (jej początek i koniec
 * zostają dopasowane do from/to).
 */
export function computeTrack(from, to, via = [], explicit = null) {
  if (!moved(from, to)) return undefined;
  const mid = (explicit && explicit.length ? explicit.slice(1, -1) : via).filter(isCoord);
  return [[...from], ...mid.map((p) => [...p]), [...to]];
}

/** Zapis czasu ISO z podanym przesunięciem strefy (np. `+02:00`) dla chwili `ms`. */
export function formatWithOffset(ms, offset) {
  const m = /([+-])(\d\d):?(\d\d)$/.exec(offset || '');
  if (!m) return new Date(ms).toISOString();
  const off = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  const d = new Date(ms + off * 60000).toISOString().slice(0, 19);
  return `${d}${m[1]}${m[2]}:${m[3]}`;
}

/** Czas następnej tury = czas poprzedniej + turnMinutes (to samo przesunięcie strefy). */
export function nextTime(prevTime, turnMinutes) {
  const offset = /([+-]\d\d:?\d\d|Z)$/.exec(prevTime)?.[1];
  return formatWithOffset(Date.parse(prevTime) + turnMinutes * 60000, offset === 'Z' ? '+00:00' : offset);
}

// Lista elementów z id → scalenie według planu: patches {id: łatka|null}, additions [obiekty].
function mergeById(list, patches = {}, additions = [], { skip = [], onApply } = {}) {
  const out = [];
  for (const item of list) {
    if (!Object.hasOwn(patches, item.id)) { out.push(item); continue; }
    const p = patches[item.id];
    if (p === null) continue; // usunięta
    const next = applyPatch(item, p, skip);
    onApply?.(next, item, p);
    out.push(next);
  }
  for (const a of additions) out.push(clone(a));
  return out;
}

function checkIds(kind, list, warnings) {
  const seen = new Set();
  for (const it of list) {
    if (typeof it.id !== 'string' || !it.id) warnings.push(`${kind}: element bez id`);
    else if (seen.has(it.id)) warnings.push(`${kind}: zduplikowane id ${it.id}`);
    else seen.add(it.id);
  }
}

function patchMissing(kind, patches, list, warnings) {
  const ids = new Set(list.map((x) => x.id));
  for (const id of Object.keys(patches || {})) if (!ids.has(id)) warnings.push(`plan: ${kind} "${id}" nie istnieje (łatka pominięta)`);
}

/**
 * Warstwa logistyczna po zmianach planu. `prev` = logistics z tury N (albo undefined), `ch` = plan:
 *   { depots|routes|bridges|convoys: { patch: { id: łatka | null }, add: [obiekty] } }
 * Łatka scala pola (null usuwa pole), `null` zamiast łatki usuwa element; konwój może mieć `route` (punkty pośrednie)
 * albo pełny `track`. Track konwoju liczony jak dla jednostek (od pozycji z tury N). Zwraca { logistics|undefined, warnings }.
 * `fallbackRoutes` = trasy z innego widoku (np. sędziego), użyte, gdy łatka nie podaje własnej.
 */
export function applyLogistics(prev, ch, { fallbackRoutes = {}, fields = null } = {}) {
  const warnings = [];
  if (prev === undefined && !ch) return { logistics: undefined, warnings, routes: {} };
  const out = {};
  const routes = {};
  for (const list of LOGISTICS_LISTS) {
    const before = clone(prev?.[list] || []).map((x) => { const { track, ...rest } = x; return list === 'convoys' ? rest : x; });
    const prevPos = new Map((prev?.[list] || []).map((x) => [x.id, x.pos]));
    const spec = ch?.[list] || {};
    patchMissing(`logistics.${list}`, spec.patch, before, warnings);
    let items = mergeById(before, spec.patch, spec.add, { skip: ['route', 'track'], onApply: (next, _o, p) => { if (p.route) routes[next.id] = p.route; } });
    if (list === 'convoys') {
      items = items.map((c) => {
        const { track: _t, ...rest } = c;
        const explicit = spec.patch?.[c.id]?.track ?? spec.add?.find((a) => a.id === c.id)?.track ?? null;
        const track = computeTrack(prevPos.get(c.id), c.pos, routes[c.id] ?? fallbackRoutes[c.id] ?? [], explicit);
        return track ? { ...rest, track } : rest;
      });
    }
    checkIds(`logistics.${list}`, items, warnings);
    if (fields) items = items.map((x) => pickFields(x, fields[list]));
    if (items.length || prev?.[list] || spec.add) out[list] = items;
  }
  if (!Object.keys(out).length) return { logistics: undefined, warnings, routes };
  const chk = checkLogistics(out);
  for (const e of chk.errors) warnings.push(e);
  return { logistics: out, warnings, routes };
}

/** Wiadomości sędziego → sama biała lista pól, posortowane po czasie (stabilnie). Zwraca { messages, warnings }. */
export function buildInbox(messages = [], { after, upTo } = {}) {
  const warnings = [];
  const out = messages.map((m, i) => ({ m: pickFields(m, PLAYER_MESSAGE_FIELDS), i, src: m }));
  for (const { m, src } of out) {
    const extra = extraFields(src, PLAYER_MESSAGE_FIELDS);
    if (extra.length) warnings.push(`wiadomość ${m.id}: pominięto pola ${extra.join(', ')}`);
    if (!m.id) warnings.push('wiadomość bez id');
    if (!m.channel) warnings.push(`wiadomość ${m.id}: brak channel`);
    if (!isValidTime(m.time)) warnings.push(`wiadomość ${m.id}: nieprawidłowy time`);
    else {
      if (after && Date.parse(m.time) < Date.parse(after)) warnings.push(`wiadomość ${m.id}: time przed turą poprzednią`);
      if (upTo && Date.parse(m.time) > Date.parse(upTo)) warnings.push(`wiadomość ${m.id}: time po czasie tury`);
    }
    const bad = checkMessageText(m.text) || checkMessageMeta(m);
    if (bad) warnings.push(`wiadomość ${m.id}: ${bad}`);
  }
  out.sort((a, b) => (Date.parse(a.m.time) || 0) - (Date.parse(b.m.time) || 0) || a.i - b.i);
  return { messages: out.map((x) => x.m), warnings };
}

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
    base.push({ ...prevById.get(u.id), ...pickFields(u, PLAYER_FIELDS.units.filter((f) => f !== 'dos')) }); // dos to meldunek gracza: nie z prawdy
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
  for (const c of contacts) if (isValidTime(c.observed) && Date.parse(c.observed) > Date.parse(time)) warnings.push(`kontakt ${c.id}: observed późniejszy niż czas tury`);

  // Logistyka gracza: tylko z poprzedniej tury gracza + plan.player.logistics (nie z prawdy). Trasy konwojów z planu sędziego jako zapas.
  const pLog = applyLogistics(prevPlayer.logistics, pl.logistics, { fallbackRoutes: uLog.routes, fields: LOGISTICS_FIELDS });
  warnings.push(...pLog.warnings.map((w) => `gracz ${w}`));
  const player = { turn, time, units: pUnits };
  if (pLog.logistics) player.logistics = pLog.logistics;
  if (contacts.length || prevPlayer.contacts) player.contacts = contacts;
  if (pAssets.length || prevPlayer.assets) player.assets = pAssets;
  if (lines.length || prevPlayer.lines) player.lines = lines;
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

// Walidator scenariusza. Użycie: npm run validate -- <nazwa-scenariusza>
// Sprawdza pliki gracza i sędziego. Wypisuje tylko identyfikatory, nigdy treści z umpire/.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { pointInAny, CACHE_DIR } from './umpire/terrain.mjs';
import milsymbol from 'milsymbol';
import { isDescribed } from '../public/js/sidc.js';
import { distanceKm } from '../public/js/domain/geo.js';
import {
  SCHEMA_VERSION, CHANNEL_KINDS, LINE_KINDS, PLACE_KINDS, PLAYER_TURN_FIELDS, PLAYER_FIELDS, PLAYER_MESSAGE_FIELDS,
  MAX_NOTES, checkTrack, checkDos, checkLogistics, isCoord, isValidTime, isCount, extraFields, checkNote, checkMessageText, checkMessageMeta,
} from '../shared/schema.js';

const ms = milsymbol.default ?? milsymbol;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJsonSafe(file, report) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    report.error(`${path.basename(path.dirname(file))}/${path.basename(file)}: niepoprawny JSON (${err.message})`);
    return null;
  }
}

async function numbered(dir) {
  try {
    return (await fs.readdir(dir))
      .filter((n) => /^\d{3,4}\.json$/.test(n))
      .map((n) => Number(n.slice(0, -5)))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

const pad = (n) => String(n).padStart(3, '0');
const validTime = isValidTime;
const validPos = isCoord;

function checkSidc(where, sidc, report) {
  if (typeof sidc !== 'string' || sidc.length !== 15) {
    report.error(`${where}: SIDC musi mieć 15 znaków`);
    return;
  }
  if (!new ms.Symbol(sidc).isValid()) report.error(`${where}: SIDC ${sidc} niepoprawny wg milsymbol`);
  else if (!isDescribed(sidc)) report.error(`${where}: SIDC ${sidc} nie ma polskiego opisu (public/js/sidc.js)`);
}

// Stan osobowy i sprzęt jednostki własnej: liczby całkowite ≥ 0, current ≤ authorized (inaczej uwaga).
function checkStrength(where, item, report) {
  const p = item.personnel;
  if (p !== undefined) {
    if (!p || typeof p !== 'object' || !isCount(p.current) || !isCount(p.authorized))
      report.error(`${where}: personnel wymaga całkowitych current i authorized ≥ 0`);
    else if (p.current > p.authorized) report.warn(`${where}: personnel.current (${p.current}) > authorized (${p.authorized})`);
  }
  if (item.equipment !== undefined) {
    if (!Array.isArray(item.equipment)) report.error(`${where}: equipment musi być listą`);
    for (const [i, e] of (Array.isArray(item.equipment) ? item.equipment : []).entries()) {
      const w = `${where} equipment[${e?.name || i}]`;
      if (typeof e?.name !== 'string' || !e.name.trim()) report.error(`${w}: pusta nazwa`);
      if (!isCount(e?.current) || !isCount(e?.authorized)) report.error(`${w}: current i authorized muszą być całkowite ≥ 0`);
      else if (e.current > e.authorized) report.warn(`${w}: current (${e.current}) > authorized (${e.authorized})`);
    }
  }
}

// Szacunki kontaktu wroga: count całkowite ≥ 0, nazwy niepuste.
function checkEstimates(where, item, report) {
  const p = item.estimate_personnel;
  if (p !== undefined && (!p || !isCount(p.count))) report.error(`${where}: estimate_personnel wymaga całkowitego count ≥ 0`);
  if (item.estimate_equipment !== undefined) {
    if (!Array.isArray(item.estimate_equipment)) report.error(`${where}: estimate_equipment musi być listą`);
    for (const [i, e] of (Array.isArray(item.estimate_equipment) ? item.estimate_equipment : []).entries()) {
      const w = `${where} estimate_equipment[${e?.name || i}]`;
      if (typeof e?.name !== 'string' || !e.name.trim()) report.error(`${w}: pusta nazwa`);
      if (!isCount(e?.count)) report.error(`${w}: count musi być całkowite ≥ 0`);
    }
  }
}

// Hierarchia: parent wskazuje istniejącą jednostkę i nie tworzy cyklu.
function checkHierarchy(label, units, report) {
  const byId = new Map(units.filter((u) => u?.id).map((u) => [u.id, u]));
  for (const u of byId.values()) {
    if (u.parent === undefined) continue;
    if (typeof u.parent !== 'string' || !byId.has(u.parent)) {
      report.error(`${label} units[${u.id}]: parent „${u.parent}” nie istnieje`);
      continue;
    }
    const seen = new Set([u.id]);
    for (let p = u.parent; p; p = byId.get(p)?.parent) {
      if (seen.has(p)) {
        report.error(`${label} units[${u.id}]: cykl w hierarchii (parent) przez „${p}”`);
        break;
      }
      seen.add(p);
    }
  }
}

// Formacja sąsiada: `formation` wskazuje istniejącą jednostkę tej samej tury, która sama nie ma ani `parent`,
// ani `formation` (to dowództwo sąsiada, korzeń) — dzięki temu nie ma cykli. Jednostka nie ma jednocześnie parent i formation.
// Linie (`lines[].formation`) mogą wskazywać ten sam rodzaj jednostki (np. FLOT sąsiada).
function checkFormations(label, data, report) {
  const byId = new Map((data.units || []).filter((u) => u?.id).map((u) => [u.id, u]));
  const check = (where, f, self) => {
    if (typeof f !== 'string' || !byId.has(f)) return report.error(`${where}: formation „${f}” nie istnieje`);
    if (f === self) return report.error(`${where}: formation wskazuje samą jednostkę (cykl)`);
    const target = byId.get(f);
    if (target.parent !== undefined || target.formation !== undefined)
      report.error(`${where}: formation „${f}” musi wskazywać jednostkę bez parent i formation (dowództwo sąsiada)`);
  };
  for (const u of byId.values()) {
    if (u.formation === undefined) continue;
    const where = `${label} units[${u.id}]`;
    if (u.parent !== undefined) report.error(`${where}: jednostka nie może mieć jednocześnie parent i formation`);
    check(where, u.formation, u.id);
  }
  for (const [i, line] of (data.lines || []).entries()) {
    if (line?.formation !== undefined) check(`${label} lines[${line.id ?? i}]`, line.formation, null);
  }
}

// Strażnik wycieku: plik widoczny dla gracza nie może zawierać pól sędziego (side, supply, events…).
// Zgłasza tylko nazwy pól i identyfikatory, nigdy wartości.
function checkPlayerFields(label, data, report) {
  for (const f of extraFields(data, PLAYER_TURN_FIELDS)) report.error(`${label}: pole „${f}” spoza schematu gracza (pole sędziego?)`);
  for (const [key, allowed] of Object.entries(PLAYER_FIELDS)) {
    if (!Array.isArray(data[key])) continue;
    for (const [i, item] of data[key].entries()) {
      for (const f of extraFields(item, allowed)) report.error(`${label} ${key}[${item?.id ?? i}]: pole „${f}” spoza schematu gracza (pole sędziego?)`);
    }
  }
}

function checkSituation(label, data, n, scenario, report, strictLogistics = false) {
  if (data.turn !== n) report.error(`${label}: pole turn = ${data.turn}, oczekiwano ${n}`);
  if (!validTime(data.time)) report.error(`${label}: nieprawidłowy czas tury`);
  else if (validTime(scenario.start) && scenario.turnMinutes) {
    const expected = Date.parse(scenario.start) + n * scenario.turnMinutes * 60000;
    if (Date.parse(data.time) !== expected) report.warn(`${label}: czas tury nie odpowiada start + ${n} × turnMinutes`);
  }
  const ids = new Set();
  for (const key of ['units', 'contacts', 'assets']) {
    if (data[key] !== undefined && !Array.isArray(data[key])) report.error(`${label}: ${key} musi być listą`);
    for (const [i, item] of (data[key] || []).entries()) {
      const where = `${label} ${key}[${item?.id ?? i}]`;
      if (!item?.id) report.error(`${where}: brak id`);
      else if (ids.has(item.id)) report.error(`${label}: zduplikowane id „${item.id}”`);
      else ids.add(item.id);
      const needsSymbol = key !== 'assets' || item.sidc || item.pos;
      if (needsSymbol) checkSidc(where, item.sidc, report);
      if ((key !== 'assets' || item.pos) && !validPos(item.pos)) report.error(`${where}: nieprawidłowe pos [lon, lat]`);
      if (key === 'units') checkStrength(where, item, report);
      if (key === 'units' && item.dos !== undefined) {
        const e = checkDos(item.dos);
        if (e) report.error(`${where}: ${e}`);
      }
      if (key === 'units' && item.track !== undefined) {
        const r = checkTrack(item.track, item.pos);
        if (r.error) report.error(`${where}: ${r.error}`);
        else if (r.warn) report.warn(`${where}: ${r.warn}`);
      }
      if (key === 'contacts') {
        checkEstimates(where, item, report);
        if (!validTime(item.observed)) report.error(`${where}: nieprawidłowy czas obserwacji`);
        else if (validTime(data.time) && Date.parse(item.observed) > Date.parse(data.time))
          report.error(`${where}: obserwacja późniejsza niż czas tury`);
      }
    }
  }
  if (data.logistics !== undefined) {
    const r = checkLogistics(data.logistics, { strict: strictLogistics });
    for (const e of r.errors) report.error(`${label}: ${e}`);
    for (const w of r.warnings) report.warn(`${label}: ${w}`);
  }
  if (Array.isArray(data.units)) {
    checkHierarchy(label, data.units, report);
    checkFormations(label, data, report);
  }
  for (const [i, line] of (data.lines || []).entries()) {
    const where = `${label} lines[${line?.id ?? i}]`;
    if (!LINE_KINDS.includes(line.kind)) report.warn(`${where}: nieznany rodzaj „${line.kind}”`);
    if (!Array.isArray(line.coords) || line.coords.length < 2 || !line.coords.every(validPos))
      report.error(`${where}: linia wymaga co najmniej 2 punktów [lon, lat]`);
  }
}

// Początek trasy (track) powinien leżeć w poprzedniej pozycji jednostki (tolerancja ~100 m), inaczej animacja „skacze”.
const TRACK_START_TOLERANCE_KM = 0.1;
function checkTracksContinuity(label, prevUnits, units, report) {
  if (!Array.isArray(prevUnits) || !Array.isArray(units)) return;
  const prev = new Map(prevUnits.filter((u) => u?.id).map((u) => [u.id, u]));
  for (const u of units) {
    if (!u?.id || !Array.isArray(u.track) || !u.track.length || !validPos(u.track[0])) continue;
    const before = prev.get(u.id)?.pos;
    if (validPos(before) && distanceKm(before, u.track[0]) > TRACK_START_TOLERANCE_KM)
      report.warn(`${label} units[${u.id}]: pierwszy punkt track nie leży w poprzedniej pozycji jednostki`);
  }
}

// Gazeter (opcjonalny): unikalne id, poprawne pos, niepuste forms zawierające name.
function checkGazetteer(data, report) {
  if (!data || !Array.isArray(data.places)) {
    report.error('gazetteer.json: brak listy places');
    return;
  }
  const ids = new Set();
  for (const [i, p] of data.places.entries()) {
    const where = `gazetteer.json places[${p?.id ?? i}]`;
    if (typeof p?.id !== 'string' || !p.id) report.error(`${where}: brak id`);
    else if (ids.has(p.id)) report.error(`${where}: zduplikowane id`);
    else ids.add(p.id);
    if (typeof p?.name !== 'string' || !p.name.trim()) report.error(`${where}: brak nazwy`);
    if (!PLACE_KINDS.includes(p?.kind)) report.warn(`${where}: nieznany rodzaj „${p?.kind}”`);
    if (!validPos(p?.pos)) report.error(`${where}: nieprawidłowe pos [lon, lat]`);
    if (p?.zoom !== undefined && !(p.zoom >= 1 && p.zoom <= 19)) report.error(`${where}: zoom poza zakresem 1–19`);
    if (!Array.isArray(p?.forms) || p.forms.length === 0 || !p.forms.every((f) => typeof f === 'string' && f.trim()))
      report.error(`${where}: forms musi być niepustą listą tekstów`);
    else if (!p.forms.includes(p.name)) report.error(`${where}: forms nie zawiera nazwy „${p.name}”`);
  }
}

// ---------- T37: spójność i realizm (same uwagi) ----------

const sizeOf = (u) => (typeof u?.sidc === 'string' ? u.sidc[11] : undefined);

/** Suma dzieci większa niż stan rodzica (każdy poziom; rodzic ma też dowództwo/drużyny, więc mniejsza suma jest normalna). */
export function checkHierarchySums(label, units) {
  const out = [];
  if (!Array.isArray(units)) return out;
  const kids = new Map();
  for (const u of units) {
    if (!u?.id || typeof u.parent !== 'string') continue;
    if (!kids.has(u.parent)) kids.set(u.parent, []);
    kids.get(u.parent).push(u);
  }
  for (const p of units) {
    const ch = kids.get(p?.id);
    if (!ch || 'HIJKL'.includes(sizeOf(p) ?? '-')) continue; // dowództwo brygady i wyżej liczy tylko własny sztab
    for (const f of ['current', 'authorized']) {
      const withData = ch.filter((c) => isCount(c.personnel?.[f]));
      if (!isCount(p.personnel?.[f]) || !withData.length) continue;
      const sum = withData.reduce((a, c) => a + c.personnel[f], 0);
      if (sum > p.personnel[f]) out.push(`${label} units[${p.id}]: personnel.${f} (${p.personnel[f]}) < suma podwładnych (${sum})`);
    }
    if (!Array.isArray(p.equipment)) continue;
    for (const f of ['current', 'authorized']) {
      const sums = new Map();
      for (const c of ch) for (const e of c.equipment ?? []) if (e?.name && isCount(e[f])) sums.set(e.name, (sums.get(e.name) ?? 0) + e[f]);
      for (const e of p.equipment) {
        if (!sums.has(e?.name) || !isCount(e[f]) || sums.get(e.name) <= e[f]) continue;
        out.push(`${label} units[${p.id}] equipment[${e.name}]: ${f} (${e[f]}) < suma podwładnych (${sums.get(e.name)})`);
      }
    }
  }
  return out;
}

/** Id jednostek (z pos) leżących w którymś z poligonów wody. */
export function unitsInWater(units, polygons) {
  if (!Array.isArray(units) || !polygons?.length) return [];
  return units.filter((u) => u?.id && isCoord(u.pos) && pointInAny(u.pos, polygons)).map((u) => u.id);
}

/** Poligony wód z cache terrain.mjs obejmujące któryś z punktów (bez sieci; brak cache → []). */
export async function loadWaterPolygons(points, cacheDir = CACHE_DIR) {
  let names;
  try {
    names = (await fs.readdir(cacheDir)).filter((n) => /^water-.*\.json$/.test(n));
  } catch {
    return [];
  }
  const pts = points.filter(isCoord);
  const polys = [];
  for (const n of names) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(cacheDir, n), 'utf8'));
      const [x0, y0, x1, y1] = c.bbox ?? [];
      if (pts.some(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1)) polys.push(...(c.polygons ?? []));
    } catch {
      /* uszkodzony cache — pomiń */
    }
  }
  return polys;
}

/** Wiadomości skrzynki: czas nie powinien maleć w kolejności pliku. Zwraca id wiadomości cofających czas. */
export function inboxOutOfOrder(messages) {
  const bad = [];
  let prev = -Infinity;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!validTime(m?.time)) continue;
    const t = Date.parse(m.time);
    if (t < prev) bad.push(m.id ?? '?');
    else prev = t;
  }
  return bad;
}

const norm = (t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Frazy własnych jednostek (całe id i cała nazwa, też bez nawiasu / z rozdzielonym numerem) → id jednostki. */
export function ownNameKeys(ownUnits) {
  const keys = new Map();
  const add = (phrase, id) => {
    const p = norm(phrase);
    if (p.length >= 3 && /\p{L}/u.test(p) && !keys.has(p)) keys.set(p, id);
  };
  for (const u of ownUnits ?? []) {
    if (u?.id) {
      const id = String(u.id);
      add(id, u.id);
      add(id.replace(/-/g, ' '), u.id);
      add(id.replace(/^(\d+)(?=\p{L})/u, '$1 '), u.id);
    }
    if (u?.name) {
      add(u.name, u.id);
      add(String(u.name).replace(/\s*\([^)]*\)\s*/g, ' '), u.id);
    }
  }
  return keys;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);

/** Elementy wroga/kontaktów, których name lub id zawiera całą frazę (id lub nazwę) własnej jednostki z granicami słowa. Zwraca [{ id, word }]. */
export function enemyNameLeaks(ownUnits, enemyItems) {
  const keys = [...ownNameKeys(ownUnits)].map(([k]) => [k, new RegExp(`(?<![\\p{L}\\p{N}])${escRe(k)}(?![\\p{L}\\p{N}])`, 'u')]);
  const out = [];
  for (const e of enemyItems ?? []) {
    const text = norm(e?.name);
    const hit = keys.find(([, re]) => re.test(text));
    if (hit) out.push({ id: e.id, word: hit[0] });
  }
  return out;
}

/** status: finished wymaga umpire/aar.md. Zwraca listę uwag. */
export function checkFinishedAar(scenario, hasAar) {
  return scenario?.status === 'finished' && !hasAar ? ['scenario.json: status „finished” bez umpire/aar.md'] : [];
}

export async function validateScenario(dir) {
  const errors = [];
  const warnings = [];
  const report = { error: (m) => errors.push(m), warn: (m) => warnings.push(m) };

  const scenario = await readJsonSafe(path.join(dir, 'scenario.json'), report);
  if (scenario === undefined) {
    report.error('brak scenario.json');
    return { errors, warnings };
  }
  if (scenario === null) return { errors, warnings };

  for (const key of ['id', 'title', 'timezone', 'start']) if (!scenario[key]) report.error(`scenario.json: brak pola ${key}`);
  if (scenario.schemaVersion === undefined) report.warn('scenario.json: brak schemaVersion (oczekiwano ' + SCHEMA_VERSION + ')');
  else if (scenario.schemaVersion !== SCHEMA_VERSION) report.error(`scenario.json: schemaVersion ${scenario.schemaVersion}, obsługiwana wersja to ${SCHEMA_VERSION}`);
  if (!(scenario.turnMinutes > 0)) report.error('scenario.json: turnMinutes musi być > 0');
  if (scenario.timezone) {
    try {
      new Intl.DateTimeFormat('pl-PL', { timeZone: scenario.timezone });
    } catch {
      report.error(`scenario.json: nieznana strefa czasowa ${scenario.timezone}`);
    }
  }
  const channelIds = new Set();
  for (const c of scenario.channels || []) {
    if (!c.id || !c.name) report.error('scenario.json: kanał bez id lub nazwy');
    if (channelIds.has(c.id)) report.error(`scenario.json: zduplikowany kanał „${c.id}”`);
    channelIds.add(c.id);
    if (!CHANNEL_KINDS.includes(c.kind)) report.warn(`scenario.json: kanał „${c.id}” ma nieznany rodzaj „${c.kind}”`);
  }
  if (channelIds.size === 0) report.error('scenario.json: brak kanałów komunikatora');

  try {
    await fs.access(path.join(dir, 'briefing.md'));
  } catch {
    report.warn('brak briefing.md');
  }

  const gazetteer = await readJsonSafe(path.join(dir, 'gazetteer.json'), report);
  if (gazetteer !== undefined && gazetteer !== null) checkGazetteer(gazetteer, report);

  const turns = await numbered(path.join(dir, 'player', 'turns'));
  if (turns.length === 0) report.error('brak player/turns/000.json');
  turns.forEach((n, i) => {
    if (n !== i) report.error(`numeracja tur gracza nieciągła: oczekiwano ${pad(i)}, jest ${pad(n)}`);
  });
  const unitIdsByTurn = new Map();
  let prevUnits = null;
  const playerTurnData = new Map();
  for (const n of turns) {
    const data = await readJsonSafe(path.join(dir, 'player', 'turns', pad(n) + '.json'), report);
    if (data) unitIdsByTurn.set(n, new Set((data.units || []).map((u) => u?.id)));
    if (data) {
      checkSituation(`player/turns/${pad(n)}`, data, n, scenario, report, true);
      checkPlayerFields(`player/turns/${pad(n)}`, data, report);
      checkTracksContinuity(`player/turns/${pad(n)}`, prevUnits, data.units, report);
      for (const w of checkHierarchySums(`player/turns/${pad(n)}`, data.units)) report.warn(w);
      playerTurnData.set(n, data);
    }
    prevUnits = data?.units ?? null;
  }

  const messageIds = new Set();
  for (const kind of ['inbox', 'outbox']) {
    for (const n of await numbered(path.join(dir, 'player', kind))) {
      const label = `player/${kind}/${pad(n)}`;
      if (!turns.includes(n)) report.error(`${label}: brak odpowiadającej tury gracza`);
      const data = await readJsonSafe(path.join(dir, 'player', kind, pad(n) + '.json'), report);
      if (!data) continue;
      if (!Array.isArray(data.messages)) {
        report.error(`${label}: brak listy messages`);
        continue;
      }
      if (kind === 'inbox') for (const id of inboxOutOfOrder(data.messages)) report.warn(`${label} [${id}]: wiadomość poza kolejnością czasu`);
      for (const m of data.messages) {
        const where = `${label} [${m.id ?? '?'}]`;
        if (!m.id) report.error(`${where}: brak id`);
        else if (messageIds.has(m.id)) report.error(`${label}: zduplikowane id wiadomości „${m.id}”`);
        else messageIds.add(m.id);
        // Kanał to wpis ze scenario.json albo jednostka własna obecna w turze gracza (np. kompania).
        if (!channelIds.has(m.channel) && !unitIdsByTurn.get(n)?.has(m.channel))
          report.error(`${where}: nieznany kanał „${m.channel}”`);
        if (!validTime(m.time)) report.error(`${where}: nieprawidłowy czas`);
        const textError = checkMessageText(m.text);
        if (textError) report.error(`${where}: ${textError.toLowerCase()}`);
        const metaError = checkMessageMeta(m);
        if (metaError) report.error(`${where}: ${metaError.toLowerCase()}`);
        for (const f of extraFields(m, PLAYER_MESSAGE_FIELDS)) report.error(`${where}: pole „${f}” spoza schematu gracza (pole sędziego?)`);
      }
    }
  }

  // Szkice gracza: każdy rysunek przechodzi tę samą walidację co zapis przez API.
  for (const n of await numbered(path.join(dir, 'player', 'notes'))) {
    const label = `player/notes/${pad(n)}`;
    if (!turns.includes(n)) report.error(`${label}: brak odpowiadającej tury gracza`);
    const data = await readJsonSafe(path.join(dir, 'player', 'notes', pad(n) + '.json'), report);
    if (!data) continue;
    if (!Array.isArray(data.items)) {
      report.error(`${label}: brak listy items`);
      continue;
    }
    if (data.turn !== undefined && data.turn !== n) report.error(`${label}: pole turn = ${data.turn}, oczekiwano ${n}`);
    if (data.items.length > MAX_NOTES) report.error(`${label}: więcej niż ${MAX_NOTES} rysunków`);
    const ids = new Set();
    for (const it of data.items) {
      const r = checkNote(it);
      if (r.error) report.error(`${label} [${it?.id ?? '?'}]: ${r.error}`);
      if (it?.id && ids.has(it.id)) report.error(`${label}: zduplikowane id rysunku „${it.id}”`);
      if (it?.id) ids.add(it.id);
    }
  }

  const umpireTurns = await numbered(path.join(dir, 'umpire', 'turns'));
  for (const n of turns) if (!umpireTurns.includes(n)) report.warn(`brak umpire/turns/${pad(n)}.json (prawda dla tury ${n})`);
  const leaks = new Set();
  for (const n of umpireTurns) {
    const data = await readJsonSafe(path.join(dir, 'umpire', 'turns', pad(n) + '.json'), report);
    if (!data) continue;
    const ulabel = `umpire/turns/${pad(n)}`;
    checkSituation(ulabel, data, n, scenario, report);
    for (const w of checkHierarchySums(ulabel, data.units)) report.warn(w);
    const water = await loadWaterPolygons((data.units || []).map((u) => u?.pos));
    for (const id of unitsInWater(data.units, water)) report.warn(`${ulabel} units[${id}]: pozycja w wodzie`);
    const own = (data.units || []).filter((u) => u?.side === 'PL');
    const enemy = (data.units || []).filter((u) => u?.side && u.side !== 'PL');
    for (const l of enemyNameLeaks(own, enemy)) leaks.add(`${ulabel} units[${l.id}]: nazwa wroga zawiera nazwę własnej jednostki („${l.word}”)`);
    const pt = playerTurnData.get(n);
    for (const l of enemyNameLeaks(own, pt?.contacts)) leaks.add(`player/turns/${pad(n)} contacts[${l.id}]: nazwa kontaktu zawiera nazwę własnej jednostki („${l.word}”)`);
  }
  for (const w of leaks) report.warn(w);
  const hasAar = await fs.access(path.join(dir, 'umpire', 'aar.md')).then(() => true, () => false);
  for (const w of checkFinishedAar(scenario, hasAar)) report.warn(w);

  return { errors, warnings };
}

async function main() {
  const name = process.argv[2];
  if (!name) {
    console.error('Użycie: npm run validate -- <nazwa-scenariusza>');
    process.exit(2);
  }
  const dir = path.isAbsolute(name) ? name : path.join(ROOT, 'scenarios', name);
  const { errors, warnings } = await validateScenario(dir);
  for (const w of warnings) console.log('UWAGA  ' + w);
  for (const e of errors) console.log('BŁĄD   ' + e);
  console.log(errors.length ? `\n✗ ${errors.length} błędów, ${warnings.length} uwag` : `✓ scenariusz poprawny (${warnings.length} uwag)`);
  process.exit(errors.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

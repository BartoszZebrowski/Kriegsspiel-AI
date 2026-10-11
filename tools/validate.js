// Walidator scenariusza. Użycie: npm run validate -- <nazwa-scenariusza>
// Sprawdza pliki gracza i sędziego. Wypisuje tylko identyfikatory, nigdy treści z umpire/.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import milsymbol from 'milsymbol';
import { isDescribed } from '../public/js/sidc.js';
import { distanceKm } from '../public/js/domain/geo.js';
import {
  SCHEMA_VERSION, CHANNEL_KINDS, LINE_KINDS, PLACE_KINDS, PLAYER_TURN_FIELDS, PLAYER_FIELDS, PLAYER_MESSAGE_FIELDS,
  MAX_NOTES, checkTrack, isCoord, isValidTime, isCount, extraFields, checkNote, checkMessageText, checkMessageMeta,
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

function checkSituation(label, data, n, scenario, report) {
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
  for (const n of turns) {
    const data = await readJsonSafe(path.join(dir, 'player', 'turns', pad(n) + '.json'), report);
    if (data) unitIdsByTurn.set(n, new Set((data.units || []).map((u) => u?.id)));
    if (data) {
      checkSituation(`player/turns/${pad(n)}`, data, n, scenario, report);
      checkPlayerFields(`player/turns/${pad(n)}`, data, report);
      checkTracksContinuity(`player/turns/${pad(n)}`, prevUnits, data.units, report);
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
  for (const n of umpireTurns) {
    const data = await readJsonSafe(path.join(dir, 'umpire', 'turns', pad(n) + '.json'), report);
    if (data) checkSituation(`umpire/turns/${pad(n)}`, data, n, scenario, report);
  }

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

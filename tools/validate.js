// Walidator scenariusza. Użycie: npm run validate -- <nazwa-scenariusza>
// Sprawdza pliki gracza i sędziego. Wypisuje tylko identyfikatory, nigdy treści z umpire/.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SCHEMA_VERSION, CHANNEL_KINDS, checkCommandRules, PLAYER_MESSAGE_FIELDS, MAX_NOTES, isValidTime, extraFields, checkNote, checkMessageText, checkMessageMeta } from '../shared/schema.js';
import { checkDeliveries, checkEw } from '../shared/ew.js';
import { checkOrderAttachment } from '../shared/order.js';
import { checkPlayerFields, checkSituation, checkTracksContinuity, checkGazetteer } from './validate-checks.js';
import { checkFormShape } from '../shared/form.js';
import { checkOverlay } from '../shared/overlay.js';
import { checkFormContent, missingFields } from '../public/js/domain/forms.js';
import { createFireChecker } from './validate-fire.js';
import { checkCcirFile, checkReportCycleField, checkMessageCcirFields } from './validate-ccir.js';
import { loadCatalogIndex, checkEquipmentRefs } from './validate-equipment.js';
import { checkHierarchySums, unitsInWater, loadWaterPolygons, inboxOutOfOrder, enemyNameLeaks, checkFinishedAar } from './validate-realism.js';

// Sprawdzenia T37 (spójność i realizm) żyją w osobnym module; walidator zachowuje je w swoim publicznym API.
export * from './validate-realism.js';

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
  for (const m of checkCommandRules(scenario.commandRules)) report.error('scenario.json: ' + m);
  checkReportCycleField(scenario, report);
  const ccirIds = checkCcirFile(await readJsonSafe(path.join(dir, 'player', 'ccir.json'), report), report);
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

  const catalogIndex = await loadCatalogIndex(report);
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
      checkEquipmentRefs(`player/turns/${pad(n)}`, data, catalogIndex, report);
      checkTracksContinuity(`player/turns/${pad(n)}`, prevUnits, data.units, report);
      for (const w of checkHierarchySums(`player/turns/${pad(n)}`, data.units)) report.warn(w);
      playerTurnData.set(n, data);
    }
    prevUnits = data?.units ?? null;
  }

  const messageIds = new Set();
  const fireChecker = createFireChecker(report);
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
        if (kind === 'inbox') checkMessageCcirFields(where, m, ccirIds, report);
        else if (m.ccir !== undefined || m.report !== undefined) report.error(`${where}: pola ccir i report są tylko w wiadomościach sędziego (inbox)`);
        fireChecker.check(kind, where, m);
        if (m.overlay !== undefined) {
          // Nakładka od przełożonego (T51): tylko sędzia (inbox); elementy to szkice, nieznany znak taktyczny = błąd.
          if (kind === 'outbox') report.error(`${where}: pole overlay jest tylko w wiadomościach sędziego (inbox)`);
          else {
            const overlayError = checkOverlay(m.overlay);
            if (overlayError) report.error(`${where}: ${overlayError}`);
          }
        }
        if (m.form !== undefined) {
          // Formularz (T50): struktura i pola szablonu zawsze; braki wymaganych: błąd w outbox, uwaga w inbox (sędzia pisze swobodniej).
          const formError = checkFormShape(m.form) ?? checkFormContent(m.form);
          if (formError) report.error(`${where}: ${formError}`);
          else {
            const missing = missingFields(m.form);
            if (missing.length) report[kind === 'outbox' ? 'error' : 'warn'](`${where}: formularz ${m.form.kind} bez wymaganych pól: ${missing.join(', ')}`);
          }
        }
        for (const f of extraFields(m, PLAYER_MESSAGE_FIELDS)) report.error(`${where}: pole „${f}” spoza schematu gracza (pole sędziego?)`);
        // Rozkazy graficzne (T44) w załącznikach rozkazów gracza: struktura, geometria i jednostki z tury.
        if (kind === 'outbox') {
          for (const a of (Array.isArray(m.attachments) ? m.attachments : []).filter((x) => x?.kind === 'order')) {
            const r = checkOrderAttachment(a, unitIdsByTurn.get(n));
            if (r.error) report.error(`${where} rozkaz graficzny [${a.id ?? '?'}]: ${r.error}`);
          }
        }
      }
    }
  }

  fireChecker.finish();

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
    checkEquipmentRefs(ulabel, data, catalogIndex, report);
    if (data.deliveries !== undefined) {
      const r = checkDeliveries(data.deliveries);
      for (const e of r.errors) report.error(`${ulabel}: ${e}`);
      for (const w of r.warnings) report.warn(`${ulabel}: ${w}`);
    }
    if (data.ew !== undefined) for (const e of checkEw(data.ew)) report.error(`${ulabel}: ${e}`);
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

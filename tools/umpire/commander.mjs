// Dowódcy jako osobni agenci (T14): składa wejście dla agenta-dowódcy i zapisuje jego wynik w pliku wiedzy.
//
//   node tools/umpire/commander.mjs init    <scenariusz> <id> [--name "…"] [--role "…"] [--side PL|RU]
//   node tools/umpire/commander.mjs prepare <scenariusz> <id> [--turn N] [--reports plik.json] [--observations plik.json]
//   node tools/umpire/commander.mjs apply   <scenariusz> <id> --result plik.txt [--turn N] [--reports …] [--observations …] [--dry]
//
// `prepare` wypisuje pełny prompt dla subagenta (plik wiedzy dowódcy + wiadomość wejściowa). Agent dostaje WYŁĄCZNIE to.
// `apply` sprawdza odpowiedź agenta, aktualizuje jego plik wiedzy i wypisuje wiadomość do inboxu oraz rozkazy dla podwładnych.
//
// Uczciwość: wejście powstaje z plików jawnych dla gracza (scenario.json, player/turns, player/outbox) i z plików
// podanych przez sędziego (--reports, --observations), przepuszczonych przez białą listę pól gracza. Narzędzie nie czyta
// prawdy sędziego ani plików innych dowódców; zapisuje tylko plik wiedzy wskazanego dowódcy. Format: docs/UMPIRE-TOOLS.md.
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PLAYER_FIELDS, PLAYER_MESSAGE_FIELDS, isCoord } from '../../shared/schema.js';
import {
  checkCommanderId, checkCommanderFile, commanderTemplate, parseCommanderResult, checkCommanderResult, getSection, setSection, appendToSection,
} from '../../shared/commander.js';
import { pickFields } from './turn-merge.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const R_EARTH = 6371008.8;
const PLACEHOLDER = /^\(brak/;

/** Odległość w metrach (haversine) między punktami [lon, lat]. */
export function distanceM(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(h));
}

/** Id jednostki `rootId` i wszystkich jej podwładnych (przez `parent`), w kolejności od korzenia. */
export function subtreeIds(units, rootId) {
  const out = [rootId];
  const seen = new Set(out);
  for (let i = 0; i < out.length; i++) {
    for (const u of units) if (u?.parent === out[i] && !seen.has(u.id)) { seen.add(u.id); out.push(u.id); }
  }
  return out;
}

const hhmm = (iso) => (typeof iso === 'string' && /T\d\d:\d\d/.test(iso) ? iso.slice(11, 16) : '??:??');

/**
 * Składa wejście agenta z danych już oczyszczonych do widoku gracza. Wszystko przechodzi przez białe listy pól,
 * więc `side`, `supply`, `events` itp. nie mają jak się znaleźć w wiadomości.
 *   commanderId, root (id jednostki dowódcy), turn, time,
 *   units (jednostki własne: poddrzewo dowódcy), orders (wiadomości od przełożonego/gracza z attachments),
 *   reports (meldunki podwładnych dostarczone przez sędziego: {from, time, text}), contacts (co dowódca widzi),
 *   observations (swobodne notatki sędziego o tym, co dowódca widzi/słyszy: [{time?, text}]).
 */
export function buildCommanderInput({ commanderId, root, turn, time, units = [], orders = [], reports = [], contacts = [], observations = [] }) {
  const own = units.map((u) => pickFields(u, PLAYER_FIELDS.units));
  const ids = new Set(own.map((u) => u.id));
  return {
    commander: commanderId,
    root,
    turn,
    time,
    units: own,
    subordinates: own.filter((u) => u.parent === root).map((u) => u.id),
    orders: orders.map((m) => pickFields(m, PLAYER_MESSAGE_FIELDS)),
    reports: reports.map((r) => pickFields(r, ['from', 'time', 'text'])),
    contacts: contacts.map((c) => pickFields(c, PLAYER_FIELDS.contacts)),
    observations: observations.map((o) => pickFields(o, ['time', 'text'])),
    knownUnitIds: [...ids],
  };
}

/**
 * Wejście dla dowódcy podwładnego gracza z widoku gracza: jego poddrzewo, rozkazy z outboxu skierowane do jego kanału
 * lub jednostki, kontakty w promieniu `radiusM` od jego jednostek. Zwraca argumenty dla buildCommanderInput.
 */
export function playerCommanderArgs({ scenario, commanderId, playerTurn, outbox = [], reports = [], observations = [], radiusM = 15000 }) {
  const channel = (scenario.channels || []).find((c) => c.commander === commanderId);
  if (!channel) throw new Error(`Żaden kanał scenariusza nie ma commander: "${commanderId}" (dowódca przeciwnika wymaga --observations z polem units i root)`);
  const root = channel.unit ?? channel.id;
  const all = playerTurn.units || [];
  if (!all.some((u) => u?.id === root)) throw new Error(`Jednostka „${root}” dowódcy nie istnieje w turze ${playerTurn.turn}`);
  const ids = new Set(subtreeIds(all, root));
  const units = all.filter((u) => ids.has(u.id));
  const addressed = new Set([channel.id, root]);
  const contacts = (playerTurn.contacts || []).filter((c) => isCoord(c?.pos) && units.some((u) => isCoord(u.pos) && distanceM(u.pos, c.pos) <= radiusM));
  return {
    commanderId, root, turn: playerTurn.turn, time: playerTurn.time, units, contacts, reports, observations,
    orders: outbox.filter((m) => addressed.has(m?.channel)),
  };
}

/** Prompt dla subagenta: zasady, plik wiedzy, wiadomość wejściowa, wymagany format odpowiedzi. */
export function renderAgentPrompt(knowledgeMd, input) {
  const { knownUnitIds, ...visible } = input; // eslint-disable-line no-unused-vars
  return [
    `Jesteś dowódcą w grze sztabowej (Kriegsspiel). Grasz TYLKO tę postać. Znasz wyłącznie swój plik wiedzy i wiadomość wejściową poniżej.`,
    `Nie masz dostępu do żadnych innych plików ani informacji — nie szukaj ich i nie zgaduj prawdy o sytuacji. Możesz się mylić, ostrzegać, zwlekać albo zgłosić zastrzeżenia, zgodnie ze swoją osobowością.`,
    `Zdecyduj, co robisz w tej turze: wydaj rozkazy swoim bezpośrednim podwładnym (pole subordinates), napisz krótki meldunek do przełożonego (styl wojskowy, po polsku, z liczbami, bez żargonu) i zaktualizuj swoją wiedzę o sytuacji.`,
    ``,
    `=== TWÓJ PLIK WIEDZY ===`,
    knowledgeMd.trim(),
    ``,
    `=== WIADOMOŚĆ WEJŚCIOWA (tura ${input.turn}, ${hhmm(input.time)}) ===`,
    JSON.stringify(visible, null, 2),
    ``,
    `=== FORMAT ODPOWIEDZI ===`,
    `Odpowiedz wyłącznie blokiem JSON (bez komentarza poza nim):`,
    '```json',
    JSON.stringify({
      commander: input.commander,
      turn: input.turn,
      orders: [{ to: '<id podwładnego z subordinates>', text: 'treść rozkazu', task: 'move|occupy|defend|attack|recon (opcjonalnie)', area: 'nazwa szkicu/rejonu (opcjonalnie)' }],
      report: { text: 'meldunek do przełożonego (pomiń pole, gdy nie ma czego meldować)' },
      knowledge: { situation: 'co teraz wiem o sytuacji (zastąpi poprzednią wersję)', decision: 'krótko: co postanowiłem i dlaczego' },
    }, null, 2),
    '```',
  ].join('\n');
}

/** Nowy tekst pliku wiedzy po turze: rozkazy otrzymane, sytuacja (zastępowana), wpis w dzienniku decyzji. */
export function applyTurnToKnowledge(md, { input, result }) {
  const stamp = `Tura ${input.turn} (${hhmm(input.time)})`;
  let out = md;
  const received = (input.orders || []).map((m) => {
    const sketches = (m.attachments || []).filter((a) => a?.kind === 'order').map((a) => `szkic „${a.name}” (${a.task})`);
    return `- ${stamp}, od ${m.from || 'przełożonego'}: ${m.text}${sketches.length ? ` [${sketches.join('; ')}]` : ''}`;
  });
  if (received.length) {
    const cur = getSection(out, 'Otrzymane rozkazy i szkice');
    out = setSection(out, 'Otrzymane rozkazy i szkice', cur && !PLACEHOLDER.test(cur) ? `${cur}\n${received.join('\n')}` : received.join('\n'));
  }
  out = setSection(out, 'Co wiem o sytuacji', `(stan na ${stamp})\n\n${result.knowledge.situation.trim()}`);
  const lines = [`### ${stamp}`, result.knowledge.decision.trim()];
  for (const o of result.orders || []) lines.push(`- rozkaz dla ${o.to}: ${o.text}`);
  if (result.report) lines.push(`- meldunek do przełożonego: ${result.report.text}`);
  const cur = getSection(out, 'Dziennik decyzji');
  const entry = lines.join('\n');
  return setSection(out, 'Dziennik decyzji', cur && !PLACEHOLDER.test(cur) ? `${cur}\n\n${entry}` : entry);
}

/**
 * Wynik agenta → to, co sędzia wkłada do tury: wiadomość meldunkowa do inboxu (kanał dowódcy) i rozkazy dla podwładnych
 * (do rozstrzygnięcia wobec prawdy; na stronie gracza nie trafiają do jego outboxu). `id` wiadomości: `${idPrefix}-NN`.
 */
export function resultToMessages(result, { channel, from, time, idPrefix }) {
  const messages = [];
  if (result.report) messages.push({ id: `${idPrefix}-01`, channel, from, time, type: 'meldunek', text: result.report.text.trim() });
  return { messages, orders: (result.orders || []).map((o) => ({ ...o })) };
}

// --- CLI ---

const pad3 = (n) => String(n).padStart(3, '0');
const readJson = async (p, fallback) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch (err) { if (err.code === 'ENOENT' && fallback !== undefined) return fallback; throw err; }
};

function parseArgs(argv) {
  const [cmd, scenarioName, id, ...rest] = argv;
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    if (!rest[i].startsWith('--')) continue;
    const k = rest[i].slice(2);
    opts[k] = rest[i + 1] === undefined || rest[i + 1].startsWith('--') ? true : rest[++i];
  }
  return { cmd, scenarioName, id, opts };
}

async function loadContext({ dir, id, opts }) {
  const scenario = await readJson(path.join(dir, 'scenario.json'));
  const turnsDir = path.join(dir, 'player', 'turns');
  const nums = (await readdir(turnsDir)).filter((f) => /^\d{3,4}\.json$/.test(f)).map((f) => Number(f.slice(0, -5)));
  const turn = opts.turn !== undefined ? Number(opts.turn) : Math.max(...nums);
  const playerTurn = await readJson(path.join(turnsDir, pad3(turn) + '.json'));
  const outbox = (await readJson(path.join(dir, 'player', 'outbox', pad3(turn) + '.json'), { messages: [] })).messages || [];
  const reports = opts.reports ? await readJson(path.resolve(opts.reports)) : [];
  const obs = opts.observations ? await readJson(path.resolve(opts.observations)) : null;
  let args;
  if (obs && !(scenario.channels || []).some((c) => c.commander === id)) {
    // dowódca przeciwnika: wejście wyłącznie z pliku obserwacji napisanego przez sędziego (wyniki jego rozpoznania)
    args = { commanderId: id, root: obs.root, turn, time: obs.time ?? playerTurn.time, units: obs.units || [], orders: obs.orders || [], reports: obs.reports || reports, contacts: obs.contacts || [], observations: obs.notes || [] };
  } else {
    args = playerCommanderArgs({ scenario, commanderId: id, playerTurn, outbox, reports, observations: obs?.notes || [] });
  }
  const input = buildCommanderInput(args);
  const file = path.join(dir, 'umpire', 'commanders', id + '.md');
  const channel = (scenario.channels || []).find((c) => c.commander === id)?.id ?? null;
  return { scenario, turn, input, file, channel };
}

async function main() {
  const { cmd, scenarioName, id, opts } = parseArgs(process.argv.slice(2));
  if (!cmd || !scenarioName || !id || !['init', 'prepare', 'apply'].includes(cmd)) {
    console.error('Użycie: node tools/umpire/commander.mjs <init|prepare|apply> <scenariusz> <id-dowódcy> [opcje]');
    process.exit(2);
  }
  const idError = checkCommanderId(id);
  if (idError) { console.error(idError); process.exit(2); }
  const dir = path.isAbsolute(scenarioName) ? scenarioName : path.join(ROOT, 'scenarios', scenarioName);
  const file = path.join(dir, 'umpire', 'commanders', id + '.md');

  if (cmd === 'init') {
    await mkdir(path.dirname(file), { recursive: true });
    try { await readFile(file); console.error(`Plik ${id}.md już istnieje — nie nadpisuję.`); process.exit(1); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    await writeFile(file, commanderTemplate({ id, name: opts.name === true ? undefined : opts.name, role: opts.role === true ? undefined : opts.role, side: opts.side === true ? undefined : opts.side }));
    console.log(`Utworzono umpire/commanders/${id}.md — uzupełnij sekcje przed pierwszą turą.`);
    return;
  }

  const { turn, input, channel } = await loadContext({ dir, id, opts });
  const md = await readFile(file, 'utf8');
  const fileErrors = checkCommanderFile(md);
  if (fileErrors.length) { console.error(`Plik wiedzy ${id}.md niepoprawny: ${fileErrors.join('; ')}`); process.exit(1); }

  if (cmd === 'prepare') { console.log(renderAgentPrompt(md, input)); return; }

  if (!opts.result || opts.result === true) { console.error('Brak --result <plik z odpowiedzią agenta>'); process.exit(2); }
  const parsed = parseCommanderResult(await readFile(path.resolve(opts.result), 'utf8'));
  if (parsed.error) { console.error(parsed.error); process.exit(1); }
  const errors = checkCommanderResult(parsed.result, { commanderId: id, turn, subordinateIds: input.subordinates });
  if (errors.length) { console.error('Odpowiedź agenta odrzucona:\n- ' + errors.join('\n- ')); process.exit(1); }
  const next = applyTurnToKnowledge(md, { input, result: parsed.result });
  const bad = checkCommanderFile(next);
  if (bad.length) { console.error('Po aktualizacji plik byłby niepoprawny: ' + bad.join('; ')); process.exit(1); }
  if (!opts.dry) await writeFile(file, next);
  const root = input.units.find((u) => u.id === input.root);
  const out = resultToMessages(parsed.result, { channel: channel ?? input.root, from: root?.name ?? id, time: input.time, idPrefix: `in-${pad3(turn + 1)}-${id}` });
  console.log(JSON.stringify(out, null, 2));
  console.error(opts.dry ? '(--dry: plik wiedzy nie zapisany)' : `Zapisano umpire/commanders/${id}.md`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main().catch((e) => { console.error(e.message); process.exit(1); });

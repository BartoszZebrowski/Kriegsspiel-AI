// Dostęp do plików scenariusza widocznych dla gracza.
// Celowo nie ma tu żadnej funkcji czytającej katalog umpire/ — prawda nie wychodzi przez serwer.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { MAX_MESSAGE_LENGTH, MAX_NOTES, NOTE_KINDS, NOTE_COLORS, NOTE_GRAPHICS, NOTE_ECHELONS, checkNote, checkMessageText, checkMessageMeta } from '../shared/schema.js';

// Stałe schematu żyją w shared/schema.js; tu tylko re-eksport dla zgodności wstecznej.
export { MAX_MESSAGE_LENGTH, MAX_NOTES, NOTE_KINDS, NOTE_COLORS, NOTE_GRAPHICS, NOTE_ECHELONS };

export function validateNote(n) {
  const r = checkNote(n);
  if (r.error) throw new StoreError(400, `Rysunek ${n?.id ?? '?'}: ${r.error}`);
  return r.note;
}

export class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Czy jednostka należy do formacji sąsiada: ma `formation` albo przełożonego (po parent), który je ma.
export function isNeighbourFormationUnit(units, id) {
  const byId = new Map(units.filter((u) => u?.id).map((u) => [u.id, u]));
  const seen = new Set();
  for (let u = byId.get(id); u && !seen.has(u.id); u = byId.get(u.parent)) {
    if (typeof u.formation === 'string') return true;
    seen.add(u.id);
  }
  return false;
}

export function turnFileName(n) {
  return String(n).padStart(3, '0') + '.json';
}

export function parseTurnNumber(raw) {
  if (!/^\d{1,4}$/.test(String(raw))) throw new StoreError(400, 'Nieprawidłowy numer tury');
  return Number(raw);
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT' && fallback !== undefined) return fallback;
    if (err.code === 'ENOENT') throw new StoreError(404, 'Nie znaleziono: ' + path.basename(file));
    throw new StoreError(500, `Błąd odczytu ${path.basename(file)}: ${err.message}`);
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // Unikalna nazwa pliku tymczasowego (pid + licznik + losowy sufiks) — równoległe zapisy się nie nadpisują.
  const tmp = `${file}.${process.pid}.${++tmpCounter}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

let tmpCounter = 0;

// Kolejka zapisów na scenariusz (wspólna dla wszystkich store'ów tego samego katalogu w procesie):
// operacje „odczyt → zmiana → zapis” wykonują się po kolei, więc nie gubią sobie zmian.
const queues = new Map();
function withLock(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
}

async function listNumbered(dir) {
  let names;
  try {
    names = await fs.readdir(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return names
    .filter((n) => /^\d{3,4}\.json$/.test(n))
    .map((n) => Number(n.slice(0, -5)))
    .sort((a, b) => a - b);
}

export function createStore(scenarioDir) {
  const lockKey = path.resolve(scenarioDir);
  const locked = (fn) => withLock(lockKey, fn);
  const playerDir = path.join(scenarioDir, 'player');
  const dirs = {
    turns: path.join(playerDir, 'turns'),
    inbox: path.join(playerDir, 'inbox'),
    outbox: path.join(playerDir, 'outbox'),
    notes: path.join(playerDir, 'notes'),
  };

  async function readScenario() {
    return readJson(path.join(scenarioDir, 'scenario.json'));
  }

  async function listTurns() {
    return listNumbered(dirs.turns);
  }

  async function currentTurn() {
    const turns = await listTurns();
    if (turns.length === 0) throw new StoreError(500, 'Scenariusz nie ma żadnej tury gracza');
    return turns[turns.length - 1];
  }

  async function readTurn(n) {
    return readJson(path.join(dirs.turns, turnFileName(n)));
  }

  async function readBriefing() {
    try {
      return await fs.readFile(path.join(scenarioDir, 'briefing.md'), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(404, 'Scenariusz nie ma odprawy');
      throw err;
    }
  }

  // Gazeter miejsc scenariusza (plik jawny dla gracza); brak pliku = 404 (klient traktuje jak pustą listę).
  async function readGazetteer() {
    const data = await readJson(path.join(scenarioDir, 'gazetteer.json'));
    return { places: Array.isArray(data?.places) ? data.places : [] };
  }

  async function readMessageFile(kind, n) {
    const data = await readJson(path.join(dirs[kind], turnFileName(n)), { messages: [] });
    return Array.isArray(data.messages) ? data.messages : [];
  }

  async function readMessages() {
    const all = [];
    for (const kind of ['inbox', 'outbox']) {
      for (const n of await listNumbered(dirs[kind])) {
        for (const m of await readMessageFile(kind, n)) {
          all.push({ ...m, turn: m.turn ?? n, direction: kind === 'inbox' ? 'in' : 'out' });
        }
      }
    }
    all.sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || a.turn - b.turn);
    return all;
  }

  // Szkice gracza dla tury n: własny plik albo przeniesione z ostatniej wcześniejszej tury.
  async function readNotes(n) {
    const turns = await listTurns();
    if (!turns.includes(n)) throw new StoreError(404, 'Nie ma takiej tury');
    const files = (await listNumbered(dirs.notes)).filter((t) => t <= n);
    if (files.length === 0) return { turn: n, items: [], inheritedFrom: null };
    const src = files.at(-1);
    const data = await readJson(path.join(dirs.notes, turnFileName(src)), { items: [] });
    return { turn: n, items: Array.isArray(data.items) ? data.items : [], inheritedFrom: src === n ? null : src };
  }

  function writeNotes(turnNumber, items) {
    return locked(() => writeNotesUnlocked(turnNumber, items));
  }

  async function writeNotesUnlocked(turnNumber, items) {
    const n = await currentTurn();
    if (turnNumber !== n) throw new StoreError(409, 'Szkice można zmieniać tylko w bieżącej turze');
    if (!Array.isArray(items)) throw new StoreError(400, 'Brak listy rysunków');
    if (items.length > MAX_NOTES) throw new StoreError(400, `Maksymalnie ${MAX_NOTES} rysunków`);
    const clean = items.map(validateNote);
    const ids = new Set();
    for (const it of clean) {
      if (ids.has(it.id)) throw new StoreError(400, `Zduplikowane id rysunku ${it.id}`);
      ids.add(it.id);
    }
    await writeJson(path.join(dirs.notes, turnFileName(n)), { turn: n, items: clean });
    return { turn: n, items: clean, inheritedFrom: null };
  }

  function sendMessage(body) {
    return locked(() => sendMessageUnlocked(body));
  }

  async function sendMessageUnlocked({ channel, text, attachments, type, priority }) {
    const scenario = await readScenario();
    const n = await currentTurn();
    const turn = await readTurn(n);
    // Kanały: z scenario.json oraz każda jednostka z bieżącej tury gracza (np. kompanie).
    const scenarioChannels = new Set((scenario.channels || []).map((c) => c.id));
    const units = turn.units || [];
    const channels = new Set([...scenarioChannels, ...units.map((u) => u?.id)]);
    if (typeof channel !== 'string' || !channels.has(channel)) {
      throw new StoreError(400, 'Nieznany kanał');
    }
    // Formacje sąsiadów (units[].formation, także ich podwładni przez parent) nie podlegają graczowi: brak kanału.
    if (!scenarioChannels.has(channel) && isNeighbourFormationUnit(units, channel)) {
      throw new StoreError(400, 'Ta jednostka należy do formacji sąsiada — brak kanału łączności');
    }
    const textError = checkMessageText(text);
    if (textError) throw new StoreError(400, textError);
    const metaError = checkMessageMeta({ type, priority });
    if (metaError) throw new StoreError(400, metaError);
    let attached;
    if (attachments !== undefined) {
      if (!Array.isArray(attachments) || attachments.length > 20) throw new StoreError(400, 'Nieprawidłowe załączniki');
      const { items } = await readNotes(n);
      attached = attachments.map((id) => {
        const note = items.find((it) => it.id === id);
        if (!note) throw new StoreError(400, `Nie ma rysunku ${id}`);
        return note;
      });
    }
    const file = path.join(dirs.outbox, turnFileName(n));
    const data = await readJson(file, { messages: [] });
    const message = {
      id: 'out-' + crypto.randomUUID().slice(0, 8),
      channel,
      turn: n,
      time: turn.time,
      sent: new Date().toISOString(),
      type: type ?? 'wiadomosc',
      priority: priority ?? 'normal',
      text: text.trim(),
    };
    if (attached?.length) message.attachments = attached;
    data.messages = [...(data.messages || []), message];
    await writeJson(file, data);
    return message;
  }

  function withdrawMessage(id) {
    return locked(() => withdrawMessageUnlocked(id));
  }

  async function withdrawMessageUnlocked(id) {
    const n = await currentTurn();
    for (const t of await listNumbered(dirs.outbox)) {
      const file = path.join(dirs.outbox, turnFileName(t));
      const data = await readJson(file, { messages: [] });
      const idx = (data.messages || []).findIndex((m) => m.id === id);
      if (idx === -1) continue;
      if (t !== n) throw new StoreError(409, 'Tura już rozstrzygnięta — nie można wycofać rozkazu');
      data.messages.splice(idx, 1);
      await writeJson(file, data);
      return;
    }
    throw new StoreError(404, 'Nie znaleziono wiadomości');
  }

  return {
    scenarioDir,
    playerDir,
    readScenario,
    listTurns,
    currentTurn,
    readTurn,
    readBriefing,
    readGazetteer,
    readMessages,
    sendMessage,
    withdrawMessage,
    readNotes,
    writeNotes,
  };
}

// Serwer HTTP: aplikacja (public/), biblioteki (vendor/) i API scenariusza.
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, parseTurnNumber, StoreError } from './store.js';
import { createWatcher } from './watch.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY = 2 * 1024 * 1024;

// Jawna lista plików bibliotek — nic spoza niej nie jest serwowane z node_modules.
const VENDOR = {
  'leaflet/leaflet.js': 'node_modules/leaflet/dist/leaflet.js',
  'leaflet/leaflet.css': 'node_modules/leaflet/dist/leaflet.css',
  'milsymbol.js': 'node_modules/milsymbol/dist/milsymbol.js',
  'geoman/leaflet-geoman.js': 'node_modules/@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.js',
  'geoman/leaflet-geoman.css': 'node_modules/@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css',
};
for (const img of ['layers.png', 'layers-2x.png', 'marker-icon.png', 'marker-icon-2x.png', 'marker-shadow.png']) {
  VENDOR[`leaflet/images/${img}`] = `node_modules/leaflet/dist/images/${img}`;
}

// Jawna lista plików współdzielonych z klientem (tylko do odczytu) — /shared/<klucz>.
const SHARED = {
  'schema.js': 'shared/schema.js',
};

// Jawna lista plików danych (katalog wyposażenia, T46) — /data/<klucz>, tylko do odczytu.
const DATA = {
  'equipment.json': 'data/equipment.json',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': TYPES['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function sendFile(res, file) {
  const body = await fs.readFile(file);
  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new StoreError(413, 'Za duże żądanie');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new StoreError(400, 'Nieprawidłowy JSON');
  }
}

// Ochrona API przed atakami z innych stron: DNS rebinding (Host) i CSRF (Origin, Content-Type).
// port — faktyczny port nasłuchu; serwer jest lokalny, więc dopuszczamy tylko localhost i 127.0.0.1.
function guardApi(req, port) {
  const hosts = [`localhost:${port}`, `127.0.0.1:${port}`];
  if (!hosts.includes(String(req.headers.host || '').toLowerCase())) {
    throw new StoreError(403, 'Niedozwolony nagłówek Host');
  }
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin !== undefined && !hosts.some((h) => origin === `http://${h}`)) {
    throw new StoreError(403, 'Niedozwolone pochodzenie żądania (Origin)');
  }
  // Żądania z ciałem (POST/PUT) muszą być JSON-em — formularz z obcej strony nie ustawi takiego typu bez preflightu.
  // DELETE nie ma ciała, a z przeglądarki i tak wymaga preflightu, więc wystarcza Host i Origin.
  if (req.method === 'POST' || req.method === 'PUT') {
    const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') throw new StoreError(403, 'Wymagany Content-Type: application/json');
  }
}

async function handleApi(req, res, store, watcher, parts) {
  const [resource, arg] = parts;
  const method = req.method;

  if (method === 'GET' && resource === 'scenario' && !arg) {
    const scenario = await store.readScenario();
    const turns = await store.listTurns();
    return sendJson(res, 200, { scenario, turns, currentTurn: turns.at(-1) ?? null });
  }
  if (method === 'GET' && resource === 'turn' && arg !== undefined) {
    return sendJson(res, 200, await store.readTurn(parseTurnNumber(arg)));
  }
  if (method === 'GET' && resource === 'briefing' && !arg) {
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(await store.readBriefing());
  }
  if (method === 'GET' && resource === 'gazetteer' && !arg) {
    return sendJson(res, 200, await store.readGazetteer());
  }
  if (method === 'GET' && resource === 'messages' && !arg) {
    return sendJson(res, 200, { messages: await store.readMessages() });
  }
  if (method === 'POST' && resource === 'outbox' && !arg) {
    return sendJson(res, 201, await store.sendMessage(await readBody(req)));
  }
  if (method === 'DELETE' && resource === 'outbox' && arg) {
    await store.withdrawMessage(arg);
    return sendJson(res, 200, { ok: true });
  }
  if (method === 'GET' && resource === 'notes' && arg !== undefined) {
    return sendJson(res, 200, await store.readNotes(parseTurnNumber(arg)));
  }
  if (method === 'PUT' && resource === 'notes' && !arg) {
    const body = await readBody(req);
    return sendJson(res, 200, await store.writeNotes(body.turn, body.items));
  }
  if (method === 'GET' && resource === 'ccir' && !arg) {
    return sendJson(res, 200, await store.readCcir());
  }
  if (method === 'PUT' && resource === 'ccir' && !arg) {
    const body = await readBody(req);
    return sendJson(res, 200, await store.writeCcir(body.items));
  }
  if (method === 'GET' && resource === 'events' && !arg) {
    return watcher.subscribe(req, res);
  }
  throw new StoreError(404, 'Nieznany adres API');
}

async function handleStatic(res, pathname) {
  if (pathname.startsWith('/shared/')) {
    const rel = SHARED[pathname.slice('/shared/'.length)];
    if (!rel) throw new StoreError(404, 'Nie znaleziono');
    return sendFile(res, path.join(ROOT, rel));
  }
  if (pathname.startsWith('/data/')) {
    const key = pathname.slice('/data/'.length);
    const rel = Object.hasOwn(DATA, key) ? DATA[key] : null;
    if (!rel) throw new StoreError(404, 'Nie znaleziono');
    return sendFile(res, path.join(ROOT, rel));
  }
  if (pathname.startsWith('/vendor/')) {
    const rel = VENDOR[pathname.slice('/vendor/'.length)];
    if (!rel) throw new StoreError(404, 'Nie znaleziono');
    return sendFile(res, path.join(ROOT, rel));
  }
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new StoreError(404, 'Nie znaleziono');
  try {
    return await sendFile(res, file);
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'EISDIR') throw new StoreError(404, 'Nie znaleziono');
    throw err;
  }
}

export function createApp(scenarioDir) {
  const store = createStore(scenarioDir);
  const watcher = createWatcher(scenarioDir);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        throw new StoreError(400, 'Nieprawidłowy adres');
      }
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').includes('..')) {
        throw new StoreError(404, 'Nie znaleziono');
      }
      if (pathname.startsWith('/api/')) {
        guardApi(req, server.address().port);
        const parts = pathname.slice(5).split('/').filter(Boolean);
        return await handleApi(req, res, store, watcher, parts);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new StoreError(405, 'Niedozwolona metoda');
      return await handleStatic(res, pathname);
    } catch (err) {
      const status = err instanceof StoreError ? err.status : 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) sendJson(res, status, { error: err.message });
      else res.end();
    }
  });

  server.on('close', () => watcher.close());
  return { server, store, watcher };
}

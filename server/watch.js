// Obserwuje pliki widoczne dla gracza i powiadamia przeglądarkę (Server-Sent Events).
// Zmiany w umpire/ są ignorowane, żeby nie zdradzały aktywności sędziego.
import fs from 'node:fs';
import path from 'node:path';

const DEBOUNCE_MS = 300;

export function isPlayerVisible(relPath) {
  const p = relPath.split(path.sep).join('/');
  if (p.endsWith('.tmp')) return false;
  return p === 'scenario.json' || p === 'briefing.md' || p.startsWith('player/');
}

export function createWatcher(scenarioDir) {
  const clients = new Set();
  let timer = null;

  function broadcast() {
    timer = null;
    for (const res of clients) res.write(`event: update\ndata: ${Date.now()}\n\n`);
  }

  let fsWatcher = null;
  try {
    fsWatcher = fs.watch(scenarioDir, { recursive: true }, (_event, filename) => {
      if (!filename || !isPlayerVisible(String(filename))) return;
      clearTimeout(timer);
      timer = setTimeout(broadcast, DEBOUNCE_MS);
    });
  } catch (err) {
    console.warn('Obserwowanie plików niedostępne:', err.message);
  }

  const keepAlive = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25000);
  keepAlive.unref();

  return {
    subscribe(req, res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      clients.add(res);
      req.on('close', () => clients.delete(res));
    },
    close() {
      clearTimeout(timer);
      clearInterval(keepAlive);
      fsWatcher?.close();
      for (const res of clients) res.end();
      clients.clear();
    },
  };
}

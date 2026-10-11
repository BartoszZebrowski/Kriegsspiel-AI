// Zrzut mapy terenu dla sędziego: Leaflet + podkład (OpenTopoMap domyślnie) + siatka pikseli + symbole NATO,
// renderowane w headless Chrome (CDP). Sędzia ogląda PNG i wybiera pozycje pikselami (pick.mjs).
//
// node tools/umpire/terrain-view.mjs --turn <turn.json> [--center lon,lat | --unit <id> | --bbox minLon,minLat,maxLon,maxLat]
//   [--zoom 13] [--size 1200x900] [--base topo|osm|satellite|dark] [--hillshade]
//   [--show own,enemy,contacts,neighbors] [--contacts <plik tury gracza>] [--highlight id,id] [--facing 330]
//   [--grid 50] [--timeout 20000] --out <plik.png>
//
// Obok PNG powstaje <out>.json (meta do pixelToLonLat/lonLatToPixel + lista jednostek z pikselami).
// Chrome: CHROME_PATH albo typowe lokalizacje. Zabija tylko własny proces (po PID).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitZoom, lonLatToPixel, pixelToLonLat, project, snapCenter, unproject } from './pick.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASES = ['topo', 'osm', 'satellite', 'dark'];

export function findChrome() {
  const env = process.env;
  return [
    env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean).find((p) => existsSync(p));
}

/** Klasyfikacja jednostki z pliku tury: own | enemy | neighbor. */
export function classify(u) {
  if (u.side && u.side !== 'PL') return 'enemy';
  if (u.formation || /^zt-/.test(u.id)) return 'neighbor';
  return 'own';
}

/** Zbiera elementy do narysowania (bez filtrowania po widoku). */
export function collectUnits({ turn, contactsTurn, show, highlight }) {
  const out = [];
  for (const u of turn.units || []) {
    if (!u.pos || !u.sidc) continue;
    const kind = classify(u);
    const key = kind === 'neighbor' ? 'neighbors' : kind;
    if (!show.has(key)) continue;
    out.push({ id: u.id, kind, sidc: u.sidc, pos: u.pos, highlight: highlight.has(u.id) });
  }
  if (show.has('contacts')) {
    for (const c of (contactsTurn || turn).contacts || []) {
      if (!c.pos) continue;
      out.push({ id: c.id, kind: 'contact', sidc: c.sidc || 'SUGPU----------', pos: c.pos, unc: c.uncertainty_m, highlight: highlight.has(c.id) });
    }
  }
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

function pageHtml(cfg) {
  return `<!doctype html>
<html lang="pl"><head><meta charset="utf-8"><title>terrain-view</title>
<link rel="stylesheet" href="/leaflet/leaflet.css">
<style>
html,body{margin:0;padding:0;overflow:hidden;background:#cfd8d0}
#map{position:absolute;left:0;top:0;background:#cfd8d0}
.leaflet-fade-anim .leaflet-tile,.leaflet-tile{transition:none!important}
.hillshade{mix-blend-mode:multiply}
#ov{position:absolute;left:0;top:0;pointer-events:none;z-index:2000}
.gl{font:bold 12px Consolas,"Courier New",monospace;fill:#000;stroke:#fff;stroke-width:3.4px;paint-order:stroke;stroke-linejoin:round}
.uicon{background:none;border:none}
.u{position:relative}
.u svg{position:relative;display:block}
.halo{position:absolute;width:50px;height:50px;border-radius:50%;background:rgba(255,235,0,.55);box-shadow:0 0 0 3px rgba(230,170,0,.95),0 0 14px 6px rgba(255,235,0,.7)}
.lbl{position:absolute;left:50%;transform:translateX(-50%);white-space:nowrap;font:bold 10px Consolas,"Courier New",monospace;color:#000;
  text-shadow:-1.5px 0 #fff,1.5px 0 #fff,0 -1.5px #fff,0 1.5px #fff,-1.5px -1.5px #fff,1.5px 1.5px #fff,-1.5px 1.5px #fff,1.5px -1.5px #fff}
.lbl-e{color:#a00000}.lbl-c{color:#d00000}.lbl-h{font-size:12px}
</style></head><body>
<div id="map"></div>
<script src="/leaflet/leaflet.js"></script>
<script src="/milsymbol.js"></script>
<script>window.CFG=${JSON.stringify(cfg).replace(/</g, '\\u003c')};</script>
<script src="/terrain-page.js"></script>
</body></html>`;
}

function startServer(cfg) {
  const html = pageHtml(cfg);
  const leafletDir = path.join(ROOT, 'node_modules', 'leaflet', 'dist');
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let file;
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': MIME['.html'] });
        res.end(html);
        return;
      }
      if (url.pathname === '/terrain-page.js') file = path.join(HERE, 'terrain-page.js');
      else if (url.pathname === '/milsymbol.js') file = path.join(ROOT, 'node_modules', 'milsymbol', 'dist', 'milsymbol.js');
      else if (url.pathname.startsWith('/leaflet/')) {
        file = path.join(leafletDir, path.normalize(url.pathname.slice('/leaflet/'.length)));
        if (!file.startsWith(leafletDir + path.sep)) file = null;
      }
      if (!file) throw new Error('404');
      const buf = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function parseList(v, dflt) {
  return new Set(String(v ?? dflt).split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * Renderuje zrzut. opts: turn (ścieżka lub obiekt), center|unit|bbox, zoom, size [w,h], base, hillshade, show, contacts,
 * highlight, facing, grid, timeout, out. Zwraca { out, metaPath, meta, timings }.
 */
export async function renderTerrainView(opts) {
  const t0 = Date.now();
  const timings = {};
  const size = opts.size || [1200, 900];
  const base = opts.base || 'topo';
  if (!BASES.includes(base)) throw new Error(`Nieznany podkład "${base}" (${BASES.join(', ')})`);
  if (!opts.out) throw new Error('Brak --out');
  const turn = typeof opts.turn === 'string' ? JSON.parse(await fs.readFile(opts.turn, 'utf8')) : opts.turn;
  if (!turn) throw new Error('Brak --turn');
  const contactsTurn = opts.contacts ? (typeof opts.contacts === 'string' ? JSON.parse(await fs.readFile(opts.contacts, 'utf8')) : opts.contacts) : null;
  const show = opts.show instanceof Set ? opts.show : parseList(opts.show, 'own,enemy,contacts,neighbors');
  const highlight = opts.highlight instanceof Set ? opts.highlight : parseList(opts.highlight, '');
  if (opts.unit) highlight.add(opts.unit);

  const all = collectUnits({ turn, contactsTurn, show, highlight });

  // ---------- widok ----------
  let center;
  let zoom = opts.zoom;
  if (opts.center) center = opts.center;
  else if (opts.unit) {
    const u = (turn.units || []).find((x) => x.id === opts.unit);
    if (!u || !u.pos) throw new Error(`Brak jednostki "${opts.unit}" w turze`);
    center = u.pos;
  } else if (opts.bbox) {
    const b = opts.bbox;
    center = unproject((project(b[0], b[3], 10).x + project(b[2], b[1], 10).x) / 2, (project(b[0], b[3], 10).y + project(b[2], b[1], 10).y) / 2, 10);
    if (zoom == null) zoom = fitZoom(b, size);
  } else {
    if (!all.length) throw new Error('Brak jednostek do pokazania; podaj --center, --unit lub --bbox');
    const lons = all.map((u) => u.pos[0]);
    const lats = all.map((u) => u.pos[1]);
    const b = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
    center = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    if (zoom == null) zoom = fitZoom(b, [size[0] - 120, size[1] - 120]);
  }
  zoom = zoom ?? 13;
  center = snapCenter(center, zoom, size);
  const meta = { center, zoom, size, crs: 'EPSG:3857', tileSize: 256 };
  const o = project(center[0], center[1], zoom);
  meta.pixelOrigin = [o.x - size[0] / 2, o.y - size[1] / 2];
  const nw = pixelToLonLat(meta, 0, 0);
  const se = pixelToLonLat(meta, size[0], size[1]);
  meta.bounds = [nw[0], se[1], se[0], nw[1]];
  meta.mpp = (40075016.686 * Math.cos((center[1] * Math.PI) / 180)) / (256 * 2 ** zoom);
  meta.base = base;
  meta.hillshade = !!opts.hillshade;
  if (opts.facing != null) meta.facing = Number(opts.facing);
  meta.grid = opts.grid ?? 50;

  // jednostki w widoku (z marginesem 30 px)
  const units = [];
  for (const u of all) {
    const px = lonLatToPixel(meta, u.pos[0], u.pos[1]);
    if (px[0] < -30 || px[1] < -30 || px[0] > size[0] + 30 || px[1] > size[1] + 30) continue;
    units.push({ ...u, px: [Math.round(px[0] * 100) / 100, Math.round(px[1] * 100) / 100] });
  }

  const cfg = { center, zoom, size, base, hillshade: !!opts.hillshade, grid: meta.grid, facing: meta.facing ?? null, mpp: meta.mpp, units };
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Nie znaleziono Chrome/Edge/Chromium. Ustaw CHROME_PATH.');

  const server = await startServer(cfg);
  const profileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-terrain-'));
  const port = await freePort();
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, `--window-size=${size[0]},${size[1]}`, 'about:blank',
  ], { stdio: 'ignore' });
  let exited = false;
  chrome.once('exit', () => { exited = true; });
  let ws;
  const cleanup = async () => {
    try { ws?.close(); } catch { /* zamknięte */ }
    if (!exited) {
      // tylko własny proces (po PID); /T obejmuje jego potomków
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      else chrome.kill('SIGKILL');
      for (let i = 0; i < 20 && !exited; i++) await sleep(100);
    }
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
    await fs.rm(profileDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }).catch(() => {});
  };

  try {
    let targets;
    for (let i = 0; i < 100 && !targets; i++) {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(150); }
    }
    const page = targets?.find((t) => t.type === 'page');
    if (!page) throw new Error('Chrome nie uruchomił zdalnego debugowania');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve); ws.addEventListener('error', reject); });
    let nextId = 0;
    const pending = new Map();
    const jsErrors = [];
    ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
      if (msg.method === 'Runtime.exceptionThrown') jsErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    });
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
    const ev = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(`JS: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`);
      return r.result?.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: size[0], height: size[1], deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    timings.startMs = Date.now() - t0;

    // strona zbudowana
    for (let i = 0; i < 100; i++) {
      if (await ev('window.__done === true').catch(() => false)) break;
      if (jsErrors.length) throw new Error(`Błąd JS strony: ${jsErrors[0]}`);
      await sleep(100);
    }
    if (!(await ev('window.__done === true'))) throw new Error(`Strona się nie zbudowała${jsErrors[0] ? `: ${jsErrors[0]}` : ''}`);

    // czekaj na wszystkie kafelki
    const timeout = opts.timeout ?? 20000;
    const tTiles = Date.now();
    let state;
    let stable = 0;
    while (Date.now() - tTiles < timeout) {
      state = await ev('window.__tilesState()');
      stable = state.done ? stable + 1 : 0;
      if (stable >= 3) break; // 3 kolejne odczyty (~450 ms) bez ładowania
      await sleep(150);
    }
    state = await ev('window.__tilesState()');
    const timedOut = !state.done;
    await sleep(250); // dokończenie malowania (mieszanie hillshade)
    timings.tilesMs = Date.now() - tTiles;

    const report = await ev('window.__report');
    meta.tiles = { total: state.total, loaded: state.loaded, missing: state.missing.length, timedOut };
    meta.missingTiles = state.missing;
    meta.maxProjectionErrorPx = Math.round(report.maxProjectionErrorPx * 1000) / 1000;
    meta.leafletBounds = report.bounds;
    meta.leafletPixelOrigin = report.pixelOrigin;
    meta.units = units.map(({ id, kind, sidc, pos, px, unc }) => ({ id, kind, sidc, pos, px, ...(unc ? { uncertainty_m: unc } : {}) }));

    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size[0], height: size[1], scale: 1 } });
    const out = path.resolve(opts.out);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, Buffer.from(shot.data, 'base64'));
    const metaPath = `${out}.json`;
    await fs.writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
    timings.totalMs = Date.now() - t0;
    return { out, metaPath, meta, timings };
  } finally {
    await cleanup();
  }
}

// ---------- CLI ----------

function parseArgs(argv) {
  const f = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) f[argv[i].slice(2)] = true;
    else { f[argv[i].slice(2)] = next; i++; }
  }
  return f;
}

const nums = (s, n, what) => {
  const a = String(s).split(',').map(Number);
  if (a.length !== n || a.some((v) => !Number.isFinite(v))) throw new Error(`Zły ${what}: "${s}"`);
  return a;
};

export async function main(argv) {
  const f = parseArgs(argv);
  if (!f.turn || !f.out) {
    console.error('Użycie: node tools/umpire/terrain-view.mjs --turn <turn.json> [--center lon,lat | --unit <id> | --bbox a,b,c,d] [--zoom 13] [--size 1200x900] [--base topo|osm|satellite|dark] [--hillshade] [--show own,enemy,contacts,neighbors] [--contacts <tura gracza>] [--highlight id,id] [--facing 330] [--grid 50] [--timeout 20000] --out <plik.png>');
    return 1;
  }
  const opts = {
    turn: f.turn,
    out: f.out,
    unit: typeof f.unit === 'string' ? f.unit : undefined,
    center: f.center ? nums(f.center, 2, '--center') : undefined,
    bbox: f.bbox ? nums(f.bbox, 4, '--bbox') : undefined,
    zoom: f.zoom ? Number(f.zoom) : undefined,
    size: f.size ? String(f.size).split(/[x,]/).map(Number) : undefined,
    base: f.base,
    hillshade: !!f.hillshade,
    show: f.show,
    contacts: f.contacts,
    highlight: f.highlight,
    facing: f.facing != null ? Number(f.facing) : undefined,
    grid: f.grid != null ? Number(f.grid) : undefined,
    timeout: f.timeout ? Number(f.timeout) : undefined,
  };
  if (opts.size && (opts.size.length !== 2 || opts.size.some((v) => !(v >= 200 && v <= 4000)))) throw new Error('--size: np. 1200x900 (200–4000)');
  const r = await renderTerrainView(opts);
  const m = r.meta;
  console.log(`Zapisano ${r.out} (${m.size[0]}x${m.size[1]}, zoom ${m.zoom}, ${m.mpp.toFixed(2)} m/px, ${m.units.length} jedn.)`);
  console.log(`Meta: ${r.metaPath}`);
  console.log(`Kafelki: ${m.tiles.loaded}/${m.tiles.total}${m.tiles.missing ? `, BRAK ${m.tiles.missing}` : ''}${m.tiles.timedOut ? ' (przekroczono limit czasu)' : ''}; błąd rzutowania ${m.maxProjectionErrorPx} px; ${r.timings.totalMs} ms`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { console.error(`BŁĄD: ${err.message}`); process.exit(1); },
  );
}

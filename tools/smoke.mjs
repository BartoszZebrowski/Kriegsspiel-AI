#!/usr/bin/env node
// Test dymny klienta w headless Chrome: `npm run smoke [-- <ścieżka-scenariusza>] [--keep]`.
//
// Uruchamia własny serwer (createApp) na tymczasowej KOPII scenariusza (domyślnie scenarios/00-test-przesmyk),
// otwiera aplikację w headless Chrome (CDP przez WebSocket, bez zależności npm) i przechodzi skryptowaną trasę
// po głównych funkcjach nowego interfejsu: układ i zegar z DTG, odprawa jako dokument, szczegółowość (batalion / kompania /
// pluton) i linie podporządkowania, inspektor i struktura (drzewo, filtr, klawiatura), legenda jako popover, komunikator
// (pasek kanałów, nieprzeczytane, typy i „Pilne”, @ i #, szablony, załączniki, wycofanie), szkice (znaki NATO, flyout, edycja
// ✓/✕, usuwanie), miarka, podkłady i warstwy, omnibox (Ctrl K), splittery i szyny docków, oś czasu (archiwum), żywa
// aktualizacja po nowym pliku tury, telefon (≤ 760 px). Kończy z kodem != 0, gdy jakikolwiek krok się nie powiedzie
// albo w konsoli przeglądarki pojawi się błąd JS.
//
// Chrome: zmienna CHROME_PATH albo typowe lokalizacje (Chrome / Edge / Chromium). Kafelki map z internetu
// mogą się nie ładować (offline) — takie błędy sieciowe są ignorowane.
import { spawn } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.js';
import { GRAPHICS } from '../public/js/domain/tactical.js';
import { injectLogisticsSample } from '../test/fixtures/logistics-sample.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const keep = args.includes('--keep');
const scenarioSrc = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'scenarios', '00-test-przesmyk'));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const env = process.env;
  const list = [
    env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return list.filter(Boolean).find((p) => existsSync(p));
}

// ---------- wyniki ----------
const results = [];
const consoleErrors = [];
const IGNORED = /Failed to load resource|net::ERR_|tile\.|arcgisonline|opentopomap|openrailwaymap|favicon/i;

async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name} (${Date.now() - t0} ms)`);
  } catch (err) {
    results.push({ name, ok: false, error: err.message });
    console.log(`  FAIL ${name}\n       ${err.message}`);
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// ---------- przygotowanie ----------
const work = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-smoke-'));
const scenarioDir = path.join(work, 'scenario');
const profileDir = path.join(work, 'profile');
await fs.cp(scenarioSrc, scenarioDir, { recursive: true });
// Kopia ma zaczynać od tury 0 (trasa smoke zakłada czysty start): rozgrywana kampania ma kolejne tury,
// wiadomości gracza i szkice, więc je usuwamy (oryginał pozostaje nietknięty).
for (const sub of ['player/turns', 'player/inbox', 'umpire/turns']) {
  for (const name of await fs.readdir(path.join(scenarioDir, sub)).catch(() => [])) {
    if (/^\d{3}\.json$/.test(name) && name !== '000.json') await fs.rm(path.join(scenarioDir, sub, name), { force: true });
  }
}
// Trasa zakłada grę w toku (np. „Po bitwie” zablokowane), a kopia bywa scenariuszem zakończonym — ustawiamy status w kopii.
const scnPath = path.join(scenarioDir, 'scenario.json');
const scn = JSON.parse(await fs.readFile(scnPath, 'utf8'));
scn.status = 'active';
await fs.writeFile(scnPath, JSON.stringify(scn, null, 2));
await fs.rm(path.join(scenarioDir, 'player', 'outbox'), { recursive: true, force: true });
await fs.rm(path.join(scenarioDir, 'player', 'notes'), { recursive: true, force: true });
// T17/T18: przykładowa logistyka i DOS w ostatniej turze kopii (tura 0).
await injectLogisticsSample(scenarioDir);
await fs.mkdir(profileDir, { recursive: true });

const chromePath = findChrome();
if (!chromePath) {
  console.error('Nie znaleziono Chrome/Edge/Chromium. Ustaw CHROME_PATH.');
  process.exit(2);
}

const { server } = createApp(scenarioDir);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const chrome = spawn(
  chromePath,
  ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profileDir}`, '--window-size=1440,900', 'about:blank'],
  { stdio: 'ignore' },
);

let ws;
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    ws?.close();
  } catch {
    // już zamknięte
  }
  chrome.kill(); // tylko Chrome uruchomiony przez ten skrypt
  await sleep(500);
  await new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  });
  if (!keep) await fs.rm(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }).catch(() => {});
}

try {
  // ---------- CDP ----------
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try {
      port = Number((await fs.readFile(path.join(profileDir, 'DevToolsActivePort'), 'utf8')).split(/\r?\n/)[0]);
    } catch {
      await sleep(200);
    }
  }
  assert(port, 'Chrome nie uruchomił zdalnego debugowania');
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    } catch {
      await sleep(200);
    }
  }
  const page = targets.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let nextId = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      consoleErrors.push(`exception: ${d.exception?.description || d.text}`);
    } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
      if (!IGNORED.test(text)) consoleErrors.push(`console.error: ${text}`);
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      const { text, url } = msg.params.entry;
      if (!IGNORED.test(text) && !IGNORED.test(url || '')) consoleErrors.push(`log: ${text} ${url || ''}`);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++nextId;
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // ---------- pomocniki ----------
  const ev = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error('JS: ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text));
    return r.result?.result?.value;
  };
  async function waitFor(expression, what, timeout = 10000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await ev(expression)) return;
      } catch {
        // strona jeszcze się ładuje
      }
      await sleep(150);
    }
    throw new Error(`timeout: ${what}`);
  }
  const mouse = (type, x, y, clickCount = 1) =>
    send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount, buttons: type === 'mouseReleased' ? 0 : 1 });
  async function click(x, y, count = 1) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await mouse('mousePressed', x, y, 1);
    await mouse('mouseReleased', x, y, 1);
    if (count === 2) {
      await mouse('mousePressed', x, y, 2);
      await mouse('mouseReleased', x, y, 2);
    }
    await sleep(200);
  }
  async function drag(x1, y1, x2, y2) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1, y: y1 });
    await mouse('mousePressed', x1, y1);
    for (let i = 1; i <= 8; i++) {
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8, button: 'left', buttons: 1 });
      await sleep(20);
    }
    await mouse('mouseReleased', x2, y2);
    await sleep(250);
  }
  // Klawisz z modyfikatorami (CDP: alt=1, ctrl=2, meta=4, shift=8); `text` dla znaków drukowalnych.
  const KEYS = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38 };
  const key = async (name, { ctrl = false, shift = false, alt = false } = {}) => {
    const modifiers = (alt ? 1 : 0) | (ctrl ? 2 : 0) | (shift ? 8 : 0);
    const printable = name.length === 1;
    const code = KEYS[name] ?? name.toUpperCase().charCodeAt(0);
    const base = { key: name, code: printable ? (/[a-z]/i.test(name) ? 'Key' + name.toUpperCase() : /\d/.test(name) ? 'Digit' + name : name) : name, windowsVirtualKeyCode: code, modifiers };
    await send('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(printable && !ctrl && !alt ? { text: name } : {}) });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
    await sleep(200);
  };
  // Środek elementu; element poza widocznym obszarem przewijanego kontenera (np. karta kanału) jest najpierw przewijany do widoku.
  const centerOf = (sel) =>
    ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  async function clickSel(sel, count = 1) {
    const c = await centerOf(sel);
    assert(c, `brak elementu ${sel}`);
    await click(c[0], c[1], count);
  }
  // Klik w „Wycofaj” wiadomości zawierającej podany fragment tekstu.
  async function withdrawByText(fragment) {
    const c = await ev(`(() => { const m = [...document.querySelectorAll('#thread .msg')].find((e) => e.textContent.includes(${JSON.stringify(fragment)})); const b = m && m.querySelector('[data-withdraw]'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    assert(c, 'przycisk „Wycofaj” dla ' + fragment);
    await click(c[0], c[1]);
  }
  const threadHas = (fragment) => `[...document.querySelectorAll('#thread .msg .mb')].some((e) => e.textContent.includes(${JSON.stringify(fragment)}))`;
  // Wpisuje tekst w pole komponowania (jak użytkownik: value + zdarzenie input).
  const typeInto = (sel, text) =>
    ev(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); t.focus(); t.value = ${JSON.stringify(text)}; t.setSelectionRange(t.value.length, t.value.length); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const mapOrigin = () => ev(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return [r.x, r.y]; })()`);
  const state = (expr) => ev(`(() => { const s = window.__ks.store.get(); return ${expr}; })()`);
  const store = () => 'window.__ks.store.get()';
  const readJson = async (rel) => JSON.parse(await fs.readFile(path.join(scenarioDir, rel), 'utf8'));
  const writeJson = (rel, data) => fs.writeFile(path.join(scenarioDir, rel), JSON.stringify(data, null, 2));
  const fetchJson = (url, init) =>
    ev(`fetch(${JSON.stringify(url)}, ${JSON.stringify(init || {})}).then((r) => r.json())`);
  const putNotes = (turn, items) =>
    fetchJson('/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turn, items }) });
  const pointOf = (id) => ev(`(() => { const p = window.__ks.surface.pointOf(${JSON.stringify(id)}); return p && [p.x, p.y]; })()`);
  const width = (sel) => ev(`document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect().width`);

  console.log(`Smoke test — scenariusz: ${scenarioSrc}\nSerwer: ${base}, Chrome: ${chromePath}`);

  // ---------- trasa ----------
  await send('Page.navigate', { url: `${base}/?debug` });

  await step('start: układ, zegar z DTG, symbole na mapie, domyślny podkład „Ciemna (Esri)”', async () => {
    await waitFor(`window.__ks && ${store()}.turn && document.querySelectorAll('#map .ms-icon').length > 3`, 'załadowanie tury i symboli');
    assert((await ev(`document.getElementById('clk-turn').textContent`)) === 'TURA 0', 'zegar pokazuje TURA 0');
    assert(/^\d{6}[A-Z] [A-ZŻŹĆŃŚŁÓĄĘ]{3} \d\d/.test(await ev(`document.getElementById('clk-dtg').textContent`)), 'linia DTG');
    assert((await ev(`document.getElementById('scenario-title').textContent.length`)) > 0, 'tytuł scenariusza');
    assert(await state('s.archive === false'), 'flaga archiwum wyłączona');
    assert((await state('s.basemap')) === 'Ciemna (Esri)', 'domyślny podkład');
    assert(await ev(`document.getElementById('map').classList.contains('is-dark-base')`), 'is-dark-base przy ciemnym podkładzie');
    assert(await ev(`['topbar', 'dock-l', 'dock-r', 'timeline', 'rail', 'mapctl', 'status'].every((id) => document.getElementById(id).getBoundingClientRect().width > 0)`), 'wszystkie regiony układu widoczne');
    assert((await ev(`document.getElementById('outbox-pill').textContent`)).startsWith('SKRZYNKA · '), 'pigułka skrzynki');
    assert(/^34U /.test(await ev(`document.getElementById('st-m').textContent`)), 'pasek stanu: MGRS');
  });

  await step('odprawa: dokument na pełnym ekranie, spis treści, zamknięcie ✕ i Esc', async () => {
    await waitFor(`document.getElementById('brief').classList.contains('open')`, 'auto-otwarcie odprawy');
    assert((await ev(`document.getElementById('briefing-body').textContent.length`)) > 20, 'treść odprawy');
    assert((await ev(`document.querySelectorAll('#br-toc a').length`)) >= 3, 'spis treści z nagłówków ##');
    assert(await ev(`document.querySelectorAll('#briefing-body h2[id]').length === document.querySelectorAll('#br-toc a').length`), 'sekcje odpowiadają spisowi');
    await clickSel('#briefing-close');
    await waitFor(`!document.getElementById('brief').classList.contains('open')`, 'zamknięcie odprawy');
    assert(await state('s.briefing.open === false'), 'store.briefing.open = false');
    await clickSel('#tb-brief');
    await waitFor(`document.getElementById('brief').classList.contains('open')`, 'ponowne otwarcie odprawy');
    await key('Escape');
    await waitFor(`!document.getElementById('brief').classList.contains('open')`, 'zamknięcie odprawy klawiszem Esc');
    await key('b');
    await waitFor(`document.getElementById('brief').classList.contains('open')`, 'skrót B otwiera odprawę');
    await key('Escape');
    await waitFor(`!document.getElementById('brief').classList.contains('open')`, 'Esc po skrócie');
  });

  // ===== T17: warstwa logistyczna (tura 0: dane z injectLogisticsSample są liczone względem jej czasu) =====
  await step('T17 logistyka: warstwa na mapie (trasy, skład, most, konwój), przełącznik w Warstwach, karta z as_of i „dane nieaktualne”', async () => {
    await waitFor(`${store()}.turn.logistics && document.querySelectorAll('#map .lg-route').length === 2`, 'trasy MSR/ASR na mapie');
    assert((await ev(`document.querySelectorAll('#map .lg-bridge').length`)) === 2, 'dwa mosty');
    assert((await state('s.layers.logistics')) === true, 'warstwa logistyczna domyślnie włączona');
    // trasa w kolorze statusu: MSR otwarta (zielona), ASR zagrożona (żółta)
    const colors = await ev(`[...document.querySelectorAll('#map .lg-route')].map((p) => p.getAttribute('stroke')).join()`);
    assert(/#43b581/.test(colors) && /#e8b339/.test(colors), 'kolory statusów tras: ' + colors);
    // klik w skład (aktualny, 30 min) → karta bez ostrzeżenia
    await ev(`window.__ks.controller.selectEntity('sk-blog')`);
    await waitFor(`document.querySelector('#insp-body .lg-card')`, 'karta składu');
    let card = await ev(`document.getElementById('insp-body').innerText`);
    assert(/Skład główny Raczki/.test(card) && /Stan na/.test(card) && /180 t/.test(card), 'karta składu: ' + card);
    assert(!(await ev(`!!document.querySelector('#insp-body [data-stale]')`)), 'skład z as_of -30 min nie jest nieaktualny');
    // skład wysunięty (as_of -180 min > 1 tura) → „Dane nieaktualne”
    await ev(`window.__ks.controller.selectEntity('sk-przod')`);
    await waitFor(`document.querySelector('#insp-body [data-stale]')`, 'oznaczenie nieaktualnych danych');
    // trasa i konwój też mają karty
    await ev(`window.__ks.controller.selectEntity('msr-1')`);
    await waitFor(`/MSR ZŁOTO/.test(document.getElementById('insp-body').innerText)`, 'karta trasy');
    await ev(`window.__ks.controller.selectEntity('kw-1')`);
    await waitFor(`/Kolumna zaopatrzenia/.test(document.getElementById('insp-body').innerText)`, 'karta konwoju');
    // klik w symbol mostu na mapie otwiera kartę
    await ev(`document.querySelector('#map .lg-bridge').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    await waitFor(`${store()}.selection && /^most-/.test(${store()}.selection.id)`, 'klik w most zaznacza go');
    // wyłączenie warstwy w panelu Warstwy ukrywa elementy
    await ev(`document.getElementById('b-layers').click()`);
    await ev(`document.querySelector('#layers [data-ov="logistics"]').click()`);
    await waitFor(`document.querySelectorAll('#map .lg-route, #map .lg-bridge').length === 0`, 'ukrycie warstwy');
    await ev(`document.querySelector('#layers [data-ov="logistics"]').click()`);
    await waitFor(`document.querySelectorAll('#map .lg-bridge').length === 2`, 'ponowne włączenie warstwy');
    await ev(`window.__ks.controller.setPopover(null); window.__ks.controller.clearSelection()`);
  });
  // ===== koniec T17 =====
  await step('T47 zasięg ognia: pierścienie zaznaczonej jednostki, przełącznik rodzaju, kontakt przerywany (szacunek), warstwa pokrycia', async () => {
    const rings = () => ev(`[...document.querySelectorAll('#map path.leaflet-interactive, #map svg path')].filter((p) => p.getAttribute('stroke') && ['#ef4444', '#38bdf8', '#facc15', '#a78bfa'].includes(p.getAttribute('stroke'))).length`);
    assert((await rings()) === 0, 'bez zaznaczenia brak pierścieni');
    await ev(`window.__ks.controller.selectEntity('1bzmot')`);
    await waitFor(`document.querySelectorAll('#range-panel .rp-chip').length >= 2`, 'panel z rodzajami broni 1 bzmot');
    const n = await rings();
    assert(n >= 2, 'pierścienie zaznaczonej jednostki: ' + n);
    await ev(`document.querySelector('#range-panel .rp-chip').click()`);
    await waitFor(`!document.querySelector('#range-panel .rp-chip').classList.contains('on')`, 'chip wyłączony');
    assert((await rings()) === n - 1, 'wyłączony rodzaj znika z mapy');
    await ev(`window.__ks.controller.selectEntity('c-001')`);
    await waitFor(`/szacunek/.test(document.getElementById('range-panel').innerText)`, 'panel kontaktu oznaczony jako szacunek');
    assert(await ev(`[...document.querySelectorAll('#map svg path')].some((p) => p.getAttribute('stroke-dasharray') && /^#(ef4444|38bdf8|facc15|a78bfa)$/.test(p.getAttribute('stroke')))`), 'pierścień kontaktu przerywany');
    await ev(`window.__ks.controller.clearSelection(); window.__ks.controller.setLayerVisible('range:ppanc', true)`);
    await waitFor(`document.querySelectorAll('#range-panel .rp-static').length === 1`, 'legenda pokrycia ppanc');
    assert((await rings()) >= 2, 'pokrycie ppanc: pierścienie wielu jednostek');
    await ev(`window.__ks.controller.setLayerVisible('range:ppanc', false)`);
    await waitFor(`document.getElementById('range-panel').hidden`, 'panel znika bez zasięgów');
  });
  // ===== koniec T47 =====

  await step('szczegółowość: kompanie, plutony i linie podporządkowania (magenta)', async () => {
    const icons = () => ev(`document.querySelectorAll('#map .ms-icon').length`);
    const links = () => ev(`[...document.querySelectorAll('#map path')].filter((p) => (p.getAttribute('stroke') || '').toLowerCase() === '#ff2bd6').length`);
    await clickSel('button[data-detail="battalion"]');
    await sleep(300);
    const nBat = await icons();
    const lBat = await links();
    await clickSel('button[data-detail="company"]');
    await sleep(300);
    const nCo = await icons();
    const lCo = await links();
    assert(nCo > nBat, `poziom „kompania” pokazuje więcej symboli (${nCo} > ${nBat})`);
    assert(lCo > lBat && lBat > 0, 'magentowe linie podporządkowania');
    assert((await state('s.detail')) === 'company', 'store.detail = company');
    await clickSel('button[data-detail="platoon"]');
    await sleep(400);
    const nPl = await icons();
    const lPl = await links();
    assert(nPl > nCo, `poziom „pluton” pokazuje plutony (${nPl} > ${nCo})`);
    assert(lPl > lCo, `linie kompania → plutony (${lPl} > ${lCo})`);
    assert((await state('s.detail')) === 'platoon', 'store.detail = platoon');
    assert(await ev(`document.querySelector('#seg-detail button[data-d="platoon"]').classList.contains('on')`), 'przycisk „Pluton” aktywny');
    await clickSel('button[data-detail="battalion"]');
    await sleep(300);
    assert((await icons()) === nBat, 'powrót do „batalion” chowa kompanie i plutony');
    await key('4');
    await waitFor(`${store()}.detail === 'platoon'`, 'klawisz 4 = pluton');
    await key('2');
    await waitFor(`${store()}.detail === 'battalion'`, 'klawisz 2 = batalion');
  });

  await step('inspektor: klik w symbol, zaznaczenie wszędzie, linie wyróżnione, wyczyszczenie ✕', async () => {
    const [ox, oy] = await mapOrigin();
    const pt = await pointOf('1bzmot');
    assert(pt, 'symbol 1bzmot na mapie');
    await click(ox + pt[0], oy + pt[1]);
    await waitFor(`document.querySelector('#insp-body .insp-title')`, 'karta w inspektorze');
    assert((await ev(`document.querySelector('#insp-body .insp-title').textContent`)) === '1 bzmot', 'nazwa w inspektorze');
    assert((await state('s.selection && s.selection.id')) === '1bzmot', 'zaznaczenie w store');
    assert(await ev(`!!document.querySelector('#map .ms-icon.is-selected')`), 'ramka zaznaczenia na mapie');
    assert(await ev(`document.querySelector('#tree-scroll .trow.sel').dataset.id === '1bzmot'`), 'wiersz drzewa podświetlony');
    assert(await ev(`[...document.querySelectorAll('#map path')].some((p) => p.getAttribute('stroke-width') === '4')`), 'wyróżnione linie wybranej jednostki');
    assert(await ev(`/612/.test(document.getElementById('insp-body').textContent)`), 'stan osobowy w inspektorze');
    assert(await ev(`document.querySelectorAll('#insp-body .eqr').length >= 2`), 'sprzęt w inspektorze');
    assert(await ev(`/34U/.test(document.getElementById('insp-body').textContent)`), 'MGRS w inspektorze');
    // zakładki Zaopatrzenie / Historia
    await clickSel('#in-tabs [data-t="sup"]');
    assert(await ev(`/WARSTWA LOGISTYCZNA/.test(document.getElementById('insp-body').textContent)`), 'zakładka Zaopatrzenie');
    await clickSel('#in-tabs [data-t="hist"]');
    assert(await ev(`document.querySelector('#insp-body .kv .cap').textContent.includes('Dziennik')`), 'zakładka Historia');
    await clickSel('#in-tabs [data-t="ov"]');
    await clickSel('#in-x');
    await waitFor(`${store()}.selection === null`, 'wyczyszczenie zaznaczenia');
    assert(await ev(`!!document.querySelector('#insp-body .insp-empty')`), 'pusty inspektor');
  });

  await step('struktura: drzewo z sekcjami, plutony zwinięte pod kompaniami, klik zaznacza, nawigacja strzałkami', async () => {
    assert((await ev(`document.querySelectorAll('#tree-scroll .tree .trow').length`)) > 5, 'drzewo jednostek');
    assert((await ev(`document.querySelectorAll('#tree-scroll .sec-h').length`)) === 4, 'cztery sekcje');
    assert(await ev(`!document.querySelector('#tree-scroll .trow[data-id="1bzmot-1k-1p"]')`), 'plutony zwinięte pod kompaniami');
    assert(await ev(`getComputedStyle(document.querySelector('#tree-scroll .tree li:not(:first-child)'), '::before').borderLeftWidth === '1px'`), 'linie łączące drzewa (├─ └─ │)');
    // rozwinięcie kompanii strzałką
    await clickSel('#tree-scroll .trow[data-id="1bzmot-1k"] .tcar');
    assert(await ev(`!!document.querySelector('#tree-scroll .trow[data-id="1bzmot-1k-1p"]')`), 'pluton widoczny po rozwinięciu kompanii');
    await clickSel('#tree-scroll .trow[data-id="bcz"]');
    await waitFor(`${store()}.selection && ${store()}.selection.id === 'bcz'`, 'zaznaczenie bcz');
    assert(await ev(`document.querySelector('#insp-body .insp-title').textContent === 'bcz'`), 'inspektor po kliku w strukturze');
    // strzałki: ↓ przesuwa fokus, Enter zaznacza
    await ev(`document.querySelector('#tree-scroll .trow[data-id="bcz"]').focus()`);
    await key('ArrowDown');
    const focused = await ev(`document.activeElement.dataset.id`);
    assert(focused && focused !== 'bcz', 'strzałka ↓ przenosi fokus na następny wiersz');
    await key('Enter');
    await waitFor(`${store()}.selection.id === ${JSON.stringify(focused)}`, 'Enter zaznacza wiersz');
    // filtr
    const rowsBefore = await ev(`document.querySelectorAll('#tree-scroll .tree .trow').length`);
    await typeInto('#tr-q', 'bcz');
    assert((await ev(`document.querySelectorAll('#tree-scroll .tree .trow').length`)) < rowsBefore, 'filtr zawęża drzewo');
    assert(await ev(`!!document.querySelector('#tree-scroll .trow[data-id="bcz-1k"]')`), 'filtr zachowuje dopasowane gałęzie');
    await typeInto('#tr-q', '');
    // sekcje zwijane
    await clickSel('#tree-scroll .sec-h[data-sec="con"]');
    assert(await ev(`document.querySelector('#tree-scroll .sec-b[data-secb="con"]').classList.contains('closed')`), 'sekcja zwinięta');
    await clickSel('#tree-scroll .sec-h[data-sec="con"]');
    // zaznaczenie kontaktu w sekcji
    await clickSel('#tree-scroll .tcon[data-id="c-001"]');
    await waitFor(`${store()}.selection && ${store()}.selection.id === 'c-001'`, 'zaznaczenie kontaktu');
    assert(await ev(`/NIE PRAWDA/.test(document.getElementById('insp-body').textContent)`), 'szacunek sił oznaczony „NIE PRAWDA”');
  });

  await step('legenda: popover z palety mapy (Na mapie / Zasady), klawisz ?, Esc', async () => {
    await clickSel('#b-legend');
    await waitFor(`document.getElementById('legend').classList.contains('open')`, 'popover legendy');
    assert((await ev(`document.querySelectorAll('#lg-body .lg-r').length`)) > 3, 'legenda „Na mapie”');
    assert(await ev(`/Okrąg niepewności/.test(document.getElementById('lg-body').textContent)`), 'elementy mapy w legendzie');
    await clickSel('#seg-leg [data-l="rules"]');
    assert(await ev(`/Przynależność/.test(document.getElementById('lg-body').textContent)`), 'karta „Zasady”');
    await key('Escape');
    await waitFor(`!document.getElementById('legend').classList.contains('open')`, 'Esc zamyka legendę');
    await key('?');
    await waitFor(`document.getElementById('legend').classList.contains('open')`, 'klawisz ? otwiera legendę');
    await clickSel('#leg-x');
    await waitFor(`!document.getElementById('legend').classList.contains('open')`, 'zamknięcie ✕');
  });

  await step('komunikator: pasek kanałów, nieprzeczytane, wątek, linia do jednostki, popover wszystkich kanałów', async () => {
    assert((await ev(`document.querySelectorAll('#chtabs .cl-i').length`)) >= 4, 'lista kanałów (przełożony, sztab, podwładni)');
    assert(await ev(`!!document.getElementById('ch-search')`), 'pole wyszukiwania kanałów');
    const total = await state('s.unread.total');
    assert(total > 0, 'są nieprzeczytane wiadomości w innych kanałach');
    assert((await ev(`document.getElementById('cnt-unread').textContent`)).startsWith(String(total)), 'licznik nowych w nagłówku panelu');
    assert((await ev(`document.getElementById('rail-r-badge').textContent`)) === String(total), 'odznaka w szynie docka');
    await clickSel('#chtabs [data-ch="dd"]');
    await waitFor(`document.querySelectorAll('#thread .msg').length > 0`, 'wiadomości w kanale dd');
    assert(await ev(`!!document.querySelector('#thread .msg.urgent .tag.urg')`), 'wiadomość pilna ma znacznik PILNE');
    assert(await ev(`/Nowicki/.test(document.querySelector('#thread .msg .mh b').textContent) && !!document.querySelector('#thread .msg .mh .role')`), 'nadawca i rola');
    assert(await ev(`/^\\d{6}[A-Z] · T\\d+$/.test(document.querySelector('#thread .msg .mh time').textContent)`), 'DTG i tura w nagłówku karty');
    assert(await ev(`!!document.querySelector('#chtabs .cl-i.on[data-leader-anchor]')`), 'kotwica linii na aktywnej karcie kanału');
    await clickSel('#m-head');
    assert((await state('s.focus && s.focus.kind')) === 'entity', 'klik w nagłówek centruje mapę na jednostce');
    await sleep(500);
    assert(await ev(`document.querySelector('.leader').style.display !== 'none'`), 'linia od karty kanału do jednostki widoczna');
    // wyłączenie linii przyciskiem
    await clickSel('#m-leader');
    await sleep(200);
    assert(await ev(`document.querySelector('.leader').style.display === 'none'`), 'linia ukryta przyciskiem');
    await clickSel('#m-leader');
    // wyszukiwanie kanałów: automatyczne kanały (kompanie, plutony) tylko po wpisaniu frazy
    assert(await state(`s.channels.some((c) => c.auto)`), 'scenariusz ma kanały automatyczne');
    assert(await ev(`[...document.querySelectorAll('#chtabs .cl-g')].map((e) => e.textContent).includes('Sąsiedzi')`), 'grupa Sąsiedzi na liście');
    const before = await ev(`document.querySelectorAll('#chtabs .cl-i').length`);
    await ev(`(() => { const i = document.getElementById('ch-search'); i.value = 'kompania'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert((await ev(`document.querySelectorAll('#chtabs .cl-i').length`)) !== before, 'wyszukiwanie zmienia listę kanałów');
    await ev(`(() => { const i = document.getElementById('ch-search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert((await ev(`document.querySelectorAll('#chtabs .cl-i').length`)) === before, 'wyczyszczenie przywraca listę');
    await clickSel('#chtabs [data-ch="zt-mamry"]');
    await waitFor(`${store()}.activeChannel === 'zt-mamry'`, 'wybór kanału sąsiada z listy');
  });

  await step('komunikator: wzmianki klikalne jako chipy (miejsce, jednostka)', async () => {
    await clickSel('#chtabs [data-ch="s2"]');
    await waitFor(`document.querySelectorAll('#thread .mention').length > 0`, 'wzmianki w kanale s2');
    const place = await ev(`!!document.querySelector('#thread .mention[data-mention-kind="place"]')`);
    if (place) {
      assert(await ev(`!!document.querySelector('#thread .mention[data-mention-kind="place"] svg')`), 'pinezka przy miejscu');
      await clickSel('#thread .mention[data-mention-kind="place"]');
      assert((await state('s.focus && s.focus.kind')) === 'place', 'wzmianka miejsca daje przelot');
      await waitFor(`!!document.querySelector('.place-flash')`, 'pulsujący znacznik miejsca');
    }
    const unit = await ev(`!!document.querySelector('#thread .mention[data-mention-kind="unit"]')`);
    if (unit) {
      assert(await ev(`!!document.querySelector('#thread .mention[data-mention-kind="unit"] svg.ms')`), 'miniatura symbolu w chipie jednostki');
      await clickSel('#thread .mention[data-mention-kind="unit"]');
      await waitFor(`document.querySelector('#insp-body .insp-title')`, 'inspektor po kliku we wzmiankę jednostki');
    }
    assert(place || unit, 'w testowej wiadomości jest co najmniej jedna wzmianka');
  });

  await step('komponowanie: @ i # podpowiadają jednostki i miejsca, Enter wstawia nazwę', async () => {
    await clickSel('#chtabs [data-ch="krozp"]');
    await typeInto('#compose-text', 'Wesprzeć @1 bz');
    await waitFor(`document.getElementById('mention-pop').classList.contains('open')`, 'lista podpowiedzi jednostek');
    assert(await ev(`document.querySelector('#mention-pop [data-sug="0"]').textContent.includes('1 bzmot')`), 'pierwsza podpowiedź: 1 bzmot');
    await key('Enter');
    assert((await ev(`document.getElementById('compose-text').value`)) === 'Wesprzeć 1 bzmot ', 'wstawiona nazwa jednostki');
    await typeInto('#compose-text', 'Obserwować #Wiż');
    await waitFor(`document.getElementById('mention-pop').classList.contains('open')`, 'lista podpowiedzi miejsc');
    assert(await ev(`/Wiżajny/.test(document.getElementById('mention-pop').textContent)`), 'podpowiedź miejsca Wiżajny');
    await key('Escape');
    assert(await ev(`!document.getElementById('mention-pop').classList.contains('open')`), 'Esc zamyka podpowiedzi');
    await typeInto('#compose-text', '');
  });

  await step('komponowanie: rodzaj + „Pilne” zapisane w outboxie, skrzynka, szablon, wycofanie', async () => {
    await clickSel('#chtabs [data-ch="krozp"]');
    const pill0 = await state('s.outboxCount');
    // szablon rozkazu wstawia się przy wyborze rodzaju (puste pole)
    await typeInto('#compose-text', '');
    await clickSel('#seg-type [data-ty="zarzadzenie"]');
    assert(await ev(`/^ZARZĄDZENIE/.test(document.getElementById('compose-text').value)`), 'szablon zarządzenia');
    await clickSel('#seg-type [data-ty="meldunek"]');
    assert(await ev(`/^MELDUNEK/.test(document.getElementById('compose-text').value)`), 'szablon meldunku zastępuje poprzedni szablon');
    await clickSel('#seg-type [data-ty="rozkaz"]');
    await clickSel('#sw-urg');
    assert(await ev(`document.getElementById('sw-urg').classList.contains('on')`), 'przełącznik Pilne');
    const text = 'smoke-test rozkaz ' + Date.now();
    await typeInto('#compose-text', text);
    await clickSel('#compose-send');
    await waitFor(`${threadHas('smoke-test rozkaz')}`, 'wysłana wiadomość w wątku');
    const out = (await fetchJson('/api/messages')).messages.filter((m) => m.text === text);
    assert(out.length === 1, 'wiadomość zapisana na serwerze');
    assert(out[0].type === 'rozkaz' && out[0].priority === 'urgent', `rodzaj i Pilne zapisane (${out[0].type}/${out[0].priority})`);
    const file = await readJson('player/outbox/000.json');
    assert(file.messages.some((m) => m.text === text && m.type === 'rozkaz' && m.priority === 'urgent'), 'type i priority w pliku outbox');
    assert(await ev(`!!document.querySelector('#thread .msg.out.urgent .tag.urg') && !!document.querySelector('#thread .msg.out .tag.ord')`), 'znaczniki PILNE i ROZKAZ BOJOWY na karcie');
    assert(await ev(`/W skrzynce/.test(document.querySelector('#thread .msg.out:last-child .mf').textContent)`), 'stan: w skrzynce');
    assert((await state('s.outboxCount')) === pill0 + 1, 'licznik skrzynki rośnie');
    assert((await ev(`document.getElementById('outbox-pill').textContent`)) === `SKRZYNKA · ${pill0 + 1}`, 'pigułka SKRZYNKA · N');
    assert(await ev(`!document.getElementById('sw-urg').classList.contains('on')`), 'Pilne wraca do wyłączonego po wysłaniu');
    await withdrawByText('smoke-test rozkaz');
    await waitFor(`!${threadHas('smoke-test rozkaz')}`, 'wycofanie wiadomości');
    assert((await fetchJson('/api/messages')).messages.every((m) => m.text !== text), 'wiadomość usunięta z serwera');
    assert((await state('s.outboxCount')) === pill0, 'licznik skrzynki wraca');
  });

  await step('szkice: rysowanie, edycja ✓/✕, załącznik, usuwanie dwuetapowe', async () => {
    const [ox, oy] = await mapOrigin();
    const P = (dx, dy) => [ox + dx, oy + dy];
    const notes0 = await state('s.notes.length');
    await clickSel('button[data-tool="arrow"]');
    for (const [dx, dy, n] of [[180, 140, 1], [330, 190, 1], [480, 140, 2]]) {
      const [x, y] = P(dx, dy);
      await click(x, y, n);
    }
    await waitFor(`document.getElementById('note-dialog').open`, 'okno edycji nowego szkicu');
    await ev(`document.getElementById('note-name').value = 'Smoke oś'`);
    await clickSel('#note-form button[type="submit"]');
    await waitFor(`${store()}.notes.length === ${notes0 + 1}`, 'zapis szkicu');
    const saved = await fetchJson(`/api/notes/${await state('s.viewTurn')}`);
    assert(saved.items.some((n) => n.name === 'Smoke oś'), 'szkic zapisany na serwerze');

    // Edycja kształtu: trwa mimo odświeżenia po SSE (nieistotna zmiana w inboxie).
    const [sx, sy] = P(255, 165);
    await click(sx, sy);
    await waitFor(`!!document.querySelector('.leaflet-popup [data-note-shape]')`, 'dymek szkicu');
    await ev(`document.querySelector('.leaflet-popup [data-note-shape]').click()`);
    await waitFor(`!!document.querySelector('.edit-ctl')`, 'pływające ✓ / ✕');
    const turnRef = await ev(`window.__t = ${store()}.turn, true`);
    const inbox = await readJson('player/inbox/000.json');
    inbox.messages.push({ id: 'in-smoke-1', channel: 'log', from: 'log', time: '2026-05-14T06:30:00+02:00', text: 'smoke: nieistotna wiadomość' });
    await writeJson('player/inbox/000.json', inbox);
    await waitFor(`${store()}.messages.some((m) => m.id === 'in-smoke-1')`, 'odświeżenie wiadomości po SSE');
    assert(turnRef, 'zapamiętano dane tury');
    assert(await ev(`window.__t === ${store()}.turn`), 'odświeżenie wiadomości nie wymienia danych tury (mapa się nie przebudowuje)');
    assert(await ev(`!!document.querySelector('.edit-ctl')`), 'edycja kształtu przetrwała odświeżenie SSE');
    await waitFor(`[...document.querySelectorAll('.toast')].some((t) => /log/.test(t.textContent))`, 'toast o nowej wiadomości');
    await ev(`document.querySelector('.edit-ctl [data-act="cancel"]').click()`);
    await waitFor(`!document.querySelector('.edit-ctl')`, 'anulowanie edycji ✕');
    await click(sx, sy);
    await ev(`document.querySelector('.leaflet-popup [data-note-shape]').click()`);
    await waitFor(`!!document.querySelector('.edit-ctl')`, '✓ — ponowna edycja');
    await ev(`document.querySelector('.edit-ctl [data-act="ok"]').click()`);
    await waitFor(`!document.querySelector('.edit-ctl')`, 'zapis edycji ✓');

    // Załącznik do rozkazu.
    await clickSel('#chtabs [data-ch="krozp"]');
    await clickSel('#attach-btn');
    await waitFor(`document.getElementById('attach-menu').classList.contains('open')`, 'menu szkiców');
    await ev(`document.querySelector('#attach-menu input[type="checkbox"]').click()`);
    assert((await ev(`document.querySelectorAll('#compose-chips .att').length`)) === 1, 'chip załącznika w polu rozkazu');
    await typeInto('#compose-text', 'smoke załącznik');
    await clickSel('#compose-send');
    await waitFor(`!!document.querySelector('#thread .att[data-attachment]')`, 'załącznik w wysłanej wiadomości');
    await clickSel('#thread .att[data-attachment]');
    assert((await state('s.focus && s.focus.kind')) === 'geometry', 'klik w załącznik pokazuje szkic');
    await withdrawByText('smoke załącznik');
    await waitFor(`!${threadHas('smoke załącznik')}`, 'wycofanie wiadomości z załącznikiem');

    // Usuwanie dwuetapowe (mapa przesunęła się do szkicu, a podświetlenie znika po ~4 s).
    await sleep(4400);
    // Przesuń mapę na środek pierwszego odcinka szkicu (wcześniejsze kroki przesunęły widok) i kliknij dokładnie tam.
    const mid = await ev(`(() => { const n = window.__ks.store.get().notes.find((x) => x.name === 'Smoke oś'); const c = n.geometry.coordinates; const ll = [(c[0][1] + c[1][1]) / 2, (c[0][0] + c[1][0]) / 2]; window.__ks.map.setView(ll, window.__ks.map.getZoom(), { animate: false }); const p = window.__ks.map.latLngToContainerPoint(ll); return [p.x, p.y]; })()`);
    await click(ox + mid[0], oy + mid[1]);
    await waitFor(`!!document.querySelector('.leaflet-popup [data-note-del]')`, 'dymek z „Usuń”');
    await ev(`document.querySelector('.leaflet-popup [data-note-del]').click()`);
    assert(await ev(`!document.querySelector('.leaflet-popup .card__confirm').hidden`), 'pytanie „Na pewno usunąć?”');
    await ev(`document.querySelector('.leaflet-popup [data-note-del-yes]').click()`);
    await waitFor(`${store()}.notes.length === ${notes0}`, 'usunięcie szkicu po potwierdzeniu');
  });

  await step('szkice: flyout znaków NATO (G) rozpoczyna rysowanie wybranego znaku', async () => {
    await clickSel('button[data-tool="gfx"]');
    await waitFor(`document.getElementById('flyout').classList.contains('open')`, 'flyout znaków');
    assert((await ev(`document.querySelectorAll('#flyout [data-gfx]').length`)) >= 15, 'wszystkie znaki taktyczne w flyoucie');
    await ev(`document.querySelector('#flyout [data-gfx="flot"]').click()`);
    await sleep(200);
    assert(await ev(`!document.getElementById('flyout').classList.contains('open')`), 'flyout zamknięty po wyborze');
    assert(await ev(`document.getElementById('map').classList.contains('is-drawing')`), 'tryb rysowania włączony');
    assert(await ev(`document.querySelector('button[data-tool="gfx"]').classList.contains('on')`), 'przycisk G aktywny');
    await key('Escape');
    await waitFor(`!document.getElementById('map').classList.contains('is-drawing')`, 'Esc anuluje narzędzie');
    await key('g');
    await waitFor(`document.getElementById('flyout').classList.contains('open')`, 'klawisz G otwiera flyout');
    await key('Escape');
    await waitFor(`!document.getElementById('flyout').classList.contains('open')`, 'Esc zamyka flyout');
  });

  await step('szkice: wszystkie znaki NATO renderują się bez błędów', async () => {
    const turn = await state('s.viewTurn');
    const original = (await fetchJson(`/api/notes/${turn}`)).items;
    const line = [[22.6, 54.2], [22.8, 54.25], [23.0, 54.2]];
    const ring = [[22.6, 54.0], [22.9, 54.05], [22.8, 54.1], [22.6, 54.0]];
    const geom = (kind) =>
      kind === 'area' ? { type: 'Polygon', coordinates: [ring] } : kind === 'point' ? { type: 'Point', coordinates: [22.7, 54.15] } : { type: 'LineString', coordinates: line };
    const items = [];
    for (const [kind, list] of Object.entries(GRAPHICS)) {
      for (const g of list) {
        for (const color of ['blue', 'red']) {
          items.push({ id: `g-${kind}-${g.id}-${color}`, kind, graphic: g.id, name: `${g.name}`, color, geometry: geom(kind), ...(g.id === 'boundary' ? { echelon: 'F' } : {}) });
        }
      }
    }
    const res = await putNotes(turn, items);
    assert(!res.error, 'serwer przyjął wszystkie znaki: ' + res.error);
    await waitFor(`${store()}.notes.length === ${items.length}`, 'wczytanie wszystkich znaków do store', 15000);
    await sleep(800);
    assert((await ev(`document.querySelectorAll('#map .leaflet-overlay-pane path').length`)) > items.length, 'ścieżki znaków na mapie');
    // warstwa „Moje szkice” wyłączana z popovera Warstwy
    await clickSel('#b-layers');
    await clickSel('#lp-over [data-ov="notes"]');
    await sleep(300);
    assert((await ev(`document.querySelectorAll('#map .leaflet-overlay-pane path.leaflet-interactive').length`)) < items.length, 'wyłączenie warstwy szkiców ukrywa znaki');
    await clickSel('#lp-over [data-ov="notes"]');
    await key('Escape');
    await putNotes(turn, original);
    await waitFor(`${store()}.notes.length === ${original.length}`, 'przywrócenie szkiców');
    await sleep(500);
  });

  await step('miarka: odległość i tabela marszu, Esc kończy', async () => {
    const [ox, oy] = await mapOrigin();
    await clickSel('button[data-tool="measure"]');
    await click(ox + 200, oy + 450);
    await click(ox + 420, oy + 470);
    assert(await ev(`!document.querySelector('.measure-box').hidden && /km/.test(document.querySelector('.measure-box').textContent)`), 'miarka pokazuje km');
    assert(await ev(`[...document.querySelectorAll('#map path')].some((p) => (p.getAttribute('stroke') || '').toLowerCase() === '#111')`), 'linia miarki jest czarna');
    await key('Escape');
    assert(await ev(`!document.querySelector('button[data-tool="measure"]').classList.contains('is-active') && !document.querySelector('button[data-tool="measure"]').classList.contains('on')`), 'miarka wyłączona');
    await clickSel('button[data-tool="clear-measure"]');
    await key('m');
    await waitFor(`document.querySelector('button[data-tool="measure"]').classList.contains('on')`, 'klawisz M włącza miarkę');
    await key('Escape');
  });

  await step('T44 rozkaz graficzny: klawisz O, zaznaczenie klikiem, zadanie, punkt → załącznik w szkicu kanału, podgląd znaku, wysyłka z załącznikiem „order”', async () => {
    // jednostka z kanałem dowódcy; mapa wyśrodkowana na niej (niezależnie od poprzednich kroków)
    await ev(`window.__ks.controller.clearSelection()`);
    const unit = await state(`s.channels.find((c) => c.kind === 'subordinate' && c.unit && /^1bzmot-1k$|^krozp$/.test(c.unit) && s.turn.units.some((u) => u.id === c.unit && Array.isArray(u.pos)))?.unit`);
    assert(unit, 'jednostka z kanałem dowódcy');
    await ev(`window.__ks.controller.setDetail('company')`);
    await ev(`(() => { const u = window.__ks.store.get().turn.units.find((x) => x.id === ${JSON.stringify(unit)}); window.__ks.map.setView([u.pos[1], u.pos[0]], 12, { animate: false }); })()`);
    await sleep(300);
    await key('o');
    await waitFor(`!!window.__ks.store.get().orderMode && !document.getElementById('order-panel').hidden`, 'panel trybu rozkazu (klawisz O)');
    const [ox, oy] = await mapOrigin();
    const p = await pointOf(unit);
    assert(p, 'symbol jednostki na mapie');
    await click(ox + p[0], oy + p[1]);
    assert((await state(`s.orderMode.selected.join()`)) === unit, 'klik w symbol zaznacza jednostkę');
    assert(await ev(`!!document.querySelector('.ms-icon.is-order')`), 'zaznaczony symbol ma ramkę rozkazu');
    await clickSel('#order-panel [data-task="move"]');
    assert((await state(`s.orderMode.task + ':' + s.orderMode.kind`)) === 'move:point', 'marsz do → wskazanie punktu');
    await click(ox + 520, oy + 330);
    assert(await state(`s.orderMode === null`), 'punkt kończy tryb');
    const orders = await state(`Object.values(s.drafts).flatMap((d) => d.orders || [])`);
    assert(orders.length === 1 && orders[0].kind === 'order' && orders[0].task === 'move' && orders[0].geometry.type === 'Point' && orders[0].units[0] === unit, 'załącznik {units, task, geometry} w szkicu');
    await waitFor(`!!document.querySelector('#compose-chips .att--order')`, 'chip rozkazu w komunikatorze');
    assert(await ev(`!!document.querySelector('.tac-icon')`), 'podgląd rozkazu znakiem taktycznym na mapie');
    assert(await ev(`document.getElementById('compose-text').value.length > 0`), 'treść podpowiedziana');
    await clickSel('#compose-send');
    await waitFor(`[...document.querySelectorAll('#thread .msg .att')].some((e) => /rozkaz graficzny/.test(e.textContent))`, 'załącznik rozkazu w wątku');
    const sent = (await fetchJson('/api/messages')).messages.find((m) => m.attachments?.some((a) => a.kind === 'order'));
    assert(sent && sent.attachments[0].units[0] === unit && sent.attachments[0].geometry.type === 'Point', 'wiadomość z załącznikiem zapisana na serwerze');
    const bad = await ev(`fetch('/api/outbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: ${JSON.stringify(sent.channel)}, text: 'x', orders: [{ id: 'o-bad', kind: 'order', name: 'x', units: ['nie-ma'], task: 'move', geometry: { type: 'Point', coordinates: [1, 1] } }] }) }).then((r) => r.status)`);
    assert(bad === 400, 'serwer odrzuca rozkaz z nieznaną jednostką');
    await ev(`fetch('/api/outbox/' + ${JSON.stringify(sent.id)}, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }).then((r) => r.status)`);
    await waitFor(`!window.__ks.store.get().drafts[${JSON.stringify(sent.channel)}]?.orders?.length`, 'szkic oczyszczony po wysłaniu');
    // rubież: dwa punkty + Enter, Esc wycofuje krok po kroku
    await key('o');
    await waitFor(`!!window.__ks.store.get().orderMode`, 'tryb rozkazu');
    await click(ox + p[0], oy + p[1]);
    await clickSel('#order-panel [data-task="defend"]');
    await click(ox + 420, oy + 380);
    await click(ox + 560, oy + 400);
    await key('Enter');
    const line = await state(`Object.values(s.drafts).flatMap((d) => d.orders || [])`);
    assert(line.length === 1 && line[0].task === 'defend' && line[0].geometry.type === 'LineString' && line[0].geometry.coordinates.length === 2, 'rubież: LineString z 2 punktów');
    await ev(`window.__ks.controller.clearChannelDraft(${JSON.stringify(sent.channel)})`);
    await ev(`window.__ks.controller.setDetail(null)`);
    await key('o');
    await key('Escape');
    assert(await state(`s.orderMode === null`), 'tryb zamknięty');
  });

  await step('podkład: popover Warstwy, Jasna wyłącza is-dark-base, wybór zapisany', async () => {
    await clickSel('#b-layers');
    await waitFor(`document.getElementById('layers').classList.contains('open')`, 'popover warstw');
    assert((await ev(`document.querySelectorAll('#lp-base .lp-row').length`)) === 5, 'pięć podkładów');
    await clickSel('#lp-base [data-base="Jasna (Esri)"]');
    await waitFor(`${store()}.basemap === 'Jasna (Esri)'`, 'zmiana podkładu w store');
    assert(await ev(`!document.getElementById('map').classList.contains('is-dark-base')`), 'klasa zdjęta przy jasnym podkładzie');
    assert((await ev(`document.getElementById('st-b').textContent`)) === 'Jasna (Esri)', 'nazwa podkładu na pasku stanu');
    const sid = await state('s.scenario.id');
    assert(await ev(`JSON.parse(localStorage.getItem('ks:${await state('s.scenario.id')}:map')).base === 'Jasna (Esri)'`), `podkład zapisany (${sid})`);
    await clickSel('#lp-base [data-base="Satelita (Esri)"]');
    assert(await ev(`document.getElementById('map').classList.contains('is-dark-base')`), 'satelita też ma jasne podpisy');
    await clickSel('#lp-base [data-base="Ciemna (Esri)"]');
    assert(await ev(`document.getElementById('map').classList.contains('is-dark-base')`), 'ciemna Esri włącza is-dark-base');
    // nakładka kafelkowa i warstwa sytuacji
    // Panel renderuje się od nowa przy każdej zmianie store (m.in. nakładki od przełożonego, toasty): klik dopiero na ustabilizowanym układzie.
    await waitFor(`!document.querySelector('#toasts .toast')`, 'toasty zniknęły (nie zasłaniają panelu)', 15000);
    await sleep(300);
    await clickSel('#lp-over [data-ov="Koleje"]');
    await waitFor(`${store()}.layers['Koleje'] === true`, 'nakładka Koleje włączona');
    await clickSel('#lp-over [data-ov="Koleje"]');
    await clickSel('#lp-over [data-ov="contacts"]');
    await sleep(200);
    assert((await state('s.layers.contacts')) === false, 'warstwa kontaktów wyłączona');
    await clickSel('#lp-over [data-ov="contacts"]');
    await key('Escape');
    await waitFor(`!document.getElementById('layers').classList.contains('open')`, 'Esc zamyka popover');
    await key('w');
    await waitFor(`document.getElementById('layers').classList.contains('open')`, 'klawisz W otwiera warstwy');
    await key('Escape');
  });

  await step('omnibox: Ctrl+K, „1 bzmot” + Enter zaznacza jednostkę; filtry; polecenia; Esc', async () => {
    await key('k', { ctrl: true });
    await waitFor(`document.getElementById('omni').classList.contains('open')`, 'omnibox otwarty');
    assert(await ev(`document.activeElement.id === 'o-q'`), 'fokus w polu wyszukiwania');
    await typeInto('#o-q', '1 bzmot');
    assert((await ev(`document.querySelector('#o-list .o-i.sel .t').textContent`)) === '1 bzmot', 'pierwszy wynik: 1 bzmot');
    assert(await ev(`document.querySelector('#o-list .o-g').textContent === 'Jednostki'`), 'grupa Jednostki');
    await key('Enter');
    await waitFor(`!document.getElementById('omni').classList.contains('open')`, 'omnibox zamknięty po Enter');
    assert((await state('s.selection && s.selection.id')) === '1bzmot', 'Enter zaznacza jednostkę');
    assert((await state('s.focus && s.focus.kind')) === 'entity', 'i centruje mapę');
    assert((await ev(`document.querySelector('#insp-body .insp-title').textContent`)) === '1 bzmot', 'inspektor pokazuje jednostkę');
    // miejsca, kontakty, filtry
    await clickSel('#omni-open');
    await waitFor(`document.getElementById('omni').classList.contains('open')`, 'omnibox z przycisku');
    await typeInto('#o-q', 'Suwa');
    assert(await ev(`!![...document.querySelectorAll('#o-list .o-g')].find((g) => g.textContent === 'Miejsca')`), 'wyniki z gazetera');
    await clickSel('#o-seg [data-f="contact"]');
    await typeInto('#o-q', 'c-00');
    assert((await ev(`document.querySelectorAll('#o-list .o-i').length`)) >= 1 && (await ev(`document.querySelector('#o-list .o-g').textContent.startsWith('Kontakty')`)), 'filtr Kontakty');
    await clickSel('#o-seg [data-f="command"]');
    await typeInto('#o-q', 'legend');
    await key('Enter');
    await waitFor(`document.getElementById('legend').classList.contains('open')`, 'polecenie „Pokaż legendę”');
    await key('Escape');
    // Shift+Enter: kanał jednostki
    await key('k', { ctrl: true });
    await typeInto('#o-q', 'bcz');
    await key('Enter', { shift: true });
    await waitFor(`${store()}.activeChannel === 'bcz'`, 'Shift+Enter otwiera kanał jednostki');
    // Esc i klik w tło
    await key('k', { ctrl: true });
    await waitFor(`document.getElementById('omni').classList.contains('open')`, 'ponowne otwarcie');
    await key('Escape');
    await waitFor(`!document.getElementById('omni').classList.contains('open')`, 'Esc zamyka omnibox');
    await key('/');
    await sleep(200);
    assert(await ev(`document.activeElement.id === 'tr-q'`), 'klawisz / ustawia fokus w filtrze struktury');
    await ev(`document.activeElement.blur()`);
  });

  await step('splitter: przeciągnięcie zmienia szerokość, zapis w localStorage, dwuklik = domyślna, klawiatura', async () => {
    const w0 = await width('#dock-l');
    const h = await centerOf('#sp-l');
    await drag(h[0], h[1], h[0] + 70, h[1]);
    const w1 = await width('#dock-l');
    assert(w1 > w0 + 50, `lewy dok poszerzony (${w0} → ${w1})`);
    assert((await ev(`JSON.parse(localStorage.getItem('ks.split.l'))`)) === Math.round(w1), 'szerokość zapisana pod ks.split.l');
    assert((await ev(`document.getElementById('sp-l').getAttribute('aria-valuenow')`)) === String(Math.round(w1)), 'aria-valuenow');
    assert((await ev(`document.getElementById('sp-l').getAttribute('role')`)) === 'separator', 'role=separator');
    // ograniczenie do maksimum 520 px
    const h2 = await centerOf('#sp-l');
    await drag(h2[0], h2[1], h2[0] + 400, h2[1]);
    assert((await width('#dock-l')) <= 521, 'maksimum 520 px');
    // dwuklik: domyślna
    const h3 = await centerOf('#sp-l');
    await click(h3[0], h3[1], 2);
    await sleep(200);
    assert(Math.abs((await width('#dock-l')) - w0) < 2, 'dwuklik przywraca domyślną szerokość');
    // klawiatura
    await ev(`document.getElementById('sp-l').focus()`);
    await key('ArrowRight');
    assert(Math.abs((await width('#dock-l')) - (w0 + 16)) < 2, 'strzałka → poszerza o 16 px');
    await key('Home');
    assert(Math.abs((await width('#dock-l')) - w0) < 2, 'Home = domyślna');
    // pozostałe splittery: prawy dok, oś czasu, pole wiadomości, struktura/inspektor
    const r0 = await width('#dock-r');
    const hr = await centerOf('#sp-r');
    await drag(hr[0], hr[1], hr[0] - 60, hr[1]);
    assert((await width('#dock-r')) > r0 + 40, 'prawy dok poszerzony');
    await ev(`document.getElementById('sp-r').focus()`);
    await key('Home');
    const t0 = await ev(`document.getElementById('timeline').getBoundingClientRect().height`);
    const ht = await centerOf('#sp-t');
    await drag(ht[0], ht[1], ht[0], ht[1] - 50);
    assert((await ev(`document.getElementById('timeline').getBoundingClientRect().height`)) > t0 + 30, 'oś czasu wyższa');
    await ev(`document.getElementById('sp-t').focus()`);
    await key('Home');
    const c0 = await ev(`document.getElementById('compose-text').getBoundingClientRect().height`);
    const hc = await centerOf('#sp-c');
    await drag(hc[0], hc[1], hc[0], hc[1] - 40);
    assert((await ev(`document.getElementById('compose-text').getBoundingClientRect().height`)) > c0 + 25, 'pole wiadomości wyższe');
    await ev(`document.getElementById('sp-c').focus()`);
    await key('Home');
    const i0 = await ev(`document.getElementById('p-tree').getBoundingClientRect().height`);
    const hi = await centerOf('#sp-i');
    await drag(hi[0], hi[1], hi[0], hi[1] + 60);
    assert((await ev(`document.getElementById('p-tree').getBoundingClientRect().height`)) > i0 + 40, 'struktura wyższa kosztem inspektora');
    await ev(`document.getElementById('sp-i').focus()`);
    await key('Home');
    // zapis przeżywa przeładowanie strony
    const h4 = await centerOf('#sp-l');
    await drag(h4[0], h4[1], h4[0] + 50, h4[1]);
    const saved = Math.round(await width('#dock-l'));
    await send('Page.navigate', { url: `${base}/?debug` });
    await waitFor(`window.__ks && ${store()}.turn && document.getElementById('dock-l')`, 'przeładowanie strony');
    await sleep(500);
    assert(Math.abs((await width('#dock-l')) - saved) < 2, `szerokość zachowana po przeładowaniu (${saved})`);
    const h5 = await centerOf('#sp-l');
    await click(h5[0], h5[1], 2);
    await sleep(200);
  });

  await step('docki: zwijanie do szyny 40 px (przycisk, przeciągnięcie, Alt+1/2) i rozwijanie', async () => {
    await clickSel('#tb-l');
    await waitFor(`document.body.classList.contains('l-collapsed')`, 'zwinięcie lewego docka');
    assert(Math.abs((await width('#dock-l')) - 40) < 1.5, 'szyna lewego docka ma 40 px');
    assert(await ev(`getComputedStyle(document.getElementById('rail-l')).display !== 'none' && getComputedStyle(document.querySelector('#dock-l .dock-body')).display === 'none'`), 'widoczna szyna z ikonami');
    assert(await ev(`document.querySelectorAll('#rail-l .rail-btn').length === 2`), 'ikony Struktura i Inspektor');
    assert((await state('s.ui.leftCollapsed')) === true, 'store.ui.leftCollapsed');
    assert((await ev(`localStorage.getItem('ks:dock-l-collapsed')`)) === 'true', 'stan zwinięcia zapisany');
    await clickSel('#rail-l-insp');
    await waitFor(`!document.body.classList.contains('l-collapsed')`, 'rozwinięcie klikiem w ikonę szyny');
    assert((await width('#dock-l')) > 200, 'dok rozwinięty');
    // przeciągnięcie poniżej 160 px zwija
    const h = await centerOf('#sp-l');
    await drag(h[0], h[1], h[0] - 300, h[1]);
    await waitFor(`document.body.classList.contains('l-collapsed')`, 'zwinięcie przez przeciągnięcie');
    await clickSel('#rail-l-tree');
    await waitFor(`!document.body.classList.contains('l-collapsed')`, 'ponowne rozwinięcie');
    assert((await width('#dock-l')) >= 220, 'po rozwinięciu szerokość z zakresu 220–520');
    // prawy dok: szyna z licznikiem nieprzeczytanych
    await key('2', { alt: true });
    await waitFor(`document.body.classList.contains('r-collapsed')`, 'Alt+2 zwija prawy dok');
    assert(Math.abs((await width('#dock-r')) - 40) < 1.5, 'szyna prawego docka 40 px');
    assert(await ev(`document.getElementById('rail-r-badge').textContent === String(${store()}.unread.total)`), 'licznik nieprzeczytanych na szynie');
    assert(await ev(`document.querySelector('.leader').style.display === 'none'`), 'linia do jednostki ukryta przy zwiniętym komunikatorze');
    await clickSel('#rail-r-msg');
    await waitFor(`!document.body.classList.contains('r-collapsed')`, 'rozwinięcie prawego docka');
    await key('1', { alt: true });
    await waitFor(`document.body.classList.contains('l-collapsed')`, 'Alt+1 zwija lewy dok');
    await key('1', { alt: true });
    await waitFor(`!document.body.classList.contains('l-collapsed')`, 'Alt+1 rozwija lewy dok');
  });

  await step('żywa aktualizacja: nowy plik tury → toast i przełączenie, zaznaczenie przetrwa', async () => {
    // Zaznaczona jednostka ma przetrwać zmianę tury (obiekt nadal istnieje).
    await ev(`window.__ks.controller.selectEntity('1bzmot')`);
    const t0 = await readJson('player/turns/000.json');
    const t1 = JSON.parse(JSON.stringify(t0));
    t1.turn = 1;
    t1.time = '2026-05-14T08:00:00+02:00';
    const mover = t1.units.find((u) => u.id === '1bzmot');
    mover.pos = [mover.pos[0] + 0.02, mover.pos[1] - 0.01];
    await writeJson('player/inbox/001.json', {
      messages: [{ id: 'in-001-01', channel: 'dd', from: 'Dowództwo', time: '2026-05-14T07:30:00+02:00', text: 'Smoke: rozkaz z tury pierwszej.' }],
    });
    await sleep(500);
    assert((await state('s.viewTurn')) === 0, 'inbox następnej tury nie przełącza widoku');
    await writeJson('player/turns/001.json', t1);
    await waitFor(`${store()}.viewTurn === 1`, 'przełączenie na turę 1');
    await waitFor(`[...document.querySelectorAll('.toast')].some((t) => /rozstrzygnięta/.test(t.textContent))`, 'toast „Tura rozstrzygnięta”');
    assert((await ev(`document.getElementById('clk-turn').textContent`)) === 'TURA 1', 'zegar: TURA 1');
    assert((await state('s.selection && s.selection.id')) === '1bzmot', 'zaznaczenie przetrwało zmianę tury');
    assert(await ev(`document.querySelector('#insp-body .insp-title').textContent === '1 bzmot'`), 'inspektor przetrwał zmianę tury');
    assert((await ev(`document.querySelectorAll('.tl-node:not(.fut)').length`)) === 2, 'oś czasu: dwie dostępne tury');
    assert(await ev(`document.querySelector('.tl-node.cur').dataset.turn === '1'`), 'oś czasu: bieżąca tura 1');
    // dzwonek zbiera historię powiadomień
    assert((await ev(`document.getElementById('bell-badge').hidden`)) === false, 'dzwonek z licznikiem');
    await clickSel('#tb-bell');
    await waitFor(`document.getElementById('bell-pop').classList.contains('open')`, 'popover powiadomień');
    assert(await ev(`/rozstrzygnięta/.test(document.getElementById('bell-pop').textContent)`), 'historia powiadomień');
    await clickSel('#brand-none, #topbar .brand');
    await key('Escape');
  });

  await step('oś czasu: klik w turę = archiwum, baner, zablokowany komunikator i szkice; „Bieżąca” wraca', async () => {
    await clickSel('#chtabs [data-ch="dd"]');
    await waitFor(`${threadHas('Smoke: rozkaz z tury pierwszej')}`, 'wiadomość tury 1 w trybie bieżącym');
    await clickSel('.tl-node[data-turn="0"]');
    await waitFor(`${store()}.viewTurn === 0`, 'przejście do tury 0 klikiem w oś czasu');
    assert(await state('s.archive === true'), 'jedna flaga archiwum w store');
    assert(await ev(`document.body.classList.contains('archive')`), 'body.archive');
    assert(await ev(`getComputedStyle(document.querySelector('.tl-banner')).display !== 'none'`), 'baner archiwum na osi czasu');
    assert(await ev(`document.querySelector('.tl-node.view').dataset.turn === '0'`), 'węzeł oglądanej tury w kolorze archiwum');
    assert(await ev(`getComputedStyle(document.querySelector('.tl-node.view i')).backgroundColor === 'rgb(232, 179, 57)'`), 'bursztynowy romb archiwum');
    assert((await ev(`document.getElementById('clk-turn').textContent`)) === 'ARCHIWUM · TURA 0', 'zegar: ARCHIWUM · TURA 0');
    assert(await ev(`getComputedStyle(document.getElementById('clk-turn')).color === 'rgb(232, 179, 57)'`), 'znacznik tury bursztynowy');
    assert(await ev(`document.getElementById('compose-text').disabled && document.getElementById('compose-send').disabled`), 'pole rozkazu zablokowane');
    assert(await ev(`!document.querySelector('#thread').textContent.includes('Smoke: rozkaz z tury pierwszej')`), 'komunikator nie pokazuje wiadomości z późniejszej tury');
    assert(await ev(`document.querySelector('button[data-tool="arrow"]').disabled`), 'narzędzia rysowania zablokowane w archiwum');
    assert(await ev(`document.getElementById('ab-btn').disabled`), '„Po bitwie” zablokowane podczas gry');
    assert((await ev(`document.getElementById('tl-info').textContent`)) === 'T0 · archiwum', 'opis osi czasu');
    await clickSel('#t-cur');
    await waitFor(`${store()}.viewTurn === 1`, 'powrót do bieżącej tury');
    assert(await ev(`!document.body.classList.contains('archive')`), 'archiwum wyłączone');
    assert(await ev(`document.querySelector('#thread').textContent.includes('Smoke: rozkaz z tury pierwszej')`), 'wiadomość wraca po powrocie');
    await key(',');
    await waitFor(`${store()}.viewTurn === 0`, 'klawisz , = poprzednia tura');
    await clickSel('#tl-cur');
    await waitFor(`${store()}.viewTurn === 1`, 'przycisk Bieżąca na osi czasu');
    await key('.');
    await sleep(200);
    assert((await state('s.viewTurn')) === 1, 'klawisz . na bieżącej turze nic nie zmienia');
  });

  await step('wyścig: szybkie przełączanie tur kończy na ostatnim wyborze', async () => {
    const final = await ev(`(async () => {
      const c = window.__ks.controller;
      const a = c.showTurn(0);
      const b = c.showTurn(1);
      const d = c.showTurn(0);
      await Promise.all([a, b, d]);
      return window.__ks.store.get().viewTurn;
    })()`);
    assert(final === 0, `ostatni wybór wygrywa (viewTurn=${final})`);
    await clickSel('#t-cur');
    await waitFor(`${store()}.viewTurn === 1`, 'powrót do bieżącej');
  });

  // ---------- T12.8 animacja przemieszczeń i T13.2 formacje sąsiadów ----------
  // Tura 2 (żywa aktualizacja): 2bzmot jedzie po trasie (track), 1bzmot po prostej, kontakt c-001 zmienia zameldowaną
  // pozycję, a sąsiad zt-mamry dostaje własne jednostki (formation).
  const FINAL_2BZMOT = [23.15, 54.1];
  const finalPoint = (lonlat) => ev(`(() => { const p = window.__ks.map.latLngToContainerPoint([${lonlat[1]}, ${lonlat[0]}]); return [p.x, p.y]; })()`);
  const isActive = () => ev(`window.__ks.motion.isActive()`);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  await step('animacja: nowa tura → symbole jadą po trasie (track) i po prostej, ślad, duch kontaktu, pulsowanie; kończy na nowej pozycji', async () => {
    assert(await state('s.ui.animations === true && s.ui.reducedMotion === false'), 'animacje włączone domyślnie');
    await ev(`window.__ks.controller.selectEntity('2bzmot', { pan: false })`); // zaznaczenie i poświata podążają za symbolem
    await ev(`window.__ks.controller.hoverUnit(null)`);
    const t1 = await readJson('player/turns/001.json');
    const t2 = JSON.parse(JSON.stringify(t1));
    t2.turn = 2;
    t2.time = '2026-05-14T10:00:00+02:00';
    const u = (id) => t2.units.find((x) => x.id === id);
    const from2 = u('2bzmot').pos.slice();
    u('2bzmot').pos = FINAL_2BZMOT;
    u('2bzmot').track = [from2, [23.2, 54.14], FINAL_2BZMOT];
    const from1 = u('1bzmot').pos.slice();
    u('1bzmot').pos = [from1[0] + 0.03, from1[1] + 0.02];
    t2.contacts.find((c) => c.id === 'c-001').pos = [22.65, 54.38];
    t2.units.push(
      { id: 'mamry-1bzmot', name: '1 bzmot (ZT Mamry)', sidc: 'SFGPUCIZ---F---', formation: 'zt-mamry', pos: [22.5, 54.2], strength: 0.9, status: 'w obronie' },
      { id: 'mamry-1bzmot-1k', name: '1k 1 bzmot (ZT Mamry)', sidc: 'SFGPUCIZ---E---', parent: 'mamry-1bzmot', pos: [22.49, 54.21], strength: 0.9 },
      { id: 'mamry-2bzmot', name: '2 bzmot (ZT Mamry)', sidc: 'SFGPUCIZ---F---', formation: 'zt-mamry', pos: [22.55, 54.1], strength: 0.85 },
    );
    t2.lines = [...(t2.lines || []), { id: 'flot-mamry', kind: 'flot', label: 'FLOT ZT Mamry', coords: [[22.45, 54.05], [22.5, 54.25]], formation: 'zt-mamry' }];
    const startPt = await pointOf('2bzmot');
    await ev(`(() => {
      window.__smp = [];
      const t0 = performance.now();
      window.__smpT = setInterval(() => {
        const p = window.__ks.surface.pointOf('2bzmot');
        window.__smp.push({ t: performance.now() - t0, p: p && [p.x, p.y], a: window.__ks.motion.isActive(), trails: document.querySelectorAll('.motion-trail').length, ghost: document.querySelectorAll('.motion-ghost').length, pulse: document.querySelectorAll('.ms-icon.is-pulse').length, sel: document.querySelectorAll('.ms-icon.is-selected').length });
      }, 40);
    })()`);
    await writeJson('player/turns/002.json', t2);
    await waitFor(`${store()}.viewTurn === 2`, 'przełączenie na turę 2');
    await sleep(3200);
    const samples = await ev(`(() => { clearInterval(window.__smpT); return window.__smp; })()`);
    const active = samples.filter((s) => s.a && s.p);
    const fin = await finalPoint(FINAL_2BZMOT);
    assert(active.length >= 20, `animacja trwa wiele klatek (${active.length})`);
    const span = active.at(-1).t - active[0].t;
    assert(span >= 1800 && span <= 3300, `czas animacji ~2,5 s (${Math.round(span)} ms)`);
    assert(dist(active[0].p, fin) > 25, 'start daleko od pozycji końcowej');
    assert(dist(active[0].p, startPt) < 12, 'start w poprzedniej pozycji');
    assert(new Set(active.map((s) => s.p.join(','))).size >= 15, 'pozycja zmienia się płynnie w czasie');
    const [a, b] = [active[0].p, fin];
    const line = (p) => Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
    assert(Math.max(...active.map((s) => line(s.p))) > 8, 'jednostka jedzie po trasie (track), nie po prostej');
    assert(dist(await pointOf('2bzmot'), fin) < 1.5, 'po animacji symbol stoi na nowej pozycji');
    assert(active.some((s) => s.trails > 0), 'ślad jest rysowany');
    assert(active.some((s) => s.ghost > 0), 'duch starej pozycji kontaktu');
    assert(active.some((s) => s.pulse > 0), 'nowy symbol kontaktu pulsuje');
    assert(samples.every((s) => s.sel === 1), 'poświata zaznaczenia jest przez cały czas animacji');
    assert(!(await isActive()), 'animacja zakończona');
    await waitFor(`document.querySelectorAll('.motion-trail').length === 0 && document.querySelectorAll('.motion-ghost').length === 0`, 'ślad i duch znikają po ok. 3 s', 8000);
  });

  await step('animacja: linie podporządkowania i linia komunikatora podążają za symbolem w trakcie ruchu', async () => {
    await ev(`window.__ks.controller.selectChannel('2bzmot')`);
    await waitFor(`document.querySelector('.leader').style.display !== 'none'`, 'linia do jednostki widoczna');
    await clickSel('#tl-replay');
    await waitFor(`window.__ks.motion.isActive()`, 'start odtwarzania');
    await sleep(900);
    const r = await ev(`(() => {
      const m = window.__ks.surface.pointOf('2bzmot');
      const mapBox = document.getElementById('map').getBoundingClientRect();
      const dot = document.querySelector('.leader__dot');
      const box = document.getElementById('app').getBoundingClientRect();
      const link = [...document.querySelectorAll('#map path[stroke="#ff2bd6"]')].map((p) => p.getBoundingClientRect());
      return { m: [m.x + mapBox.x - box.x, m.y + mapBox.y - box.y], dot: [+dot.getAttribute('cx'), +dot.getAttribute('cy')], links: link.length, active: window.__ks.motion.isActive() };
    })()`);
    assert(r.active, 'animacja trwa');
    assert(dist(r.m, r.dot) < 14, `linia komunikatora kończy się przy ruchomym symbolu (${Math.round(dist(r.m, r.dot))} px)`);
    assert(r.links > 0, 'linie podporządkowania na mapie');
    // klik w mapę kończy animację natychmiast
    const o = await mapOrigin();
    await click(o[0] + 120, o[1] + 420);
    assert(!(await isActive()), 'klik w mapę kończy animację od razu');
    assert(dist(await pointOf('2bzmot'), await finalPoint(FINAL_2BZMOT)) < 1.5, 'symbol od razu na pozycji końcowej');
    await ev(`window.__ks.controller.selectChannel('dd')`);
  });

  await step('animacja: „▶ Odtwórz turę” i polecenie omniboksu odtwarzają przejście; pierwsza tura nie ma poprzedniej', async () => {
    const btn = '#tl-replay';
    assert((await ev(`document.querySelector('${btn}').textContent`)).includes('Odtwórz turę'), 'etykieta przycisku');
    await clickSel(btn);
    await waitFor(`window.__ks.motion.isActive()`, 'odtwarzanie rusza');
    await sleep(350);
    assert(dist(await pointOf('2bzmot'), await finalPoint(FINAL_2BZMOT)) > 10, 'w trakcie odtwarzania symbol jest jeszcze w drodze');
    await waitFor(`!window.__ks.motion.isActive()`, 'koniec odtwarzania', 6000);
    assert(dist(await pointOf('2bzmot'), await finalPoint(FINAL_2BZMOT)) < 1.5, 'po odtworzeniu na pozycji końcowej');
    // polecenie z omniboksu
    await key('k', { ctrl: true });
    await waitFor(`document.getElementById('omni').classList.contains('open')`, 'omnibox');
    await typeInto('#o-q', 'odtw');
    await sleep(300);
    assert(await ev(`[...document.querySelectorAll('#o-list .o-i .t')].some((t) => /Odtwórz turę/.test(t.textContent))`), 'polecenie „Odtwórz turę” w omniboksie');
    await key('Enter');
    await waitFor(`window.__ks.motion.isActive()`, 'odtwarzanie z omniboksu');
    await waitFor(`!window.__ks.motion.isActive()`, 'koniec', 6000);
    // tura 0 nie ma poprzedniej
    await ev(`window.__ks.controller.showTurn(0)`);
    await waitFor(`${store()}.viewTurn === 0`, 'tura 0');
    assert(await ev(`document.getElementById('tl-replay').disabled`), 'przycisk wyłączony dla pierwszej tury');
    assert(!(await isActive()), 'archiwum: bez animacji');
  });

  await step('animacja: skok o kilka tur i cofanie są natychmiastowe; „następna tura” z osi czasu animuje', async () => {
    await ev(`window.__ks.controller.showTurn(2)`); // 0 → 2: nie po kolei
    await waitFor(`${store()}.viewTurn === 2`, 'skok do tury 2');
    assert(!(await isActive()), 'skok T0 → T2 bez animacji');
    assert(dist(await pointOf('2bzmot'), await finalPoint(FINAL_2BZMOT)) < 1.5, 'skok: symbol od razu na nowej pozycji');
    await clickSel('#tl-prev');
    await waitFor(`${store()}.viewTurn === 1`, 'cofnięcie do tury 1');
    assert(!(await isActive()), 'cofnięcie bez animacji');
    await clickSel('#tl-next');
    await waitFor(`${store()}.viewTurn === 2`, 'następna tura');
    assert(await isActive(), 'przejście T1 → T2 z osi czasu animuje');
    await waitFor(`!window.__ks.motion.isActive()`, 'koniec animacji', 6000);
    assert(dist(await pointOf('2bzmot'), await finalPoint(FINAL_2BZMOT)) < 1.5, 'po animacji na pozycji końcowej');
  });

  await step('animacje: przełącznik w panelu Warstwy (zapamiętany) i prefers-reduced-motion = natychmiast', async () => {
    await clickSel('#b-layers');
    await waitFor(`document.getElementById('layers').classList.contains('open')`, 'popover Warstwy');
    assert(await ev(`document.querySelector('#layers [data-anim]').getAttribute('aria-checked') === 'true'`), 'przełącznik „Animacje” włączony');
    await clickSel('#layers [data-anim]');
    assert(await state('s.ui.animations === false'), 'store: animacje wyłączone');
    assert((await ev(`localStorage.getItem('ks:animations')`)) === 'false', 'wybór zapamiętany');
    await key('Escape');
    await ev(`window.__ks.controller.showTurn(1)`);
    await waitFor(`${store()}.viewTurn === 1`, 'tura 1');
    await clickSel('#tl-next');
    await waitFor(`${store()}.viewTurn === 2`, 'tura 2');
    assert(!(await isActive()), 'animacje wyłączone: przejście natychmiastowe');
    assert(dist(await pointOf('2bzmot'), await finalPoint(FINAL_2BZMOT)) < 1.5, 'od razu na nowej pozycji');
    await clickSel('#tl-replay');
    await sleep(300);
    assert(!(await isActive()), 'odtwarzanie też nie animuje, gdy animacje wyłączone');
    assert(await ev(`[...document.querySelectorAll('.toast')].some((t) => /wyłączone/.test(t.textContent))`), 'komunikat o wyłączonych animacjach');
    // włączenie z powrotem
    await ev(`window.__ks.controller.setAnimations(true)`);
    // ograniczenie ruchu z systemu
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await waitFor(`${store()}.ui.reducedMotion === true`, 'wykryto prefers-reduced-motion');
    await ev(`window.__ks.controller.showTurn(1)`);
    await waitFor(`${store()}.viewTurn === 1`, 'tura 1');
    await clickSel('#tl-next');
    await waitFor(`${store()}.viewTurn === 2`, 'tura 2');
    assert(!(await isActive()), 'prefers-reduced-motion: natychmiast');
    await ev(`window.__ks.controller.setPopover('layers')`);
    assert(await ev(`/SYSTEM/.test(document.querySelector('#layers [data-anim]').textContent)`), 'panel Warstwy: animacje wyłączone przez system');
    await ev(`window.__ks.controller.setPopover(null)`);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await waitFor(`${store()}.ui.reducedMotion === false`, 'powrót do normalnego ruchu');
  });

  await step('sąsiedzi: formacja w drzewie (rozwijana, wyszarzona), bez kanałów, mapa, inspektor tylko do odczytu, omnibox „Sąsiedzi”, POST → 400', async () => {
    // drzewo
    assert(await ev(`document.querySelector('#tree-scroll .tree--nb') !== null`), 'formacja sąsiada w sekcji „Przełożony i sąsiedzi”');
    assert(await ev(`document.querySelectorAll('#tree-scroll .trow.nb-unit').length >= 3`), 'jednostki sąsiada jako wiersze drzewa');
    assert(await ev(`document.querySelector('#tree-scroll .trow.nb[data-id="zt-mamry"] .tname').textContent.includes('sąsiad')`), 'dowództwo oznaczone „sąsiad”');
    assert(await ev(`[...document.querySelectorAll('#tree-scroll .trow.nb-unit')].every((r) => !r.querySelector('[data-msg]') && !r.querySelector('.ubadge'))`), 'jednostki sąsiada bez przycisku kanału');
    assert(await ev(`document.querySelectorAll('#tree-scroll .tree--nb li').length >= 4`), 'dowództwo + 3 jednostki z połączeniami drzewa');
    assert(await ev(`!document.querySelector('#tree-scroll [data-secb="own"]').textContent.includes('(ZT Mamry)')`), 'siły własne nie zawierają jednostek sąsiada');
    // zwijanie
    await clickSel('#tree-scroll .trow.nb[data-id="zt-mamry"] .tcar');
    assert(await ev(`document.querySelectorAll('#tree-scroll .trow.nb-unit').length === 0`), 'zwinięcie formacji');
    await clickSel('#tree-scroll .trow.nb[data-id="zt-mamry"] .tcar');
    assert(await ev(`document.querySelectorAll('#tree-scroll .trow.nb-unit').length >= 3`), 'ponowne rozwinięcie');
    // brak kanałów
    assert(await state(`!s.channels.some((c) => c.id.startsWith('mamry-'))`), 'store.channels bez jednostek sąsiada');
    assert(await state(`s.channels.some((c) => c.id === 'zt-mamry')`), 'kanał samego sąsiada pozostaje');
    assert(await ev(`!document.getElementById('chtabs').textContent.includes('Mamry-') && !document.getElementById('chtabs').textContent.includes('(ZT Mamry)')`), 'pasek kanałów bez jednostek sąsiada');
    const post = await fetchJson('/api/outbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'mamry-1bzmot', text: 'Rozkaz do sąsiada' }) });
    assert(/sąsiad/i.test(post.error || ''), 'POST do jednostki sąsiada odrzucony z komunikatem');
    const status = await ev(`fetch('/api/outbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'mamry-1bzmot', text: 'x' }) }).then((r) => r.status)`);
    assert(status === 400, `POST do kanału jednostki sąsiada → 400 (${status})`);
    // mapa
    assert((await pointOf('mamry-1bzmot')) !== null, 'jednostka sąsiada widoczna na mapie (poziom batalionu)');
    const greyLinks = await ev(`document.querySelectorAll('#map path[stroke="#9aa6b5"], #map path[stroke="#c3ccd8"]').length`);
    assert(greyLinks >= 2, `szare przerywane linie dowództwo sąsiada → jednostki (${greyLinks}; poziom ${await state('s.level')}; linki: ${await ev(`[...new Set([...document.querySelectorAll('#map path')].map((p) => p.getAttribute('stroke')))].join(',')`)})`);
    assert((await ev(`getComputedStyle(document.querySelector('#map path[stroke="#9aa6b5"], #map path[stroke="#c3ccd8"]')).strokeDasharray`)) !== 'none', 'linie przerywane');
    // inspektor
    await ev(`window.__ks.controller.selectEntity('mamry-1bzmot', { pan: false })`);
    await sleep(200);
    assert(await ev(`document.querySelector('#insp-body .nb-note') !== null && /brak dowodzenia/.test(document.querySelector('#insp-body .nb-note').textContent)`), 'adnotacja „Sąsiad — brak dowodzenia”');
    assert(await ev(`!document.querySelector('#insp-body [data-act="msg"]') && !document.querySelector('#insp-body [data-act="ord"]')`), 'brak akcji Wiadomość / Rozkaz');
    assert(await ev(`document.querySelector('#insp-body [data-act="aim"]') !== null`), 'Wycentruj dostępne');
    assert(await ev(`document.getElementById('in-tabs').hidden === true`), 'zakładki jednostki własnej ukryte');
    // dwuklik nie otwiera kanału
    await click(...(await centerOf('#tree-scroll .trow.nb-unit')), 2);
    assert(await state(`s.activeChannel !== 'mamry-1bzmot'`), 'dwuklik nie otwiera kanału jednostki sąsiada');
    // omnibox
    await key('k', { ctrl: true });
    await waitFor(`document.getElementById('omni').classList.contains('open')`, 'omnibox');
    await typeInto('#o-q', 'mamry');
    await sleep(300);
    assert(await ev(`[...document.querySelectorAll('#o-list .o-g')].some((g) => g.textContent.trim() === 'Sąsiedzi')`), 'kategoria „Sąsiedzi” w omniboksie');
    assert(await ev(`[...document.querySelectorAll('#o-list .o-i .t')].some((t) => t.textContent.includes('1 bzmot (ZT Mamry)'))`), 'omnibox znajduje jednostkę sąsiada');
    await key('Escape');
  });

  await step('sąsiedzi: ich jednostki też jadą w animacji (track), a sąsiad bez zmian stoi', async () => {
    const t2 = await readJson('player/turns/002.json');
    const t3 = JSON.parse(JSON.stringify(t2));
    t3.turn = 3;
    t3.time = '2026-05-14T12:00:00+02:00';
    const m = t3.units.find((x) => x.id === 'mamry-1bzmot');
    const from = m.pos.slice();
    m.pos = [22.58, 54.17];
    m.track = [from, [22.54, 54.23], m.pos];
    await writeJson('player/turns/003.json', t3);
    await waitFor(`${store()}.viewTurn === 3`, 'przełączenie na turę 3');
    const ids = await state(`s.animation && s.animation.plan.moves.map((m) => m.id)`);
    assert(ids && ids.includes('mamry-1bzmot') && !ids.includes('mamry-2bzmot') && !ids.includes('zt-mamry'), `plan: porusza się tylko jednostka sąsiada (${ids})`);
    await waitFor(`!window.__ks.motion.isActive()`, 'koniec animacji', 6000);
    assert(dist(await pointOf('mamry-1bzmot'), await finalPoint([22.58, 54.17])) < 1.5, 'jednostka sąsiada na nowej pozycji');
    await ev(`window.__ks.controller.showCurrent()`);
  });

  // ===== T18: panel DOS =====
  await step('T18 DOS: panel zbiorczy (klawisz D, sortowanie po najgorszym, kolory), klik w wiersz → karta z paskami i wiekiem, jednostka wyliczona', async () => {
    await ev(`window.__ks.controller.showTurn(0)`);
    await waitFor(`${store()}.viewTurn === 0`, 'tura 0');
    assert((await state(`s.turn.units.some((u) => u.dos)`)), 'tura 0 ma jednostki z dos (injectLogisticsSample)');
    await key('d');
    await waitFor(`document.getElementById('dos-panel').classList.contains('open')`, 'panel DOS otwarty klawiszem D');
    const rows = await ev(`[...document.querySelectorAll('#dos-body .dos-row')].map((r) => [r.dataset.unit, r.dataset.level])`);
    assert(rows.length >= 5, 'wiersze jednostek własnych: ' + rows.length);
    assert(!rows.some(([id]) => /^mamry-|^biebrza-/.test(id)), 'bez jednostek sąsiadów');
    assert(rows[0][1] === 'bad', 'najgorsza jednostka na górze jest czerwona: ' + rows[0]);
    const rank = { bad: 0, warn: 1, ok: 2, none: 3 };
    assert(rows.every((r, i) => i === 0 || rank[rows[i - 1][1]] <= rank[r[1]]), 'sortowanie od najgorszego: ' + rows.map((r) => r[1]).join());
    assert(await ev(`document.querySelector('#dos-body .dos-row[data-unit="2bzmot"] .dos-bad') !== null`), 'komórka czerwona (paliwo 0,6 d)');
    assert(await ev(`document.querySelector('#dos-body .dos-row[data-unit="bcz"] .pill') !== null`), 'bcz: wiersz oznaczony jako wyliczony');
    // klik w wiersz → karta jednostki z sekcją DOS
    await clickSel('#dos-body .dos-row[data-unit="2bzmot"]');
    await waitFor(`${store()}.selection?.id === '2bzmot'`, 'zaznaczenie po kliku w wiersz');
    await waitFor(`document.querySelector('#insp-body [data-dos-block]')`, 'sekcja DOS w karcie');
    const card = await ev(`(() => { const b = document.querySelector('#insp-body [data-dos-block]'); return { bars: b.querySelectorAll('.dosb').length, levels: [...b.querySelectorAll('.dosb')].map((x) => x.dataset.level + ':' + x.querySelector('.meter').className).join(), text: b.innerText }; })()`);
    assert(card.bars === 4, 'cztery paski DOS: ' + card.bars);
    assert(/bad:meter bad/.test(card.levels) && /warn:meter warn/.test(card.levels), 'paski w kolorach progu: ' + card.levels);
    assert(/meldunek/.test(card.text) && /temu/.test(card.text), 'wiek meldunku: ' + card.text);
    assert(!/WYLICZONE/.test(card.text), 'własny meldunek nie jest wyliczony');
    // jednostka bez własnego dos → minimum z podwładnych
    await ev(`window.__ks.controller.selectEntity('bcz', { pan: false })`);
    await waitFor(`/WYLICZONE/.test(document.getElementById('insp-body').innerText)`, 'karta bcz: DOS wyliczony');
    await key('Escape');
    assert(await ev(`!document.getElementById('dos-panel').classList.contains('open')`), 'Esc zamyka panel');
    await ev(`window.__ks.controller.clearSelection(); window.__ks.controller.showCurrent()`);
  });
  // ===== koniec T18 =====


  await step('telefon (≤ 760 px): dolny pasek zakładek, arkusze, splittery wyłączone', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    assert(await ev(`getComputedStyle(document.getElementById('tabbar')).display !== 'none'`), 'pasek zakładek widoczny');
    assert(await ev(`getComputedStyle(document.getElementById('sp-l')).display === 'none'`), 'splittery ukryte');
    assert(await state('s.ui.narrow === true'), 'store.ui.narrow');
    await clickSel('#tabbar [data-m="tree"]');
    assert(await ev(`document.body.dataset.m === 'tree' && getComputedStyle(document.getElementById('dock-l')).display !== 'none' && document.getElementById('dock-l').getBoundingClientRect().width > 380`), 'Struktura jako arkusz');
    await clickSel('#tabbar [data-m="msg"]');
    assert(await ev(`document.body.dataset.m === 'msg' && getComputedStyle(document.getElementById('dock-r')).display !== 'none'`), 'Komunikator jako arkusz');
    await clickSel('#tabbar [data-m="map"]');
    assert(await ev(`getComputedStyle(document.getElementById('dock-r')).display === 'none' && document.getElementById('map').getBoundingClientRect().width > 380`), 'mapa na pełnej szerokości');
    assert(await ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`), 'brak poziomego przewijania strony');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    assert(await state('s.ui.narrow === false'), 'powrót do układu desktop');
  });

  await step('T48 CCIR: edytor (PIR, tekst, punkt z mapy, zapis), nakładka, wiadomość z ccir (znacznik, filtr „tylko CCIR”), SITREP zgrupowany na osi', async () => {
    await clickSel('#tb-ccir');
    await waitFor(`!document.getElementById('ccir-panel').hidden`, 'panel CCIR otwarty');
    await clickSel('#ccir-panel [data-add="PIR"]');
    await waitFor(`!!document.querySelector('#ccir-panel input[data-text="PIR-1"]')`, 'pozycja PIR-1');
    await ev(`(() => { const i = document.querySelector('#ccir-panel input[data-text="PIR-1"]'); i.value = 'Czołgi przeciwnika na wschód od linii obrony'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    assert(await state('s.ccirEditor.draft[0].text.startsWith("Czołgi")'), 'tekst trafił do kopii roboczej');
    // wskazanie punktu: tryb wskazywania, kliknięcie mapy (zdarzenie Leaflet), geometria w kopii roboczej
    await clickSel('#ccir-panel [data-pick="point"]');
    await waitFor(`!!${store()}.ccirEditor.pick`, 'tryb wskazywania');
    await ev(`(() => { const m = window.__ks.map; m.fire('click', { latlng: m.getCenter() }); })()`);
    await waitFor(`${store()}.ccirEditor.draft[0].geometry?.type === 'Point' && !${store()}.ccirEditor.pick`, 'punkt wskazany na mapie');
    await waitFor(`[...document.querySelectorAll('.ccir-label')].some((t) => t.textContent === 'PIR-1')`, 'etykieta PIR-1 na mapie');
    await clickSel('#ccir-panel [data-act="save"]');
    await waitFor(`${store()}.ccir.length === 1 && document.getElementById('ccir-panel').hidden`, 'zapis CCIR');
    const saved = await fetchJson('/api/ccir');
    assert(saved.items.length === 1 && saved.items[0].id === 'PIR-1' && saved.items[0].geometry.type === 'Point', 'player/ccir.json zapisany przez API');
    // wiadomości sędziego: pilny meldunek z ccir i zgrupowane SITREP-y
    const f = 'player/inbox/000.json';
    const inbox = await readJson(f);
    inbox.messages.push(
      { id: 'in-smoke-ccir', channel: 'log', from: 'por. Test, S2', time: '2026-05-14T06:40:00+02:00', type: 'meldunek', priority: 'urgent', ccir: 'PIR-1', text: 'smoke: kolumna pancerna' },
      { id: 'in-smoke-sit1', channel: 'log', from: 'por. Test, S2', time: '2026-05-14T06:50:00+02:00', type: 'meldunek', report: 'sitrep', text: 'smoke: SITREP 1' },
      { id: 'in-smoke-sit2', channel: 'dd', from: 'por. Test, dca', time: '2026-05-14T06:55:00+02:00', type: 'meldunek', report: 'sitrep', text: 'smoke: SITREP 2' },
    );
    await writeJson(f, inbox);
    await waitFor(`${store()}.messages.some((m) => m.id === 'in-smoke-sit2')`, 'odświeżenie wiadomości po SSE');
    await ev(`window.__ks.controller.selectChannel('log')`);
    await waitFor(`!!document.querySelector('#thread .msg[data-ccir="PIR-1"] .tag.ccir')`, 'znacznik PIR-1 na karcie wiadomości');
    assert(await ev(`!!document.querySelector('#thread .msg.rpt-sitrep .tag.rpt')`), 'znacznik SITREP');
    // filtr „tylko CCIR”
    await clickSel('#m-ccir');
    await waitFor(`document.querySelectorAll('#thread .msg').length > 0 && [...document.querySelectorAll('#thread .msg')].every((m) => m.dataset.ccir)`, 'filtr: tylko wiadomości z ccir');
    assert(await ev(`document.getElementById('m-ccir').getAttribute('aria-pressed') === 'true'`), 'przycisk filtra włączony');
    await clickSel('#m-ccir');
    await waitFor(`[...document.querySelectorAll('#thread .msg')].some((m) => !m.dataset.ccir)`, 'filtr wyłączony: wszystkie wiadomości');
    // oś czasu: dwa SITREP-y z jednej tury = jeden znacznik z licznikiem
    assert(await ev(`document.querySelectorAll('.tl-lane.msgs i.rep').length === 1 && document.querySelector('.tl-lane.msgs i.rep').dataset.tip === 'SITREP ×2'`), 'SITREP-y zgrupowane na osi czasu');
  });

  await step('T50 formularze: SPOTREP z mapy (menu Szablon), blokada niekompletnego, wysyłka z form, tabelka w wątku, form z inboxa (escape)', async () => {
    await ev(`window.__ks.controller.selectChannel('log')`);
    await clickSel('#tpl-btn');
    await waitFor(`!!document.querySelector('#tpl-menu [data-form="spotrep"]')`, 'formularze w menu szablonów');
    await clickSel('#tpl-menu [data-form="spotrep"]');
    await waitFor(`!document.getElementById('compose-form').hidden && !!document.querySelector('#compose-form [data-ff="what"]')`, 'panel formularza SPOTREP');
    // niekompletny formularz nie wychodzi
    const before = (await fetchJson('/api/messages')).messages.length;
    await ev(`document.getElementById('compose').requestSubmit()`);
    assert((await fetchJson('/api/messages')).messages.length === before, 'niekompletny formularz nie został wysłany');
    const fill = (id, v) => ev(`(() => { const i = document.querySelector('#compose-form [data-ff="${id}"]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await fill('what', 'kolumna <b>czołgów</b>');
    await fill('count', '~10 pojazdów');
    await fill('when', '07:22');
    await fill('certainty', 'średnia');
    // pole „gdzie” z mapy
    await clickSel('#compose-form [data-ff-pick="where"][data-shape="point"]');
    await waitFor(`${store()}.ccirEditor.pick?.target === 'form'`, 'tryb wskazywania pola formularza');
    await ev(`(() => { const m = window.__ks.map; m.fire('click', { latlng: m.getCenter() }); })()`);
    await waitFor(`${store()}.drafts['log']?.form?.fields?.where?.type === 'Point' && !${store()}.ccirEditor.pick`, 'punkt „gdzie” z mapy w formularzu');
    assert(await ev(`document.querySelector('#compose-form [data-ff-geo="where"]').textContent.length > 4`), 'pozycja pokazana w panelu');
    await ev(`document.getElementById('compose').requestSubmit()`);
    await waitFor(`${store()}.messages.some((m) => m.form?.kind === 'spotrep')`, 'wiadomość z form w store');
    const turnNo = String(await state('s.currentTurn')).padStart(3, '0');
    const out = (await readJson(`player/outbox/${turnNo}.json`)).messages.find((m) => m.form?.kind === 'spotrep');
    assert(out && out.type === 'meldunek' && out.form.fields.where.type === 'Point' && out.text.startsWith('SPOTREP') && out.text.includes('Gdzie:'), 'outbox: text + form {kind, fields} ');
    await waitFor(`document.getElementById('compose-form').hidden`, 'panel zamknięty po wysłaniu');
    await waitFor(`!!document.querySelector('#thread table.form-tbl')`, 'tabelka formularza w wątku');
    assert(await ev(`!document.querySelector('#thread table.form-tbl td b') && document.querySelector('#thread table.form-tbl').textContent.includes('<b>czołgów</b>')`), 'wartości w tabelce są zescapowane');
    // serwer odrzuca błędny form
    const bad = await ev(`fetch('/api/outbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'log', text: 'x', form: { kind: 'spotrep', fields: { what: 'x' } } }) }).then((r) => r.status)`);
    assert(bad === 400, 'serwer odrzuca niekompletny formularz (400)');
    // form od postaci (inbox)
    const f = 'player/inbox/000.json';
    const inbox = await readJson(f);
    inbox.messages.push({ id: 'in-smoke-form', channel: 'log', from: 'por. Test, S2', time: '2026-05-14T06:58:00+02:00', type: 'meldunek', text: 'LOGSTAT\nPaliwo: 1 DOS', form: { kind: 'logstat', fields: { fuel: '1 DOS <i>x</i>', ammo: '2 DOS', personnel: '90%', needs: 'paliwo' } } });
    await writeJson(f, inbox);
    await waitFor(`${store()}.messages.some((m) => m.id === 'in-smoke-form')`, 'form z inboxa po SSE');
    await waitFor(`!!document.querySelector('#thread .msg[data-id="in-smoke-form"] table.form-tbl')`, 'tabelka formularza od postaci');
    assert(await ev(`!document.querySelector('#thread .msg[data-id="in-smoke-form"] table i')`), 'treść z inboxa zescapowana');
  });

  await step('T52 ogień: zgłoszenie (outbox, form fire) → znacznik „wysłane”, odpowiedzi sędziego (fire w inbox) → przyjęte, wykonane; przełącznik warstwy', async () => {
    const sent = await ev(`fetch('/api/outbox', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel: 'log', text: 'Zapotrzebowanie na ogień (smoke)', form: { kind: 'fire', fields: { target: { type: 'Point', coordinates: [22.35, 53.5] }, targetKind: 'czołgi <b>x</b>', effect: 'zniszczenie', time: 'natychmiast', priority: 'pilny' } } }) }).then((r) => r.json())`);
    const reqId = sent.message?.id ?? sent.id;
    assert(reqId, 'zgłoszenie ognia wysłane (id)');
    await waitFor(`!!document.querySelector('.fire-mark__lbl')`, 'znacznik ognia na mapie');
    assert(await ev(`document.querySelector('.fire-mark__lbl').textContent.includes('wysłane')`), 'status „wysłane” bez odpowiedzi');
    const f = 'player/inbox/000.json';
    const inbox = await readJson(f);
    inbox.messages.push(
      { id: 'in-smoke-fire1', channel: 'log', from: 'mjr Test, dca artylerii', time: '2026-05-14T06:20:00+02:00', type: 'meldunek', text: 'Przyjęto.', fire: { request_id: reqId, status: 'accepted', time: '2026-05-14T06:20:00+02:00' } },
      { id: 'in-smoke-fire2', channel: 'log', from: 'mjr Test, dca artylerii', time: '2026-05-14T06:30:00+02:00', type: 'meldunek', text: 'Wykonano 06:30, 12 pocisków, skutek nieznany.', fire: { request_id: reqId, status: 'done', time: '2026-05-14T06:30:00+02:00', rounds: 12 } },
    );
    await writeJson(f, inbox);
    await waitFor(`${store()}.messages.some((m) => m.id === 'in-smoke-fire2')`, 'odpowiedzi ogniowe po SSE');
    await waitFor(`document.querySelector('.fire-mark__lbl')?.textContent.includes('wykonane')`, 'status „wykonane” na znaczniku');
    assert(await ev(`!document.querySelector('.fire-mark b')`), 'treść zgłoszenia w znaczniku zescapowana');
    await ev(`window.__ks.controller.setLayerVisible('fires', false)`);
    await waitFor(`!document.querySelector('.fire-mark')`, 'warstwa „Ogień” wyłączona');
    await ev(`window.__ks.controller.setLayerVisible('fires', true)`);
    await waitFor(`!!document.querySelector('.fire-mark')`, 'warstwa „Ogień” włączona');
  });

  await step('T51 nakładki: overlay w inboxie → lista w Warstwach, nowsza o tym samym id zastępuje, włącz/wyłącz, kopia do szkiców i do rozkazu', async () => {
    const [lon, lat] = await state('s.scenario.map.center');
    const feats = (tag) => [
      { id: 'f1', kind: 'line', name: 'Granica ' + tag, color: 'blue', graphic: 'boundary', echelon: 'F', geometry: { type: 'LineString', coordinates: [[lon, lat], [lon + 0.05, lat + 0.03]] } },
      { id: 'f2', kind: 'area', name: 'Rejon ' + tag, color: 'blue', graphic: 'assembly', geometry: { type: 'Polygon', coordinates: [[[lon, lat], [lon + 0.02, lat], [lon + 0.02, lat + 0.02], [lon, lat]]] } },
    ];
    const f = 'player/inbox/000.json';
    const inbox = await readJson(f);
    inbox.messages.push(
      { id: 'in-smoke-ov1', channel: 'log', from: 'płk Test, dca', time: '2026-05-14T06:40:00+02:00', type: 'rozkaz', text: 'Granice wg nakładki v1.', overlay: { id: 'ov-smoke', name: 'Granice v1', features: feats('v1') } },
      { id: 'in-smoke-ov2', channel: 'log', from: 'płk Test, dca', time: '2026-05-14T06:50:00+02:00', type: 'rozkaz', text: 'Granice wg nakładki v2 (zmiana).', overlay: { id: 'ov-smoke', name: 'Granice v2', features: feats('v2') } },
    );
    await writeJson(f, inbox);
    await waitFor(`${store()}.messages.some((m) => m.id === 'in-smoke-ov2')`, 'nakładki po SSE');
    assert((await state(`s.overlays.filter((o) => o.id === 'ov-smoke').length`)) === 1, 'jedna nakładka o tym id');
    assert((await state(`s.overlays.find((o) => o.id === 'ov-smoke').name`)) === 'Granice v2', 'nowsza zastępuje starszą');
    await ev(`window.__ks.controller.setPopover('layers')`);
    await waitFor(`document.getElementById('layers').classList.contains('open') && !!document.querySelector('#lp-over [data-ov="ov:ov-smoke"]')`, 'nakładka na liście warstw');
    assert(await ev(`document.querySelector('#lp-over [data-ov="ov:ov-smoke"]').textContent.includes('Granice v2')`), 'nazwa nakładki w panelu');
    const drawn = `[...document.querySelectorAll('#map .tac-label')].some((e) => e.textContent.includes('v2'))`;
    assert(!(await ev(drawn)), 'nakładka domyślnie wyłączona');
    await ev(`document.querySelector('#lp-over [data-ov="ov:ov-smoke"] .lp-ovl__n').click()`);
    await waitFor(drawn, 'nakładka narysowana po włączeniu');
    await ev(`document.querySelector('#lp-over [data-ov="ov:ov-smoke"] .lp-ovl__n').click()`);
    await waitFor(`!(${drawn})`, 'nakładka znika po wyłączeniu');
    const notes0 = await state('s.notes.length');
    await ev(`document.querySelector('#lp-over [data-ov-copy="ov-smoke"]:not([data-attach])').click()`);
    await waitFor(`${store()}.notes.length === ${notes0 + 2}`, 'kopia nakładki w szkicach');
    await ev(`document.querySelector('#lp-over [data-ov-copy="ov-smoke"][data-attach]').click()`);
    await waitFor(`${store()}.notes.length === ${notes0 + 4}`, 'druga kopia (do rozkazu)');
    assert(await state(`s.draft.attachIds.length >= 2`), 'kopia dołączona do szkicu wiadomości w aktywnym kanale');
    await key('Escape');
  });

  await step('T28.1 sztab: odprawa S2/S3/S4 (karty, klik → kanał, zamknięcie i przywołanie zapamiętane), widoki komórek zachowują ustawienia gracza', async () => {
    const cur = await state('s.currentTurn');
    const f = `player/turns/${String(cur).padStart(3, '0')}.json`;
    const turn0 = await readJson(f);
    const t = turn0.time;
    turn0.staff = [
      { role: 's2', name: 'mjr Test, szef S2', text: 'Wróg <i>przegrupowuje się</i> na zachód — pewność średnia.', time: t },
      { role: 's3', name: 'ppłk Test, szef S3', text: 'Proponuję rotację 1k.', time: t },
      { role: 's4', name: 'mjr Test, szef S4', text: 'Amunicja 0,4 doby, konwój 3 opóźniony.', time: t },
    ];
    await writeJson(f, turn0);
    await waitFor(`${store()}.staff.length === 3`, 'odprawa sztabu po SSE');
    await waitFor(`document.getElementById('staff-panel').classList.contains('open') && document.querySelectorAll('.staff-card').length === 3`, 'panel z trzema kartami');
    assert(await ev(`[...document.querySelectorAll('.staff-badge')].map((e) => e.textContent).join() === 'S2,S3,S4'`), 'odznaki S2, S3, S4');
    assert(await ev(`!document.querySelector('.staff-card p i')`), 'tekst karty zescapowany');
    assert(await ev(`document.querySelector('.staff-dtg').textContent.length > 4`), 'DTG na karcie');
    await clickSel('.staff-card[data-role="s2"]');
    await waitFor(`${store()}.activeChannel === 's2'`, 'klik karty S2 otwiera kanał s2');
    await clickSel('#staff-x');
    await waitFor(`!document.getElementById('staff-panel').classList.contains('open')`, 'panel zamknięty');
    const key0 = await state(`'ks:' + s.scenario.id + ':staff-closed'`);
    assert(await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key0)})).includes(${cur})`), 'zamknięcie zapamiętane w localStorage');
    await clickSel('#tb-staff');
    await waitFor(`document.getElementById('staff-panel').classList.contains('open')`, 'panel przywołany ikoną przy zegarze');
    // Skrót Shift+1 nie działa w polu tekstowym, a poza nim działa (i się cofa).
    const shiftKey = (target) => ev(`(${target}).dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', key: '!', shiftKey: true, bubbles: true, cancelable: true }))`);
    await ev(`(() => { const t = document.createElement('textarea'); t.id = 'sv-probe'; document.body.appendChild(t); t.focus(); })()`);
    await shiftKey(`document.getElementById('sv-probe')`);
    assert(await state('s.staffView.active === null'), 'Shift+1 w polu tekstowym nie przełącza widoku');
    await ev(`document.getElementById('sv-probe').remove()`);
    await shiftKey('document.body');
    await waitFor(`${store()}.staffView.active === 's2'`, 'Shift+1 włącza widok S2');
    await shiftKey('document.body');
    await waitFor(`${store()}.staffView.active === null`, 'ponowne Shift+1 cofa widok');
    // Telefon: panel mieści się w ekranie, nie zasłania całej mapy i da się go zamknąć.
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    assert(await ev(`(() => { const r = document.getElementById('staff-panel').getBoundingClientRect(); return r.left >= 0 && r.right <= 390 - 40 && r.height < 844 * 0.6; })()`), 'panel odprawy mieści się na telefonie, nie zasłania przycisków mapy ani całej mapy');
    assert(await ev(`(() => { const r = document.getElementById('staffview').getBoundingClientRect(); return r.left >= 0 && r.right <= 390 && r.bottom <= 844; })()`), 'przełącznik widoków w ekranie telefonu');
    await clickSel('#staff-x');
    await waitFor(`!document.getElementById('staff-panel').classList.contains('open')`, 'panel zamknięty na telefonie');
    await clickSel('#tb-staff');
    await waitFor(`document.getElementById('staff-panel').classList.contains('open')`, 'panel przywołany na telefonie');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(500);
    // Widoki komórek: własne ustawienia gracza wracają po „Moje”.
    await ev(`window.__ks.controller.setLayerVisible('contacts', false)`);
    await clickSel('#seg-staff [data-sv="s4"]');
    await waitFor(`${store()}.layers.logistics === true && ${store()}.popover === 'dos' && ${store()}.layers.contacts === false`, 'widok S4: logistyka i panel DOS');
    await clickSel('#seg-staff [data-sv="s2"]');
    await waitFor(`${store()}.layers.contacts === true && ${store()}.layers.logistics === false`, 'widok S2: kontakty');
    await clickSel('#seg-staff [data-sv=""]');
    await waitFor(`${store()}.layers.contacts === false && ${store()}.layers.logistics === true && ${store()}.popover === null && ${store()}.staffView.active === null`, 'przywrócone ustawienia gracza');
    await ev(`window.__ks.controller.setLayerVisible('contacts', true)`);
  });

  await step('T27 saperzy: engineering w turze → pole minowe (wykonywane 60%), most pontonowy, wrogi most zburzony; escape; przełącznik warstwy', async () => {
    const [lon, lat] = await state('s.scenario.map.center');
    const cur = await state('s.currentTurn');
    await waitFor(`${store()}.viewTurn === ${cur}`, 'oglądana jest bieżąca tura');
    const f = `player/turns/${String(cur).padStart(3, '0')}.json`;
    const turn0 = await readJson(f);
    turn0.engineering = [
      { id: 'zapora-1', kind: 'minefield', owner: 'own', state: 'building', progress: 60, label: 'ZAPORA-1', unit: '1bzmot', coords: [[lon, lat], [lon + 0.02, lat], [lon + 0.02, lat + 0.01], [lon, lat + 0.01], [lon, lat]] },
      { id: 'most-1', kind: 'temp_bridge', owner: 'own', state: 'done', label: 'Most <i>pon.</i>', pos: [lon + 0.03, lat] },
      { id: 'wrog-most', kind: 'bridge', owner: 'enemy', state: 'destroyed', label: 'Most wrogi', pos: [lon + 0.04, lat + 0.01], observed: turn0.time, source: 'BSP-1', confidence: 'średnia' },
    ];
    await writeJson(f, turn0);
    await waitFor(`${store()}.turn.engineering?.length === 3`, 'obiekty inżynieryjne po SSE');
    await waitFor(`document.querySelectorAll('.eng-mark').length === 2`, 'znaczniki mostów na mapie');
    assert(await ev(`[...document.querySelectorAll('#map .tac-label')].some((e) => e.textContent.includes('ZAPORA-1: wykonywane 60%'))`), 'etykieta zapory ze stanem i postępem');
    assert(await ev(`!document.querySelector('.eng-mark i') && [...document.querySelectorAll('.eng-mark__lbl')].some((e) => e.textContent.includes('<i>pon.</i>'))`), 'etykieta mostu zescapowana');
    assert(await ev(`document.querySelector('.eng-mark--bad.eng-mark--enemy') !== null`), 'wrogi zburzony most oznaczony');
    await ev(`window.__ks.controller.setLayerVisible('engineering', false)`);
    await waitFor(`!document.querySelector('.eng-mark')`, 'warstwa „Zapory i mosty” wyłączona');
    await ev(`window.__ks.controller.setLayerVisible('engineering', true)`);
    await waitFor(`document.querySelectorAll('.eng-mark').length === 2`, 'warstwa „Zapory i mosty” włączona');
  });

  await step('T16 starzenie kontaktów: stary kontakt czołgów blaknie mocniej niż młodszy, karta i podpowiedź mają „informacja sprzed”', async () => {
    const cur = await state('s.currentTurn');
    const f = `player/turns/${String(cur).padStart(3, '0')}.json`;
    const turn0 = await readJson(f);
    const [lon, lat] = await state('s.scenario.map.center');
    const t = Date.parse(turn0.time);
    const iso = (min) => new Date(t - min * 60000).toISOString();
    turn0.contacts = [
      { id: 'age-fresh', sidc: 'SHGAUCAT---E---', pos: [lon, lat], observed: iso(5), source: 'BSP-1', confidence: 'średnia', estimate: 'Czołgi świeże' },
      { id: 'age-old', sidc: 'SHGAUCAT---E---', pos: [lon + 0.01, lat], observed: iso(200), source: 'BSP-1', confidence: 'niska', estimate: 'Czołgi stare' },
    ];
    await writeJson(f, turn0);
    await waitFor(`${store()}.turn.contacts?.some((c) => c.id === 'age-old')`, 'kontakty po SSE');
    await waitFor(`document.querySelectorAll('#map .leaflet-marker-icon').length > 0`, 'symbole na mapie');
    const cardOk = await ev(`import('/js/domain/cards.js').then(async (m) => { const turn = ${store()}.turn; const c = turn.contacts.find((x) => x.id === 'age-old'); return m.contactCard(c, turn.time, 'Europe/Warsaw', {}).includes('informacja sprzed 3 h 20 min'); })`);
    assert(cardOk, 'karta starego kontaktu pokazuje „informacja sprzed 3 h 20 min”');
    const opac = await ev(`import('/js/domain/contactage.js').then((m) => { const t = ${store()}.turn; const g = (id) => m.contactFreshness(t.contacts.find((c) => c.id === id), t.time).opacity; return [g('age-fresh'), g('age-old')]; })`);
    assert(await ev(`[...document.querySelectorAll('#map .leaflet-marker-icon')].some((e) => parseFloat(e.style.opacity) >= 0.35 && parseFloat(e.style.opacity) < 0.6)`), 'na mapie jest symbol przygaszony wiekiem');
    assert(opac[0] === 1 && opac[1] < 0.6 && opac[1] >= 0.35, 'krycie: świeży 1, stary (200 min, pancerne) = 0,35: ' + opac);
  });

  await step('T28 zmęczenie: fatigue w turze → wskaźnik w karcie jednostki (kategoria, kolor), brak dla jednostki bez pola', async () => {
    const cur = await state('s.currentTurn');
    await waitFor(`${store()}.viewTurn === ${cur}`, 'oglądana jest bieżąca tura');
    const f = `player/turns/${String(cur).padStart(3, '0')}.json`;
    const turn0 = await readJson(f);
    const [a, b] = turn0.units.filter((u) => !u.formation);
    a.fatigue = 'wyczerpana';
    delete b.fatigue;
    await writeJson(f, turn0);
    await waitFor(`${store()}.turn.units.find((u) => u.id === '${a.id}')?.fatigue === 'wyczerpana'`, 'fatigue po SSE');
    await ev(`window.__ks.controller.selectEntity('${a.id}', { pan: false })`);
    await waitFor(`document.querySelector('#insp-body [data-fatigue="wyczerpana"]')`, 'wskaźnik zmęczenia w karcie');
    assert(await ev(`document.querySelector('#insp-body .fatigue--bad') !== null`), 'wyczerpana: kolor czerwony');
    await ev(`window.__ks.controller.selectEntity('${b.id}', { pan: false })`);
    await waitFor(`document.querySelector('#insp-body .insp-top') && !document.querySelector('#insp-body [data-fatigue]')`, 'jednostka bez fatigue: brak wskaźnika');
    await ev(`window.__ks.controller.clearSelection()`);
  });

  await step('brak błędów JS w konsoli', async () => {
    assert(consoleErrors.length === 0, 'błędy konsoli:\n         ' + consoleErrors.join('\n         '));
  });
} finally {
  await cleanup();
}

const failed = results.filter((r) => !r.ok);
console.log(`\nSmoke: ${results.length - failed.length}/${results.length} kroków OK, błędów konsoli: ${consoleErrors.length}`);
if (keep) console.log('Katalog roboczy zachowany:', work);
process.exit(failed.length || consoleErrors.length ? 1 : 0);

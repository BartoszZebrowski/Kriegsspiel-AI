// Model: jeden obserwowalny store aplikacji (bez DOM i bez Leaflet — działa też w Node).
//
// - `set(patch)` łączy płytko zmiany; subskrybenci dostają powiadomienie tylko wtedy, gdy zmienił się
//   któryś z kluczy, których słuchają (porównanie przez `!==`).
// - Wartości pochodne (np. `archive`) liczy store sam, po każdej zmianie ich zależności — jedno źródło prawdy.
// - Powiadomienia zagnieżdżone (set wywołany z subskrybenta) są kolejkowane i wykonywane po bieżącej turze.
import { mergeChannels, channelUnitId, detailLevel, unreadByUnit } from '../domain/orbat.js';
import { visibleMessages, unreadCounts, outboxCount } from '../domain/messages.js';
import { getDraft } from '../domain/compose.js';
import { overlaysOf } from '../domain/overlays.js';
import { staffCards, isStaffOpen, emptyStaffUi } from '../domain/staff.js';
import { emptyStaffView } from '../domain/staffviews.js';
import { isFinished } from '../domain/afterbattle.js';

// Warstwy mapy: sytuacja (jednostki, kontakty…), szkice, etykiety i nakładki kafelkowe (domyślnie wyłączone).
export const DEFAULT_BASEMAP = 'Ciemna (Esri)';
export const TILE_OVERLAYS = ['Rzeźba terenu', 'Koleje', 'Nazwy i granice'];
export const defaultLayers = () => ({ units: true, hierarchy: true, contacts: true, assets: true, logistics: true, lines: true, notes: true, ccir: true, fires: true, engineering: true, labels: true, truth: false, ...Object.fromEntries(TILE_OVERLAYS.map((n) => [n, false])) });

export function initialState() {
  return {
    // --- dane (z serwera) ---
    scenario: null,
    turns: [], // numery dostępnych tur
    currentTurn: 0,
    viewTurn: 0, // oglądana tura (== currentTurn albo archiwum)
    turn: null, // dane oglądanej tury: { turn, time, units, contacts, assets, lines }
    messages: [], // wszystkie wiadomości (inbox + outbox)
    notes: [], // szkice gracza dla oglądanej tury
    places: [], // gazeter
    ccir: [], // CCIR gracza (player/ccir.json): [{ id, kind: PIR|FFIR, text, geometry? }] (domain/ccir.js)
    equipment: null, // katalog wyposażenia (data/equipment.json) albo null
    // --- wybór i preferencje widoku ---
    selection: null, // { id, kind } — jedyny zaznaczony obiekt (mapa, struktura, inspektor); kanał komunikatora go nie zmienia
    hoverUnit: null, // jednostka wskazana myszą (podświetla podwładnych)
    focus: null, // jednorazowe polecenie dla widoku: { kind: 'entity'|'place'|'geometry', ..., nonce }
    detail: null, // wybór szczegółowości: null (automat) | 'battalion' | 'company' | 'platoon'
    mapZoom: null, // zoom mapy (raportuje go widok mapy; potrzebny do automatycznej szczegółowości)
    layers: defaultLayers(),
    basemap: DEFAULT_BASEMAP, // nazwa podkładu mapy
    activeChannel: null, // id wybranego kanału komunikatora
    drafts: {}, // szkice wiadomości per kanał: { [channelId]: { text, type, urgent, attachIds, orders? } } (domain/compose.js; orders: domain/order.js)
    pinned: [], // id kanałów przypiętych na pasku komunikatora
    fresh: new Set(), // wiadomości nieprzeczytane w chwili otwarcia kanału (separator „NOWE”)
    read: new Set(), // id przeczytanych wiadomości
    ui: { leftCollapsed: false, rightCollapsed: false, mobile: 'map', narrow: false, leader: true, animations: true, reducedMotion: false },
    animation: null, // jednorazowe zlecenie dla mapy: { nonce, from, to, plan, ms } — odtwórz przemieszczenia między turami (domain/motion.js)
    orderMode: null, // tryb rozkazu graficznego (T44): null | { selected: [id], task, kind, delivery } (domain/order.js)
    ccirEditor: { open: false, draft: [], pick: null }, // edytor CCIR (T48): edytowana kopia i wskazywanie geometrii na mapie { id, shape }
    staffUi: emptyStaffUi(), // panel odprawy sztabu (T28.1): { closed: [tury zamknięte, zapamiętane], recalled: [tury przywołane w archiwum] }
    staffView: emptyStaffView(), // widok komórki sztabu: { active, saved } — zapamiętane ustawienia gracza do przywrócenia
    popover: null, // otwarty popover mapy: 'legend' | 'layers' | 'dos' | 'bell' | null
    omnibox: { open: false },
    command: null, // jednorazowe polecenie dla widoku: { name, arg, nonce }
    briefing: { open: false, text: null, error: null },
    aar: { open: false, text: null, error: null }, // omówienie ćwiczenia po bitwie (T29)
    truth: { turn: null, data: null }, // prawda oglądanej tury z umpire/ (T29, tylko po status: finished)
    notice: null, // { id, text, error, title?, urgent?, channel? } — komunikat do wyświetlenia (toast)
    notices: [], // historia komunikatów (dzwonek)
    noticesSeen: 0, // ile z historii obejrzano
  };
}

// Wartości pochodne: kolejność ma znaczenie (późniejsze mogą zależeć od wcześniejszych).
export const DERIVED = [
  { key: 'archive', deps: ['viewTurn', 'currentTurn'], fn: (s) => s.viewTurn !== s.currentTurn },
  { key: 'finished', deps: ['scenario'], fn: (s) => isFinished(s.scenario) }, // tryb po bitwie (T29)
  { key: 'channels', deps: ['scenario', 'turn'], fn: (s) => mergeChannels(s.scenario?.channels, s.turn?.units || []) },
  { key: 'channel', deps: ['channels', 'activeChannel'], fn: (s) => s.channels.find((c) => c.id === s.activeChannel) ?? null },
  { key: 'draft', deps: ['drafts', 'activeChannel'], fn: (s) => getDraft(s.drafts, s.activeChannel) },
  { key: 'channelUnit', deps: ['channel'], fn: (s) => channelUnitId(s.channel) },
  { key: 'visibleMessages', deps: ['messages', 'archive', 'viewTurn'], fn: (s) => visibleMessages(s.messages, s) },
  { key: 'overlays', deps: ['visibleMessages'], fn: (s) => overlaysOf(s.visibleMessages) }, // nakładki od przełożonego (T51)
  { key: 'staff', deps: ['turn', 'channels', 'scenario'], fn: (s) => staffCards(s.turn?.staff, s.channels, s.scenario?.timezone) }, // karty odprawy sztabu (T28.1)
  { key: 'staffOpen', deps: ['staff', 'staffUi', 'viewTurn', 'archive'], fn: (s) => isStaffOpen({ cards: s.staff, staffUi: s.staffUi, viewTurn: s.viewTurn, archive: s.archive }) },
  { key: 'unread', deps: ['channels', 'visibleMessages', 'read'], fn: (s) => unreadCounts(s.channels, s.visibleMessages, s.read) },
  { key: 'unreadUnits', deps: ['channels', 'unread'], fn: (s) => unreadByUnit(s.channels, s.unread) },
  { key: 'outboxCount', deps: ['messages', 'currentTurn'], fn: (s) => outboxCount(s.messages, s.currentTurn) },
  { key: 'level', deps: ['detail', 'mapZoom'], fn: (s) => detailLevel(s.detail, s.mapZoom ?? 0) },
];

export function createStore(initial = initialState(), derived = DERIVED) {
  const state = { ...initial };
  const subs = new Set(); // { keys: Set|null, fn }
  const queue = [];
  let flushing = false;

  const recompute = (changed, all = false) => {
    for (const d of derived) {
      if (!all && !d.deps.some((k) => changed.has(k))) continue;
      const next = d.fn(state);
      if (next !== state[d.key]) {
        state[d.key] = next;
        changed.add(d.key);
      }
    }
  };
  // Wartości początkowe pochodnych.
  recompute(new Set(), true);

  function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (queue.length) {
        const changed = queue.shift();
        for (const sub of [...subs]) {
          if (!subs.has(sub)) continue;
          if (sub.keys === null || [...changed].some((k) => sub.keys.has(k))) sub.fn(state, changed);
        }
      }
    } finally {
      flushing = false;
    }
  }

  return {
    get: () => state,
    // Zwraca listę zmienionych kluczy (łącznie z pochodnymi).
    set(patch) {
      const changed = new Set();
      for (const [k, v] of Object.entries(patch)) {
        if (state[k] !== v) {
          state[k] = v;
          changed.add(k);
        }
      }
      if (!changed.size) return [];
      recompute(changed);
      queue.push(changed);
      flush();
      return [...changed];
    },
    // keys: nazwa, lista nazw albo '*' (wszystko). Zwraca funkcję anulującą subskrypcję.
    subscribe(keys, fn, { immediate = false } = {}) {
      const sub = { keys: keys === '*' ? null : new Set([].concat(keys)), fn };
      subs.add(sub);
      if (immediate) fn(state, new Set(sub.keys ?? Object.keys(state)));
      return () => subs.delete(sub);
    },
  };
}

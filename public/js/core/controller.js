// Kontroler: przyjmuje intencje użytkownika od widoków, rozmawia z API, aktualizuje store.
// Bez DOM i bez Leaflet (zależności wstrzykiwane: api, storage, env) — działa też w testach Node.
//
// Zasady:
// - widoki nie wołają API ani siebie nawzajem: wywołują metody kontrolera i czytają store;
// - każde odpytanie tury ma numer (`navEpoch`): spóźniona odpowiedź nie nadpisuje nowszego wyboru;
// - odświeżenie po SSE porównuje dane i ustawia w store tylko to, co się zmieniło.
import { findEntity } from '../domain/entities.js';
import { channelForUnit, DETAIL_LEVELS } from '../domain/orbat.js';
import { newIncoming, defaultPinned, parseSender } from '../domain/messages.js';
import { buildPlan, planIsEmpty, isSequential, ANIMATION_MS } from '../domain/motion.js';
import { DEFAULT_BASEMAP, TILE_OVERLAYS, defaultLayers } from './store.js';
import { createSelection } from './selection.js';
import { createMessaging } from './messaging.js';
import { createLayout } from './layout.js';

const nullStorage = { load: (_key, fallback) => fallback, save() {} };

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
// Zachowuje poprzednią referencję, gdy dane się nie zmieniły (subskrybenci nie dostają powiadomienia).
const keep = (prev, next) => (same(prev, next) ? prev : next);

const MAX_NOTICES = 30;
const BASEMAP_BY_COMMAND = { 'base-dark': 'Ciemna (Esri)', 'base-sat': 'Satelita (Esri)', 'base-topo': 'Topografia (OpenTopoMap)' };

export function createController({ store, api, storage = nullStorage, env = {} }) {
  const isPageVisible = env.isPageVisible ?? (() => true);
  const S = () => store.get();
  let navEpoch = 0; // rośnie przy każdej ręcznej nawigacji po turach
  let nonce = 0;
  let busy = false;
  let again = false;

  const keyOf = (name) => `ks:${S().scenario.id}:${name}`;

  // ---------- komunikaty ----------
  // extra: { title, urgent, channel } — tytuł toastu, wyróżnienie pilnych, kanał otwierany przyciskiem „Czytaj”.
  function notify(text, error = false, extra = {}) {
    const notice = { id: ++nonce, text, error, ...extra };
    store.set({ notice, notices: [notice, ...S().notices].slice(0, MAX_NOTICES) });
  }
  const markNoticesSeen = () => store.set({ noticesSeen: S().notices.length ? S().notices[0].id : 0 });

  // ---------- pomocnicze ----------
  const fetchView = async (n) => {
    const [turn, notes] = await Promise.all([api.turn(n), api.notes(n)]);
    return { turn, notes: notes.items || [] };
  };

  // ---------- podkontrolery (współdzielą store; wydzielone wg odpowiedzialności) ----------
  const nextNonce = () => ++nonce;
  const selection = createSelection({ store, storage, S, keyOf, notify, nextNonce });
  const { setSelection, selectEntity, focusEntity, clearSelection, hoverUnit, mentionClick, showAttachment, flyToPlace, setDetail } = selection;
  const messaging = createMessaging({ store, api, storage, S, keyOf, notify, syncSelection: () => syncSelectionToChannel(), isPageVisible });
  const { readIfVisible, selectChannel, setDraft, clearChannelDraft, unpinChannel, ensureActiveChannel, sendMessage, withdrawMessage } = messaging;
  const layout = createLayout({ store, storage, S, markNoticesSeen, readIfVisible });
  const { setPopover, togglePopover, openOmnibox, closeOmnibox, setDock, toggleDock, setMobile, setNarrow, toggleLeader, setAnimations, setReducedMotion } = layout;

  // Podświetla na mapie jednostkę wybranego kanału (gdy nic nie jest zaznaczone albo przy zmianie kanału).
  const syncSelectionToChannel = () => setSelection(S().channelUnit);

  // ---------- animacja przemieszczeń ----------
  // Animacje wyłącza przełącznik „Animacje” (zapamiętany) albo systemowe prefers-reduced-motion.
  const animationsOn = () => S().ui.animations && !S().ui.reducedMotion;
  function makeAnimation(from, to, prevTurn, nextTurn) {
    const plan = buildPlan(prevTurn, nextTurn);
    return planIsEmpty(plan) ? null : { nonce: ++nonce, from, to, plan, ms: ANIMATION_MS };
  }

  // Ustawia widok tury jednym `set` (spójny stan: viewTurn, turn, notes i flaga archiwum zmieniają się razem).
  function applyView(n, view, extra = {}) {
    const s = S();
    const patch = { ...extra, viewTurn: n, turn: keep(s.turn, view.turn), notes: keep(s.notes, view.notes) };
    // Przejście o jedną turę do przodu animuje przemieszczenia; skok, cofnięcie i archiwum są natychmiastowe.
    if (n !== s.viewTurn) {
      const turns = extra.turns ?? s.turns;
      patch.animation = s.turn && animationsOn() && isSequential(s.viewTurn, n, turns) ? makeAnimation(s.viewTurn, n, s.turn, view.turn) : null;
    }
    // Zaznaczenie znika tylko wtedy, gdy obiektu nie ma już w nowych danych (nie zamykamy inspektora bez powodu).
    if (s.selection && !findEntity(patch.turn, s.selection.id)) patch.selection = null;
    store.set(patch);
    // Zaznaczenie (inspektor) zostaje przy zmianie tury; bez zaznaczenia podświetlamy jednostkę kanału.
    if (!S().selection) syncSelectionToChannel();
    readIfVisible();
  }

  const overlaysOf = (layers) => TILE_OVERLAYS.filter((n) => layers[n]);
  function persistMap() {
    storage.save(keyOf('map'), { base: S().basemap, overlays: overlaysOf(S().layers) });
  }

  // ---------- start ----------
  // Etap 1: scenariusz i preferencje. Widoki można tworzyć dopiero po nim (potrzebują scenariusza).
  async function init() {
    const [info, places] = await Promise.all([api.scenario(), api.gazetteer()]);
    const id = info.scenario.id;
    const key = (name) => `ks:${id}:${name}`;
    let detail = storage.load(key('detail'), null);
    if (!DETAIL_LEVELS.includes(detail)) detail = null;
    const current = info.currentTurn ?? 0;
    const mapPrefs = storage.load(key('map'), {}) || {};
    const layers = defaultLayers();
    for (const n of mapPrefs.overlays || []) if (n in layers) layers[n] = true;
    store.set({
      scenario: info.scenario,
      turns: info.turns || [],
      currentTurn: current,
      viewTurn: current,
      places,
      detail,
      layers,
      basemap: typeof mapPrefs.base === 'string' ? mapPrefs.base : DEFAULT_BASEMAP,
      read: new Set(storage.load(key('read'), [])),
      pinned: storage.load(key('pinned'), null) ?? [],
      activeChannel: storage.load(key('channel'), null),
      ui: {
        ...S().ui,
        leftCollapsed: storage.load('ks:dock-l-collapsed', false),
        rightCollapsed: storage.load('ks:dock-r-collapsed', env.narrowScreen ?? false),
        leader: storage.load('ks:leader', true),
        animations: storage.load('ks:animations', true) !== false,
        reducedMotion: Boolean(env.prefersReducedMotion?.()),
      },
    });
  }

  // Etap 2: dane bieżącej tury i wiadomości; potem odprawa przy pierwszym uruchomieniu.
  async function load() {
    const current = S().currentTurn;
    const epoch = ++navEpoch;
    const [view, { messages }] = await Promise.all([fetchView(current), api.messages()]);
    if (epoch === navEpoch) applyView(current, view, { messages });
    else store.set({ messages });
    // Pierwsze uruchomienie: przypięte kanały = przełożony, sztab i jednostki ze scenariusza.
    if (!S().pinned.length) {
      const pinned = defaultPinned(S().channels);
      if (S().activeChannel && !pinned.includes(S().activeChannel)) pinned.push(S().activeChannel);
      store.set({ pinned });
    }
    readIfVisible();
    const seenKey = keyOf('briefing-seen');
    if (!storage.load(seenKey, false)) {
      storage.save(seenKey, true);
      await openBriefing();
    }
  }

  // Odtwarza przejście z poprzedniej tury do oglądanej (przycisk „Odtwórz turę”, polecenie omniboksu).
  async function replayTurn() {
    const s = S();
    const i = s.turns.indexOf(s.viewTurn);
    if (i <= 0 || !s.turn) {
      notify('Brak poprzedniej tury do odtworzenia', true);
      return false;
    }
    if (!animationsOn()) {
      notify(s.ui.reducedMotion ? 'Animacje wyłączone przez ustawienie systemu (ograniczenie ruchu)' : 'Animacje są wyłączone — włącz je w panelu Warstwy', true);
      return false;
    }
    const view = s.viewTurn;
    const epoch = navEpoch;
    try {
      const prev = await api.turn(s.turns[i - 1]);
      if (epoch !== navEpoch || S().viewTurn !== view) return false;
      const animation = makeAnimation(s.turns[i - 1], view, prev, S().turn);
      if (!animation) {
        notify('W tej turze nie było przemieszczeń do odtworzenia');
        return false;
      }
      store.set({ animation });
      return true;
    } catch (err) {
      notify(err.message, true);
      return false;
    }
  }

  // ---------- nawigacja po turach ----------
  async function showTurn(n) {
    const epoch = ++navEpoch;
    try {
      const view = await fetchView(n);
      if (epoch !== navEpoch) return false; // w międzyczasie wybrano inną turę
      applyView(n, view);
      return true;
    } catch (err) {
      if (epoch === navEpoch) notify(err.message, true);
      return false;
    }
  }

  const prevTurn = () => {
    const { turns, viewTurn } = S();
    const i = turns.indexOf(viewTurn);
    return i > 0 ? showTurn(turns[i - 1]) : Promise.resolve(false);
  };
  const nextTurn = () => {
    const { turns, viewTurn } = S();
    const i = turns.indexOf(viewTurn);
    return i >= 0 && i < turns.length - 1 ? showTurn(turns[i + 1]) : Promise.resolve(false);
  };
  const showCurrent = () => showTurn(S().currentTurn);

  // ---------- odświeżenie po SSE ----------
  // Pobiera stan serwera i ustawia w store tylko zmienione plastry: listę tur, dane oglądanej tury,
  // notatki, wiadomości, gazeter. Nic nie zmienia → nikt nie dostaje powiadomienia (mapa, szkice, inspektor
  // i przewijanie zostają). Nowa tura bieżąca przełącza widok i pokazuje komunikat.
  async function refresh() {
    const epoch = navEpoch;
    const basis = S().viewTurn;
    const previous = S().currentTurn;
    const msgBasis = messaging.epoch();
    const [info, places] = await Promise.all([api.scenario(), api.gazetteer()]);
    const current = info.currentTurn ?? 0;
    const turns = info.turns || [];
    const advanced = current > previous;
    const target = advanced ? current : turns.includes(basis) ? basis : current;
    const [view, { messages }] = await Promise.all([fetchView(target), api.messages()]);

    const s = S();
    const global = {
      scenario: keep(s.scenario, info.scenario),
      turns: keep(s.turns, turns),
      currentTurn: current,
      places: keep(s.places, places),
    };
    const incoming = msgBasis === messaging.epoch() ? newIncoming(s.messages, messages) : [];
    if (msgBasis === messaging.epoch()) global.messages = keep(s.messages, messages);
    // Użytkownik przełączył turę w trakcie odświeżania: bierzemy tylko dane globalne.
    if (epoch !== navEpoch || s.viewTurn !== basis) {
      store.set(global);
      readIfVisible();
      announceIncoming(incoming);
      return;
    }
    applyView(target, view, global);
    if (advanced) notify(`Tura ${previous} rozstrzygnięta — teraz tura ${current}`);
    announceIncoming(incoming);
  }

  // Toast o nowych wiadomościach (pilne wyróżnione). Wiadomości z aktywnego, czytanego kanału pomijamy.
  function announceIncoming(list) {
    const fresh = list.filter((m) => !S().read.has(m.id));
    if (!fresh.length) return;
    if (fresh.length > 2) {
      notify(`${fresh.length} nowych wiadomości`, false, { title: 'Komunikator', channel: fresh[0].channel });
      return;
    }
    for (const m of fresh) {
      const who = parseSender(m.from).name || m.channel;
      notify(m.text.length > 110 ? m.text.slice(0, 108) + '…' : m.text, false, {
        title: m.priority === 'urgent' ? `${who} · PILNE` : who,
        urgent: m.priority === 'urgent',
        channel: m.channel,
      });
    }
  }

  // Zdarzenie SSE: odświeżenia nie nakładają się, a zdarzenie w trakcie odświeżania powtarza je jeszcze raz.
  async function onUpdate() {
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      do {
        again = false;
        await refresh();
      } while (again);
    } catch (err) {
      notify('Błąd odświeżania: ' + err.message, true);
    } finally {
      busy = false;
    }
  }

  const listen = (eventSource) => eventSource.addEventListener('update', () => onUpdate());

  // ---------- stan mapy raportowany przez widok ----------
  const mapZoomChanged = (zoom) => store.set({ mapZoom: zoom });
  function setLayerVisible(name, on) {
    if (S().layers[name] === on) return;
    store.set({ layers: { ...S().layers, [name]: on } });
    if (TILE_OVERLAYS.includes(name)) persistMap();
  }
  function setBasemap(name) {
    if (S().basemap === name) return;
    store.set({ basemap: name });
    persistMap();
  }

  // ---------- jednorazowe polecenia dla widoków (narzędzie, dopasowanie mapy, fokus pola…) ----------
  const command = (name, arg = null) => store.set({ command: { name, arg, nonce: ++nonce } });

  // Otwiera kanał rozmowy z jednostką (rozwija prawy dok; na telefonie przełącza na zakładkę Komunikator).
  function openUnitChannel(unitId) {
    const ch = channelForUnit(S().channels, unitId);
    if (!ch) {
      notify('Ta jednostka nie ma osobnego kanału łączności', true);
      return false;
    }
    openChannel(ch.id);
    return true;
  }
  function openChannel(channelId) {
    if (S().ui.rightCollapsed) setDock('r', false);
    if (S().ui.narrow) setMobile('msg');
    selectChannel(channelId);
  }

  // ---------- szkice ----------
  // Zapisuje pełną listę szkiców oglądanej tury. Zwraca zapisaną listę albo null.
  async function saveNotes(items) {
    if (S().archive) {
      notify('Archiwum — szkice tylko do podglądu', true);
      return null;
    }
    const turn = S().viewTurn;
    try {
      const saved = await api.saveNotes(turn, items);
      if (S().viewTurn === turn) store.set({ notes: saved.items });
      return saved.items;
    } catch (err) {
      notify('Nie zapisano szkicu: ' + err.message, true);
      return null;
    }
  }

  // ---------- odprawa ----------
  async function openBriefing() {
    try {
      store.set({ briefing: { open: true, text: await api.briefing(), error: null }, popover: null });
    } catch (err) {
      store.set({ briefing: { open: true, text: null, error: err.message } });
    }
  }
  const closeBriefing = () => store.set({ briefing: { open: false, text: null, error: null } });

  // ---------- polecenia omniboxu ----------
  function runCommand(id) {
    if (id === 'turn-current') return showCurrent();
    if (id === 'replay') return replayTurn();
    if (id === 'briefing') return openBriefing();
    if (id === 'legend') return setPopover('legend');
    if (id === 'layers') return setPopover('layers');
    if (id === 'dos') return setPopover('dos');
    if (id === 'measure') return command('tool', 'measure');
    if (id === 'fit') return command('fit');
    if (id === 'dock-l') return toggleDock('l');
    if (id === 'dock-r') return toggleDock('r');
    if (BASEMAP_BY_COMMAND[id]) return setBasemap(BASEMAP_BY_COMMAND[id]);
    return undefined;
  }

  return {
    init, load, listen, refresh, onUpdate, notify, markNoticesSeen,
    showTurn, prevTurn, nextTurn, showCurrent, replayTurn,
    selectEntity, focusEntity, clearSelection, hoverUnit, mentionClick, showAttachment, flyToPlace,
    setDetail, mapZoomChanged, setLayerVisible, setBasemap,
    command, setPopover, togglePopover, openOmnibox, closeOmnibox, runCommand,
    selectChannel, setDraft, clearChannelDraft, ensureActiveChannel, unpinChannel, openUnitChannel, openChannel, sendMessage, withdrawMessage,
    saveNotes,
    setDock, toggleDock, setMobile, setNarrow, toggleLeader, setAnimations, setReducedMotion,
    openBriefing, closeBriefing,
  };
}

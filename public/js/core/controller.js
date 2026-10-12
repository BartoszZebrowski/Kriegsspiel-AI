// Kontroler: przyjmuje intencje użytkownika od widoków, rozmawia z API, aktualizuje store.
// Bez DOM i bez Leaflet (zależności wstrzykiwane: api, storage, env) — działa też w testach Node.
//
// Zasady:
// - widoki nie wołają API ani siebie nawzajem: wywołują metody kontrolera i czytają store;
// - każde odpytanie tury ma numer (`navEpoch`): spóźniona odpowiedź nie nadpisuje nowszego wyboru;
// - odświeżenie po SSE porównuje dane i ustawia w store tylko to, co się zmieniło.
import { findEntity } from '../domain/entities.js';
import { indexById, isUnitVisible, minLevelFor, DETAIL_LEVELS, channelForUnit } from '../domain/orbat.js';
import { unreadIds, newIncoming, defaultPinned, parseSender } from '../domain/messages.js';
import { updateDraft, clearDraft } from '../domain/compose.js';
import { buildPlan, planIsEmpty, isSequential, ANIMATION_MS } from '../domain/motion.js';
import { DEFAULT_BASEMAP, TILE_OVERLAYS, defaultLayers } from './store.js';

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
  let msgEpoch = 0; // rośnie przy lokalnej zmianie wiadomości (wysłanie/wycofanie)
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

  const selectionOf = (id) => (id ? { id, kind: findEntity(S().turn, id)?.kind ?? null } : null);

  function setSelection(id) {
    const next = selectionOf(id);
    const cur = S().selection;
    if (cur?.id === next?.id && cur?.kind === next?.kind) return;
    store.set({ selection: next });
  }

  // Podświetla na mapie jednostkę wybranego kanału (gdy nic nie jest zaznaczone albo przy zmianie kanału).
  const syncSelectionToChannel = () => setSelection(S().channelUnit);

  // Gracz „czyta”, gdy prawy dok jest rozwinięty (na telefonie: zakładka Komunikator) i karta jest widoczna.
  const isReading = () => {
    const { ui } = S();
    return !ui.rightCollapsed && (!ui.narrow || ui.mobile === 'msg') && isPageVisible();
  };

  function readPatch(channelId) {
    if (!channelId) return null;
    const ids = unreadIds(S().visibleMessages, channelId, S().read);
    if (!ids.length) return null;
    const read = new Set([...S().read, ...ids]);
    storage.save(keyOf('read'), [...read]);
    return { read, fresh: new Set([...S().fresh, ...ids]) };
  }

  function markRead(channelId) {
    const patch = readPatch(channelId);
    if (patch) store.set(patch);
  }

  // Wiadomości właśnie wczytane: jeśli gracz patrzy na komunikator, aktywny kanał jest przeczytany.
  function readIfVisible() {
    if (isReading() && S().channel) markRead(S().channel.id);
  }

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
    const msgBasis = msgEpoch;
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
    const incoming = msgBasis === msgEpoch ? newIncoming(s.messages, messages) : [];
    if (msgBasis === msgEpoch) global.messages = keep(s.messages, messages);
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

  // ---------- wybór obiektów ----------
  const layerOf = { unit: 'units', contact: 'contacts', asset: 'assets' };

  function isShown(id) {
    const s = S();
    const e = findEntity(s.turn, id);
    if (!e || !s.layers[layerOf[e.kind]]) return false;
    return e.kind !== 'unit' || isUnitVisible(e.item, indexById(s.turn.units || []), s.level);
  }

  function setDetail(choice) {
    const detail = DETAIL_LEVELS.includes(choice) ? choice : null;
    storage.save(keyOf('detail'), detail);
    store.set({ detail });
  }

  // Zaznacza obiekt (inspektor pokazuje jego kartę) i — domyślnie — centruje mapę.
  // Ukrytą kompanię/pluton odsłania zmianą szczegółowości. Zwraca false, gdy obiektu nie ma na mapie.
  function selectEntity(id, { pan = true } = {}) {
    const s = S();
    const e = findEntity(s.turn, id);
    if (!e) return false;
    const patch = { selection: { id, kind: e.kind } };
    if (pan) patch.focus = { kind: 'entity', id, nonce: ++nonce };
    if (e.kind === 'unit') {
      const byId = indexById(s.turn.units || []);
      if (!isUnitVisible(e.item, byId, s.level)) {
        patch.detail = minLevelFor(e.item, byId);
        storage.save(keyOf('detail'), patch.detail);
      }
    }
    store.set(patch);
    return true;
  }

  // Tylko centruje mapę na obiekcie (nagłówek rozmowy, „Wycentruj”).
  function focusEntity(id) {
    if (id && findEntity(S().turn, id)) store.set({ focus: { kind: 'entity', id, nonce: ++nonce } });
  }

  const clearSelection = () => store.set({ selection: null });
  const hoverUnit = (id) => store.set({ hoverUnit: id ?? null });

  // Wzmianka w wiadomości: miejsce → przelot na mapie; obiekt → zaznaczenie w inspektorze.
  function mentionClick(kind, id) {
    if (kind === 'place') {
      const place = S().places.find((p) => p.id === id);
      if (place && Array.isArray(place.pos)) store.set({ focus: { kind: 'place', place, nonce: ++nonce } });
    } else if (kind === 'unit') {
      if (!selectEntity(id)) notify('Tej jednostki nie ma na mapie w tej turze', true);
    } else if (isShown(id)) {
      selectEntity(id);
    } else {
      notify('Tego obiektu nie ma teraz na mapie (warstwa wyłączona lub brak pozycji)', true);
    }
  }

  // Załącznik rozkazu: pokaż szkic na mapie.
  const showAttachment = (note) => store.set({ focus: { kind: 'geometry', note, nonce: ++nonce } });
  const flyToPlace = (place) => {
    if (place && Array.isArray(place.pos)) store.set({ focus: { kind: 'place', place, nonce: ++nonce } });
  };

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

  // ---------- popovery i omnibox ----------
  const setPopover = (name) => {
    if (S().popover !== (name ?? null)) store.set({ popover: name ?? null });
    if (name === 'bell') markNoticesSeen();
  };
  const togglePopover = (name) => setPopover(S().popover === name ? null : name);
  const openOmnibox = () => store.set({ omnibox: { open: true }, popover: null });
  const closeOmnibox = () => store.set({ omnibox: { open: false } });

  // ---------- komunikator ----------
  function selectChannel(id) {
    storage.save(keyOf('channel'), id);
    const patch = { activeChannel: id, fresh: new Set(unreadIds(S().visibleMessages, id, S().read)) };
    if (id && !S().pinned.includes(id)) {
      patch.pinned = [...S().pinned, id];
      storage.save(keyOf('pinned'), patch.pinned);
    }
    store.set(patch);
    markRead(id);
    syncSelectionToChannel();
  }

  // Szkic wiadomości kanału (tekst, rodzaj, pilne, załączniki) — osobny dla każdego kanału, tylko w pamięci.
  function setDraft(channelId, patch) {
    if (!channelId) return;
    store.set({ drafts: updateDraft(S().drafts, channelId, patch) });
  }
  const clearChannelDraft = (channelId) => store.set({ drafts: clearDraft(S().drafts, channelId) });

  function unpinChannel(id) {
    const pinned = S().pinned.filter((x) => x !== id);
    storage.save(keyOf('pinned'), pinned);
    store.set({ pinned });
  }

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

  // Start: gdy żaden kanał nie jest aktywny (pierwsze uruchomienie), otwiera kanał przełożonego (albo pierwszy).
  function ensureActiveChannel() {
    if (S().channel || !S().channels.length) return;
    const first = S().channels.find((c) => c.kind === 'superior') || S().channels[0];
    selectChannel(first.id);
  }

  // Zwraca wysłaną wiadomość albo null (archiwum, brak kanału, błąd). meta: { type, priority }.
  async function sendMessage(text, attachments = [], meta = {}) {
    const s = S();
    const body = (text || '').trim();
    if (!body || !s.channel || s.archive) return null;
    msgEpoch++;
    try {
      const msg = await api.send(s.channel.id, body, attachments, meta);
      store.set({ messages: [...S().messages, { ...msg, direction: 'out' }], drafts: clearDraft(S().drafts, s.channel.id) });
      return msg;
    } catch (err) {
      notify(err.message, true);
      return null;
    }
  }

  async function withdrawMessage(id) {
    msgEpoch++;
    try {
      await api.withdraw(id);
      store.set({ messages: S().messages.filter((m) => m.id !== id) });
      return true;
    } catch (err) {
      notify(err.message, true);
      return false;
    }
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

  // ---------- układ ----------
  function setDock(side, collapsed) {
    const key = side === 'l' ? 'leftCollapsed' : 'rightCollapsed';
    storage.save(`ks:dock-${side}-collapsed`, collapsed);
    store.set({ ui: { ...S().ui, [key]: collapsed } });
    readIfVisible();
  }
  const toggleDock = (side) => setDock(side, !S().ui[side === 'l' ? 'leftCollapsed' : 'rightCollapsed']);
  function setMobile(pane) {
    store.set({ ui: { ...S().ui, mobile: pane } });
    readIfVisible();
  }
  function setNarrow(narrow) {
    if (S().ui.narrow === narrow) return;
    store.set({ ui: { ...S().ui, narrow } });
    readIfVisible();
  }
  function toggleLeader() {
    const leader = !S().ui.leader;
    storage.save('ks:leader', leader);
    store.set({ ui: { ...S().ui, leader } });
  }

  function setAnimations(on) {
    storage.save('ks:animations', Boolean(on));
    store.set({ ui: { ...S().ui, animations: Boolean(on) } });
  }
  // Systemowe „ogranicz ruch” (matchMedia) zgłasza main.js — także przy zmianie w trakcie pracy.
  function setReducedMotion(reduced) {
    if (S().ui.reducedMotion !== Boolean(reduced)) store.set({ ui: { ...S().ui, reducedMotion: Boolean(reduced) } });
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

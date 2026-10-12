// Podkontroler trybu po bitwie (T29): warstwa „Prawda” (pobranie umpire/turns/NNN przez serwer) i dokument AAR.
// Serwer odmawia (403) przy grze w toku — tu dodatkowo nie pytamy go bez `finished`. Bez DOM.
import { isFinished } from '../domain/afterbattle.js';
import { summarizeLosses } from '../domain/aarstats.js';

export function createAfterBattle({ store, api, S, notify }) {
  let statsEpoch = 0;
  let epoch = 0; // spóźniona odpowiedź dla innej tury nie nadpisuje nowszej

  async function loadTruth() {
    const n = S().viewTurn;
    const mine = ++epoch;
    try {
      const data = await api.truth(n);
      if (mine === epoch && S().layers.truth) store.set({ truth: { turn: n, data } });
    } catch (err) {
      if (mine !== epoch) return;
      store.set({ layers: { ...S().layers, truth: false }, truth: { turn: null, data: null } });
      notify('Prawda niedostępna: ' + err.message, true);
    }
  }

  function setTruthVisible(on) {
    if (on && !isFinished(S().scenario)) {
      notify('Prawda będzie dostępna po zakończeniu bitwy', true);
      return false;
    }
    store.set({ layers: { ...S().layers, truth: on }, ...(on ? {} : { truth: { turn: null, data: null } }) });
    if (on) loadTruth();
    return true;
  }
  // Po zmianie oglądanej tury: odśwież prawdę, gdy warstwa jest włączona.
  const syncTruth = () => {
    if (S().layers.truth && S().truth.turn !== S().viewTurn) loadTruth();
  };

  async function openAar() {
    if (!isFinished(S().scenario)) return notify('Omówienie ćwiczenia będzie dostępne po zakończeniu bitwy', true);
    try {
      store.set({ aar: { open: true, text: await api.aar(), error: null, stats: null }, popover: null });
    } catch (err) {
      return store.set({ aar: { open: true, text: null, error: err.message, stats: null } });
    }
    loadStats();
  }
  const closeAar = () => store.set({ aar: { open: false, text: null, error: null, stats: null } });

  // Statystyki końcowe (T32): wszystkie tury prawdy przez ten sam strażnik; brak tury nie blokuje dokumentu.
  async function loadStats() {
    const s0 = S();
    const mine = ++statsEpoch;
    const turns = await Promise.all((s0.turns || []).map((n) => api.truth(n).catch(() => null)));
    if (mine !== statsEpoch || !S().aar.open || !isFinished(S().scenario)) return;
    const ok = turns.filter(Boolean);
    const sc = s0.scenario || {};
    store.set({ aar: { ...S().aar, stats: ok.length > 1 ? { ...summarizeLosses(ok, { start: sc.start, timezone: sc.timezone, ownSide: sc.side }), turns: ok.length } : { empty: true } } });
  }

  // Status wrócił z finished do innego: natychmiast gasimy warstwę prawdy, jej dane i AAR (bez pamięci podręcznej).
  function revokeIfNotFinished() {
    const s = S();
    if (isFinished(s.scenario) || (!s.layers.truth && !s.truth.data && !s.aar.open)) return;
    epoch++;
    statsEpoch++;
    store.set({ layers: { ...s.layers, truth: false }, truth: { turn: null, data: null }, aar: { open: false, text: null, error: null, stats: null } });
  }

  return { revokeIfNotFinished, setTruthVisible, syncTruth, openAar, closeAar };
}

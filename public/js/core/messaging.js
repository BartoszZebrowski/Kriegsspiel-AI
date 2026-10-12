// Intencje komunikatora: kanały, przeczytane, szkice wiadomości, wysyłanie i wycofywanie. Bez DOM.
import { unreadIds } from '../domain/messages.js';
import { updateDraft, clearDraft } from '../domain/compose.js';
import { assessSkip, skipMessage } from '../domain/command.js';

// `syncSelection` — podświetlenie jednostki kanału (zaznaczenie należy do kontrolera); `isPageVisible` z env.
export function createMessaging({ store, api, storage, S, keyOf, notify, syncSelection, isPageVisible }) {
  let msgEpoch = 0; // rośnie przy lokalnej zmianie wiadomości (wysłanie/wycofanie)

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

  function selectChannel(id) {
    storage.save(keyOf('channel'), id);
    const patch = { activeChannel: id, fresh: new Set(unreadIds(S().visibleMessages, id, S().read)) };
    if (id && !S().pinned.includes(id)) {
      patch.pinned = [...S().pinned, id];
      storage.save(keyOf('pinned'), patch.pinned);
    }
    store.set(patch);
    markRead(id);
    syncSelection();
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
  // Start: gdy żaden kanał nie jest aktywny (pierwsze uruchomienie), otwiera kanał przełożonego (albo pierwszy).
  function ensureActiveChannel() {
    if (S().channel || !S().channels.length) return;
    const first = S().channels.find((c) => c.kind === 'superior') || S().channels[0];
    selectChannel(first.id);
  }

  // Zwraca wysłaną wiadomość albo null (archiwum, brak kanału, błąd). meta: { type, priority, orders, form }.
  async function sendMessage(text, attachments = [], meta = {}) {
    const s = S();
    const body = (text || '').trim();
    if (!body || !s.channel || s.archive) return null;
    // T45: tryb „hard” blokuje kanały poniżej bezpośrednich podwładnych (poza pilnymi); serwer sprawdza to samo.
    const skip = assessSkip({ scenario: s.scenario, units: s.turn?.units, channels: s.channels, channelId: s.channel.id, priority: meta.priority });
    if (skip.level === 'block') {
      notify(skipMessage(skip), true);
      return null;
    }
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

  return {
    isReading, markRead, readIfVisible, selectChannel, setDraft, clearChannelDraft, unpinChannel, ensureActiveChannel, sendMessage, withdrawMessage,
    epoch: () => msgEpoch,
  };
}

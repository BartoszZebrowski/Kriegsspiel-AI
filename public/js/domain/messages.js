// Wiadomości komunikatora: filtr wg oglądanej tury, liczniki nieprzeczytanych, rodzaje i nadawcy (czyste funkcje).

// W archiwum widać tylko wiadomości do oglądanej tury włącznie (bez „spoilerów” z późniejszych tur).
// W trybie bieżącym — wszystkie (inbox następnej tury bywa zapisany tuż przed plikiem tury).
export function visibleMessages(messages, { archive, viewTurn }) {
  return archive ? messages.filter((m) => m.turn <= viewTurn) : messages;
}

// Nieprzeczytane wiadomości przychodzące: { total, byChannel: { [id]: n } } dla podanych kanałów.
export function unreadCounts(channels, messages, read) {
  const byChannel = {};
  for (const c of channels) byChannel[c.id] = 0;
  for (const m of messages) {
    if (m.direction !== 'in' || read.has(m.id)) continue;
    if (m.channel in byChannel) byChannel[m.channel] += 1;
  }
  const total = Object.values(byChannel).reduce((a, b) => a + b, 0);
  return { total, byChannel };
}

// Id wiadomości przychodzących w kanale, których jeszcze nie przeczytano.
export function unreadIds(messages, channelId, read) {
  return messages.filter((m) => m.direction === 'in' && m.channel === channelId && !read.has(m.id)).map((m) => m.id);
}

// Wiadomości gracza z bieżącej tury (skrzynka nadawcza czekająca na „koniec tury”).
export function outboxCount(messages, currentTurn) {
  return messages.filter((m) => m.direction === 'out' && m.turn === currentTurn).length;
}

// Nowe wiadomości przychodzące względem poprzedniej listy (do powiadomień).
export function newIncoming(prev, next) {
  const seen = new Set(prev.map((m) => m.id));
  return next.filter((m) => m.direction === 'in' && !seen.has(m.id));
}

export const MESSAGE_TYPE_LABELS = { rozkaz: 'Rozkaz', zarzadzenie: 'Zarządzenie', meldunek: 'Meldunek', wiadomosc: 'Wiadomość' };

// Nadawca „stopień nazwisko, funkcja” → { name, role }.
export function parseSender(from) {
  const s = String(from ?? '').trim();
  const i = s.indexOf(',');
  if (i < 0) return { name: s, role: '' };
  return { name: s.slice(0, i).trim(), role: s.slice(i + 1).trim() };
}

// Znaczniki karty wiadomości: [{ cls, label }] — PILNE, rodzaj (rozkaz od przełożonego = bursztyn, własny = akcent).
export function messageTags(m) {
  const tags = [];
  if (m.priority === 'urgent') tags.push({ cls: 'urg', label: 'Pilne' });
  const out = m.direction === 'out';
  if (m.type === 'rozkaz') tags.push({ cls: out ? 'ord' : 'dir', label: out ? 'Rozkaz bojowy' : 'Rozkaz' });
  else if (m.type === 'zarzadzenie') tags.push({ cls: out ? 'ord' : 'dir', label: 'Zarządzenie' });
  else if (m.type === 'meldunek') tags.push({ cls: 'rep', label: 'Meldunek' });
  return tags;
}

// Grupy kanałów w oknie „Wszystkie kanały”.
const GROUP_OF_KIND = { superior: 'sup', logistics: 'staff', recon: 'staff', other: 'staff', neighbor: 'nb', subordinate: 'sub' };
export const CHANNEL_GROUPS = [
  { id: 'sup', title: 'Przełożony' },
  { id: 'staff', title: 'Sztab' },
  { id: 'nb', title: 'Sąsiedzi' },
  { id: 'sub', title: 'Podwładni' },
];
export function groupChannels(channels) {
  return CHANNEL_GROUPS.map((g) => ({ ...g, channels: channels.filter((c) => (GROUP_OF_KIND[c.kind] || 'staff') === g.id) })).filter((g) => g.channels.length);
}

// Domyślnie przypięte kanały: przełożony, sztab, potem kanały jednostek zdefiniowane w scenariuszu
// (bez sąsiadów i automatycznych kanałów kompanii i plutonów), w kolejności grup okna „Wszystkie kanały”.
export function defaultPinned(channels) {
  const own = channels.filter((c) => !c.auto && c.kind !== 'neighbor');
  return groupChannels(own).flatMap((g) => g.channels.map((c) => c.id));
}

// Skrót nazwy kanału na pasku: pole `short`, inaczej nazwa.
export function tabLabel(channel) {
  return channel.short || channel.name;
}

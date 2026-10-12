// Klient HTTP/SSE serwera gry. Wołany wyłącznie przez kontroler (widoki nie znają API).

// Każde żądanie zmieniające dane niesie Content-Type: application/json
// (serwer odrzuca inne — ochrona przed CSRF), także DELETE bez treści.
async function request(path, options = {}) {
  const method = options.method || 'GET';
  const headers = method === 'GET' ? options.headers : { 'Content-Type': 'application/json', ...options.headers };
  const res = await fetch(path, { cache: 'no-store', ...options, headers });
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      message = (await res.json()).error || message;
    } catch {
      // odpowiedź bez JSON
    }
    throw new Error(message);
  }
  return res;
}

export const api = {
  scenario: async () => (await request('/api/scenario')).json(),
  turn: async (n) => (await request(`/api/turn/${n}`)).json(),
  briefing: async () => (await request('/api/briefing')).text(),
  // Brak gazetera (404) = brak linków do miejsc.
  gazetteer: async () => {
    try {
      return (await (await request('/api/gazetteer')).json()).places || [];
    } catch {
      return [];
    }
  },
  // Katalog wyposażenia (jawny); brak katalogu = karty działają bez zasięgów i grup.
  equipment: async () => {
    try {
      return await (await request('/data/equipment.json')).json();
    } catch {
      return null;
    }
  },
  messages: async () => (await request('/api/messages')).json(),
  // meta: { type, priority, orders } — rodzaj, przełącznik „Pilne” i rozkazy graficzne (T44) — pola opcjonalne.
  send: async (channel, text, attachments, meta = {}) =>
    (
      await request('/api/outbox', {
        method: 'POST',
        body: JSON.stringify({
          channel,
          text,
          ...(attachments?.length ? { attachments } : {}),
          ...(meta.type ? { type: meta.type } : {}),
          ...(meta.priority ? { priority: meta.priority } : {}),
          ...(meta.orders?.length ? { orders: meta.orders } : {}),
        }),
      })
    ).json(),
  notes: async (n) => (await request(`/api/notes/${n}`)).json(),
  saveNotes: async (turn, items) =>
    (
      await request('/api/notes', {
        method: 'PUT',
        body: JSON.stringify({ turn, items }),
      })
    ).json(),
  withdraw: async (id) => (await request(`/api/outbox/${encodeURIComponent(id)}`, { method: 'DELETE' })).json(),
  events: () => new EventSource('/api/events'),
};

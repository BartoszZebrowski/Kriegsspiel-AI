// Nakładki od przełożonego (T51): czysta logika. Źródło: pole `overlay` wiadomości przychodzących
// (`{ id, name, features: [szkic…] }`, schemat: shared/overlay.js). Bez DOM i Leafleta.

export const OVERLAY_LAYER_PREFIX = 'ov:';
export const overlayLayerKey = (id) => OVERLAY_LAYER_PREFIX + id;

// Nakładki z wiadomości: nowsza (czas, potem tura) o tym samym `id` zastępuje starszą. Wynik: od najnowszej.
export function overlaysOf(messages = []) {
  const byId = new Map();
  for (const m of messages) {
    const o = m?.overlay;
    if (m?.direction !== 'in' || !o || !Array.isArray(o.features)) continue;
    const entry = { id: o.id, name: o.name, time: m.time, turn: m.turn ?? 0, from: m.from, channel: m.channel, messageId: m.id, features: o.features };
    const prev = byId.get(o.id);
    if (!prev || newer(entry, prev)) byId.set(o.id, entry);
  }
  return [...byId.values()].sort((a, b) => (newer(a, b) ? -1 : newer(b, a) ? 1 : 0));
}
const stamp = (e) => Date.parse(e.time) || 0;
const newer = (a, b) => stamp(a) > stamp(b) || (stamp(a) === stamp(b) && a.turn > b.turn);

// Kopie elementów nakładki jako szkice gracza z nowymi, unikalnymi id (≤ 40 znaków). `existing` — szkice gracza,
// `limit` — maks. liczba szkiców (MAX_NOTES). Zwraca { notes } (nowe szkice) albo { error }.
export function overlayNotes(overlay, existing = [], limit = 500) {
  if (!overlay?.features?.length) return { error: 'Nakładka jest pusta' };
  if (existing.length + overlay.features.length > limit) return { error: `Za dużo szkiców (limit ${limit})` };
  const taken = new Set(existing.map((n) => n.id));
  const base = String(overlay.id).slice(0, 14);
  const notes = overlay.features.map((f, i) => {
    let k = i + 1;
    let id = `${base}-${k}`;
    while (taken.has(id)) id = `${base}-${++k}`;
    taken.add(id);
    return { ...f, id };
  });
  return { notes };
}

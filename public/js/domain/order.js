// Rozkaz graficzny (T44): zaznaczanie jednostek, geometria z kliknięć, zadanie → znak taktyczny, rozdział na kanały
// dowódców i budowa załącznika strukturalnego `{ id, kind: 'order', name, units, task, geometry }`. Czysta logika (bez DOM).
// Schemat i walidacja po stronie serwera: shared/order.js (te same id zadań; `domain/` nie importuje z `shared/`).
import { splitUnits, indexById, isUnitVisible, isNeighbourUnit, channelForUnit, parentIdOf } from './orbat.js';
import { updateDraft } from './compose.js';

// Rodzaje wskazania na mapie: typ geometrii GeoJSON i minimalna liczba punktów.
export const ORDER_KINDS = {
  point: { name: 'Punkt', type: 'Point', min: 1 },
  route: { name: 'Trasa', type: 'LineString', min: 2 },
  line: { name: 'Rubież', type: 'LineString', min: 2 },
  area: { name: 'Rejon', type: 'Polygon', min: 3 },
};

// Zadania (id jak ORDER_TASKS w shared/order.js) i rodzaje wskazania, które przyjmują. `glyph`: znak taktyczny
// dla rodzaju wskazania: [kind domain/tactical.js, graphic].
export const ORDER_TASKS = [
  { id: 'move', name: 'Marsz do', kinds: ['point', 'route'], glyph: { point: ['point', 'checkpoint'], route: ['arrow', 'direction'] } },
  { id: 'occupy', name: 'Zajmij rejon', kinds: ['area'], glyph: { area: ['area', 'assembly'] } },
  { id: 'defend', name: 'Broń rubieży', kinds: ['line'], glyph: { line: ['line', 'phase_line'] } },
  { id: 'attack', name: 'Natarcie na', kinds: ['point', 'route', 'area'], glyph: { point: ['point', 'target'], route: ['arrow', 'axis_main'], area: ['area', 'objective'] } },
  { id: 'recon', name: 'Rozpoznanie', kinds: ['point', 'route', 'area'], glyph: { point: ['point', 'contact_point'], route: ['arrow', 'direction'], area: ['area', 'generic'] } },
];
export const ORDER_DELIVERY = ['own', 'common'];

export const taskInfo = (id) => ORDER_TASKS.find((t) => t.id === id) ?? null;

// Rodzaj wskazania wynikający z zadania i typu geometrii (LineString = rubież dla „broń rubieży”, w innych zadaniach trasa).
export function kindOfGeometry(task, geometryType) {
  if (geometryType === 'Point') return 'point';
  if (geometryType === 'Polygon') return 'area';
  return task === 'defend' ? 'line' : 'route';
}

// Znak taktyczny załącznika: { kind, graphic } dla domain/tactical.js (albo null przy nieznanym zadaniu).
export function orderGraphic(task, geometryType) {
  const g = taskInfo(task)?.glyph?.[kindOfGeometry(task, geometryType)];
  return g ? { kind: g[0], graphic: g[1] } : null;
}

// Załącznik jako „szkic” do narysowania znakiem taktycznym (ta sama postać co szkice gracza); null, gdy nieczytelny.
export function orderPreviewNote(att) {
  const g = orderGraphic(att?.task, att?.geometry?.type);
  if (!g) return null;
  return { id: att.id, kind: g.kind, graphic: g.graphic, name: taskInfo(att.task).name, color: 'blue', geometry: att.geometry };
}

// ---------- zaznaczanie jednostek ----------
// Jednostki, którymi gracz może dowodzić na mapie: własne (bez przełożonego i sąsiadów), z pozycją i — gdy podano
// poziom szczegółowości — widoczne na nim.
export function selectableUnits(units = [], channels = [], level = null) {
  const byId = indexById(units);
  return splitUnits(units, channels).own.filter((u) => Array.isArray(u.pos) && (!level || isUnitVisible(u, byId, level)));
}

// Id jednostek z listy, których pozycja leży w ramce { west, south, east, north } (stopnie).
export function unitsInBounds(candidates, { west, south, east, north }) {
  return candidates.filter((u) => u.pos[0] >= west && u.pos[0] <= east && u.pos[1] >= south && u.pos[1] <= north).map((u) => u.id);
}

// Klik: zastępuje zaznaczenie; Shift+klik (toggle): dodaje albo zdejmuje jednostkę. Zwraca nową listę.
export function toggleUnit(selected, id, { toggle = false } = {}) {
  if (!toggle) return [id];
  return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}
export const mergeUnits = (selected, ids) => [...new Set([...selected, ...ids])];

// ---------- geometria z kliknięć ----------
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

// Punkty [lon, lat] → geometria GeoJSON dla rodzaju wskazania. Zwraca { geometry } albo { error }.
export function geometryFromPoints(kind, points = []) {
  const spec = ORDER_KINDS[kind];
  if (!spec) return { error: 'Nieznany rodzaj wskazania' };
  const pts = points.filter((p, i) => i === 0 || !samePoint(p, points[i - 1]));
  if (pts.length < spec.min) return { error: `${spec.name}: wskaż co najmniej ${spec.min} ${spec.min === 1 ? 'punkt' : 'punkty'}` };
  if (spec.type === 'Point') return { geometry: { type: 'Point', coordinates: [...pts[0]] } };
  if (spec.type === 'LineString') return { geometry: { type: 'LineString', coordinates: pts.map((p) => [...p]) } };
  const ring = pts.map((p) => [...p]);
  if (!samePoint(ring[0], ring.at(-1))) ring.push([...ring[0]]);
  return { geometry: { type: 'Polygon', coordinates: [ring] } };
}

// ---------- rozdział na kanały ----------
// Kanał dowódcy jednostki (kanał podwładnego o jej id); null dla sąsiadów, przełożonego i jednostek bez kanału.
export function ownChannelId(unitId, units, channels) {
  const byId = indexById(units);
  const u = byId.get(unitId);
  if (!u || isNeighbourUnit(u, byId)) return null;
  const ch = channelForUnit(channels, unitId);
  return ch && ch.kind === 'subordinate' ? ch.id : null;
}

// Najniższy wspólny przełożony (id) jednostek (także jedna z nich, jeśli jest przełożoną pozostałych); null, gdy brak.
function commonAncestor(ids, byId) {
  const chain = (id) => {
    const out = [];
    for (let u = byId.get(id); u && !out.includes(u.id); u = byId.get(parentIdOf(u))) out.push(u.id);
    return out;
  };
  const chains = ids.map(chain);
  return chains[0].find((c) => chains.every((ch) => ch.includes(c))) ?? null;
}

/**
 * Do jakich kanałów trafią jednostki. delivery `own`: każda do własnego kanału; `common`: wszystkie do kanału
 * najniższego wspólnego przełożonego, jeśli ma kanał podwładnego (inaczej jak `own`).
 * Zwraca { groups: [{ channelId, unitIds }], skipped: [id] } (skipped: jednostki bez kanału dowódcy).
 */
export function deliveryGroups(unitIds, units, channels, delivery = 'own') {
  const ok = [];
  const skipped = [];
  for (const id of unitIds) (ownChannelId(id, units, channels) ? ok : skipped).push(id);
  if (delivery === 'common' && ok.length > 1) {
    const anc = commonAncestor(ok, indexById(units));
    const channelId = anc && ownChannelId(anc, units, channels);
    if (channelId) return { groups: [{ channelId, unitIds: ok }], skipped };
  }
  return { groups: ok.map((id) => ({ channelId: ownChannelId(id, units, channels), unitIds: [id] })), skipped };
}

const MAX_NAME = 80; // jak MAX_ORDER_NAME w shared/order.js
// Nazwa załącznika: „Marsz do — 1 bzmot, 2 bzmot”, skracana do limitu schematu.
export function orderName(task, unitNames) {
  const base = taskInfo(task)?.name ?? 'Rozkaz';
  const name = unitNames.length ? `${base} — ${unitNames.join(', ')}` : base;
  return name.length > MAX_NAME ? name.slice(0, MAX_NAME - 1) + '…' : name;
}

/**
 * Buduje załączniki rozkazu: { items: [{ channelId, attachment }], skipped }. `newId` — generator id (wstrzykiwany,
 * żeby funkcja była deterministyczna). Geometria jest kopiowana do każdego załącznika.
 */
export function buildOrderAttachments({ units: unitIds, task, geometry }, { units, channels, delivery = 'own', newId }) {
  const { groups, skipped } = deliveryGroups(unitIds, units, channels, delivery);
  const byId = indexById(units);
  const items = groups.map((g) => ({
    channelId: g.channelId,
    attachment: {
      id: newId(),
      kind: 'order',
      name: orderName(task, g.unitIds.map((id) => byId.get(id)?.name || id)),
      units: g.unitIds,
      task,
      geometry: JSON.parse(JSON.stringify(geometry)),
    },
  }));
  return { items, skipped };
}

// ---------- szkice wiadomości z rozkazami ----------
export const draftOrders = (draft) => draft?.orders ?? [];

// Nowa mapa szkiców z dopisanymi załącznikami w szkicu kanału (id unikalne w szkicu).
export function addDraftOrders(drafts, channelId, attachments) {
  const cur = draftOrders(drafts?.[channelId]);
  const fresh = attachments.filter((a) => !cur.some((c) => c.id === a.id));
  return updateDraft(drafts, channelId, { orders: [...cur, ...fresh] });
}
export const removeDraftOrder = (drafts, channelId, orderId) =>
  updateDraft(drafts, channelId, { orders: draftOrders(drafts?.[channelId]).filter((a) => a.id !== orderId) });

// Wszystkie niewysłane rozkazy graficzne ze szkiców: [{ channelId, order }] (podgląd na mapie).
export function allDraftOrders(drafts) {
  return Object.entries(drafts || {}).flatMap(([channelId, d]) => draftOrders(d).map((order) => ({ channelId, order })));
}

// Treść podpowiadana, gdy szkic nie ma jeszcze tekstu (gracz może ją zmienić): jedna linia na zadanie.
export function defaultOrderText(attachments) {
  const lines = attachments.map((a) => `${taskInfo(a.task)?.name ?? 'Zadanie'}: wg załączonego znaku na mapie.`);
  return [...new Set(lines)].join('\n');
}

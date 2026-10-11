// Wspólny schemat danych scenariusza — jedno źródło stałych i walidatorów.
// Czysty JS: bez DOM i bez API Node, więc ten sam plik używają serwer, walidator i (docelowo) klient.
// Opis formatu: docs/SCHEMA.md.

export const SCHEMA_VERSION = 1;

export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_NOTES = 500;

// --- Współrzędne i czas ---

// [długość, szerokość] jak w GeoJSON.
export const isCoord = (c) =>
  Array.isArray(c) && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

export const isValidTime = (t) => typeof t === 'string' && /T\d\d:\d\d/.test(t) && !Number.isNaN(Date.parse(t));

export const isCount = (n) => Number.isInteger(n) && n >= 0;

// --- Trasa przemieszczenia (units[].track) ---

// Tolerancja zgodności ostatniego punktu trasy z pozycją jednostki (stopnie, ok. 0,1 m).
export const TRACK_EPSILON = 1e-6;

// Sprawdza trasę przejechaną w turze kończącej się w `pos`: lista ≥ 2 poprawnych punktów [lon, lat],
// ostatni punkt równy pos (w granicach TRACK_EPSILON). Zwraca { error } | { warn } | {}.
export function checkTrack(track, pos) {
  if (!Array.isArray(track) || track.length < 2 || !track.every(isCoord)) return { error: 'track wymaga co najmniej 2 punktów [lon, lat]' };
  if (isCoord(pos)) {
    const last = track[track.length - 1];
    if (Math.abs(last[0] - pos[0]) > TRACK_EPSILON || Math.abs(last[1] - pos[1]) > TRACK_EPSILON) return { warn: 'ostatni punkt track nie równa się pos' };
  }
  return {};
}

// --- Kanały, linie, miejsca ---

export const CHANNEL_KINDS = ['superior', 'neighbor', 'subordinate', 'logistics', 'recon', 'other'];
export const LINE_KINDS = ['boundary', 'flot', 'enemy_flot', 'phase', 'axis', 'enemy_axis'];
export const PLACE_KINDS = ['miasto', 'wieś', 'wzgórze', 'jezioro', 'rzeka', 'droga', 'przejście', 'inne'];

// --- Szkice gracza (player/notes) ---

export const NOTE_KINDS = { arrow: 'LineString', line: 'LineString', area: 'Polygon', point: 'Point', symbol: 'Point' };
export const NOTE_COLORS = ['blue', 'red', 'black'];
// Rodzaje znaków taktycznych (graphic) dla każdego rodzaju geometrii; brak pola = rysunek klasyczny.
export const NOTE_GRAPHICS = {
  arrow: ['axis_main', 'axis_support', 'axis_catk', 'direction'],
  line: ['phase_line', 'boundary', 'flot', 'obstacle_line', 'line'],
  area: ['generic', 'assembly', 'objective', 'engagement', 'battle_position', 'minefield'],
  point: ['checkpoint', 'contact_point', 'target', 'point'],
  symbol: [],
};
export const NOTE_ECHELONS = ['D', 'E', 'F', 'G', 'H', 'I', 'J'];

// --- Biała lista pól plików gracza (player/turns/NNN.json) ---
// Wszystko spoza listy jest polem sędziego (np. side, supply, events) i nie może trafić do pliku gracza.

export const PLAYER_TURN_FIELDS = ['turn', 'time', 'units', 'contacts', 'assets', 'lines'];
export const PLAYER_FIELDS = {
  units: ['id', 'name', 'sidc', 'pos', 'strength', 'status', 'task', 'personnel', 'equipment', 'parent', 'formation', 'track', 'notes'],
  contacts: ['id', 'sidc', 'pos', 'uncertainty_m', 'observed', 'source', 'confidence', 'estimate', 'estimate_personnel', 'estimate_equipment'],
  assets: ['id', 'name', 'type', 'sidc', 'pos', 'status', 'task'],
  lines: ['id', 'kind', 'label', 'coords', 'formation'],
};
export const PLAYER_MESSAGE_FIELDS = ['id', 'channel', 'from', 'turn', 'time', 'sent', 'type', 'priority', 'text', 'attachments'];

// Rodzaj i priorytet wiadomości (gracza w outboxie; sędziego w inboxie). Oba pola opcjonalne.
export const MESSAGE_TYPES = ['rozkaz', 'zarzadzenie', 'meldunek', 'wiadomosc'];
export const MESSAGE_PRIORITIES = ['normal', 'urgent'];

// Zwraca listę nazw pól obiektu spoza dozwolonej listy.
export function extraFields(obj, allowed) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

// --- Walidacja szkicu ---

// Zwraca { note } (oczyszczony szkic) albo { error } (komunikat bez prefiksu „Rysunek …”).
export function checkNote(n) {
  const fail = (error) => ({ error });
  if (!n || typeof n !== 'object') return fail('nieprawidłowy obiekt');
  if (typeof n.id !== 'string' || !/^[\w-]{1,40}$/.test(n.id)) return fail('nieprawidłowe id');
  if (!Object.hasOwn(NOTE_KINDS, n.kind)) return fail('nieznany rodzaj');
  if (typeof n.name !== 'string' || !n.name.trim() || n.name.length > 60) return fail('nazwa wymagana, maks. 60 znaków');
  if (n.description !== undefined && (typeof n.description !== 'string' || n.description.length > 1000)) return fail('opis maks. 1000 znaków');
  if (n.color !== undefined && !NOTE_COLORS.includes(n.color)) return fail('nieznany kolor');
  if (n.graphic !== undefined && !NOTE_GRAPHICS[n.kind].includes(n.graphic)) return fail('nieznany rodzaj znaku dla tego typu rysunku');
  if (n.echelon !== undefined && !NOTE_ECHELONS.includes(n.echelon)) return fail('nieznany szczebel');
  if (n.flip !== undefined && typeof n.flip !== 'boolean') return fail('nieprawidłowa strona znaku');
  const g = n.geometry;
  if (!g || g.type !== NOTE_KINDS[n.kind]) return fail('geometria niezgodna z rodzajem');
  if (g.type === 'Point' && !isCoord(g.coordinates)) return fail('nieprawidłowy punkt');
  if (g.type === 'LineString' && !(Array.isArray(g.coordinates) && g.coordinates.length >= 2 && g.coordinates.every(isCoord))) return fail('linia wymaga min. 2 punktów');
  if (g.type === 'Polygon' && !(Array.isArray(g.coordinates) && g.coordinates.length >= 1 && g.coordinates.every((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isCoord)))) return fail('nieprawidłowy wielokąt');
  if (n.kind === 'symbol' && (typeof n.sidc !== 'string' || n.sidc.length !== 15)) return fail('symbol wymaga SIDC (15 znaków)');
  const clean = { id: n.id, kind: n.kind, name: n.name.trim(), color: n.color ?? 'black', geometry: { type: g.type, coordinates: g.coordinates } };
  if (n.description) clean.description = n.description;
  if (n.kind === 'symbol') clean.sidc = n.sidc;
  if (n.graphic) clean.graphic = n.graphic;
  if (n.echelon) clean.echelon = n.echelon;
  if (n.flip) clean.flip = true;
  return { note: clean };
}

// Wersja rzucająca zwykły Error (komunikat po polsku, z id rysunku).
export function validateNote(n) {
  const r = checkNote(n);
  if (r.error) throw new Error(`Rysunek ${n?.id ?? '?'}: ${r.error}`);
  return r.note;
}

// --- Wiadomości ---

// Zwraca komunikat błędu albo null. Pola `type` i `priority` są opcjonalne (brak = domyślne).
export function checkMessageMeta({ type, priority } = {}) {
  if (type !== undefined && !MESSAGE_TYPES.includes(type)) return `Nieznany rodzaj wiadomości (dozwolone: ${MESSAGE_TYPES.join(', ')})`;
  if (priority !== undefined && !MESSAGE_PRIORITIES.includes(priority)) return `Nieznany priorytet (dozwolone: ${MESSAGE_PRIORITIES.join(', ')})`;
  return null;
}

// Zwraca komunikat błędu albo null. Sprawdza tylko treść; kanał sprawdza wywołujący.
export function checkMessageText(text) {
  if (typeof text !== 'string' || text.trim() === '') return 'Pusta wiadomość';
  if (text.length > MAX_MESSAGE_LENGTH) return `Wiadomość dłuższa niż ${MAX_MESSAGE_LENGTH} znaków`;
  return null;
}

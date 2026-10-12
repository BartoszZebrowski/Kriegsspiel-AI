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

// --- Pozycja BFT (units[].pos_time, T49) ---

// Czas raportu pozycji własnej jednostki: nie późniejszy niż czas tury (błąd); wcześniejszy niż początek okresu tury
// (czas tury − turnMinutes) = uwaga (pozycja zamarznięta: zagłuszenie, cisza radiowa, utrata łączności).
// Zwraca { error } | { warn } | {}.
export function checkPosTime(posTime, turnTime, turnMinutes) {
  if (!isValidTime(posTime)) return { error: 'pos_time musi być czasem ISO' };
  if (!isValidTime(turnTime)) return {};
  const t = Date.parse(posTime);
  const now = Date.parse(turnTime);
  if (t > now) return { error: 'pos_time późniejszy niż czas tury' };
  if (turnMinutes > 0 && t < now - turnMinutes * 60000) return { warn: 'pos_time starszy niż okres tury (pozycja BFT zamarznięta?)' };
  return {};
}

// --- Kanały, linie, miejsca ---

export const CHANNEL_KINDS = ['superior', 'neighbor', 'subordinate', 'logistics', 'recon', 'other'];
// Reguły dowodzenia (T45): scenario.commandRules.skipEchelon — koszt rozkazu z pominięciem szczebla. Domyślnie "soft".
export const SKIP_ECHELON_MODES = ['off', 'soft', 'hard'];
export const COMMAND_RULES_FIELDS = ['skipEchelon'];
/** Błędy sekcji commandRules (lista tekstów; pusta = poprawna albo nieobecna). */
export function checkCommandRules(rules) {
  if (rules === undefined) return [];
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return ['commandRules musi być obiektem'];
  const errors = extraFields(rules, COMMAND_RULES_FIELDS).map((f) => `commandRules: nieznane pole „${f}”`);
  if (rules.skipEchelon !== undefined && !SKIP_ECHELON_MODES.includes(rules.skipEchelon)) {
    errors.push(`commandRules.skipEchelon: „${rules.skipEchelon}” (dozwolone: ${SKIP_ECHELON_MODES.join(', ')})`);
  }
  return errors;
}
export const LINE_KINDS = ['boundary', 'flot', 'enemy_flot', 'phase', 'axis', 'enemy_axis', 'ew_zone'];
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

export const PLAYER_TURN_FIELDS = ['turn', 'time', 'units', 'contacts', 'assets', 'lines', 'logistics', 'staff', 'engineering'];
export const PLAYER_FIELDS = {
  units: ['id', 'name', 'sidc', 'pos', 'strength', 'status', 'task', 'personnel', 'equipment', 'parent', 'formation', 'track', 'notes', 'dos', 'pos_time'],
  contacts: ['id', 'sidc', 'pos', 'uncertainty_m', 'observed', 'source', 'confidence', 'estimate', 'estimate_personnel', 'estimate_equipment'],
  assets: ['id', 'name', 'type', 'sidc', 'pos', 'status', 'task'],
  lines: ['id', 'kind', 'label', 'coords', 'formation', 'observed'],
  engineering: ['id', 'kind', 'owner', 'state', 'label', 'coords', 'pos', 'progress', 'unit', 'observed', 'source', 'confidence'], // T27, walidacja: shared/engineering.js
};
export const PLAYER_MESSAGE_FIELDS = ['id', 'channel', 'from', 'turn', 'time', 'sent', 'type', 'priority', 'text', 'attachments', 'ccir', 'report', 'form', 'fire', 'overlay'];

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

// --- Warstwa logistyczna (T17) i DOS jednostki (T18) ---

export const LOGISTICS_LISTS = ['depots', 'routes', 'bridges', 'convoys'];
export const LOGISTICS_STOCK_KEYS = ['fuel', 'ammo', 'general']; // składy i ładunki: tony
export const DEPOT_STATUSES = ['operational', 'limited', 'destroyed'];
export const ROUTE_KINDS = ['MSR', 'ASR'];
export const ROUTE_STATUSES = ['open', 'threatened', 'closed'];
export const BRIDGE_STATUSES = ['intact', 'damaged', 'destroyed'];
export const CONVOY_STATUSES = ['planned', 'moving', 'halted', 'delayed', 'destroyed', 'arrived'];
// Dozwolone pola elementów (plik gracza: nic ponad listę; umpire/ może mieć pola dodatkowe).
export const LOGISTICS_FIELDS = {
  depots: ['id', 'name', 'pos', 'stock', 'status', 'as_of', 'notes'],
  routes: ['id', 'name', 'kind', 'coords', 'status', 'as_of', 'notes'],
  bridges: ['id', 'name', 'pos', 'mlc', 'status', 'as_of', 'notes'],
  convoys: ['id', 'name', 'pos', 'from', 'to', 'cargo', 'eta', 'status', 'track', 'as_of', 'notes'],
};

// DOS jednostki (units[].dos): dni zaopatrzenia ≥ 0, sprawność sprzętu 0–1, czas meldunku ISO.
export const DOS_KEYS = ['fuel', 'ammo', 'general'];
export const DOS_FIELDS = [...DOS_KEYS, 'readiness', 'as_of'];

const isNonNeg = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;

/** Błąd (tekst) albo null. Wskaźniki opcjonalne (min. jeden), podane muszą być poprawne; `as_of` wymagane. */
export function checkDos(dos) {
  if (!dos || typeof dos !== 'object' || Array.isArray(dos)) return 'dos musi być obiektem';
  const extra = extraFields(dos, DOS_FIELDS);
  if (extra.length) return `dos: pole „${extra[0]}” spoza schematu`;
  for (const k of DOS_KEYS) if (dos[k] !== undefined && !isNonNeg(dos[k])) return `dos.${k} musi być liczbą ≥ 0`;
  if (dos.readiness !== undefined && !(isNonNeg(dos.readiness) && dos.readiness <= 1)) return 'dos.readiness musi być liczbą 0–1';
  if (!DOS_KEYS.some((k) => dos[k] !== undefined) && dos.readiness === undefined) return 'dos wymaga co najmniej jednego wskaźnika (fuel, ammo, general, readiness)';
  if (!isValidTime(dos.as_of)) return 'dos.as_of musi być czasem ISO';
  return null;
}

function checkTonnage(where, v, errors) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return errors.push(`${where}: wymagany obiekt {fuel, ammo, general}`);
  for (const k of Object.keys(v)) if (!LOGISTICS_STOCK_KEYS.includes(k)) errors.push(`${where}: pole „${k}” spoza {fuel, ammo, general}`);
  for (const k of LOGISTICS_STOCK_KEYS) if (!isNonNeg(v[k])) errors.push(`${where}.${k}: liczba ≥ 0 (tony)`);
}

const LOGISTICS_STATUS_ENUMS = { depots: DEPOT_STATUSES, routes: ROUTE_STATUSES, bridges: BRIDGE_STATUSES, convoys: CONVOY_STATUSES };

/**
 * Walidacja `logistics`. opts.strict (plik gracza): pola spoza LOGISTICS_FIELDS to błąd.
 * Zwraca { errors, warnings } (teksty bez prefiksu pliku, z id elementów). Id unikalne w całym `logistics`.
 */
export function checkLogistics(l, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!l || typeof l !== 'object' || Array.isArray(l)) return { errors: ['logistics musi być obiektem'], warnings };
  for (const k of Object.keys(l)) if (!LOGISTICS_LISTS.includes(k)) errors.push(`logistics: nieznana lista „${k}”`);
  const ids = new Set();
  for (const list of LOGISTICS_LISTS) {
    if (l[list] === undefined) continue;
    if (!Array.isArray(l[list])) { errors.push(`logistics.${list}: musi być listą`); continue; }
    for (const [i, it] of l[list].entries()) {
      const where = `logistics.${list}[${it?.id ?? i}]`;
      if (!it || typeof it !== 'object') { errors.push(`${where}: nieprawidłowy element`); continue; }
      if (typeof it.id !== 'string' || !it.id) errors.push(`${where}: brak id`);
      else if (ids.has(it.id)) errors.push(`${where}: zduplikowane id „${it.id}”`);
      else ids.add(it.id);
      if (strict) for (const f of extraFields(it, LOGISTICS_FIELDS[list])) errors.push(`${where}: pole „${f}” spoza schematu gracza (pole sędziego?)`);
      if (typeof it.name !== 'string' || !it.name.trim()) errors.push(`${where}: brak nazwy`);
      const allowed = LOGISTICS_STATUS_ENUMS[list];
      if (!allowed.includes(it.status)) errors.push(`${where}: status „${it.status}” (dozwolone: ${allowed.join(', ')})`);
      if (it.as_of !== undefined && !isValidTime(it.as_of)) errors.push(`${where}: as_of musi być czasem ISO`);
      if (list === 'depots') {
        if (!isCoord(it.pos)) errors.push(`${where}: nieprawidłowe pos [lon, lat]`);
        checkTonnage(`${where} stock`, it.stock, errors);
        if (it.as_of === undefined) errors.push(`${where}: brak as_of`);
      } else if (list === 'routes') {
        if (!ROUTE_KINDS.includes(it.kind)) errors.push(`${where}: kind „${it.kind}” (dozwolone: ${ROUTE_KINDS.join(', ')})`);
        if (!Array.isArray(it.coords) || it.coords.length < 2 || !it.coords.every(isCoord)) errors.push(`${where}: coords wymaga co najmniej 2 punktów [lon, lat]`);
      } else if (list === 'bridges') {
        if (!isCoord(it.pos)) errors.push(`${where}: nieprawidłowe pos [lon, lat]`);
        if (it.mlc !== undefined && !(isNonNeg(it.mlc) && it.mlc > 0)) errors.push(`${where}: mlc musi być liczbą > 0`);
      } else {
        if (!isCoord(it.pos)) errors.push(`${where}: nieprawidłowe pos [lon, lat]`);
        for (const f of ['from', 'to']) if (typeof it[f] !== 'string' || !it[f].trim()) errors.push(`${where}: brak ${f}`);
        checkTonnage(`${where} cargo`, it.cargo, errors);
        if (it.eta !== undefined && !isValidTime(it.eta)) errors.push(`${where}: eta musi być czasem ISO`);
        if (it.track !== undefined) {
          const r = checkTrack(it.track, it.pos);
          if (r.error) errors.push(`${where}: ${r.error}`);
          else if (r.warn) warnings.push(`${where}: ${r.warn}`);
        }
      }
    }
  }
  return { errors, warnings };
}

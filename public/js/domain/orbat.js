// Hierarchia jednostek (ORBAT): drzewo podległości i filtr szczegółowości mapy (czyste funkcje).
import { parseSidc } from './sidc.js';

// Kolejność wielkości od najmniejszej (załoga) do największej (okręg).
const ECHELON_ORDER = 'ABCDEFGHIJKLM';
export const BATTALION_RANK = ECHELON_ORDER.indexOf('F');
export const COMPANY_RANK = ECHELON_ORDER.indexOf('E');
export const PLATOON_RANK = ECHELON_ORDER.indexOf('D');

export function echelonRank(unit) {
  const code = parseSidc(unit?.sidc).echelonCode;
  return ECHELON_ORDER.indexOf(code); // -1 gdy brak wielkości
}

// Id przełożonego w drzewie: `parent` (własne siły) albo `formation` (jednostka sąsiada należy do jego formacji,
// ale nie podlega graczowi). Zob. docs/SCHEMA.md.
export const parentIdOf = (u) => u?.parent ?? u?.formation ?? null;

// Drzewo: { unit, children: [...] }. Jednostki bez rodzica (albo z nieistniejącym) są korzeniami.
// Kolejność wejściowa zostaje zachowana.
export function buildTree(units) {
  const nodes = new Map(units.map((u) => [u.id, { unit: u, children: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    const pid = parentIdOf(node.unit);
    const parent = pid && pid !== node.unit.id ? nodes.get(pid) : null;
    (parent ? parent.children : roots).push(node);
  }
  return roots;
}

export function childrenOf(units, id) {
  return units.filter((u) => u.parent === id || u.formation === id);
}

export function indexById(units) {
  return new Map(units.map((u) => [u.id, u]));
}

// Id dowództwa sąsiada (`formation`), do którego należy jednostka — wprost albo przez łańcuch `parent`; inaczej null.
// Jednostki sąsiada są przyjazne, ale nie podlegają graczowi: bez kanałów, rozkazów i w osobnej części drzewa.
export function formationRootId(unit, byId) {
  const seen = new Set();
  for (let u = unit; u && !seen.has(u.id); u = byId.get(u.parent)) {
    if (typeof u.formation === 'string') return u.formation;
    seen.add(u.id);
  }
  return null;
}
export const isNeighbourUnit = (unit, byId) => formationRootId(unit, byId) !== null;

// Poziomy szczegółowości mapy, od najmniej do najbardziej szczegółowego.
export const DETAIL_LEVELS = ['battalion', 'company', 'platoon'];
// Poziom szczegółowości: wybór ręczny ma pierwszeństwo przed automatem (wg przybliżenia mapy).
export const AUTO_COMPANY_ZOOM = 11;
export const AUTO_PLATOON_ZOOM = 13;
export function detailLevel(choice, zoom) {
  if (DETAIL_LEVELS.includes(choice)) return choice;
  if (zoom >= AUTO_PLATOON_ZOOM) return 'platoon';
  return zoom >= AUTO_COMPANY_ZOOM ? 'company' : 'battalion';
}

// Jednostka jest widoczna na danym poziomie, gdy jej wielkość jest wyższa niż „dno” poziomu albo gdy jej
// przełożony jest większy niż próg ukrywania. Poziom „pluton” pokazuje wszystko.
//  - batalion: ukryte jednostki poniżej batalionu, których przełożony jest batalionem lub mniejszy
//    (kompania bez rodzica albo podległa wyższemu szczeblowi, np. krozp pod ZT, zostaje widoczna);
//  - kompania: ukryte plutony (i mniejsze), których przełożony jest kompanią lub mniejszy.
const HIDE_RULES = { battalion: BATTALION_RANK - 1, company: PLATOON_RANK };
export function isUnitVisible(unit, byId, level) {
  if (level === 'platoon') return true;
  const rank = echelonRank(unit);
  const maxHidden = HIDE_RULES[level] ?? HIDE_RULES.battalion;
  if (rank < 0 || rank > maxHidden) return true;
  const pid = parentIdOf(unit);
  const parent = pid ? byId.get(pid) : null;
  if (!parent) return true;
  const parentRank = echelonRank(parent);
  return !(parentRank >= 0 && parentRank <= maxHidden + 1);
}

// Najmniejszy poziom szczegółowości, na którym jednostka jest widoczna (do odsłaniania ukrytych jednostek).
export function minLevelFor(unit, byId) {
  return DETAIL_LEVELS.find((l) => isUnitVisible(unit, byId, l)) ?? 'platoon';
}

// Pary (przełożony, podwładny) do narysowania linii na mapie: tylko gdy oba końce
// mają położenie i są widoczne przy danym poziomie szczegółowości. `neighbour: true` — linia w formacji sąsiada
// (inny styl niż podporządkowanie własnych sił).
export function hierarchyLinks(units, level) {
  const byId = indexById(units);
  const shown = (u) => Array.isArray(u?.pos) && isUnitVisible(u, byId, level);
  const pairs = [];
  for (const u of units) {
    const pid = parentIdOf(u);
    const parent = pid ? byId.get(pid) : null;
    if (parent && shown(u) && shown(parent)) pairs.push({ parent: parent.id, child: u.id, neighbour: isNeighbourUnit(u, byId) });
  }
  return pairs;
}

// Kanały komunikatora: kanały ze scenariusza (przełożony, sąsiedzi, S4, S2…) plus automatyczne
// kanały jednostek własnych z bieżącej tury (id kanału = id jednostki, nazwa = nazwa jednostki).
// Kanał ze scenariusza o tym samym id nadpisuje metadane. Jednostki, które są celem kanału
// ze scenariusza (pole `unit`), nie dostają drugiego kanału. Pole `parent` kanału bierzemy z jednostki.
export function mergeChannels(scenarioChannels, units) {
  const base = scenarioChannels || [];
  const byUnit = indexById(units || []);
  const taken = new Set(base.map((c) => c.id));
  const targeted = new Set(base.map((c) => c.unit).filter(Boolean));
  // Jednostki formacji sąsiadów nie dostają kanałów (gracz nimi nie dowodzi).
  const out = base.map((c) => {
    const u = byUnit.get(c.id);
    return u?.parent && c.parent === undefined ? { ...c, parent: u.parent } : c;
  });
  for (const u of units || []) {
    if (!u.parent || taken.has(u.id) || targeted.has(u.id) || isNeighbourUnit(u, byUnit)) continue;
    out.push({ id: u.id, name: u.name || u.id, kind: 'subordinate', unit: u.id, parent: u.parent, description: u.task, auto: true });
  }
  return out;
}

// Suma po poddrzewie (np. nieprzeczytanych wiadomości): własna wartość + wszystkich potomków.
export function subtreeSum(node, valueOf) {
  return node.children.reduce((sum, c) => sum + subtreeSum(c, valueOf), valueOf(node.unit));
}

// Id jednostki, na którą wskazuje kanał (pole `unit`; domyślnie id kanału).
export const channelUnitId = (channel) => (channel ? channel.unit ?? channel.id : null);

// Krótka etykieta kanału na liście: pole `short` albo 4 pierwsze znaki nazwy bez spacji i cudzysłowów.
export function shortName(channel) {
  if (channel.short) return channel.short;
  return channel.name.replace(/[„”"]/g, '').replace(/\s+/g, '').slice(0, 4);
}

// Podział jednostek z tury na siły własne i „zewnętrzne” (przełożony i sąsiedzi: jednostki wskazane przez kanały
// kind = superior | neighbor albo przez `formation` innych jednostek) oraz podwładnych sąsiadów (`formation`).
// Zwraca { own, external: [{ unit, channel }], formation } z zachowaniem kolejności; `channel` może być null
// (dowództwo sąsiada znane tylko z `formation`).
export function splitUnits(units, channels) {
  const ext = new Map();
  for (const c of channels || []) {
    if (c.kind === 'superior' || c.kind === 'neighbor') ext.set(channelUnitId(c), c);
  }
  const byId = indexById(units || []);
  const heads = new Set();
  for (const u of units || []) {
    const root = formationRootId(u, byId);
    if (root) heads.add(root);
  }
  const own = [];
  const external = [];
  const formation = [];
  for (const u of units || []) {
    if (isNeighbourUnit(u, byId)) formation.push(u);
    else if (ext.has(u.id)) external.push({ unit: u, channel: ext.get(u.id) });
    else if (heads.has(u.id)) external.push({ unit: u, channel: null });
    else own.push(u);
  }
  return { own, external, formation };
}

// Drzewo formacji sąsiada: korzeń = jego dowództwo, dzieci = jednostki z `formation` (i ich podwładni przez `parent`).
export function formationTree(head, formationUnits) {
  const byId = indexById(formationUnits);
  const mine = formationUnits.filter((u) => formationRootId(u, byId) === head.id);
  return buildTree([head, ...mine])[0];
}

// Kanał, którym rozmawia się z jednostką: kanał o id jednostki, a w drugiej kolejności kanał wskazujący ją
// polem `unit` (poza kanałami rozpoznania — „s2” wskazuje dowództwo, ale nie jest jego kanałem).
export function channelForUnit(channels, unitId) {
  return (
    channels.find((c) => c.id === unitId) ||
    channels.find((c) => c.unit === unitId && c.kind !== 'recon') ||
    null
  );
}

// Nieprzeczytane wiadomości przypisane do jednostek: { [unitId]: n } (wg kanałów).
export function unreadByUnit(channels, unread) {
  const out = {};
  for (const c of channels) {
    const n = unread.byChannel[c.id] || 0;
    if (n) out[channelUnitId(c)] = (out[channelUnitId(c)] || 0) + n;
  }
  return out;
}

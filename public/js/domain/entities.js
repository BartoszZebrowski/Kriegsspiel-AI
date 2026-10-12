import { findLogisticsItem, logisticsPos } from './logistics.js';

// Obiekty na mapie (jednostka, kontakt, środek rozpoznania) wyszukiwane w danych tury.

// Zwraca { kind, item } albo null. Obiekt bez położenia (`pos`) nie jest „na mapie”.
// Przy zdublowanym id pierwszeństwo: środek rozpoznania > jednostka > kontakt (jak dawniej na mapie).
export function findEntity(turn, id) {
  if (!turn || !id) return null;
  const hasPos = (x) => Array.isArray(x.pos);
  const asset = (turn.assets || []).find((a) => a.id === id && a.sidc && hasPos(a));
  if (asset) return { kind: 'asset', item: asset };
  const unit = (turn.units || []).find((u) => u.id === id && hasPos(u));
  if (unit) return { kind: 'unit', item: unit };
  const contact = (turn.contacts || []).find((c) => c.id === id && hasPos(c));
  if (contact) return { kind: 'contact', item: contact };
  // Elementy warstwy logistycznej (T17): kind = depot | route | bridge | convoy; pierwszeństwo mają obiekty powyżej.
  const lg = findLogisticsItem(turn, id);
  return lg && logisticsPos(lg.kind, lg.item) ? lg : null;
}

// Punkt [lon, lat] obiektu (dla trasy logistycznej: jej środek) albo null.
export function entityPos(entity) {
  if (!entity) return null;
  return entity.kind === 'route' ? logisticsPos('route', entity.item) : Array.isArray(entity.item.pos) ? entity.item.pos : null;
}

// Intencje wyboru obiektów: zaznaczenie, centrowanie mapy, wzmianki, szczegółowość. Bez DOM; współdzieli store z kontrolerem.
import { findEntity } from '../domain/entities.js';
import { indexById, isUnitVisible, minLevelFor, DETAIL_LEVELS } from '../domain/orbat.js';

export function createSelection({ store, storage, S, keyOf, notify, nextNonce }) {
  const selectionOf = (id) => (id ? { id, kind: findEntity(S().turn, id)?.kind ?? null } : null);

  function setSelection(id) {
    const next = selectionOf(id);
    const cur = S().selection;
    if (cur?.id === next?.id && cur?.kind === next?.kind) return;
    store.set({ selection: next });
  }

  // ---------- wybór obiektów ----------
  const layerOf = { unit: 'units', contact: 'contacts', asset: 'assets', depot: 'logistics', route: 'logistics', bridge: 'logistics', convoy: 'logistics' };

  function isShown(id) {
    const s = S();
    const e = findEntity(s.turn, id);
    if (!e || !s.layers[layerOf[e.kind]]) return false;
    return e.kind !== 'unit' || isUnitVisible(e.item, indexById(s.turn.units || []), s.level);
  }

  function setDetail(choice) {
    const detail = DETAIL_LEVELS.includes(choice) ? choice : null;
    storage.save(keyOf('detail'), detail);
    store.set({ detail });
  }

  // Zaznacza obiekt (inspektor pokazuje jego kartę) i — domyślnie — centruje mapę.
  // Ukrytą kompanię/pluton odsłania zmianą szczegółowości. Zwraca false, gdy obiektu nie ma na mapie.
  function selectEntity(id, { pan = true } = {}) {
    const s = S();
    const e = findEntity(s.turn, id);
    if (!e) return false;
    const patch = { selection: { id, kind: e.kind } };
    if (pan) patch.focus = { kind: 'entity', id, nonce: nextNonce() };
    if (e.kind === 'unit') {
      const byId = indexById(s.turn.units || []);
      if (!isUnitVisible(e.item, byId, s.level)) {
        patch.detail = minLevelFor(e.item, byId);
        storage.save(keyOf('detail'), patch.detail);
      }
    }
    store.set(patch);
    return true;
  }

  // Tylko centruje mapę na obiekcie (nagłówek rozmowy, „Wycentruj”).
  function focusEntity(id) {
    if (id && findEntity(S().turn, id)) store.set({ focus: { kind: 'entity', id, nonce: nextNonce() } });
  }

  const clearSelection = () => store.set({ selection: null });
  const hoverUnit = (id) => store.set({ hoverUnit: id ?? null });

  // Wzmianka w wiadomości: miejsce → przelot na mapie; obiekt → zaznaczenie w inspektorze.
  function mentionClick(kind, id) {
    if (kind === 'place') {
      const place = S().places.find((p) => p.id === id);
      if (place && Array.isArray(place.pos)) store.set({ focus: { kind: 'place', place, nonce: nextNonce() } });
    } else if (kind === 'unit') {
      if (!selectEntity(id)) notify('Tej jednostki nie ma na mapie w tej turze', true);
    } else if (isShown(id)) {
      selectEntity(id);
    } else {
      notify('Tego obiektu nie ma teraz na mapie (warstwa wyłączona lub brak pozycji)', true);
    }
  }

  // Załącznik rozkazu: pokaż szkic na mapie.
  const showAttachment = (note) => store.set({ focus: { kind: 'geometry', note, nonce: nextNonce() } });
  const flyToPlace = (place) => {
    if (place && Array.isArray(place.pos)) store.set({ focus: { kind: 'place', place, nonce: nextNonce() } });
  };

  return { setSelection, selectEntity, focusEntity, clearSelection, hoverUnit, mentionClick, showAttachment, flyToPlace, setDetail };
}

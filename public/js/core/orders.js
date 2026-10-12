// Intencje rozkazu graficznego (T44): tryb zaznaczania i wskazywania na mapie, budowa załączników i wpisanie ich do
// szkiców wiadomości w kanałach dowódców. Bez DOM; logika w domain/order.js. Stan trybu: store.orderMode.
import { selectableUnits, mergeUnits, toggleUnit, taskInfo, buildOrderAttachments, addDraftOrders, defaultOrderText, ORDER_DELIVERY } from '../domain/order.js';
import { updateDraft } from '../domain/compose.js';

const newOrderId = () => 'o-' + Math.random().toString(36).slice(2, 10);

// `openChannel(id)` — kontroler odsłania komunikator i wybiera kanał.
export function createOrders({ store, S, notify, openChannel, newId = newOrderId }) {
  const mode = () => S().orderMode;

  // Jednostki, które można zaznaczyć w tej chwili (własne, widoczne na bieżącym poziomie szczegółowości).
  const selectable = () => selectableUnits(S().turn?.units, S().channels, S().level);
  const patchMode = (patch) => mode() && store.set({ orderMode: { ...mode(), ...patch } });

  function startOrderMode() {
    if (S().archive) {
      notify('Archiwum — rozkazy można wydawać tylko w bieżącej turze', true);
      return false;
    }
    if (mode()) return true;
    // Zaczynamy od zaznaczonej na mapie jednostki własnej (jeśli jest).
    const sel = S().selection;
    const preselected = sel?.kind === 'unit' && selectable().some((u) => u.id === sel.id) ? [sel.id] : [];
    store.set({ orderMode: { selected: preselected, task: null, kind: null, delivery: 'own' } });
    return true;
  }
  const stopOrderMode = () => {
    if (mode()) store.set({ orderMode: null });
  };
  const toggleOrderMode = () => (mode() ? stopOrderMode() : startOrderMode());

  // Zaznaczenie: ids = jednostki z kliku albo ramki. toggle (Shift+klik) przełącza pojedynczą jednostkę, add (Shift+ramka)
  // dopisuje; domyślnie zastępuje zaznaczenie. Nieznane i nieosiągalne jednostki są ignorowane.
  function orderPick(ids, { toggle = false, add = false } = {}) {
    if (!mode()) return;
    const ok = new Set(selectable().map((u) => u.id));
    const picked = ids.filter((id) => ok.has(id));
    if (!picked.length && !add && !toggle) return;
    let selected = mode().selected;
    if (toggle && picked.length === 1) selected = toggleUnit(selected, picked[0], { toggle: true });
    else if (add || toggle) selected = mergeUnits(selected, picked);
    else selected = picked;
    patchMode({ selected });
  }
  const orderRemoveUnit = (id) => patchMode({ selected: (mode()?.selected ?? []).filter((x) => x !== id) });

  // Zadanie ustawia też rodzaj wskazania (jeśli zadanie ma tylko jeden); poprzedni rodzaj zostaje, gdy zadanie go przyjmuje.
  function orderSetTask(task) {
    if (mode() && task == null) return patchMode({ task: null, kind: null }); // wycofanie wyboru zadania
    const info = taskInfo(task);
    if (!mode() || !info) return;
    const kind = info.kinds.includes(mode().kind) ? mode().kind : info.kinds[0];
    patchMode({ task, kind });
  }
  function orderSetKind(kind) {
    const info = taskInfo(mode()?.task);
    if (info?.kinds.includes(kind)) patchMode({ kind });
  }
  const orderSetDelivery = (delivery) => ORDER_DELIVERY.includes(delivery) && patchMode({ delivery });

  /**
   * Zatwierdza wskazanie: geometria (GeoJSON) + zaznaczone jednostki + zadanie → załączniki w szkicach kanałów.
   * Jednym `set` zapisuje szkice i kończy tryb, potem otwiera pierwszy kanał. Zwraca liczbę dopisanych załączników.
   */
  function orderCommit(geometry) {
    const m = mode();
    if (!m || !geometry) return 0;
    if (!m.selected.length) {
      notify('Najpierw zaznacz jednostki', true);
      return 0;
    }
    if (!m.task) {
      notify('Wybierz zadanie', true);
      return 0;
    }
    const s = S();
    const { items, skipped } = buildOrderAttachments(
      { units: m.selected, task: m.task, geometry },
      { units: s.turn?.units ?? [], channels: s.channels, delivery: m.delivery, newId },
    );
    if (!items.length) {
      notify('Zaznaczone jednostki nie mają kanału dowódcy — nie można dołączyć rozkazu', true);
      return 0;
    }
    let drafts = s.drafts;
    for (const { channelId, attachment } of items) {
      drafts = addDraftOrders(drafts, channelId, [attachment]);
      const cur = drafts[channelId];
      // Pusta treść dostaje podpowiedź, żeby szkic dało się wysłać; rodzaj domyślnie „rozkaz”.
      if (!cur.text.trim()) drafts = updateDraft(drafts, channelId, { text: defaultOrderText(cur.orders), type: cur.type ?? 'rozkaz' });
    }
    store.set({ drafts, orderMode: null });
    openChannel(items[0].channelId);
    const where = items.length === 1 ? 'szkicu wiadomości' : `szkiców w ${items.length} kanałach`;
    notify(`Rozkaz graficzny dopisano do ${where} — sprawdź treść i wyślij.${skipped.length ? ` Pominięto (brak kanału dowódcy): ${skipped.length}.` : ''}`);
    return items.length;
  }

  return { startOrderMode, stopOrderMode, toggleOrderMode, orderPick, orderRemoveUnit, orderSetTask, orderSetKind, orderSetDelivery, orderCommit };
}

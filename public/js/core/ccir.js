// Podkontroler CCIR (T48): edytor listy krytycznych potrzeb informacyjnych i wskazywanie geometrii na mapie.
// Zapisana lista leży w store.ccir; edytowana kopia i tryb wskazywania w store.ccirEditor { open, draft, pick }.
// Zapis na serwer dopiero po „Zapisz” (ccirSave). Wskazanie na mapie zgłasza widok mapy (ccirSetGeometry).
import { addCcirItem, removeCcirItem, updateCcirItem, setCcirGeometry, cleanCcirItems, CCIR_SHAPES } from '../domain/ccir.js';

export function createCcir({ store, api, S, notify }) {
  const ed = () => S().ccirEditor;
  const setEditor = (patch) => store.set({ ccirEditor: { ...ed(), ...patch } });

  // Wczytuje listę z serwera (brak API albo błąd = pusta lista, aplikacja działa dalej).
  async function fetchCcir() {
    try {
      const data = await api.ccir?.();
      return Array.isArray(data?.items) ? data.items : [];
    } catch {
      return S().ccir;
    }
  }

  function openCcirEditor() {
    store.set({ ccirEditor: { open: true, draft: S().ccir.map((i) => ({ ...i })), pick: null }, popover: null });
  }
  const closeCcirEditor = () => store.set({ ccirEditor: { open: false, draft: [], pick: null } });
  const toggleCcirEditor = () => (ed().open ? closeCcirEditor() : openCcirEditor());

  function ccirAdd(kind) {
    const r = addCcirItem(ed().draft, kind);
    if (r.error) return notify(r.error, true);
    setEditor({ draft: r.items });
    return r.items.at(-1).id;
  }
  const ccirEdit = (id, patch) => setEditor({ draft: updateCcirItem(ed().draft, id, patch) });
  function ccirRemove(id) {
    setEditor({ draft: removeCcirItem(ed().draft, id), pick: ed().pick?.id === id ? null : ed().pick });
  }

  function ccirPickStart(id, shape) {
    if (!CCIR_SHAPES[shape] || !ed().draft.some((i) => i.id === id)) return;
    setEditor({ pick: { id, shape } });
  }
  const ccirPickCancel = () => ed().pick && setEditor({ pick: null });
  function ccirSetGeometry(id, geometry) {
    setEditor({ draft: setCcirGeometry(ed().draft, id, geometry), pick: null });
  }

  // Zapisuje edytowaną listę (puste pozycje są pomijane). Zwraca zapisaną listę albo null.
  async function ccirSave() {
    const { items, dropped } = cleanCcirItems(ed().draft);
    try {
      const saved = await api.saveCcir(items);
      store.set({ ccir: saved.items, ccirEditor: { open: false, draft: [], pick: null } });
      notify(`CCIR zapisane (${saved.items.length})${dropped ? `, pominięto puste: ${dropped}` : ''}`);
      return saved.items;
    } catch (err) {
      notify('Nie zapisano CCIR: ' + err.message, true);
      return null;
    }
  }

  return { fetchCcir, openCcirEditor, closeCcirEditor, toggleCcirEditor, ccirAdd, ccirEdit, ccirRemove, ccirPickStart, ccirPickCancel, ccirSetGeometry, ccirSave };
}

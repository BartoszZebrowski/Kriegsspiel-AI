// Podkontroler sztabu (T28.1): panel „Odprawa sztabu” (zamknij / przywołaj, stan w localStorage przez storage),
// otwarcie kanału postaci z karty oraz widoki według komórki sztabu (S2/S3/S4/ogień). Bez DOM.
import { closeStaff, openStaff, emptyStaffUi, sanitizeClosed, STAFF_ROLE_INFO } from '../domain/staff.js';
import { toggleStaffView, restoreStaffView, staffViewById } from '../domain/staffviews.js';

export function createStaff({ store, storage, S, keyOf, notify, openChannel }) {
  const closedKey = () => keyOf('staff-closed');

  // Stan początkowy panelu: zamknięte tury z zapisu (id scenariusza znane dopiero po init).
  const loadStaffUi = (scenarioId) => ({ ...emptyStaffUi(), closed: sanitizeClosed(storage.load(`ks:${scenarioId}:staff-closed`, [])) });

  function setStaffUi(staffUi) {
    store.set({ staffUi });
    storage.save(closedKey(), staffUi.closed);
  }
  const closeStaffPanel = () => setStaffUi(closeStaff(S().staffUi, S().viewTurn, S().archive));
  const openStaffPanel = () => S().staff.length && setStaffUi(openStaff(S().staffUi, S().viewTurn, S().archive));
  const toggleStaffPanel = () => (S().staffOpen ? closeStaffPanel() : openStaffPanel());

  // Klik w kartę: kanał postaci (S2 → s2, S4 → logistyka); S3 bez własnego kanału tylko informuje.
  function openStaffChannel(role) {
    const card = S().staff.find((c) => c.role === role);
    if (!card?.channel) {
      notify(`${STAFF_ROLE_INFO[role]?.badge ?? role} nie ma osobnego kanału łączności`, true);
      return false;
    }
    openChannel(card.channel);
    return true;
  }

  // Widok komórki sztabu: jedno `set`; ponowny klik w aktywny preset (albo id = null) przywraca ustawienia gracza.
  function setStaffView(id) {
    const state = { layers: S().layers, popover: S().popover, staffView: S().staffView };
    const patch = id === null ? restoreStaffView(state) : staffViewById(id) && toggleStaffView(state, id);
    if (patch) store.set(patch);
    return Boolean(patch);
  }

  return { loadStaffUi, closeStaffPanel, openStaffPanel, toggleStaffPanel, openStaffChannel, setStaffView };
}

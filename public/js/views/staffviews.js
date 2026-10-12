// Widok: przełącznik „Widok sztabu” na mapie (T28.1, WA6) — S2 / S3 / S4 / Ogień jednym kliknięciem; „Moje” przywraca
// ustawienia gracza. Tylko tłumaczy klik na intencję kontrolera (`setStaffView`); wygląd z `store.staffView`.
import { STAFF_VIEWS } from '../domain/staffviews.js';
import { escapeHtml as e } from '../domain/markdown.js';

export function createStaffViewsView({ store, controller, root = document }) {
  const seg = root.getElementById('seg-staff');
  seg.innerHTML =
    STAFF_VIEWS.map((v) => `<button type="button" data-sv="${e(v.id)}" data-tip="${e(v.title)}" data-k="Shift ${e(v.code.slice(-1))}" aria-pressed="false">${e(v.label)}</button>`).join('') +
    '<button type="button" data-sv="" data-tip="Wróć do moich ustawień warstw i paneli" data-k="Shift 0">Moje</button>';

  seg.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-sv]');
    if (b) controller.setStaffView(b.dataset.sv || null);
  });

  function render({ staffView }) {
    for (const b of seg.querySelectorAll('button')) {
      const on = b.dataset.sv ? staffView.active === b.dataset.sv : staffView.active === null;
      b.classList.toggle('on', on);
      if (b.dataset.sv) b.setAttribute('aria-pressed', String(on));
    }
  }
  store.subscribe('staffView', render, { immediate: true });
}

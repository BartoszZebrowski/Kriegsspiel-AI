// Widok: komunikaty przejściowe (toast, prawy dolny róg mapy). Czyta store.notice; przycisk „Czytaj”
// (komunikat z kanałem) otwiera rozmowę przez kontroler. Historia komunikatów trafia do dzwonka w pasku górnym.
import { escapeHtml as e } from '../domain/markdown.js';

const LIFETIME = 9000;
const MAX_VISIBLE = 4;

export function createToastsView({ store, controller = null, root = document }) {
  const host = root.getElementById('toasts');
  store.subscribe('notice', ({ notice }) => {
    if (!notice) return;
    const el = document.createElement('div');
    el.className = 'toast' + (notice.urgent ? ' urg' : '') + (notice.error ? ' err' : '');
    el.setAttribute('role', notice.error ? 'alert' : 'status');
    const title = notice.title || (notice.error ? 'Błąd' : 'Komunikat');
    el.innerHTML = `<b>${e(title)}</b><p>${e(notice.text)}</p>${notice.channel && controller ? '<button type="button" class="btn sm act">Czytaj</button>' : ''}`;
    el.querySelector('.act')?.addEventListener('click', () => {
      controller.openChannel(notice.channel);
      el.remove();
    });
    host.append(el);
    while (host.children.length > MAX_VISIBLE) host.firstElementChild.remove();
    setTimeout(() => el.remove(), notice.error ? LIFETIME : LIFETIME - 2000);
  });
}

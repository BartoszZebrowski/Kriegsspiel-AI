// Rozkazy graficzne (T44) w szkicu wiadomości: chip załącznika z podglądem na mapie i usunięciem (HTML bez DOM).
import { escapeHtml as e } from '../../domain/markdown.js';
import { taskInfo } from '../../domain/order.js';
import { ic } from '../../lib/icons.js';

// Chipy załączników strukturalnych szkicu kanału: nazwa pokazuje je na mapie, ✕ usuwa z wiadomości.
export function orderChipsHtml(orders = []) {
  return orders
    .map(
      (o) =>
        `<span class="att att--sel att--order" title="${e(taskInfo(o.task)?.name ?? 'Rozkaz graficzny')} — jednostki: ${e(o.units.join(', '))}">${ic('flag', 's')}<a role="button" tabindex="0" data-order-show="${e(o.id)}">${e(o.name)}</a><a role="button" tabindex="0" data-order-del="${e(o.id)}" aria-label="Usuń rozkaz graficzny z wiadomości">${ic('x', 's')}</a></span>`,
    )
    .join('');
}

// Etykieta rodzaju załącznika w wątku: rozkaz graficzny albo szkic.
export const attachmentKindLabel = (a) => (a.kind === 'order' ? 'rozkaz graficzny' : a.kind || 'szkic');

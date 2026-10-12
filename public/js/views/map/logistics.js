// Warstwa logistyczna mapy (T17): trasy w kolorze statusu, składy i konwoje jako symbole NATO (zaopatrzenie / transport), mosty jako ikona.
// Rysuje do grupy przekazanej przez widok mapy; znaczniki rejestruje we wspólnej mapie `markers` (zaznaczenie, animacje).
/* global L */
import { symbolIcon } from '../../lib/symbols.js';
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng } from '../../domain/geo.js';
import { logisticsElements, logisticsCard, routeColor, dataAge, LG_SIDC } from '../../domain/logistics.js';

const BRIDGE_COLORS = { intact: '#43b581', damaged: '#e8b339', destroyed: '#ef4444' };

export function createLogisticsLayer({ group, markers, scenario, controller, onAdd }) {
  const routeLines = new Map(); // id trasy logistycznej -> L.Polyline (zaznaczenie zmienia grubość)

  function render(turn) {
    const ctx = { turnTime: turn.time, turnMinutes: scenario.turnMinutes, tz: scenario.timezone };
    for (const { kind, item } of logisticsElements(turn)) {
      const card = logisticsCard(kind, item, ctx);
      const tip = `<strong>${escapeHtml(card.title)}</strong><br>${escapeHtml(card.kindLabel)} · ${escapeHtml(card.statusLabel)}${card.stale ? '<br><span class="sym-tip__brief">dane nieaktualne</span>' : ''}`;
      let layer;
      if (kind === 'route') {
        if (!Array.isArray(item.coords)) continue;
        const latlngs = item.coords.map(toLatLng);
        group.addLayer(L.polyline(latlngs, { color: 'rgba(0,0,0,.55)', weight: 8, opacity: 1, interactive: false }));
        layer = L.polyline(latlngs, { color: routeColor(item.status), weight: 4, opacity: 0.95, dashArray: item.kind === 'ASR' ? '10 6' : null, className: 'lg-route' });
        routeLines.set(item.id, layer);
        layer.bindTooltip(`${tip}`, { className: 'sym-tip', sticky: true });
      } else {
        if (!Array.isArray(item.pos)) continue;
        const icon =
          kind === 'bridge'
            ? L.divIcon({ className: 'ms-icon lg-bridge', html: `<svg viewBox="0 0 24 24" width="24" height="24"><rect x="1" y="1" width="22" height="22" rx="4" fill="#161b22" stroke="${BRIDGE_COLORS[item.status] || '#9aa5b1'}" stroke-width="2"/><path d="M4 15h16M6 15v-4a6 6 0 0 1 12 0v4M12 9v6" fill="none" stroke="${BRIDGE_COLORS[item.status] || '#9aa5b1'}" stroke-width="1.6"/></svg>`, iconSize: [24, 24], iconAnchor: [12, 12] })
            : symbolIcon(LG_SIDC[kind], { size: 24 });
        const dim = item.status === 'destroyed' || dataAge(item.as_of, turn.time, scenario.turnMinutes).stale;
        layer = L.marker(toLatLng(item.pos), { icon, keyboard: false, opacity: dim ? 0.6 : 1, zIndexOffset: 50 });
        markers.set(item.id, layer);
        layer.on('add', onAdd);
        layer.bindTooltip(tip, { className: 'sym-tip', direction: 'top', offset: [0, -12] });
      }
      layer.on('click', () => controller.selectEntity(item.id, { pan: false }));
      group.addLayer(layer);
    }
  }

  // Zaznaczona trasa jest grubsza i dostaje klasę `is-selected`.
  function applySelection(id) {
    for (const [rid, line] of routeLines) {
      line.setStyle({ weight: rid === id ? 6 : 4 });
      line.getElement?.()?.classList.toggle('is-selected', rid === id);
    }
  }

  // Grupę czyści widok mapy (clearLayers); tu tylko rejestr tras.
  const clear = () => routeLines.clear();

  return { render, applySelection, clear };
}

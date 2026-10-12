// Warstwa „Ogień” (T52): zgłoszone i wykonane zadania ogniowe jako znaczniki z czasem i statusem.
// Dane z wiadomości (outbox: formularz „fire”, inbox: pole `fire`); skutek ognia nigdy nie jest tu pokazywany.
// Własna L.layerGroup, widoczność przełącznikiem `layers.fires`. Subskrybuje store, nie zna innych widoków.
/* global L */
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng } from '../../domain/geo.js';
import { fireTasks, fireAnchor, fireLabel, fireStatusText, fireDescription, FIRE_STATUS_COLORS } from '../../domain/fires.js';

export function createFiresLayer({ store, map }) {
  const group = L.layerGroup().addTo(map);
  const S = () => store.get();

  function render() {
    group.clearLayers();
    const { layers, messages, scenario } = S();
    if (layers.fires === false) return;
    const tz = scenario?.timezone;
    for (const task of fireTasks(messages)) {
      const anchor = fireAnchor(task.target);
      if (!anchor) continue;
      const color = FIRE_STATUS_COLORS[task.status];
      const tip = `<strong>Ogień: ${escapeHtml(fireLabel(task, tz))}</strong><br>${escapeHtml(fireDescription(task))}<br>${escapeHtml(fireStatusText(task, tz))}`;
      if (task.target.type === 'Polygon') {
        group.addLayer(L.polygon(task.target.coordinates.map((ring) => ring.map(toLatLng)), { color, weight: 2, dashArray: '2 6', fillColor: color, fillOpacity: 0.1, interactive: false }));
      }
      const icon = L.divIcon({
        className: 'fire-mark',
        html: `<span class="fire-mark__dot" style="--fc:${color}"></span><span class="fire-mark__lbl">${escapeHtml(fireLabel(task, tz))}</span>`,
        iconSize: [0, 0],
      });
      group.addLayer(L.marker(toLatLng(anchor), { icon, keyboard: false }).bindTooltip(tip, { className: 'sym-tip', direction: 'top' }));
    }
  }

  store.subscribe(['messages', 'layers', 'scenario'], render, { immediate: true });
  return { group, render };
}

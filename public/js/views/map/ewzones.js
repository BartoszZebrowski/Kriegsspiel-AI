// Warstwa stref REW na mapie (T26): półprzezroczysty wielokąt z etykietą i wiekiem meldunku.
// Własna L.layerGroup, widoczność razem z warstwą „lines”. Subskrybuje store, nie zna innych widoków.
/* global L */
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng } from '../../domain/geo.js';
import { ewZones, ewZoneLabel, EW_ZONE_KIND } from '../../domain/ewzones.js';

const STYLE = { color: '#a855f7', weight: 2, dashArray: '4 4', fillColor: '#a855f7', fillOpacity: 0.16 };

export function createEwZonesLayer({ store, map }) {
  const group = L.layerGroup().addTo(map);
  const S = () => store.get();

  function render() {
    group.clearLayers();
    if (S().layers.lines === false) return;
    const turn = S().turn;
    for (const z of ewZones(turn?.lines, turn?.time)) {
      const poly = L.polygon(z.coords.map(toLatLng), STYLE);
      poly.bindTooltip(escapeHtml(ewZoneLabel(z)), { permanent: true, direction: 'center', className: 'line-label' });
      group.addLayer(poly);
    }
  }

  store.subscribe(['turn', 'layers'], render, { immediate: true });
  return { group, render, kind: EW_ZONE_KIND };
}

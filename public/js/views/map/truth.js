// Warstwa „Prawda” na mapie (T29): jednostki przeciwnika na prawdziwych pozycjach z umpire/turns (tylko po bitwie).
// Własna L.layerGroup; wiedza gracza (kontakty) zostaje na swojej warstwie, więc widać rozbieżność. Subskrybuje store.
/* global L */
import { symbolIcon } from '../../lib/symbols.js';
import { describeSidc } from '../../domain/sidc.js';
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng } from '../../domain/geo.js';
import { enemyTruth, truthLabel } from '../../domain/afterbattle.js';

export function createTruthLayer({ store, map }) {
  const group = L.layerGroup().addTo(map);
  const S = () => store.get();

  function render() {
    group.clearLayers();
    const { layers, truth, viewTurn, scenario } = S();
    if (!layers.truth || truth.turn !== viewTurn) return;
    for (const u of enemyTruth(truth.data, scenario?.side)) {
      const marker = L.marker(toLatLng(u.pos), { icon: symbolIcon(u.sidc, { size: 28 }), keyboard: false, zIndexOffset: 200 });
      marker.bindTooltip(`<strong>PRAWDA: ${escapeHtml(truthLabel(u))}</strong><br>${escapeHtml(describeSidc(u.sidc))}`, { className: 'sym-tip', direction: 'top', offset: [0, -12] });
      group.addLayer(marker);
      group.addLayer(L.circleMarker(toLatLng(u.pos), { radius: 22, color: '#f97316', weight: 2, dashArray: '3 4', fill: false, interactive: false }));
    }
  }

  store.subscribe(['truth', 'layers', 'viewTurn'], render, { immediate: true });
  return { group, render };
}

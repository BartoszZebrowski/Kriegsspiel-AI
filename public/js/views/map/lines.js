// Warstwa linii na mapie: granice, FLOT, rubieże, kierunki działania.
/* global L */
import { escapeHtml } from '../../domain/markdown.js';
import { toLatLng } from '../../domain/geo.js';

const LINE_STYLES = {
  boundary: { color: '#111', weight: 3, opacity: 0.9 },
  flot: { color: '#3b82f6', weight: 3, dashArray: '2 8', lineCap: 'round' },
  enemy_flot: { color: '#ef4444', weight: 3, dashArray: '2 8', lineCap: 'round' },
  phase: { color: '#111', weight: 2, dashArray: '10 6' },
  axis: { color: '#3b82f6', weight: 2, dashArray: '6 6' },
  enemy_axis: { color: '#ef4444', weight: 2, dashArray: '6 6' },
};

const LINE_NAMES = {
  boundary: 'granica pasa',
  flot: 'linia styczności (wojska własne)',
  enemy_flot: 'linia styczności (przeciwnik)',
  phase: 'rubież',
  axis: 'kierunek działania',
  enemy_axis: 'kierunek działania przeciwnika',
};

// Rysuje linie tury w grupie warstw (poprzednia zawartość grupy jest czyszczona przez wołającego).
export function renderLines(group, lines) {
  for (const line of lines || []) {
    if (line.kind === 'ew_zone') continue; // strefy REW rysuje ewzones.js (własna warstwa)
    const style = LINE_STYLES[line.kind] || LINE_STYLES.phase;
    const latlngs = line.coords.map(toLatLng);
    // Obwódka: jasna pod czarnymi liniami, ciemna pod kolorowymi — czytelne na każdym podkładzie.
    const halo = style.color === '#111' ? 'rgba(255,255,255,.75)' : 'rgba(0,0,0,.55)';
    group.addLayer(L.polyline(latlngs, { color: halo, weight: style.weight + 3, opacity: 1, interactive: false }));
    const pl = L.polyline(latlngs, style);
    const label = line.label || LINE_NAMES[line.kind] || '';
    if (label) pl.bindTooltip(escapeHtml(label), { permanent: true, direction: 'center', className: 'line-label' });
    group.addLayer(pl);
  }
}

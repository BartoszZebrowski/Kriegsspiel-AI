// Szkice gracza — stałe, nazwy i podgląd znaku (bez DOM-u mapy). Używają ich widok szkiców, okno edycji i warstwy kształtów.
import { escapeHtml } from '../../domain/markdown.js';
import { buildGraphic, mainStyle, pointIconSvg } from '../../domain/tactical.js';

export const COLORS = { blue: '#2f7bff', red: '#ff2a2a', black: '#111111' };
export const COLOR_NAMES = { blue: 'własne', red: 'przeciwnik', black: 'ogólne' };
export const KIND_NAMES = { arrow: 'Oś / kierunek', line: 'Linia', area: 'Rejon', point: 'Punkt', symbol: 'Symbol (hipoteza)' };
// Rodzaj znaku dla rysunków sprzed T12.2 (bez pola graphic) — tak są pokazywane w oknie edycji.
export const LEGACY_GRAPHIC = { arrow: 'direction', line: 'line', area: 'generic', point: 'point' };
// Paleta narzędzi (pionowa szyna): id, ikona, nazwa, skrót klawiszowy. `extra` — chowane na telefonie.
export const TOOLS = [
  { id: 'select', icon: 'cursor', title: 'Wybieraj', key: 'V' },
  { sep: true },
  { id: 'arrow', icon: 'arrow', title: 'Strzałka — oś / kierunek natarcia', key: 'A' },
  { id: 'line', icon: 'line', title: 'Linia — rubież, granica, FLOT, zapory', key: 'L' },
  { id: 'area', icon: 'poly', title: 'Rejon (wielokąt) — AA, OBJ, EA, BP, pole minowe', key: 'R' },
  { id: 'point', icon: 'point', title: 'Punkt — CP, styczność, cel', key: 'P', extra: true },
  { id: 'symbol', icon: 'sym', title: 'Symbol (hipoteza) — własny symbol NATO', key: 'Y', extra: true },
  { id: 'gfx', icon: 'flag', title: 'Znaki taktyczne NATO', key: 'G', flyout: true },
  { sep: true },
  { id: 'measure', icon: 'ruler', title: 'Miarka — odległość i czas marszu', key: 'M' },
];
export const HINTS = {
  arrow: 'Oś / kierunek: klikaj kolejne punkty, dwuklik kończy. Esc — anuluj.',
  line: 'Linia: klikaj kolejne punkty, dwuklik kończy. Esc — anuluj.',
  area: 'Rejon: klikaj wierzchołki, kliknięcie pierwszego zamyka. Esc — anuluj.',
  point: 'Punkt: kliknij miejsce na mapie.',
  symbol: 'Symbol: kliknij miejsce na mapie, potem wybierz rodzaj.',
  measure: 'Miarka: klikaj punkty trasy, dwuklik lub Esc kończy.',
};
export const DEFAULT_NAMES = { arrow: 'Kierunek', line: 'Linia', area: 'Rejon', point: 'Punkt', symbol: 'Hipoteza' };

export const uid = () => 'n-' + Math.random().toString(36).slice(2, 10);

// SIDC hipotezy: status „A” (przewidywany) daje ramkę przerywaną.
export function hypothesisSidc(affiliation, fnKey, echelon) {
  const [dim, code] = fnKey.split(':');
  const fn = code.padEnd(6, '-');
  return `S${affiliation}${dim}A${fn}-${dim === 'G' ? echelon || '-' : '-'}---`;
}

// Podgląd znaku w oknie edycji: ten sam opis co na mapie (buildGraphic), narysowany jako SVG na przykładowej ścieżce.
const SAMPLE = {
  arrow: [{ x: 14, y: 46 }, { x: 80, y: 34 }, { x: 118, y: 36 }, { x: 176, y: 16 }],
  line: [{ x: 14, y: 44 }, { x: 70, y: 22 }, { x: 120, y: 38 }, { x: 176, y: 18 }],
  area: [{ x: 36, y: 50 }, { x: 28, y: 22 }, { x: 90, y: 10 }, { x: 150, y: 18 }, { x: 160, y: 48 }],
};
export function graphicPreviewSvg(kind, graphic, colorKey, opts = {}) {
  const W = 190;
  const H = 64;
  const color = COLORS[colorKey] || COLORS.black;
  const enemy = colorKey === 'red';
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${inner}</svg>`;
  if (kind === 'point') {
    const icon = pointIconSvg(graphic, color).replace('<svg ', `<svg x="${W / 2 - 14}" y="${H / 2 - 14}" `);
    return svg(icon);
  }
  const pts = SAMPLE[kind];
  const d = (arr, close) => 'M' + arr.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L') + (close ? 'Z' : '');
  const built = buildGraphic(kind, graphic, pts, { enemy, flip: opts.flip, echelon: opts.echelon, name: opts.name || '' });
  const st = mainStyle(kind, graphic, enemy);
  let out = '';
  if (kind === 'area') out += `<path d="${d(pts, true)}" fill="${color}" fill-opacity=".14" stroke="${color}" stroke-width="${st.weight}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`;
  else if (!st.hidden) out += `<path d="${d(pts)}" fill="none" stroke="${color}" stroke-width="${st.weight}" ${st.dash ? `stroke-dasharray="${st.dash}"` : ''}/>`;
  for (const s of built.shapes) {
    const path = s.parts.map((p) => d(p, s.closed || s.role === 'fill')).join('');
    if (s.role === 'fill') out += `<path d="${path}" fill="${color}" fill-opacity="${s.fillOpacity}"/>`;
    else out += `<path d="${path}" fill="${s.solid ? color : 'none'}" stroke="${color}" stroke-width="${s.weight}" stroke-linejoin="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
  }
  for (const lb of built.labels) {
    const dy = lb.anchor === 'above' ? -8 : lb.anchor === 'below' ? 14 : 4;
    const lines = lb.text.split(/\n/);
    const tsp = lines.map((t, i) => `<tspan x="${lb.x.toFixed(1)}" dy="${i === 0 ? dy - (lines.length - 1) * 6 : 12}">${escapeHtml(t)}</tspan>`).join('');
    out += `<text x="${lb.x.toFixed(1)}" y="${lb.y.toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" font-family="Segoe UI,Arial,sans-serif" fill="${color}" stroke="#fff" stroke-width="2.5" paint-order="stroke" transform="rotate(${lb.angle} ${lb.x.toFixed(1)} ${lb.y.toFixed(1)})">${tsp}</text>`;
  }
  return svg(out);
}

// Liczba rysunków danego rodzaju i znaku (do automatycznych nazw).
export const countOf = (items, kind, graphic) => items.filter((i) => i.kind === kind && (i.graphic || LEGACY_GRAPHIC[kind]) === graphic).length;

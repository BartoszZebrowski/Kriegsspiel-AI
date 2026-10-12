// Znaki taktyczne NATO (APP-6 / MIL-STD-2525, środki kontroli): opis znaków i czysta geometria w pikselach.
// Punkty to obiekty { x, y }. Dodatni offset = lewa strona kierunku rysowania (na ekranie, oś y w dół).
import { arrowHead } from './geo.js';
import { dedupe, polylineLength, pointAtLength, midpoint, leftNormal, perpendicularAt, scallops, triangles, axisShape, readableAngle, alongPositions } from './tactical-geometry.js';

// Geometria pikselowa żyje w osobnym module; ten plik zachowuje ją w swoim publicznym API.
export * from './tactical-geometry.js';

// Rodzaje znaków dla każdej geometrii (kind). Lista musi się zgadzać z NOTE_GRAPHICS w server/store.js.
export const GRAPHICS = {
  arrow: [
    { id: 'axis_main', name: 'Oś natarcia głównego', auto: 'Oś gł.', hint: 'szeroka strzałka z wypełnieniem' },
    { id: 'axis_support', name: 'Oś natarcia pomocniczego', auto: 'Oś pom.', hint: 'szeroka strzałka, sam obrys' },
    { id: 'axis_catk', name: 'Oś przeciwuderzenia (CATK)', auto: 'CATK', hint: 'szeroka strzałka przerywana' },
    { id: 'direction', name: 'Kierunek działania', auto: 'Kierunek', hint: 'linia z otwartym grotem' },
  ],
  line: [
    { id: 'phase_line', name: 'Rubież (linia fazowa)', auto: 'ALFA', hint: 'etykieta „PL …” na końcach' },
    { id: 'boundary', name: 'Granica', auto: 'Granica', hint: 'oznaczenie szczebla pośrodku' },
    { id: 'flot', name: 'Linia styczności wojsk (FLOT)', auto: 'FLOT', hint: 'półkola ku przeciwnikowi' },
    { id: 'obstacle_line', name: 'Linia zapór', auto: 'Zapory', hint: 'trójkąty wzdłuż linii' },
    { id: 'line', name: 'Zwykła linia', auto: 'Linia', hint: 'linia z nazwą' },
  ],
  area: [
    { id: 'generic', name: 'Rejon', code: '', auto: 'Rejon' },
    { id: 'assembly', name: 'Rejon ześrodkowania (AA)', code: 'AA', auto: 'Rejon' },
    { id: 'objective', name: 'Cel (OBJ)', code: 'OBJ', auto: 'Cel' },
    { id: 'engagement', name: 'Rejon ogniowy (EA)', code: 'EA', auto: 'Rejon' },
    { id: 'battle_position', name: 'Pozycja obronna (BP)', code: 'BP', auto: 'Pozycja' },
    { id: 'minefield', name: 'Pole minowe', code: 'Pole minowe', auto: 'Pole' },
  ],
  point: [
    { id: 'checkpoint', name: 'Punkt kontrolny (CP)', auto: 'CP' },
    { id: 'contact_point', name: 'Punkt styczności', auto: 'Styczność' },
    { id: 'target', name: 'Cel artyleryjski', auto: 'Cel' },
    { id: 'point', name: 'Zwykły punkt', auto: 'Punkt' },
  ],
  symbol: [],
};

export const defaultGraphic = (kind) => ({ arrow: 'axis_main', line: 'phase_line', area: 'generic', point: 'checkpoint' })[kind];
export const graphicInfo = (kind, id) => GRAPHICS[kind]?.find((g) => g.id === id);

// Oznaczenia szczebla na granicy (kody jak w SIDC: D pluton … J korpus).
export const ECHELON_MARKS = { D: '•••', E: 'I', F: 'II', G: 'III', H: 'X', I: 'XX', J: 'XXX' };

const NATO_ALPHABET = ['ALFA', 'BRAVO', 'CHARLIE', 'DELTA', 'ECHO', 'FOXTROT', 'GOLF', 'HOTEL', 'INDIA', 'JULIET', 'KILO', 'LIMA'];

// Domyślna nazwa nowego znaku; n — numer kolejny znaków tego rodzaju.
export function autoName(kind, graphic, color, n) {
  if (graphic === 'flot') return color === 'red' ? 'ENY FLOT' : 'FLOT';
  if (graphic === 'axis_catk') return 'CATK';
  if (graphic === 'phase_line') return NATO_ALPHABET[(n - 1) % NATO_ALPHABET.length];
  if (kind === 'area') return `${graphicInfo('area', graphic)?.auto || 'Rejon'} ${String.fromCharCode(64 + Math.min(n, 26))}`;
  if (kind === 'symbol') return `Hipoteza ${n}`;
  return `${graphicInfo(kind, graphic)?.auto || 'Znak'} ${n}`;
}

// ---------- Opis rysunku znaku (bez Leafleta) ----------
// shapes: { role: 'stroke' | 'fill', parts: [[pt…]…], closed, weight, dash, fillOpacity, solid }
// labels: { x, y, text, angle, anchor: 'center' | 'above' | 'below', cls }
const DASH = '9 7';
const AREA_STYLE = {
  generic: { weight: 2.5 },
  assembly: { weight: 2.5 },
  objective: { weight: 3.5 },
  engagement: { weight: 2.5 },
  battle_position: { weight: 3.5 },
  minefield: { weight: 2.5 },
};

// Styl głównej (edytowalnej) linii: ukryta (tylko obszar kliknięcia), gdy znak rysują dekoracje.
export function mainStyle(kind, graphic, enemy) {
  const dash = enemy ? DASH : undefined;
  if (kind === 'area') return { weight: AREA_STYLE[graphic]?.weight ?? 2.5, dash: enemy && graphic !== 'minefield' ? DASH : undefined };
  switch (graphic) {
    case 'axis_main':
    case 'axis_support':
    case 'axis_catk':
    case 'flot':
      return { weight: 16, hidden: true };
    case 'direction':
      return { weight: 3.5, dash };
    case 'phase_line':
      return { weight: 3, dash };
    case 'boundary':
      return { weight: 2.5, dash };
    case 'obstacle_line':
      return { weight: 2.5, dash };
    default:
      return { weight: 3.5, dash };
  }
}

export function buildGraphic(kind, graphic, pts, { enemy = false, flip = false, echelon, name = '' } = {}) {
  const shapes = [];
  const labels = [];
  let tip = null;
  const dash = enemy ? DASH : undefined;
  const side = flip ? 1 : -1; // −1: prawa strona kierunku rysowania (ku przeciwnikowi)
  const clean = dedupe(pts);
  const total = polylineLength(clean);
  if (clean.length < 2 || total < 2) return { shapes, labels, tip };
  const mid = midpoint(clean);

  if (kind === 'area') {
    const ring = clean;
    const cx = ring.reduce((s, q) => s + q.x, 0) / ring.length;
    const cy = ring.reduce((s, q) => s + q.y, 0) / ring.length;
    const info = graphicInfo('area', graphic);
    const code = info?.code || '';
    const text = code && (graphic === 'minefield' || !name.toUpperCase().startsWith(code.toUpperCase())) ? `${code}\n${name}` : name;
    labels.push({ x: cx, y: cy, text, angle: 0, anchor: 'center', cls: 'area' });
    if (graphic === 'minefield') {
      const closed = [...ring, ring[0]];
      for (const s of alongPositions(closed, 70)) {
        const q = pointAtLength(closed, s);
        labels.push({ x: q.x, y: q.y, text: 'M', angle: 0, anchor: 'center', cls: 'mark' });
      }
    }
    return { shapes, labels, tip };
  }

  const ang = (a) => readableAngle(a);
  switch (graphic) {
    case 'axis_main':
    case 'axis_support':
    case 'axis_catk': {
      const w = graphic === 'axis_main' ? 24 : 20;
      const ax = axisShape(clean, w, 26, w + 16);
      tip = ax.tip;
      const catk = graphic === 'axis_catk';
      if (graphic === 'axis_main') shapes.push({ role: 'fill', parts: [ax.outline], fillOpacity: 0.3 });
      shapes.push({ role: 'stroke', parts: [ax.outline], closed: false, weight: graphic === 'axis_main' ? 3.5 : 2.5, dash: catk ? '9 6' : dash });
      const q = pointAtLength(clean, Math.max(0, (total - 26) / 2));
      labels.push({ x: q.x, y: q.y, text: name, angle: ang(q.angle), anchor: 'center', cls: 'inline' });
      break;
    }
    case 'direction': {
      const from = pointAtLength(clean, Math.max(0, total - 18));
      const to = clean.at(-1);
      tip = to;
      shapes.push({ role: 'stroke', parts: [arrowHead(from, to, 18, 16)], closed: false, weight: 3.5, dash: undefined });
      labels.push({ x: mid.x, y: mid.y, text: name, angle: 0, anchor: 'above', cls: 'name' });
      break;
    }
    case 'phase_line': {
      const text = /^PL\s/i.test(name) ? name : `PL ${name}`;
      for (const q of [clean[0], clean.at(-1)]) labels.push({ x: q.x, y: q.y, text, angle: 0, anchor: 'above', cls: 'name' });
      break;
    }
    case 'boundary': {
      const mark = ECHELON_MARKS[echelon];
      if (mark) labels.push({ x: mid.x, y: mid.y, text: mark, angle: 0, anchor: 'center', cls: 'echelon' });
      const [side1] = perpendicularAt(clean, total / 2, mark ? 17 : 12);
      labels.push({ x: side1.x, y: side1.y, text: name, angle: 0, anchor: 'center', cls: 'name' });
      break;
    }
    case 'flot': {
      shapes.push({ role: 'stroke', parts: scallops(clean, 9, side), closed: false, weight: 3.5, dash: undefined });
      for (const s of alongPositions(clean, 320)) {
        const q = pointAtLength(clean, s);
        const n = leftNormal(q.angle);
        labels.push({ x: q.x - n.x * side * 16, y: q.y - n.y * side * 16, text: name, angle: ang(q.angle), anchor: 'center', cls: 'inline' });
      }
      break;
    }
    case 'obstacle_line': {
      shapes.push({ role: 'stroke', parts: triangles(clean, 22, 9, 10, side).map((t) => [...t, t[0]]), closed: true, weight: 2, solid: true });
      labels.push({ x: mid.x, y: mid.y, text: name, angle: 0, anchor: 'above', cls: 'name' });
      break;
    }
    default:
      labels.push({ x: mid.x, y: mid.y, text: name, angle: 0, anchor: 'above', cls: 'name' });
  }
  return { shapes, labels, tip };
}

// Ikona punktu jako SVG (28×28) — znacznik na mapie i podgląd w oknie.
export function pointIconSvg(graphic, color) {
  const c = color;
  const ring = (r, w, fill = '#fff') => `<circle cx="14" cy="14" r="${r}" fill="${fill}" fill-opacity=".85" stroke="${c}" stroke-width="${w}"/>`;
  const text = (t) => `<text x="14" y="17.5" text-anchor="middle" font-size="10" font-weight="700" font-family="Segoe UI,Arial,sans-serif" fill="${c}">${t}</text>`;
  let body;
  switch (graphic) {
    case 'checkpoint':
      body = ring(11.5, 2.5) + text('CP');
      break;
    case 'contact_point':
      body = ring(12, 2.5) + `<circle cx="14" cy="14" r="8" fill="none" stroke="${c}" stroke-width="1.5"/>` + text('C');
      break;
    case 'target':
      body = ring(10, 2, 'none') + `<path d="M4 4L24 24M24 4L4 24" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`;
      break;
    default:
      body = `<circle cx="14" cy="14" r="6.5" fill="${c}" stroke="#fff" stroke-width="2"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">${body}</svg>`;
}

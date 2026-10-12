// Geometria znaków taktycznych w pikselach (czyste funkcje na łamanych): długość, punkt na łamanej, równoległe, półkola, trójkąty, strzałka.
// Punkty to obiekty { x, y }. Dodatni offset = lewa strona kierunku rysowania (na ekranie, oś y w dół).

const EPS = 1e-9;
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);

export function dedupe(pts) {
  const out = [];
  for (const p of pts) if (!out.length || dist(out.at(-1), p) > EPS) out.push({ x: p.x, y: p.y });
  return out;
}

export function polylineLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

// Punkt w odległości s od początku łamanej + kąt stycznej (rad) i indeks odcinka.
export function pointAtLength(pts, s) {
  const p = dedupe(pts);
  if (p.length === 0) return { x: 0, y: 0, angle: 0, i: 0 };
  if (p.length === 1) return { ...p[0], angle: 0, i: 0 };
  let rest = Math.max(0, Math.min(s, polylineLength(p)));
  for (let i = 1; i < p.length; i++) {
    const len = dist(p[i - 1], p[i]);
    if (rest <= len || i === p.length - 1) {
      const t = len ? Math.min(1, rest / len) : 0;
      return {
        x: p[i - 1].x + (p[i].x - p[i - 1].x) * t,
        y: p[i - 1].y + (p[i].y - p[i - 1].y) * t,
        angle: Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x),
        i: i - 1,
      };
    }
    rest -= len;
  }
}

export const midpoint = (pts) => pointAtLength(pts, polylineLength(pts) / 2);

// Lewa normalna (na ekranie) jednostkowego wektora stycznego o kącie a.
export const leftNormal = (a) => ({ x: Math.sin(a), y: -Math.cos(a) });

// Równoległa łamana przesunięta o d (d > 0 — w lewo); styki łączone ostrym narożem z limitem długości.
export function offsetPolyline(pts, d, miterLimit = 2.5) {
  const p = dedupe(pts);
  if (p.length < 2) return p;
  const normals = [];
  for (let i = 1; i < p.length; i++) normals.push(leftNormal(Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x)));
  const out = [{ x: p[0].x + normals[0].x * d, y: p[0].y + normals[0].y * d }];
  for (let i = 1; i < p.length - 1; i++) {
    const n1 = normals[i - 1];
    const n2 = normals[i];
    const mx = n1.x + n2.x;
    const my = n1.y + n2.y;
    const m2 = mx * mx + my * my;
    if (m2 < EPS) {
      out.push({ x: p[i].x + n1.x * d, y: p[i].y + n1.y * d });
      continue;
    }
    let vx = (d * 2 * mx) / m2;
    let vy = (d * 2 * my) / m2;
    const vl = Math.hypot(vx, vy);
    if (vl > Math.abs(d) * miterLimit) {
      vx *= (Math.abs(d) * miterLimit) / vl;
      vy *= (Math.abs(d) * miterLimit) / vl;
    }
    out.push({ x: p[i].x + vx, y: p[i].y + vy });
  }
  const last = p.at(-1);
  const nl = normals.at(-1);
  out.push({ x: last.x + nl.x * d, y: last.y + nl.y * d });
  return out;
}

// Początek łamanej do odległości `to` od początku.
export function sliceTo(pts, to) {
  const p = dedupe(pts);
  const out = [p[0]];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const len = dist(p[i - 1], p[i]);
    if (acc + len >= to - EPS) {
      out.push(pointAtLength(p, to));
      return dedupe(out);
    }
    acc += len;
    out.push(p[i]);
  }
  return out;
}

// Odcinek prostopadły do łamanej w odległości s, o połowie długości `half` na każdą stronę.
export function perpendicularAt(pts, s, half) {
  const q = pointAtLength(pts, s);
  const n = leftNormal(q.angle);
  return [
    { x: q.x + n.x * half, y: q.y + n.y * half },
    { x: q.x - n.x * half, y: q.y - n.y * half },
  ];
}

// Ciągłe półkola o średnicy ≈ 2·radius wzdłuż łamanej. side: 1 — lewa strona, −1 — prawa.
export function scallops(pts, radius, side = -1, steps = 10) {
  const total = polylineLength(pts);
  if (total < EPS) return [];
  const n = Math.max(1, Math.round(total / (2 * radius)));
  const step = total / n;
  const parts = [];
  for (let k = 0; k < n; k++) {
    const a = pointAtLength(pts, k * step);
    const b = pointAtLength(pts, (k + 1) * step);
    const cx = (a.x + b.x) / 2;
    const cy = (a.y + b.y) / 2;
    const chord = dist(a, b) || 1;
    const tx = (b.x - a.x) / chord;
    const ty = (b.y - a.y) / chord;
    const nx = ty * side;
    const ny = -tx * side;
    const half = chord / 2;
    const arc = [];
    for (let j = 0; j <= steps; j++) {
      const th = (Math.PI * j) / steps;
      arc.push({ x: cx - tx * half * Math.cos(th) + nx * half * Math.sin(th), y: cy - ty * half * Math.cos(th) + ny * half * Math.sin(th) });
    }
    parts.push(arc);
  }
  return parts;
}

// Trójkąty (podstawa na linii, wierzchołek o `height` w bok) rozmieszczone co ≈ spacing.
export function triangles(pts, spacing, base, height, side = -1) {
  const total = polylineLength(pts);
  if (total < base) return [];
  const n = Math.max(1, Math.floor(total / spacing));
  const parts = [];
  for (let k = 0; k < n; k++) {
    const s = ((k + 0.5) * total) / n;
    const a = pointAtLength(pts, Math.max(0, s - base / 2));
    const b = pointAtLength(pts, Math.min(total, s + base / 2));
    const c = pointAtLength(pts, s);
    const nrm = leftNormal(c.angle);
    parts.push([
      { x: a.x, y: a.y },
      { x: c.x + nrm.x * height * side, y: c.y + nrm.y * height * side },
      { x: b.x, y: b.y },
    ]);
  }
  return parts;
}

// Szeroka strzałka NATO: dwie równoległe linie podążające za ścieżką + grot.
// Zwraca obrys otwarty z tyłu (lewa krawędź → grot → prawa krawędź) i czubek.
export function axisShape(pts, width, headLen = 24, headWidth = width + 14) {
  const p = dedupe(pts);
  const total = polylineLength(p);
  if (p.length < 2 || total < EPS) return { outline: [], tip: p[0], base: p[0] };
  const hl = Math.min(headLen, total * 0.5);
  const body = sliceTo(p, total - hl);
  const base = body.at(-1);
  const tip = p.at(-1);
  const left = offsetPolyline(body, width / 2);
  const right = offsetPolyline(body, -width / 2);
  const ang = Math.atan2(tip.y - base.y, tip.x - base.x);
  const n = leftNormal(ang);
  const barbL = { x: base.x + n.x * headWidth / 2, y: base.y + n.y * headWidth / 2 };
  const barbR = { x: base.x - n.x * headWidth / 2, y: base.y - n.y * headWidth / 2 };
  return { outline: [...left, barbL, tip, barbR, ...right.reverse()], tip, base };
}

// Kąt tekstu czytelny (nie do góry nogami), w stopniach.
export function readableAngle(rad) {
  let deg = (rad * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  if (deg <= -90) deg += 180;
  return deg;
}

// Pozycje (odległości od początku) powtarzanych etykiet wzdłuż linii — co ≈ spacing, min. jedna.
export function alongPositions(pts, spacing) {
  const total = polylineLength(pts);
  const n = Math.max(1, Math.round(total / spacing));
  return Array.from({ length: n }, (_, i) => (total * (i + 0.5)) / n);
}

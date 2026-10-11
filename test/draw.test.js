import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPHICS,
  polylineLength,
  pointAtLength,
  midpoint,
  offsetPolyline,
  perpendicularAt,
  scallops,
  triangles,
  axisShape,
  readableAngle,
  alongPositions,
  buildGraphic,
  autoName,
  mainStyle,
} from '../public/js/domain/tactical.js';
import { NOTE_GRAPHICS } from '../server/store.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }];

describe('T12.2 — geometria znaków taktycznych', () => {
  test('długość łamanej i punkt w odległości s', () => {
    const p = [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 40 }];
    near(polylineLength(p), 70);
    const q = pointAtLength(p, 45);
    near(q.x, 30);
    near(q.y, 15);
    near(q.angle, Math.PI / 2);
  });

  test('środek łamanej wg długości', () => {
    const m = midpoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }]);
    near(m.x, 10);
    near(m.y, 10);
  });

  test('offset odcinka o d daje dwie linie w odległości d (lewa = w górę ekranu)', () => {
    const left = offsetPolyline(line, 10);
    const right = offsetPolyline(line, -10);
    near(left[0].y, -10);
    near(left[1].y, -10);
    near(right[0].y, 10);
    near(right[1].y, 10);
    near(left[1].x - left[0].x, 100);
  });

  test('offset łamanej z zakrętem: styk w narożu, równoległość zachowana', () => {
    const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    const o = offsetPolyline(p, 10);
    assert.equal(o.length, 3);
    near(o[1].x, 110);
    near(o[1].y, -10);
  });

  test('offset: ostry zakręt nie wystrzeliwuje poza limit styku', () => {
    const p = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 2 }];
    const o = offsetPolyline(p, 10);
    assert.ok(Math.hypot(o[1].x - 100, o[1].y) <= 10 * 2.5 + 1e-6);
  });

  test('prostopadła do linii w punkcie s', () => {
    const [a, b] = perpendicularAt(line, 50, 8);
    near(a.x, 50);
    near(b.x, 50);
    near(a.y, -8);
    near(b.y, 8);
  });

  test('półkola FLOT: ciągłe, o stałej średnicy, wybrzuszone na wybraną stronę', () => {
    const parts = scallops(line, 10, -1);
    assert.equal(parts.length, 5);
    for (const arc of parts) {
      // koniec jednego łuku = początek następnego, wszystkie punkty po tej samej stronie (y > 0 — prawa)
      assert.ok(arc.every((p) => p.y >= -1e-9));
      near(Math.hypot(arc[0].x - arc.at(-1).x, arc[0].y - arc.at(-1).y), 20);
    }
    for (let i = 1; i < parts.length; i++) near(parts[i][0].x, parts[i - 1].at(-1).x);
    const left = scallops(line, 10, 1);
    assert.ok(left[0].some((p) => p.y < -5));
  });

  test('trójkąty zapór: wysokość i liczba', () => {
    const tris = triangles(line, 25, 10, 8, -1);
    assert.equal(tris.length, 4);
    for (const t of tris) {
      near(t[1].y, 8);
      near(t[0].y, 0);
      near(t[2].x - t[0].x, 10);
    }
  });

  test('szeroka strzałka: obrys z dwóch równoległych krawędzi i grot na końcu ścieżki', () => {
    const ax = axisShape(line, 20, 25, 36);
    near(ax.tip.x, 100);
    near(ax.tip.y, 0);
    // lewa krawędź y = −10, prawa y = +10 (przed grotem)
    assert.ok(ax.outline.some((p) => Math.abs(p.y + 10) < 1e-6));
    assert.ok(ax.outline.some((p) => Math.abs(p.y - 10) < 1e-6));
    // skrzydełka grotu na ±18, w x = 75
    assert.ok(ax.outline.some((p) => Math.abs(p.x - 75) < 1e-6 && Math.abs(p.y + 18) < 1e-6));
    assert.ok(ax.outline.some((p) => Math.abs(p.x - 75) < 1e-6 && Math.abs(p.y - 18) < 1e-6));
  });

  test('czytelny kąt tekstu nie jest do góry nogami', () => {
    near(readableAngle(Math.PI), 0);
    near(readableAngle(Math.PI * 0.75), -45);
    near(readableAngle(0.2), (0.2 * 180) / Math.PI);
  });

  test('powtarzane etykiety wzdłuż linii: co ≈ spacing, zawsze co najmniej jedna', () => {
    assert.equal(alongPositions(line, 320).length, 1);
    assert.equal(alongPositions([{ x: 0, y: 0 }, { x: 1000, y: 0 }], 320).length, 3);
  });
});

describe('T12.2 — opis znaków (buildGraphic)', () => {
  const route = [{ x: 0, y: 100 }, { x: 150, y: 60 }, { x: 300, y: 80 }];
  test('rubież: „PL NAZWA” na obu końcach', () => {
    const b = buildGraphic('line', 'phase_line', route, { name: 'ALFA' });
    assert.deepEqual(b.labels.map((l) => l.text), ['PL ALFA', 'PL ALFA']);
    const again = buildGraphic('line', 'phase_line', route, { name: 'PL BRAVO' });
    assert.equal(again.labels[0].text, 'PL BRAVO');
  });
  test('granica: oznaczenie szczebla pośrodku', () => {
    const b = buildGraphic('line', 'boundary', route, { name: 'G1', echelon: 'H' });
    assert.ok(b.labels.some((l) => l.text === 'X' && l.cls === 'echelon'));
    assert.ok(!buildGraphic('line', 'boundary', route, { name: 'G1' }).labels.some((l) => l.cls === 'echelon'));
  });
  test('FLOT: półkola i etykieta wzdłuż linii', () => {
    const b = buildGraphic('line', 'flot', route, { name: 'ENY FLOT' });
    assert.ok(b.shapes[0].parts.length > 10);
    assert.equal(b.labels[0].text, 'ENY FLOT');
  });
  test('osie: główna z wypełnieniem, CATK przerywana, czubek = koniec ścieżki', () => {
    const main = buildGraphic('arrow', 'axis_main', route, { name: 'Oś' });
    assert.ok(main.shapes.some((s) => s.role === 'fill'));
    near(main.tip.x, 300);
    const catk = buildGraphic('arrow', 'axis_catk', route, { name: 'CATK' });
    assert.ok(catk.shapes.some((s) => s.dash));
    assert.ok(!buildGraphic('arrow', 'axis_support', route, { name: 'x' }).shapes.some((s) => s.dash));
    assert.ok(buildGraphic('arrow', 'axis_support', route, { name: 'x', enemy: true }).shapes.some((s) => s.dash));
  });
  test('rejon: kod i nazwa, pole minowe z oznaczeniami „M”', () => {
    const ring = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }];
    assert.equal(buildGraphic('area', 'assembly', ring, { name: 'Rejon A' }).labels[0].text, 'AA\nRejon A');
    assert.equal(buildGraphic('area', 'generic', ring, { name: 'Rejon A' }).labels[0].text, 'Rejon A');
    const mf = buildGraphic('area', 'minefield', ring, { name: 'PM 1' });
    assert.ok(mf.labels.filter((l) => l.text === 'M').length >= 4);
  });
  test('ukryta linia główna tylko dla osi i FLOT', () => {
    assert.ok(mainStyle('arrow', 'axis_main', false).hidden);
    assert.ok(mainStyle('line', 'flot', false).hidden);
    assert.ok(!mainStyle('line', 'boundary', false).hidden);
  });
  test('nazwy domyślne', () => {
    assert.equal(autoName('line', 'flot', 'red', 1), 'ENY FLOT');
    assert.equal(autoName('line', 'flot', 'blue', 1), 'FLOT');
    assert.equal(autoName('line', 'phase_line', 'blue', 2), 'BRAVO');
    assert.equal(autoName('area', 'objective', 'blue', 2), 'Cel B');
  });
  test('lista rodzajów znaków w UI zgadza się z whitelistą serwera', () => {
    for (const kind of Object.keys(NOTE_GRAPHICS)) assert.deepEqual(GRAPHICS[kind].map((g) => g.id), NOTE_GRAPHICS[kind]);
  });
});

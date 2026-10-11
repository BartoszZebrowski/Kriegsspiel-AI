import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeSidc, groupSymbolTypes, isDescribed, parseSidc } from '../public/js/domain/sidc.js';
import { formatGameTime, formatClock, addMinutes, formatAge, formatDuration } from '../public/js/domain/format.js';
import { renderMarkdown } from '../public/js/domain/markdown.js';

describe('T04 — opis symboli NATO', () => {
  test('jednostka własna', () => {
    assert.equal(describeSidc('SFGPUCIZ---H---'), 'swój · piechota zmechanizowana · brygada');
  });
  test('kontakt wroga, niepotwierdzony', () => {
    assert.equal(describeSidc('SHGAUCAT---E---'), 'wróg · pancerne (gąsienicowe) · kompania · przewidywany');
  });
  test('dowództwo i małe litery', () => {
    assert.equal(describeSidc('sfgpucfhe-aI---'), 'swój · artyleria samobieżna · dowództwo · dywizja');
  });
  test('dron', () => {
    assert.equal(describeSidc('SFAPMFQ--------'), 'swój · bezzałogowy statek powietrzny');
  });
  test('nieznany kod funkcji', () => {
    assert.equal(isDescribed('SFGPXYZ----E---'), false);
    assert.match(describeSidc('SFGPXYZ----E---'), /nieznany typ/);
  });
  test('parsowanie pól', () => {
    const p = parseSidc('SHGAUCAT---E---');
    assert.equal(p.affiliationCode, 'H');
    assert.equal(p.statusCode, 'A');
    assert.equal(p.echelonCode, 'E');
    assert.equal(p.functionCode, 'UCAT');
  });
});

describe('T05 — grupowanie typów do legendy', () => {
  test('dwie jednostki tego samego typu dają jeden wpis', () => {
    const groups = groupSymbolTypes([
      { name: '1 bzmot', sidc: 'SFGPUCIZ---F---' },
      { name: '2 bzmot', sidc: 'SFGPUCIZ---F---' },
      { name: 'dcz', sidc: 'SFGPUCAT---F---' },
      { id: 'c1', sidc: 'SHGAUCAT---E---' },
    ]);
    assert.equal(groups.length, 3);
    const mech = groups.find((g) => g.sidc === 'SFGPUCIZ---F---');
    assert.equal(mech.count, 2);
    assert.equal(groups.at(-1).sidc[1], 'H', 'wróg na końcu listy');
  });
});

describe('T06 — czas gry', () => {
  test('format pełny w strefie scenariusza', () => {
    assert.equal(formatGameTime('2026-05-14T08:00:00+02:00', 'Europe/Warsaw'), 'czw. 14.05.2026, 08:00');
  });
  test('ten sam moment zapisany w UTC daje ten sam czas w Warszawie', () => {
    assert.equal(formatGameTime('2026-05-14T06:00:00Z', 'Europe/Warsaw'), 'czw. 14.05.2026, 08:00');
  });
  test('następna tura po 120 min', () => {
    assert.equal(formatClock(addMinutes('2026-05-14T08:00:00+02:00', 120), 'Europe/Warsaw'), '10:00');
  });
  test('czas trwania', () => {
    assert.equal(formatDuration(120), '2 h');
    assert.equal(formatDuration(90), '1 h 30 min');
    assert.equal(formatDuration(1500), '1 d 1 h');
    assert.equal(formatDuration(0), '0 min');
  });
});

describe('T04 — wiek informacji', () => {
  test('1 h 38 min temu', () => {
    assert.equal(formatAge('2026-05-14T06:22:00+02:00', '2026-05-14T08:00:00+02:00'), '1 h 38 min temu');
  });
  test('przed chwilą i dni', () => {
    assert.equal(formatAge('2026-05-14T08:00:00+02:00', '2026-05-14T08:00:30+02:00'), 'przed chwilą');
    assert.equal(formatAge('2026-05-12T05:00:00+02:00', '2026-05-14T08:00:00+02:00'), '2 d 3 h temu');
  });
});

describe('T09 — renderer Markdown', () => {
  test('nagłówek, lista, pogrubienie', () => {
    const html = renderMarkdown('# Tytuł\n\n- punkt **ważny**\n- drugi');
    assert.match(html, /<h1>Tytuł<\/h1>/);
    assert.match(html, /<li>punkt <strong>ważny<\/strong><\/li>/);
    assert.equal((html.match(/<li>/g) || []).length, 2);
  });
  test('HTML jest escapowany', () => {
    const html = renderMarkdown('<script>alert(1)</script> i **<b>x</b>**');
    assert.ok(!html.includes('<script>'));
    assert.ok(!html.includes('<b>'));
    assert.match(html, /&lt;script&gt;/);
  });
  test('tabela i lista numerowana', () => {
    const html = renderMarkdown('| Siły | Stan |\n|---|---|\n| 15 BZ | 90% |\n\n1. raz\n2. dwa');
    assert.match(html, /<th>Siły<\/th>/);
    assert.match(html, /<td>90%<\/td>/);
    assert.match(html, /<ol><li>raz<\/li><li>dwa<\/li><\/ol>/);
  });
});

describe('T11 — skróty kanałów', async () => {
  test('skrót nazwy kanału', async () => {
    const { shortName } = await import('../public/js/domain/orbat.js');
    assert.equal(shortName({ name: 'ZT „Mamry”' }), 'ZTMa');
    assert.equal(shortName({ name: 'x', short: 'S2' }), 'S2');
  });
});

describe('T11 — linia do jednostki', async () => {
  const { clipToRect } = await import('../public/js/domain/geo.js');
  const rect = { left: 0, top: 0, right: 100, bottom: 100 };
  test('punkt wewnątrz bez zmian', () => {
    assert.deepEqual(clipToRect({ x: 150, y: 50 }, { x: 40, y: 60 }, rect), { x: 40, y: 60, clipped: false });
  });
  test('punkt poza mapą trafia na krawędź', () => {
    const r = clipToRect({ x: 150, y: 50 }, { x: -50, y: 50 }, rect);
    assert.equal(r.clipped, true);
    assert.equal(r.x, 0);
    assert.equal(r.y, 50);
  });
  test('punkt nad mapą trafia na krawędź górną, na odcinku', () => {
    const r = clipToRect({ x: 150, y: 50 }, { x: 50, y: -50 }, rect);
    assert.equal(r.clipped, true);
    assert.ok(Math.abs(r.y) < 1e-9 || Math.abs(r.x - 100) < 1e-9);
    assert.ok(r.x >= 0 && r.x <= 150 && r.y >= -50 && r.y <= 50);
  });
});

describe('T12 — miarka i grot strzałki', async () => {
  const { distanceKm, pathLengthKm, marchTable, formatMarch, arrowHead } = await import('../public/js/domain/geo.js');
  test('Suwałki–Augustów ok. 30 km w linii prostej', () => {
    const d = distanceKm([22.9308, 54.1115], [22.9798, 53.8433]);
    assert.ok(Math.abs(d - 30) < 1.5, `wyszło ${d}`);
  });
  test('długość łamanej to suma odcinków', () => {
    const a = [22.9, 54.1], b = [23.0, 54.1], c = [23.0, 54.2];
    assert.ok(Math.abs(pathLengthKm([a, b, c]) - (distanceKm(a, b) + distanceKm(b, c))) < 1e-9);
  });
  test('30 km kolumną kołową po drodze — 1 h, w terenie — 2 h', () => {
    const wheeled = marchTable(30).find((r) => r.id === 'wheeled');
    assert.equal(formatMarch(wheeled.roadMin), '1 h');
    assert.equal(formatMarch(wheeled.offroadMin), '2 h');
  });
  test('grot strzałki symetryczny względem osi', () => {
    const [l, tip, r] = arrowHead({ x: 0, y: 0 }, { x: 0, y: 100 });
    assert.deepEqual(tip, { x: 0, y: 100 });
    assert.ok(Math.abs(l.x + r.x) < 1e-9, 'symetria w poziomie');
    assert.equal(l.y, r.y);
    assert.ok(l.y < 100, 'podstawa grotu przed czubkiem');
  });
});

describe('T12.1 — stan osobowy i sprzęt', async () => {
  const s = await import('../public/js/domain/strength.js');
  test('formatowanie stanu osobowego', () => {
    assert.equal(s.formatStrength(610, 650), '610 / 650 (94%)');
  });
  test('poziomy ukompletowania', () => {
    assert.equal(s.readinessLevel(0.94), 'good');
    assert.equal(s.readinessLevel(0.8), 'good');
    assert.equal(s.readinessLevel(0.6), 'warn');
    assert.equal(s.readinessLevel(0.5), 'warn');
    assert.equal(s.readinessLevel(0.3), 'bad');
    assert.equal(s.readinessLevel(s.readinessRatio(5, 0)), null);
  });
  test('szacunki kontaktu jako „~30 BTR-82A”', () => {
    assert.equal(s.formatEstimateEquipment({ name: 'BTR-82A', count: 30, approx: true }), '~30 BTR-82A');
    assert.equal(s.formatEstimateEquipment({ name: 'BTR-82A', count: 30, approx: false }), '30 BTR-82A');
    assert.equal(s.formatEstimatePersonnel({ count: 800 }), '~800 żołn.');
  });
  test('skrót do podpowiedzi', () => {
    const u = { personnel: { current: 610, authorized: 650 }, equipment: [{ name: 'Leopard 2PL', current: 41, authorized: 44 }] };
    assert.equal(s.unitBrief(u), '~610 żołn. · Leopard 2PL 41');
    assert.match(s.contactBrief({ estimate_equipment: [{ name: 'BTR-82A', count: 30 }] }), /~30 BTR-82A.*szacunek/);
  });
});

describe('T13 — hierarchia jednostek', async () => {
  const o = await import('../public/js/domain/orbat.js');
  const units = [
    { id: 'hq', sidc: 'SFGPUCIZ--AH---', pos: [0, 0] },
    { id: 'b1', sidc: 'SFGPUCIZ---F---', parent: 'hq', pos: [0, 1] },
    { id: 'b1-1k', sidc: 'SFGPUCIZ---E---', parent: 'b1', pos: [0, 2] },
    { id: 'b1-2k', sidc: 'SFGPUCIZ---E---', parent: 'b1', pos: [0, 3] },
    { id: 'krozp', sidc: 'SFGPUCR----E---', pos: [1, 1] },
    { id: 'kr-hq', sidc: 'SFGPUCR----E---', parent: 'hq', pos: [1, 2] },
    { id: 'dd', sidc: 'SFGPUCIZ--AI---', pos: [2, 2] },
  ];
  const ids = (nodes) => nodes.map((n) => n.unit.id);
  test('drzewo: kompanie pod właściwym batalionem, bez rodzica na górze', () => {
    const roots = o.buildTree(units);
    assert.deepEqual(ids(roots), ['hq', 'krozp', 'dd']);
    const hq = roots[0];
    assert.deepEqual(ids(hq.children), ['b1', 'kr-hq']);
    assert.deepEqual(ids(hq.children[0].children), ['b1-1k', 'b1-2k']);
  });
  test('filtr szczegółowości: kompania z rodzicem ukryta, samodzielna zostaje', () => {
    const byId = o.indexById(units);
    const vis = (id, level) => o.isUnitVisible(byId.get(id), byId, level);
    assert.equal(vis('b1-1k', 'battalion'), false);
    assert.equal(vis('b1-1k', 'company'), true);
    assert.equal(vis('krozp', 'battalion'), true);
    assert.equal(vis('kr-hq', 'battalion'), true); // kompania podległa ZT, nie batalionowi
    assert.equal(vis('b1', 'battalion'), true);
  });
  test('poziom automatyczny wg zoomu (kompania od 11, pluton od 13), wybór ręczny ma pierwszeństwo', () => {
    assert.equal(o.detailLevel(null, 10), 'battalion');
    assert.equal(o.detailLevel(null, 11), 'company');
    assert.equal(o.detailLevel(null, 12.75), 'company');
    assert.equal(o.detailLevel(null, 13), 'platoon');
    assert.equal(o.detailLevel('battalion', 14), 'battalion');
    assert.equal(o.detailLevel('company', 8), 'company');
    assert.equal(o.detailLevel('platoon', 8), 'platoon');
    assert.equal(o.detailLevel('cokolwiek', 8), 'battalion');
  });
  test('linie podporządkowania tylko gdy oba końce widoczne', () => {
    const key = (l) => l.map((p) => `${p.parent}>${p.child}`).sort();
    assert.deepEqual(key(o.hierarchyLinks(units, 'battalion')), ['hq>b1', 'hq>kr-hq']);
    assert.deepEqual(key(o.hierarchyLinks(units, 'company')), ['b1>b1-1k', 'b1>b1-2k', 'hq>b1', 'hq>kr-hq']);
    const noPos = units.map((u) => (u.id === 'b1' ? { ...u, pos: undefined } : u));
    assert.deepEqual(key(o.hierarchyLinks(noPos, 'company')), ['hq>kr-hq']);
  });
  test('kanały: automatyczne dla jednostek z rodzicem, scenariusz nadpisuje metadane', () => {
    const ch = o.mergeChannels(
      [{ id: 'dd', name: 'DD', kind: 'superior' }, { id: 'b1', name: 'B1', kind: 'subordinate', short: 'b1s' }, { id: 's2', name: 'S2', unit: 'hq' }],
      units.map((u) => ({ ...u, name: u.id })),
    );
    const byId = Object.fromEntries(ch.map((c) => [c.id, c]));
    assert.equal(byId['b1'].short, 'b1s');
    assert.equal(byId['b1'].parent, 'hq');
    assert.equal(byId['b1-1k'].parent, 'b1');
    assert.equal(byId['b1-1k'].kind, 'subordinate');
    assert.equal(byId['b1-1k'].unit, 'b1-1k');
    assert.ok(!byId['hq'], 'hq nie dostaje kanału (jest celem s2)');
    assert.equal(ch.filter((c) => c.id === 'dd').length, 1);
  });
  test('suma po poddrzewie (nieprzeczytane zwiniętego węzła)', () => {
    const roots = o.buildTree(units);
    const unread = { b1: 1, 'b1-1k': 2, 'b1-2k': 3 };
    assert.equal(o.subtreeSum(roots[0].children[0], (c) => unread[c.id] ?? 0), 6);
  });
});

describe('T13.1 — poziom plutonu', async () => {
  const o = await import('../public/js/domain/orbat.js');
  const units = [
    { id: 'hq', sidc: 'SFGPUCIZ--AH---', pos: [0, 0] },
    { id: 'b1', sidc: 'SFGPUCIZ---F---', parent: 'hq', pos: [0, 1] },
    { id: 'b1-1k', sidc: 'SFGPUCIZ---E---', parent: 'b1', pos: [0, 2] },
    { id: 'b1-1k-1p', sidc: 'SFGPUCIZ---D---', parent: 'b1-1k', pos: [0, 2.1] },
    { id: 'kr', sidc: 'SFGPUCR----E---', parent: 'hq', pos: [1, 2] },
    { id: 'kr-1p', sidc: 'SFGPUCR----D---', parent: 'kr', pos: [1, 2.1] },
    { id: 'bn-p', sidc: 'SFGPUCIZ---D---', parent: 'b1', pos: [0, 3] }, // pluton podległy wprost batalionowi
  ];
  const byId = o.indexById(units);
  const vis = (id, level) => o.isUnitVisible(byId.get(id), byId, level);

  test('batalion: ukryte kompanie i plutony pod batalionem; kompania pod ZT zostaje', () => {
    assert.equal(vis('b1-1k', 'battalion'), false);
    assert.equal(vis('b1-1k-1p', 'battalion'), false);
    assert.equal(vis('kr', 'battalion'), true);
    assert.equal(vis('kr-1p', 'battalion'), false);
    assert.equal(vis('b1', 'battalion'), true);
  });
  test('kompania: widoczne kompanie, ukryte plutony podległe kompanii', () => {
    assert.equal(vis('b1-1k', 'company'), true);
    assert.equal(vis('b1-1k-1p', 'company'), false);
    assert.equal(vis('kr-1p', 'company'), false);
    assert.equal(vis('bn-p', 'company'), true); // pluton podległy batalionowi, nie kompanii
  });
  test('pluton: widoczne wszystko', () => {
    for (const u of units) assert.equal(vis(u.id, 'platoon'), true, u.id);
  });
  test('minLevelFor wskazuje najmniejszy poziom, na którym jednostka jest widoczna', () => {
    const lvl = (id) => o.minLevelFor(byId.get(id), byId);
    assert.equal(lvl('b1'), 'battalion');
    assert.equal(lvl('b1-1k'), 'company');
    assert.equal(lvl('b1-1k-1p'), 'platoon');
    assert.equal(lvl('bn-p'), 'company');
  });
  test('linie podporządkowania respektują poziom (kompania→plutony dopiero na poziomie pluton)', () => {
    const key = (l) => l.map((p) => p.parent + '>' + p.child).sort();
    assert.ok(!key(o.hierarchyLinks(units, 'company')).includes('b1-1k>b1-1k-1p'));
    assert.ok(key(o.hierarchyLinks(units, 'platoon')).includes('b1-1k>b1-1k-1p'));
    assert.ok(key(o.hierarchyLinks(units, 'platoon')).includes('kr>kr-1p'));
    assert.deepEqual(key(o.hierarchyLinks(units, 'battalion')), ['hq>b1', 'hq>kr']);
  });
  test('splitUnits oddziela przełożonego i sąsiadów; channelForUnit nie wiąże „s2” z dowództwem', () => {
    const channels = [
      { id: 'dd', kind: 'superior' },
      { id: 's2', kind: 'recon', unit: 'hq' },
      { id: 'log', kind: 'logistics', unit: 'blog' },
      { id: 'kr', kind: 'subordinate' },
    ];
    const all = [...units, { id: 'dd', sidc: 'SFGPUCIZ--AI---', pos: [2, 2] }, { id: 'blog' }];
    const { own, external } = o.splitUnits(all, channels);
    assert.deepEqual(external.map((e) => e.unit.id), ['dd']);
    assert.ok(own.some((u) => u.id === 'hq') && !own.some((u) => u.id === 'dd'));
    assert.equal(o.channelForUnit(channels, 'hq'), null);
    assert.equal(o.channelForUnit(channels, 'blog').id, 'log');
    assert.equal(o.channelForUnit(channels, 'kr').id, 'kr');
  });
});

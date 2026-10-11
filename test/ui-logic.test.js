// Testy czystej logiki nowego interfejsu (T12.7): MGRS, omnibox, oś czasu, splittery, wzmianki, wiadomości, DTG, odprawa.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { toMgrs, mgrsOf, formatDms, formatLatLon, toUtm } from '../public/js/domain/mgrs.js';
import { searchOmnibox, matchScore, splitMatch, COMMANDS } from '../public/js/domain/omnibox.js';
import { buildTimeline, tickCount, hourStep, showTurnLabel, lanesVisible } from '../public/js/domain/timeline.js';
import { SPLITTERS, clampSize, maxDockWidth, shouldCollapse, dragValue, keyboardValue } from '../public/js/domain/splitter.js';
import { activeTrigger, mentionSuggestions, applySuggestion } from '../public/js/domain/mentions.js';
import { parseSender, messageTags, groupChannels, defaultPinned, outboxCount, newIncoming } from '../public/js/domain/messages.js';
import { formatDtg, formatDtgShort, formatDayClock, natoZoneLetter, dayKey, formatDay, ageMinutes } from '../public/js/domain/format.js';
import { briefingDocument } from '../public/js/domain/briefing.js';

describe('MGRS i współrzędne', () => {
  test('znane punkty (tolerancja kilkudziesięciu metrów)', () => {
    assert.match(toMgrs(48.8584, 2.2945), /^31U DQ 482\d\d 119\d\d$/); // Wieża Eiffla
    assert.match(toMgrs(-33.8568, 151.2153), /^56H LH 349\d\d 522\d\d$/); // Sydney
    assert.match(toMgrs(54.1118, 22.9308), /^34U FE /); // Suwałki
    assert.match(toMgrs(52.2297, 21.0122), /^34U EC /); // Warszawa
  });
  test('precyzja i poza zakresem', () => {
    assert.match(toMgrs(54.15, 22.95, 4), /^34U FF \d{4} \d{4}$/);
    assert.equal(toMgrs(85, 10), null);
    assert.equal(toMgrs(NaN, 10), null);
    assert.equal(mgrsOf(null), null);
    assert.equal(mgrsOf([22.95, 54.15]), toMgrs(54.15, 22.95));
  });
  test('strefa UTM i półkula południowa (przesunięcie północne)', () => {
    const u = toUtm(54.15, 22.95);
    assert.equal(u.zone, 34);
    assert.equal(u.band, 'U');
    assert.ok(u.easting > 500000 && u.easting < 700000);
    assert.ok(toUtm(-10, 10).northing > 8000000);
  });
  test('formatowanie DMS i stopni dziesiętnych', () => {
    assert.equal(formatDms([22.95, 54.15]), '54°09′00″N 22°57′00″E');
    assert.equal(formatDms([-0.5, -10.25]), '10°15′00″S 0°30′00″W');
    assert.equal(formatLatLon(54.15, 22.95), '54.1500°N 22.9500°E');
    assert.equal(formatDms(null), '—');
  });
});

describe('Omnibox — indeks i ranking', () => {
  const units = [
    { id: '1bzmot', name: '1 bzmot', sidc: 'SFGPUCIZ---F---', pos: [22.87, 54.19], parent: 'hq' },
    { id: '1bzmot-1k', name: '1k 1bzmot', sidc: 'SFGPUCIZ---E---', pos: [22.84, 54.23], parent: '1bzmot' },
    { id: '1bzmot-1k-1p', name: '1p 1k 1bzmot', sidc: 'SFGPUCIZ---D---', pos: [22.84, 54.24], parent: '1bzmot-1k' },
    { id: '2bzmot', name: '2 bzmot', sidc: 'SFGPUCIZ---F---', pos: [23.2, 54.1], parent: 'hq' },
    { id: 'hq', name: 'ZT Hańcza', sidc: 'SFGPUCIZ--AH---', pos: [22.93, 54.1] },
  ];
  const contacts = [{ id: 'c-001', sidc: 'SHGAUCIZ---F---', pos: [22.6, 54.4], estimate: 'batalionowa grupa taktyczna', observed: '2026-05-14T05:00:00+02:00', source: 'BSP-1', confidence: 'wysoka' }];
  const assets = [{ id: 'bsp-1', name: 'BSP-1', type: 'dron', sidc: 'SFAPMFQ--------', pos: [22.7, 54.3] }];
  const places = [{ id: 'p-suw', name: 'Suwałki', kind: 'miasto', pos: [22.93, 54.11], forms: ['Suwałk', 'Suwałkach'] }];
  const notes = [{ id: 'n1', name: 'Rejon A', description: 'rejon obrony' }];
  const data = { units, contacts, assets, places, notes, turnTime: '2026-05-14T06:00:00+02:00' };

  test('„1 bzmot”: dokładna nazwa jednostki jest pierwszym wynikiem', () => {
    const res = searchOmnibox('1 bzmot', 'all', data);
    assert.equal(res[0].id, '1bzmot');
    assert.equal(res[0].group, 'unit');
    assert.ok(res.slice(1).every((r) => r.id !== '1bzmot'));
  });
  test('ranking: dokładna > początek > fragment', () => {
    assert.ok(matchScore('1 bzmot', '1 bzmot') > matchScore('1 bz', '1 bzmot'));
    assert.ok(matchScore('bz', '1 bzmot') > 0);
    assert.equal(matchScore('xyz', '1 bzmot'), 0);
    assert.equal(matchScore('hancza', 'ZT Hańcza') > 0, true); // bez polskich znaków
    assert.ok(matchScore('suwalki', 'Suwałki') >= 90);
  });
  test('grupy: jednostki, kontakty, środki, miejsca, szkice, polecenia', () => {
    const res = searchOmnibox('', 'all', data);
    assert.deepEqual([...new Set(res.map((r) => r.group))], ['unit', 'contact', 'asset', 'place', 'sketch', 'command']);
    assert.ok(res.filter((r) => r.group === 'unit').length <= 4);
  });
  test('filtry zawężają grupy; miejsca szukane po odmianach', () => {
    assert.ok(searchOmnibox('', 'unit', data).every((r) => r.group === 'unit' || r.group === 'asset'));
    assert.deepEqual(searchOmnibox('suwalk', 'place', data).map((r) => r.id), ['p-suw']);
    assert.deepEqual(searchOmnibox('c-0', 'contact', data).map((r) => r.id), ['c-001']);
    assert.deepEqual(searchOmnibox('rejon a', 'all', data).filter((r) => r.group === 'sketch').map((r) => r.id), ['n1']);
    assert.equal(searchOmnibox('odprawę', 'command', data)[0].id, 'briefing');
  });
  test('jednostki mają MGRS po prawej, kontakty wiek i pewność', () => {
    const res = searchOmnibox('1 bzmot', 'all', data);
    assert.match(res[0].right, /^34U/);
    const c = searchOmnibox('c-001', 'contact', data)[0];
    assert.match(c.sub, /1 h temu/);
    assert.equal(c.right, 'pewność wysoka');
  });
  test('brak wyników i podświetlenie', () => {
    assert.deepEqual(searchOmnibox('zzzzqq', 'all', data), []);
    assert.deepEqual(splitMatch('1 bzmot', 'bz'), ['1 ', 'bz', 'mot']);
    assert.equal(splitMatch('abc', 'x'), null);
    assert.ok(COMMANDS.some((c) => c.id === 'turn-current'));
  });
});

describe('Oś czasu — węzły i ścieżki', () => {
  const base = { turns: [0, 1, 2], currentTurn: 2, viewTurn: 2, start: '2026-05-14T06:00:00+02:00', turnMinutes: 120 };
  const msg = (time, extra = {}) => ({ id: time, time, direction: 'in', ...extra });

  test('liczba węzłów: minimum 13, rośnie z bieżącą turą', () => {
    assert.equal(tickCount(2), 13);
    assert.equal(tickCount(20), 27);
    assert.equal(buildTimeline(base).ticks.length, 13);
  });
  test('stany węzłów: przeszłość, bieżąca, przyszłość; klikalne tylko istniejące tury', () => {
    const { ticks, archive } = buildTimeline(base);
    assert.deepEqual(ticks.slice(0, 4).map((t) => t.state), ['past', 'past', 'cur', 'fut']);
    assert.deepEqual(ticks.slice(0, 4).map((t) => t.clickable), [true, true, true, false]);
    assert.equal(archive, false);
    assert.equal(ticks[0].pct, 0);
    assert.equal(ticks[12].pct, 100);
  });
  test('archiwum: węzeł oglądanej tury oznaczony view, playhead na tej turze', () => {
    const tl = buildTimeline({ ...base, viewTurn: 0 });
    assert.equal(tl.archive, true);
    assert.equal(tl.ticks[0].view, true);
    assert.equal(tl.ticks[2].view, false);
    assert.equal(tl.playheadPct, 0);
    assert.ok(tl.pastPct > 0);
  });
  test('ścieżki: wiadomości (pilne), rozkazy gracza wg typu, kontakty; zdarzenia po playheadzie są „late”', () => {
    const messages = [
      msg('2026-05-14T06:00:00+02:00'),
      msg('2026-05-14T08:00:00+02:00', { priority: 'urgent' }),
      msg('2026-05-14T09:00:00+02:00', { direction: 'out', type: 'rozkaz' }),
      msg('2026-05-14T09:30:00+02:00', { direction: 'out', type: 'zarzadzenie' }),
      msg('2026-05-14T09:45:00+02:00', { direction: 'out', type: 'meldunek' }),
      msg('2026-05-14T09:50:00+02:00', { direction: 'in', type: 'rozkaz' }), // rozkaz przełożonego to wiadomość, nie „twój rozkaz”
    ];
    const contacts = [{ id: 'c', observed: '2026-05-14T05:00:00+02:00' }, { id: 'd', observed: '2026-05-14T09:00:00+02:00' }];
    const tl = buildTimeline({ ...base, messages, contacts, viewTurn: 1 });
    assert.equal(tl.lanes.ords.length, 2);
    assert.equal(tl.lanes.msgs.length, 4);
    assert.equal(tl.lanes.msgs.filter((m) => m.urgent).length, 1);
    assert.equal(tl.lanes.cons.length, 2);
    // playhead na T1 = 08:00; wiadomości po 08:00 są późniejsze
    assert.equal(tl.lanes.ords.every((o) => o.late), true);
    assert.equal(tl.lanes.msgs[0].late, false);
  });
  test('gęstość etykiet godzin i tur wg szerokości; wysokość < 80 px chowa ścieżki', () => {
    assert.equal(hourStep(300), 4);
    assert.equal(hourStep(500), 3);
    assert.equal(hourStep(900), 2);
    assert.equal(showTurnLabel(1, 900), true);
    assert.equal(showTurnLabel(1, 350), false);
    assert.equal(showTurnLabel(2, 350), true);
    assert.equal(showTurnLabel(0, 200), false);
    assert.equal(lanesVisible(98), true);
    assert.equal(lanesVisible(70), false);
  });
});

describe('Splittery — ograniczanie rozmiaru', () => {
  test('clampSize: min/max, zaokrąglenie, brak górnej granicy', () => {
    assert.equal(clampSize(100, SPLITTERS.l), 220);
    assert.equal(clampSize(900, SPLITTERS.l), 520);
    assert.equal(clampSize(300.4, SPLITTERS.l), 300);
    assert.equal(clampSize(5000, SPLITTERS.i), 5000);
    assert.equal(clampSize(NaN, SPLITTERS.r), 300);
    assert.equal(clampSize(70, { min: 100, max: 50 }), 100); // max < min → min wygrywa
  });
  test('maxDockWidth: mapa ma co najmniej 320 px', () => {
    assert.equal(maxDockWidth({ max: 520, windowWidth: 1440, otherWidth: 392 }), 520);
    assert.equal(maxDockWidth({ max: 520, windowWidth: 1000, otherWidth: 392 }), 288);
    assert.equal(maxDockWidth({ max: 520, windowWidth: 600, otherWidth: 392 }), 0);
  });
  test('zwijanie do szyny po przeciągnięciu 60 px poniżej minimum', () => {
    assert.equal(shouldCollapse(160, 220), false);
    assert.equal(shouldCollapse(159, 220), true);
    assert.equal(shouldCollapse(100, 300), true);
  });
  test('przeciąganie i klawiatura: kierunek odwrócony dla prawej/dolnej krawędzi', () => {
    assert.equal(dragValue(312, 40, false), 352);
    assert.equal(dragValue(392, 40, true), 352);
    assert.equal(keyboardValue('ArrowRight', 300, SPLITTERS.l), 316);
    assert.equal(keyboardValue('ArrowLeft', 300, SPLITTERS.l, true), 252);
    assert.equal(keyboardValue('ArrowLeft', 392, SPLITTERS.r), 408); // prawy dok: w lewo = szerzej
    assert.equal(keyboardValue('ArrowUp', 98, SPLITTERS.t), 114);
    assert.equal(keyboardValue('ArrowUp', 98, SPLITTERS.l), null); // zła oś
    assert.equal(keyboardValue('a', 98, SPLITTERS.t), null);
  });
  test('specyfikacja §3.4: wartości domyślne i granice', () => {
    assert.deepEqual(['l', 'r', 't', 'c'].map((k) => [SPLITTERS[k].min, SPLITTERS[k].def, SPLITTERS[k].max]), [[220, 312, 520], [300, 392, 640], [64, 98, 240], [56, 78, 320]]);
    assert.equal(SPLITTERS.l.collapse && SPLITTERS.r.collapse, true);
    assert.equal(SPLITTERS.t.collapse, false);
  });
});

describe('Wzmianki @ i # w komponowaniu', () => {
  const ctx = {
    units: [{ id: '1bzmot', name: '1 bzmot', sidc: 'x', status: 'w obronie' }, { id: 'bcz', name: 'bcz' }],
    contacts: [{ id: 'c-001', estimate: 'BGT' }],
    assets: [{ id: 'bsp-1', name: 'BSP-1', pos: [1, 1] }, { id: 'bsp-2', name: 'BSP-2' }],
    places: [{ id: 'p1', name: 'Wiżajny', kind: 'wieś', forms: ['Wiżajn'] }, { id: 'p2', name: 'Suwałki' }],
  };
  test('activeTrigger: znak wyzwalający na początku lub po spacji', () => {
    assert.deepEqual(activeTrigger('Zająć @1', 8), { trigger: '@', query: '1', start: 6 });
    assert.equal(activeTrigger('mail a@b', 8), null);
    assert.equal(activeTrigger('x #Wi', 5).trigger, '#');
    assert.equal(activeTrigger('x #Wi', 5).query, 'Wi');
    assert.equal(activeTrigger('x @a b', 6).query, 'a b'); // nazwy jednostek mogą mieć spacje
    assert.equal(activeTrigger('x @a' + String.fromCharCode(10) + 'b', 7), null); // nowa linia kończy oznaczenie
    assert.equal(activeTrigger('', 0), null);
  });
  test('@ podpowiada jednostki, kontakty i środki z pozycją; # miejsca (także po odmianie)', () => {
    assert.deepEqual(mentionSuggestions('@', '', ctx).map((s) => s.id), ['1bzmot', 'bcz', 'bsp-1', 'c-001']);
    assert.deepEqual(mentionSuggestions('@', 'bz', ctx).map((s) => s.id), ['1bzmot']);
    assert.deepEqual(mentionSuggestions('#', 'wiz', ctx).map((s) => s.id), ['p1']);
    assert.deepEqual(mentionSuggestions('#', 'wiżajn', ctx).map((s) => s.id), ['p1']);
    assert.equal(mentionSuggestions('@', '', ctx, 2).length, 2);
  });
  test('applySuggestion wstawia nazwę w miejsce oznaczenia', () => {
    const trig = activeTrigger('Zająć @1', 8);
    const res = applySuggestion('Zająć @1', trig, 8, { text: '1 bzmot' });
    assert.equal(res.text, 'Zająć 1 bzmot ');
    assert.equal(res.caret, res.text.length);
  });
});

describe('Wiadomości — rodzaje, nadawcy, kanały', () => {
  test('parseSender dzieli „stopień nazwisko, funkcja”', () => {
    assert.deepEqual(parseSender('gen. bryg. Nowicki, dowódca dywizji'), { name: 'gen. bryg. Nowicki', role: 'dowódca dywizji' });
    assert.deepEqual(parseSender('Dowództwo'), { name: 'Dowództwo', role: '' });
    assert.deepEqual(parseSender(undefined), { name: '', role: '' });
  });
  test('znaczniki: pilne, rodzaj (rozkaz przychodzący = bursztyn, własny = akcent)', () => {
    assert.deepEqual(messageTags({ direction: 'in', priority: 'urgent', type: 'rozkaz' }), [{ cls: 'urg', label: 'Pilne' }, { cls: 'dir', label: 'Rozkaz' }]);
    assert.deepEqual(messageTags({ direction: 'out', type: 'rozkaz' }), [{ cls: 'ord', label: 'Rozkaz bojowy' }]);
    assert.deepEqual(messageTags({ direction: 'out', type: 'zarzadzenie' }), [{ cls: 'ord', label: 'Zarządzenie' }]);
    assert.deepEqual(messageTags({ direction: 'in', type: 'meldunek' }), [{ cls: 'rep', label: 'Meldunek' }]);
    assert.deepEqual(messageTags({ direction: 'in', type: 'wiadomosc' }), []);
    assert.deepEqual(messageTags({ direction: 'in' }), []);
  });
  test('skrzynka liczy wiadomości gracza z bieżącej tury; nowe wiadomości przychodzące', () => {
    const msgs = [{ id: 'a', direction: 'out', turn: 1 }, { id: 'b', direction: 'out', turn: 2 }, { id: 'c', direction: 'in', turn: 2 }];
    assert.equal(outboxCount(msgs, 2), 1);
    assert.equal(outboxCount([], 0), 0);
    assert.deepEqual(newIncoming([msgs[0]], msgs).map((m) => m.id), ['c']);
  });
  test('grupy kanałów i domyślnie przypięte', () => {
    const ch = [
      { id: 'dd', kind: 'superior' }, { id: 'n', kind: 'neighbor' }, { id: 'b', kind: 'subordinate' },
      { id: 'log', kind: 'logistics' }, { id: 'auto', kind: 'subordinate', auto: true }, { id: 's2', kind: 'recon' },
    ];
    assert.deepEqual(groupChannels(ch).map((g) => g.title), ['Przełożony', 'Sztab', 'Sąsiedzi', 'Podwładni']);
    assert.deepEqual(defaultPinned(ch), ['dd', 'log', 's2', 'b']);
  });
});

describe('Czas gry — DTG i dni', () => {
  const t = '2026-05-14T10:00:00+02:00';
  test('DTG w strefie scenariusza (B = +2) i wersja skrócona', () => {
    assert.equal(formatDtg(t, 'Europe/Warsaw'), '141000B MAJ 26');
    assert.equal(formatDtgShort(t, 'Europe/Warsaw'), '141000B');
    assert.equal(formatDtg('2026-01-14T10:00:00+01:00', 'Europe/Warsaw'), '141000A STY 26'); // zima: +1 = A
    assert.equal(formatDtg(t, 'UTC'), '140800Z MAJ 26');
    assert.equal(formatDtg('nie-data'), '—');
  });
  test('litery stref NATO', () => {
    assert.deepEqual([0, 60, 120, 540, 600, -60, -720].map(natoZoneLetter), ['Z', 'A', 'B', 'I', 'K', 'N', 'Y']);
  });
  test('zegar „CZW 14.05 · 10:00”, klucz dnia, nagłówek dnia, wiek w minutach', () => {
    assert.equal(formatDayClock(t, 'Europe/Warsaw'), 'CZW 14.05 · 10:00');
    assert.equal(dayKey(t, 'Europe/Warsaw'), '2026-05-14');
    assert.equal(dayKey('2026-05-14T23:30:00Z', 'Europe/Warsaw'), '2026-05-15');
    assert.equal(formatDay(t, 'Europe/Warsaw'), 'czw. 14.05.2026');
    assert.equal(ageMinutes('2026-05-14T09:00:00+02:00', t), 60);
    assert.equal(ageMinutes('2026-05-14T11:00:00+02:00', t), 0);
  });
});

describe('Odprawa jako dokument', () => {
  const md = '# Ćwiczenie\n\n> Uwaga wstępna\n\n**Rola:** dowódca\n\n## 1. Sytuacja\n\nTekst <b>.\n\n## 2. Zadanie\n\n- a\n- b\n';
  test('spis treści z sekcji ##, numerowane nagłówki z id, tytuł z #', () => {
    const doc = briefingDocument(md);
    assert.equal(doc.title, 'Ćwiczenie');
    assert.deepEqual(doc.toc, [{ id: 's1', title: 'Sytuacja' }, { id: 's2', title: 'Zadanie' }]);
    assert.match(doc.html, /<h1>Ćwiczenie<\/h1>/);
    assert.match(doc.html, /<h2 id="s1"><b>1<\/b>Sytuacja<\/h2>/);
    assert.match(doc.html, /<h2 id="s2"><b>2<\/b>Zadanie<\/h2>/);
    assert.match(doc.html, /<ul><li>a<\/li><li>b<\/li><\/ul>/);
    assert.ok(doc.html.includes('&lt;b&gt;')); // escapowanie
    assert.match(doc.html, /<blockquote>Uwaga wstępna<\/blockquote>/);
  });
  test('odprawa bez sekcji nadal się renderuje', () => {
    const doc = briefingDocument('Samo zdanie.');
    assert.deepEqual(doc.toc, []);
    assert.match(doc.html, /<p>Samo zdanie\.<\/p>/);
  });
});

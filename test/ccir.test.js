import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { checkCcir, checkReportCycle, checkMessageReport } from '../shared/ccir.js';
import { checkCcirFile, checkReportCycleField, checkMessageCcirFields } from '../tools/validate-ccir.js';
import {
  addCcirItem, removeCcirItem, updateCcirItem, setCcirGeometry, filterCcir, groupReports, ccirTags, cleanCcirItems, nextCcirId, CCIR_MAX, reportCycleText,
} from '../public/js/domain/ccir.js';
import { buildTimeline } from '../public/js/domain/timeline.js';
import { makeScenario, startApp } from './helpers.js';

const it = (id, text = 'x', extra = {}) => ({ id, kind: id.split('-')[0], text, ...extra });
const three = [it('PIR-1'), it('PIR-2'), it('FFIR-1')];
const mkReport = () => {
  const out = { errors: [], warns: [] };
  return { out, error: (m) => out.errors.push(m), warn: (m) => out.warns.push(m) };
};

describe('T48 — schemat CCIR i walidator', () => {
  test('poprawny plik i pusta lista', () => {
    assert.deepEqual(checkCcir({ items: three }).errors, []);
    assert.deepEqual(checkCcir({ items: [] }), { errors: [], warnings: [], items: [] });
  });

  test('zły plik: typ, brak items, obce pole, nadmiar, duplikat', () => {
    assert.ok(checkCcir([]).errors.length);
    assert.ok(checkCcir({}).errors.length);
    assert.ok(checkCcir({ items: [], x: 1 }).errors.some((e) => e.includes('x')));
    assert.ok(checkCcir({ items: Array.from({ length: 8 }, (_, i) => it(`PIR-${i + 1}`)) }).errors.length);
    assert.ok(checkCcir({ items: [it('PIR-1'), it('PIR-1'), it('FFIR-1')] }).errors.some((e) => e.includes('zduplikowane')));
  });

  test('zła pozycja: id/kind, pusty i za długi tekst, obce pole, geometria', () => {
    const bad = (x) => checkCcir({ items: [x, it('PIR-8'), it('PIR-9')] }).errors.length > 0;
    assert.ok(bad(it('FFIR-1', 'x', { kind: 'PIR' })));
    assert.ok(bad({ id: 'ABC', kind: 'PIR', text: 'x' }));
    assert.ok(bad(it('PIR-1', '   ')));
    assert.ok(bad(it('PIR-1', 'a'.repeat(201))));
    assert.ok(bad(it('PIR-1', 'x', { evil: 1 })));
    assert.ok(bad(it('PIR-1', 'x', { geometry: { type: 'LineString', coordinates: [[22, 54]] } })));
    assert.ok(bad(it('PIR-1', 'x', { geometry: { type: 'Circle', coordinates: [22, 54] } })));
    assert.ok(!bad(it('PIR-1', 'x', { geometry: { type: 'Point', coordinates: [22, 54] } })));
  });

  test('mniej niż 3 pozycje to uwaga, nie błąd', () => {
    const r = checkCcir({ items: [it('PIR-1')] });
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1);
  });

  test('reportCycle i pola wiadomości', () => {
    assert.deepEqual(checkReportCycle(undefined), []);
    assert.deepEqual(checkReportCycle({ sitrep: 240, logstat: 1440 }), []);
    assert.ok(checkReportCycle({ sitrep: 0 }).length);
    assert.ok(checkReportCycle({ sitrep: 1.5 }).length);
    assert.ok(checkReportCycle({ foo: 1 }).length);
    assert.equal(checkMessageReport({ ccir: 'PIR-2', report: 'sitrep' }), null);
    assert.ok(checkMessageReport({ ccir: 'xyz' }));
    assert.ok(checkMessageReport({ report: 'inny' }));
  });

  test('walidator: ccir wskazujący nieistniejącą pozycję to uwaga; zły reportCycle to błąd', () => {
    const r = mkReport();
    const ids = checkCcirFile({ items: three }, r);
    assert.deepEqual([...ids].sort(), ['FFIR-1', 'PIR-1', 'PIR-2']);
    checkMessageCcirFields('w', { ccir: 'PIR-2' }, ids, r);
    assert.deepEqual(r.out, { errors: [], warns: [] });
    checkMessageCcirFields('w', { ccir: 'PIR-5' }, ids, r);
    assert.equal(r.out.warns.length, 1);
    assert.equal(r.out.errors.length, 0);
    checkReportCycleField({ reportCycle: { sitrep: -1 } }, r);
    assert.equal(r.out.errors.length, 1);
    assert.equal(checkCcirFile(undefined, r).size, 0);
  });
});

describe('T48 — domena CCIR', () => {
  test('add / update / remove / limit', () => {
    let items = [];
    items = addCcirItem(items, 'PIR').items;
    items = addCcirItem(items, 'PIR').items;
    items = addCcirItem(items, 'FFIR').items;
    assert.deepEqual(items.map((i) => i.id), ['PIR-1', 'PIR-2', 'FFIR-1']);
    items = updateCcirItem(items, 'PIR-2', { text: 'czołgi' });
    assert.equal(items[1].text, 'czołgi');
    items = removeCcirItem(items, 'PIR-1');
    assert.equal(nextCcirId(items, 'PIR'), 'PIR-1');
    assert.ok(addCcirItem(items, 'XYZ').error);
    let full = [];
    for (let i = 0; i < CCIR_MAX; i += 1) full = addCcirItem(full, 'PIR').items;
    assert.ok(addCcirItem(full, 'FFIR').error);
  });

  test('geometria ustawiana i usuwana; puste pozycje pomijane przy zapisie', () => {
    const g = { type: 'Point', coordinates: [22, 54] };
    let items = setCcirGeometry(three, 'PIR-1', g);
    assert.deepEqual(items[0].geometry, g);
    items = setCcirGeometry(items, 'PIR-1', null);
    assert.equal('geometry' in items[0], false);
    const c = cleanCcirItems([it('PIR-1', '  a '), it('PIR-2', '  ')]);
    assert.equal(c.items.length, 1);
    assert.equal(c.items[0].text, 'a');
    assert.equal(c.dropped, 1);
  });

  const msgs = [
    { id: 'a', direction: 'in', ccir: 'PIR-1', turn: 2, time: '2026-05-14T08:10:00+02:00' },
    { id: 'b', direction: 'in', turn: 2, time: '2026-05-14T08:20:00+02:00' },
    { id: 'c', direction: 'in', report: 'sitrep', turn: 2, time: '2026-05-14T09:00:00+02:00' },
    { id: 'd', direction: 'in', report: 'sitrep', turn: 2, time: '2026-05-14T08:30:00+02:00' },
    { id: 'e', direction: 'in', report: 'logstat', turn: 2, time: '2026-05-14T08:40:00+02:00' },
    { id: 'f', direction: 'in', report: 'sitrep', turn: 3, time: '2026-05-14T11:00:00+02:00' },
  ];

  test('filtr "tylko CCIR"', () => {
    assert.equal(filterCcir(msgs, false).length, msgs.length);
    assert.deepEqual(filterCcir(msgs, true).map((m) => m.id), ['a']);
  });

  test('grupowanie meldunków cyklicznych: rodzaj x tura, najwcześniejszy czas, wg czasu', () => {
    const g = groupReports(msgs);
    assert.deepEqual(g.map((x) => [x.report, x.turn, x.count]), [['sitrep', 2, 2], ['logstat', 2, 1], ['sitrep', 3, 1]]);
    assert.equal(g[0].time, '2026-05-14T08:30:00+02:00');
    assert.deepEqual(groupReports([{ id: 'x', direction: 'out', report: 'sitrep', turn: 1, time: msgs[0].time }]), []);
  });

  test('oś czasu zlewa meldunki cykliczne w jeden znacznik na grupę', () => {
    const tl = buildTimeline({ currentTurn: 3, viewTurn: 3, start: '2026-05-14T06:00:00+02:00', turnMinutes: 120, messages: msgs });
    assert.equal(tl.lanes.msgs.filter((x) => x.report).length, 3);
    assert.equal(tl.lanes.msgs.length, 5); // a, b + trzy grupy
  });

  test('znaczniki i rytm', () => {
    const tags = ccirTags({ ccir: 'PIR-1', report: 'logstat' }, three);
    assert.deepEqual(tags.map((t) => t.label), ['PIR-1', 'LOGSTAT']);
    assert.ok(ccirTags({ ccir: 'PIR-9' }, three)[0].title.includes('usunięta'));
    assert.equal(reportCycleText({ reportCycle: { sitrep: 240, logstat: 1440 } }), 'SITREP co 4 h, LOGSTAT co 24 h');
  });
});

describe('T48 — API /api/ccir', () => {
  let app;
  const put = (body) => fetch(app.base + '/api/ccir', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  before(async () => {
    app = await startApp((await makeScenario()).dir);
  });
  after(() => app.close());

  test('brak pliku to pusta lista; zapis i odczyt', async () => {
    assert.deepEqual(await (await app.get('/api/ccir')).json(), { items: [] });
    const res = await put({ items: [it('PIR-1', ' czołgi ')] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).items[0].text, 'czołgi');
    assert.equal((await (await app.get('/api/ccir')).json()).items.length, 1);
  });

  test('złe dane dają 400, a stary plik zostaje', async () => {
    const bodies = [{}, { items: 'x' }, { items: [{ id: 'PIR-1', kind: 'PIR', text: '' }] }, { items: [it('PIR-1', 'x', { evil: 1 })] }, { items: Array.from({ length: 8 }, (_, i) => it(`PIR-${i + 1}`)) }];
    for (const body of bodies) assert.equal((await put(body)).status, 400, JSON.stringify(body).slice(0, 60));
    assert.equal((await (await app.get('/api/ccir')).json()).items[0].id, 'PIR-1');
  });

  test('nieprawidłowy JSON daje 400', async () => {
    const res = await fetch(app.base + '/api/ccir', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' });
    assert.equal(res.status, 400);
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { unitCard, contactCard, assetCard, meterClass, inspectorHead, supplyCard, historyCard } from '../public/js/domain/cards.js';

const unit = { id: 'bcz', name: 'bcz', sidc: 'SFGPUCAT---F---', status: 'gotowy', strength: 1, task: 'odwód', pos: [22.9, 54.1], personnel: { current: 610, authorized: 650 }, equipment: [{ name: 'czołgi', current: 41, authorized: 44 }] };

describe('Inspektor — karty obiektów', () => {
  test('karta jednostki: stan osobowy, sprzęt, pozycja (DMS, MGRS), chipy przełożonego i podległych', () => {
    const parent = { id: 'hq', name: 'ZT <Hańcza>', sidc: 'SFGPUCIZ--AH---' };
    const html = unitCard({ ...unit, parent: 'hq' }, new Map([['hq', parent]]), [{ id: 'bcz-1k', name: '1k bcz' }], { header: false, turnTime: '2026-05-14T06:00:00+02:00', tz: 'Europe/Warsaw' });
    assert.match(html, /610<small>\/ 650 · 94%<\/small>/);
    assert.match(html, /41\/44/);
    assert.match(html, /data-unit="hq"/);
    assert.match(html, /data-unit="bcz-1k"/);
    assert.ok(!html.includes('<Hańcza>')); // escapowanie
    assert.match(html, /stan na 06:00/);
    assert.match(html, /54°06′00″N/);
    assert.match(html, /34U [A-Z]{2} \d{5} \d{5}/);
  });

  test('nagłówek <h4> tylko gdy header !== false', () => {
    assert.match(unitCard(unit, new Map(), []), /<h4>bcz<\/h4>/);
    assert.ok(!unitCard(unit, new Map(), [], { header: false }).includes('<h4>'));
    assert.ok(!assetCard({ id: 'a', name: 'A' }, { header: false }).includes('<h4>'));
  });

  test('pasek siły: progi 80% / 50% zwracają klasy', () => {
    assert.equal(meterClass(0.94), '');
    assert.equal(meterClass(0.58), 'warn');
    assert.equal(meterClass(0.3), 'bad');
    assert.equal(meterClass(null), '');
  });

  test('jednostka bez stanu osobowego pokazuje ukompletowanie z pola strength', () => {
    const html = unitCard({ id: 'x', name: 'x', sidc: 'SFGPUCI-------', strength: 0.5 }, new Map(), [], { header: false });
    assert.match(html, /50<small>% ukompletowania/);
    assert.match(html, /meter warn/);
  });

  test('karta kontaktu: wiek, szacunek sił z plakietką NIE PRAWDA, niepewność', () => {
    const html = contactCard(
      { id: 'c-001', sidc: 'SHGPUCIZ---F---', estimate: 'BGT', observed: '2026-05-14T05:00:00+02:00', source: 'BSP-1', confidence: 'niska', uncertainty_m: 500, pos: [22.6, 54.4], estimate_personnel: { count: 400, approx: true }, estimate_equipment: [{ name: 'BTR', count: 30, approx: true }] },
      '2026-05-14T06:00:00+02:00',
      'Europe/Warsaw',
      { header: false },
    );
    assert.match(html, /NIE PRAWDA/);
    assert.match(html, /± 0\.5 km/);
    assert.match(html, /1 h temu/);
    assert.match(html, /~400/);
    assert.match(html, /~30/);
    assert.match(html, /tag rep warn/); // niska pewność = bursztyn
  });

  test('nagłówek inspektora i zakładki Zaopatrzenie / Historia', () => {
    const head = inspectorHead({ symbol: '<svg></svg>', title: 'A <b>', sub: 'sub', sidc: 'SFGPUCI-------', status: 'w obronie', ratio: 0.4 });
    assert.match(head, /A &lt;b&gt;/);
    assert.match(head, /var\(--danger\)/);
    assert.match(supplyCard(), /WARSTWA LOGISTYCZNA/);
    assert.match(historyCard([], 'Europe/Warsaw'), /Brak wpisów/);
    const h = historyCard([{ direction: 'out', time: '2026-05-14T06:00:00+02:00', text: 'rozkaz' }, { direction: 'in', time: '2026-05-14T07:00:00+02:00', text: 'przyjąłem' }], 'Europe/Warsaw');
    assert.ok(h.indexOf('przyjąłem') < h.indexOf('rozkaz')); // najnowsze u góry
  });
});

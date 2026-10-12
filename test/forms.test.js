// T50 — formularze meldunków i rozkazów: domena, schemat współdzielony, walidator scenariusza, serwer.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeScenario, startApp } from './helpers.js';
import { validateScenario } from '../tools/validate.js';
import { FORM_KINDS, checkFormShape, MAX_FORM_VALUE } from '../shared/form.js';
import { FORM_IDS, FORMS, formText, formRows, missingFields, checkFormContent, emptyForm, setFormField } from '../public/js/domain/forms.js';

const pt = { type: 'Point', coordinates: [22.9, 54.1] };
const spotrep = (over = {}) => ({
  kind: 'spotrep',
  fields: { what: 'kolumna', count: '~10', where: pt, when: '07:22', certainty: 'średnia', ...over },
});

describe('domena formularzy', () => {
  test('FORM_KINDS (shared) zgodne z FORM_IDS (domain)', () => {
    assert.deepEqual([...FORM_KINDS], FORM_IDS);
  });
  test('brakujące pola wymagane', () => {
    assert.deepEqual(missingFields(emptyForm('spotrep')).length, FORMS.spotrep.fields.filter((f) => f.required).length);
    assert.deepEqual(missingFields(spotrep()), []);
    assert.deepEqual(missingFields(spotrep({ what: '   ' })), ['Co']);
  });
  test('setFormField usuwa puste i ignoruje nieznane pole', () => {
    let f = setFormField(emptyForm('spotrep'), 'what', 'x');
    assert.equal(f.fields.what, 'x');
    f = setFormField(f, 'what', '');
    assert.equal('what' in f.fields, false);
    assert.equal(setFormField(f, 'nope', 'x'), f);
  });
  test('tekst: nagłówek, etykiety, tylko wypełnione pola', () => {
    const t = formText(spotrep());
    assert.match(t, /^SPOTREP\nCo: kolumna\nIle: ~10\nGdzie: /);
    assert.doesNotMatch(t, /Uwagi/);
    assert.equal(formRows(spotrep()).length, 5);
    assert.equal(formText({ kind: 'x', fields: {} }), '');
  });
  test('checkFormContent: nieznane pole, zła opcja, zły rodzaj geometrii', () => {
    assert.equal(checkFormContent(spotrep()), null);
    assert.match(checkFormContent(spotrep({ zzz: 'a' })), /nieznane pole/);
    assert.match(checkFormContent(spotrep({ certainty: 'pewna' })), /dozwolone/);
    assert.match(checkFormContent(spotrep({ where: { type: 'LineString', coordinates: [[1, 1], [2, 2]] } })), /nie przyjmuje/);
    assert.match(checkFormContent(spotrep({ what: pt })), /nieodpowiedniego rodzaju/);
    assert.match(checkFormContent({ kind: 'x' }), /Nieznany/);
  });
});

describe('checkFormShape', () => {
  test('poprawny i błędne', () => {
    assert.equal(checkFormShape(spotrep()), null);
    assert.ok(checkFormShape(null));
    assert.ok(checkFormShape([]));
    assert.ok(checkFormShape({ kind: 'nope', fields: {} }));
    assert.ok(checkFormShape({ kind: 'spotrep' }));
    assert.ok(checkFormShape({ kind: 'spotrep', fields: {}, side: 'RU' }));
    assert.ok(checkFormShape({ kind: 'spotrep', fields: { what: 'a'.repeat(MAX_FORM_VALUE + 1) } }));
    assert.ok(checkFormShape({ kind: 'spotrep', fields: { what: true } }));
    assert.ok(checkFormShape({ kind: 'spotrep', fields: { what: Infinity } }));
    assert.ok(checkFormShape({ kind: 'spotrep', fields: { where: { type: 'Point', coordinates: [999, 999] } } }));
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`f${i}`, 'x']));
    assert.ok(checkFormShape({ kind: 'spotrep', fields: many }));
  });
});

describe('walidator scenariusza: form', () => {
  const msg = (form) => ({ id: 'm-1', channel: 'dow', from: 'Dowództwo', time: '2026-05-14T05:30:00+02:00', text: 'x', form });
  const formIssues = (r) => [...r.errors, ...r.warnings].filter((x) => /formularz|form/i.test(x));

  test('outbox: poprawny przechodzi, zły i niekompletny to błędy', async () => {
    const sc = await makeScenario({ turns: [0] });
    await sc.write('player/outbox/000.json', { messages: [msg(spotrep())] });
    assert.deepEqual(formIssues(await validateScenario(sc.dir)), []);
    await sc.write('player/outbox/000.json', { messages: [msg({ kind: 'nope', fields: {} })] });
    assert.ok(formIssues(await validateScenario(sc.dir)).length);
    await sc.write('player/outbox/000.json', { messages: [msg({ kind: 'spotrep', fields: { what: 'a' } })] });
    assert.ok((await validateScenario(sc.dir)).errors.some((x) => /wymaganych/.test(x)));
  });
  test('inbox: brak pól wymaganych to tylko uwaga, zły kind to błąd', async () => {
    const sc = await makeScenario({ turns: [0] });
    await sc.write('player/inbox/000.json', { messages: [msg({ kind: 'spotrep', fields: { what: 'a' } })] });
    let r = await validateScenario(sc.dir);
    assert.ok(r.warnings.some((x) => /wymaganych/.test(x)));
    assert.ok(!r.errors.some((x) => /wymaganych/.test(x)));
    await sc.write('player/inbox/000.json', { messages: [msg({ kind: 'nope', fields: {} })] });
    r = await validateScenario(sc.dir);
    assert.ok(r.errors.some((x) => /kind/.test(x)));
  });
});

describe('serwer: POST /api/outbox z form', () => {
  let app;
  before(async () => {
    const sc = await makeScenario({ turns: [0, 1] });
    app = await startApp(sc.dir);
  });
  after(() => app.close());
  const post = (form, text = 'SPOTREP') => app.post('/api/outbox', { channel: 'dow', text, type: 'meldunek', form });

  test('poprawny formularz → 201 i form w wiadomości', async () => {
    const r = await post(spotrep());
    assert.equal(r.status, 201);
    assert.deepEqual((await r.json()).form, spotrep());
  });
  test('zły kind, nieznane pole, brak wymaganych, zła geometria → 400', async () => {
    assert.equal((await post({ kind: 'nope', fields: {} })).status, 400);
    assert.equal((await post(spotrep({ zzz: 'a' }))).status, 400);
    assert.equal((await post({ kind: 'spotrep', fields: { what: 'a' } })).status, 400);
    assert.equal((await post(spotrep({ where: { type: 'Point', coordinates: [500, 1] } }))).status, 400);
    assert.equal((await post('spotrep')).status, 400);
  });
});

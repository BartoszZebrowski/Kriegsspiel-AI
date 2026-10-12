import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { linkify } from '../public/js/domain/linkify.js';
import { validateScenario } from '../tools/validate.js';
import { makeScenario, startApp } from './helpers.js';

const places = [
  { id: 'sejny', name: 'Sejny', kind: 'miasto', pos: [23.35, 54.1], forms: ['Sejny', 'Sejn', 'Sejnach'] },
  { id: 'rutka-tartak', name: 'Rutka-Tartak', kind: 'wieś', pos: [22.97, 54.32], forms: ['Rutka-Tartak'] },
  { id: 'rutka', name: 'Rutka', kind: 'wieś', pos: [22.84, 54.21], forms: ['Rutka'] },
  { id: 'dart-w', name: 'Dart', kind: 'wieś', pos: [22.0, 54.0], forms: ['Dart'] },
  { id: 'dk8', name: 'DK8', kind: 'droga', pos: [22.8, 53.98], forms: ['DK8', 'DK 8'] },
];
const units = [
  { id: '1bzmot', name: '1 bzmot', task: 'obrona' },
  { id: '1bzmot-1k', name: '1k 1bzmot' },
  { id: 'dart', name: 'dart' },
  { id: 'bcz', name: 'bcz' },
  { id: 'zt-biebrza', name: 'ZT Biebrza' },
];
const contacts = [{ id: 'c-001', estimate: 'BGT', confidence: 'średnia' }];
const assets = [{ id: 'bsp-1', name: 'BSP-1', pos: [22.7, 54.3] }, { id: 'bsp-2', name: 'BSP-2' }];
const ctx = { places, units, contacts, assets };

const kinds = (html) => [...html.matchAll(/data-mention-kind="(\w+)" data-mention-id="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);

describe('T12.3 — linkify', () => {
  test('odmiany miejsc linkują się do tego samego id', () => {
    assert.deepEqual(kinds(linkify('Z Sejn i w Sejnach, Sejny', ctx)), ['place:sejny', 'place:sejny', 'place:sejny']);
  });

  test('granice słów Unicode: Sejnyx nie pasuje', () => {
    assert.deepEqual(kinds(linkify('Sejnyx oraz ASejny', ctx)), []);
  });

  test('miejsce wymaga wielkiej litery', () => {
    assert.deepEqual(kinds(linkify('sejny', ctx)), []);
    assert.deepEqual(kinds(linkify('Sejny', ctx)), ['place:sejny']);
  });

  test('nazwy jednostek są wrażliwe na wielkość liter, a „dart” to jednostka, nie miejsce', () => {
    assert.deepEqual(kinds(linkify('dart strzela', ctx)), ['unit:dart']);
    assert.deepEqual(kinds(linkify('Dart strzela', ctx)), ['place:dart-w']);
    assert.deepEqual(kinds(linkify('BCZ', ctx)), []);
  });

  test('najdłuższe dopasowanie wygrywa i nie nakłada się', () => {
    assert.deepEqual(kinds(linkify('1k 1bzmot', ctx)), ['unit:1bzmot-1k']);
    assert.deepEqual(kinds(linkify('1 bzmot i 1bzmot', ctx)), ['unit:1bzmot', 'unit:1bzmot']);
    assert.deepEqual(kinds(linkify('Rutka-Tartak, Rutka', ctx)), ['place:rutka-tartak', 'place:rutka']);
  });

  test('kontakty, środki i warianty cudzysłowu', () => {
    assert.deepEqual(kinds(linkify('c-001 widziany przez BSP-1, nie BSP-2', ctx)), ['contact:c-001', 'asset:bsp-1']);
    assert.deepEqual(kinds(linkify('ZT „Biebrza” i ZT Biebrza', ctx)), ['unit:zt-biebrza', 'unit:zt-biebrza']);
  });

  test('klasy CSS: miejsce, swój, wróg', () => {
    const html = linkify('Sejny bcz c-001', ctx);
    assert.match(html, /mention--place/);
    assert.match(html, /mention--own/);
    assert.match(html, /mention--enemy/);
  });

  test('HTML jest escapowany, także wokół linków', () => {
    const html = linkify('<script>alert(1)</script> & Sejny "x"', ctx);
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; <button/);
    assert.match(html, /&quot;x&quot;$/);
  });

  test('specjalne znaki w nazwach nie psują wyrażeń regularnych', () => {
    const html = linkify('trasa DK 8 i DK8.', ctx);
    assert.deepEqual(kinds(html), ['place:dk8', 'place:dk8']);
  });

  test('puste dane: sam escapowany tekst', () => {
    assert.equal(linkify('a < b', {}), 'a &lt; b');
  });
});

describe('T34 — linkowanie bez kolizji nazw', () => {
  const ctx2 = { ...ctx, contacts: [{ id: 'c-002', name: 'bcz (RU)', estimate: 'batalion czołgów' }] };

  test('„bcz (RU)” nie linkuje do własnej jednostki bcz', () => {
    assert.deepEqual(kinds(linkify('bcz (RU) naciera', { ...ctx, contacts: [] })), []);
    assert.deepEqual(kinds(linkify('bcz(BY) naciera', { ...ctx, contacts: [] })), []);
    assert.deepEqual(kinds(linkify('bcz naciera', { ...ctx, contacts: [] })), ['unit:bcz']);
  });

  test('nazwa kontaktu wygrywa z krótszą nazwą jednostki', () => {
    assert.deepEqual(kinds(linkify('bcz (RU) naciera', ctx2)), ['contact:c-002']);
    assert.deepEqual(kinds(linkify('bcz (RU) i bcz', ctx2)), ['contact:c-002', 'unit:bcz']);
  });

  test('najdłuższe pierwsze: „1k 1bzmot” i miejsca z myślnikiem', () => {
    assert.deepEqual(kinds(linkify('1k 1bzmot (RU)', { ...ctx, contacts: [] })), []);
    assert.deepEqual(kinds(linkify('1k 1bzmot melduje', ctx2)), ['unit:1bzmot-1k']);
  });
});

describe('T12.3 — gazeter: API i walidator', () => {
  let app, sc;
  before(async () => {
    sc = await makeScenario();
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('GET /api/gazetteer: 404 bez pliku, lista po dodaniu', async () => {
    assert.equal((await app.get('/api/gazetteer')).status, 404);
    await sc.write('gazetteer.json', { places });
    const res = await app.get('/api/gazetteer');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).places.length, places.length);
  });

  test('walidator wykrywa błędy gazetera', async () => {
    await sc.write('gazetteer.json', { places });
    assert.deepEqual((await validateScenario(sc.dir)).errors.filter((e) => e.includes('gazetteer')), []);
    await sc.write('gazetteer.json', {
      places: [
        { id: 'a', name: 'A', kind: 'miasto', pos: [200, 10], forms: ['A'] },
        { id: 'a', name: 'B', kind: 'miasto', pos: [20, 10], forms: ['Bb'] },
        { id: 'c', name: 'C', kind: 'miasto', pos: [20, 10], forms: [] },
      ],
    });
    const errors = (await validateScenario(sc.dir)).errors.filter((e) => e.includes('gazetteer'));
    assert.equal(errors.length, 4); // pos, duplikat id, forms bez name, puste forms
  });
});

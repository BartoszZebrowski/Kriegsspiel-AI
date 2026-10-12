import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultTypeForChannel, emptyDraft, getDraft, draftType, isDraftEmpty, updateDraft, clearDraft,
  foreignUnitMentions, unknownPlaceNames, channelListModel,
} from '../public/js/domain/compose.js';
import { createStore } from '../public/js/core/store.js';
import { createController } from '../public/js/core/controller.js';

describe('compose — rodzaj domyślny', () => {
  test('podwładny → rozkaz, przełożony → meldunek, reszta → wiadomość', () => {
    assert.equal(defaultTypeForChannel({ kind: 'subordinate' }), 'rozkaz');
    assert.equal(defaultTypeForChannel({ kind: 'superior' }), 'meldunek');
    for (const kind of ['neighbor', 'recon', 'logistics', 'other']) assert.equal(defaultTypeForChannel({ kind }), 'wiadomosc');
    assert.equal(defaultTypeForChannel(null), 'rozkaz');
  });
  test('draftType: jawny wybór wygrywa z domyślnym', () => {
    assert.equal(draftType({ type: null }, { kind: 'superior' }), 'meldunek');
    assert.equal(draftType({ type: 'rozkaz' }, { kind: 'superior' }), 'rozkaz');
  });
});

describe('compose — szkice per kanał', () => {
  test('szkic 1bzmot nie przechodzi do 2bzmot i wraca po powrocie', () => {
    let d = {};
    d = updateDraft(d, '1bzmot', { text: 'natrzeć', urgent: true });
    assert.equal(getDraft(d, '2bzmot').text, '');
    assert.equal(getDraft(d, '2bzmot').urgent, false);
    d = updateDraft(d, '2bzmot', { text: 'bronić' });
    assert.equal(getDraft(d, '1bzmot').text, 'natrzeć');
    assert.equal(getDraft(d, '1bzmot').urgent, true);
    assert.equal(getDraft(d, '2bzmot').text, 'bronić');
  });
  test('updateDraft scala patch, nie mutuje wejścia i zwraca nową mapę', () => {
    const d0 = { a: { text: 'x', type: null, urgent: false, attachIds: [] } };
    const frozen = structuredClone(d0);
    const d1 = updateDraft(d0, 'a', { type: 'meldunek' });
    assert.deepEqual(d0, frozen);
    assert.notEqual(d1, d0);
    assert.equal(d1.a.text, 'x');
    assert.equal(d1.a.type, 'meldunek');
  });
  test('brak kanału: mapa bez zmian; getDraft zwraca świeży pusty szkic', () => {
    assert.deepEqual(updateDraft({ a: emptyDraft() }, null, { text: 'x' }), { a: emptyDraft() });
    const e1 = getDraft({}, 'x');
    e1.attachIds.push('n1'); // mutacja zwróconego pustego szkicu nie psuje kolejnych
    assert.deepEqual(getDraft({}, 'x').attachIds, []);
  });
  test('clearDraft usuwa tylko wskazany kanał, bez mutacji', () => {
    const d0 = updateDraft(updateDraft({}, 'a', { text: '1' }), 'b', { text: '2' });
    const d1 = clearDraft(d0, 'a');
    assert.equal(getDraft(d1, 'a').text, '');
    assert.equal(getDraft(d1, 'b').text, '2');
    assert.equal(d0.a.text, '1');
    assert.equal(clearDraft(d1, 'zzz'), d1);
  });
  test('isDraftEmpty', () => {
    assert.equal(isDraftEmpty(emptyDraft()), true);
    assert.equal(isDraftEmpty({ ...emptyDraft(), text: '  ' }), true);
    assert.equal(isDraftEmpty({ ...emptyDraft(), text: 'x' }), false);
    assert.equal(isDraftEmpty({ ...emptyDraft(), attachIds: ['n'] }), false);
    assert.equal(isDraftEmpty({ ...emptyDraft(), urgent: true }), false);
  });
});

const UNITS = [
  { id: 'bn1', name: '1 batalion', parent: 'hq' },
  { id: 'k11', name: '1 kompania', parent: 'bn1' },
  { id: 'bn2', name: '2 batalion', parent: 'hq' },
  { id: 'hq', name: 'ZT Test' },
];

describe('compose — wzmianki', () => {
  test('foreignUnitMentions: inna jednostka tak, adresat i jego podwładni nie', () => {
    const r = foreignUnitMentions('Wsparcie od 2 batalion oraz 1 kompania, 1 batalion trzyma', 'bn1', UNITS);
    assert.deepEqual(r.map((u) => u.id), ['bn2']);
  });
  test('foreignUnitMentions: bez powtórzeń, puste wejścia', () => {
    const r = foreignUnitMentions('2 batalion i znów 2 batalion', 'bn1', UNITS);
    assert.equal(r.length, 1);
    assert.deepEqual(foreignUnitMentions('', 'bn1', UNITS), []);
    assert.deepEqual(foreignUnitMentions('2 batalion', 'bn1', []), []);
  });
  test('unknownPlaceNames: nazwa spoza gazetera tak, znana nie, skrót wielkimi nie', () => {
    const ctx = { places: [{ id: 'p1', name: 'Wiżajny', forms: ['Wiżajny', 'Wiżajn'] }], units: UNITS };
    const r = unknownPlaceNames('Ruszyć do Wiżajn, potem w Żytkiejmy, MSR do Zebra', ctx);
    assert.deepEqual(r.map((p) => p.text), ['Żytkiejmy', 'Zebra']);
    assert.deepEqual(unknownPlaceNames('', ctx), []);
    assert.deepEqual(unknownPlaceNames('do MSR', ctx), []);
  });
  test('unknownPlaceNames: pozycje wskazują fragment tekstu, bez powtórzeń', () => {
    const t = 'przez Gołdap i znów przez Gołdap';
    const r = unknownPlaceNames(t, {});
    assert.equal(r.length, 1);
    assert.equal(t.slice(r[0].start, r[0].end), 'Gołdap');
  });
});

describe('compose — lista kanałów', () => {
  const CH = [
    { id: 'dd', name: 'Dowódca dywizji', kind: 'superior' },
    { id: 's2', name: 'Szef S2', kind: 'other' },
    { id: 'zt', name: 'ZT Mamry', kind: 'neighbor' },
    { id: 'bn1', name: '1 batalion', kind: 'subordinate' },
    { id: 'k11', name: '1 kompania', kind: 'subordinate', auto: true },
  ];
  const ids = (m) => m.flatMap((g) => g.channels.map((c) => c.id));
  test('bez zapytania ukrywa kanały automatyczne', () => {
    assert.deepEqual(ids(channelListModel(CH)), ['dd', 's2', 'zt', 'bn1']);
  });
  test('zapytanie szuka bez polskich znaków i wielkości liter, także w kanałach auto', () => {
    assert.deepEqual(ids(channelListModel(CH, { query: 'KOMPANIA' })), ['k11']);
    assert.deepEqual(ids(channelListModel(CH, { query: 'dowodca' })), ['dd']);
    assert.deepEqual(ids(channelListModel(CH, { query: 'xyz' })), []);
  });
  test('kanał aktywny jest zawsze widoczny', () => {
    assert.ok(ids(channelListModel(CH, { activeId: 'k11' })).includes('k11'));
    assert.ok(ids(channelListModel(CH, { query: 'xyz', activeId: 'dd' })).includes('dd'));
  });
});

describe('Kontroler — szkice', () => {
  async function setup() {
    const turn = { turn: 0, time: '2026-05-14T06:00:00+02:00', units: [], contacts: [], assets: [], lines: [] };
    const sent = [];
    const api = {
      scenario: async () => ({
        scenario: {
          id: 't', title: 'T', timezone: 'Europe/Warsaw', turnMinutes: 120, start: '2026-05-14T06:00:00+02:00',
          channels: [{ id: 'a', name: 'A', kind: 'superior' }, { id: 'b', name: 'B', kind: 'subordinate' }],
        },
        turns: [0],
        currentTurn: 0,
      }),
      turn: async () => structuredClone(turn),
      notes: async () => ({ turn: 0, items: [] }),
      messages: async () => ({ messages: [] }),
      gazetteer: async () => [],
      briefing: async () => '',
      send: async (channel, text) => (sent.push(channel), { id: `o-${sent.length}`, channel, turn: 0, text, time: turn.time }),
    };
    const store = createStore();
    const storage = { load: (k, f) => (k.includes('briefing') ? true : f), save() {} };
    const controller = createController({ store, api, storage });
    await controller.init();
    await controller.load();
    return { store, controller, S: () => store.get() };
  }

  test('setDraft jest per kanał, pochodna draft podąża za aktywnym kanałem', async () => {
    const { controller, S } = await setup();
    controller.selectChannel('a');
    controller.setDraft('a', { text: 'melduję' });
    controller.selectChannel('b');
    assert.equal(S().draft.text, '');
    controller.setDraft('b', { text: 'rozkaz' });
    controller.selectChannel('a');
    assert.equal(S().draft.text, 'melduję');
  });

  test('sendMessage czyści szkic tylko wysłanego kanału', async () => {
    const { controller, S } = await setup();
    controller.selectChannel('a');
    controller.setDraft('a', { text: 'x' });
    controller.setDraft('b', { text: 'y' });
    await controller.sendMessage('x');
    assert.equal(S().drafts.a, undefined);
    assert.equal(S().drafts.b.text, 'y');
  });

  test('clearChannelDraft i setDraft bez kanału', async () => {
    const { controller, S } = await setup();
    controller.setDraft(null, { text: 'x' });
    assert.deepEqual(S().drafts, {});
    controller.setDraft('a', { text: 'x' });
    controller.clearChannelDraft('a');
    assert.deepEqual(S().drafts, {});
  });
});

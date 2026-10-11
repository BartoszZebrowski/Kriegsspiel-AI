import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, initialState } from '../public/js/core/store.js';

describe('Store — subskrypcje per plaster', () => {
  test('powiadamia tylko subskrybentów zmienionego klucza', () => {
    const store = createStore();
    const seen = { turn: 0, notes: 0, all: 0 };
    store.subscribe('turn', () => seen.turn++);
    store.subscribe(['notes', 'places'], () => seen.notes++);
    store.subscribe('*', () => seen.all++);
    store.set({ notes: [{ id: 'n1' }] });
    assert.deepEqual(seen, { turn: 0, notes: 1, all: 1 });
    store.set({ turn: { turn: 1, units: [] } });
    assert.deepEqual(seen, { turn: 1, notes: 1, all: 2 });
  });

  test('ta sama referencja nie wywołuje powiadomienia', () => {
    const store = createStore();
    const turn = { turn: 0, units: [] };
    store.set({ turn });
    let calls = 0;
    store.subscribe('turn', () => calls++);
    assert.deepEqual(store.set({ turn }), []);
    assert.equal(calls, 0);
  });

  test('jedno set z kilkoma kluczami = jedno powiadomienie z listą zmian', () => {
    const store = createStore();
    const calls = [];
    store.subscribe(['viewTurn', 'turn'], (_s, changed) => calls.push([...changed].sort()));
    store.set({ viewTurn: 2, turn: { turn: 2, units: [] }, places: [] });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].filter((k) => k === 'viewTurn' || k === 'turn'), ['turn', 'viewTurn']);
  });

  test('immediate wywołuje subskrybenta od razu, unsubscribe wyłącza', () => {
    const store = createStore();
    let n = 0;
    const off = store.subscribe('details', () => n++, { immediate: true });
    assert.equal(n, 1);
    store.set({ details: 'a' });
    assert.equal(n, 2);
    off();
    store.set({ details: 'b' });
    assert.equal(n, 2);
  });

  test('set wywołany z subskrybenta jest kolejkowany i widziany w stanie', () => {
    const store = createStore();
    const order = [];
    store.subscribe('details', () => {
      order.push('details');
      store.set({ hoverUnit: 'x' });
      order.push('po-set'); // powiadomienie hoverUnit dopiero po zakończeniu bieżącego
    });
    store.subscribe('hoverUnit', (s) => order.push('hover:' + s.hoverUnit));
    store.set({ details: 'u1' });
    assert.deepEqual(order, ['details', 'po-set', 'hover:x']);
  });
});

describe('Store — wartości pochodne', () => {
  test('archive jest jedynym źródłem flagi: viewTurn !== currentTurn', () => {
    const store = createStore();
    assert.equal(store.get().archive, false);
    const flags = [];
    store.subscribe('archive', (s) => flags.push(s.archive));
    store.set({ currentTurn: 3, viewTurn: 3 });
    assert.deepEqual(flags, []); // nadal false — bez powiadomienia
    store.set({ viewTurn: 2 });
    assert.equal(store.get().archive, true);
    store.set({ currentTurn: 4 });
    assert.equal(store.get().archive, true);
    store.set({ viewTurn: 4 });
    assert.equal(store.get().archive, false);
    assert.deepEqual(flags, [true, false]);
  });

  test('visibleMessages: w archiwum tylko do oglądanej tury; unread liczy widoczne', () => {
    const store = createStore();
    store.set({
      scenario: { id: 's', channels: [{ id: 'dd', name: 'DD', kind: 'superior' }] },
      turn: { units: [] },
      messages: [
        { id: 'a', channel: 'dd', turn: 0, direction: 'in', text: 'x' },
        { id: 'b', channel: 'dd', turn: 1, direction: 'in', text: 'y' },
        { id: 'c', channel: 'dd', turn: 1, direction: 'out', text: 'z' },
      ],
      currentTurn: 1,
      viewTurn: 1,
    });
    assert.equal(store.get().visibleMessages.length, 3);
    assert.equal(store.get().unread.total, 2);
    store.set({ viewTurn: 0 });
    assert.deepEqual(store.get().visibleMessages.map((m) => m.id), ['a']);
    assert.equal(store.get().unread.total, 1);
    store.set({ read: new Set(['a']) });
    assert.equal(store.get().unread.total, 0);
  });

  test('channels = kanały scenariusza + jednostki z parent; channel i channelUnit wynikają z activeChannel', () => {
    const store = createStore();
    store.set({
      scenario: { id: 's', channels: [{ id: 'log', name: 'Log', kind: 'logistics', unit: 'blog' }] },
      turn: { units: [{ id: 'bn', name: 'Bat', parent: 'hq' }, { id: 'hq', name: 'HQ' }] },
      activeChannel: 'bn',
    });
    assert.deepEqual(store.get().channels.map((c) => c.id), ['log', 'bn']);
    assert.equal(store.get().channel.id, 'bn');
    assert.equal(store.get().channelUnit, 'bn');
    store.set({ activeChannel: 'log' });
    assert.equal(store.get().channelUnit, 'blog');
    store.set({ activeChannel: 'nie-ma' });
    assert.equal(store.get().channel, null);
    assert.equal(store.get().channelUnit, null);
  });

  test('level: ręczny wybór ma pierwszeństwo, automat wg zoomu', () => {
    const store = createStore();
    store.set({ mapZoom: 9 });
    assert.equal(store.get().level, 'battalion');
    store.set({ mapZoom: 12 });
    assert.equal(store.get().level, 'company');
    store.set({ detail: 'battalion' });
    assert.equal(store.get().level, 'battalion');
  });

  test('initialState nie dzieli referencji między instancjami', () => {
    const a = initialState();
    const b = initialState();
    assert.notEqual(a.read, b.read);
    assert.notEqual(a.layers, b.layers);
  });
});

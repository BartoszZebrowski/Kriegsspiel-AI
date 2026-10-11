import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../public/js/core/store.js';
import { createController } from '../public/js/core/controller.js';

// Fałszywe API: dane w pamięci, opcjonalne opóźnienia sterowane z testu (bez sieci i bez DOM).
function makeApi({ turns = [0, 1], messages = [], notes = {}, places = [] } = {}) {
  const gate = {}; // n -> { promise, release } — wstrzymuje odpowiedź api.turn(n)
  const calls = { turn: [], send: [], saveNotes: [], withdraw: [] };
  const api = {
    data: {
      scenario: { id: 'test', title: 'Test', timezone: 'Europe/Warsaw', turnMinutes: 120, channels: [{ id: 'dd', name: 'DD', kind: 'superior' }] },
      turns,
      messages: structuredClone(messages),
      places,
      notes,
      turnData: Object.fromEntries(
        turns.map((n) => [
          n,
          {
            turn: n,
            time: `2026-05-14T0${6 + n * 2}:00:00+02:00`,
            units: [
              { id: 'bn', name: 'Batalion', sidc: 'SFGPUCIZ---F---', pos: [22.9, 54.1], parent: 'hq' },
              { id: 'co', name: 'Kompania', sidc: 'SFGPUCIZ---E---', pos: [22.91, 54.11], parent: 'bn' },
              { id: 'hq', name: 'ZT', sidc: 'SFGPUCIZ--AH---', pos: [22.8, 54.0] },
            ],
            contacts: [{ id: 'c-001', sidc: 'SHGAUCAT---E---', pos: [23.0, 54.2] }],
            assets: [],
            lines: [],
          },
        ]),
      ),
    },
    calls,
    hold(n) {
      let release;
      const promise = new Promise((r) => (release = r));
      gate[n] = { promise, release };
      return release;
    },
    scenario: async () => ({ scenario: api.data.scenario, turns: api.data.turns, currentTurn: Math.max(...api.data.turns) }),
    turn: async (n) => {
      calls.turn.push(n);
      if (gate[n]) await gate[n].promise;
      return structuredClone(api.data.turnData[n]);
    },
    notes: async (n) => ({ turn: n, items: structuredClone(api.data.notes[n] || []) }),
    messages: async () => ({ messages: structuredClone(api.data.messages) }),
    gazetteer: async () => structuredClone(api.data.places),
    briefing: async () => '# Odprawa',
    send: async (channel, text, attachments, meta) => {
      calls.send.push({ channel, text, attachments, meta });
      return { id: 'out-1', channel, turn: Math.max(...api.data.turns), text, time: '2026-05-14T06:00:00+02:00' };
    },
    withdraw: async (id) => {
      calls.withdraw.push(id);
      return { ok: true };
    },
    saveNotes: async (turn, items) => {
      calls.saveNotes.push({ turn, items });
      api.data.notes[turn] = items;
      return { turn, items };
    },
  };
  return api;
}

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { load: (k, f) => (k in data ? data[k] : f), save: (k, v) => void (data[k] = v), data };
};

async function setup(opts = {}) {
  const api = makeApi(opts.api);
  const store = createStore();
  const storage = memoryStorage(opts.storage);
  const controller = createController({ store, api, storage, env: opts.env });
  await controller.init();
  if (!opts.skipLoad) await controller.load();
  return { api, store, storage, controller, S: () => store.get() };
}

describe('Kontroler — start', () => {
  test('domyślny podkład to Ciemna (Esri), gdy brak zapisanych preferencji', async () => {
    const { S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    assert.equal(S().basemap, 'Ciemna (Esri)');
  });

  test('init + load ustawiają scenariusz, bieżącą turę, notatki i wiadomości', async () => {
    const { S } = await setup({ api: { messages: [{ id: 'm1', channel: 'dd', turn: 0, direction: 'in', text: 'x' }], notes: { 1: [{ id: 'n1', name: 'a' }] } } });
    assert.equal(S().scenario.id, 'test');
    assert.equal(S().currentTurn, 1);
    assert.equal(S().viewTurn, 1);
    assert.equal(S().archive, false);
    assert.equal(S().turn.turn, 1);
    assert.equal(S().notes.length, 1);
    assert.equal(S().messages.length, 1);
    assert.equal(S().briefing.open, true); // pierwsze uruchomienie → odprawa
  });

  test('odprawa otwiera się tylko raz (flaga w storage)', async () => {
    const { S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    assert.equal(S().briefing.open, false);
  });

  test('preferencje z storage: szczegółowość, kanał, podkład, nakładki, docki', async () => {
    const { S } = await setup({ storage: { 'ks:test:detail': 'platoon', 'ks:test:channel': 'dd', 'ks:test:map': { base: 'Jasna (Esri)', overlays: ['Koleje'] }, 'ks:dock-l-collapsed': true, 'ks:test:briefing-seen': true } });
    assert.equal(S().detail, 'platoon');
    assert.equal(S().activeChannel, 'dd');
    assert.equal(S().basemap, 'Jasna (Esri)');
    assert.equal(S().layers['Koleje'], true);
    assert.equal(S().layers['Rzeźba terenu'], false);
    assert.equal(S().ui.leftCollapsed, true);
    assert.ok(S().pinned.includes('dd'));
    assert.equal(S().selection?.id, 'dd'); // zaznaczona jednostka kanału (nawet jeśli nie ma jej na mapie)
  });
});

describe('Kontroler — nawigacja po turach i wyścigi', () => {
  test('spóźniona odpowiedź starszego żądania jest odrzucana', async () => {
    const { api, controller, S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    const release = api.hold(0); // tura 0 odpowie dopiero na końcu
    const slow = controller.showTurn(0);
    const fast = controller.showTurn(1);
    await fast;
    release();
    assert.equal(await slow, false);
    assert.equal(S().viewTurn, 1);
    assert.equal(S().turn.turn, 1);
    assert.equal(S().archive, false);
  });

  test('ostatni klik wygrywa także wtedy, gdy odpowiedzi wracają w odwrotnej kolejności', async () => {
    const { api, controller, S } = await setup({ api: { turns: [0, 1, 2] }, storage: { 'ks:test:briefing-seen': true } });
    const release1 = api.hold(1);
    const a = controller.showTurn(1);
    const b = controller.showTurn(0);
    await b;
    release1();
    await a;
    assert.equal(S().viewTurn, 0);
    assert.equal(S().archive, true);
  });

  test('prev/next/current poruszają się po liście tur', async () => {
    const { controller, S } = await setup({ api: { turns: [0, 1, 2] }, storage: { 'ks:test:briefing-seen': true } });
    await controller.prevTurn();
    assert.equal(S().viewTurn, 1);
    await controller.prevTurn();
    assert.equal(S().viewTurn, 0);
    assert.equal(await controller.prevTurn(), false);
    await controller.nextTurn();
    assert.equal(S().viewTurn, 1);
    await controller.showCurrent();
    assert.equal(S().viewTurn, 2);
    assert.equal(S().archive, false);
  });

  test('zmiana tury jest jednym spójnym set-em (viewTurn, turn, notes razem)', async () => {
    const { controller, store } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    const snapshots = [];
    store.subscribe(['viewTurn', 'turn', 'notes'], (s) => snapshots.push([s.viewTurn, s.turn.turn]));
    await controller.showTurn(0);
    assert.deepEqual(snapshots, [[0, 0]]);
  });
});

describe('Kontroler — archiwum', () => {
  const msgs = [
    { id: 'a', channel: 'dd', turn: 0, direction: 'in', text: 'z tury 0' },
    { id: 'b', channel: 'dd', turn: 1, direction: 'in', text: 'z tury 1' },
  ];

  test('w archiwum widoczne są tylko wiadomości do oglądanej tury', async () => {
    const { controller, S } = await setup({ api: { messages: msgs }, storage: { 'ks:test:briefing-seen': true } });
    assert.equal(S().visibleMessages.length, 2);
    await controller.showTurn(0);
    assert.deepEqual(S().visibleMessages.map((m) => m.id), ['a']);
    assert.equal(S().unread.total, 1);
    await controller.showCurrent();
    assert.equal(S().visibleMessages.length, 2);
  });

  test('w archiwum nie można wysłać rozkazu ani zapisać szkicu', async () => {
    const { api, controller, S } = await setup({ storage: { 'ks:test:briefing-seen': true, 'ks:test:channel': 'dd' } });
    await controller.showTurn(0);
    assert.equal(await controller.sendMessage('rozkaz'), null);
    assert.equal(await controller.saveNotes([{ id: 'n' }]), null);
    assert.equal(api.calls.send.length, 0);
    assert.equal(api.calls.saveNotes.length, 0);
    assert.equal(S().notice.error, true);
  });
});

describe('Kontroler — odświeżenie SSE', () => {
  test('bez zmian po stronie serwera nikt nie dostaje powiadomienia', async () => {
    const { controller, store } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    const changed = [];
    store.subscribe('*', (_s, keys) => changed.push([...keys]));
    await controller.refresh();
    assert.deepEqual(changed, []);
  });

  test('nowa wiadomość zmienia tylko plaster messages — dane tury zostają tym samym obiektem', async () => {
    const { api, controller, store, S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    const turnRef = S().turn;
    const notesRef = S().notes;
    const changed = new Set();
    store.subscribe('*', (_s, keys) => keys.forEach((k) => changed.add(k)));
    api.data.messages.push({ id: 'm9', channel: 'dd', turn: 1, direction: 'in', text: 'nowa' });
    await controller.refresh();
    assert.ok(changed.has('messages'));
    assert.ok(!changed.has('turn') && !changed.has('notes') && !changed.has('viewTurn') && !changed.has('selection'));
    assert.equal(S().turn, turnRef);
    assert.equal(S().notes, notesRef);
  });

  test('zaznaczenie (inspektor) przeżywa odświeżenie', async () => {
    const { controller, S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    controller.selectEntity('bn');
    await controller.refresh();
    assert.equal(S().selection.id, 'bn');
  });

  test('zmiana danych oglądanej tury podmienia tylko turę; zaznaczenie znika, gdy obiektu już nie ma', async () => {
    const { api, controller, S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    controller.selectEntity('co');
    api.data.turnData[1].units = api.data.turnData[1].units.filter((u) => u.id !== 'co');
    await controller.refresh();
    assert.equal(S().selection, null);
    assert.equal(S().turn.units.length, 2);
  });

  test('nowa tura bieżąca przełącza widok i zgłasza komunikat', async () => {
    const { api, controller, S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    api.data.turns = [0, 1, 2];
    api.data.turnData[2] = { ...structuredClone(api.data.turnData[1]), turn: 2 };
    await controller.refresh();
    assert.equal(S().currentTurn, 2);
    assert.equal(S().viewTurn, 2);
    assert.equal(S().archive, false);
    assert.match(S().notice.text, /Tura 1 rozstrzygnięta/);
  });

  test('ręczna nawigacja w trakcie odświeżania nie jest nadpisana jego wynikiem', async () => {
    const { api, controller, S } = await setup({ api: { turns: [0, 1, 2] }, storage: { 'ks:test:briefing-seen': true } });
    await controller.showTurn(1);
    const release = api.hold(1);
    const refreshing = controller.refresh(); // pobiera oglądaną turę 1 i czeka
    await new Promise((r) => setImmediate(r));
    await controller.showTurn(0).catch(() => {}); // gate dotyczy tylko tury 1
    release();
    await refreshing;
    assert.equal(S().viewTurn, 0);
  });

  test('zdarzenia SSE nie nakładają się: drugie w trakcie pierwszego powtarza odświeżenie raz', async () => {
    const { api, controller } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    const before = api.calls.turn.length;
    const release = api.hold(1);
    const first = controller.onUpdate();
    controller.onUpdate();
    controller.onUpdate();
    await new Promise((r) => setImmediate(r));
    release();
    await first;
    assert.equal(api.calls.turn.length - before, 2); // dokładnie jedno powtórzenie
  });
});

describe('Kontroler — wybór obiektów', () => {
  test('selectEntity zaznacza i zleca wycentrowanie (pan:false nie przesuwa mapy)', async () => {
    const { controller, S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    assert.equal(controller.selectEntity('c-001'), true);
    assert.deepEqual(S().selection, { id: 'c-001', kind: 'contact' });
    assert.equal(S().focus.kind, 'entity');
    const nonce = S().focus.nonce;
    controller.selectEntity('bn', { pan: false });
    assert.equal(S().selection.id, 'bn');
    assert.equal(S().focus.nonce, nonce);
    assert.equal(controller.selectEntity('nie-ma'), false);
  });

  test('ukryta kompania odsłania poziom „kompania” i zapisuje wybór', async () => {
    const { controller, S, storage } = await setup({ storage: { 'ks:test:briefing-seen': true, 'ks:test:detail': 'battalion' } });
    controller.selectEntity('co');
    assert.equal(S().detail, 'company');
    assert.equal(storage.data['ks:test:detail'], 'company');
  });

  test('mentionClick: miejsce → focus place; brak jednostki → komunikat błędu', async () => {
    const place = { id: 'p1', name: 'Wiżajny', pos: [22.8, 54.3] };
    const { controller, S } = await setup({ api: { places: [place] }, storage: { 'ks:test:briefing-seen': true } });
    controller.mentionClick('place', 'p1');
    assert.equal(S().focus.kind, 'place');
    assert.equal(S().focus.place.name, 'Wiżajny');
    controller.mentionClick('unit', 'nie-ma');
    assert.equal(S().notice.error, true);
    controller.setLayerVisible('contacts', false);
    controller.mentionClick('contact', 'c-001');
    assert.match(S().notice.text, /warstwa wyłączona/);
    controller.setLayerVisible('contacts', true);
    controller.mentionClick('contact', 'c-001');
    assert.equal(S().selection.id, 'c-001');
  });

  test('clearSelection i hoverUnit zmieniają tylko swoje plastry', async () => {
    const { controller, S } = await setup({ storage: { 'ks:test:briefing-seen': true } });
    controller.selectEntity('bn');
    controller.hoverUnit('bn');
    assert.equal(S().hoverUnit, 'bn');
    controller.clearSelection();
    assert.equal(S().selection, null);
  });
});

describe('Kontroler — komunikator i szkice', () => {
  const opts = { api: { messages: [{ id: 'a', channel: 'dd', turn: 1, direction: 'in', text: 'x' }] }, storage: { 'ks:test:briefing-seen': true } };

  test('selectChannel oznacza wiadomości jako przeczytane i zapisuje wybór', async () => {
    const { controller, S, storage } = await setup(opts);
    assert.equal(S().unread.total, 1);
    controller.selectChannel('dd');
    assert.equal(S().unread.total, 0);
    assert.deepEqual(storage.data['ks:test:read'], ['a']);
    assert.equal(storage.data['ks:test:channel'], 'dd');
  });

  test('nowe wiadomości w aktywnym kanale są przeczytane tylko, gdy komunikator jest widoczny', async () => {
    let visible = false;
    const { api, controller, S } = await setup({ ...opts, env: { isPageVisible: () => visible } });
    controller.selectChannel('dd');
    api.data.messages.push({ id: 'b', channel: 'dd', turn: 1, direction: 'in', text: 'y' });
    await controller.refresh();
    assert.equal(S().unread.total, 1); // karta ukryta
    visible = true;
    api.data.messages.push({ id: 'c', channel: 'dd', turn: 1, direction: 'in', text: 'z' });
    await controller.refresh();
    assert.equal(S().unread.total, 0);
    controller.setDock('r', true);
    api.data.messages.push({ id: 'd', channel: 'dd', turn: 1, direction: 'in', text: 'w' });
    await controller.refresh();
    assert.equal(S().unread.total, 1); // panel zwinięty
    controller.setDock('r', false);
    assert.equal(S().unread.total, 0); // rozwinięcie oznacza jako przeczytane
  });

  test('sendMessage dopisuje wiadomość wychodzącą; withdrawMessage ją usuwa', async () => {
    const { api, controller, S } = await setup(opts);
    controller.selectChannel('dd');
    const msg = await controller.sendMessage('  rozkaz  ', ['n1']);
    assert.equal(msg.id, 'out-1');
    assert.deepEqual(api.calls.send[0], { channel: 'dd', text: 'rozkaz', attachments: ['n1'], meta: {} });
    await controller.sendMessage('pilne', [], { type: 'rozkaz', priority: 'urgent' });
    assert.deepEqual(api.calls.send[1].meta, { type: 'rozkaz', priority: 'urgent' });
    assert.equal(S().messages.at(-1).direction, 'out');
    assert.equal(await controller.withdrawMessage('out-1'), true);
    assert.ok(!S().messages.some((m) => m.id === 'out-1'));
  });

  test('selectChannel przypina kanał (zapis w storage), a unpinChannel go odpina', async () => {
    const { controller, S, storage } = await setup(opts);
    controller.selectChannel('bn');
    assert.ok(S().pinned.includes('bn'));
    assert.ok(storage.data['ks:test:pinned'].includes('bn'));
    controller.unpinChannel('bn');
    assert.ok(!S().pinned.includes('bn'));
  });

  test('separator NOWE: fresh zawiera wiadomości nieprzeczytane w chwili otwarcia kanału', async () => {
    const { controller, S } = await setup(opts);
    controller.selectChannel('dd');
    assert.deepEqual([...S().fresh], ['a']);
    assert.equal(S().unread.total, 0);
  });

  test('openUnitChannel otwiera kanał jednostki i rozwija prawy dok; jednostka bez kanału daje błąd', async () => {
    const { controller, S } = await setup(opts);
    controller.setDock('r', true);
    assert.equal(controller.openUnitChannel('bn'), true);
    assert.equal(S().activeChannel, 'bn');
    assert.equal(S().ui.rightCollapsed, false);
    assert.equal(controller.openUnitChannel('hq'), false);
    assert.equal(S().notice.error, true);
  });

  test('wiadomości pilne i nowe dają toast; skrzynka liczy wiadomości gracza z bieżącej tury', async () => {
    const { api, controller, S } = await setup(opts);
    api.data.messages.push({ id: 'u1', channel: 'dd', turn: 1, direction: 'in', from: 'gen. Nowicki, dowódca', priority: 'urgent', text: 'Pilny rozkaz' });
    await controller.refresh();
    assert.match(S().notice.title, /Nowicki · PILNE/);
    assert.equal(S().notice.urgent, true);
    assert.equal(S().notice.channel, 'dd');
    assert.ok(S().notices.length >= 1);
    controller.selectChannel('dd');
    await controller.sendMessage('x');
    assert.equal(S().outboxCount, 1);
  });

  test('saveNotes zapisuje listę tury i odświeża store.notes; odpowiedź dla innej tury jest ignorowana', async () => {
    const { api, controller, S } = await setup(opts);
    const saved = await controller.saveNotes([{ id: 'n1', name: 'Oś' }]);
    assert.equal(saved.length, 1);
    assert.equal(S().notes[0].id, 'n1');
    assert.equal(api.calls.saveNotes[0].turn, 1);
    // zmiana tury w trakcie zapisu
    const slow = api.saveNotes;
    let release;
    api.saveNotes = async (turn, items) => {
      await new Promise((r) => (release = r));
      return slow(turn, items);
    };
    const pending = controller.saveNotes([{ id: 'n2', name: 'Druga' }]);
    await controller.showTurn(0);
    release();
    await pending;
    assert.deepEqual(S().notes, []); // notatki tury 0 nie zostały nadpisane cudzą odpowiedzią
  });

  test('ukryty pluton odsłania poziom pluton, ukryta kompania — kompania', async () => {
    const { api, controller, S } = await setup({ storage: { 'ks:test:briefing-seen': true, 'ks:test:detail': 'battalion' } });
    api.data.turnData[1].units.push({ id: 'pl', name: 'Pluton', sidc: 'SFGPUCIZ---D---', pos: [22.92, 54.12], parent: 'co' });
    await controller.refresh();
    controller.selectEntity('pl');
    assert.equal(S().detail, 'platoon');
    controller.setDetail('battalion');
    controller.selectEntity('co');
    assert.equal(S().detail, 'company');
  });

  test('setDetail waliduje wybór i zapisuje go', async () => {
    const { controller, S, storage } = await setup(opts);
    controller.setDetail('battalion');
    assert.equal(S().detail, 'battalion');
    controller.setDetail('cokolwiek');
    assert.equal(S().detail, null);
    assert.equal(storage.data['ks:test:detail'], null);
  });
});

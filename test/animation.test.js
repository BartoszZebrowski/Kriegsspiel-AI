import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../public/js/core/store.js';
import { createController } from '../public/js/core/controller.js';

// Minimalne fałszywe API: kilka tur z jednostką, która jedzie na wschód, i kontaktem, który zmienia zameldowaną pozycję.
function makeApi(turns) {
  const turnData = Object.fromEntries(
    turns.map((n) => [
      n,
      {
        turn: n,
        time: `2026-05-14T0${6 + n * 2}:00:00+02:00`,
        units: [
          { id: 'hq', name: 'ZT', sidc: 'SFGPUCIZ--AH---', pos: [22.8, 54.0] },
          { id: 'bn', name: 'Batalion', sidc: 'SFGPUCIZ---F---', parent: 'hq', pos: [22.9 + n * 0.05, 54.1], ...(n > 0 ? { track: [[22.9 + (n - 1) * 0.05, 54.1], [22.9 + n * 0.05 - 0.02, 54.12], [22.9 + n * 0.05, 54.1]] } : {}) },
        ],
        contacts: [{ id: 'c-001', sidc: 'SHGAUCAT---E---', pos: [23.0, 54.2 + n * 0.03] }],
        assets: [],
        lines: [],
      },
    ]),
  );
  const api = {
    turnData,
    turns,
    scenario: async () => ({ scenario: { id: 'test', title: 'T', timezone: 'Europe/Warsaw', turnMinutes: 120, channels: [{ id: 'dd', name: 'DD', kind: 'superior' }] }, turns: api.turns, currentTurn: Math.max(...api.turns) }),
    turn: async (n) => structuredClone(api.turnData[n]),
    notes: async (n) => ({ turn: n, items: [] }),
    messages: async () => ({ messages: [] }),
    gazetteer: async () => [],
    briefing: async () => '# Odprawa',
  };
  return api;
}

const memoryStorage = (initial = {}) => {
  const data = { 'ks:test:briefing-seen': true, ...initial };
  return { load: (k, f) => (k in data ? data[k] : f), save: (k, v) => void (data[k] = v), data };
};

async function setup({ turns = [0, 1, 2], storage = {}, env } = {}) {
  const api = makeApi(turns);
  const store = createStore();
  const mem = memoryStorage(storage);
  const controller = createController({ store, api, storage: mem, env });
  await controller.init();
  await controller.load();
  return { api, store, controller, mem, S: () => store.get() };
}

describe('T12.8 — kontroler: zlecenie animacji przemieszczeń', () => {
  test('następna tura po kolei zleca animację: jednostka po trasie, kontakt jako duch', async () => {
    const { controller, S } = await setup();
    await controller.showTurn(0);
    assert.equal(S().animation, null, 'cofnięcie nie animuje');
    await controller.nextTurn();
    const a = S().animation;
    assert.ok(a, 'animacja zlecona');
    assert.deepEqual([a.from, a.to], [0, 1]);
    assert.deepEqual(a.plan.moves.map((m) => m.id), ['bn']);
    assert.equal(a.plan.moves[0].route.length, 3, 'track z nowej tury');
    assert.deepEqual(a.plan.ghosts.map((g) => g.id), ['c-001']);
    assert.ok(a.ms >= 2000 && a.ms <= 3000);
    assert.equal(S().viewTurn, 1);
  });

  test('skok o kilka tur, cofnięcie i klik w poprzednią turę nie animują', async () => {
    const { controller, S } = await setup();
    await controller.showTurn(0);
    await controller.showTurn(2);
    assert.equal(S().animation, null);
    await controller.prevTurn();
    assert.equal(S().animation, null);
    await controller.showTurn(0);
    assert.equal(S().animation, null);
  });

  test('żywa aktualizacja: nowa tura bieżąca po poprzedniej animuje; archiwum (inna oglądana tura) nie', async () => {
    const { api, controller, S } = await setup({ turns: [0, 1] });
    api.turns = [0, 1, 2];
    api.turnData[2] = makeApi([2]).turnData[2];
    await controller.refresh();
    assert.equal(S().viewTurn, 2);
    assert.deepEqual([S().animation?.from, S().animation?.to], [1, 2]);

    // użytkownik ogląda archiwum (T0), a pojawia się T3: widok przeskakuje na bieżącą bez animacji (nie po kolei)
    const second = await setup({ turns: [0, 1, 2] });
    await second.controller.showTurn(0);
    second.api.turns = [0, 1, 2, 3];
    second.api.turnData[3] = structuredClone(second.api.turnData[2]);
    second.api.turnData[3].turn = 3;
    await second.controller.refresh();
    assert.equal(second.S().viewTurn, 3);
    assert.equal(second.S().animation, null);
  });

  test('odświeżenie bez zmiany tury (np. nowa wiadomość) nie przerywa trwającej animacji', async () => {
    const { controller, S } = await setup();
    await controller.showTurn(0);
    await controller.nextTurn();
    const a = S().animation;
    await controller.refresh();
    assert.equal(S().animation, a);
  });

  test('przełącznik „Animacje” wyłączony (zapamiętany) i prefers-reduced-motion = natychmiast', async () => {
    const off = await setup({ storage: { 'ks:animations': false } });
    assert.equal(off.S().ui.animations, false);
    await off.controller.showTurn(0);
    await off.controller.nextTurn();
    assert.equal(off.S().animation, null);

    const reduced = await setup({ env: { prefersReducedMotion: () => true } });
    assert.equal(reduced.S().ui.reducedMotion, true);
    await reduced.controller.showTurn(0);
    await reduced.controller.nextTurn();
    assert.equal(reduced.S().animation, null);

    const toggled = await setup();
    toggled.controller.setAnimations(false);
    assert.equal(toggled.mem.data['ks:animations'], false);
    await toggled.controller.showTurn(0);
    await toggled.controller.nextTurn();
    assert.equal(toggled.S().animation, null);
    toggled.controller.setAnimations(true);
    await toggled.controller.showTurn(0);
    await toggled.controller.nextTurn();
    assert.ok(toggled.S().animation);
  });

  test('tury bez przemieszczeń nie zlecają animacji', async () => {
    const { api, controller, S } = await setup();
    api.turnData[1].units = structuredClone(api.turnData[0].units);
    api.turnData[1].contacts = structuredClone(api.turnData[0].contacts);
    await controller.showTurn(0);
    await controller.nextTurn();
    assert.equal(S().animation, null);
  });

  test('odtwarzanie tury: poprzednia → oglądana; działa w archiwum, brak poprzedniej tury i wyłączone animacje dają komunikat', async () => {
    const { controller, S } = await setup();
    await controller.showTurn(2);
    assert.equal(S().animation, null);
    assert.equal(await controller.replayTurn(), true);
    assert.deepEqual([S().animation.from, S().animation.to], [1, 2]);
    const first = S().animation;
    await controller.replayTurn();
    assert.notEqual(S().animation, first, 'każde odtworzenie to nowe zlecenie (nonce)');

    await controller.showTurn(0);
    assert.equal(await controller.replayTurn(), false);
    assert.equal(S().notice.error, true);

    await controller.showTurn(1);
    controller.setAnimations(false);
    assert.equal(await controller.replayTurn(), false);
    assert.match(S().notice.text, /wyłączone/);
  });

  test('polecenie omniboksu „replay” odtwarza turę', async () => {
    const { controller, S } = await setup();
    await controller.runCommand('replay');
    assert.deepEqual([S().animation.from, S().animation.to], [1, 2]);
  });
});

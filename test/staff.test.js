import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkStaff } from '../shared/staff.js';
import { validateScenario } from '../tools/validate.js';
import { staffCards, isStaffOpen, closeStaff, openStaff, emptyStaffUi, sanitizeClosed } from '../public/js/domain/staff.js';
import { STAFF_VIEWS, activateStaffView, restoreStaffView, toggleStaffView, emptyStaffView, staffViewByCode } from '../public/js/domain/staffviews.js';
import { defaultLayers, createStore } from '../public/js/core/store.js';
import { createController } from '../public/js/core/controller.js';
import { makeScenario } from './helpers.js';

const T = '2026-05-14T08:00:00+02:00';
const item = (role, extra = {}) => ({ role, name: `mjr Nowak, szef ${role}`, text: `Meldunek ${role}`, time: '2026-05-14T07:30:00+02:00', ...extra });

describe('T28.1 — walidator staff', () => {
  test('brak pola i poprawna lista', () => {
    assert.deepEqual(checkStaff(undefined, T, 120), { errors: [], warnings: [] });
    assert.deepEqual(checkStaff([item('s2'), item('s3'), item('s4')], T, 120), { errors: [], warnings: [] });
  });
  test('struktura: nie lista, nadmiar, obce pole, brak tekstu, zły czas', () => {
    assert.ok(checkStaff({}, T, 120).errors.length);
    assert.ok(checkStaff([item('s2'), item('s3'), item('s4'), item('s2')], T, 120).errors.some((e) => e.includes('najwyżej')));
    assert.ok(checkStaff([item('s2', { x: 1 })], T, 120).errors.some((e) => e.includes('spoza schematu')));
    assert.ok(checkStaff([item('s2', { text: ' ' })], T, 120).errors.length);
    assert.ok(checkStaff([item('s2', { text: 'a'.repeat(301) })], T, 120).errors.length);
    assert.ok(checkStaff([item('s2', { time: 'jutro' })], T, 120).errors.length);
  });
  test('rola spoza listy i duplikat roli to błąd', () => {
    assert.ok(checkStaff([item('s1')], T, 120).errors.some((e) => e.includes('role')));
    assert.ok(checkStaff([item('s2'), item('s2')], T, 120).errors.some((e) => e.includes('zduplikowana')));
  });
  test('time poza okresem tury to uwaga, nie błąd', () => {
    const r = checkStaff([item('s2', { time: '2026-05-14T03:00:00+02:00' })], T, 120);
    assert.deepEqual(r.errors, []);
    assert.equal(r.warnings.length, 1);
    assert.equal(checkStaff([item('s2', { time: '2026-05-14T09:00:00+02:00' })], T, 120).warnings.length, 1);
  });
  test('validateScenario: staff w turze OK; w jednostce błąd białej listy; duplikat roli błąd', async () => {
    const { dir, write } = await makeScenario({ turns: [0] });
    const base = { turn: 0, time: '2026-05-14T06:00:00+02:00', units: [], contacts: [] };
    await write('player/turns/000.json', { ...base, staff: [item('s2', { time: '2026-05-14T05:00:00+02:00' })] });
    const ok = await validateScenario(dir);
    assert.ok(!ok.errors.some((e) => /staff/i.test(e)), ok.errors.join('\n'));
    const unit = { id: 'u', name: 'U', sidc: 'SFGPUCIZ---F---', pos: [22.9, 54.1], strength: 1, status: 's', task: 't', staff: [] };
    await write('player/turns/000.json', { ...base, units: [unit] });
    const bad = await validateScenario(dir);
    assert.ok(bad.errors.some((e) => e.includes('staff')), bad.errors.join('\n'));
    await write('player/turns/000.json', { ...base, staff: [item('s2'), item('s2')] });
    const dup = await validateScenario(dir);
    assert.ok(dup.errors.some((e) => e.includes('zduplikowana')));
  });
});

describe('T28.1 — karty odprawy', () => {
  const channels = [{ id: 'dow', kind: 'superior' }, { id: 'rozp', kind: 'recon' }, { id: 's4', kind: 'logistics' }];
  test('kolejność S2, S3, S4, odznaki, kanały; S3 bez własnego kanału', () => {
    const cards = staffCards([item('s4'), item('s2'), item('s3')], channels, 'Europe/Warsaw');
    assert.deepEqual(cards.map((c) => c.badge), ['S2', 'S3', 'S4']);
    assert.deepEqual(cards.map((c) => c.channel), ['rozp', null, 's4']);
    assert.ok(cards[0].dtg.length > 4);
  });
  test('nieznane role i śmieci pomijane; tekst surowy (escape robi widok)', () => {
    assert.deepEqual(staffCards(undefined, channels), []);
    assert.deepEqual(staffCards([item('s9'), { role: 's2' }, null], channels), []);
    assert.equal(staffCards([item('s2', { text: '<i>x</i>' })], channels)[0].text, '<i>x</i>');
  });
});

const miniApi = (staff) => ({
  scenario: async () => ({ scenario: { id: 'test', title: 'T', timezone: 'Europe/Warsaw', turnMinutes: 120, channels: [{ id: 'dd', name: 'DD', kind: 'superior' }] }, turns: [0], currentTurn: 0 }),
  turn: async () => ({ turn: 0, time: T, units: [], contacts: [], assets: [], lines: [], ...(staff ? { staff } : {}) }),
  notes: async () => ({ turn: 0, items: [] }),
  messages: async () => ({ messages: [] }),
  gazetteer: async () => [],
  briefing: async () => '#',
});

describe('T28.1 — otwieranie i zamykanie panelu', () => {
  const cards = staffCards([item('s2')], []);
  test('bieżąca tura otwarta, dopóki nie zamknięto; archiwum tylko na żądanie', () => {
    let ui = emptyStaffUi();
    assert.equal(isStaffOpen({ cards, staffUi: ui, viewTurn: 3, archive: false }), true);
    ui = closeStaff(ui, 3, false);
    assert.equal(isStaffOpen({ cards, staffUi: ui, viewTurn: 3, archive: false }), false);
    assert.equal(isStaffOpen({ cards, staffUi: ui, viewTurn: 4, archive: false }), true);
    assert.equal(isStaffOpen({ cards, staffUi: ui, viewTurn: 1, archive: true }), false);
    ui = openStaff(ui, 1, true);
    assert.equal(isStaffOpen({ cards, staffUi: ui, viewTurn: 1, archive: true }), true);
    assert.deepEqual(openStaff(ui, 3, false).closed, []);
    assert.equal(isStaffOpen({ cards: [], staffUi: emptyStaffUi(), viewTurn: 1, archive: false }), false);
  });
  test('sanitizeClosed odrzuca śmieci', () => {
    assert.deepEqual(sanitizeClosed([1, 'a', -1, 2.5, 3]), [1, 3]);
    assert.deepEqual(sanitizeClosed('x'), []);
  });
  test('kontroler: zamknięcie zapisuje do storage i wraca po ponownym starcie', async () => {
    const data = { 'ks:test:briefing-seen': true };
    const storage = { load: (k, f) => (k in data ? data[k] : f), save: (k, v) => void (data[k] = v) };
    const mk = async () => {
      const store = createStore();
      const controller = createController({ store, api: miniApi([item('s2')]), storage });
      await controller.init();
      await controller.load();
      return { store, controller };
    };
    const a = await mk();
    assert.equal(a.store.get().staffOpen, true);
    a.controller.closeStaffPanel();
    assert.equal(a.store.get().staffOpen, false);
    assert.deepEqual(data['ks:test:staff-closed'], [0]);
    const b = await mk();
    assert.equal(b.store.get().staffOpen, false);
    b.controller.openStaffPanel();
    assert.equal(b.store.get().staffOpen, true);
    assert.deepEqual(data['ks:test:staff-closed'], []);
  });
});

describe('T28.1 — presety widoków sztabu', () => {
  const base = () => ({ layers: { ...defaultLayers(), contacts: false, notes: false, Koleje: true }, popover: 'layers', staffView: emptyStaffView() });
  test('skróty: Shift+1…4, unikalne kody', () => {
    assert.deepEqual(STAFF_VIEWS.map((v) => v.id), ['s2', 's3', 's4', 'fires']);
    assert.equal(new Set(STAFF_VIEWS.map((v) => v.code)).size, 4);
    assert.equal(staffViewByCode('Digit3').id, 's4');
    assert.equal(staffViewByCode('Digit9'), null);
  });
  test('zapis i przywrócenie ustawień gracza (podkłady nietknięte)', () => {
    const s0 = base();
    const p = activateStaffView(s0, 's4');
    assert.equal(p.layers.logistics, true);
    assert.equal(p.layers.contacts, false);
    assert.equal(p.layers.Koleje, true);
    assert.equal(p.popover, 'dos');
    assert.equal(p.staffView.active, 's4');
    const r = restoreStaffView({ ...s0, ...p });
    assert.deepEqual(r.layers, s0.layers);
    assert.equal(r.popover, 'layers');
    assert.deepEqual(r.staffView, emptyStaffView());
  });
  test('preset → preset zachowuje pierwotne ustawienia gracza; ponowny klik cofa', () => {
    const s0 = base();
    let s = { ...s0, ...activateStaffView(s0, 's2') };
    s = { ...s, ...activateStaffView(s, 'fires') };
    assert.equal(s.staffView.active, 'fires');
    assert.equal(s.staffView.saved.layers.contacts, false);
    const back = toggleStaffView(s, 'fires');
    assert.deepEqual(back.layers, s0.layers);
    assert.equal(back.popover, 'layers');
    assert.equal(restoreStaffView(s0), null);
    assert.equal(activateStaffView(s0, 'nope'), null);
  });
  test('kontroler: setStaffView przełącza i przywraca w store', async () => {
    const store = createStore();
    const controller = createController({ store, api: miniApi(), storage: { load: (k, f) => (k === 'ks:test:briefing-seen' ? true : f), save() {} } });
    await controller.init();
    await controller.load();
    const before = store.get().layers;
    controller.setStaffView('s3');
    assert.equal(store.get().staffView.active, 's3');
    assert.equal(store.get().layers.assets, false);
    controller.setStaffView('s3');
    assert.deepEqual(store.get().layers, before);
    assert.equal(controller.setStaffView('zly'), false);
    assert.equal(controller.setStaffView(null), false);
  });
});

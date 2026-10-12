// T19 — utrata łączności: schemat, walidator, domena, narzędzie tury, ostrzeżenie komunikatora.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checkComms, checkUmpireComms, commsFromTruth } from '../shared/comms.js';
import { commsInfo, commsWarning, channelComms, commsCardText } from '../public/js/domain/comms.js';
import { warnHtml } from '../public/js/views/messenger/warn.js';
import { validateScenario } from '../tools/validate.js';
import { buildTurn } from '../tools/umpire/turn.mjs';
import { makeScenario } from './helpers.js';

const A = [22.9, 54.1];
const T = '2026-05-14T08:00:00+02:00';
const LC = '2026-05-14T07:12:00+02:00';
const unit = (extra = {}) => ({ id: 'u', name: 'U', sidc: 'SFGPUCIZ---F---', pos: A, strength: 1, status: 's', task: 't', ...extra });
const base = { turn: 1, time: T, contacts: [] };

describe('T19 — shared/comms.js', () => {
  test('checkComms: poprawne, brak last_contact, zły status, czas po turze', () => {
    assert.equal(checkComms({ status: 'ok' }, T), null);
    assert.equal(checkComms({ status: 'lost', last_contact: LC }, T), null);
    assert.ok(checkComms({ status: 'lost' }, T));
    assert.ok(checkComms({ status: 'degraded' }, T));
    assert.ok(checkComms({ status: 'zepsuta', last_contact: LC }, T));
    assert.ok(checkComms({ status: 'lost', last_contact: '2026-05-14T09:00:00+02:00' }, T));
    assert.ok(checkComms({ status: 'lost', last_contact: 'wczoraj' }, T));
    assert.ok(checkComms('lost', T));
  });
  test('checkUmpireComms i commsFromTruth', () => {
    assert.deepEqual(checkUmpireComms(unit()), []);
    assert.deepEqual(checkUmpireComms(unit({ comms_true: { status: 'lost', since: LC, cause: 'REW' } })), []);
    assert.equal(checkUmpireComms(unit({ comms_true: { status: 'x' } })).length, 1);
    assert.equal(checkUmpireComms(unit({ comms_true: { status: 'lost', since: 'x', cause: 5 } })).length, 2);
    assert.deepEqual(commsFromTruth({ status: 'lost', since: LC, cause: 'REW' }), { status: 'lost', last_contact: LC });
    assert.equal(commsFromTruth({ status: 'ok' }), null);
    assert.equal(commsFromTruth(undefined), null);
  });
});

describe('T19 — walidator', () => {
  test('comms poprawne czysto; zły status/czas i comms_true w pliku gracza to błąd', async () => {
    const { dir, write } = await makeScenario({ turns: [0] });
    await write('player/turns/000.json', { ...base, turn: 0, units: [unit({ comms: { status: 'lost', last_contact: LC } })] });
    assert.ok(!(await validateScenario(dir)).errors.some((e) => /comms/.test(e)));
    await write('player/turns/000.json', { ...base, turn: 0, units: [unit({ comms: { status: 'lost' } })] });
    assert.ok((await validateScenario(dir)).errors.some((e) => e.includes('comms')));
    await write('player/turns/000.json', { ...base, turn: 0, units: [unit({ comms: { status: 'lost', last_contact: '2026-05-14T09:00:00+02:00' } })] });
    assert.ok((await validateScenario(dir)).errors.some((e) => e.includes('comms')));
    await write('player/turns/000.json', { ...base, turn: 0, units: [unit({ comms_true: { status: 'lost', since: LC, cause: 'REW' } })] });
    assert.ok((await validateScenario(dir)).errors.some((e) => e.includes('comms_true')));
  });
});

describe('T19 — domena', () => {
  test('commsInfo: lost, degraded, ok/brak pola', () => {
    const l = commsInfo(unit({ comms: { status: 'lost', last_contact: LC } }), T, 'Europe/Warsaw');
    assert.equal(l.lost, true);
    assert.equal(l.ageMin, 48);
    assert.equal(l.text, 'brak łączności od 07:12');
    assert.match(commsCardText(l), /brak łączności od 07:12 \(/);
    const d = commsInfo(unit({ comms: { status: 'degraded', last_contact: LC } }), T, 'Europe/Warsaw');
    assert.equal(d.degraded, true);
    assert.match(d.text, /łączność słaba/);
    for (const u of [unit(), unit({ comms: { status: 'ok' } }), null, unit({ comms: { status: '<b>' } })]) {
      const i = commsInfo(u, T, 'Europe/Warsaw');
      assert.equal(i.status, 'ok');
      assert.equal(i.text, '');
      assert.equal(commsCardText(i), '');
    }
    assert.equal(commsWarning(unit(), T), '');
    assert.match(commsWarning(unit({ comms: { status: 'lost', last_contact: LC } }), T, 'Europe/Warsaw'), /doręczenie niepewne/);
  });
});

describe('T19 — turn.mjs', () => {
  const prevUmpire = { turn: 1, time: '2026-05-14T07:00:00+02:00', units: [unit({ side: 'PL', supply: { dos: 2 }, comms_true: { status: 'lost', since: LC, cause: 'REW' } })], assets: [] };
  const prevPlayer = { turn: 1, time: prevUmpire.time, units: [unit({ comms: { status: 'lost', last_contact: LC } })], contacts: [], assets: [], lines: [] };
  test('comms_true daje comms bez comms_true i bez przyczyny', () => {
    const r = buildTurn({ prevUmpire, prevPlayer: { ...prevPlayer, units: [unit()] }, plan: {}, turnMinutes: 60 });
    assert.deepEqual(r.player.units[0].comms, { status: 'lost', last_contact: LC });
    assert.ok(!/comms_true|REW/.test(JSON.stringify(r.player)));
    assert.equal(r.umpire.units[0].comms_true.cause, 'REW');
  });
  test('łatka nadpisuje; brak dziedziczenia z tury N', () => {
    const patch = { player: { units: { u: { comms: { status: 'degraded', last_contact: LC } } } } };
    assert.equal(buildTurn({ prevUmpire, prevPlayer, plan: patch, turnMinutes: 60 }).player.units[0].comms.status, 'degraded');
    const ok = { ...prevUmpire, units: [unit({ side: 'PL', supply: { dos: 2 } })] };
    assert.equal(buildTurn({ prevUmpire: ok, prevPlayer, plan: {}, turnMinutes: 60 }).player.units[0].comms, undefined);
  });
  test('ostrzeżenie: last_contact z przyszłości i lost ze świeżą pozycją', () => {
    const fut = { player: { units: { u: { comms: { status: 'lost', last_contact: '2030-01-01T00:00:00+01:00' } } } } };
    assert.ok(buildTurn({ prevUmpire, prevPlayer, plan: fut, turnMinutes: 60 }).warnings.some((w) => /last_contact/.test(w)));
    const old = { player: { units: { u: { comms: { status: 'lost', last_contact: '2026-05-14T06:00:00+02:00' } } } } };
    assert.ok(buildTurn({ prevUmpire, prevPlayer, plan: old, turnMinutes: 60 }).warnings.some((w) => /zamrożon/.test(w)));
  });
});

describe('T19 — komunikator', () => {
  const lost = unit({ id: 'k1', comms: { status: 'lost', last_contact: LC } });
  const st = (u, ch) => ({ draft: { text: '', urgent: false }, turn: { time: T, units: [u] }, scenario: { timezone: 'Europe/Warsaw' }, channel: ch, channelUnit: u.id, channels: [ch], archive: false });
  test('warnHtml: ostrzeżenie dla lost, brak dla ok; channelComms', () => {
    const ch = { id: 'k1', kind: 'subordinate', name: '<K1>', unit: 'k1' };
    const html = warnHtml(st(lost, ch));
    assert.match(html, /warn--comms/);
    assert.match(html, /brak łączności od 07:12/);
    assert.ok(!warnHtml(st(unit({ id: 'k1' }), ch)).includes('warn--comms'));
    assert.equal(channelComms(ch, [lost], T, 'Europe/Warsaw').lost, true);
    assert.equal(channelComms({ id: 'x' }, [lost], T).status, 'ok');
  });
});

// T31: przejście dni — shared/domain campaign, karta tury, tryb nocny, oś czasu, ciągłość czasu w walidatorze, turn.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as sh from '../shared/campaign.js';
import * as dom from '../public/js/domain/campaign.js';
import { turnCardHtml, sunLabels } from '../public/js/domain/turncard.js';
import { applyNightRegen, STAMINA_MAX } from '../tools/umpire/night.mjs';
import { buildTimeline } from '../public/js/domain/timeline.js';
import { buildTurn } from '../tools/umpire/turn.mjs';
import { validateScenario } from '../tools/validate.js';
import { makeScenario, startApp } from './helpers.js';

const scenario = {
  start: '2026-05-14T06:00:00+02:00', turnMinutes: 120, timezone: 'Europe/Warsaw', map: { center: [22.9, 54.1] },
  phases: [{ id: 'D+0', start: '2026-05-14T06:00:00+02:00' }, { id: 'D+1', start: '2026-05-15T04:00:00+02:00', title: 'Kontratak' }],
};

test('shared i domain campaign: zgodne długości okresu i czasy', () => {
  const entries = [{ turn: 0, time: '2026-05-14T06:00:00+02:00' }, { turn: 1, time: '2026-05-14T08:00:00+02:00', duration_min: 600 }, { turn: 2, time: '2026-05-14T18:00:00+02:00' }];
  for (const e of entries) {
    assert.equal(dom.turnDurationMin(scenario, entries, e.turn), sh.turnDurationMin(e, scenario));
    assert.equal(Date.parse(dom.turnTimeIso(scenario, entries, e.turn)), Date.parse(e.time));
  }
  assert.equal(sh.expectedNextMs(entries[1], scenario), Date.parse('2026-05-14T18:00:00+02:00'));
  assert.equal(dom.turnDurationMin(scenario, [], 5), 120);
  assert.equal(Date.parse(dom.turnTimeIso(scenario, [], 3)), Date.parse(scenario.start) + 3 * 120 * 60000); // zgodność wstecz
  assert.notEqual(sh.checkDuration(0), null);
  assert.equal(sh.checkDuration(601), null);
  assert.equal(sh.checkDuration(undefined), null);
  assert.ok(sh.checkPhases([{ id: 'a', start: '2026-05-14T06:00:00+02:00' }, { id: 'a', start: '2026-05-15T06:00:00+02:00' }], scenario).length);
  assert.deepEqual(sh.checkPhases(scenario.phases, scenario), []);
});

test('dayOf / isNewDay / buildSchedule / dayStarts', () => {
  assert.equal(dom.dayOf('2026-05-14T20:00:00+02:00', scenario).id, 'D+0');
  assert.equal(dom.dayOf('2026-05-15T05:00:00+02:00', scenario).id, 'D+1');
  assert.equal(dom.dayOf('2026-05-14T06:00:00+02:00', { turnMinutes: 60 }), null);
  assert.equal(dom.isNewDay('2026-05-14T20:00:00+02:00', '2026-05-15T05:00:00+02:00', scenario), true);
  assert.equal(dom.isNewDay('2026-05-14T08:00:00+02:00', '2026-05-14T10:00:00+02:00', scenario), false);
  const sched = dom.buildSchedule(scenario, [{ turn: 0, time: scenario.start, duration_min: 600 }, { turn: 1, time: '2026-05-14T16:00:00+02:00' }], 2);
  assert.deepEqual(sched.map((s) => s.offsetMin), [0, 600, 720, 840]);
  assert.deepEqual(dom.dayStarts(scenario, sched).map((d) => [d.id, d.offsetMin]), [['D+0', 0], ['D+1', 1320]]);
});

test('karta tury: DTG, dzień, okres, słońce; ucieczka HTML', () => {
  const html = turnCardHtml({ turn: { turn: 3, time: '2026-05-15T05:00:00+02:00' }, scenario: { ...scenario, phases: [{ id: '<b>D+1', start: scenario.start, title: '<img onerror=x>' }] }, durationMin: 600 });
  assert.match(html, /Tura 3/);
  assert.match(html, /Okres tury/);
  assert.match(html, /wschód/);
  assert.ok(!html.includes('<img') && !html.includes('<b>D+1'));
  assert.equal(turnCardHtml({ turn: null, scenario }), '');
  assert.equal(sunLabels(scenario.start, null, 'Europe/Warsaw'), null);
});

test('night.mjs: regeneracja stamina_min, exclude, ręczny patch, maksimum', () => {
  const units = [{ id: 'a', stamina_min: 300 }, { id: 'b', stamina_min: 300 }, { id: 'c', stamina_min: 300 }, { id: 'd', stamina_min: 1400 }, { id: 'e' }];
  const r = applyNightRegen(units, 600, { exclude: ['b', 'zz'] }, { c: { stamina_min: 100 } });
  assert.equal(units[0].stamina_min, 900);
  assert.equal(units[1].stamina_min, 300);
  assert.equal(units[2].stamina_min, 300);
  assert.equal(units[3].stamina_min, STAMINA_MAX);
  assert.equal(units[4].stamina_min, undefined);
  assert.deepEqual(r.regenerated, ['a', 'd']);
  assert.ok(r.warnings.some((w) => w.includes('zz')));
  const u2 = [{ id: 'a', stamina_min: 100 }];
  applyNightRegen(u2, 600, { factor: 0.5 });
  assert.equal(u2[0].stamina_min, 400);
  assert.equal(applyNightRegen([{ id: 'a', stamina_min: 1 }], 600, false).regenerated.length, 0);
  assert.equal(applyNightRegen([{ id: 'a', stamina_min: 1 }], 0, true).warnings.length, 1);
});

test('buildTimeline: offsets i days; bez offsets jak dotąd', () => {
  const base = { turns: [0, 1, 2], currentTurn: 2, viewTurn: 2, start: scenario.start, turnMinutes: 120 };
  const plain = buildTimeline(base);
  assert.deepEqual(plain.ticks.slice(0, 3).map((t) => t.minutes), [0, 120, 240]);
  const tl = buildTimeline({ ...base, offsets: [0, 600, 720], days: [{ id: 'D+1', title: '', offsetMin: 600 }, { id: 'D+9', offsetMin: 99999 }] });
  assert.deepEqual(tl.ticks.slice(0, 3).map((t) => t.minutes), [0, 600, 720]);
  assert.deepEqual(tl.days.map((d) => d.id), ['D+1']);
});

test('turn.mjs: plan.duration_min i plan.night', () => {
  const unit = { id: 'bn', name: 'B', sidc: 'SFGPUCIZ---F---', pos: [22.9, 54.1], strength: 1, status: 'ok', task: 't' };
  const prevUmpire = { turn: 1, time: '2026-05-14T08:00:00+02:00', duration_min: 600, units: [{ ...unit, side: 'PL', stamina_min: 200 }], events: [] };
  const prevPlayer = { turn: 1, time: prevUmpire.time, units: [{ ...unit }] };
  const r = buildTurn({ prevUmpire, prevPlayer, plan: { duration_min: 120, night: true }, turnMinutes: 120 });
  assert.equal(r.time, '2026-05-14T18:00:00+02:00'); // okres rozstrzygany = duration_min tury 1
  assert.equal(r.umpire.duration_min, 120);
  assert.equal(r.player.duration_min, 120);
  assert.equal(r.umpire.units[0].stamina_min, 800);
  const r2 = buildTurn({ prevUmpire, prevPlayer, plan: {}, turnMinutes: 120 });
  assert.equal(r2.umpire.duration_min, undefined); // nie dziedziczone
  assert.equal(r2.player.duration_min, undefined);
  const r3 = buildTurn({ prevUmpire, prevPlayer, plan: { duration_min: -5 }, turnMinutes: 120 });
  assert.ok(r3.warnings.some((w) => w.includes('duration_min')));
});

test('walidator: ciągłość czasu — błąd z duration_min, uwaga bez', async () => {
  const sc = await makeScenario({ turns: [0, 1] }); // 06:00, 08:00
  const msgs = async () => {
    const r = await validateScenario(sc.dir);
    return [r.errors.filter((m) => /czas tury nie odpowiada/.test(m)).length, r.warnings.filter((m) => /czas tury nie odpowiada/.test(m)).length];
  };
  assert.deepEqual(await msgs(), [0, 0]);
  await sc.write('player/turns/001.json', { turn: 1, time: '2026-05-14T09:00:00+02:00', units: [], contacts: [] });
  assert.deepEqual(await msgs(), [0, 1]);
  await sc.write('player/turns/000.json', { turn: 0, time: '2026-05-14T06:00:00+02:00', duration_min: 180, units: [], contacts: [] });
  assert.deepEqual(await msgs(), [0, 0]);
  await sc.write('player/turns/000.json', { turn: 0, time: '2026-05-14T06:00:00+02:00', duration_min: 600, units: [], contacts: [] });
  assert.deepEqual(await msgs(), [1, 0]);
});

test('GET /api/scenario: schedule tylko z player/turns, bez prawdy sędziego', async () => {
  const sc = await makeScenario({ turns: [0, 1] });
  await sc.write('player/turns/001.json', { turn: 1, time: '2026-05-14T16:00:00+02:00', duration_min: 600, units: [], contacts: [] });
  await sc.write('umpire/turns/001.json', { turn: 1, time: '2026-05-14T16:00:00+02:00', duration_min: 999, secret: 'TAJNA-PRAWDA-SEDZIEGO' });
  const app = await startApp(sc.dir);
  try {
    const txt = await (await fetch(app.base + '/api/scenario')).text();
    const info = JSON.parse(txt);
    assert.deepEqual(info.schedule, [{ turn: 0, time: '2026-05-14T06:00:00+02:00' }, { turn: 1, time: '2026-05-14T16:00:00+02:00', duration_min: 600 }]);
    assert.ok(!txt.includes('TAJNA') && !txt.includes('999'));
  } finally { await app.close(); }
});

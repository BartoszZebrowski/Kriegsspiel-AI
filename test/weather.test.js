// T30 — pogoda i cykl dobowy: słońce (NOAA), checkWeather, walidator, marsz z pogodą/nocą, narzędzie tury.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sunTimes, dayPhase } from '../public/js/domain/daylight.js';
import { checkWeather } from '../shared/weather.js';
import { droneFlightVerdict, groundSpeedFactor, weatherInfo } from '../public/js/domain/weather.js';
import { isNightAt, marchMinutesFor, profileById } from '../public/js/domain/roadmarch.js';
import { validateScenario } from '../tools/validate.js';
import { buildTurn } from '../tools/umpire/turn.mjs';
import { makeScenario } from './helpers.js';

const SUWALKI = [22.93, 54.1];
const BIALYSTOK = [23.16, 53.13];
const minOfDay = (ms, offsetH) => { const d = new Date(ms + offsetH * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

describe('T30 — słońce', () => {
  test('Suwałki 14.05: wschód ok. 04:30, zachód ok. 20:25 CEST (tolerancja 20 min)', () => {
    const s = sunTimes(Date.parse('2026-05-14T12:00:00Z'), SUWALKI[1], SUWALKI[0]);
    assert.ok(Math.abs(minOfDay(s.sunrise, 2) - (4 * 60 + 30)) <= 20);
    assert.ok(Math.abs(minOfDay(s.sunset, 2) - (20 * 60 + 25)) <= 20);
  });
  test('Białystok 17.10: zachód ok. 17:25 CEST', () => {
    const s = sunTimes(Date.parse('2026-10-17T12:00:00Z'), BIALYSTOK[1], BIALYSTOK[0]);
    assert.ok(Math.abs(minOfDay(s.sunset, 2) - (17 * 60 + 25)) <= 15);
  });
  test('noc polarna nie psuje (null), faza doby w południe i o północy', () => {
    const p = sunTimes(Date.parse('2026-12-21T12:00:00Z'), 80, 20);
    assert.equal(p.sunrise, null);
    assert.equal(dayPhase('2026-05-14T12:00:00+02:00', SUWALKI), 'day');
    assert.equal(dayPhase('2026-05-15T00:30:00+02:00', SUWALKI), 'night');
    assert.equal(dayPhase('nie-data', SUWALKI), 'day');
    assert.equal(dayPhase('2026-05-15T00:30:00+02:00', null), 'day');
  });
});

describe('T30 — checkWeather i walidator', () => {
  const ok = { text: 'Zachmurzenie, słaby deszcz', precip: 'deszcz', fog: 'brak', wind: 'słaby', temp_c: 8, visibility_km: 6, forecast: 'poprawa po południu' };
  test('poprawna pogoda i błędy kategorii, zakresów, pól obcych', () => {
    assert.equal(checkWeather(ok), null);
    assert.equal(checkWeather({ text: 'x' }), null);
    assert.ok(checkWeather({}));
    assert.ok(checkWeather({ text: 'x', precip: 'grad' }));
    assert.ok(checkWeather({ text: 'x', temp_c: 99 }));
    assert.ok(checkWeather({ text: 'x', visibility_km: -1 }));
    assert.ok(checkWeather({ text: 'x', side: 'RU' }));
    assert.ok(checkWeather([]));
  });
  test('validateScenario: weather w obu plikach tury OK; zła kategoria = błąd', async () => {
    const { dir, write } = await makeScenario({ turns: [0] });
    const base = { turn: 0, time: '2026-05-14T06:00:00+02:00', units: [], contacts: [] };
    await write('player/turns/000.json', { ...base, weather: ok });
    await write('umpire/turns/000.json', { ...base, weather: ok });
    const r = await validateScenario(dir);
    assert.ok(!r.errors.some((e) => /weather/.test(e)), r.errors.join('|'));
    await write('player/turns/000.json', { ...base, weather: { ...ok, fog: 'smog' } });
    assert.ok((await validateScenario(dir)).errors.some((e) => e.includes('weather')));
  });
});

describe('T30 — skutki w kliencie', () => {
  test('werdykt lotu BSP i przejezdność', () => {
    assert.equal(droneFlightVerdict(null).ok, true);
    assert.equal(droneFlightVerdict({ text: 'x', wind: 'silny' }).ok, false);
    assert.equal(droneFlightVerdict({ text: 'x', fog: 'gęsta' }).ok, false);
    assert.equal(droneFlightVerdict({ text: 'x', precip: 'deszcz' }).ok, true);
    assert.ok(droneFlightVerdict({ text: 'x', precip: 'deszcz' }).reason);
    assert.equal(groundSpeedFactor(null), 1);
    assert.ok(groundSpeedFactor({ text: 'x', precip: 'ulewa' }) < groundSpeedFactor({ text: 'x', precip: 'deszcz' }));
    assert.equal(weatherInfo({ text: 'Ulewa', precip: 'ulewa' }).tone, 'bad');
    assert.equal(weatherInfo(null), null);
  });
  test('marsz: deszcz wydłuża czas; noc ze słońca (z pozycją) zamiast progów godzinowych', () => {
    const w = profileById('wheeled');
    assert.equal(marchMinutesFor(30, w, false), 60);
    assert.ok(marchMinutesFor(30, w, false, { text: 'x', precip: 'ulewa' }) > 60);
    assert.equal(marchMinutesFor(30, w, false, { text: 'x', precip: 'brak' }), 60);
    // 21:00 w maju: stare progi = noc, słońce (Suwałki) = jeszcze zmierzch, nie noc
    assert.equal(isNightAt('2026-05-14T21:00:00+02:00', 'Europe/Warsaw'), true);
    assert.equal(isNightAt('2026-05-14T21:00:00+02:00', 'Europe/Warsaw', SUWALKI), false);
    assert.equal(isNightAt('2026-05-15T00:30:00+02:00', 'Europe/Warsaw', SUWALKI), true);
    assert.equal(isNightAt('', 'Europe/Warsaw', SUWALKI), false);
  });
});

describe('T30 — narzędzie tury', () => {
  const prevUmpire = { turn: 1, time: '2026-05-14T06:00:00+02:00', units: [], weather: { text: 'Pogodnie' } };
  const prevPlayer = { turn: 1, time: '2026-05-14T06:00:00+02:00', units: [], contacts: [], assets: [], lines: [] };
  test('pogoda dziedziczona, zmieniana planem i usuwana przez null; w obu plikach, bez pól sędziego', () => {
    const inh = buildTurn({ prevUmpire, prevPlayer, plan: {}, turnMinutes: 60 });
    assert.equal(inh.umpire.weather.text, 'Pogodnie');
    assert.equal(inh.player.weather.text, 'Pogodnie');
    const chg = buildTurn({ prevUmpire, prevPlayer, plan: { weather: { text: 'Ulewa', precip: 'ulewa' } }, turnMinutes: 60 });
    assert.equal(chg.umpire.weather.precip, 'ulewa');
    assert.equal(chg.player.weather.precip, 'ulewa');
    const del = buildTurn({ prevUmpire, prevPlayer, plan: { weather: null }, turnMinutes: 60 });
    assert.equal(del.umpire.weather, undefined);
    assert.equal(del.player.weather, undefined);
    const bad = buildTurn({ prevUmpire, prevPlayer, plan: { weather: { text: 'x', precip: 'grad' } }, turnMinutes: 60 });
    assert.ok(bad.warnings.some((w) => w.includes('weather')));
  });
});

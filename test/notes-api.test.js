import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeScenario, startApp } from './helpers.js';

describe('T12.2 — znaki taktyczne w API szkiców', () => {
  let app;
  const put = (items) =>
    fetch(app.base + '/api/notes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ turn: 1, items }) });
  const line = (extra) => ({
    id: 'n-l',
    kind: 'line',
    name: 'Granica 1',
    color: 'blue',
    geometry: { type: 'LineString', coordinates: [[22.8, 54.2], [22.9, 54.3]] },
    ...extra,
  });
  before(async () => {
    const sc = await makeScenario();
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('graphic i echelon są zachowywane', async () => {
    const res = await put([line({ graphic: 'boundary', echelon: 'H' })]);
    assert.equal(res.status, 200);
    const got = await (await app.get('/api/notes/1')).json();
    assert.equal(got.items[0].graphic, 'boundary');
    assert.equal(got.items[0].echelon, 'H');
  });

  test('flip zachowany tylko jako true', async () => {
    const res = await put([line({ graphic: 'flot', flip: true })]);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).items[0].flip, true);
    assert.equal((await put([line({ graphic: 'flot', flip: 'tak' })])).status, 400);
  });

  test('rysunek bez graphic (stary format) jest przyjmowany', async () => {
    const res = await put([line({})]);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).items[0].graphic, undefined);
  });

  test('nieznany graphic dla danego rodzaju daje 400', async () => {
    assert.equal((await put([line({ graphic: 'objective' })])).status, 400);
    assert.equal((await put([line({ graphic: 'axis_main' })])).status, 400);
    assert.equal((await put([line({ kind: 'arrow', graphic: 'axis_main' })])).status, 200);
    assert.equal((await put([line({ graphic: 'wymyslony' })])).status, 400);
  });

  test('graphic dla punktu, rejonu i symbolu', async () => {
    const point = { id: 'n-p', kind: 'point', name: 'CP 1', color: 'blue', geometry: { type: 'Point', coordinates: [22.8, 54.2] } };
    assert.equal((await put([{ ...point, graphic: 'target' }])).status, 200);
    assert.equal((await put([{ ...point, graphic: 'minefield' }])).status, 400);
    const sym = { ...point, kind: 'symbol', sidc: 'SHGAUCI--------' };
    assert.equal((await put([{ ...sym, graphic: 'target' }])).status, 400);
    const area = { id: 'n-a', kind: 'area', name: 'AA 1', geometry: { type: 'Polygon', coordinates: [[[22.8, 54.2], [22.9, 54.2], [22.9, 54.3], [22.8, 54.2]]] } };
    assert.equal((await put([{ ...area, graphic: 'minefield' }])).status, 200);
  });

  test('echelon spoza D–J daje 400', async () => {
    assert.equal((await put([line({ graphic: 'boundary', echelon: 'K' })])).status, 400);
    assert.equal((await put([line({ graphic: 'boundary', echelon: 'XX' })])).status, 400);
    assert.equal((await put([line({ graphic: 'boundary', echelon: 'D' })])).status, 200);
  });
});

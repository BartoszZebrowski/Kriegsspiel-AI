import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildScene, cameraFor, linesToGeoJson, zonesToGeoJson, terrariumHeight, ATTRIBUTION_3D, TERRAIN_TILES, BASE_TILES, BUILDINGS_TILEJSON } from '../public/js/domain/map3d.js';

const turn = {
  turn: 3,
  time: '2026-05-14T12:00:00+02:00',
  units: [
    { id: 'bn', name: '1 bzmot', sidc: 'SFGPUCIZ---F---', pos: [22.1, 54.1], status: 'w obronie' },
    { id: 'k1', name: '1 kompania', sidc: 'SFGPUCIZ---E---', pos: [22.11, 54.11], parent: 'bn' },
    { id: 'p1', name: '1 pluton', sidc: 'SFGPUCIZ---D---', pos: [22.12, 54.12], parent: 'k1' },
    { id: 'bad', name: 'bez pozycji', sidc: 'SFGPUCIZ---F---' },
  ],
  contacts: [
    { id: 'c1', sidc: 'SHGAUCAT---E---', pos: [22.2, 54.2], observed: '2026-05-14T11:50:00+02:00', estimate: 'kompania czołgów' },
    { id: 'c2', sidc: 'SHGAUCAT---E---', pos: [22.3, 54.3], observed: '2026-05-14T04:00:00+02:00' },
  ],
  lines: [
    { id: 'l1', kind: 'flot', label: 'FLOT', coords: [[22, 54], [22.1, 54.1]] },
    { id: 'z1', kind: 'ew_zone', label: 'REW', coords: [[22, 54], [22.1, 54], [22.1, 54.1], [22, 54.1]] },
    { id: 'l2', kind: 'axis', coords: [[22, 54]] },
  ],
  logistics: {
    routes: [{ id: 'msr1', kind: 'MSR', status: 'open', coords: [[22, 54], [22.2, 54.2]] }],
    depots: [{ id: 'dep1', name: 'Skład', pos: [22.05, 54.05], status: 'open', as_of: '2026-05-14T10:00:00+02:00' }],
  },
};

test('jednostki i kontakty trafiają do sceny z pozycjami i symbolami', () => {
  const s = buildScene(turn, { level: 'platoon' });
  const units = s.markers.filter((m) => m.kind === 'unit');
  assert.deepEqual(units.map((m) => m.id), ['bn', 'k1', 'p1']);
  assert.deepEqual(units[0].pos, [22.1, 54.1]);
  assert.equal(units[0].sidc, 'SFGPUCIZ---F---');
  assert.equal(units[0].opacity, 1);
  assert.equal(s.markers.filter((m) => m.kind === 'contact').length, 2);
});

test('kontakty bledną z wiekiem informacji', () => {
  const s = buildScene(turn);
  const [fresh, old] = s.markers.filter((m) => m.kind === 'contact');
  assert.ok(fresh.opacity > old.opacity, `${fresh.opacity} > ${old.opacity}`);
  assert.ok(old.opacity < 1 && old.opacity > 0);
  assert.match(old.tip, /informacja sprzed/);
});

test('szczegółowość ukrywa niższe szczeble', () => {
  const ids = (level) => buildScene(turn, { level }).markers.filter((m) => m.kind === 'unit').map((m) => m.id);
  assert.deepEqual(ids('battalion'), ['bn']);
  assert.deepEqual(ids('company'), ['bn', 'k1']);
});

test('warstwy wyłączają odpowiednie obiekty', () => {
  const s = buildScene(turn, { layers: { units: false, contacts: false, lines: false, logistics: false } });
  assert.deepEqual(s, { markers: [], lines: [], zones: [] });
  const only = buildScene(turn, { layers: { units: false, contacts: false, logistics: false } });
  assert.equal(only.markers.length, 0);
  assert.equal(only.lines.length, 1);
  assert.equal(only.zones.length, 1);
});

test('linie i strefy: styl, pominięcie niepoprawnych, GeoJSON', () => {
  const s = buildScene(turn, { layers: { logistics: false } });
  assert.deepEqual(s.lines.map((l) => l.id), ['l1']);
  assert.equal(s.lines[0].color, '#3b82f6');
  const gj = linesToGeoJson(s.lines);
  assert.equal(gj.features[0].geometry.type, 'LineString');
  const z = zonesToGeoJson(s.zones).features[0].geometry.coordinates[0];
  assert.deepEqual(z[0], z[z.length - 1]);
});

test('logistyka: trasa jako linia, skład jako znacznik', () => {
  const s = buildScene(turn, { layers: { units: false, contacts: false, lines: false } });
  assert.equal(s.lines.length, 1);
  assert.equal(s.lines[0].id, 'msr1');
  assert.equal(s.markers.length, 1);
  assert.deepEqual(s.markers[0].pos, [22.05, 54.05]);
});

test('scena nie zawiera pól spoza widoku gracza i brak tury daje pustą scenę', () => {
  assert.deepEqual(buildScene(null), { markers: [], lines: [], zones: [] });
  const t = structuredClone(turn);
  t.units[0].supply = { dos: 3 };
  t.units[0].side = 'PL';
  t.units[0].endurance_min = 5;
  const json = JSON.stringify(buildScene(t));
  for (const f of ['supply', 'side', 'endurance_min', 'events', 'truth']) assert.ok(!json.includes(`"${f}"`), f);
  const keys = new Set(buildScene(t).markers.flatMap((m) => Object.keys(m)));
  assert.deepEqual([...keys].sort(), ['color', 'id', 'kind', 'name', 'opacity', 'pos', 'sidc', 'tip'].filter((k) => keys.has(k)).sort());
});

test('kamera, wysokość Terrarium i atrybucje źródeł', () => {
  assert.equal(cameraFor(null), null);
  assert.equal(cameraFor({ bounds: [1, 2, 3] }), null);
  const c = cameraFor({ bounds: [20, 50, 22, 52] });
  assert.deepEqual(c.center, [21, 51]);
  assert.equal(terrariumHeight(128, 0, 0), 0);
  assert.equal(terrariumHeight(128, 100, 0), 100);
  for (const name of ['OpenStreetMap', 'Terrain Tiles', 'OpenFreeMap']) assert.ok(ATTRIBUTION_3D.includes(name), name);
  for (const u of [TERRAIN_TILES, BASE_TILES, BUILDINGS_TILEJSON]) assert.match(u, /^https:\/\/(s3\.amazonaws\.com|tile\.openstreetmap\.org|tiles\.openfreemap\.org)\//);
});

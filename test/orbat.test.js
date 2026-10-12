import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, reparentedParents } from '../public/js/domain/orbat.js';

const U = (id, parent, sidc = 'SFGPUCIZ---D---') => ({ id, name: id, sidc, ...(parent ? { parent } : {}) });
const t1 = [U('hq', null, 'SFGPUCIZ--AH---'), U('b1', 'hq', 'SFGPUCIZ---F---'), U('k1', 'b1', 'SFGPUCIZ---E---'), U('k2', 'b1', 'SFGPUCIZ---E---'), U('p1', 'k1')];
const t2 = t1.map((u) => (u.id === 'p1' ? { ...u, parent: 'k2' } : u));

const ids = (n) => [n.unit.id, ...n.children.flatMap(ids)];
const kids = (tree, id) => {
  const find = (ns) => ns.flatMap((n) => (n.unit.id === id ? [n] : find(n.children)));
  return find(tree)[0].children.map((c) => c.unit.id);
};

test('buildTree: zmiana parent między turami daje inne drzewo', () => {
  assert.deepEqual(kids(buildTree(t1), 'k1'), ['p1']);
  assert.deepEqual(kids(buildTree(t2), 'k1'), []);
  assert.deepEqual(kids(buildTree(t2), 'k2'), ['p1']);
});

test('buildTree: nowa jednostka pojawia się w drzewie', () => {
  const t3 = [...t2, U('p9', 'k1')];
  assert.ok(!buildTree(t2).flatMap(ids).includes('p9'));
  assert.deepEqual(kids(buildTree(t3), 'k1'), ['p9']);
});

test('reparentedParents: przepięcie, nowa jednostka, bez zmian', () => {
  assert.deepEqual(reparentedParents(t1, t2), ['k2']);
  assert.deepEqual(reparentedParents(t1, [...t1, U('p9', 'k1')]), ['k1']);
  assert.deepEqual(reparentedParents(t1, t1), []);
});

test('reparentedParents: brak poprzedniej tury, usunięta jednostka, formation', () => {
  assert.deepEqual(reparentedParents(null, []), []);
  assert.deepEqual(reparentedParents(t1, t1.filter((u) => u.id !== 'p1')), []);
  const a = [{ id: 'n1', name: 'n1', sidc: 'x', formation: 'zt-a' }];
  const b = [{ id: 'n1', name: 'n1', sidc: 'x', formation: 'zt-b' }];
  assert.deepEqual(reparentedParents(a, b), ['zt-b']);
});

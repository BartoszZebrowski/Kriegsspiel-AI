// Reguły zależności warstw klienta (docs/ARCHITECTURE.md, „Reguła zależności”). Skan importów w public/js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'js');

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

/** Specyfikatory importów (statyczne, re-eksporty, dynamiczne) z kodu bez komentarzy. */
export function importSpecifiers(src) {
  const code = stripComments(src);
  const out = [];
  const re = /(?:\bimport\s*(?:[\w*${}\s,]*?\bfrom\s*)?|\bexport\s*(?:\*|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*)(['"])([^'"]+)\1/g;
  let m;
  while ((m = re.exec(code))) out.push(m[2]);
  return out;
}

/** Rozwiązuje import względny względem pliku; zwraca ścieżkę względem public/js (z '/'), albo null dla spoza względnych. */
function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null;
  return posix.normalize(posix.join(posix.dirname(from), spec));
}

const layerOf = (p) => p.split('/')[0];
// Widok to plik views/x.js razem z własnym katalogiem views/x/ (np. views/map/*, views/draw/*). Grupa = nazwa x.
const viewGroup = (p) => p.split('/')[1].replace(/\.js$/, '');
const BANNED_GLOBALS = ['document', 'window', 'localStorage', 'sessionStorage'];

/**
 * Czysta funkcja: `files` = { 'domain/geo.js': 'treść', … } (ścieżki względem public/js).
 * Zwraca listę naruszeń `{ file, rule, detail }`.
 */
export function findViolations(files) {
  const v = [];
  for (const [file, src] of Object.entries(files)) {
    const layer = layerOf(file);
    for (const spec of importSpecifiers(src)) {
      const target = resolveSpec(file, spec);
      if (layer === 'domain') {
        if (!target || layerOf(target) !== 'domain') v.push({ file, rule: 'domain-isolation', detail: `domain/ importuje spoza domain/: ${spec}` });
      } else if (layer === 'views') {
        if (!target) continue;
        if (layerOf(target) === 'views' && viewGroup(file) !== viewGroup(target)) v.push({ file, rule: 'views-no-views', detail: `widok importuje inny widok: ${spec}` });
        else if (layerOf(target) === 'core') v.push({ file, rule: 'views-no-core', detail: `widok importuje core/ (dostaje store i kontroler jako parametry): ${spec}` });
      } else if (layer === 'lib') {
        if (!target || layerOf(target) !== 'lib') v.push({ file, rule: 'lib-isolation', detail: `lib/ importuje spoza lib/: ${spec}` });
      } else if (layer === 'core') {
        if (target && layerOf(target) === 'views') v.push({ file, rule: 'core-no-views', detail: `core/ importuje widok: ${spec}` });
      }
    }
    if (layer === 'core') {
      const code = stripComments(src);
      for (const g of BANNED_GLOBALS) {
        if (new RegExp('(?<![\\w$.])' + g + '\\b').test(code)) v.push({ file, rule: 'core-no-dom', detail: `core/ używa ${g}` });
      }
    }
  }
  return v;
}

function readTree(dir) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith('.js')) files[relative(ROOT, p).split(sep).join('/')] = readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return files;
}

test('kod klienta spełnia regułę zależności warstw', () => {
  const violations = findViolations(readTree(ROOT));
  assert.deepEqual(violations, []);
});

test('wykrywa zakazane importy (dane w pamięci)', () => {
  const rules = (files) => findViolations(files).map((x) => x.rule);
  assert.deepEqual(rules({ 'domain/a.js': "import { x } from '../views/topbar.js';" }), ['domain-isolation']);
  assert.deepEqual(rules({ 'domain/a.js': "export * from '/shared/schema.js';" }), ['domain-isolation']);
  assert.deepEqual(rules({ 'domain/a.js': "import { y } from './b.js';", 'domain/b.js': 'export const y = 1;' }), []);
  assert.deepEqual(rules({ 'views/a.js': "import { b } from './b.js';" }), ['views-no-views']);
  assert.deepEqual(rules({ 'views/map/x.js': "import { b } from '../topbar.js';" }), ['views-no-views']);
  assert.deepEqual(rules({ 'views/map/x.js': "import { b } from './y.js'; import { d } from '../../domain/geo.js';" }), []);
  assert.deepEqual(rules({ 'views/a.js': "import { c } from '../core/store.js';" }), ['views-no-core']);
  assert.deepEqual(rules({ 'views/draw.js': "import { x } from './draw/editor.js';" }), []);
  assert.deepEqual(rules({ 'views/draw/editor.js': "import { x } from '../map/index.js';" }), ['views-no-views']);
  assert.deepEqual(rules({ 'lib/a.js': "import { x } from '../domain/geo.js';" }), ['lib-isolation']);
  assert.deepEqual(rules({ 'lib/a.js': "import { x } from './b.js';" }), []);
  assert.deepEqual(rules({ 'views/a.js': "import { x } from '../main.js';" }), []);
  assert.deepEqual(rules({ 'core/s.js': "import { x } from '../domain/geo.js';" }), []);
  assert.deepEqual(rules({ 'core/s.js': 'const x = document.body;' }), ['core-no-dom']);
  assert.deepEqual(rules({ 'core/s.js': 'localStorage.getItem("a");' }), ['core-no-dom']);
  assert.deepEqual(rules({ 'core/s.js': "// document w komentarzu\nconst w = deps.window;" }), []);
  assert.deepEqual(rules({ 'core/s.js': "const m = await import('../views/x.js');" }), ['core-no-views']);
});

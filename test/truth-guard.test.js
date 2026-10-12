// T29: strażnik prawdy — /api/truth i /api/aar tylko przy status: finished; jedno miejsce w serwerze zna umpire/.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeScenario, startApp, SECRET } from './helpers.js';

const get = (app, p) => fetch(app.base + p);

describe('T29 — strażnik prawdy', () => {
  let sc, app;
  before(async () => {
    sc = await makeScenario();
    await sc.write('umpire/aar.md', '# AAR\n\n## Wynik\n\nOK');
    app = await startApp(sc.dir);
  });
  after(() => app.close());

  test('gra w toku (brak statusu / active): 403 dla prawdy i AAR', async () => {
    assert.equal((await get(app, '/api/truth/0')).status, 403);
    assert.equal((await get(app, '/api/aar')).status, 403);
    await sc.write('scenario.json', { id: 'test', title: 'T', turnMinutes: 120, timezone: 'Europe/Warsaw', status: 'active', channels: [{ id: 'dow', name: 'D', kind: 'superior' }] });
    const r = await get(app, '/api/truth/0');
    assert.equal(r.status, 403);
    assert.ok(!(await r.text()).includes(SECRET));
  });

  test('finished: 200 z prawdą i AAR; zła tura 404; próby obejścia nie wyciekają', async () => {
    await sc.write('scenario.json', { id: 'test', title: 'T', turnMinutes: 120, timezone: 'Europe/Warsaw', status: 'finished', channels: [{ id: 'dow', name: 'D', kind: 'superior' }] });
    const t = await get(app, '/api/truth/0');
    assert.equal(t.status, 200);
    assert.equal((await t.json()).secret, SECRET);
    assert.match(await (await get(app, '/api/aar')).text(), /# AAR/);
    assert.equal((await get(app, '/api/truth/9')).status, 404);
    for (const p of ['/api/truth/..%2f..%2fscenario', '/api/truth/../0', '/api/truth/0.json', '/api/truth/%2e%2e', '/umpire/turns/000.json', '/api/truth']) {
      const r = await get(app, p);
      assert.ok(r.status >= 400, p);
      assert.ok(!(await r.text()).includes(SECRET), p);
    }
  });

  test('powrót do active zamyka dostęp od razu (brak pamięci podręcznej)', async () => {
    await sc.write('scenario.json', { id: 'test', title: 'T', turnMinutes: 120, timezone: 'Europe/Warsaw', status: 'active', channels: [{ id: 'dow', name: 'D', kind: 'superior' }] });
    assert.equal((await get(app, '/api/truth/0')).status, 403);
  });

  test('tylko server/truth.js zna katalog umpire/', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'server');
    const code = (s) => s.split('\n').map((l) => l.split(' //')[0]).filter((l) => !l.trim().startsWith('//')).join('\n');
    const offenders = readdirSync(dir).filter((n) => n.endsWith('.js') && n !== 'truth.js' && /umpire/.test(code(readFileSync(join(dir, n), 'utf8'))));
    assert.deepEqual(offenders, []);
  });
});

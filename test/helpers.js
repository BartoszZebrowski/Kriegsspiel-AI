import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/app.js';

export const SECRET = 'TAJNA-PRAWDA-SEDZIEGO';

export async function makeScenario({ turns = [0, 1] } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ks-test-'));
  const write = async (rel, data) => {
    const file = path.join(dir, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  };
  await write('scenario.json', {
    id: 'test',
    title: 'Test',
    turnMinutes: 120,
    timezone: 'Europe/Warsaw',
    channels: [
      { id: 'dow', name: 'Dowództwo', kind: 'superior' },
      { id: 'bz15', name: '15 BZ', kind: 'subordinate' },
    ],
  });
  await write('briefing.md', '# Odprawa\n\nZadanie: bronić.');
  for (const n of turns) {
    const hh = String(6 + n * 2).padStart(2, '0');
    await write(`player/turns/${String(n).padStart(3, '0')}.json`, {
      turn: n,
      time: `2026-05-14T${hh}:00:00+02:00`,
      units: [],
      contacts: [],
    });
  }
  await write('player/inbox/000.json', {
    messages: [{ id: 'in-1', channel: 'dow', from: 'Dowództwo', time: '2026-05-14T05:30:00+02:00', text: 'Rozkaz bojowy' }],
  });
  await write('umpire/turns/000.json', { secret: SECRET });
  return { dir, write };
}

export async function startApp(dir) {
  const { server } = createApp(dir);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get: (p) => fetch(base + p),
    post: (p, body) =>
      fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    del: (p) => fetch(base + p, { method: 'DELETE' }),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { makeScenario, startApp } from './helpers.js';

// Surowe żądanie z dowolnymi nagłówkami (fetch nie pozwala ustawić Host/Origin).
function raw(base, method, p, headers = {}, body) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname, port, path: p, method, headers }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

describe('T12.5 — ochrona API (CSRF, DNS rebinding)', () => {
  let app, sc, port;
  const json = { 'Content-Type': 'application/json' };
  const body = JSON.stringify({ channel: 'dow', text: 'test' });
  before(async () => {
    sc = await makeScenario();
    app = await startApp(sc.dir);
    port = new URL(app.base).port;
  });
  after(() => app.close());

  test('POST z JSON, Host i Origin lokalnym przechodzi', async () => {
    for (const host of [`127.0.0.1:${port}`, `localhost:${port}`]) {
      const res = await raw(app.base, 'POST', '/api/outbox', { ...json, Host: host, Origin: `http://${host}` }, body);
      assert.equal(res.status, 201, host);
    }
  });

  test('POST bez Origin (klient nieprzeglądarkowy) z JSON przechodzi', async () => {
    assert.equal((await raw(app.base, 'POST', '/api/outbox', json, body)).status, 201);
  });

  test('POST z innym Content-Type (formularz) → 403', async () => {
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      const res = await raw(app.base, 'POST', '/api/outbox', { 'Content-Type': type }, body);
      assert.equal(res.status, 403, type);
    }
    assert.equal((await raw(app.base, 'POST', '/api/outbox', {}, body)).status, 403);
    assert.equal((await raw(app.base, 'PUT', '/api/notes', { 'Content-Type': 'text/plain' }, '{}')).status, 403);
  });

  test('obcy Origin → 403 (POST, PUT, DELETE)', async () => {
    const evil = { ...json, Origin: 'http://evil.example' };
    assert.equal((await raw(app.base, 'POST', '/api/outbox', evil, body)).status, 403);
    assert.equal((await raw(app.base, 'PUT', '/api/notes', evil, '{}')).status, 403);
    assert.equal((await raw(app.base, 'DELETE', '/api/outbox/out-x', { Origin: 'http://localhost:1' })).status, 403);
    assert.equal((await raw(app.base, 'POST', '/api/outbox', { ...json, Origin: 'null' }, body)).status, 403);
  });

  test('obcy Host → 403 także dla GET /api/* (DNS rebinding)', async () => {
    for (const p of ['/api/scenario', '/api/messages', '/api/turn/0']) {
      assert.equal((await raw(app.base, 'GET', p, { Host: 'evil.example' })).status, 403, p);
      assert.equal((await raw(app.base, 'GET', p, { Host: 'localhost:9999' })).status, 403, p);
    }
    assert.equal((await raw(app.base, 'POST', '/api/outbox', { ...json, Host: 'evil.example' }, body)).status, 403);
    assert.equal((await raw(app.base, 'GET', '/api/scenario', { Host: `localhost:${port}` })).status, 200);
  });

  test('klient aplikacji (same-origin fetch z JSON) działa', async () => {
    const res = await fetch(app.base + '/api/outbox', { method: 'POST', headers: { ...json, Origin: app.base }, body });
    assert.equal(res.status, 201);
  });
});

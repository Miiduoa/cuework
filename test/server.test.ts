import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { RevisionStore, ConflictError } from '../server/store.ts';
import { createApp } from '../server/http.ts';
import { SAMPLE } from '../src/core.ts';

test('SQLite persists snapshots across reopening, rejects stale writes, and restores as a new immutable revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cuework-store-'));
  const path = join(directory, 'test.sqlite');
  let store = new RevisionStore(path);
  try {
    assert.equal(store.get(), null);
    const first = store.save(SAMPLE, 0);
    const second = store.save({ ...SAMPLE, name: 'A second cut' }, 1);
    assert.equal(second.revision, 2);
    assert.throws(() => store.save({ ...SAMPLE, name: 'Stale edit' }, 1), ConflictError);
    assert.equal(store.get()?.name, 'A second cut');
    const restored = store.save(first, 2);
    assert.equal(restored.revision, 3);
    assert.equal(store.get(2)?.name, 'A second cut');
    assert.equal(store.get(1)?.name, SAMPLE.name);
    store.close();
    store = new RevisionStore(path);
    assert.equal(store.get()?.revision, 3);
    assert.deepEqual(store.get()?.cues, SAMPLE.cues);
    assert.deepEqual(
      store.history().map(({ revision }) => revision),
      [3, 2, 1],
    );
    assert.equal(store.get(999), null);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('two SQLite connections cannot both commit the same base revision', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cuework-concurrency-'));
  const a = new RevisionStore(join(directory, 'test.sqlite'));
  const b = new RevisionStore(join(directory, 'test.sqlite'));
  try {
    a.save(SAMPLE, 0);
    assert.throws(() => b.save({ ...SAMPLE, name: 'Second writer' }, 0), ConflictError);
    assert.equal(b.get()?.name, SAMPLE.name);
    assert.equal(b.history().length, 1);
  } finally {
    a.close();
    b.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP API validates payloads, returns 409 on competing writes, rejects hostile Host/Origin and serves the app', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cuework-http-'));
  writeFileSync(join(directory, 'index.html'), '<h1>Workbench</h1>');
  const store = new RevisionStore(':memory:');
  const server = createApp(store, directory);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const put = (
    expectedRevision: number,
    headers: Record<string, string> = {},
    document: unknown = SAMPLE,
  ) =>
    fetch(`${base}/api/document`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ document, expectedRevision }),
    });
  try {
    const initial = await fetch(`${base}/api/document`);
    assert.equal(await initial.json(), null);
    const competing = await Promise.all([put(0, { Origin: base }), put(0, { Origin: base })]);
    assert.deepEqual(competing.map(({ status }) => status).sort(), [200, 409]);
    const history = await fetch(`${base}/api/revisions`).then((res) => res.json());
    assert.equal(history.length, 1);
    assert.equal((await put(1, { Origin: 'https://malicious.example' })).status, 403);
    assert.equal((await put(1, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await put(1, { Origin: 'null' })).status, 403);
    assert.equal((await put(1, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await put(1, {}, { name: 'Broken', cues: [] })).status, 400);
    assert.equal((await fetch(`${base}/api/revisions/404`)).status, 404);
    const malformed = await fetch(`${base}/api/document`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{broken',
    });
    assert.equal(malformed.status, 400);
    assert.equal((await fetch(`${base}/api/revisions`).then((res) => res.json())).length, 1);
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const req = request(base, { headers: { Host: `evil.example:${address.port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode!);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(hostStatus, 403);
    const page = await fetch(base);
    assert.equal(await page.text(), '<h1>Workbench</h1>');
    assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    const revision = await fetch(`${base}/api/revisions/1`).then((res) => res.json());
    assert.deepEqual(revision.cues, SAMPLE.cues);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

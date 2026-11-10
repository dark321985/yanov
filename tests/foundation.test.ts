import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp,mkdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../server/app.js';
import { ConfigurationError, parseConfig } from '../server/config.js';
import type { Database } from '../server/database.js';
import type { DatabaseStatus } from '../shared/contracts.js';

const config = parseConfig({ NODE_ENV: 'test' });
const fakeDatabase = (status: DatabaseStatus): Database => ({ status: async () => status, close: async () => {} });

test('readiness fails while database is unavailable, liveness still succeeds', async () => {
  const app = await buildApp({ config, database: fakeDatabase('unavailable') });
  try {
    const live = await app.inject('/health/live');
    const ready = await app.inject('/health/ready');
    assert.equal(live.statusCode, 200);
    assert.equal(ready.statusCode, 503);
    assert.equal(ready.json().code, 'DATABASE_NOT_READY');
  } finally {
    await app.close();
  }
});

test('missing database does not masquerade as a healthy connection', async () => {
  const app = await buildApp({ config });
  try {
    const status = await app.inject('/api/system/status');
    assert.equal(status.json().database, 'not-configured');
    assert.equal((await app.inject('/health/ready')).statusCode, 503);
    assert.equal(status.headers['cache-control'], 'no-store');
  } finally {
    await app.close();
  }
});

test('unexpected provider exception cannot escape in API response', async () => {
  const marker = 'synthetic-sensitive-value';
  const app = await buildApp({
    config,
    database: { status: async () => { throw new Error(marker); }, close: async () => {} },
  });
  try {
    const response = await app.inject('/api/system/status');
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().code, 'INTERNAL_ERROR');
    assert.ok(!response.body.includes(marker));
  } finally {
    await app.close();
  }
});

test('production serves built SPA but never exposes local diagnostics or API fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'skladno-foundation-'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Foundation</title>');
  await mkdir(join(root,'assets'));
  await writeFile(join(root,'assets','app.js'),'console.log("public build asset");');
  await writeFile(join(root,'private.txt'),'synthetic-private-file-marker');
  const app = await buildApp({
    config: parseConfig({ NODE_ENV: 'production',APP_URL:'https://example.test' }),
    database: fakeDatabase('connected'), staticRoot: root,
  });
  try {
    assert.equal((await app.inject('/health/ready')).statusCode, 200);
    const spa = await app.inject({ url: '/clients', headers: { accept: 'text/html' } });
    assert.equal(spa.statusCode, 200);
    assert.ok(spa.body.includes('<title>Foundation</title>'));
    const asset=await app.inject('/assets/app.js');assert.equal(asset.statusCode,200);assert.ok(String(asset.headers['content-type']).includes('javascript'));
    assert.ok(String(spa.headers['content-security-policy']).includes("default-src 'self'"));
    for(const path of ['/assets/..%2Fprivate.txt','/assets/missing.js','/assets/private.txt']) {
      const blocked=await app.inject({url:path,headers:{accept:'text/html'}});
      assert.ok([400,404].includes(blocked.statusCode));assert.ok(!blocked.body.includes('synthetic-private-file-marker'));
    }
    for (const url of ['/api/system/status', '/api/missing', '/health/missing']) {
      const result = await app.inject({ url, headers: { accept: 'text/html' } });
      assert.equal(result.statusCode, 404);
      assert.equal(result.json().code, 'NOT_FOUND');
    }
  } finally {
    await app.close();
    await unlink(join(root, 'index.html'));
    await unlink(join(root,'assets','app.js'));await rmdir(join(root,'assets'));await unlink(join(root,'private.txt'));
    await rmdir(root);
  }
});

test('invalid configuration reports only field names, never rejected values', () => {
  const marker = 'synthetic-sensitive-value';
  assert.throws(() => parseConfig({ DATABASE_URL: marker }), (error: unknown) => {
    assert.ok(error instanceof ConfigurationError);
    assert.ok(error.fields.includes('DATABASE_URL'));
    assert.ok(!String(error).includes(marker));
    return true;
  });
  assert.throws(() => parseConfig({ APP_TIMEZONE: 'invalid/timezone' }), ConfigurationError);
  // Connection-string SSL options must not override the separately configured TLS policy.
  const syntheticConnection = new URL('postgresql://localhost/test');
  syntheticConnection.searchParams.set('sslmode', 'no-verify');
  assert.throws(() => parseConfig({ DATABASE_URL: syntheticConnection.href }), ConfigurationError);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { testDatabase } from './helpers.js';
import { setupOwner } from '../server/auth.js';

test('compiled production application: SPA/assets, protected API, secure cookie and no demo',async()=>{
  const fixture=await testDatabase(),password=randomBytes(24).toString('base64url');
  await setupOwner(fixture.pool,password);
  // Exercise the built server and real Vite artifacts, not a substitute source implementation.
  const compiled=new URL('../dist/server/server/app.js',import.meta.url);
  const {buildApp}=await import(compiled.href);
  const origin='https://production.example.test';
  const app=await buildApp({config:{...fixture.config,NODE_ENV:'production',APP_URL:origin},pool:fixture.runtimePool,database:{status:async()=> 'connected',close:async()=>{}}});
  try {
    const index=await app.inject({url:'/',headers:{accept:'text/html'}});assert.equal(index.statusCode,200);
    const script=index.body.match(/src="(\/assets\/[^" ]+\.js)"/)?.[1];assert.ok(script);
    const asset=await app.inject(script);assert.equal(asset.statusCode,200);assert.match(String(asset.headers['content-type']),/javascript/);
    const nested=await app.inject({url:'/leases/example',headers:{accept:'text/html'}});assert.equal(nested.statusCode,200);
    assert.equal((await app.inject('/api/clients')).statusCode,401);
    assert.equal((await app.inject('/api/system/status')).statusCode,404);
    const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin,'x-requested-with':'warehouse-admin'},payload:{password}});assert.equal(login.statusCode,200);
    const setCookie=String(login.headers['set-cookie']);assert.match(setCookie,/; Secure/);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);
    const cookie=setCookie.split(';')[0]!;
    assert.equal((await app.inject({method:'POST',url:'/api/demo',headers:{origin,cookie,'x-requested-with':'warehouse-admin'},payload:{confirm:true}})).statusCode,404);
    assert.equal((await app.inject({url:'/api/dashboard',headers:{cookie}})).statusCode,200);
    assert.equal((await app.inject({url:'/api/unknown',headers:{cookie,accept:'text/html'}})).statusCode,404);
    assert.ok(!index.body.includes('DATABASE_URL'));assert.ok(!asset.body.includes('synthetic-test-placeholder'));
  } finally {await app.close();await fixture.close();}
});

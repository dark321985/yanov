import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { testDatabase } from './helpers.js';
import { buildApp } from '../server/app.js';
import { setupOwner } from '../server/auth.js';
import { migrate } from '../server/migrations.js';
import { allCharges,allLeases,changeRate,releaseLease,createLease,paymentPreview,reversePayment,savePayment,settings } from '../server/services.js';
import { boundary } from '../server/dates.js';
import { runScheduler,type TelegramProvider } from '../server/telegram.js';

test('PostgreSQL: owner, dates, concurrency, financial history, reports and reminders',async(t)=>{
  const fixture=await testDatabase(),{pool,config}=fixture;
  // App owns this adapter only; fixture owns the real pool lifetime.
  const app=await buildApp({config,pool:fixture.runtimePool,database:{status:async()=> 'connected',close:async()=>{}}});
  const password=randomBytes(24).toString('base64url');
  let cookie='';const origin=new URL(config.APP_URL).origin;
  const request=async(method:'GET'|'POST'|'PATCH',url:string,payload?:unknown)=>app.inject({method,url,payload:payload as any,headers:{origin,'x-requested-with':'warehouse-admin',...(cookie?{cookie}:{})}});
  const makeClient=async(name:string)=>(await request('POST','/api/clients',{name,phone:'',email:'',contact:'',notes:''})).json();
  const makeWarehouse=async(number:string)=>(await request('POST','/api/warehouses',{number,area:24,address:'',notes:'',availability:'available'})).json();
  try {
    await t.test('migration re-run is idempotent and unauthenticated routes protected',async()=>{
      await migrate(pool);
      assert.equal((await request('GET','/api/clients')).statusCode,401);
      assert.equal((await request('GET','/api/auth/status')).json().needsSetup,true);
      await setupOwner(pool,password);
      await assert.rejects(()=>setupOwner(pool,randomBytes(20).toString('hex')));
      assert.equal((await request('POST','/api/auth/login',{password:'invalid-synthetic-password'})).statusCode,401);
      const login=await request('POST','/api/auth/login',{password});assert.equal(login.statusCode,200);
      cookie=String(login.headers['set-cookie']).split(';')[0]!;
      assert.ok(String(login.headers['set-cookie']).includes('HttpOnly'));
      assert.ok(String(login.headers['set-cookie']).includes('SameSite=Strict'));
      assert.equal((await request('GET','/api/auth/status')).json().authenticated,true);
      const forbidden=await app.inject({method:'POST',url:'/api/clients',headers:{cookie,origin:'https://outside.example','x-requested-with':'warehouse-admin'},payload:{name:'x'}});
      assert.equal(forbidden.statusCode,403);
    });
    const alice=await makeClient('Client A'),bob=await makeClient('Client B'),warehouse=await makeWarehouse('01'),warehouse2=await makeWarehouse('02');
    const today='2026-03-10';
    const lease=await createLease(pool,{clientId:alice.id,warehouseId:warehouse.id,startDate:'2026-01-31',monthlyRateMinor:10000,notes:''},today);
    const second=await createLease(pool,{clientId:alice.id,warehouseId:warehouse2.id,startDate:'2026-02-10',monthlyRateMinor:25000,notes:''},today);
    let charges=await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease.id]);
    await t.test('individual rates, anchored dates, overlap exclusion and optimistic edits',async()=>{
      assert.equal(lease.monthlyRateMinor,10000);assert.equal(second.monthlyRateMinor,25000);
      assert.equal(charges[0]!.periodEnd,'2026-02-28');assert.equal(charges[1]!.periodEnd,'2026-03-31');
      await assert.rejects(()=>createLease(pool,{clientId:bob.id,warehouseId:warehouse.id,startDate:'2026-03-01',monthlyRateMinor:9000,notes:''},today));
      const stale=await request('PATCH',`/api/clients/${alice.id}`,{name:'Changed',phone:'',email:'',contact:'',notes:'',version:99});assert.equal(stale.statusCode,409);
    });
    const pay=(amount:number,ids:string[],key=randomUUID())=>savePayment(pool,{leaseId:lease.id,receivedOn:'2026-03-07',amountMinor:amount,method:'transfer',notes:'',chargeIds:ids,idempotencyKey:key},today);
    let firstPayment:any;
    await t.test('partial payments, idempotency, prepay periods and gaps',async()=>{
      const key=randomUUID();firstPayment=await pay(4000,[charges[0]!.id],key);const repeat=await pay(4000,[charges[0]!.id],key);assert.equal(firstPayment.id,repeat.id);
      let current=await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease.id]);assert.equal(current[0]!.remainingMinor,6000);
      await pay(6000,[charges[0]!.id]);await pay(10000,[charges[2]!.id]);
      let state=(await allLeases(pool,today,'l.id=$1',[lease.id]))[0]!;assert.equal(state.paidThrough,'2026-02-28');assert.equal(state.nextDueDate,'2026-02-28');
      await pay(10000,[charges[1]!.id]);state=(await allLeases(pool,today,'l.id=$1',[lease.id]))[0]!;assert.equal(state.paidThrough,'2026-04-30');
      await pay(20000,[charges[3]!.id,charges[4]!.id]);
      await assert.rejects(()=>pay(1,[charges[0]!.id]));
      await assert.rejects(()=>paymentPreview(pool,{leaseId:lease.id,receivedOn:'2026-03-01',amountMinor:1,method:'cash',notes:'',chargeIds:([] as string[])},today));
      current=await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease.id]);assert.equal(current[4]!.remainingMinor,0);
    });
    await t.test('concurrent payments cannot over-allocate and failed transaction leaves no record',async()=>{
      const results=await Promise.allSettled([pay(10000,[charges[5]!.id]),pay(10000,[charges[5]!.id])]);
      assert.equal(results.filter((r)=>r.status==='fulfilled').length,1);
      const result=(await pool.query('SELECT count(*) FROM payments WHERE lease_id=$1',[lease.id])).rows[0];assert.equal(Number(result.count),6);
      const p=await pool.query('SELECT COALESCE(sum(a.amount_minor),0) AS total FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=$1 AND p.reversed_at IS NULL',[charges[5]!.id]);assert.equal(Number(p.rows[0].total),10000);
    });
    await t.test('rate snapshots and closing preserve paid history; reversal restores debt',async()=>{
      await assert.rejects(()=>changeRate(pool,lease.id,{effectiveDate:'2026-04-30',monthlyRateMinor:20000,version:1},today));
      await changeRate(pool,lease.id,{effectiveDate:'2026-08-31',monthlyRateMinor:20000,version:1},today);
      const refreshed=await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease.id]);
      assert.equal(refreshed.find((c)=>c.periodStart==='2026-08-31')!.amountMinor,20000);assert.equal(refreshed[0]!.amountMinor,10000);
      await assert.rejects(()=>releaseLease(pool,lease.id,1,today));
      await releaseLease(pool,lease.id,2,today);
      assert.ok((await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease.id])).every((c)=>c.periodStart<=today));
      await reversePayment(pool,firstPayment.id,'Synthetic correction');
      const after=await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease.id]);assert.equal(after[0]!.remainingMinor,4000);
      assert.equal((await pool.query('SELECT count(*) FROM payment_reversals WHERE payment_id=$1',[firstPayment.id])).rows[0].count,'1');
    });
    await t.test('receipts use received date, CSV sanitizes formulas, archive retains history',async()=>{
      const report=await request('GET','/api/reports/receipts?from=2026-03-01&to=2026-03-31');assert.equal(report.statusCode,200);assert.equal(report.json().totalMinor,56000);
      assert.equal((await request('GET','/api/reports/receipts?from=2026-01-01&to=2026-01-31')).json().totalMinor,0);
      await pool.query("UPDATE clients SET name='=FORMULA' WHERE id=$1",[alice.id]);
      const csv=await request('GET','/api/reports/receipts.csv?from=2026-03-01&to=2026-03-31');assert.ok(csv.body.includes("'=FORMULA"));
      assert.equal((await request('POST',`/api/clients/${alice.id}/archive`,{version:1})).statusCode,409);
      assert.equal((await request('POST',`/api/warehouses/${warehouse.id}/archive`,{version:1})).statusCode,200);
      const history=await request('GET',`/api/warehouses/${warehouse.id}`);assert.equal(history.statusCode,200);assert.ok(history.json().payments.length>=6);
    });
    await t.test('server rejects invalid amounts/cross-lease allocation and extending adds actual months',async()=>{
      const foreign=(await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[second.id]))[0]!;
      const input={leaseId:lease.id,receivedOn:'2026-03-01',amountMinor:0,method:'cash',notes:'',chargeIds:[foreign.id]};
      assert.equal((await request('POST','/api/payments/preview',input)).statusCode,400);
      assert.equal((await request('POST','/api/payments/preview',{...input,amountMinor:1})).statusCode,409);
      const count=Number((await pool.query('SELECT count(*) FROM charges WHERE lease_id=$1',[second.id])).rows[0].count);
      const extension=await request('POST',`/api/leases/${second.id}/extend-schedule`,{months:3});assert.equal(extension.statusCode,200);
      assert.equal(extension.json().length,count+3);
      const third=await makeWarehouse('03');
      const payload={clientId:bob.id,warehouseId:third.id,startDate:'2026-03-10',monthlyRateMinor:1000,notes:''};
      const concurrent=await Promise.all([request('POST','/api/leases',payload),request('POST','/api/leases',{...payload,clientId:alice.id})]);
      assert.deepEqual(concurrent.map((r)=>r.statusCode).sort(),[201,409]);
    });
    await t.test('reminders: configurable date, once, partial balance, transient retry, uncertain delivery',async()=>{
      await pool.query("UPDATE app_settings SET telegram_enabled=true,telegram_chat_id='0',reminder_days=5,reminder_time='09:00'");
      // Only a synthetic provider receives the synthetic placeholder; no network traffic.
      const workerConfig={...config,TELEGRAM_BOT_TOKEN:'synthetic-test-placeholder'};
      const april=(await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[second.id])).find((c)=>c.dueDate==='2026-04-10')!;
      await savePayment(pool,{leaseId:second.id,receivedOn:'2026-03-07',amountMinor:10000,method:'cash',notes:'',chargeIds:[april.id],idempotencyKey:randomUUID()},today);
      let sent=0,lastText='';const provider:TelegramProvider=async(_token,_chat,text)=>{sent++;lastText=text;return {state:'sent',code:'SENT',messageId:String(sent)};};
      await runScheduler(pool,workerConfig,provider,new Date('2026-04-05T10:00:00Z'));
      assert.ok(sent>=1);assert.ok(lastText.includes('Осталось:'));
      const count=sent;await runScheduler(pool,workerConfig,provider,new Date('2026-04-05T10:01:00Z'));assert.equal(sent,count);
      const sentJobs=await pool.query("SELECT charge_id FROM notification_jobs WHERE status='sent'");
      assert.ok(sentJobs.rows.some((j)=>j.charge_id===april.id));
      await pool.query("UPDATE app_settings SET reminder_days=0");
      let attempts=0;await runScheduler(pool,workerConfig,async()=>{attempts++;return {state:'retry',code:'TELEGRAM_RATE_LIMIT',retryAfter:60};},new Date('2026-05-10T10:00:00Z'));assert.ok(attempts>0);
      await runScheduler(pool,workerConfig,async()=>({state:'uncertain',code:'DELIVERY_UNCERTAIN'}),new Date('2026-05-10T10:02:00Z'));
      const uncertain=Number((await pool.query("SELECT count(*) FROM notification_jobs WHERE status='uncertain'")).rows[0].count);assert.ok(uncertain>0);
      let repeated=0;await runScheduler(pool,workerConfig,async()=>{repeated++;return {state:'sent',code:'SENT'};},new Date('2026-05-10T10:03:00Z'));assert.equal(repeated,0);
      const interruptedCharge=(await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[second.id])).find((c)=>c.dueDate==='2026-06-10')!;
      const interruptedId=randomUUID();await pool.query(`INSERT INTO notification_jobs(id,lease_id,charge_id,scheduled_on,rule_days,status,locked_until) VALUES($1,$2,$3,'2026-06-10',0,'sending','2026-05-09T10:00:00Z')`,[interruptedId,second.id,interruptedCharge.id]);
      await runScheduler(pool,workerConfig,async()=>({state:'sent',code:'SENT'}),new Date('2026-05-10T10:04:00Z'));
      const quarantined=(await pool.query('SELECT status,result_code FROM notification_jobs WHERE id=$1',[interruptedId])).rows[0];
      assert.equal(quarantined.status,'uncertain');assert.equal(quarantined.result_code,'WORKER_INTERRUPTED');
      await pool.query('UPDATE app_settings SET telegram_enabled=false');
    });
    await t.test('logout and password change revoke sessions; login throttle survives application state',async()=>{
      const newPassword=randomBytes(24).toString('base64url');
      assert.equal((await request('POST','/api/auth/change-password',{currentPassword:password,newPassword})).statusCode,200);
      assert.equal((await request('GET','/api/clients')).statusCode,401);
      const login=await request('POST','/api/auth/login',{password:newPassword});assert.equal(login.statusCode,200);cookie=String(login.headers['set-cookie']).split(';')[0]!;
      assert.equal((await request('POST','/api/auth/logout',{})).statusCode,200);assert.equal((await request('GET','/api/clients')).statusCode,401);
      for(let n=0;n<10;n++)assert.equal((await request('POST','/api/auth/login',{password:'invalid-synthetic-password'})).statusCode,401);
      assert.equal((await request('POST','/api/auth/login',{password:newPassword})).statusCode,429);
    });
  } finally {await app.close();await fixture.close();}
});

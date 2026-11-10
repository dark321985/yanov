import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes,randomUUID } from 'node:crypto';
import { testDatabase } from './helpers.js';
import { buildApp } from '../server/app.js';
import { setupOwner } from '../server/auth.js';
import { transaction } from '../server/db.js';
import { allCharges,allLeases,allPayments,allWarehouses,changeRate,context,createLease,ensureCharges,releaseLease,savePayment } from '../server/services.js';
import { runScheduler } from '../server/telegram.js';
import { boundary } from '../server/dates.js';

test('indefinite rentals: immediate release preserves money and debt, stops future charges, allows re-rental',async(t)=>{
  const fixture=await testDatabase(),{runtimePool:pool}=fixture;
  const clientId=randomUUID(),warehouseId=randomUUID(),scheduledWarehouseId=randomUUID(),apiWarehouseId=randomUUID();
  const today='2026-03-10';
  const app=await buildApp({config:fixture.config,pool,database:{status:async()=> 'connected',close:async()=>{}}});
  try {
    await pool.query("INSERT INTO clients(id,name) VALUES($1,'Synthetic rental client')",[clientId]);
    for(const [id,number] of [[warehouseId,'release'],[scheduledWarehouseId,'scheduled'],[apiWarehouseId,'api']])
      await pool.query('INSERT INTO warehouses(id,number,number_key) VALUES($1,$2,$2)',[id,number]);
    const lease=await createLease(pool,{clientId,warehouseId,startDate:'2026-02-01',monthlyRateMinor:10000,notes:''},today);
    const charges=await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease.id]);
    const pay=(amount:number,chargeId:string)=>savePayment(pool,{leaseId:lease.id,receivedOn:today,amountMinor:amount,method:'cash',notes:'',chargeIds:[chargeId],idempotencyKey:randomUUID()},today);
    await pay(4000,charges[0]!.id);await pay(10000,charges[2]!.id);
    for(const charge of [charges[0]!,charges[2]!])
      await pool.query("INSERT INTO notification_jobs(id,lease_id,charge_id,scheduled_on,rule_days) VALUES($1,$2,$3,$4,5)",[randomUUID(),lease.id,charge.id,charge.dueDate]);

    await t.test('release mid-month keeps full current amount, previous debt and paid future history',async()=>{
      assert.equal(lease.endDate,null);assert.equal(lease.releasedOn,null);
      await releaseLease(pool,lease.id,lease.version,today);
      const ended=(await allLeases(pool,today,'l.id=$1',[lease.id]))[0]!;
      assert.equal(ended.status,'ended');assert.equal(ended.releasedOn,today);assert.equal(ended.endDate,today);
      assert.equal(ended.debtMinor,16000);
      const kept=await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease.id]);
      assert.deepEqual(kept.map((c)=>[c.periodStart,c.amountMinor,c.remainingMinor]),[['2026-02-01',10000,6000],['2026-03-01',10000,10000]]);
      const payments=await allPayments(pool,'p.lease_id=$1',[lease.id]);
      assert.equal(payments.reduce((sum,p)=>sum+p.amountMinor,0),14000);
      assert.ok(payments.some((p)=>p.allocations.some((a)=>a.periodStart==='2026-04-01'&&a.amountMinor===10000)));
      assert.ok(payments.every((p)=>!p.reversedAt));
      assert.equal((await allWarehouses(pool,today)).find((w)=>w.id===warehouseId)!.currentLease,null);
      assert.equal((await pool.query("SELECT count(*) FROM notification_jobs WHERE lease_id=$1 AND status!='cancelled'",[lease.id])).rows[0].count,'0');
      await assert.rejects(()=>releaseLease(pool,lease.id,lease.version,today));
      await assert.rejects(()=>releaseLease(pool,lease.id,ended.version,today));
    });

    await t.test('scheduler cannot recreate cancelled periods or notify released rentals',async()=>{
      const before=(await pool.query('SELECT count(*) FROM charges WHERE lease_id=$1',[lease.id])).rows[0].count;
      await transaction(pool,async(tx)=>{await ensureCharges(tx,'2028-09-01');});
      assert.equal((await pool.query('SELECT count(*) FROM charges WHERE lease_id=$1',[lease.id])).rows[0].count,before);
      await pool.query("UPDATE app_settings SET telegram_enabled=true,telegram_chat_id='0',reminder_days=5,reminder_time='00:00'");
      let sent=0;
      await runScheduler(pool,{...fixture.config,TELEGRAM_BOT_TOKEN:'synthetic-test-placeholder'},async()=>{sent++;return {state:'sent',code:'SENT'};},new Date('2026-03-10T10:00:00Z'));
      assert.equal(sent,0);
      await pool.query('UPDATE app_settings SET telegram_enabled=false');
    });

    await t.test('same-day new rental and same-day release keep the started month without overlapping occupancy',async()=>{
      const next=await createLease(pool,{clientId,warehouseId,startDate:today,monthlyRateMinor:17000,notes:''},today);
      assert.equal((await allWarehouses(pool,today)).find((w)=>w.id===warehouseId)!.currentLease!.id,next.id);
      await releaseLease(pool,next.id,next.version,today);
      const kept=await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[next.id]);
      assert.equal(kept.length,1);assert.equal(kept[0]!.amountMinor,17000);
      const third=await createLease(pool,{clientId,warehouseId,startDate:today,monthlyRateMinor:18000,notes:''},today);
      assert.equal(third.status,'active');
    });

    await t.test('cancel before start removes all future charges and releases reservation immediately',async()=>{
      const scheduled=await createLease(pool,{clientId,warehouseId:scheduledWarehouseId,startDate:'2026-04-20',monthlyRateMinor:12000,notes:''},today);
      await releaseLease(pool,scheduled.id,scheduled.version,today);
      const ended=(await allLeases(pool,today,'l.id=$1',[scheduled.id]))[0]!;
      assert.equal(ended.status,'ended');assert.equal(ended.releasedOn,today);assert.equal(ended.endDate,'2026-04-20');
      assert.equal((await allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[scheduled.id])).length,0);
      assert.equal((await allWarehouses(pool,today)).find((w)=>w.id===scheduledWarehouseId)!.nextLease,null);
      await assert.rejects(()=>changeRate(pool,scheduled.id,{effectiveDate:'2026-04-20',monthlyRateMinor:9999,version:ended.version},today));
      await createLease(pool,{clientId,warehouseId:scheduledWarehouseId,startDate:today,monthlyRateMinor:12000,notes:''},today);
    });

    await t.test('API accepts no planned end; release date comes from server timezone and rejects supplied dates',async()=>{
      const password=randomBytes(24).toString('base64url');await setupOwner(fixture.pool,password);
      const origin=new URL(fixture.config.APP_URL).origin;
      const login=await app.inject({method:'POST',url:'/api/auth/login',payload:{password},headers:{origin,'x-requested-with':'warehouse-admin'}});
      assert.equal(login.statusCode,200);
      const headers={origin,'x-requested-with':'warehouse-admin',cookie:String(login.headers['set-cookie']).split(';')[0]!};
      const actualToday=(await context(pool)).today;
      const payload={clientId,warehouseId:apiWarehouseId,startDate:boundary(actualToday,1),monthlyRateMinor:10000,notes:''};
      assert.equal((await app.inject({method:'POST',url:'/api/leases',payload:{...payload,endDate:boundary(actualToday,3)},headers})).statusCode,400);
      const created=await app.inject({method:'POST',url:'/api/leases',payload,headers});assert.equal(created.statusCode,201);
      const dto=created.json();assert.equal(dto.endDate,null);
      const url=`/api/leases/${dto.id}/release`;
      assert.equal((await app.inject({method:'POST',url,payload:{version:dto.version,endDate:payload.startDate},headers})).statusCode,400);
      assert.equal((await app.inject({method:'POST',url,payload:{version:dto.version},headers})).statusCode,200);
      const detail=(await app.inject({method:'GET',url:`/api/leases/${dto.id}`,headers})).json();
      assert.equal(detail.lease.releasedOn,actualToday);assert.equal(detail.lease.status,'ended');assert.equal(detail.charges.length,0);
      assert.equal((await app.inject({method:'POST',url,payload:{version:dto.version},headers})).statusCode,409);
    });
  } finally {await app.close();await fixture.close();}
});

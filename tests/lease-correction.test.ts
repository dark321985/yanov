import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {testDatabase} from './helpers.js';
import {buildApp} from '../server/app.js';
import {setupOwner} from '../server/auth.js';
import {allCharges,allLeases,allWarehouses,changeRate,context,correctLease,createLease,releaseLease,reversePayment,savePayment} from '../server/services.js';
import {runScheduler} from '../server/telegram.js';
import {transaction} from '../server/db.js';

test('lease correction: same rental, audited date/amount changes, money and occupancy guards, mobile form',{timeout:180000},async(t)=>{
  const fixture=await testDatabase().catch(error=>{throw new Error(error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'CORRECTION_TEST_DATABASE_UNAVAILABLE');});
  const {runtimePool:pool}=fixture,config={...fixture.config};
  const password=randomBytes(24).toString('base64url');await setupOwner(fixture.pool,password);
  const app=await buildApp({config,pool,database:{status:async()=> 'connected',close:async()=>{}}});
  const clientId=randomUUID(),today='2026-11-15';
  const makeLease=async(startDate='2026-11-14',amount=1500000)=>{
    const warehouseId=randomUUID();
    await pool.query('INSERT INTO warehouses(id,number,number_key) VALUES($1,$2,$2)',[warehouseId,warehouseId]);
    return createLease(pool,{clientId,warehouseId,startDate,monthlyRateMinor:amount,notes:'Keep this note'},today);
  };
  const chargesFor=(id:string)=>allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[id]);
  try {
    await pool.query("INSERT INTO clients(id,name) VALUES($1,'Correction tenant')",[clientId]);
    const lease=await makeLease(),original=await chargesFor(lease.id);
    const pendingId=randomUUID(),sentId=randomUUID();
    await pool.query("INSERT INTO notification_jobs(id,lease_id,charge_id,scheduled_on,rule_days) VALUES($1,$2,$3,'2026-12-09',5)",[pendingId,lease.id,original[1]!.id]);
    await pool.query("INSERT INTO notification_jobs(id,lease_id,charge_id,scheduled_on,rule_days,status) VALUES($1,$2,$3,'2026-11-09',5,'sent')",[sentId,lease.id,original[0]!.id]);
    await t.test('14th to 1st and corrected price keep IDs, notes, warehouse and original audit snapshot',async()=>{
      await correctLease(pool,lease.id,{startDate:'2026-11-01',monthlyRateMinor:1750000,version:lease.version},today);
      const after=(await allLeases(pool,today,'l.id=$1',[lease.id]))[0]!,charges=await chargesFor(lease.id);
      assert.equal(after.startDate,'2026-11-01');assert.equal(after.monthlyRateMinor,1750000);assert.equal(after.notes,'Keep this note');assert.equal(after.version,2);
      assert.equal(after.debtMinor,1750000);assert.equal(after.status,'active');assert.equal(after.rates.length,1);
      assert.equal((await allWarehouses(pool,today)).find(w=>w.id===lease.warehouseId)!.currentLease!.id,lease.id);
      assert.deepEqual(charges.map(c=>c.id),original.map(c=>c.id));
      assert.deepEqual(charges.slice(0,2).map(c=>[c.periodStart,c.periodEnd,c.dueDate,c.amountMinor]),[['2026-11-01','2026-12-01','2026-11-01',1750000],['2026-12-01','2027-01-01','2026-12-01',1750000]]);
      const event=(await pool.query("SELECT detail FROM audit_events WHERE entity_id=$1 AND action='corrected'",[lease.id])).rows[0].detail;
      assert.equal(event.fromStartDate,'2026-11-14');assert.equal(event.fromMonthlyRateMinor,1500000);assert.equal(event.chargesBefore[0].periodStart,'2026-11-14');
      assert.equal((await pool.query('SELECT count(*) FROM leases WHERE warehouse_id=$1',[lease.warehouseId])).rows[0].count,'1');
      assert.equal((await pool.query('SELECT status FROM notification_jobs WHERE id=$1',[pendingId])).rows[0].status,'cancelled');
      assert.equal((await pool.query('SELECT status FROM notification_jobs WHERE id=$1',[sentId])).rows[0].status,'sent');
      await assert.rejects(()=>correctLease(pool,lease.id,{startDate:'2026-11-01',monthlyRateMinor:1800000,version:1},today));
    });
    await t.test('stale reminder cannot send after a date correction; new schedule sends corrected dates and amount',async()=>{
      await pool.query("UPDATE app_settings SET telegram_enabled=true,telegram_chat_id='0',reminder_time='00:00'");
      const stale=randomUUID();
      await pool.query("INSERT INTO notification_jobs(id,lease_id,charge_id,scheduled_on,rule_days,next_attempt_at) VALUES($1,$2,$3,'2026-11-09',5,'2026-11-01T00:00:00Z')",[stale,lease.id,original[1]!.id]);
      const delivered:string[]=[];
      const worker={...config,TELEGRAM_BOT_TOKEN:'synthetic-test-placeholder'};
      const provider=async(_token:string,_chat:string,message:string)=>{delivered.push(message);return {state:'sent' as const,code:'SENT'};};
      await runScheduler(pool,worker,provider,new Date('2026-11-14T10:00:00Z'));
      assert.equal(delivered.length,0);assert.equal((await pool.query('SELECT status FROM notification_jobs WHERE id=$1',[stale])).rows[0].status,'cancelled');
      await runScheduler(pool,worker,provider,new Date('2026-11-26T10:00:00Z'));
      assert.equal(delivered.length,1);assert.ok(delivered[0]!.includes('Период: 2026-12-01'));assert.ok(delivered[0]!.includes('17'));
      await pool.query('UPDATE app_settings SET telegram_enabled=false');
    });
    await t.test('partial payments and even reversed payment history block changing original conditions',async()=>{
      const payment=await savePayment(pool,{leaseId:lease.id,receivedOn:today,amountMinor:10000,method:'cash',notes:'',chargeIds:[original[0]!.id],idempotencyKey:randomUUID()},today);
      const before=await chargesFor(lease.id);
      await assert.rejects(()=>correctLease(pool,lease.id,{startDate:'2026-10-01',monthlyRateMinor:1000000,version:2},today));
      assert.deepEqual(await chargesFor(lease.id),before);
      await reversePayment(pool,payment.id,'Synthetic payment correction');
      await assert.rejects(()=>correctLease(pool,lease.id,{startDate:'2026-10-01',monthlyRateMinor:1000000,version:2},today));
    });
    await t.test('real overlap rolls back the entire correction, while one lease never conflicts with itself',async()=>{
      const old=await makeLease('2026-10-01');await releaseLease(pool,old.id,old.version,'2026-11-10');
      const next=await createLease(pool,{clientId,warehouseId:old.warehouseId,startDate:'2026-11-14',monthlyRateMinor:1500000,notes:''},today);
      const before=await chargesFor(next.id);
      await assert.rejects(()=>correctLease(pool,next.id,{startDate:'2026-11-01',monthlyRateMinor:2000000,version:1},today));
      assert.equal((await allLeases(pool,today,'l.id=$1',[next.id]))[0]!.startDate,'2026-11-14');assert.deepEqual(await chargesFor(next.id),before);
      assert.equal((await pool.query("SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action='corrected'",[next.id])).rows[0].count,'0');
      const rateLease=await makeLease();await changeRate(pool,rateLease.id,{effectiveDate:'2026-12-14',monthlyRateMinor:2000000,version:1},today);
      await assert.rejects(()=>correctLease(pool,rateLease.id,{startDate:'2026-11-01',monthlyRateMinor:1800000,version:2},today));
      await assert.rejects(()=>correctLease(pool,old.id,{startDate:'2026-09-01',monthlyRateMinor:1800000,version:2},today));
    });
    await t.test('server validates correction fields and exposes correction history',async()=>{
      const origin=new URL(config.APP_URL).origin;
      const unauth=await app.inject({method:'POST',url:`/api/leases/${lease.id}/correct`,payload:{startDate:'2026-11-01',monthlyRateMinor:0,version:2}});assert.equal(unauth.statusCode,401);
      const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{origin,'x-requested-with':'warehouse-admin'},payload:{password}});
      const headers={origin,'x-requested-with':'warehouse-admin',cookie:String(login.headers['set-cookie']).split(';')[0]!};
      const invalid=await app.inject({method:'POST',url:`/api/leases/${lease.id}/correct`,headers,payload:{startDate:'2026-11-01',monthlyRateMinor:0,version:2}});assert.equal(invalid.statusCode,400);
      const detail=await app.inject({method:'GET',url:`/api/leases/${lease.id}`,headers});assert.equal(detail.statusCode,200);assert.equal(detail.json().corrections.length,1);assert.equal(detail.json().corrections[0].toMonthlyRateMinor,1750000);
    });
    await t.test('month anchors, extended horizon and repeated price-only corrections stay consistent',async()=>{
      const short=await makeLease('2026-01-31');
      await correctLease(pool,short.id,{startDate:'2026-01-30',monthlyRateMinor:2000000,version:1},today);
      const charges=await chargesFor(short.id);
      assert.equal(charges[0]!.periodEnd,'2026-02-28');assert.equal(charges[1]!.periodEnd,'2026-03-30');
      await transaction(pool,async tx=>{const {ensureCharges}=await import('../server/services.js');await ensureCharges(tx,today,30,short.id);});
      const count=(await chargesFor(short.id)).length;
      await correctLease(pool,short.id,{startDate:'2026-01-30',monthlyRateMinor:2100000,version:2},today);
      assert.equal((await chargesFor(short.id)).length,count);
    });
    await t.test('mobile owner can edit date and price in one form, see history, and cannot edit after payment',async()=>{
      const uiLease=await makeLease(),{today:actualToday}=await context(pool);
      await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('CORRECTION_API_UNAVAILABLE');
      const target=`http://127.0.0.1:${address.port}`;
      const vite=await createServer({logLevel:'silent',cacheDir:resolve('.local/vite-correction-cache'),server:{host:'127.0.0.1',port:0,proxy:{'/api':target,'/health':target}}});
      await vite.listen();const frontend=vite.httpServer?.address();if(!frontend||typeof frontend==='string')throw new Error('CORRECTION_FRONTEND_UNAVAILABLE');
      config.APP_URL=`http://127.0.0.1:${frontend.port}`;
      const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:390,height:844}});
      let step='login';const errors:string[]=[];page.on('pageerror',()=>errors.push('RUNTIME_ERROR'));
      try {
        await page.goto(config.APP_URL);await page.getByLabel('Пароль',{exact:false}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();await expect(page.getByRole('heading',{name:'Обзор аренды',exact:true})).toBeVisible();
        step='edit date and amount';await page.goto(config.APP_URL+`/leases/${uiLease.id}`);await page.getByRole('button',{name:'Исправить аренду',exact:true}).click();
        let dialog=page.getByRole('dialog');await dialog.getByLabel('Начало аренды',{exact:false}).fill('2026-11-01');await dialog.getByLabel('Ставка за расчётный месяц, ₽',{exact:false}).fill('17500');await dialog.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await expect(dialog).toHaveCount(0);
        await expect(page.locator('.lease-summary').getByText(/17\s*500/).first()).toBeVisible();
        assert.equal((await allLeases(pool,today,'l.id=$1',[uiLease.id]))[0]!.startDate,'2026-11-01');
        step='history';await page.getByRole('tab',{name:'Ставки и условия',exact:true}).click();await expect(page.getByRole('heading',{name:'Исправления исходных условий',exact:true})).toBeVisible();
        step='history table';await expect(page.getByLabel('Исправления аренды',{exact:true})).toBeVisible();
        step='price-only edit';await page.getByRole('button',{name:'Исправить аренду',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByLabel('Ставка за расчётный месяц, ₽',{exact:false}).fill('18000');await dialog.getByRole('button',{name:'Сохранить исправление',exact:true}).click();await expect(dialog).toHaveCount(0);
        const first=(await chargesFor(uiLease.id))[0]!;assert.equal(first.amountMinor,1800000);
        await savePayment(pool,{leaseId:uiLease.id,receivedOn:actualToday,amountMinor:10000,method:'cash',notes:'',chargeIds:[first.id],idempotencyKey:randomUUID()},actualToday);
        step='payment guard';await page.reload();await page.getByRole('button',{name:'Исправить аренду',exact:true}).click();dialog=page.getByRole('dialog');await expect(dialog.getByText(/уже есть история оплат/)).toBeVisible();await expect(dialog.getByRole('button',{name:'Сохранить исправление',exact:true})).toBeDisabled();assert.deepEqual(errors,[]);
      }catch{console.error(JSON.stringify({step,runtimeErrors:errors.length}));throw new Error('CORRECTION_MOBILE_SCENARIO_FAILED');}
      finally{await browser.close();await vite.close();}
    });
  }finally{await app.close();await fixture.close();}
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {testDatabase} from './helpers.js';
import {seedDemo} from '../server/seed.js';
import {setupOwner} from '../server/auth.js';
import {buildApp} from '../server/app.js';
import {context,allCharges,allLeases} from '../server/services.js';
import {boundary,addDays} from '../server/dates.js';

test('demo finance: payment postings, partial/multi-month/reversal, charts and full-width calendar',{timeout:180000},async(t)=>{
  const fixture=await testDatabase(),config={...fixture.config};
  await seedDemo(fixture.pool);
  const password=randomBytes(24).toString('base64url');await setupOwner(fixture.pool,password);
  const app=await buildApp({config,pool:fixture.runtimePool,database:{status:async()=> 'connected',close:async()=>{}}});
  let cookie='';const {today}=await context(fixture.pool),monthStart=today.slice(0,7)+'-01',from=boundary(monthStart,-2);
  const expectedMonths=[{label:from.slice(0,7),amountMinor:4300000},{label:boundary(monthStart,-1).slice(0,7),amountMinor:3700000},{label:monthStart.slice(0,7),amountMinor:3000000}];
  const request=async(method:'GET'|'POST',url:string,payload?:unknown)=>app.inject({method,url,payload:payload as any,headers:{origin:new URL(config.APP_URL).origin,'x-requested-with':'warehouse-admin',...(cookie?{cookie}:{})}});
  const login=await request('POST','/api/auth/login',{password});assert.equal(login.statusCode,200);cookie=String(login.headers['set-cookie']).split(';')[0]!;
  const control=async()=>{
    const response=await request('GET',`/api/reports/receipts?from=${from}&to=${today}`);assert.equal(response.statusCode,200);return response.json();
  };
  let vite:Awaited<ReturnType<typeof createServer>>|undefined;
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  const summary:Record<string,unknown>={date:today};
  try {
    await t.test('seed postings balance and API graph agrees with the receipt register',async()=>{
      const rows=(await fixture.pool.query('SELECT (SELECT count(*) FROM clients) AS clients,(SELECT count(*) FROM warehouses) AS warehouses,(SELECT count(*) FROM leases) AS leases,(SELECT count(*) FROM payments) AS payments')).rows[0];
      assert.deepEqual(Object.values(rows).map(Number),[4,8,5,7]);
      const unbalanced=await fixture.pool.query(`SELECT p.id FROM payments p LEFT JOIN payment_allocations a ON a.payment_id=p.id GROUP BY p.id HAVING p.amount_minor<>COALESCE(sum(a.amount_minor),0)`);assert.equal(unbalanced.rowCount,0);
      const report=await control();assert.equal(report.totalMinor,11000000);assert.deepEqual(report.byMonth.map((m:any)=>({label:m.label,amountMinor:m.amountMinor})),expectedMonths);
      assert.equal(report.byWarehouse.reduce((sum:number,row:any)=>sum+row.amountMinor,0),11000000);
      assert.equal(report.byClient.reduce((sum:number,row:any)=>sum+row.amountMinor,0),11000000);
      const dashboard=(await request('GET',`/api/dashboard?from=${monthStart}&to=${today}`)).json();assert.equal(dashboard.totals.receivedMinor,3000000);
      const charges=await allCharges(fixture.pool,today);assert.equal(dashboard.totals.overdueMinor,charges.filter((c)=>c.dueDate<today).reduce((sum,c)=>sum+c.remainingMinor,0));
      assert.equal(dashboard.totals.occupiedWarehouses,4);assert.equal(dashboard.totals.totalWarehouses,8);
      summary.seed={clients:4,warehouses:8,leases:5,payments:7,totalRub:110000,currentMonthRub:30000,overdueRub:dashboard.totals.overdueMinor/100,months:expectedMonths.map((m)=>({month:m.label,rubles:m.amountMinor/100}))};
    });
    const leases=await allLeases(fixture.pool,today);
    await t.test('partial payment closes the exact old remainder; retry does not duplicate; reversal restores it',async()=>{
      const lease=leases.find((l)=>l.warehouseNumber==='03')!,charge=(await allCharges(fixture.pool,today,'c.lease_id=$1',[lease.id]))[0]!;
      assert.equal(charge.amountMinor,1200000);assert.equal(charge.paidMinor,600000);assert.equal(charge.remainingMinor,600000);
      const input={leaseId:lease.id,receivedOn:today,amountMinor:600000,chargeIds:[charge.id],method:'cash',notes:'Проверка закрытия частичной оплаты',idempotencyKey:randomUUID()};
      const preview=await request('POST','/api/payments/preview',input);assert.equal(preview.statusCode,200);assert.equal(preview.json().remainingAfterMinor,0);
      const result=await request('POST','/api/payments',input);assert.equal(result.statusCode,201);
      const repeated=await request('POST','/api/payments',input);assert.equal(repeated.statusCode,201);assert.equal(result.json().id,repeated.json().id);
      const updated=(await allCharges(fixture.pool,today,'c.id=$1',[charge.id]))[0]!;assert.equal(updated.remainingMinor,0);assert.equal(updated.status,'paid');assert.equal((await control()).totalMinor,11600000);
      assert.equal((await request('POST',`/api/payments/${result.json().id}/reverse`,{reason:'Завершение тестовой проверки'})).statusCode,200);
      assert.equal((await allCharges(fixture.pool,today,'c.id=$1',[charge.id]))[0]!.remainingMinor,600000);assert.equal((await control()).totalMinor,11000000);
      summary.partial={addedRub:6000,remainingRubAfter:0,duplicateCreated:false,afterReversalRemainingRub:6000};
    });
    await t.test('one multi-month payment allocates correctly and updates overdue and future schedule',async()=>{
      const lease=leases.find((l)=>l.warehouseNumber==='02')!,charges=await allCharges(fixture.pool,today,'c.lease_id=$1',[lease.id]);
      const selected=charges.filter((c)=>c.periodStart===monthStart||c.periodStart===boundary(monthStart,1));assert.equal(selected.length,2);
      const input={leaseId:lease.id,receivedOn:today,amountMinor:4400000,chargeIds:selected.map((c)=>c.id),method:'transfer',notes:'Проверка двух месяцев',idempotencyKey:randomUUID()};
      const preview=await request('POST','/api/payments/preview',input);assert.equal(preview.statusCode,200);assert.deepEqual(preview.json().allocations.map((a:any)=>a.amountMinor),[2200000,2200000]);
      const result=await request('POST','/api/payments',input);assert.equal(result.statusCode,201);assert.equal(result.json().allocations.length,2);
      for(const selectedCharge of selected)assert.equal((await allCharges(fixture.pool,today,'c.id=$1',[selectedCharge.id]))[0]!.remainingMinor,0);
      const leaseAfter=(await allLeases(fixture.pool,today,'l.id=$1',[lease.id]))[0]!;assert.equal(leaseAfter.paidThrough,boundary(monthStart,2));
      assert.equal((await control()).totalMinor,15400000);
      assert.equal((await request('POST',`/api/payments/${result.json().id}/reverse`,{reason:'Завершение тестовой проверки'})).statusCode,200);
      assert.equal((await control()).totalMinor,11000000);
      summary.multiMonth={paymentRub:44000,allocatedRub:[22000,22000],paidThroughInclusive:addDays(boundary(monthStart,2),-1),totalsAfterReversalRub:110000};
    });
    await t.test('browser chart values, calendar events, calendar width and mobile layout',async()=>{
      await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string')throw new Error('QA_API_UNAVAILABLE');
      const target=`http://127.0.0.1:${address.port}`;
      vite=await createServer({logLevel:'silent',cacheDir:resolve('.local/vite-demo-cache'),server:{host:'127.0.0.1',port:0,strictPort:false,proxy:{'/api':target,'/health':target}}});
      await vite.listen();const frontend=vite.httpServer?.address();if(!frontend||typeof frontend==='string')throw new Error('QA_FRONTEND_UNAVAILABLE');
      config.APP_URL=`http://127.0.0.1:${frontend.port}`;
      browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
      let step='login';const errors:string[]=[];page.on('pageerror',()=>errors.push('BROWSER_RUNTIME_ERROR'));
      try {
        await page.goto(config.APP_URL);await page.getByLabel('Пароль',{exact:false}).fill(password);await page.getByRole('button',{name:'Войти',exact:true}).click();
        await expect(page.getByRole('heading',{name:'Обзор аренды',exact:true})).toBeVisible();await expect(page.getByText('30 000',{exact:false}).first()).toBeVisible();
        step='receipts chart';await page.goto(config.APP_URL+'/reports');await page.getByLabel('С даты',{exact:false}).fill(from);await page.getByLabel('По дату',{exact:false}).fill(today);
        await expect(page.getByText('110 000',{exact:false}).first()).toBeVisible();
        const chart=page.getByRole('img',{name:'Поступления по месяцам',exact:true});await expect(chart).toBeVisible();
        const titles=await chart.locator('g title').allTextContents();
        for(const item of expectedMonths)assert.ok(titles.some((title)=>title.replace(/\s/g,'').includes(`${item.label}:${item.amountMinor/100}₽`)));
        await mkdir(resolve('.local/screenshots'),{recursive:true});await page.screenshot({path:resolve('.local/screenshots/demo-receipts.png'),fullPage:true,animations:'disabled'});
        step='calendar desktop';await page.goto(config.APP_URL+'/schedule');const calendar=page.locator('.payment-calendar');await expect(calendar).toBeVisible();
        const box=await calendar.boundingBox();assert.ok(box&&box.width>900,'Calendar must use workspace width, not HeroUI compact calendar width');
        const columns=await page.evaluate<number[]>("getComputedStyle(document.querySelector('.payment-calendar__grid')).gridTemplateColumns.split(' ').map(value=>parseFloat(value))");
        assert.equal(columns.length,7);assert.ok(columns.every((width)=>width>100));
        await expect(calendar.getByRole('button',{name:/Платежей: 4$/})).toHaveCount(1);
        await calendar.getByRole('button',{name:/Платежей: 4$/}).click();
        const selectedDay=page.getByRole('heading',{name:/Платежи на/}).locator('xpath=ancestor::section[1]');await expect(selectedDay.getByRole('row')).toHaveCount(5);
        await page.screenshot({path:resolve('.local/screenshots/demo-calendar-desktop.png'),fullPage:true,animations:'disabled'});
        step='calendar mobile';await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.locator('.payment-calendar')).toBeVisible();
        assert.ok(await page.evaluate<boolean>('document.documentElement.scrollWidth<=innerWidth+1'));
        const mobile=await page.locator('.payment-calendar').boundingBox();assert.ok(mobile&&mobile.width>=330&&mobile.width<=390);
        const busyDay=page.locator('.payment-calendar').getByRole('button',{name:/Платежей: 4$/});
        await expect(busyDay.locator('.payment-calendar-event')).toHaveCount(3);
        for(const event of await busyDay.locator('.payment-calendar-event').all())await expect(event).toBeVisible();
        await expect(busyDay.locator('.payment-calendar__more')).toHaveText('Ещё 1');
        await page.screenshot({path:resolve('.local/screenshots/demo-calendar-mobile.png'),fullPage:true,animations:'disabled'});
        assert.deepEqual(errors,[]);summary.browser={chartMonths:3,chartTotalRub:110000,calendarDesktopWidth:Math.round(box!.width),calendarColumns:7,dayPaymentsShown:4,mobileOverflow:false};
      } catch {console.error(JSON.stringify({step,runtimeErrors:errors.length}));throw new Error('DEMO_BROWSER_CHECK_FAILED: '+step);}
      finally{await page.close();}
    });
    await mkdir(resolve('.local'),{recursive:true});await writeFile(resolve('.local/demo-finance-check.json'),JSON.stringify(summary,null,2),'utf8');
    console.log(JSON.stringify(summary));
  } finally {await browser?.close();await vite?.close();await app.close();await fixture.close();}
});

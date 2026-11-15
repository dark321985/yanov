import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'vite';
import {testDatabase} from './helpers.js';
import {setupOwner} from '../server/auth.js';
import {buildApp} from '../server/app.js';
import {context,createLease} from '../server/services.js';

test('feedback: visible mobile error popups, repeated failures, preserved form and HeroUI success toast',{timeout:180000},async()=>{
  const fixture=await testDatabase().catch(()=>{throw new Error('FEEDBACK_TEST_DATABASE_UNAVAILABLE');});
  const password=randomBytes(24).toString('base64url');
  await setupOwner(fixture.pool,password);
  const clientId=randomUUID(),warehouseId=randomUUID(),freeWarehouseId=randomUUID();
  await fixture.pool.query("INSERT INTO clients(id,name) VALUES($1,'Popup tenant')",[clientId]);
  for(const [id,name] of [[warehouseId,'POP-01'],[freeWarehouseId,'POP-02']])
    await fixture.pool.query('INSERT INTO warehouses(id,number,number_key) VALUES($1,$2,$2)',[id,name]);
  const {today}=await context(fixture.runtimePool);
  await createLease(fixture.runtimePool,{clientId,warehouseId,startDate:today,monthlyRateMinor:1500000,notes:''},today);
  const config={...fixture.config};
  const app=await buildApp({config,pool:fixture.runtimePool,database:{status:async()=> 'connected',close:async()=>{}}});
  await app.listen({host:'127.0.0.1',port:0});
  const address=app.server.address();if(!address||typeof address==='string')throw new Error('FEEDBACK_API_UNAVAILABLE');
  const apiUrl=`http://127.0.0.1:${address.port}`;
  const vite=await createServer({logLevel:'silent',cacheDir:resolve('.local/vite-feedback-cache'),server:{host:'127.0.0.1',port:0,proxy:{'/api':apiUrl,'/health':apiUrl}}});
  await vite.listen();const frontend=vite.httpServer?.address();
  if(!frontend||typeof frontend==='string')throw new Error('FEEDBACK_FRONTEND_UNAVAILABLE');
  const origin=`http://127.0.0.1:${frontend.port}`;config.APP_URL=origin;
  const browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:390,height:844}});
  let step='login error';
  const runtimeErrors:string[]=[];page.on('pageerror',()=>runtimeErrors.push('BROWSER_RUNTIME_ERROR'));
  try {
    await page.goto(origin);
    await page.getByLabel('Пароль',{exact:false}).fill('synthetic-invalid-password');
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    let popup=page.locator('.error-popup-dialog');
    await expect(popup).toBeVisible();
    await expect(popup.getByRole('button',{name:'Понятно',exact:true})).toBeFocused();
    await popup.getByRole('button',{name:'Понятно',exact:true}).click();
    await expect(popup).toHaveCount(0);
    await page.getByLabel('Пароль',{exact:false}).fill(password);
    await page.getByRole('button',{name:'Войти',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Обзор аренды',exact:true})).toBeVisible();

    for(const width of [1440,390,320]) {
      step=`occupied warehouse ${width}`;
      await page.setViewportSize({width,height:width===320?568:844});
      await page.goto(origin+'/leases');
      await page.getByRole('button',{name:'Оформить аренду',exact:true}).first().click();
      const form=page.locator('.editor-dialog');
      await form.getByRole('button',{name:/Клиент/}).click();
      await page.getByRole('option',{name:'Popup tenant',exact:true}).click();
      await form.getByRole('button',{name:/Склад/}).click();
      await page.getByRole('option',{name:/POP-01/}).click();
      await form.getByLabel('Ставка за расчётный месяц, ₽',{exact:false}).fill('15000');
      await form.getByLabel('Заметка к аренде',{exact:false}).fill('Preserve this note after an error');
      await form.getByRole('button',{name:'Сохранить',exact:true}).click();
      popup=page.locator('.error-popup-dialog');
      await expect(popup).toBeVisible();
      await expect(popup.getByText('Этот склад уже арендован в выбранные даты.',{exact:true})).toBeVisible();
      await page.waitForTimeout(350);
      await expect(popup.getByText(/Данные могли измениться/)).toHaveCount(0);
      const box=await popup.boundingBox();assert.ok(box);
      assert.ok(box.x>=0&&box.y>=0&&box.x+box.width<=width+1&&box.y+box.height<=(page.viewportSize()!.height)+1,'Popup fits the viewport');
      assert.ok(await popup.evaluate(element=>{const box=element.getBoundingClientRect();return element.contains(element.ownerDocument.elementFromPoint(box.left+box.width/2,box.top+box.height/2));}),'Error popup is above the editor');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      await expect(popup).toBeVisible();
      if(width===390) {
        await mkdir(resolve('.local/screenshots'),{recursive:true});
        await page.screenshot({path:resolve('.local/screenshots/mobile-save-error.png')});
      }
      await popup.getByRole('button',{name:'Понятно',exact:true}).click();
      await expect(popup).toHaveCount(0);
      await expect(form.getByLabel('Заметка к аренде',{exact:false})).toHaveValue('Preserve this note after an error');
      await expect(form.getByLabel('Ставка за расчётный месяц, ₽',{exact:false})).toHaveValue('15000');
      await form.getByRole('button',{name:'Сохранить',exact:true}).click();
      await expect(popup).toBeVisible();
      await popup.getByRole('button',{name:'Понятно',exact:true}).click();
      await expect(popup).toHaveCount(0);
      if(width===320) {
        step='correct and save';
        await form.getByRole('button',{name:/Склад/}).click();
        await page.getByRole('option',{name:/POP-02/}).click();
        await form.getByRole('button',{name:'Сохранить',exact:true}).click();
        await expect(form).toHaveCount(0);
        const toast=page.locator('.workspace-toasts .toast');
        await expect(toast.getByText('Аренда оформлена',{exact:true})).toBeVisible();
        const toastBox=await toast.boundingBox();assert.ok(toastBox&&toastBox.x>=0&&toastBox.x+toastBox.width<=321);
      } else {
        await form.getByRole('button',{name:'Отмена',exact:true}).click();
        await page.getByRole('button',{name:'Закрыть без сохранения',exact:true}).click();
        await expect(form).toHaveCount(0);
      }
    }
    assert.equal((await fixture.pool.query('SELECT count(*) FROM leases')).rows[0].count,'2');
    step='loading error retry';
    let loadingFailure=true;
    await page.route('**/api/clients?**',async route=>loadingFailure
      ? route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({code:'TEMPORARY',message:'Тест: сервер временно недоступен.'})})
      : route.continue());
    await page.goto(origin+'/clients');
    popup=page.locator('.error-popup-dialog');
    step='loading error popup';
    await expect(popup.getByText('Тест: сервер временно недоступен.',{exact:true})).toBeVisible();
    loadingFailure=false;
    await popup.getByRole('button',{name:'Повторить',exact:true}).click();
    step='loading recovery';
    await expect(popup).toHaveCount(0);
    step='loading recovery row';
    await expect(page.locator('.client-cell').filter({hasText:'Popup tenant'})).toBeVisible();
    assert.deepEqual(runtimeErrors,[]);
  }catch {
    console.error(JSON.stringify({step,runtimeErrors:runtimeErrors.length,popups:await page.locator('.error-popup-dialog').count(),clientCells:await page.locator('.client-cell').count(),tenantLinks:await page.getByRole('link',{name:/Popup tenant/}).count()}));
    if(step.startsWith('loading'))await page.screenshot({path:resolve('.local/screenshots/feedback-retry-failure.png')}).catch(()=>{});
    throw new Error('FEEDBACK_BROWSER_SCENARIO_FAILED');
  }finally{await browser.close();await vite.close();await app.close();await fixture.close();}
});

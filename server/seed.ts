import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './db.js';
import { boundary, addDays } from './dates.js';
import { allCharges, audit, context, ensureCharges } from './services.js';
import { conflict } from './errors.js';

export async function seedDemo(pool:pg.Pool) {
  await transaction(pool,async(tx)=>{
    await tx.query('SELECT pg_advisory_xact_lock(72904113)');
    const existing=(await tx.query('SELECT (SELECT count(*) FROM clients)+(SELECT count(*) FROM warehouses) AS count')).rows[0];
    if(Number(existing.count)>0)throw conflict('Пример можно загрузить только в пустую тестовую базу. Реальные записи не изменены.');
    const {today}=await context(tx),monthStart=today.slice(0,7)+'-01';
    const clients=[['Александр Морозов','Хранение оборудования'],['ООО «Мастерская»','Инструменты и материалы'],['Мария Соколова','Товары интернет-магазина'],['ИП Кузнецов','Сезонное хранение']];
    const clientIds=clients.map(()=>randomUUID()),warehouseIds=Array.from({length:8},()=>randomUUID());
    for(const [i,client]of clients.entries())await tx.query('INSERT INTO clients(id,name,notes) VALUES($1,$2,$3)',[clientIds[i],client![0],client![1]]);
    for(const [i,id]of warehouseIds.entries())await tx.query('INSERT INTO warehouses(id,number,number_key,area,address,availability) VALUES($1,$2,$2,$3,$4,$5)',[id,String(i+1).padStart(2,'0'),[24,36,18,42,30,24,48,20][i],'Основная площадка',i===7?'maintenance':'available']);
    for(let i=0;i<5;i++) {
      const lease=randomUUID(),rate=[1500000,2200000,1200000,2800000,1700000][i]!,start=i===4?addDays(today,5):boundary(monthStart,-2);
      await tx.query('INSERT INTO leases(id,client_id,warehouse_id,start_date) VALUES($1,$2,$3,$4)',[lease,clientIds[i%4],warehouseIds[i],start]);
      await tx.query('INSERT INTO lease_rate_versions(id,lease_id,effective_date,monthly_amount_minor) VALUES($1,$2,$3,$4)',[randomUUID(),lease,start,rate]);
      await ensureCharges(tx,today,12,lease);
      const charges=await allCharges(tx,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[lease]);
      const paidCount=i===0?4:i===1?2:i===2?1:0;
      for(let j=0;j<paidCount;j++) {
        const c=charges[j]!,payment=randomUUID(),amount=i===2?Math.floor(rate/2):rate;
        await tx.query(`INSERT INTO payments(id,lease_id,received_on,amount_minor,method,idempotency_key,request_hash,notes) VALUES($1,$2,$3,$4,'transfer',$5,'demo','Пример записи')`,[payment,lease,c.dueDate>today?today:c.dueDate,amount,randomUUID()]);
        await tx.query('INSERT INTO payment_allocations(id,lease_id,payment_id,charge_id,amount_minor) VALUES($1,$2,$3,$4,$5)',[randomUUID(),lease,payment,c.id,amount]);
      }
    }
    await audit(tx,'demo',null,'loaded');
  });
}

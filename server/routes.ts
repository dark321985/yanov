import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import { authenticated, checkMutationOrigin } from './auth.js';
import { transaction } from './db.js';
import { AppError, conflict, missing } from './errors.js';
import * as v from './validation.js';
import * as s from './services.js';
import { addDays,periodIndex } from './dates.js';
import { registerNotificationRoutes } from './telegram.js';
import { seedDemo } from './seed.js';

const params=z.object({id:v.id});
function page<T>(items:T[],q:{page:number;pageSize:number}) {return {items:items.slice((q.page-1)*q.pageSize,q.page*q.pageSize),total:items.length,page:q.page,pageSize:q.pageSize};}
const matching=(term: string,...values:string[])=>values.some((value)=>value.toLocaleLowerCase('ru').includes(term.toLocaleLowerCase('ru')));
export async function registerBusiness(app: FastifyInstance,pool: pg.Pool,config:AppConfig) {
  await app.register(async(api)=>{
    api.addHook('onRequest',async(request,reply)=>{
      reply.header('Cache-Control','no-store');
      if(!await authenticated(pool,request))throw new AppError(401,'UNAUTHORIZED','Войдите в систему.');
      if(!['GET','HEAD','OPTIONS'].includes(request.method))checkMutationOrigin(request,config);
    });
    api.get('/api/context',async()=>({...await s.context(pool),environment:config.NODE_ENV}));
    api.get('/api/clients',async(request)=>{
      const q=v.listQuery.parse(request.query),{today}=await s.context(pool);
      const items=(await s.allClients(pool,today)).filter((row)=>(q.archived==='true'||!row.archivedAt)&&matching(q.search,row.name,row.phone,row.email,row.contact)&&(q.debt!=='true'||row.debtMinor>0));
      return page(items,q);
    });
    api.post('/api/clients',async(request,reply)=>{
      const input=v.clientInput.strict().parse(request.body),id=randomUUID();
      await transaction(pool,async(tx)=>{
        await tx.query('INSERT INTO clients(id,name,phone,email,contact,notes) VALUES($1,$2,$3,$4,$5,$6)',[id,input.name,input.phone,input.email,input.contact,input.notes]);await s.audit(tx,'client',id,'created');
      });
      reply.code(201);return (await s.allClients(pool,(await s.context(pool)).today)).find((row)=>row.id===id);
    });
    api.patch('/api/clients/:id',async(request)=>{
      const {id}=params.parse(request.params),input=v.clientInput.extend({version:v.version}).strict().parse(request.body);
      await transaction(pool,async(tx)=>{
        const result=await tx.query('UPDATE clients SET name=$2,phone=$3,email=$4,contact=$5,notes=$6,version=version+1,updated_at=now() WHERE id=$1 AND version=$7',[id,input.name,input.phone,input.email,input.contact,input.notes,input.version]);
        if(!result.rowCount)throw conflict('Клиент изменён или не найден. Обновите данные.');await s.audit(tx,'client',id,'updated');
      });
      return (await s.allClients(pool,(await s.context(pool)).today)).find((row)=>row.id===id);
    });
    api.get('/api/clients/:id',async(request)=>{
      const {id}=params.parse(request.params),{today}=await s.context(pool),client=(await s.allClients(pool,today)).find((row)=>row.id===id);if(!client)throw missing();
      return {client,leases:await s.allLeases(pool,today,'l.client_id=$1',[id]),charges:await s.allCharges(pool,today,'l.client_id=$1 AND c.cancelled_at IS NULL',[id]),payments:await s.allPayments(pool,'l.client_id=$1',[id])};
    });
    for(const entity of ['clients','warehouses'] as const)api.post(`/api/${entity}/:id/archive`,async(request)=>{
      const {id}=params.parse(request.params),{version}=z.object({version:v.version}).strict().parse(request.body);
      await transaction(pool,async(tx)=>{
        const item=(await tx.query(`SELECT * FROM ${entity} WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!item)throw missing();
        if(item.version!==version)throw conflict('Запись изменена. Обновите данные.');
        const active=await tx.query(`SELECT 1 FROM leases WHERE ${entity==='clients'?'client_id':'warehouse_id'}=$1 AND released_on IS NULL LIMIT 1`,[id]);
        if(active.rowCount)throw conflict('Сначала завершите действующие и запланированные аренды.');
        await tx.query(`UPDATE ${entity} SET archived_at=now(),version=version+1,updated_at=now() WHERE id=$1`,[id]);await s.audit(tx,entity,id,'archived');
      });return {ok:true};
    });
    api.get('/api/warehouses',async(request)=>{
      const q=v.listQuery.parse(request.query),{today}=await s.context(pool);
      return page((await s.allWarehouses(pool,today)).filter((row)=>(q.archived==='true'||!row.archivedAt)&&matching(q.search,row.number,row.address,row.currentLease?.clientName??'')&&(q.occupancy==='all'||(q.occupancy==='occupied'?Boolean(row.currentLease):!row.currentLease))),q);
    });
    api.post('/api/warehouses',async(request,reply)=>{
      const input=v.warehouseInput.strict().parse(request.body),id=randomUUID();
      await transaction(pool,async(tx)=>{
        await tx.query('INSERT INTO warehouses(id,number,number_key,area,address,notes,availability) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,input.number,input.number.toLocaleLowerCase('ru'),input.area,input.address,input.notes,input.availability]);await s.audit(tx,'warehouse',id,'created');
      });reply.code(201);return (await s.allWarehouses(pool,(await s.context(pool)).today)).find((row)=>row.id===id);
    });
    api.patch('/api/warehouses/:id',async(request)=>{
      const {id}=params.parse(request.params),input=v.warehouseInput.extend({version:v.version}).strict().parse(request.body);
      await transaction(pool,async(tx)=>{
        const result=await tx.query('UPDATE warehouses SET number=$2,number_key=$3,area=$4,address=$5,notes=$6,availability=$7,version=version+1,updated_at=now() WHERE id=$1 AND version=$8',[id,input.number,input.number.toLocaleLowerCase('ru'),input.area,input.address,input.notes,input.availability,input.version]);
        if(!result.rowCount)throw conflict('Склад изменён или не найден. Обновите данные.');await s.audit(tx,'warehouse',id,'updated');
      });return (await s.allWarehouses(pool,(await s.context(pool)).today)).find((row)=>row.id===id);
    });
    api.get('/api/warehouses/:id',async(request)=>{
      const {id}=params.parse(request.params),{today}=await s.context(pool),warehouse=(await s.allWarehouses(pool,today)).find((row)=>row.id===id);if(!warehouse)throw missing();
      return {warehouse,leases:await s.allLeases(pool,today,'l.warehouse_id=$1',[id]),charges:await s.allCharges(pool,today,'l.warehouse_id=$1 AND c.cancelled_at IS NULL',[id]),payments:await s.allPayments(pool,'l.warehouse_id=$1',[id])};
    });
    api.get('/api/leases',async(request)=>{
      const q=v.listQuery.parse(request.query),{today}=await s.context(pool);
      return page((await s.allLeases(pool,today)).filter((row)=>matching(q.search,row.clientName,row.warehouseNumber)&&(q.status==='all'||row.status===q.status)&&(!q.clientId||row.clientId===q.clientId)&&(!q.warehouseId||row.warehouseId===q.warehouseId)),q);
    });
    api.post('/api/leases',async(request,reply)=>{
      const input=v.leaseInput.strict().parse(request.body),{today}=await s.context(pool);reply.code(201);return s.createLease(pool,input,today);
    });
    api.get('/api/leases/:id',async(request)=>{
      const {id}=params.parse(request.params),{today}=await s.context(pool),lease=(await s.allLeases(pool,today,'l.id=$1',[id]))[0];if(!lease)throw missing();
      return {lease,charges:await s.allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[id]),payments:await s.allPayments(pool,'p.lease_id=$1',[id])};
    });
    api.patch('/api/leases/:id',async(request)=>{
      const {id}=params.parse(request.params),input=z.object({notes:z.string().trim().max(4000),version:v.version}).strict().parse(request.body);
      await transaction(pool,async(tx)=>{if(!(await tx.query('UPDATE leases SET notes=$2,version=version+1,updated_at=now() WHERE id=$1 AND version=$3',[id,input.notes,input.version])).rowCount)throw conflict('Аренда изменена. Обновите данные.');await s.audit(tx,'lease',id,'updated');});return {ok:true};
    });
    api.post('/api/leases/:id/rates',async(request)=>{
      const {id}=params.parse(request.params),input=z.object({effectiveDate:v.day,monthlyRateMinor:v.money,version:v.version}).strict().parse(request.body);
      await s.changeRate(pool,id,input,(await s.context(pool)).today);return {ok:true};
    });
    api.post('/api/leases/:id/release',async(request)=>{
      const {id}=params.parse(request.params),input=z.object({version:v.version}).strict().parse(request.body);
      await s.releaseLease(pool,id,input.version,(await s.context(pool)).today);return {ok:true};
    });
    api.post('/api/leases/:id/extend-schedule',async(request)=>{
      const {id}=params.parse(request.params),{months}=z.object({months:z.number().int().min(1).max(120)}).strict().parse(request.body),{today}=await s.context(pool);
      await transaction(pool,async(tx)=>{
        const lease=(await tx.query('SELECT * FROM leases WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!lease)throw missing();
        const previous=(await tx.query('SELECT COALESCE(max(period_index),-1) AS last,count(*) AS count FROM charges WHERE lease_id=$1',[id])).rows[0];
        const base=Math.max(1,periodIndex(lease.start_date,today)+1),desired=Number(previous.last)+1+months;
        if(desired>1200)throw new AppError(400,'SCHEDULE_LIMIT','Достигнут предел горизонта начислений.');
        await s.ensureCharges(tx,today,Math.max(0,desired-base),id);
        const after=(await tx.query('SELECT count(*) AS count FROM charges WHERE lease_id=$1',[id])).rows[0];
        if(Number(after.count)<=Number(previous.count))throw conflict('График уже содержит все месяцы до завершения аренды.');
      });
      return s.allCharges(pool,today,'c.lease_id=$1 AND c.cancelled_at IS NULL',[id]);
    });
    const filteredCharges=async(query:unknown)=>{
      const q=v.listQuery.parse(query);v.validRange(q.from,q.to);const {today}=await s.context(pool);
      const items=(await s.allCharges(pool,today)).filter((c)=>(!q.from||c.dueDate>=q.from)&&(!q.to||c.dueDate<=q.to)&&(!q.clientId||c.clientId===q.clientId)&&(!q.warehouseId||c.warehouseId===q.warehouseId)&&(!q.leaseId||c.leaseId===q.leaseId)&&(q.status==='all'||(q.status==='open'?c.remainingMinor>0:q.status==='paid'?c.remainingMinor===0:c.status==='overdue')));
      return {items,q};
    };
    api.get('/api/charges',async(request)=>{const {items,q}=await filteredCharges(request.query);return page(items,q);});
    api.get('/api/schedule',async(request)=>{
      const {items,q}=await filteredCharges(request.query),{today}=await s.context(pool);
      const overdue=(await s.allCharges(pool,today)).filter((c)=>c.status==='overdue'&&(!q.clientId||c.clientId===q.clientId)&&(!q.warehouseId||c.warehouseId===q.warehouseId));
      return {items,overdue};
    });
    api.post('/api/payments/preview',async(request)=>{const input=v.paymentInput.extend({idempotencyKey:v.id.optional()}).strict().parse(request.body);return s.paymentPreview(pool,input,(await s.context(pool)).today);});
    api.post('/api/payments',async(request,reply)=>{
      const input=v.paymentInput.extend({idempotencyKey:v.id}).strict().parse(request.body),{today}=await s.context(pool);
      if(input.receivedOn>today)throw new AppError(400,'FUTURE_PAYMENT_DATE','Фактическая дата поступления не может быть в будущем.');
      reply.code(201);return s.savePayment(pool,input,today);
    });
    api.post('/api/payments/:id/reverse',async(request)=>{
      const {id}=params.parse(request.params),{reason}=z.object({reason:z.string().trim().min(3).max(1000)}).strict().parse(request.body);await s.reversePayment(pool,id,reason);return {ok:true};
    });
    api.get('/api/payments',async(request)=>{
      const q=v.paymentListQuery.parse(request.query);v.validRange(q.from,q.to);
      const items=(await s.allPayments(pool)).filter((p)=>(q.includeReversed==='true'||!p.reversedAt)&&(q.method==='all'||p.method===q.method)&&(!q.from||p.receivedOn>=q.from)&&(!q.to||p.receivedOn<=q.to)&&(!q.clientId||p.clientId===q.clientId)&&(!q.warehouseId||p.warehouseId===q.warehouseId)&&matching(q.search,p.clientName,p.warehouseNumber,p.notes));
      return {...page(items,q),totalMinor:items.filter((p)=>!p.reversedAt).reduce((sum,p)=>sum+p.amountMinor,0)};
    });
    const range=async(query:unknown)=>{const q=v.listQuery.parse(query),{today}=await s.context(pool);const from=q.from??`${today.slice(0,7)}-01`,to=q.to??today;v.validRange(from,to);return {from,to,today};};
    api.get('/api/dashboard',async(request)=>{
      const {from,to,today}=await range(request.query),charges=await s.allCharges(pool,today),payments=(await s.allPayments(pool,'p.reversed_at IS NULL')).filter((p)=>p.receivedOn>=from&&p.receivedOn<=to),warehouses=await s.allWarehouses(pool,today),leases=await s.allLeases(pool,today);
      const overdue=charges.filter((c)=>c.status==='overdue'),upcoming=charges.filter((c)=>c.remainingMinor>0&&c.dueDate>=today&&c.dueDate<=addDays(today,30));
      const months=new Map<string,number>();for(const p of payments)months.set(p.receivedOn.slice(0,7),(months.get(p.receivedOn.slice(0,7))??0)+p.amountMinor);
      return {from,to,today,totals:{receivedMinor:payments.reduce((sum,p)=>sum+p.amountMinor,0),overdueMinor:overdue.reduce((sum,c)=>sum+c.remainingMinor,0),upcomingMinor:upcoming.reduce((sum,c)=>sum+c.remainingMinor,0),occupiedWarehouses:warehouses.filter((w)=>w.currentLease).length,totalWarehouses:warehouses.filter((w)=>!w.archivedAt).length,activeLeases:leases.filter((l)=>l.status==='active').length},upcoming:upcoming.slice(0,12),overdue:overdue.slice(0,12),receiptsByMonth:[...months].sort(([a],[b])=>a.localeCompare(b)).map(([month,amountMinor])=>({month,amountMinor}))};
    });
    const receipts=async(query:unknown)=>{
      const {from,to}=await range(query),payments=(await s.allPayments(pool,'p.reversed_at IS NULL')).filter((p)=>p.receivedOn>=from&&p.receivedOn<=to);
      const group=(key:(p:typeof payments[number])=>string,label:(p:typeof payments[number])=>string)=>{
        const map=new Map<string,{id:string;label:string;amountMinor:number}>();for(const p of payments){const id=key(p),row=map.get(id)??{id,label:label(p),amountMinor:0};row.amountMinor+=p.amountMinor;map.set(id,row);}return [...map.values()];
      };
      return {from,to,totalMinor:payments.reduce((sum,p)=>sum+p.amountMinor,0),byMonth:group((p)=>p.receivedOn.slice(0,7),(p)=>p.receivedOn.slice(0,7)).sort((a,b)=>a.label.localeCompare(b.label)),byWarehouse:group((p)=>p.warehouseId,(p)=>p.warehouseNumber),byClient:group((p)=>p.clientId,(p)=>p.clientName),payments};
    };
    api.get('/api/reports/receipts',async(request)=>{const {payments,...report}=await receipts(request.query);return report;});
    api.get('/api/reports/receipts.csv',async(request,reply)=>{
      const report=await receipts(request.query);
      const cell=(value:unknown)=>`"${String(value).replace(/^[\t\r\n ]*([=+@-])/,'\'$1').replaceAll('"','""')}"`;
      const rows=[['Дата','Клиент','Склад','Сумма, руб.','Способ','Комментарий'],...report.payments.map((p)=>[p.receivedOn,p.clientName,p.warehouseNumber,(p.amountMinor/100).toFixed(2),p.method,p.notes])];
      reply.header('Content-Type','text/csv; charset=utf-8').header('Content-Disposition','attachment; filename="receipts.csv"');return '\uFEFF'+rows.map((row)=>row.map(cell).join(';')).join('\r\n');
    });
    api.post('/api/demo',async(request)=>{
      if(config.NODE_ENV!=='development')throw missing();
      z.object({confirm:z.literal(true)}).strict().parse(request.body);await seedDemo(pool);return {ok:true};
    });
    await registerNotificationRoutes(api,pool,config);
  });
}

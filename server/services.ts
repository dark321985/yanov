import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import { type Queryable, transaction } from './db.js';
import { AppError, conflict, missing } from './errors.js';
import { addDays, boundary, isBoundary, periodIndex, todayIn } from './dates.js';
import type { AllocationDto, ChargeDto, ClientDto, LeaseDto, PaymentDto, PaymentInput, PaymentPreview, SettingsDto, WarehouseDto } from '../shared/contracts.js';

export function number(value: unknown): number {
  const n=Number(value); if(!Number.isSafeInteger(n))throw new Error('UNSAFE_MONETARY_TOTAL'); return n;
}
const stamp=(value: unknown)=>value?new Date(value as string).toISOString():null;
export async function settings(db: Queryable): Promise<SettingsDto> {
  const row=(await db.query('SELECT * FROM app_settings WHERE singleton')).rows[0];
  if(!row)throw new AppError(503,'SCHEMA_NOT_READY','Примените миграции базы данных.');
  return {businessName:row.business_name,timezone:row.timezone,reminderDays:row.reminder_days,reminderTime:row.reminder_time,telegramEnabled:row.telegram_enabled,telegramChatId:row.telegram_chat_id,version:row.version};
}
export async function context(db: Queryable) {
  const config=await settings(db); return {today:todayIn(config.timezone),timezone:config.timezone,businessName:config.businessName};
}
export async function audit(db: Queryable,type: string,id: string|null,action: string,detail: Record<string,unknown>={}) {
  await db.query('INSERT INTO audit_events(id,entity_type,entity_id,action,detail) VALUES($1,$2,$3,$4,$5)',[randomUUID(),type,id,action,JSON.stringify(detail)]);
}
export async function ensureCharges(db: Queryable,today: string,ahead=12,leaseId?: string) {
  const leases=(await db.query(`SELECT * FROM leases ${leaseId?'WHERE id=$1':''} ORDER BY id FOR UPDATE`,leaseId?[leaseId]:[])).rows;
  for(const lease of leases) {
    if(lease.released_on)continue;
    const rates=(await db.query('SELECT * FROM lease_rate_versions WHERE lease_id=$1 ORDER BY effective_date',[lease.id])).rows;
    if(!rates.length)throw new Error('LEASE_RATE_MISSING');
    const count=Math.min(2400,Math.max(1,periodIndex(lease.start_date,today)+1)+ahead);
    for(let index=0;index<count;index++) {
      const start=boundary(lease.start_date,index),end=boundary(lease.start_date,index+1);
      if(lease.end_date&&start>=lease.end_date)break;
      const rate=rates.filter((r)=>r.effective_date<=start).at(-1);
      if(!rate)throw new Error('LEASE_RATE_MISSING');
      await db.query(`INSERT INTO charges(id,lease_id,period_index,period_start,period_end,due_date,amount_minor)
        VALUES($1,$2,$3,$4,$5,$4,$6) ON CONFLICT(lease_id,period_index) DO NOTHING`,[randomUUID(),lease.id,index,start,end,rate.monthly_amount_minor]);
    }
  }
}
const chargeSelect=`SELECT c.*,l.client_id,l.warehouse_id,cl.name AS client_name,w.number AS warehouse_number,
  COALESCE((SELECT sum(a.amount_minor) FROM payment_allocations a JOIN payments p ON p.id=a.payment_id WHERE a.charge_id=c.id AND p.reversed_at IS NULL),0) AS paid_minor
  FROM charges c JOIN leases l ON l.id=c.lease_id JOIN clients cl ON cl.id=l.client_id JOIN warehouses w ON w.id=l.warehouse_id`;
export function chargeDto(row: any,today: string): ChargeDto {
  const amount=number(row.amount_minor),paid=number(row.paid_minor); const remaining=amount-paid;
  return {id:row.id,leaseId:row.lease_id,clientId:row.client_id,warehouseId:row.warehouse_id,clientName:row.client_name,warehouseNumber:row.warehouse_number,
    periodStart:row.period_start,periodEnd:row.period_end,dueDate:row.due_date,amountMinor:amount,paidMinor:paid,remainingMinor:remaining,
    status:remaining===0?'paid':row.due_date<today?'overdue':row.due_date===today?'today':paid>0?'partial':'upcoming',cancelledAt:stamp(row.cancelled_at)};
}
export async function allCharges(db: Queryable,today: string,where='c.cancelled_at IS NULL',values: unknown[]=[]): Promise<ChargeDto[]> {
  return (await db.query(`${chargeSelect} WHERE ${where} ORDER BY c.due_date,c.id`,values)).rows.map((row)=>chargeDto(row,today));
}
export async function allLeases(db: Queryable,today: string,where='true',values: unknown[]=[]): Promise<LeaseDto[]> {
  const rows=(await db.query(`SELECT l.*,cl.name AS client_name,w.number AS warehouse_number FROM leases l
    JOIN clients cl ON cl.id=l.client_id JOIN warehouses w ON w.id=l.warehouse_id WHERE ${where} ORDER BY l.created_at DESC`,values)).rows;
  if(!rows.length)return [];
  const ids=rows.map((row)=>row.id);
  const charges=await allCharges(db,today,'c.cancelled_at IS NULL AND c.lease_id=ANY($1::uuid[])',[ids]);
  const rates=(await db.query('SELECT * FROM lease_rate_versions WHERE lease_id=ANY($1::uuid[]) ORDER BY effective_date',[ids])).rows;
  return rows.map((row)=>{
    const own=charges.filter((charge)=>charge.leaseId===row.id), ownRates=rates.filter((rate)=>rate.lease_id===row.id);
    const rate=ownRates.filter((r)=>r.effective_date<=today).at(-1)??ownRates[0];
    let paidThrough: string|null=null;
    for(const charge of own) { if(charge.remainingMinor>0)break; paidThrough=charge.periodEnd; }
    return {id:row.id,clientId:row.client_id,warehouseId:row.warehouse_id,clientName:row.client_name,warehouseNumber:row.warehouse_number,
      startDate:row.start_date,endDate:row.end_date,releasedOn:row.released_on,notes:row.notes,version:row.version,
      status:row.released_on?'ended':row.start_date>today?'scheduled':'active',monthlyRateMinor:number(rate.monthly_amount_minor),
      debtMinor:own.filter((c)=>c.dueDate<today).reduce((sum,c)=>sum+c.remainingMinor,0),paidThrough,
      nextDueDate:own.find((c)=>c.remainingMinor>0)?.dueDate??null,
      rates:ownRates.map((r)=>({id:r.id,effectiveDate:r.effective_date,monthlyRateMinor:number(r.monthly_amount_minor)}))} satisfies LeaseDto;
  });
}
export async function allClients(db: Queryable,today: string): Promise<ClientDto[]> {
  const rows=(await db.query('SELECT * FROM clients ORDER BY name,id')).rows,leases=await allLeases(db,today);
  return rows.map((row)=>{
    const own=leases.filter((lease)=>lease.clientId===row.id),active=own.filter((lease)=>lease.status==='active');
    return {id:row.id,name:row.name,phone:row.phone,email:row.email,contact:row.contact,notes:row.notes,archivedAt:stamp(row.archived_at),version:row.version,
      activeLeases:active.length,monthlyRateMinor:active.reduce((s,l)=>s+l.monthlyRateMinor,0),debtMinor:own.reduce((s,l)=>s+l.debtMinor,0),
      nextDueDate:own.map((l)=>l.nextDueDate).filter((date):date is string=>Boolean(date)).sort()[0]??null};
  });
}
export async function allWarehouses(db: Queryable,today: string): Promise<WarehouseDto[]> {
  const rows=(await db.query('SELECT * FROM warehouses ORDER BY number_key,id')).rows,leases=await allLeases(db,today);
  return rows.map((row)=>({id:row.id,number:row.number,area:row.area===null?null:Number(row.area),address:row.address,notes:row.notes,
    availability:row.availability,archivedAt:stamp(row.archived_at),version:row.version,
    currentLease:leases.find((l)=>l.warehouseId===row.id&&l.status==='active')??null,
    nextLease:leases.filter((l)=>l.warehouseId===row.id&&l.status==='scheduled').sort((a,b)=>a.startDate.localeCompare(b.startDate))[0]??null}));
}
export async function allPayments(db: Queryable,where='true',values: unknown[]=[]): Promise<PaymentDto[]> {
  const rows=(await db.query(`SELECT p.*,l.client_id,l.warehouse_id,cl.name AS client_name,w.number AS warehouse_number FROM payments p
    JOIN leases l ON l.id=p.lease_id JOIN clients cl ON cl.id=l.client_id JOIN warehouses w ON w.id=l.warehouse_id WHERE ${where} ORDER BY p.received_on DESC,p.created_at DESC`,values)).rows;
  if(!rows.length)return [];
  const allocations=(await db.query(`SELECT a.*,c.period_start,c.period_end FROM payment_allocations a JOIN charges c ON c.id=a.charge_id
    WHERE a.payment_id=ANY($1::uuid[]) ORDER BY c.period_start`,[rows.map((p)=>p.id)])).rows;
  return rows.map((row)=>({id:row.id,leaseId:row.lease_id,clientId:row.client_id,warehouseId:row.warehouse_id,clientName:row.client_name,warehouseNumber:row.warehouse_number,
    receivedOn:row.received_on,amountMinor:number(row.amount_minor),method:row.method,notes:row.notes,reversedAt:stamp(row.reversed_at),reversalReason:row.reversal_reason,
    allocations:allocations.filter((a)=>a.payment_id===row.id).map((a)=>({chargeId:a.charge_id,periodStart:a.period_start,periodEnd:a.period_end,amountMinor:number(a.amount_minor)}))}));
}
export async function paymentPreview(db: Queryable,input: PaymentInput,today: string): Promise<PaymentPreview> {
  const charges=await allCharges(db,today,'c.cancelled_at IS NULL AND c.lease_id=$1',[input.leaseId]);
  const selected=charges.filter((charge)=>input.chargeIds.includes(charge.id));
  if(selected.length!==input.chargeIds.length)throw conflict('Выбранные начисления недоступны для этой аренды.');
  const outstanding=selected.reduce((s,c)=>s+c.remainingMinor,0);
  if(input.amountMinor>outstanding)throw new AppError(400,'AMOUNT_EXCEEDS_PERIODS','Сумма больше остатка выбранных месяцев. Выберите дополнительные месяцы.');
  if(selected.some((c)=>c.remainingMinor===0))throw conflict('Один из выбранных месяцев уже полностью оплачен. Обновите начисления.');
  const earliest=selected[0]?.periodStart;
  const allocations: AllocationDto[]=[];let left=input.amountMinor;
  for(const charge of selected) { const amount=Math.min(left,charge.remainingMinor);if(amount>0)allocations.push({chargeId:charge.id,periodStart:charge.periodStart,periodEnd:charge.periodEnd,amountMinor:amount});left-=amount; }
  return {amountMinor:input.amountMinor,selectedRemainingMinor:outstanding,remainingAfterMinor:outstanding-input.amountMinor,allocations,
    olderDebtMinor:charges.filter((c)=>earliest&&c.periodStart<earliest&&c.dueDate<=today&&!input.chargeIds.includes(c.id)).reduce((s,c)=>s+c.remainingMinor,0)};
}
export async function savePayment(pool: pg.Pool,input: PaymentInput&{idempotencyKey:string},today: string) {
  const requestHash=createHash('sha256').update(JSON.stringify({...input,chargeIds:[...input.chargeIds].sort(),idempotencyKey:undefined})).digest('hex');
  const paymentId=await transaction(pool,async(tx)=>{
    // Same request key serializes even when conflicting attempts name different leases.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[input.idempotencyKey]);
    const previous=(await tx.query('SELECT id,request_hash FROM payments WHERE idempotency_key=$1',[input.idempotencyKey])).rows[0];
    if(previous) {if(previous.request_hash!==requestHash)throw conflict('Этот ключ сохранения уже использован для другой оплаты.');return previous.id;}
    if(!(await tx.query('SELECT id FROM leases WHERE id=$1 FOR UPDATE',[input.leaseId])).rowCount)throw missing();
    await tx.query('SELECT id FROM charges WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[input.chargeIds]);
    const preview=await paymentPreview(tx,input,today),id=randomUUID();
    await tx.query(`INSERT INTO payments(id,lease_id,received_on,amount_minor,method,notes,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id,input.leaseId,input.receivedOn,input.amountMinor,input.method,input.notes,input.idempotencyKey,requestHash]);
    for(const allocation of preview.allocations)await tx.query('INSERT INTO payment_allocations(id,lease_id,payment_id,charge_id,amount_minor) VALUES($1,$2,$3,$4,$5)',[randomUUID(),input.leaseId,id,allocation.chargeId,allocation.amountMinor]);
    await audit(tx,'payment',id,'created',{amountMinor:input.amountMinor});return id;
  });
  return (await allPayments(pool,'p.id=$1',[paymentId]))[0]!;
}
export async function reversePayment(pool: pg.Pool,id: string,reason: string) {
  await transaction(pool,async(tx)=>{
    const row=(await tx.query('SELECT lease_id FROM payments WHERE id=$1',[id])).rows[0];if(!row)throw missing();
    await tx.query('SELECT id FROM leases WHERE id=$1 FOR UPDATE',[row.lease_id]);
    const payment=(await tx.query('SELECT reversed_at FROM payments WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(payment.reversed_at)throw conflict('Оплата уже сторнирована.');
    await tx.query('INSERT INTO payment_reversals(payment_id,reason) VALUES($1,$2)',[id,reason]);
    await tx.query('UPDATE payments SET reversed_at=now(),reversal_reason=$2 WHERE id=$1',[id,reason]);
    await audit(tx,'payment',id,'reversed',{reason});
  });
}
export async function createLease(pool: pg.Pool,input: {clientId:string;warehouseId:string;startDate:string;monthlyRateMinor:number;notes:string},today: string) {
  const leaseId=await transaction(pool,async(tx)=>{
    const client=(await tx.query('SELECT archived_at FROM clients WHERE id=$1 FOR UPDATE',[input.clientId])).rows[0];
    const warehouse=(await tx.query('SELECT archived_at,availability FROM warehouses WHERE id=$1 FOR UPDATE',[input.warehouseId])).rows[0];
    if(!client||!warehouse)throw missing();
    if(client.archived_at||warehouse.archived_at||warehouse.availability!=='available')throw conflict('Клиент или склад недоступны для новой аренды.');
    const id=randomUUID();
    await tx.query('INSERT INTO leases(id,client_id,warehouse_id,start_date,notes) VALUES($1,$2,$3,$4,$5)',[id,input.clientId,input.warehouseId,input.startDate,input.notes]);
    await tx.query('INSERT INTO lease_rate_versions(id,lease_id,effective_date,monthly_amount_minor) VALUES($1,$2,$3,$4)',[randomUUID(),id,input.startDate,input.monthlyRateMinor]);
    await ensureCharges(tx,today,12,id);await audit(tx,'lease',id,'created');return id;
  });
  return (await allLeases(pool,today,'l.id=$1',[leaseId]))[0]!;
}
export async function changeRate(pool: pg.Pool,id: string,input:{effectiveDate:string;monthlyRateMinor:number;version:number},today: string) {
  await transaction(pool,async(tx)=>{
    const row=(await tx.query('SELECT * FROM leases WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw missing();
    if(row.version!==input.version)throw conflict('Аренда изменена в другой вкладке. Обновите данные.');
    if(row.released_on||input.effectiveDate<=today||!isBoundary(row.start_date,input.effectiveDate)||(row.end_date&&input.effectiveDate>=row.end_date))
      throw conflict('Новая ставка применяется с границы будущего расчётного месяца действующей аренды.');
    const paid=(await tx.query(`SELECT 1 FROM payment_allocations a JOIN payments p ON p.id=a.payment_id JOIN charges c ON c.id=a.charge_id
      WHERE c.lease_id=$1 AND c.period_start>=$2 AND p.reversed_at IS NULL LIMIT 1`,[id,input.effectiveDate])).rowCount;
    if(paid)throw conflict('В будущих периодах уже есть оплаты. Сначала явно исправьте их.');
    await tx.query('INSERT INTO lease_rate_versions(id,lease_id,effective_date,monthly_amount_minor) VALUES($1,$2,$3,$4)',[randomUUID(),id,input.effectiveDate,input.monthlyRateMinor]);
    await tx.query(`UPDATE charges c SET amount_minor=(SELECT r.monthly_amount_minor FROM lease_rate_versions r WHERE r.lease_id=c.lease_id AND r.effective_date<=c.period_start ORDER BY r.effective_date DESC LIMIT 1)
      WHERE c.lease_id=$1 AND c.period_start>=$2 AND c.cancelled_at IS NULL`,[id,input.effectiveDate]);
    await tx.query('UPDATE leases SET version=version+1,updated_at=now() WHERE id=$1',[id]);
    await audit(tx,'lease',id,'rate_changed',{effectiveDate:input.effectiveDate,monthlyRateMinor:input.monthlyRateMinor});
  });
}
export async function releaseLease(pool: pg.Pool,id: string,version: number,today: string) {
  await transaction(pool,async(tx)=>{
    const row=(await tx.query('SELECT * FROM leases WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!row)throw missing();
    if(row.version!==version)throw conflict('Аренда изменена. Обновите данные.');
    if(row.released_on)throw conflict('Склад по этой аренде уже освобождён.');
    // Accrue the current period before stopping the schedule, even after worker downtime.
    await ensureCharges(tx,today,0,id);
    const end=today<row.start_date?row.start_date:today;
    await tx.query('UPDATE leases SET end_date=$2,released_on=$3,version=version+1,updated_at=now() WHERE id=$1',[id,end,today]);
    // Preserve full current-month amount and every actual payment/allocation.
    await tx.query("UPDATE charges SET cancelled_at=now(),cancel_reason='warehouse_released' WHERE lease_id=$1 AND (period_start>$2 OR $3::date>$2::date) AND cancelled_at IS NULL",[id,today,row.start_date]);
    await tx.query("UPDATE notification_jobs SET status='cancelled',result_code='LEASE_RELEASED',locked_until=NULL WHERE lease_id=$1 AND status IN ('pending','sending')",[id]);
    await audit(tx,'lease',id,'released',{releasedOn:today,withoutRecalculation:true});
  });
}

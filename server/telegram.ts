import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
import type { SettingsDto } from '../shared/contracts.js';
import { transaction } from './db.js';
import { AppError, conflict } from './errors.js';
import { settingsInput, listQuery } from './validation.js';
import { addDays, timeIn, todayIn } from './dates.js';
import { allCharges, audit, ensureCharges, settings } from './services.js';

export interface DeliveryResult { state:'sent'|'retry'|'failed'|'uncertain'; code:string; messageId?:string; retryAfter?:number }
export type TelegramProvider=(token:string,chat:string,text:string)=>Promise<DeliveryResult>;
export const sendTelegram:TelegramProvider=async(token,chat,text)=>{
  if(!token||!chat)return {state:'failed',code:'TELEGRAM_NOT_CONFIGURED'};
  try {
    const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chat,text,disable_web_page_preview:true}),signal:AbortSignal.timeout(15_000),
    });
    // Only whitelisted numeric/status fields are read. Never propagate provider descriptions or URL-bearing errors.
    const payload=await response.json() as {ok?:boolean;result?:{message_id?:number};parameters?:{retry_after?:number}};
    if(response.ok&&payload.ok&&typeof payload.result?.message_id==='number')return {state:'sent',code:'SENT',messageId:String(payload.result.message_id)};
    if(response.status===429)return {state:'retry',code:'TELEGRAM_RATE_LIMIT',retryAfter:Math.min(86400,Math.max(1,Number(payload.parameters?.retry_after)||60))};
    if(response.status>=500)return {state:'retry',code:'TELEGRAM_UNAVAILABLE',retryAfter:300};
    return {state:'failed',code:response.status===401?'TELEGRAM_TOKEN_INVALID':response.status===403?'TELEGRAM_FORBIDDEN':'TELEGRAM_REQUEST_REJECTED'};
  } catch { return {state:'uncertain',code:'DELIVERY_UNCERTAIN'}; }
};
function message(charge:Awaited<ReturnType<typeof allCharges>>[number],config:AppConfig) {
  const format=(minor:number)=>new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB'}).format(minor/100);
  return `Аренда склада №${charge.warehouseNumber}\nКлиент: ${charge.clientName}\nПериод: ${charge.periodStart} — ${addDays(charge.periodEnd,-1)}\nОплатить: ${charge.dueDate}\nНачислено: ${format(charge.amountMinor)}\nОсталось: ${format(charge.remainingMinor)}\n${new URL(`/leases/${charge.leaseId}`,config.APP_URL)}`;
}
export async function runScheduler(pool:pg.Pool,config:AppConfig,provider:TelegramProvider=sendTelegram,now=new Date()) {
  const connection=await pool.connect();
  let locked=false;
  try {
    locked=(await connection.query('SELECT pg_try_advisory_lock(72904112) AS locked')).rows[0].locked;
    if(!locked)return;
    const options=await settings(connection),today=todayIn(options.timezone,now);
    await transaction(pool,async(tx)=>{await ensureCharges(tx,today);});
    await connection.query('UPDATE app_settings SET scheduler_last_run_at=$1',[now]);
    // A crash after a provider accepted the message is indeterminate, not a reason to blindly resend.
    await connection.query("UPDATE notification_jobs SET status='uncertain',result_code='WORKER_INTERRUPTED' WHERE status='sending' AND locked_until<$1",[now]);
    if(!options.telegramEnabled||!config.TELEGRAM_BOT_TOKEN||!options.telegramChatId)return;
    if(timeIn(options.timezone,now)<options.reminderTime)return;
    const charges=await allCharges(connection,today,'c.cancelled_at IS NULL AND l.released_on IS NULL');
    const candidates=charges.filter((c)=>c.remainingMinor>0&&addDays(c.dueDate,-options.reminderDays)<=today&&addDays(c.dueDate,-options.reminderDays)>=addDays(today,-7));
    for(const charge of candidates) {
      await connection.query(`INSERT INTO notification_jobs(id,lease_id,charge_id,scheduled_on,rule_days,next_attempt_at)
        SELECT $1,$2,$3,$4,$5,$6 WHERE NOT EXISTS(SELECT 1 FROM notification_jobs WHERE charge_id=$3 AND status IN ('sent','uncertain','sending'))
        ON CONFLICT(charge_id,scheduled_on,rule_days) DO UPDATE SET status='pending',next_attempt_at=$6,result_code=NULL
        WHERE notification_jobs.status='cancelled'`,[randomUUID(),charge.leaseId,charge.id,addDays(charge.dueDate,-options.reminderDays),options.reminderDays,now]);
    }
    const jobs=(await connection.query(`SELECT * FROM notification_jobs WHERE status='pending' AND next_attempt_at<=$1 ORDER BY scheduled_on,id LIMIT 30`,[now])).rows;
    for(const job of jobs) {
      // Commit the claim first. A crash must not turn a potentially delivered message
      // back into pending and cause an automatic duplicate.
      const claimed=await connection.query("UPDATE notification_jobs SET status='sending',attempts=attempts+1,locked_until=now()+interval '2 minutes' WHERE id=$1 AND status='pending' RETURNING id",[job.id]);
      if(!claimed.rowCount)continue;
      // Serialize with manual payments/settings changes until the provider call completes.
      // The transaction is bounded by the 15s provider timeout; runtime statement timeout is set separately.
      await transaction(pool,async(tx)=>{
        await tx.query('SELECT id FROM leases WHERE id=$1 FOR UPDATE',[job.lease_id]);
        await tx.query('SELECT singleton FROM app_settings WHERE singleton FOR SHARE');
        const current=await settings(tx);
        const charge=(await allCharges(tx,today,'c.id=$1 AND c.cancelled_at IS NULL AND l.released_on IS NULL',[job.charge_id]))[0];
        if(!current.telegramEnabled||current.reminderDays!==job.rule_days||!charge||charge.remainingMinor===0
          ||job.scheduled_on<addDays(today,-7)) {
          await tx.query("UPDATE notification_jobs SET status='cancelled',result_code='NO_LONGER_REQUIRED' WHERE id=$1",[job.id]);return;
        }
        const result=await provider(config.TELEGRAM_BOT_TOKEN!,current.telegramChatId,message(charge,config));
        const retry=result.state==='retry'&&job.attempts<4;
        const status=retry?'pending':result.state==='retry'?'failed':result.state;
        await tx.query(`UPDATE notification_jobs SET status=$2,result_code=$3,message_id=$4,
          sent_at=CASE WHEN $2='sent' THEN $5::timestamptz ELSE sent_at END,
          next_attempt_at=$5::timestamptz+($6::integer*interval '1 second'),locked_until=NULL WHERE id=$1`,
          [job.id,status,result.code,result.messageId??null,now,result.retryAfter??300]);
        await tx.query('INSERT INTO notification_events(id,job_id,result_code) VALUES($1,$2,$3)',[randomUUID(),job.id,result.code]);
      });
    }
  } finally {
    if(locked)await connection.query('SELECT pg_advisory_unlock(72904112)').catch(()=>{});
    connection.release();
  }
}
export function startScheduler(pool:pg.Pool,config:AppConfig) {
  if(config.RUN_SCHEDULER==='false')return async()=>{};
  let running:Promise<void>|null=null;
  const tick=()=>{
    if(running)return;
    running=runScheduler(pool,config).catch(()=>{process.stderr.write('[scheduler] CYCLE_FAILED\n');}).finally(()=>{running=null;});
  };
  tick();const timer=setInterval(tick,60_000);timer.unref();
  return async()=>{clearInterval(timer);await running;};
}
export async function registerNotificationRoutes(app:FastifyInstance,pool:pg.Pool,config:AppConfig) {
  app.get('/api/settings',async()=>{
    const row=(await pool.query('SELECT scheduler_last_run_at FROM app_settings')).rows[0];
    const sent=(await pool.query("SELECT max(sent_at) AS last FROM notification_jobs WHERE status='sent'")).rows[0];
    return {settings:await settings(pool),telegram:{configured:Boolean(config.TELEGRAM_BOT_TOKEN),lastRunAt:row?.scheduler_last_run_at?.toISOString()??null,lastSuccessAt:sent.last?.toISOString()??null}};
  });
  app.patch('/api/settings',async(request)=>{
    const input=settingsInput.strict().parse(request.body);
    if(input.telegramEnabled&&(!config.TELEGRAM_BOT_TOKEN||!input.telegramChatId))throw new AppError(400,'TELEGRAM_NOT_CONFIGURED','Сначала настройте токен бота на сервере и укажите получателя.');
    await transaction(pool,async(tx)=>{
      const before=await settings(tx);
      const result=await tx.query(`UPDATE app_settings SET business_name=$1,timezone=$2,reminder_days=$3,reminder_time=$4,telegram_enabled=$5,telegram_chat_id=$6,version=version+1 WHERE version=$7`,[input.businessName,input.timezone,input.reminderDays,input.reminderTime,input.telegramEnabled,input.telegramChatId,input.version]);
      if(!result.rowCount)throw conflict('Настройки изменены в другой вкладке. Обновите страницу.');
      if(before.reminderDays!==input.reminderDays||before.timezone!==input.timezone||before.reminderTime!==input.reminderTime||!input.telegramEnabled||before.telegramChatId!==input.telegramChatId)
        await tx.query("UPDATE notification_jobs SET status='cancelled',result_code='SETTINGS_CHANGED' WHERE status='pending'");
      await sSafeAudit(tx,input);
    });return {ok:true};
  });
  app.get('/api/notifications',async(request)=>{
    const q=listQuery.parse(request.query);
    const total=Number((await pool.query('SELECT count(*) FROM notification_jobs')).rows[0].count);
    const rows=(await pool.query(`SELECT n.*,cl.name,w.number,c.due_date FROM notification_jobs n JOIN leases l ON l.id=n.lease_id
      JOIN clients cl ON cl.id=l.client_id JOIN warehouses w ON w.id=l.warehouse_id JOIN charges c ON c.id=n.charge_id
      ORDER BY n.created_at DESC LIMIT $1 OFFSET $2`,[q.pageSize,(q.page-1)*q.pageSize])).rows;
    return {items:rows.map((r)=>({id:r.id,clientName:r.name,warehouseNumber:r.number,dueDate:r.due_date,scheduledOn:r.scheduled_on,status:r.status,attempts:r.attempts,sentAt:r.sent_at?.toISOString()??null,resultCode:r.result_code})),total,page:q.page,pageSize:q.pageSize};
  });
  app.post('/api/telegram/test',async()=>{
    const options=await settings(pool);
    if(!config.TELEGRAM_BOT_TOKEN||!options.telegramChatId)throw new AppError(400,'TELEGRAM_NOT_CONFIGURED','Токен бота или получатель не настроены.');
    const result=await sendTelegram(config.TELEGRAM_BOT_TOKEN,options.telegramChatId,'Складно: тестовое уведомление. Подключение работает.');
    if(result.state!=='sent')throw new AppError(502,result.code,result.state==='uncertain'?'Результат отправки неизвестен. Проверьте Telegram перед повтором.':'Не удалось отправить сообщение. Проверьте настройки Telegram.');
    await audit(pool,'telegram',null,'test_sent');return {ok:true};
  });
}
async function sSafeAudit(tx:pg.PoolClient,input:SettingsDto) {
  await audit(tx,'settings',null,'updated',{reminderDays:input.reminderDays,reminderTime:input.reminderTime,telegramEnabled:input.telegramEnabled});
}

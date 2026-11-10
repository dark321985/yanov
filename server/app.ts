import Fastify from 'fastify';
import { existsSync,createReadStream } from 'node:fs';
import { readFile,readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AppConfig } from './config.js';
import { createDatabase, type Database } from './database.js';
import type { ApiError, SystemStatus } from '../shared/contracts.js';
import type pg from 'pg';
import { ZodError } from 'zod';
import { createPool } from './db.js';
import { registerAuth } from './auth.js';
import { registerBusiness } from './routes.js';
import { AppError } from './errors.js';

export interface AppOptions {
  config: AppConfig;
  database?: Database;
  staticRoot?: string;
  pool?: pg.Pool;
}

export async function buildApp(options: AppOptions) {
  const { config } = options;
  const pool=options.pool??(options.database?undefined:createPool(config));
  const database = options.database ?? (pool?{
    async status(){try{await pool.query('SELECT 1 FROM schema_migrations LIMIT 1');return 'connected' as const;}catch{return 'unavailable' as const;}},
    async close(){await pool.end();},
  }:createDatabase(config));
  // Do not log raw request URLs, bodies, headers or provider exceptions.
  const app = Fastify({ logger: false, bodyLimit: 64 * 1024,
    trustProxy: config.TRUST_PROXY_HOPS===1?(_address:string,hop:number)=>hop===0:false });

  app.addHook('onClose', async () => database.close());
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    if(config.NODE_ENV==='production')reply.header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  });

  app.setErrorHandler((error, request, reply) => {
    if(error instanceof ZodError) {
      const fields:Record<string,string>={};
      const messages:Record<string,string>={name:'Укажите имя или название, до 200 символов.',email:'Укажите корректный email или оставьте поле пустым.',number:'Укажите номер склада, до 80 символов.',area:'Укажите положительную площадь не более 1 000 000 м².',monthlyRateMinor:'Укажите положительную ставку с точностью до копеек.',amountMinor:'Укажите положительную сумму с точностью до копеек.',startDate:'Укажите корректную дату начала.',endDate:'Укажите корректную дату освобождения.',receivedOn:'Укажите корректную дату поступления.',chargeIds:'Выберите от 1 до 120 разных расчётных месяцев.',reminderDays:'Укажите целое число дней от 0 до 90.',reminderTime:'Укажите время от 00:00 до 23:59.',telegramChatId:'Укажите числовой ID получателя или оставьте поле пустым.',timezone:'Выберите существующий часовой пояс.',newPassword:'Пароль должен содержать от 12 до 128 символов.'};
      for(const issue of error.issues){const key=issue.path.join('.')||'form';fields[key]=messages[String(issue.path[0])]??'Проверьте значение поля.';}
      return reply.code(400).send({code:'VALIDATION_ERROR',message:'Проверьте заполнение формы.',requestId:request.id,fields} satisfies ApiError);
    }
    if(error instanceof AppError)return reply.code(error.statusCode).send({code:error.code,message:error.message,requestId:request.id,...(error.fields?{fields:error.fields}:{})} satisfies ApiError);
    const pgCode=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
    if(['23505','23P01','23514','23503'].includes(pgCode)) {
      const constraint=typeof error==='object'&&error!==null&&'constraint' in error?String(error.constraint):'';
      const fields=constraint==='warehouses_number_key_key'?{number:'Этот номер склада уже используется.'}:undefined;
      return reply.code(409).send({code:'CONFLICT',message:pgCode==='23P01'?'Этот склад уже арендован в выбранные даты.':fields?'Этот номер склада уже используется.':pgCode==='23505'?'Такая запись уже существует. Обновите данные.':'Изменение нарушает связи или ограничения данных.',requestId:request.id,...(fields?{fields}:{})});
    }
    const status = typeof error === 'object' && error !== null && 'statusCode' in error
      && typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 500
      ? error.statusCode : 500;
    const body: ApiError = {
      code: status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      message: status < 500 ? 'Проверьте параметры запроса.' : 'Не удалось выполнить запрос. Повторите позже.',
      requestId: request.id,
    };
    if (status >= 500) process.stderr.write(`[api] INTERNAL_ERROR request=${request.id}\n`);
    reply.code(status).send(body);
  });

  if(pool) {
    await registerAuth(app,pool,config);
    await registerBusiness(app,pool,config);
  }

  app.get('/health/live', async () => ({ status: 'ok' }));
  app.get('/health/ready', async (_request, reply) => {
    const status = await database.status();
    reply.header('Cache-Control', 'no-store');
    if (status !== 'connected') {
      return reply.code(503).send({ status: 'not-ready', code: 'DATABASE_NOT_READY' });
    }
    return { status: 'ok' };
  });

  // Stage-1 diagnostics are local-development only. No business data exists yet.
  if (config.NODE_ENV !== 'production') {
    app.get('/api/system/status', async (_request, reply): Promise<SystemStatus> => {
      reply.header('Cache-Control', 'no-store');
      return {
        environment: config.NODE_ENV,
        database: await database.status(),
        timezone: config.APP_TIMEZONE,
        stage: 1,
      };
    });
  }

  const staticRoot = options.staticRoot ?? resolve('dist/client');
  let indexHtml:string|undefined;
  if (config.NODE_ENV === 'production') {
    if (!existsSync(resolve(staticRoot, 'index.html'))) {
      await database.close();
      throw new Error('FRONTEND_BUILD_MISSING');
    }
    indexHtml=await readFile(resolve(staticRoot,'index.html'),'utf8');
    const assetRoot=resolve(staticRoot,'assets');
    const assets=existsSync(assetRoot)?new Set((await readdir(assetRoot,{withFileTypes:true})).filter((entry)=>entry.isFile()).map((entry)=>entry.name)):new Set<string>();
    const types:Record<string,string>={js:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',svg:'image/svg+xml',woff2:'font/woff2',png:'image/png',webp:'image/webp',jpg:'image/jpeg'};
    app.get<{Params:{file:string}}>('/assets/:file',async(request,reply)=>{
      const file=request.params.file,extension=file.split('.').at(-1)??'';
      // A startup allowlist of built files prevents URL normalization/traversal bugs.
      // This server exposes only Vite's flat assets folder, never arbitrary filesystem paths.
      if(!assets.has(file)||!types[extension])throw new AppError(404,'NOT_FOUND','Ресурс не найден.');
      return reply.type(types[extension]).header('Cache-Control','public, max-age=31536000, immutable').send(createReadStream(resolve(assetRoot,file)));
    });
  }

  app.setNotFoundHandler((request, reply) => {
    if (config.NODE_ENV === 'production' && request.method === 'GET'
      && request.headers.accept?.includes('text/html')
      && !/^\/(api|health|assets)(\/|$)/.test(request.url.split('?')[0] ?? '')) {
      reply.header('Cache-Control', 'no-cache');
      return reply.type('text/html; charset=utf-8').send(indexHtml);
    }
    return reply.code(404).send({
      code: 'NOT_FOUND', message: 'Запрошенный ресурс не найден.', requestId: request.id,
    } satisfies ApiError);
  });

  return app;
}

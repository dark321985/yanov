import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AppConfig } from './config.js';
import { AppError, conflict } from './errors.js';
import { transaction } from './db.js';

const COOKIE='skladno_session';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve,reject)=>
  scryptCallback(password,salt,64,{N:32768,r:8,p:1,maxmem:64*1024*1024},(error,key)=>error?reject(error):resolve(key)));
export async function hashPassword(password: string) {
  const salt=randomBytes(16).toString('hex'); const key=await derive(password,salt);
  return `scrypt1:${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string) {
  const [version,salt,key]=encoded.split(':');
  if(version!=='scrypt1'||!salt||!key) return false;
  const actual=await derive(password,salt); const expected=Buffer.from(key,'hex');
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export async function setupOwner(pool: pg.Pool,password: string,reset=false) {
  if(password.length<12||password.length>128) throw new AppError(400,'PASSWORD_LENGTH','Пароль должен содержать от 12 до 128 символов.');
  const encoded=await hashPassword(password);
  await transaction(pool,async(tx)=>{
    await tx.query('SELECT pg_advisory_xact_lock(72904111)');
    const found=await tx.query('SELECT id FROM owner_account');
    if(found.rowCount&&!reset) throw conflict('Владелец уже настроен.');
    if(found.rowCount) {
      await tx.query('UPDATE owner_account SET password_hash=$1,password_changed_at=now()',[encoded]);
      await tx.query('DELETE FROM owner_sessions');
    } else await tx.query('INSERT INTO owner_account(id,password_hash) VALUES($1,$2)',[randomUUID(),encoded]);
    await tx.query('DELETE FROM auth_throttle');
  });
}
function sessionToken(request: FastifyRequest) {
  const value=request.headers.cookie?.split(';').map((part)=>part.trim()).find((part)=>part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length+1);
  return value&&/^[A-Za-z0-9_-]{64}$/.test(value)?value:null;
}
export async function authenticated(pool: pg.Pool,request: FastifyRequest) {
  const token=sessionToken(request); if(!token)return false;
  const result=await pool.query('SELECT 1 FROM owner_sessions WHERE token_hash=$1 AND expires_at>now()',[hash(token)]);
  return Boolean(result.rowCount);
}
export function checkMutationOrigin(request: FastifyRequest,config: AppConfig) {
  if(request.headers['x-requested-with']!=='warehouse-admin'||request.headers.origin!==new URL(config.APP_URL).origin)
    throw new AppError(403,'ORIGIN_REJECTED','Обновите страницу и повторите действие из приложения.');
}
export async function registerAuth(app: FastifyInstance,pool: pg.Pool,config: AppConfig) {
  const passwordSchema=z.object({password:z.string().min(1).max(128)}).strict();
  const cookie=(token: string,maxAge: number)=>`${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${config.NODE_ENV==='production'?'; Secure':''}`;
  // A dummy hash avoids a noticeably different login path before owner initialization.
  const dummy=await hashPassword(randomBytes(24).toString('hex'));
  app.get('/api/auth/status',async(request,reply)=>{
    reply.header('Cache-Control','no-store');
    const exists=await pool.query('SELECT 1 FROM owner_account');
    return {authenticated:await authenticated(pool,request),needsSetup:!exists.rowCount};
  });
  app.post('/api/auth/login',async(request,reply)=>{
    checkMutationOrigin(request,config);
    const {password}=passwordSchema.parse(request.body);
    const key=hash(`login:${request.ip}`);
    const attempt=await pool.query(`INSERT INTO auth_throttle(key_hash,attempts) VALUES($1,1)
      ON CONFLICT(key_hash) DO UPDATE SET attempts=CASE WHEN auth_throttle.window_start<now()-interval '15 minutes' THEN 1 ELSE auth_throttle.attempts+1 END,
      window_start=CASE WHEN auth_throttle.window_start<now()-interval '15 minutes' THEN now() ELSE auth_throttle.window_start END RETURNING attempts`,[key]);
    if(attempt.rows[0].attempts>10)throw new AppError(429,'LOGIN_RATE_LIMIT','Слишком много попыток. Повторите через 15 минут.');
    const token=await transaction(pool,async(tx)=>{
      const owner=(await tx.query('SELECT id,password_hash FROM owner_account FOR SHARE')).rows[0];
      const valid=await verifyPassword(password,owner?.password_hash??dummy);
      if(!owner||!valid)throw new AppError(401,'INVALID_CREDENTIALS','Неверный пароль.');
      await tx.query('DELETE FROM auth_throttle WHERE key_hash=$1',[key]);
      await tx.query('DELETE FROM owner_sessions WHERE expires_at<now()');
      const token=randomBytes(48).toString('base64url');
      await tx.query("INSERT INTO owner_sessions(token_hash,owner_id,expires_at) VALUES($1,$2,now()+interval '7 days')",[hash(token),owner.id]);
      return token;
    });
    reply.header('Set-Cookie',cookie(token,7*86400)); return {ok:true};
  });
  app.post('/api/auth/logout',async(request,reply)=>{
    checkMutationOrigin(request,config);
    const token=sessionToken(request); if(token)await pool.query('DELETE FROM owner_sessions WHERE token_hash=$1',[hash(token)]);
    reply.header('Set-Cookie',cookie('',0)); return {ok:true};
  });
  app.post('/api/auth/change-password',async(request,reply)=>{
    checkMutationOrigin(request,config);
    if(!await authenticated(pool,request))throw new AppError(401,'UNAUTHORIZED','Войдите в систему.');
    const input=z.object({currentPassword:z.string().min(1).max(128),newPassword:z.string().min(12).max(128)}).strict().parse(request.body);
    // Password changes serialize with owner setup/reset and revoke every session atomically.
    await transaction(pool,async(tx)=>{
      const owner=(await tx.query('SELECT password_hash FROM owner_account FOR UPDATE')).rows[0];
      if(!owner||!await verifyPassword(input.currentPassword,owner.password_hash))
        throw new AppError(400,'CURRENT_PASSWORD_INVALID','Текущий пароль неверен.');
      await tx.query('UPDATE owner_account SET password_hash=$1,password_changed_at=now()',[await hashPassword(input.newPassword)]);
      await tx.query('DELETE FROM owner_sessions');
    });
    reply.header('Set-Cookie',cookie('',0)); return {ok:true};
  });
}

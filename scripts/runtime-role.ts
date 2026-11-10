import { randomBytes } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { parseConfig } from '../server/config.js';
import { createPool,requirePool,transaction } from '../server/db.js';

const envFile=new URL('../.env',import.meta.url);
let admin:ReturnType<typeof createPool>;
try {
  const content=await readFile(envFile,'utf8'),env=parse(content);
  if(env.NODE_ENV!=='development'||env.LOCAL_DATABASE_MANAGED!=='true')throw new Error('LOCAL_ONLY');
  const connection=new URL(env.MIGRATION_DATABASE_URL??env.DATABASE_URL??'');
  if(!['127.0.0.1','localhost'].includes(connection.hostname)||connection.pathname!=='/skladno_local')throw new Error('TARGET_GUARD');
  admin=requirePool(createPool(parseConfig({...env,DATABASE_URL:connection.href})));
  const identity=(await admin.query('SELECT current_database() AS db,current_user AS role')).rows[0];
  if(identity.db!==env.POSTGRES_DB||identity.role!==env.POSTGRES_USER)throw new Error('IDENTITY_GUARD');
  const role='yanov_runtime';
  let runtimeUrl=env.RUNTIME_DATABASE_ROLE?new URL(env.DATABASE_URL??''):null;
  if(runtimeUrl&&runtimeUrl.username!==role)throw new Error('RUNTIME_TARGET_MISMATCH');
  await transaction(admin,async(tx)=>{
    await tx.query('SELECT pg_advisory_xact_lock(72904114)');
    const exists=(await tx.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])).rowCount;
    if(!exists) {
      const password=randomBytes(32).toString('hex');
      const statement=(await tx.query("SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L',$1::text,$2::text) AS sql",[role,password])).rows[0].sql;
      await tx.query(statement);runtimeUrl=new URL(connection.href);runtimeUrl.username=role;runtimeUrl.password=password;
    } else if(!runtimeUrl)throw new Error('EXISTING_ROLE_NOT_OWNED');
    await tx.query(`GRANT CONNECT ON DATABASE skladno_local TO yanov_runtime`);
    await tx.query('GRANT USAGE ON SCHEMA public TO yanov_runtime');
    await tx.query('GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO yanov_runtime');
    await tx.query('REVOKE INSERT,UPDATE ON schema_migrations FROM yanov_runtime');
    await tx.query('REVOKE INSERT ON owner_account FROM yanov_runtime');
    await tx.query('REVOKE UPDATE ON audit_events,notification_events,payment_reversals FROM yanov_runtime');
    await tx.query('GRANT DELETE ON owner_sessions,auth_throttle TO yanov_runtime');
  });
  if(!runtimeUrl)throw new Error('RUNTIME_CONFIG_MISSING');
  const lines=content.split(/\r?\n/).filter((line)=>!['DATABASE_URL=','MIGRATION_DATABASE_URL=','RUNTIME_DATABASE_ROLE='].some((prefix)=>line.startsWith(prefix)));
  lines.push(`MIGRATION_DATABASE_URL=${connection.href}`,`DATABASE_URL=${(runtimeUrl as URL).href}`,`RUNTIME_DATABASE_ROLE=${role}`,'');
  await writeFile(envFile,lines.join('\n'),{mode:0o600});
  const check=requirePool(createPool(parseConfig({...env,DATABASE_URL:(runtimeUrl as URL).href})));
  try {
    const verified=(await check.query('SELECT current_user AS role,rolsuper,rolcreatedb FROM pg_roles WHERE rolname=current_user')).rows[0];
    if(verified.role!==role||verified.rolsuper||verified.rolcreatedb)throw new Error('RUNTIME_ROLE_NOT_RESTRICTED');
  } finally {await check.end();}
  console.log('Restricted local runtime role configured and verified. Migration access retained separately; no credentials displayed.');
} catch {console.error('RUNTIME_ROLE_SETUP_FAILED: local target or dedicated-role ownership could not be verified.');process.exitCode=1;}
finally {await admin?.end();}

import type pg from 'pg';
import type {AppConfig} from './config.js';
import {createPool,requirePool,transaction} from './db.js';

export async function grantRuntime(admin:pg.Pool,runtime:AppConfig,expectedDatabase:string,expectedRole:string,migrationUrl:string) {
  if(!runtime.DATABASE_URL||!migrationUrl)throw new Error('SEPARATE_CONNECTIONS_REQUIRED');
  const target=new URL(runtime.DATABASE_URL),migration=new URL(migrationUrl);
  if(target.hostname!==migration.hostname||target.port!==migration.port||target.pathname!==migration.pathname||target.username===migration.username)throw new Error('TARGET_MISMATCH');
  const role=decodeURIComponent(target.username),database=decodeURIComponent(target.pathname.slice(1));
  if(!/^[a-z][a-z0-9_]{2,62}$/.test(role))throw new Error('ROLE_NAME_GUARD');
  const identity=(await admin.query('SELECT current_database() AS db,current_user AS role')).rows[0];
  if(identity.db!==database||identity.db!==expectedDatabase||identity.role!==expectedRole)throw new Error('IDENTITY_GUARD');
  await transaction(admin,async(tx)=>{
    await tx.query('SELECT pg_advisory_xact_lock(72904114)');
    const exists=(await tx.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=$1',[role])).rows[0];
    if(exists&&(exists.rolsuper||exists.rolcreatedb||exists.rolcreaterole))throw new Error('ROLE_NOT_RESTRICTED');
    if(!exists) {
      if(!target.password)throw new Error('RUNTIME_PASSWORD_REQUIRED');
      const statement=(await tx.query("SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD %L',$1::text,$2::text)",[role,decodeURIComponent(target.password)])).rows[0].format;
      await tx.query(statement);
    }
    const quote=(name:string)=>'"'+name.replaceAll('"','""')+'"',r=quote(role);
    await tx.query(`GRANT CONNECT ON DATABASE ${quote(database)} TO ${r}`);
    await tx.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
    await tx.query(`GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO ${r}`);
    await tx.query(`REVOKE INSERT,UPDATE ON schema_migrations FROM ${r}`);
    await tx.query(`REVOKE INSERT ON owner_account FROM ${r}`);
    await tx.query(`REVOKE UPDATE ON audit_events,notification_events,payment_reversals FROM ${r}`);
    await tx.query(`GRANT DELETE ON owner_sessions,auth_throttle TO ${r}`);
  });
  const check=requirePool(createPool(runtime));
  try {await check.query('SELECT 1 FROM schema_migrations');}finally{await check.end();}
}

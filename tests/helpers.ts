import { randomUUID } from 'node:crypto';
import { loadConfig,parseConfig } from '../server/config.js';
import { createPool,requirePool } from '../server/db.js';
import { migrate } from '../server/migrations.js';

export async function testDatabase(options:{empty?:boolean}={}) {
  const original=loadConfig();
  const base={...original,DATABASE_URL:process.env.MIGRATION_DATABASE_URL||original.DATABASE_URL};
  if(base.NODE_ENV==='production'||process.env.LOCAL_DATABASE_MANAGED!=='true'||!base.DATABASE_URL)throw new Error('TEST_DATABASE_GUARD');
  const url=new URL(base.DATABASE_URL);
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/skladno_local')throw new Error('TEST_TARGET_GUARD');
  const admin=requirePool(createPool(base));
  const identity=(await admin.query('SELECT current_database() AS database,current_user AS role')).rows[0];
  if(identity.database!==process.env.POSTGRES_DB||identity.role!==process.env.POSTGRES_USER){await admin.end();throw new Error('TEST_IDENTITY_GUARD');}
  const name=`skladno_test_${randomUUID().replaceAll('-','')}`;
  if(!/^skladno_test_[a-f0-9]{32}$/.test(name))throw new Error('INVALID_TEST_NAME');
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname=name;
  const config=parseConfig({...base,NODE_ENV:'test',DATABASE_URL:url.href,RUN_SCHEDULER:'false'});
  const pool=requirePool(createPool(config));
  try {if(!options.empty)await migrate(pool);}catch {await pool.end();await admin.query(`DROP DATABASE "${name}"`);await admin.end();throw new Error('TEST_MIGRATION_FAILED');}
  let runtimePool=pool;
  let runtimeConfig=config;
  const runtimeRole=process.env.RUNTIME_DATABASE_ROLE;
  if(runtimeRole) {
    if(runtimeRole!=='yanov_runtime')throw new Error('TEST_RUNTIME_ROLE_GUARD');
    if(!options.empty) {
    await pool.query('GRANT USAGE ON SCHEMA public TO yanov_runtime');
    await pool.query('GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO yanov_runtime');
    await pool.query('REVOKE INSERT,UPDATE ON schema_migrations FROM yanov_runtime');
    await pool.query('REVOKE INSERT ON owner_account FROM yanov_runtime');
    await pool.query('REVOKE UPDATE ON audit_events,notification_events,payment_reversals FROM yanov_runtime');
    await pool.query('GRANT DELETE ON owner_sessions,auth_throttle TO yanov_runtime');
    }
    const runtimeUrl=new URL(original.DATABASE_URL!);runtimeUrl.pathname=name;
    runtimeConfig=parseConfig({...config,DATABASE_URL:runtimeUrl.href});runtimePool=requirePool(createPool(runtimeConfig));
  }
  return {pool,config:runtimeConfig,runtimePool,async close(){if(runtimePool!==pool)await runtimePool.end();await pool.end();await admin.query(`DROP DATABASE "${name}"`);await admin.end();}};
}

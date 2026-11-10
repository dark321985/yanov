import type {AppConfig} from './config.js';
import {createPool,requirePool} from './db.js';
import {initializeEmptyDatabase} from './migrations.js';
import {grantRuntime} from './runtime-grants.js';

interface BootstrapEnvironment {INITIALIZE_EMPTY_DATABASE?:string;MIGRATION_DATABASE_URL?:string;MIGRATION_EXPECTED_DATABASE?:string;MIGRATION_EXPECTED_ROLE?:string}
export async function prepareFirstDeployment(config:AppConfig,env:BootstrapEnvironment=process.env) {
  if(config.NODE_ENV!=='production'||env.INITIALIZE_EMPTY_DATABASE!=='true')throw new Error('INITIALIZATION_NOT_ENABLED');
  if(!env.MIGRATION_DATABASE_URL||!env.MIGRATION_EXPECTED_DATABASE||!env.MIGRATION_EXPECTED_ROLE||!config.DATABASE_URL)throw new Error('INITIALIZATION_CONFIG_MISSING');
  const runtime=new URL(config.DATABASE_URL),migration=new URL(env.MIGRATION_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(migration.protocol)||runtime.hostname!==migration.hostname||runtime.port!==migration.port||runtime.pathname!==migration.pathname||runtime.username===migration.username)throw new Error('INITIALIZATION_TARGET_MISMATCH');
  for(const key of ['ssl','sslmode','sslcert','sslkey','sslrootcert'])if(migration.searchParams.has(key))throw new Error('DATABASE_TLS_OPTIONS_REJECTED');
  const admin=requirePool(createPool({...config,DATABASE_URL:env.MIGRATION_DATABASE_URL}));
  try {
    const identity=(await admin.query('SELECT current_database() AS db,current_user AS role')).rows[0];
    if(identity.db!==env.MIGRATION_EXPECTED_DATABASE||identity.role!==env.MIGRATION_EXPECTED_ROLE)throw new Error('INITIALIZATION_IDENTITY_MISMATCH');
    const result=await initializeEmptyDatabase(admin);
    await grantRuntime(admin,config,env.MIGRATION_EXPECTED_DATABASE,env.MIGRATION_EXPECTED_ROLE,env.MIGRATION_DATABASE_URL);
    return result;
  } finally {await admin.end();}
}

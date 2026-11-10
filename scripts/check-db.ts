import pg from 'pg';
import { loadConfig } from '../server/config.js';

let pool: pg.Pool | undefined;
try {
  const config = loadConfig();
  if (config.NODE_ENV !== 'development' || process.env.LOCAL_DATABASE_MANAGED !== 'true'
    || !config.DATABASE_URL) throw new Error('LOCAL_ONLY');
  const connection = new URL(config.DATABASE_URL);
  if (!['127.0.0.1', 'localhost'].includes(connection.hostname)
    || connection.pathname !== '/skladno_local') throw new Error('TARGET_MISMATCH');
  pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 1, connectionTimeoutMillis: 2500, statement_timeout: 2500 });
  pool.on('error', () => {});
  const result = await pool.query<{ database: string; role: string }>('SELECT current_database() AS database, current_user AS role');
  if (result.rows[0]?.database !== process.env.POSTGRES_DB || result.rows[0]?.role !== (process.env.RUNTIME_DATABASE_ROLE||process.env.POSTGRES_USER)) {
    throw new Error('IDENTITY_MISMATCH');
  }
  console.log('Local PostgreSQL connection and expected database identity verified. No schema changes made.');
} catch {
  console.error('LOCAL_DATABASE_CHECK_FAILED: target unavailable or identity mismatch; private details omitted.');
  process.exitCode = 1;
} finally {
  await pool?.end();
}

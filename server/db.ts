import pg from 'pg';
import type { AppConfig } from './config.js';
import { AppError } from './errors.js';
pg.types.setTypeParser(1082,(value)=>value);

export interface Queryable { query<T extends pg.QueryResultRow = any>(sql: string, values?: any[]): Promise<pg.QueryResult<T>> }
export function createPool(config: AppConfig) {
  if (!config.DATABASE_URL) return undefined;
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 10,
    connectionTimeoutMillis: 4000, statement_timeout: 15_000, idleTimeoutMillis: 20_000,
    ssl: config.DATABASE_TLS === 'verify-full' ? { rejectUnauthorized: true } : false,
    application_name: 'skladno' });
  pool.on('error', () => { process.stderr.write('[database] IDLE_CONNECTION_UNAVAILABLE\n'); });
  return pool;
}
export function requirePool(pool: pg.Pool | undefined): pg.Pool {
  if (!pool) throw new AppError(503, 'DATABASE_NOT_READY', 'База данных не настроена.');
  return pool;
}
export async function transaction<T>(pool: pg.Pool, run: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try { await tx.query('BEGIN'); const result = await run(tx); await tx.query('COMMIT'); return result; }
  catch (error) { await tx.query('ROLLBACK').catch(() => {}); throw error; }
  finally { tx.release(); }
}

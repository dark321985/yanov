import pg from 'pg';
import type { AppConfig } from './config.js';
import type { DatabaseStatus } from '../shared/contracts.js';

export interface Database {
  status(): Promise<DatabaseStatus>;
  close(): Promise<void>;
}

export function createDatabase(config: AppConfig): Database {
  if (!config.DATABASE_URL) {
    return {
      status: async () => 'not-configured',
      close: async () => {},
    };
  }

  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 2500,
    idleTimeoutMillis: 10_000,
    statement_timeout: 2500,
    ssl: config.DATABASE_TLS === 'verify-full' ? { rejectUnauthorized: true } : false,
    application_name: 'skladno',
  });
  // Never print provider errors: they can contain private connection details.
  pool.on('error', () => {
    process.stderr.write('[database] IDLE_CONNECTION_UNAVAILABLE\n');
  });

  return {
    async status() {
      try {
        await pool.query('SELECT 1');
        return 'connected';
      } catch {
        return 'unavailable';
      }
    },
    async close() {
      await pool.end();
    },
  };
}

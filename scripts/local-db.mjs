import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const action = process.argv[2];
if (!['up', 'stop'].includes(action)) {
  console.error('Usage: npm run db:up | npm run db:stop');
  process.exit(1);
}

try {
  const local = parse(await readFile(new URL('../.env', import.meta.url)));
  const connection = new URL(local.MIGRATION_DATABASE_URL ?? local.DATABASE_URL ?? '');
  if (local.LOCAL_DATABASE_MANAGED !== 'true' || local.NODE_ENV !== 'development'
    || !['127.0.0.1', 'localhost'].includes(connection.hostname)
    || connection.pathname !== '/skladno_local'
    || local.POSTGRES_DB !== 'skladno_local'
    || !/^\d+$/.test(local.POSTGRES_PORT ?? '')
    || connection.port !== local.POSTGRES_PORT
    || Number(connection.port) < 1024 || Number(connection.port) > 65535
    || connection.username !== local.POSTGRES_USER
    || connection.password !== local.POSTGRES_PASSWORD) {
    throw new Error('LOCAL_DATABASE_TARGET_MISMATCH');
  }
  const args = ['compose', '--project-directory', root, '--env-file', fileURLToPath(new URL('../.env', import.meta.url)), '-f', 'compose.db.yml'];
  args.push(...(action === 'up' ? ['up', '-d', '--wait', '--wait-timeout', '90'] : ['stop']));
  // Provider output is deliberately hidden: compose errors may interpolate env values.
  const child = spawn('docker', args, { cwd: root, stdio: 'ignore', windowsHide: true });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  if (result !== 0) throw new Error('DOCKER_DATABASE_ACTION_FAILED');
  console.log(action === 'up' ? 'Local PostgreSQL is ready. Existing data preserved.' : 'Local PostgreSQL stopped. Volume preserved.');
} catch {
  console.error('LOCAL_DATABASE_ACTION_FAILED: check Docker availability and local .env; no credentials displayed.');
  process.exitCode = 1;
}

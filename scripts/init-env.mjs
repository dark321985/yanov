import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const username = 'skladno_local';
const database = 'skladno_local';
const password = randomBytes(32).toString('hex');
const connection = new URL('postgresql://127.0.0.1:55438');
connection.username = username;
connection.password = password;
connection.pathname = database;

const content = [
  '# Private local configuration. Never commit or display this file.',
  'NODE_ENV=development',
  'HOST=127.0.0.1',
  'PORT=3001',
  'APP_URL=http://127.0.0.1:5173',
  'APP_TIMEZONE=Europe/Moscow',
  'LOCAL_DATABASE_MANAGED=true',
  `POSTGRES_USER=${username}`,
  `POSTGRES_PASSWORD=${password}`,
  `POSTGRES_DB=${database}`,
  'POSTGRES_PORT=55438',
  `DATABASE_URL=${connection.toString()}`,
  'DATABASE_TLS=disabled',
  'TELEGRAM_BOT_TOKEN=',
  '',
].join('\n');

try {
  await writeFile(fileURLToPath(new URL('.env', root)), content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log('Local .env created. Credentials were generated and have not been displayed.');
} catch (error) {
  if (error?.code === 'EEXIST') {
    console.log('Existing .env preserved; no values changed.');
  } else {
    console.error('LOCAL_ENV_CREATE_FAILED');
    process.exitCode = 1;
  }
}

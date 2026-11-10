import { buildApp } from './app.js';
import { ConfigurationError, loadConfig } from './config.js';
import { createPool } from './db.js';
import { startScheduler } from './telegram.js';

async function main() {
  const config = loadConfig();
  const pool=createPool(config);
  const app = await buildApp({ config,pool });
  const stopScheduler=pool?startScheduler(pool,config):async()=>{};
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    await stopScheduler();
    await app.close();
  };
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  try {
    await app.listen({ host: config.HOST, port: config.PORT });
    process.stdout.write(`[api] READY environment=${config.NODE_ENV}\n`);
  } catch {
    await close();
    throw new Error('SERVER_START_FAILED');
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`[config] INVALID_FIELDS ${error.fields.join(', ')}\n`);
  } else {
    process.stderr.write('[api] START_FAILED — configuration, port or build unavailable\n');
  }
  process.exitCode = 1;
});

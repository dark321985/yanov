import { loadConfig } from '../server/config.js';
import { createPool, requirePool } from '../server/db.js';
import { setupOwner } from '../server/auth.js';
import { readHidden } from './password-input.js';
const config=loadConfig();
const pool=requirePool(createPool({...config,DATABASE_URL:process.env.MIGRATION_DATABASE_URL||config.DATABASE_URL}));
try {
  const mode=process.argv[2]; if(!['setup','reset'].includes(mode??''))throw new Error('INVALID_MODE');
  const password=await readHidden('Owner password (12–128 characters, hidden): ');
  const repeated=await readHidden('Repeat password (hidden): ');
  if(password!==repeated)throw new Error('PASSWORD_MISMATCH');
  await setupOwner(pool,password,mode==='reset');
  console.log('Owner credentials saved securely; all prior sessions revoked.');
} catch {
  console.error('OWNER_SETUP_FAILED: use an interactive terminal, matching 12–128 character passwords and a migrated database. Setup cannot replace an existing owner; reset requires server access.');
  process.exitCode=1;
} finally { await pool.end(); }

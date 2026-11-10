import { loadConfig } from '../server/config.js';
import { createPool,requirePool } from '../server/db.js';
import { grantRuntime } from '../server/runtime-grants.js';

const runtime=loadConfig();
const admin=requirePool(createPool({...runtime,DATABASE_URL:process.env.MIGRATION_DATABASE_URL}));
try {
  await grantRuntime(admin,runtime,process.env.MIGRATION_EXPECTED_DATABASE??'',process.env.MIGRATION_EXPECTED_ROLE??'',process.env.MIGRATION_DATABASE_URL??'');
  console.log('Runtime role and application table grants verified; no private connection details displayed.');
} catch {console.error('RUNTIME_GRANT_FAILED: verify separate same-target connections, expected identity and restricted role.');process.exitCode=1;}
finally{await admin.end();}

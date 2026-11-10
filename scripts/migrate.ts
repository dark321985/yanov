import { access, stat,readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { loadConfig } from '../server/config.js';
import { createPool, requirePool } from '../server/db.js';
import { migrate } from '../server/migrations.js';

const initial=loadConfig();
const pool=requirePool(createPool({...initial,DATABASE_URL:process.env.MIGRATION_DATABASE_URL||initial.DATABASE_URL}));
try {
  const config=loadConfig();
  const identity=(await pool.query('SELECT current_database() AS database,current_user AS role')).rows[0];
  if(config.NODE_ENV==='production') {
    if(process.env.PRODUCTION_MIGRATIONS_ALLOWED!=='true'||!process.env.MIGRATION_EXPECTED_DATABASE
      ||!process.env.MIGRATION_EXPECTED_ROLE||identity.database!==process.env.MIGRATION_EXPECTED_DATABASE
      ||identity.role!==process.env.MIGRATION_EXPECTED_ROLE||!process.env.MIGRATION_BACKUP_FILE)throw new Error('PREFLIGHT_REQUIRED');
    await access(process.env.MIGRATION_BACKUP_FILE);
    if((await stat(process.env.MIGRATION_BACKUP_FILE)).size===0)throw new Error('BACKUP_EMPTY');
    const expected=(await readFile(process.env.MIGRATION_BACKUP_FILE+'.sha256','utf8')).trim();
    const hash=createHash('sha256');for await(const chunk of createReadStream(process.env.MIGRATION_BACKUP_FILE))hash.update(chunk);
    if(!/^[a-f0-9]{64}$/.test(expected)||hash.digest('hex')!==expected)throw new Error('BACKUP_CHECKSUM_MISMATCH');
    await new Promise<void>((resolve,reject)=>{
      const child=spawn('pg_restore',['--list',process.env.MIGRATION_BACKUP_FILE!],{stdio:'ignore',windowsHide:true});
      child.once('error',()=>reject(new Error('BACKUP_READER_UNAVAILABLE')));child.once('exit',(code)=>code===0?resolve():reject(new Error('BACKUP_UNREADABLE')));
    });
  } else {
    const url=new URL(config.DATABASE_URL??'');
    if(process.env.LOCAL_DATABASE_MANAGED!=='true'||!['localhost','127.0.0.1'].includes(url.hostname)
      ||identity.database!==process.env.POSTGRES_DB||identity.role!==process.env.POSTGRES_USER
      ||identity.database!=='skladno_local')throw new Error('LOCAL_TARGET_MISMATCH');
  }
  const count=await migrate(pool); console.log(`Migrations verified/applied: ${count}. Database identity verified; access details omitted.`);
} catch {
  console.error('MIGRATION_FAILED: target identity, backup gate, checksums or migration unavailable. No private details displayed.');
  process.exitCode=1;
} finally { await pool.end(); }

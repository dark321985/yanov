import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir,writeFile,stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadConfig } from '../server/config.js';
import { createPool,requirePool } from '../server/db.js';
import { pgTool } from './postgres-tools.js';

const original=loadConfig(),config={...original,DATABASE_URL:process.env.MIGRATION_DATABASE_URL||original.DATABASE_URL};
const pool=requirePool(createPool(config));
try {
  const directory=resolve(process.env.BACKUP_DIRECTORY||'backups');await mkdir(directory,{recursive:true});
  const id=new Date().toISOString().replaceAll(/[:.]/g,'-'),file=resolve(directory,`skladno-${id}.dump`);
  await pool.query('SELECT current_database(),current_user');
  await pgTool(config,'pg_dump',file);
  if(!(await stat(file)).size)throw new Error('BACKUP_EMPTY');
  const checksum=createHash('sha256');for await(const chunk of createReadStream(file))checksum.update(chunk);
  await writeFile(file+'.sha256',checksum.digest('hex')+'\n',{mode:0o600,flag:'wx'});
  console.log('Database backup and checksum created in the configured backup directory. No private details displayed.');
} catch {console.error('BACKUP_FAILED: check database-tools availability and protected backup storage.');process.exitCode=1;}
finally {await pool.end();}

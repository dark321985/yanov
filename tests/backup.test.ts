import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir,stat,unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { testDatabase } from './helpers.js';
import { pgTool } from '../scripts/postgres-tools.js';
import { loadConfig } from '../server/config.js';

test('custom-format PostgreSQL dump restores into a separate disposable database',async()=>{
  const source=await testDatabase(),target=await testDatabase();
  const directory=resolve('.local');await mkdir(directory,{recursive:true});
  const file=resolve(directory,`restore-check-${randomUUID()}.dump`);
  try {
    await source.pool.query("INSERT INTO clients(id,name) VALUES($1,'Synthetic restore verification')",[randomUUID()]);
    const base=loadConfig(),sourceName=new URL(source.config.DATABASE_URL!).pathname.slice(1),targetName=new URL(target.config.DATABASE_URL!).pathname.slice(1);
    await pgTool({...base,DATABASE_URL:process.env.MIGRATION_DATABASE_URL||base.DATABASE_URL},'pg_dump',file,sourceName);
    assert.ok((await stat(file)).size>0);
    // Drop only the disposable test schema; never the source/dev database.
    assert.match(targetName,/^skladno_test_[a-f0-9]{32}$/);
    await target.pool.query('DROP SCHEMA public CASCADE');await target.pool.query('CREATE SCHEMA public');
    await pgTool({...base,DATABASE_URL:process.env.MIGRATION_DATABASE_URL||base.DATABASE_URL},'pg_restore',file,targetName);
    assert.equal(Number((await target.pool.query('SELECT count(*) FROM clients')).rows[0].count),1);
    assert.equal((await target.pool.query('SELECT name FROM clients')).rows[0].name,'Synthetic restore verification');
    assert.equal(Number((await target.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count),2);
  } finally {await source.close();await target.close();await unlink(file).catch(()=>{});}
});

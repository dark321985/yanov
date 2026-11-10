import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './helpers.js';
import {prepareFirstDeployment} from '../server/production-bootstrap.js';
import {emptySchemaSql,initializeEmptyDatabase,migrate,migrationFiles} from '../server/migrations.js';

test('deployment: empty external-style database, safe restart, identity/nonempty/drift guards and SQL artifact',async()=>{
  const fixture=await testDatabase({empty:true});
  const unrelated=await testDatabase({empty:true});
  const manual=await testDatabase({empty:true});
  let step='preflight';
  try {
    const config={...fixture.config,NODE_ENV:'production' as const,APP_URL:'https://deployment.example.test'};
    const migrationUrl=new URL(process.env.MIGRATION_DATABASE_URL!);migrationUrl.pathname=new URL(config.DATABASE_URL!).pathname;
    const identity=(await fixture.pool.query('SELECT current_database() AS db,current_user AS role')).rows[0];
    const env={INITIALIZE_EMPTY_DATABASE:'true',MIGRATION_DATABASE_URL:migrationUrl.href,MIGRATION_EXPECTED_DATABASE:identity.db,MIGRATION_EXPECTED_ROLE:identity.role};
    await assert.rejects(()=>prepareFirstDeployment(config,{...env,INITIALIZE_EMPTY_DATABASE:'false'}),/INITIALIZATION_NOT_ENABLED/);
    await assert.rejects(()=>prepareFirstDeployment(config,{...env,MIGRATION_EXPECTED_DATABASE:'wrong-target'}),/INITIALIZATION_IDENTITY_MISMATCH/);
    assert.equal((await fixture.pool.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name,null);
    step='initialize';assert.equal(await prepareFirstDeployment(config,env),'initialized');
    const counts=(await fixture.pool.query('SELECT (SELECT count(*) FROM clients)+(SELECT count(*) FROM warehouses)+(SELECT count(*) FROM leases)+(SELECT count(*) FROM payments)+(SELECT count(*) FROM owner_account)+(SELECT count(*) FROM owner_sessions) AS business,(SELECT count(*) FROM app_settings) AS defaults')).rows[0];
    assert.equal(Number(counts.business),0);assert.equal(Number(counts.defaults),1);
    const permissions=(await fixture.runtimePool.query('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0];assert.equal(permissions.rolsuper,false);assert.equal(permissions.rolcreatedb,false);assert.equal(permissions.rolcreaterole,false);
    step='restart preservation';
    const id=randomUUID();await fixture.pool.query("INSERT INTO clients(id,name) VALUES($1,'Preserved synthetic record')",[id]);
    assert.equal(await prepareFirstDeployment(config,env),'already-initialized');assert.equal((await fixture.pool.query('SELECT count(*) FROM clients WHERE id=$1',[id])).rows[0].count,'1');
    step='line ending compatibility';
    const files=await migrationFiles();await fixture.pool.query('UPDATE schema_migrations SET checksum=$2 WHERE name=$1',[files[0]!.name,files[0]!.legacyChecksum]);
    assert.equal(await prepareFirstDeployment(config,env),'already-initialized');await migrate(fixture.pool);
    step='unknown schema refusal';
    await unrelated.pool.query('CREATE TABLE keep_existing(id integer)');await unrelated.pool.query('INSERT INTO keep_existing VALUES(42)');
    await assert.rejects(()=>initializeEmptyDatabase(unrelated.pool),/DATABASE_NOT_EMPTY/);
    assert.equal((await unrelated.pool.query('SELECT id FROM keep_existing')).rows[0].id,42);
    assert.equal((await unrelated.pool.query("SELECT to_regclass('public.schema_migrations') AS name")).rows[0].name,null);
    step='no automatic upgrade on restart';
    await fixture.pool.query("UPDATE schema_migrations SET checksum=$1 WHERE name=$2",['0'.repeat(64),files[0]!.name]);
    await assert.rejects(()=>prepareFirstDeployment(config,env),/CONTROLLED_MIGRATION_REQUIRED/);
    assert.equal((await fixture.pool.query('SELECT count(*) FROM clients WHERE id=$1',[id])).rows[0].count,'1');
    step='schema artifact';
    const sql=await readFile('db/schema.sql','utf8');assert.equal(sql.replace(/\r\n/g,'\n'),await emptySchemaSql());
    const client=await manual.pool.connect();
    try {
      await assert.rejects(()=>client.query(sql),/DATABASE_IDENTITY_NOT_CONFIRMED/);await client.query('ROLLBACK');
      const target=(await client.query('SELECT current_database() AS db,current_user AS role')).rows[0];
      await client.query("SELECT set_config('skladno.expected_database',$1,false),set_config('skladno.expected_role',$2,false)",[target.db,target.role]);
      await client.query(sql);
    } finally {client.release();}
    assert.equal((await manual.pool.query('SELECT count(*) FROM clients')).rows[0].count,'0');
    assert.equal((await manual.pool.query('SELECT count(*) FROM owner_account')).rows[0].count,'0');
    assert.equal((await manual.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'3');
    assert.equal(await initializeEmptyDatabase(manual.pool),'already-initialized');
  } catch {throw new Error('DEPLOYMENT_CHECK_FAILED: '+step);}
  finally {await fixture.close();await unrelated.close();await manual.close();}
});

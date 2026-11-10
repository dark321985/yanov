import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,type ChildProcess} from 'node:child_process';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './helpers.js';

test('compiled startup initializes empty production-style database before readiness and preserves data on restart',{timeout:45000},async()=>{
  const fixture=await testDatabase({empty:true});let child:ChildProcess|undefined;let step='prepare';
  const stop=async()=>{
    if(child&&child.exitCode===null&&child.signalCode===null){const exited=new Promise<void>((resolve)=>child!.once('exit',()=>resolve()));child.kill('SIGTERM');await exited;}
  };
  try {
    const identity=(await fixture.pool.query('SELECT current_database() AS db,current_user AS role')).rows[0];
    const url=new URL(process.env.MIGRATION_DATABASE_URL!);url.pathname=identity.db;
    const reserve=createServer();await new Promise<void>((resolve,reject)=>{reserve.once('error',reject);reserve.listen(0,'127.0.0.1',()=>resolve());});
    const address=reserve.address();if(!address||typeof address==='string')throw new Error('PORT_UNAVAILABLE');
    const port=address.port;await new Promise<void>((resolve,reject)=>reserve.close((error)=>error?reject(error):resolve()));
    const env={...process.env,NODE_ENV:'production',HOST:'127.0.0.1',PORT:String(port),APP_URL:'https://startup.example.test',DATABASE_URL:fixture.config.DATABASE_URL!,DATABASE_TLS:'disabled',MIGRATION_DATABASE_URL:url.href,MIGRATION_EXPECTED_DATABASE:identity.db,MIGRATION_EXPECTED_ROLE:identity.role,INITIALIZE_EMPTY_DATABASE:'true',RUN_SCHEDULER:'false',TELEGRAM_BOT_TOKEN:''};
    const start=async()=>{
      child=spawn(process.execPath,['scripts/start.mjs'],{env,stdio:'ignore',windowsHide:true});
      let available=false;
      for(let i=0;i<100;i++) {
        if(child.exitCode!==null)throw new Error('CHILD_EXITED');
        try {available=(await fetch(`http://127.0.0.1:${port}/health/ready`,{signal:AbortSignal.timeout(250)})).ok;}catch{}
        if(available)break;await new Promise((resolve)=>setTimeout(resolve,100));
      }
      assert.equal(available,true);
    };
    step='first startup';await start();
    const status=await(await fetch(`http://127.0.0.1:${port}/api/auth/status`)).json() as {needsSetup:boolean};assert.equal(status.needsSetup,true);
    assert.equal((await fixture.pool.query('SELECT count(*) FROM clients')).rows[0].count,'0');
    const id=randomUUID();await fixture.pool.query("INSERT INTO clients(id,name) VALUES($1,'Synthetic restart record')",[id]);
    await stop();step='second startup';await start();
    assert.equal((await fixture.pool.query('SELECT count(*) FROM clients WHERE id=$1',[id])).rows[0].count,'1');
    assert.equal((await fixture.pool.query('SELECT count(*) FROM schema_migrations')).rows[0].count,'3');
  } catch {throw new Error('COMPILED_BOOTSTRAP_CHECK_FAILED: '+step);}
  finally {await stop();await fixture.close();}
});

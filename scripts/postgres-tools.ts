import { spawn } from 'node:child_process';
import { createWriteStream,createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import type { AppConfig } from '../server/config.js';

// Values stay in child environment; never append credentials/URLs to command arguments.
export async function pgTool(config:AppConfig,tool:'pg_dump'|'pg_restore',file:string,targetDatabase?:string) {
  if(!config.DATABASE_URL)throw new Error('DATABASE_NOT_CONFIGURED');
  const url=new URL(config.DATABASE_URL),env={...process.env,
    PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),
    PGDATABASE:targetDatabase??decodeURIComponent(url.pathname.slice(1)),PGSSLMODE:config.DATABASE_TLS==='verify-full'?'verify-full':'disable'};
  const localDocker=process.env.LOCAL_DATABASE_MANAGED==='true'&&config.NODE_ENV!=='production'&&['localhost','127.0.0.1'].includes(url.hostname);
  const path=resolve(file);
  let command:string,args:string[];
  if(localDocker) {
    // The local container already has its administrative credentials in its own environment.
    // Only the database name (validated generated local name) crosses as a non-secret positional value.
    const database=targetDatabase??url.pathname.slice(1);
    if(!/^(skladno_local|skladno_test_[a-f0-9]{32})$/.test(database))throw new Error('LOCAL_TOOL_TARGET_GUARD');
    command='docker';
    const shell=tool==='pg_dump'?'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$1" -Fc --no-owner --no-acl'
      :'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --no-acl --exit-on-error';
    args=['compose','--env-file',resolve('.env'),'-f',resolve('compose.db.yml'),'exec','-T','postgres','sh','-c',shell,'_',database];
  } else {command=tool;args=tool==='pg_dump'?['-Fc','--no-owner','--no-acl']:['--no-owner','--no-acl','--exit-on-error'];}
  const child=spawn(command,args,{env,stdio:['pipe','pipe','ignore'],windowsHide:true});
  const finished=new Promise<void>((resolve,reject)=>{child.once('error',()=>reject(new Error('POSTGRES_TOOL_UNAVAILABLE')));child.once('exit',(code)=>code===0?resolve():reject(new Error('POSTGRES_TOOL_FAILED')));});
  if(tool==='pg_dump') {
    child.stdin.end();
    await Promise.all([pipeline(child.stdout,createWriteStream(path,{flags:'wx',mode:0o600})),finished]);
  } else {
    child.stdout.resume();await Promise.all([pipeline(createReadStream(path),child.stdin),finished]);
  }
}

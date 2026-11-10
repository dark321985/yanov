import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { readHidden } from '../scripts/password-input.js';

function terminal() {
  const stream=new PassThrough();let raw=false;let output='';
  Object.assign(stream,{isTTY:true,isRaw:false,setRawMode(value:boolean){raw=value;return stream;}});
  return {input:stream as unknown as typeof process.stdin,output:{write(value:string){output+=value;return true;}} as Pick<typeof process.stdout,'write'>,isRaw:()=>raw,captured:()=>output};
}
test('hidden CLI password input never echoes characters and restores terminal mode',async()=>{
  const tty=terminal(),secret=randomBytes(24).toString('hex');
  const pending=readHidden('Password: ',tty.input,tty.output);tty.input.emit('data',secret+'x\b\r');
  assert.equal(await pending,secret);assert.equal(tty.captured(),'Password: \n');assert.equal(tty.isRaw(),false);assert.equal(tty.input.listenerCount('data'),0);assert.equal(tty.input.listenerCount('end'),0);
});
test('cancel and overlong input do not leak or silently truncate the password',async()=>{
  const cancelled=terminal();const pending=readHidden('Password: ',cancelled.input,cancelled.output);cancelled.input.emit('data','\u0003');await assert.rejects(pending);assert.equal(cancelled.isRaw(),false);
  const tty=terminal(),secret=randomBytes(90).toString('hex');const long=readHidden('Password: ',tty.input,tty.output);tty.input.emit('data',secret+'\r');assert.equal((await long).length,180);assert.equal(tty.captured(),'Password: \n');
});

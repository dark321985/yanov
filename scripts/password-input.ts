export async function readHidden(prompt:string,input=process.stdin,output:Pick<typeof process.stdout,'write'>=process.stdout):Promise<string> {
  if(!input.isTTY)throw new Error('INTERACTIVE_TERMINAL_REQUIRED');
  output.write(prompt);
  const wasRaw=Boolean(input.isRaw);
  input.setRawMode(true);input.resume();input.setEncoding('utf8');
  return new Promise((resolve,reject)=>{
    let value='';
    const onEnd=()=>{done();reject(new Error('INPUT_CLOSED'));};
    const done=()=>{input.removeListener('data',onData);input.removeListener('end',onEnd);input.setRawMode(wasRaw);input.pause();output.write('\n');};
    const onData=(chunk:string)=>{
      for(const character of chunk) {
        if(character==='\u0003'){done();reject(new Error('CANCELLED'));return;}
        if(character==='\r'||character==='\n'){done();resolve(value);return;}
        if(character==='\u007f'||character==='\b')value=value.slice(0,-1);
        // Retain enough input for length validation to reject an overlong password;
        // never silently accept a truncated 128-character password.
        else if(character>=' '&&value.length<1024)value+=character;
      }
    };
    input.on('data',onData);
    input.once('end',onEnd);
  });
}

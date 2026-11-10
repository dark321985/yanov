process.env.NODE_ENV = 'production';
try {
  const {loadConfig}=await import('../dist/server/server/config.js');
  const config=loadConfig();
  if(process.env.INITIALIZE_EMPTY_DATABASE==='true') {
    const {prepareFirstDeployment}=await import('../dist/server/server/production-bootstrap.js');
    const result=await prepareFirstDeployment(config);
    console.log(`[database] ${result==='initialized'?'EMPTY_DATABASE_INITIALIZED':'SCHEMA_VERIFIED'}`);
  }
  await import('../dist/server/server/index.js');
} catch(error) {
  const safe=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'PRODUCTION_START_FAILED';
  console.error(`[startup] ${safe}; private connection details omitted.`);
  process.exitCode=1;
}

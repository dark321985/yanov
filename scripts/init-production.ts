import {loadConfig} from '../server/config.js';
import {prepareFirstDeployment} from '../server/production-bootstrap.js';
try {
  const result=await prepareFirstDeployment(loadConfig());
  console.log(result==='initialized'?'Empty database schema initialized; no owner or business data imported.':'Existing application schema verified; no data reset.');
} catch(error) {
  const safe=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'INITIALIZATION_FAILED';
  console.error(`${safe}; private connection details omitted.`);process.exitCode=1;
}

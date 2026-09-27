import {spawnSync} from 'node:child_process';import {root,stagingSite} from './build-public.mjs';import {assertStagingEnvironment} from './deploy-staging.mjs';
const cli=process.env.NETLIFY_CLI_PATH;if(!cli)throw Error('Authenticated CLI path required');
const r=spawnSync(process.execPath,[cli,'env:list','--json','--site',stagingSite,'--context','branch-deploy','--scope','functions'],{cwd:root,encoding:'utf8'});
if(r.status)throw Error('Staging environment read failed; output withheld');const env=JSON.parse(r.stdout);assertStagingEnvironment(env);
if(!/^pat[A-Za-z0-9]+\.[A-Za-z0-9]+$/.test(env.AIRTABLE_TOKEN)){
  if(!process.env.LIFECYCLE_RPC_DIR)throw Error('CLI does not return a usable staging PAT; no backend writes attempted');
  env.AIRTABLE_TOKEN='connector-transport-only'; // Queue strips auth; approved connector handles isolated records.
}
const result=spawnSync(process.execPath,['test/smoke/run-lifecycle-backend.mjs','--apply-staging'],{cwd:root,env:{...process.env,...env},stdio:'inherit'});process.exit(result.status??1);

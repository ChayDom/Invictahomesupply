import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {buildPublic,root,stagingSite} from '../scripts/build-public.mjs';
import {assertStagingEnvironment} from '../scripts/deploy-staging.mjs';
let failures=0;function test(n,f){try{f();console.log('ok - '+n);}catch(e){failures++;console.error('NOT OK - '+n+'\n'+e.stack);}}
const artifact=buildPublic({staging:true});
for(const name of ['package.json','package-lock.json','Invicta Appscript Files/Config.js','test/appscript-remediation.test.mjs','docs/SOLD_OUT_LIFECYCLE.md','codex-appscript-refactor.patch','scripts/deploy-staging.mjs','.netlify/state.json'])test('operational path absent: '+name,()=>assert.equal(fs.existsSync(path.join(root,'dist-public',name)),false));
test('staging noindex/CSP/analytics marker is reproducible',()=>{
  assert.equal(artifact.staging,true);assert.equal(artifact.files._headers,undefined);assert.match(artifact.deploymentControls._headers,/^[a-f0-9]{64}$/);assert.match(fs.readFileSync(path.join(root,'dist-public/_headers'),'utf8'),/connect-src 'self'/);assert.match(fs.readFileSync(path.join(root,'dist-public/app.js'),'utf8'),/^window.__INVICTA_STAGING__ = true/);assert.match(fs.readFileSync(path.join(root,'dist-public/robots.txt'),'utf8'),/Disallow: \//);
});
test('production packaging never publishes stage marker',()=>{const m=buildPublic();assert.equal(m.staging,false);assert.equal(fs.existsSync(path.join(root,'dist-public/_headers')),false);});
test('production-site preview build fails closed',()=>assert.throws(()=>buildPublic({siteId:'production-site',context:'deploy-preview'}),/unsafe/));
const env={AIRTABLE_BASE_ID:'appLzUBCXBMzrgVx1',AIRTABLE_TABLE_NAME:'Website Products',AIRTABLE_TOKEN:'fake',WEEKLY_DIGEST_ENABLED:'false'};
test('only dedicated stage target/credential keys allowed',()=>assertStagingEnvironment(env));
for(const extra of [{AIRTABLE_BASE_ID:'apptugvm4r5tm2OIt'},{RESEND_API_KEY:'fake'},{AIRTABLE_SUBSCRIBERS_TOKEN:'fake'},{BUFFER_ACCESS_TOKEN:'fake'},{WEEKLY_DIGEST_ENABLED:'true'}])test('reject unsafe environment '+Object.keys(extra)[0],()=>assert.throws(()=>assertStagingEnvironment({...env,...extra}),/isolation/));
if(failures)process.exit(1);

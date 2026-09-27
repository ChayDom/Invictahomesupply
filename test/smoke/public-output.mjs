import assert from 'node:assert/strict';import crypto from 'node:crypto';
const url=process.env.STAGING_DEPLOY_URL,sha=process.env.STAGING_CANDIDATE;
if(!/^https:\/\/preproduction-[a-f0-9]+--invicta-home-supply-staging\.netlify\.app$/.test(url||'')||!sha)throw Error('Exact staging URL/candidate required');
let failed=0,passed=0;async function check(n,f){try{await f();passed++;console.log('ok - '+n);}catch(e){failed++;console.error('NOT OK - '+n+': '+e.message);}}
for(const name of ['/package.json','/package-lock.json','/Invicta%20Appscript%20Files/Config.js','/Invicta%20Appscript%20Files/CatalogSourceConfirmation.js','/test/appscript-remediation.test.mjs','/docs/NATIVE_ACCEPTANCE_AND_RELEASE_GATES.md','/codex-appscript-refactor.patch','/scripts/deploy-staging.mjs','/.netlify/state.json'])await check('404 '+name,async()=>assert.equal((await fetch(url+name)).status,404));
await check('noindex/CSP/robots',async()=>{const r=await fetch(url);assert.match(r.headers.get('x-robots-tag')||'',/noindex/);assert.match(r.headers.get('content-security-policy')||'',/connect-src 'self'/);assert.match(await fetch(url+'/robots.txt').then(r=>r.text()),/Disallow: \//);});
await check('candidate and every asset hash verified',async()=>{
 const manifest=await fetch(url+'/release-manifest.json').then(r=>r.json());assert.equal(manifest.candidate,sha);assert.equal(manifest.staging,true);
 for(const [name,hash] of Object.entries(manifest.files)){const r=await fetch(url+'/'+name);assert.equal(r.status,200,name);assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),hash,name);}
});
await check('synthetic-only inventory',async()=>{const r=await fetch(url+'/api/inventory?publicProbe='+Date.now()).then(r=>r.json());assert.ok(r.records.length>0);assert.ok(r.records.every(r=>String(r.fields['Product Key']).startsWith('STAGE-')));});
console.log(JSON.stringify({passed,failed}));if(failed)process.exit(1);

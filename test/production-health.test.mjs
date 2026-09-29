import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {createRuntime,Sheet,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
let failed=0;function test(name,fn){try{fn();console.log('ok - '+name);}catch(e){failed++;console.error('NOT OK - '+name+'\n'+e.stack);}}
const now=Date.parse('2026-09-28T12:00:00Z');
function setup(){
  const t=createRuntime({now,quantity:10,since:null});
  vm.runInContext(fs.readFileSync(new URL('../Invicta Appscript Files/ProductionHealth.js',import.meta.url),'utf8'),t.ctx);
  t.catalog.formula=vm.runInContext('INVICTA_HEALTH_K2_',t.ctx);
  t.sheets['Product Catalog Archive']=new Sheet('Product Catalog Archive',vm.runInContext('CATALOG_ARCHIVE_HEADERS_',t.ctx));
  t.sheets['Social Queue']=new Sheet('Social Queue',vm.runInContext('SOCIAL_REQUIRED_HEADERS_',t.ctx));
  const required=['AIRTABLE_TOKEN','AIRTABLE_BASE_ID','AIRTABLE_ENVIRONMENT','AIRTABLE_WORKBOOK_ID','GEMINI_API_KEY','BUFFER_API_KEY',
    'BUFFER_ORGANIZATION_ID','BUFFER_FACEBOOK_CHANNEL_ID','BUFFER_INSTAGRAM_CHANNEL_ID','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','SOCIAL_REVIEW_EMAIL'];
  required.forEach(n=>t.properties[n]='unsafe-secret-value-'+n);t.properties.SOCIAL_PUBLISHING_ENABLED='true';
  t.ctx.iwaApprovedConfiguration_=()=>({environment:'production'});
  t.handlers=plain(vm.runInContext('INVICTA_HEALTH_HANDLERS_.concat(INVICTA_HEALTH_ALERT_HANDLER_)',t.ctx));
  t.ctx.ScriptApp={getProjectTriggers:()=>t.handlers.map(h=>({getHandlerFunction:()=>h,getEventType:()=>t.eventType||'CLOCK'}))};
  t.ctx.Session={getScriptTimeZone:()=>t.timezone||'America/Chicago'};
  t.records[0].fields={...t.records[0].fields,Status:'In Stock',Name:'Synthetic lifecycle oak',Price:1.5,Category:'Flooring',
    'Price Basis':'Per Sq Ft','Unit Type':'Box',Photos:[{id:'attOwnerPhoto1',url:'https://example.com/owner.jpg',type:'image/jpeg',width:800,height:800}]};
  t.reads=0;const read=t.ctx.iwaFetchAll_;t.ctx.iwaFetchAll_=(...a)=>{t.reads++;return read(...a);};
  t.ctx.bufferGraphql_=(_token,q)=>{assert.match(q,/^query /);assert.doesNotMatch(q,/mutation|createPost/);return {account:{id:'safe-account'}};};
  t.ctx.UrlFetchApp={fetch:(url,options)=>{assert.equal(url,'https://invictahomesupply.com/api/inventory');assert.equal(options.method,'get');return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({records:t.records})};}};
  t.logs=[];t.emails=[];t.ctx.console.log=s=>t.logs.push(s);t.ctx.MailApp={sendEmail:e=>t.emails.push(e)};
  const cache=new Map();t.ctx.CacheService={getScriptCache:()=>({get:k=>cache.get(k),put:(k,v)=>cache.set(k,v)})};
  Object.values(t.sheets).forEach(s=>s.writes=[]);
  return t;
}
const health=t=>t.ctx.runInvictaProductionHealthCheck();
const issues=r=>Object.values(r.sections).flatMap(s=>s.issues).map(i=>i.code);
function social(t,{status='Draft',generated=now-86400000,receipts=false,copy=true}={}){
  const row=new Array(19).fill('');row[0]='STAGE-ARCHIVE-UNIT';row[12]=status;row[16]=new Date(generated).toISOString();
  if(copy){row[9]='Approved Facebook copy';row[10]='Approved Instagram copy';}
  if(receipts){row[13]='historical-fb-receipt';row[15]=new Date(now-3*86400000).toISOString();}
  t.sheets['Social Queue'].data.push(row);return row;
}
test('all six expected production triggers and healthy dependencies are GREEN',()=>{const r=health(setup());assert.equal(r.status,'GREEN');assert.equal(r.summary.checksPassed,11);});
test('missing daily preparation trigger is FAIL',()=>{const t=setup();t.handlers=t.handlers.filter(h=>h!=='runDailySocialPreparation');assert.equal(health(t).status,'FAIL');});
test('duplicate publishing trigger is FAIL',()=>{const t=setup();t.handlers.push('sendReadySocialPostsToBuffer');assert.ok(issues(health(t)).includes('DUPLICATE_TRIGGER'));});
test('unexpected legacy social trigger is FAIL',()=>{const t=setup();t.handlers.push('runWednesdaySocialPreparation');assert.ok(issues(health(t)).includes('UNEXPECTED_TRIGGER'));});
test('own not-yet-installed health trigger is an explainable WARNING',()=>{const t=setup();t.handlers.pop();assert.equal(health(t).status,'WARNING');});
test('timezone or non-clock event drift is FAIL, unavailable minute/cadence is informational',()=>{const t=setup();t.timezone='America/Los_Angeles';assert.equal(health(t).status,'FAIL');const u=setup();u.eventType='ON_OPEN';assert.equal(health(u).status,'FAIL');});
test('missing review email is FAIL and never sends to an alternate address',()=>{const t=setup();delete t.properties.SOCIAL_REVIEW_EMAIL;assert.equal(health(t).status,'FAIL');t.ctx.runInvictaProductionHealthCheckAndAlert();assert.equal(t.emails.length,0);});
test('cleanup false violates enabled production contract',()=>{const t=setup();t.properties.CATALOG_LIFECYCLE_CLEANUP_ENABLED='false';assert.ok(issues(health(t)).includes('BOOLEAN_CONTRACT'));});
test('duplicate Catalog Product Key is FAIL',()=>{const t=setup();t.catalog.data.push(t.catalog.data[1].slice());assert.ok(issues(health(t)).includes('DUPLICATE PRODUCT KEY'));});
test('duplicate Export or Airtable key is FAIL',()=>{const t=setup();t.sheets['Website Export'].data.push(t.sheets['Website Export'].data[1].slice());assert.equal(health(t).status,'FAIL');const u=setup();u.records.push(plain(u.records[0]));assert.equal(health(u).status,'FAIL');});
test('invalid archive hash is FAIL without repair',()=>{const t=setup();t.setQuantity(0);t.cleanup();const a=t.ctx.readCatalogArchive_(t.ss);a.sheet.data[1][a.map['SNAPSHOT HASH']]='bad';assert.equal(health(t).status,'FAIL');});
test('exact K2 is required without writing a replacement',()=>{const t=setup();t.catalog.formula='=1';assert.ok(issues(health(t)).includes('K2_CHANGED'));assert.equal(t.catalog.formula,'=1');});
test('confirmed zero active Catalog/Export is FAIL',()=>{const t=setup();t.setQuantity(0);assert.ok(issues(health(t)).includes('ACTIVE_CONFIRMED_ZERO'));});
test('historical Queued receipts remain healthy and are not counted as pending remote posts',()=>{const t=setup();social(t,{status:'Queued',receipts:true});const r=health(t);assert.equal(r.status,'GREEN');assert.equal(r.sections.socialPublishing.historicalQueuedAreNotRemotePending,true);assert.equal(r.sections.socialPublishing.publicDeliveryVerified,false);});
test('Queued row missing both receipts is WARNING',()=>{const t=setup();social(t,{status:'Queued'});assert.ok(issues(health(t)).includes('QUEUED_WITHOUT_RECEIPT'));});
test('old generation with complete drafts has no false stale warning',()=>{const t=setup();social(t,{generated:now-10*86400000});assert.equal(health(t).status,'GREEN');});
test('old generation and eligible missing copy warns',()=>{const t=setup();social(t,{generated:now-10*86400000,copy:false});assert.ok(issues(health(t)).includes('STALE_PRODUCT_DRAFT_GENERATION'));});
test('ineligible products do not cause stale generation warnings',()=>{const t=setup();social(t,{generated:now-10*86400000,copy:false});t.records[0].fields['Post to Website']=false;assert.ok(!issues(health(t)).includes('STALE_PRODUCT_DRAFT_GENERATION'));});
test('evergreen initialization does not refresh normal product generation age',()=>{
  const t=setup();social(t,{generated:now-10*86400000,copy:false});
  const headers=plain(vm.runInContext('EVERGREEN_HEADERS_',t.ctx)),seed=plain(t.ctx.evergreenSeedRows_()[0]);
  t.sheets['Evergreen Social Content']=new Sheet('Evergreen Social Content',headers,[seed]);
  const row=new Array(19).fill('');row[0]='EVERGREEN|'+seed[0]+'|1';row[7]=seed[1];row[12]='Draft';row[16]=new Date(now).toISOString();t.sheets['Social Queue'].data.push(row);
  const r=health(t);assert.ok(issues(r).includes('STALE_PRODUCT_DRAFT_GENERATION'));assert.equal(r.sections.socialPreparation.latestProductGeneratedAt,new Date(now-10*86400000).toISOString());assert.equal(r.sections.socialQueue.evergreenRows,1);
});
test('sold-out Ready product is FAIL',()=>{const t=setup();social(t,{status:'Ready'});t.setQuantity(0);assert.ok(issues(health(t)).includes('INELIGIBLE_READY_PRODUCT'));});
test('already retired key with an actionable Draft is FAIL even without active Catalog stock',()=>{const t=setup();const r=social(t);t.setQuantity(0);t.cleanup();r[12]='Draft';assert.ok(issues(health(t)).includes('ACTIONABLE_SOLD_OUT_PRODUCT'));});
test('retention archive is pending; at expiry report eligibility but never delete',()=>{const t=setup();t.setQuantity(0);t.records[0].fields['Sold Out Since']=new Date(now).toISOString();t.cleanup();let r=health(t);assert.equal(r.sections.lifecycle.pendingRetention,1);assert.equal(r.sections.lifecycle.eligibleDay10Cleanup,0);t.setClock(now+864000000);t.events.length=0;r=health(t);assert.equal(r.sections.lifecycle.eligibleDay10Cleanup,1);assert.equal(t.events.length,0);assert.equal(t.records.length,1);});
test('unknown archived source cannot become cleanup eligible',()=>{const t=setup();t.setQuantity(0);t.cleanup();t.setQuantity('');t.setClock(now+864000000);assert.equal(health(t).sections.lifecycle.eligibleDay10Cleanup,0);});
test('health checker has zero business/property/email writes, one Airtable read, and no secret output',()=>{
  const t=setup();social(t);const before=Object.fromEntries(Object.entries(t.sheets).map(([k,s])=>[k,plain(s.data)]));const props=plain(t.properties),records=plain(t.records);
  t.ctx.PropertiesService.getScriptProperties=()=>({getProperty:n=>t.properties[n]??null,setProperty(){throw Error('No property writes');}});
  Object.values(t.sheets).forEach(s=>{s.beforeWrite=()=>{throw Error('No business writes');};});
  const r=health(t);assert.equal(r.status,'GREEN');assert.equal(t.reads,1);assert.equal(t.events.length,0);assert.equal(t.emails.length,0);assert.deepEqual(t.records,records);assert.deepEqual(t.properties,props);
  for(const [k,s] of Object.entries(t.sheets)){assert.deepEqual(plain(s.data),before[k]);assert.equal(s.writes.length,0);assert.equal(s.notes,undefined);}
  assert.ok(!JSON.stringify(r).includes('unsafe-secret-value'));assert.ok(!t.logs.join('\n').includes('unsafe-secret-value'));
});
test('failed remote response text cannot leak secrets to results/logs',()=>{const t=setup();t.ctx.iwaFetchAll_=()=>{throw Error('unsafe-secret-value-external-error');};assert.equal(health(t).status,'FAIL');assert.ok(!t.logs.join('\n').includes('unsafe-secret-value'));});
test('GREEN wrapper sends no mail; identical warning alerts dedupe without Script Properties',()=>{const t=setup();t.ctx.runInvictaProductionHealthCheckAndAlert();assert.equal(t.emails.length,0);t.handlers.pop();t.ctx.runInvictaProductionHealthCheckAndAlert();t.ctx.runInvictaProductionHealthCheckAndAlert();assert.equal(t.emails.length,1);assert.match(t.emails[0].subject,/WARNING/);assert.ok(!t.emails[0].body.includes('unsafe-secret-value'));});
if(failed)process.exitCode=1;

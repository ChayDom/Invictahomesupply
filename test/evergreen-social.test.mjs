import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRuntime,Sheet,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
import {loadContract} from '../scripts/social-media-worker.mjs';
import {prepareEvergreen,readEvergreenSnapshot,graphicText,renderEvergreen} from '../scripts/evergreen-media-worker.mjs';
import {prepareEvergreenV2,v2Prompt} from '../scripts/evergreen-v2-media-worker.mjs';

const headers=['PRODUCT KEY','PRODUCT NAME','CATEGORY','PRICE','MEDIA URL','MEDIA TYPE','PRODUCT URL','CONTENT TYPE',
  'HOOK','FACEBOOK CAPTION','INSTAGRAM CAPTION','HASHTAGS','SOCIAL STATUS','FB BUFFER POST ID','IG BUFFER POST ID',
  'LAST POSTED AT','GENERATED AT','SOURCE HASH','ERROR'];
const libraryHeaders=['CONTENT ID','CONTENT TYPE','TITLE','CAPTION','SLIDE 1','SLIDE 2','SLIDE 3','SLIDE 4','STATUS','COOLDOWN DAYS','SOURCES'];
let pass=0,fail=0;
async function test(name,fn){try{await fn();pass++;console.log('ok - '+name);}catch(error){fail++;console.log('NOT OK - '+name);console.error(error);}}
function notesFor(sheet) {
  const notes=new Map(),original=sheet.getRange.bind(sheet);
  sheet.getRange=(r,c,n=1,m=1)=>Object.assign(original(r,c,n,m),{
    getNote:()=>notes.get(r+':'+c)||'',setNote:value=>{notes.set(r+':'+c,value);return sheet.getRange(r,c,n,m);}});
  return notes;
}
function fixture({libraryRows,history=true}={}) {
  const t=createRuntime({quantity:10}),seed=plain(t.ctx.evergreenSeedRows_());
  t.sheets['Evergreen Social Content']=new Sheet('Evergreen Social Content',libraryHeaders,libraryRows||seed);
  t.queue=new Sheet('Social Queue',headers);t.sheets['Social Queue']=t.queue;t.notes=notesFor(t.queue);
  Object.assign(t.properties,{SOCIAL_PUBLISHING_ENABLED:'true',BUFFER_API_KEY:'test-only',BUFFER_ORGANIZATION_ID:'org',
    BUFFER_FACEBOOK_CHANNEL_ID:'fb',BUFFER_INSTAGRAM_CHANNEL_ID:'ig'});
  if(history){const row=new Array(19).fill('');Object.assign(row,{0:'PRODUCT-HISTORY',7:'Post',12:'Queued',13:'historical-fb',14:'historical-ig',15:new Date(Date.now()-200*86400000)});t.queue.data.push(row);}
  t.snapshots=[];t.ctx.evergreenPublishSnapshot_=(item,plan)=>t.snapshots.push({item:plain(item),plan:plain(plan)});
  t.ctx.socialReadAirtable_=()=>{throw Error('Evergreen must not read Airtable or inventory');};
  t.ctx.socialResolveCloudinary_=plan=>({plan,cloud:'test-cloud',urls:plan.publicIds.map(id=>'https://res.cloudinary.com/test-cloud/image/upload/v1/'+id+'.jpg')});
  t.remote=[];t.inputs=[];
  t.ctx.bufferGraphql_=(_,query,vars)=>{
    if(query.startsWith('query InvictaReconcile'))return {posts:{edges:t.remote.map(node=>({node:plain(node)})),pageInfo:{hasNextPage:false}}};
    assert.match(query,/mutation CreatePost/);t.inputs.push(plain(vars.input));
    const input=vars.input,id='synthetic-'+(t.remote.length+1),post={id,channelId:input.channelId,text:input.text,status:'sent',createdAt:new Date().toISOString(),assets:input.assets.map(asset=>({source:asset.image.url}))};
    t.remote.push(post);t.onCreate?.(post);return {createPost:{post:{id}}};
  };
  t.prepare=()=>t.ctx.prepareEvergreenSocialQueue();
  t.row=id=>t.queue.data.find(row=>String(row[0]).startsWith('EVERGREEN|'+id+'|'));
  t.approve=id=>{t.row(id)[12]='Ready';};
  t.run=()=>t.ctx.sendReadySocialPostsToBuffer();
  return t;
}

await test('library has 20 complete educational drafts, six comparisons, four tips/brand items',()=>{
  const t=fixture(),rows=t.sheets['Evergreen Social Content'].data.slice(1);
  assert.equal(rows.length,30);assert.equal(rows.filter(r=>r[1]==='Educational').length,20);
  assert.equal(rows.filter(r=>r[1]==='Comparison').length,6);assert.equal(rows.filter(r=>['Tip','Brand'].includes(r[1])).length,4);
  for(const row of rows){assert.equal(row[8],'Enabled');assert.equal(row[9],120);assert.match(row[3],/Invicta Home Supply/);for(const slide of row.slice(4,8))graphicText(slide,30,14);graphicText(row[2],45,3);}
});
await test('manual initializer is additive, writes only the content source and refuses overwrite',()=>{
  const t=fixture();delete t.sheets['Evergreen Social Content'];
  const before=plain(t.catalog.data),queue=plain(t.queue.data),result=t.ctx.initializeEvergreenSocialLibrary();
  assert.equal(result.topics,30);assert.equal(result.queueRowsAdded,0);assert.deepEqual(plain(t.catalog.data),before);assert.deepEqual(plain(t.queue.data),queue);
  assert.throws(()=>t.ctx.initializeEvergreenSocialLibrary(),/exists/);
});
await test('preparation enters the existing 19-column queue as Draft, with no inventory identity',()=>{
  const t=fixture(),result=t.prepare();assert.equal(result.added,30);assert.equal(t.queue.data[0].length,19);
  const row=t.row('EDU-01');assert.equal(row[0],'EVERGREEN|EDU-01|1');assert.equal(row[7],'Educational');assert.equal(row[12],'Draft');
  assert.equal(t.inputs.length,0);assert.equal(t.snapshots.length,30);
});
await test('initializer makes only the new authored library readable and leaves inventory/queue formats alone',()=>{
  const t=fixture();delete t.sheets['Evergreen Social Content'];t.ctx.initializeEvergreenSocialLibrary();
  const formats=t.sheets['Evergreen Social Content'].formats;
  assert.ok(formats.some(f=>f.wrap===true&&f.r===1&&f.n===31&&f.m===11));
  assert.ok(formats.some(f=>f.frozenRows===1));assert.ok(formats.some(f=>f.column===4&&f.width===360));
  assert.equal(t.catalog.formats.length,0);assert.equal(t.queue.formats.length,0);
});
await test('legacy strict Post/Reel validation is extended only on the appended editorial cell before its value write',()=>{
  const t=fixture(),original=t.queue.getRange.bind(t.queue),calls=[],kind='VALUE_IN_LIST';
  t.ctx.SpreadsheetApp.DataValidationCriteria={VALUE_IN_LIST:kind};
  const rule={getCriteriaType:()=>kind,getCriteriaValues:()=>[['Post','Reel'],true],copy:()=>({
    requireValueInList(options,show){assert.deepEqual(plain(options),['Post','Reel','Educational','Comparison','Tip','Brand']);assert.equal(show,true);return this;},build:()=>({strict:true})})};
  t.queue.getRange=(r,c,n=1,m=1)=>Object.assign(original(r,c,n,m),c===8?{
    getDataValidation:()=>rule,setDataValidation:value=>{if(value===null)return;assert.equal(value.strict,true);calls.push([r,c]);}
  }:{});
  t.prepare();assert.equal(calls.length,30);assert.ok(calls.every(([r,c])=>r===2&&c===8));
  assert.equal(t.row('EDU-01')[7],'Educational');assert.equal(t.row('EDU-01')[12],'Draft');
});
await test('unexpected content validation fails closed without clearing validation or writing approval',()=>{
  const t=fixture(),original=t.queue.getRange.bind(t.queue);t.ctx.SpreadsheetApp.DataValidationCriteria={VALUE_IN_LIST:'LIST'};
  t.queue.getRange=(r,c,n=1,m=1)=>Object.assign(original(r,c,n,m),c===8?{getDataValidation:()=>({getCriteriaType:()=> 'CUSTOM_FORMULA'})}:{});
  assert.throws(t.prepare,/Unexpected queue content-type validation/);assert.equal(t.queue.getLastRow(),2);assert.equal(t.inputs.length,0);
});
await test('preparation is idempotent and never auto-approves; unchanged manual Ready stays Ready',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');const before=plain(t.queue.data);t.prepare();
  assert.deepEqual(plain(t.queue.data),before);assert.equal(t.row('EDU-02')[12],'Draft');
});
await test('edited content changes render/source fingerprints and returns previous Ready to Draft',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');const hash=t.row('EDU-01')[17];
  t.sheets['Evergreen Social Content'].data[1][5]='Updated explanation requiring owner review.';t.prepare();
  assert.notEqual(t.row('EDU-01')[17],hash);assert.equal(t.row('EDU-01')[12],'Draft');assert.equal(t.row('EDU-01')[0],'EVERGREEN|EDU-01|1');
});
await test('full eight-slot rotation is deterministic and one shared sequence',()=>{
  const t=fixture({history:false});t.prepare();const expected=['Product','Educational','Product','Comparison','Product','Educational','Product','Brand/Tip'];
  for(let step=0;step<8;step++){
    const product=new Array(19).fill('');Object.assign(product,{0:'P-'+step,7:'Post',12:'Ready'});t.queue.data.push(product);
    for(const row of t.queue.data.slice(1))if(row[0]?.startsWith('EVERGREEN|') && row[12] === 'Draft')row[12]='Ready';
    const rows=t.queue.data.slice(1),index=t.ctx.evergreenSelectReady_(t.queue,rows);assert.ok(index>=0);
    const picked=rows[index],type=picked[0].startsWith('EVERGREEN|')?picked[7]:'Product';
    assert.ok(expected[step]==='Brand/Tip'?['Brand','Tip'].includes(type):type===expected[step]);
    picked[12]='Queued';picked[13]='receipt-'+step;picked[15]=new Date(t.ctx.Date.now()-72*3600000);
  }
});
await test('product slot cannot publish educational content and does not auto-promote Drafts',()=>{
  const t=fixture({history:false});t.prepare();t.approve('EDU-01');assert.equal(t.run().queued,0);assert.equal(t.inputs.length,0);
});
await test('seven receipt-bearing rows start Brand/Tip and preserve the live historical offset through a full rotation',()=>{
  const t=fixture({history:false});t.queue.maxRows=1000;
  for(let i=0;i<7;i++){const r=new Array(19).fill('');Object.assign(r,{0:'HIST-'+i,7:'Post',12:i===6?'Skip':'Queued',13:'historical-'+i,15:new Date(t.ctx.Date.now()-200*86400000)});t.queue.data.push(r);}
  // The other seven owner holds have no receipt and must not advance rotation.
  for(let i=0;i<7;i++){const r=new Array(19).fill('');Object.assign(r,{0:'HELD-'+i,7:'Post',12:'Skip'});t.queue.data.push(r);}
  t.prepare();
  for(const row of t.queue.data.slice(1))if(String(row[0]).startsWith('EVERGREEN|'))row[12]='Ready';
  for(const [i,expected] of ['Brand/Tip','Product','Educational','Product','Comparison','Product','Educational','Product','Brand/Tip'].entries()){
    const product=new Array(19).fill('');Object.assign(product,{0:'P-FRESH-'+i,7:'Post',12:'Ready'});t.queue.data.push(product);
    const rows=t.queue.data.slice(1),chosen=rows[t.ctx.evergreenSelectReady_(t.queue,rows)];assert.ok(chosen);
    const type=String(chosen[0]).startsWith('EVERGREEN|')?chosen[7]:'Product';assert.ok(expected==='Brand/Tip'?['Brand','Tip'].includes(type):type===expected);
    chosen[12]='Queued';chosen[13]='new-receipt-'+i;chosen[15]=new Date(t.ctx.Date.now()-72*3600000);
  }
});
await test('a partially written first editorial row is repaired as Draft without duplicating its identity',()=>{
  const t=fixture(),row=new Array(19).fill('');Object.assign(row,{0:'EVERGREEN|EDU-01|1',1:'Wear layer: 6, 12 or 22 MIL?',2:'Evergreen',5:'Image',6:'https://invictahomesupply.com'});t.queue.data.push(row);
  const result=t.prepare();assert.equal(result.refreshed,1);assert.equal(result.added,29);assert.equal(t.queue.data.filter(r=>r[0]==='EVERGREEN|EDU-01|1').length,1);assert.equal(t.row('EDU-01')[12],'Draft');
});
await test('educational slot waits for manual approval, never falls back to product flooding',()=>{
  const t=fixture();t.prepare();assert.equal(t.run().queued,0);assert.equal(t.inputs.length,0);
});
await test('Ready educational carousel uses the SAME publisher and shareNow without inventory reads',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');assert.equal(t.run().queued,1,t.row('EDU-01')[18]);assert.equal(t.inputs.length,2);
  for(const input of t.inputs){assert.equal(input.mode,'shareNow');assert.equal(input.assets.length,4);assert.equal(input.saveToDraft,undefined);}
});
await test('global publishing flag blocks approved educational content',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');delete t.properties.SOCIAL_PUBLISHING_ENABLED;
  assert.equal(t.run().skipped,true);assert.equal(t.inputs.length,0);
});
await test('48-hour product receipt blocks educational post; exact boundary permits it',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');t.queue.data[1][15]=new Date(t.ctx.Date.now()-48*3600000+1);
  assert.equal(t.run().skipped,true);assert.equal(t.inputs.length,0);
  t.queue.data[1][15]=new Date(t.ctx.Date.now()-48*3600000);assert.equal(t.run().queued,1);
});
await test('educational receipt applies global cadence to a subsequent product (no double-post)',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');assert.equal(t.run().queued,1);
  const p=new Array(19).fill('');Object.assign(p,{0:'P-NEW',7:'Post',12:'Ready'});t.queue.data.push(p);
  assert.equal(t.run().skipped,true);assert.equal(t.inputs.length,2);
});
for(const [label,change,status] of [
  ['disabled source',t=>{t.sheets['Evergreen Social Content'].data[1][8]='Disabled';},null],
  ['missing source',t=>{t.sheets['Evergreen Social Content'].data.splice(1,1);},null],
  ['changed slides',t=>{t.sheets['Evergreen Social Content'].data[1][6]='Changed explanation';},'Draft'],
  ['changed caption',t=>{t.row('EDU-01')[9]='Unapproved edit';},'Draft'],
  ['changed manifest',t=>{const n=t.queue.data.indexOf(t.row('EDU-01'))+1,p=JSON.parse(t.notes.get(n+':5'));p.publicIds.reverse();t.notes.set(n+':5',JSON.stringify(p));},'Draft'],
  ['wrong content type',t=>{t.row('EDU-01')[7]='Comparison';},null]
])await test(label+' causes ZERO Buffer creates',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');change(t);t.run();assert.equal(t.inputs.length,0);if(status)assert.equal(t.row('EDU-01')[12],status);
});
await test('source edit between Cloudinary resolution and send-time check blocks all Buffer creation',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');const resolve=t.ctx.socialResolveCloudinary_;
  t.ctx.socialResolveCloudinary_=plan=>{const m=resolve(plan);t.sheets['Evergreen Social Content'].data[1][8]='Disabled';return m;};
  t.run();assert.equal(t.inputs.length,0);
});
await test('source disabled after Facebook acceptance blocks Instagram and preserves receipt/cadence',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');t.onCreate=()=>{t.sheets['Evergreen Social Content'].data[1][8]='Disabled';};
  t.run();assert.equal(t.inputs.length,1);assert.equal(t.row('EDU-01')[13],'synthetic-1');assert.equal(t.row('EDU-01')[14],'');
  assert.equal(t.ctx.hasSocialPostQueuedWithinHours_(48),true);
});
await test('a newly enabled unused topic after selection blocks reused content at the final source check',()=>{
  const base=fixture(),seed=plain(base.ctx.evergreenSeedRows_()),t=fixture({libraryRows:[seed[0]]});t.prepare();
  const old=t.row('EDU-01');old[12]='Queued';old[13]='old-fb';old[14]='old-ig';old[15]=new Date(t.ctx.Date.now()-120*86400000);
  for(let i=0;i<3;i++){const p=new Array(19).fill('');Object.assign(p,{0:'P-OLD-'+i,7:'Post',12:'Queued',13:'old-'+i,15:new Date(t.ctx.Date.now()-200*86400000)});t.queue.data.push(p);}
  t.prepare();const fresh=t.queue.data.find(r=>r[0]==='EVERGREEN|EDU-01|2');fresh[12]='Ready';
  const resolve=t.ctx.socialResolveCloudinary_;t.ctx.socialResolveCloudinary_=plan=>{const result=resolve(plan);t.sheets['Evergreen Social Content'].data.push(seed[1]);return result;};
  t.run();assert.equal(t.inputs.length,0);assert.equal(fresh[12],'Draft');assert.match(fresh[18],/Unused evergreen/);assert.equal(old[13],'old-fb');
});
await test('duplicate content occurrences cannot bypass content-level approval safeguards',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');const duplicate=t.row('EDU-01').slice();duplicate[0]='EVERGREEN|EDU-01|2';t.queue.data.push(duplicate);
  t.run();assert.equal(t.inputs.length,0);
});
await test('duplicate library ID and changed headers fail closed',()=>{
  const t=fixture(),sheet=t.sheets['Evergreen Social Content'];sheet.data.push(sheet.data[1].slice());assert.throws(t.prepare,/Duplicate/);
  sheet.data.pop();sheet.data[0][0]='PRODUCT KEY';assert.throws(t.prepare,/headers/);
});
await test('reuse cooldown respects exact 120-day boundary and unused topics take priority',()=>{
  const t=fixture(),item=t.ctx.evergreenReadLibrary_()[0],history=new Map([[item.id,{posted:true,last:t.ctx.Date.now()-120*86400000,maxOccurrence:1}]]);
  assert.equal(t.ctx.evergreenCanPrepare_(item,history,[item],t.ctx.Date.now()-1),false);
  assert.equal(t.ctx.evergreenCanPrepare_(item,history,[item],t.ctx.Date.now()),true);
  assert.equal(t.ctx.evergreenCanPrepare_(item,history,t.ctx.evergreenReadLibrary_(),t.ctx.Date.now()),false);
});
await test('unprovable historical date never permits reuse',()=>{
  const t=fixture();t.prepare();const row=t.row('EDU-01');row[13]='old-receipt';row[12]='Queued';
  const h=t.ctx.evergreenHistory_(t.queue,t.queue.data.slice(1));assert.equal(h.get('EDU-01').last,Infinity);
});
await test('intentional Skip is not silently requeued or counted as an available unused topic',()=>{
  const t=fixture();t.prepare();const row=t.row('EDU-01');row[12]='Skip';const before=t.queue.getLastRow();
  t.prepare();assert.equal(t.queue.getLastRow(),before);assert.equal(row[12],'Skip');
  const history=t.ctx.evergreenHistory_(t.queue,t.queue.data.slice(1));assert.equal(history.get('EDU-01').held,true);
  assert.equal(t.ctx.evergreenUnusedAvailable_([t.ctx.evergreenReadLibrary_()[0]],history),false);
});
await test('reused content keeps graphic identity but gets a new publication occurrence/idempotency key',()=>{
  const t=fixture(),item=t.ctx.evergreenReadLibrary_()[0],a=t.ctx.evergreenPlan_(item,1),b=t.ctx.evergreenPlan_(item,2);
  assert.deepEqual(plain(a.publicIds),plain(b.publicIds));assert.equal(a.renderHash,b.renderHash);assert.notEqual(a.sourceHash,b.sourceHash);assert.notEqual(a.productKey,b.productKey);
});
await test('known old occurrence receipts are excluded, unknown remote duplicates remain protected',()=>{
  const t=fixture(),payload={sourceType:'Educational',priorReceiptIds:['old'],channelId:'fb',text:'same',cloud:'test-cloud',mediaType:'Carousel',publicIds:['invicta-social/evergreen-v1/hash']};
  const post={id:'old',channelId:'fb',text:'same',assets:[{source:'https://res.cloudinary.com/test-cloud/image/upload/v1/invicta-social/evergreen-v1/hash.jpg'}]};
  assert.equal(t.ctx.matchingSocialBufferPosts_([post],payload).length,0);
  post.id='unknown';assert.equal(t.ctx.matchingSocialBufferPosts_([post],payload).length,1);
});
await test('historical receipt loss reconciles both channels without duplicate Buffer creates',()=>{
  const t=fixture();t.prepare();t.approve('EDU-01');assert.equal(t.run().queued,1);const row=t.row('EDU-01');row[13]='';row[14]='';row[12]='Ready';
  assert.equal(t.run().queued,1,row[18]);assert.equal(t.inputs.length,2);assert.equal(row[13],'synthetic-1');assert.equal(row[14],'synthetic-2');
});
await test('full intentional reuse appends a Draft occurrence, reuses graphics and creates only the new approved occurrence',()=>{
  const base=fixture(),t=fixture({libraryRows:[plain(base.ctx.evergreenSeedRows_())[0]]});t.prepare();
  const old=t.row('EDU-01');old[12]='Queued';old[13]='old-fb';old[14]='old-ig';old[15]=new Date(t.ctx.Date.now()-120*86400000);
  const plan=JSON.parse(t.notes.get('3:5'));
  for(const [id,channelId] of [['old-fb','fb'],['old-ig','ig']])t.remote.push({id,channelId,text:old[9],status:'sent',assets:plan.publicIds.map(id=>({source:'https://res.cloudinary.com/test-cloud/image/upload/v1/'+id+'.jpg'}))});
  // Five prior occurrences selects Educational, and all are outside the cadence window.
  for(let i=0;i<3;i++){const p=new Array(19).fill('');Object.assign(p,{0:'P-HIST-'+i,7:'Post',12:'Queued',13:'receipt-'+i,15:new Date(t.ctx.Date.now()-200*86400000)});t.queue.data.push(p);}
  const before=plain(old);t.prepare();const fresh=t.queue.data.find(row=>row[0]==='EVERGREEN|EDU-01|2');assert.ok(fresh);assert.equal(fresh[12],'Draft');
  assert.deepEqual(JSON.parse(t.notes.get((t.queue.data.indexOf(fresh)+1)+':5')).publicIds,plan.publicIds);
  fresh[12]='Ready';assert.equal(t.run().queued,1,fresh[18]);assert.equal(t.inputs.length,2);assert.deepEqual(plain(old),before);
  fresh[13]='';fresh[14]='';fresh[12]='Ready';assert.equal(t.run().queued,1,fresh[18]);assert.equal(t.inputs.length,2);
});
await test('product reconciliation ignores editorial source rows and leaves historical evidence untouched',()=>{
  const t=fixture();t.prepare();const before=plain(t.row('EDU-01')),note=t.notes.get('3:5');
  t.ctx.reconcileSocialQueue_(t.queue,new Map());assert.deepEqual(plain(t.row('EDU-01')),before);assert.equal(t.notes.get('3:5'),note);
});
await test('trigger installation remains opt-in and performs zero trigger operations while OFF',()=>{
  const t=fixture();delete t.properties.SOCIAL_PUBLISHING_ENABLED;let calls=0;t.ctx.ScriptApp={getProjectTriggers(){calls++;}};
  assert.throws(()=>t.ctx.setupDailySocialTriggers(),/explicit owner activation/);assert.equal(calls,0);
});
await test('Apps Script snapshot deduplication reuses verified raw identity with no upload',()=>{
  const t=createRuntime(),item=t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[0]),plan=t.ctx.evergreenPlan_(item,1);
  Object.assign(t.properties,{CLOUDINARY_CLOUD_NAME:'test-cloud',CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret'});
  t.ctx.Utilities.base64Encode=value=>Buffer.from(value).toString('base64');let calls=0;
  t.ctx.UrlFetchApp.fetch=(url,options)=>{calls++;assert.equal(options.method,undefined);assert.match(url,/resources\/raw\/upload/);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({public_id:'invicta-social/evergreen-sources-v1/'+plan.renderHash+'.json',resource_type:'raw',type:'upload',version:1,bytes:1000,context:{custom:{source_hash:plan.renderHash}}})};};
  t.ctx.evergreenPublishSnapshot_(item,plan);assert.equal(calls,1);
});
await test('Apps Script snapshot preparation errors redact remote response/credential text',()=>{
  const t=createRuntime();t.ctx.evergreenUploadSnapshot_=()=>{throw Error('SYNTHETIC_SECRET_DO_NOT_LOG');};
  assert.throws(()=>t.ctx.evergreenPublishSnapshot_({},{}),error=>!error.message.includes('SYNTHETIC_SECRET_DO_NOT_LOG')&&/preparation failed/.test(error.message));
});

const contract=await loadContract(),config={cloud:'test-cloud',key:'test-key',secret:'test-secret'};
const reference=fixture().ctx.evergreenReadLibrary_()[0],item=plain(reference),plan=plain(contract.evergreenPlan_(item,1));
function cloudFixture({cached=true}={}){
  const assets=new Map(),calls=[];
  const asset=(id,hash)=>({public_id:id,resource_type:'image',type:'upload',format:'jpg',version:1,width:1080,height:1350,bytes:20000,context:{custom:{source_hash:hash}}});
  if(cached)plan.publicIds.forEach((id,i)=>assets.set(id,asset(id,plan.hashes[i])));
  const snapshot={kind:'INVICTA_EVERGREEN_SOURCE_V1',templateVersion:'evergreen-v1',renderHash:plan.renderHash,
    content:{id:item.id,type:item.type,title:item.title,caption:item.caption,slides:item.slides,sources:item.sources}};
  const fetcher=async(url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    if(url.includes('/resources/raw/'))return Response.json({public_id:'invicta-social/evergreen-sources-v1/'+plan.renderHash+'.json',resource_type:'raw',type:'upload',version:1,bytes:1000,context:{custom:{source_hash:plan.renderHash}}});
    if(url.includes('res.cloudinary.com'))return Response.json(snapshot);
    if(options.method==='POST'){const id=options.body.get('public_id'),hash=options.body.get('context').split('=')[1];assert.equal(options.body.get('overwrite'),'false');assets.set(id,asset(id,hash));return Response.json({});}
    const id=decodeURIComponent(url.split('/upload/')[1].split('?')[0]);return assets.has(id)?Response.json(assets.get(id)):new Response('',{status:404});
  };
  return {fetcher,calls,assets,snapshot};
}
await test('worker reuses four unchanged Cloudinary assets with ZERO renderer/upload calls',async()=>{
  const cloud=cloudFixture(),result=await prepareEvergreen(item.id,plan.renderHash,{config,contract,fetcher:cloud.fetcher,renderer:()=>{throw Error('Must reuse');}});
  assert.equal(result.reused,4);assert.equal(result.prepared,0);assert.equal(cloud.calls.filter(c=>c.method==='POST').length,0);
});
await test('worker prepares ordered slides once and retry reuses all four immutable assets',async()=>{
  const cloud=cloudFixture({cached:false});let renders=0;
  const renderer=async(content,cwd)=>{renders++;assert.deepEqual(content.slides,reference.slides);const files=[];for(let i=0;i<4;i++){const file=path.join(cwd,'slide-'+i+'.jpg');await fs.writeFile(file,'fixture');files.push(file);}return files;};
  assert.equal((await prepareEvergreen(item.id,plan.renderHash,{config,contract,fetcher:cloud.fetcher,renderer})).prepared,4);
  assert.equal((await prepareEvergreen(item.id,plan.renderHash,{config,contract,fetcher:cloud.fetcher,renderer})).reused,4);
  assert.equal(renders,1);assert.equal(cloud.calls.filter(c=>c.method==='POST').length,4);
});
await test('snapshot content tampering and arbitrary identifiers fail before rendering/upload',async()=>{
  const cloud=cloudFixture();cloud.snapshot.content.slides[1]='Unapproved change';
  await assert.rejects(readEvergreenSnapshot(item.id,plan.renderHash,config,{contract,fetcher:cloud.fetcher}),/fingerprint/);
  await assert.rejects(readEvergreenSnapshot('../secret',plan.renderHash,config,{contract,fetcher:cloud.fetcher}),/Explicit/);
});
await test('graphics fail rather than truncate overflowing educational claims',()=>{
  assert.throws(()=>graphicText('word '.repeat(500),30,14),/does not fit/);assert.throws(()=>graphicText('x'.repeat(31),30,14),/too long/);
});
await test('renderer uses controlled text files/expansion=none and four 1080x1350 slides',async()=>{
  const cwd=await fs.mkdtemp(path.join(os.tmpdir(),'evergreen-test-'));
  try {
    const font=path.join(cwd,'fixture-font');await fs.writeFile(font,'fixture');const calls=[];
    const files=await renderEvergreen(item,cwd,{font,ffmpeg:args=>calls.push(args)});assert.equal(files.length,4);assert.equal(calls.length,4);
    for(const args of calls){assert.ok(args.includes('color=c=0xeef1ea:s=1080x1350'));assert.match(args[args.indexOf('-vf')+1],/expansion=none/);}
  } finally {await fs.rm(cwd,{recursive:true,force:true});}
});
await test('manual workflow uses read-only permissions, no schedule, no Buffer/Netlify credentials',async()=>{
  const workflow=await fs.readFile(new URL('../.github/workflows/social-media-prepare.yml',import.meta.url),'utf8');
  assert.match(workflow,/contents: read/);assert.match(workflow,/persist-credentials: false/);assert.doesNotMatch(workflow,/schedule:|BUFFER_API_KEY|NETLIFY_AUTH_TOKEN/);
  assert.match(workflow,/node scripts\/evergreen-media-worker.mjs "\$CONTENT_ID" "\$CONTENT_HASH"/);
});

await test('v2 uses a separate immutable namespace and the approved repository logo derivative',()=>{
  const t=fixture(),item=t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[0]),v1=t.ctx.evergreenPlan_(item,1),v2=t.ctx.evergreenV2Plan_(item,1);
  assert.equal(v2.templateVersion,'evergreen-v2');assert.equal(v2.type,'Image');assert.equal(v2.publicIds.length,1);
  assert.match(v2.publicIds[0],/invicta-social\/evergreen-v2\//);assert.notDeepEqual(v2.publicIds,v1.publicIds);
  assert.equal(v2.logoAsset,'assets/brand/derived/invicta-logo-blue-white-wordmark-transparent.png');
});
await test('v2 prompt reserves the logo and forbids AI branding',()=>{
  const t=fixture(),item=t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[0]),prompt=v2Prompt(item);
  assert.match(prompt,/logo-safe region/);assert.match(prompt,/Do not generate the Invicta logo/);assert.match(prompt,/Composition family/);
});
await test('v2 worker uploads one verified image and never touches Buffer',async()=>{
  const t=fixture(),item=t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[0]),plan=t.ctx.evergreenV2Plan_(item,1),config={cloud:'test-cloud',key:'test-key',secret:'test-secret',openai:'test-openai'};
  let uploaded=false,posts=0;const snapshot={kind:'INVICTA_EVERGREEN_SOURCE_V2',templateVersion:'evergreen-v2',renderHash:plan.renderHash,content:{id:item.id,type:item.type,title:item.title,caption:item.caption,slides:item.slides,sources:item.sources}};
  const asset=()=>({public_id:plan.publicIds[0],resource_type:'image',type:'upload',format:'jpg',version:1,width:1080,height:1350,bytes:20000,context:{custom:{source_hash:plan.hashes[0]}}});
  const fetcher=async(url,options={})=>{
    if(url.includes('/resources/raw/')) return Response.json({public_id:'invicta-social/evergreen-sources-v2/'+plan.renderHash+'.json',resource_type:'raw',type:'upload',version:1,bytes:1000,context:{custom:{source_hash:plan.renderHash}}});
    if(url.includes('res.cloudinary.com')&&!url.includes('/resources/')) return Response.json(snapshot);
    if(url.includes('/resources/image/')) return uploaded?Response.json(asset()):new Response('',{status:404});
    if(options.method==='POST'){uploaded=true;posts++;return Response.json({});}
    throw Error('unexpected request');
  };
  const result=await prepareEvergreenV2(item.id,plan.renderHash,{config,contract:t.ctx,fetcher,renderer:async()=>Buffer.from('background'),ffmpeg:args=>{fsSync.writeFileSync(args.at(-1),'final');}});
  assert.equal(result.prepared,1);assert.equal(posts,1);assert.equal(result.asset.width,1080);assert.equal(result.asset.height,1350);
});
await test('v2 Apps Script preparation creates one immutable snapshot and reuses it',()=>{
  const t=fixture();
  Object.assign(t.properties,{CLOUDINARY_CLOUD_NAME:'test-cloud',CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret'});
  t.ctx.Utilities.base64Encode=value=>Buffer.from(value).toString('base64');
  t.ctx.Utilities.newBlob=()=>({});
  let snapshotExists=false,uploads=0,lookups=0;
  t.ctx.UrlFetchApp.fetch=(url,options={})=>{
    if(url.includes('/resources/raw/')) {
      lookups++;
      return snapshotExists ? {getResponseCode:()=>200,getContentText:()=>JSON.stringify({
        public_id:'invicta-social/evergreen-sources-v2/'+t.ctx.evergreenV2Plan_(t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[26]),1).renderHash+'.json',
        resource_type:'raw',type:'upload',version:1,bytes:1000,context:{custom:{source_hash:t.ctx.evergreenV2Plan_(t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[26]),1).renderHash}}
      })} : {getResponseCode:()=>404,getContentText:()=>''};
    }
    if(options.method==='post') { uploads++;snapshotExists=true;return {getResponseCode:()=>200,getContentText:()=>''}; }
    throw Error('unexpected request');
  };
  const first=t.ctx.prepareEvergreenV2SocialQueue(['TIP-01']);
  assert.equal(first.prepared,1);assert.equal(t.row('TIP-01')[12],'Draft');assert.equal(uploads,1);
  const second=t.ctx.prepareEvergreenV2SocialQueue(['TIP-01']);
  assert.equal(second.prepared,1);assert.equal(uploads,1);assert.ok(lookups>=3);
});
await test('verified v2 media reconciles the matching Draft to Awaiting Approval only',()=>{
  const t=fixture();
  t.ctx.evergreenPublishSnapshotV2_=()=>{};
  t.ctx.prepareEvergreenV2SocialQueue(['TIP-01']);
  const row=t.row('TIP-01'),plan=JSON.parse(t.notesFor?'' : t.notes.get((t.queue.data.indexOf(row)+1)+':5'));
  const result=t.ctx.finalizeEvergreenV2Media('TIP-01',plan.renderHash);
  assert.equal(result.productKey,'EVERGREEN|TIP-01|1');assert.equal(result.status,'Awaiting Approval');
  assert.equal(row[12],'Awaiting Approval');
});
await test('v1 row before exact v2 row selects the exact v2 occurrence',()=>{
  const t=fixture({history:false});t.ctx.evergreenPublishSnapshotV2_=()=>{};
  t.ctx.prepareEvergreenV2SocialQueue(['TIP-01']);
  const v2=t.row('TIP-01'),plan=JSON.parse(t.notes.get((t.queue.data.indexOf(v2)+1)+':5'));
  const v1=v2.slice();v1[0]='EVERGREEN|TIP-01|1';v1[12]='Draft';t.queue.data.splice(1,0,v1);t.notes.set('2:5',JSON.stringify(t.ctx.evergreenPlan_(t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[26]),1)));t.notes.set((t.queue.data.indexOf(v2)+1)+':5',JSON.stringify(plan));
  const result=t.ctx.finalizeEvergreenV2Media('TIP-01',plan.renderHash);assert.equal(result.productKey,v2[0]);assert.equal(v1[12],'Draft');assert.equal(v2[12],'Awaiting Approval');
});
await test('content ID match with a different hash or v1 manifest is rejected and gets a new v2 occurrence',()=>{
  const t=fixture({history:false});t.ctx.evergreenPublishSnapshotV2_=()=>{};
  const item=t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[26]),v1=t.ctx.evergreenPlan_(item,1),row=new Array(19).fill('');Object.assign(row,{0:v1.productKey,1:item.title,5:'Carousel',7:item.type,9:item.caption,10:item.caption,12:'Draft',17:v1.sourceHash});t.queue.data.push(row);t.notes.set((t.queue.data.length)+':5',JSON.stringify(v1));
  const expected=t.ctx.evergreenV2Plan_(item,2),result=t.ctx.finalizeEvergreenV2Media('TIP-01',expected.renderHash);assert.equal(result.productKey,'EVERGREEN|TIP-01|2');assert.equal(row[12],'Draft');
});
await test('multiple exact v2 occurrences fail safely',()=>{
  const t=fixture({history:false});t.ctx.evergreenPublishSnapshotV2_=()=>{};t.ctx.prepareEvergreenV2SocialQueue(['TIP-01']);
  const row=t.row('TIP-01'),duplicate=row.slice();duplicate[0]='EVERGREEN|TIP-01|2';t.queue.data.push(duplicate);const plan=JSON.parse(t.notes.get((t.queue.data.indexOf(row)+1)+':5'));t.notes.set((t.queue.data.length)+':5',JSON.stringify(plan));
  assert.throws(()=>t.ctx.finalizeEvergreenV2Media('TIP-01',plan.renderHash),/Duplicate exact Evergreen v2/);assert.equal(row[12],'Draft');assert.equal(duplicate[12],'Draft');
});
await test('v2 reconciliation never auto-sets Ready and leaves v1 row unchanged',()=>{
  const t=fixture({history:false});t.ctx.evergreenPublishSnapshotV2_=()=>{};const old=new Array(19).fill('');Object.assign(old,{0:'EVERGREEN|TIP-01|1',7:'Tip',12:'Queued',13:'old-fb',15:new Date()});t.queue.data.push(old);
  const plan=t.ctx.evergreenV2Plan_(t.ctx.evergreenContent_(plain(t.ctx.evergreenSeedRows_())[26]),2),result=t.ctx.finalizeEvergreenV2Media('TIP-01',plan.renderHash);const fresh=t.queue.data.find(r=>r[0]===result.productKey);assert.equal(result.status,'Awaiting Approval');assert.equal(fresh[12],'Awaiting Approval');assert.equal(old[12],'Queued');assert.equal(old[13],'old-fb');
});
console.log(`${pass} passed, ${fail} failed`);if(fail)process.exitCode=1;

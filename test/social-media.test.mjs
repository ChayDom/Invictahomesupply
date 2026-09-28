import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRuntime,Sheet,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
const headers=['PRODUCT KEY','PRODUCT NAME','CATEGORY','PRICE','MEDIA URL','MEDIA TYPE','PRODUCT URL','CONTENT TYPE',
  'HOOK','FACEBOOK CAPTION','INSTAGRAM CAPTION','HASHTAGS','SOCIAL STATUS','FB BUFFER POST ID','IG BUFFER POST ID',
  'LAST POSTED AT','GENERATED AT','SOURCE HASH','ERROR'];
let pass=0,fail=0;
function test(name,fn){try{fn();pass++;console.log('ok - '+name);}catch(error){fail++;console.log('NOT OK - '+name);console.error(error);}}
function attachNotes(queue) {
  const notes=new Map(),range=queue.getRange.bind(queue);
  queue.getRange=(r,c,n=1,m=1)=>Object.assign(range(r,c,n,m),{
    getNote:()=>notes.get(r+':'+c)||'',setNote:value=>{notes.set(r+':'+c,value);return queue.getRange(r,c,n,m);}});
  return notes;
}
function fixture({photos=3,reels=false}={}) {
  const key='SYNTH-SOCIAL',t=createRuntime({key,quantity:10});
  Object.assign(t.properties,{BUFFER_API_KEY:'test-only',BUFFER_ORGANIZATION_ID:'org',BUFFER_FACEBOOK_CHANNEL_ID:'fb',BUFFER_INSTAGRAM_CHANNEL_ID:'ig',
    SOCIAL_PUBLISHING_ENABLED:'true',SOCIAL_REELS_ENABLED:String(reels)});
  const fields={'Product Key':key,Name:'Synthetic oak',Category:'Flooring',Price:1.5,'Unit Type':'Box',
    'Post to Website':true,Status:'In Stock','Quantity Available':10,'Card Spec 1':'20 MIL',
    Photos:Array.from({length:photos},(_,i)=>({id:'attPhoto'+i,type:'image/jpeg',width:1200,height:1600,
      url:'https://v5.airtableusercontent.com/photo'+i+'?signature=expires'}))};
  let reads=0; t.ctx.socialReadAirtable_=()=>{reads++;return [{id:'recTest',fields:plain(fields)}];};
  const source=t.ctx.readSocialSourceMap_(t.sheets['Website Export']).get(key);
  const plan=t.ctx.socialMediaPlan_(source,reels),media={plan,cloud:'test-cloud',
    urls:plan.publicIds.map(id=>'https://res.cloudinary.com/test-cloud/'+plan.resourceType+'/upload/v1/'+id+(reels?'.mp4':'.jpg'))};
  const values=[key,source.displayName,source.category,source.priceLabel,'','Image','https://example.com/product','Post',
    'Hook','FB caption','IG caption','#Test','Ready','','','','',t.ctx.buildSocialSourceHash_(source),''];
  if(reels){values[5]='Video';values[7]='Reel';}
  const queue=new Sheet('Social Queue',headers,[values]);t.sheets['Social Queue']=queue;
  const notes=attachNotes(queue); notes.set('2:5',JSON.stringify(plan));
  t.ctx.socialResolveCloudinary_=()=>media;
  const remote=[],inputs=[];
  t.ctx.bufferGraphql_=(_,query,vars)=>{
    if(query.startsWith('query InvictaReconcile')) return {posts:{edges:remote.map(node=>({node:plain(node)})),pageInfo:{hasNextPage:false}}};
    assert.match(query,/mutation CreatePost/);inputs.push(plain(vars.input));
    const input=vars.input,id='post-'+(remote.length+1);
    const post={id,channelId:input.channelId,text:input.text,status:input.saveToDraft?'draft':'sent',
      assets:input.assets.map(asset=>({source:(asset.image||asset.video).url}))};
    remote.push(post); t.onCreate?.(post); return {createPost:{post:{id}}};
  };
  return Object.assign(t,{key,fields,source,plan,media,queue,notes,remote,inputs,row:queue.data[1],
    run:()=>t.ctx.sendReadySocialPostsToBuffer(),getReads:()=>reads});
}

test('multi-photo sends ordered assets using shareNow to both channels',()=>{
  const t=fixture(); assert.equal(t.run().queued,1,t.row[18]);assert.equal(t.inputs.length,2);
  for(const input of t.inputs){assert.equal(input.mode,'shareNow');assert.equal(input.schedulingType,'automatic');
    assert.deepEqual(input.assets.map(a=>a.image.url),plain(t.media.urls));assert.equal(input.saveToDraft,undefined);}
  assert.equal(t.getReads()>=7,true);
});
test('approved Reel explicitly uses video assets and reel metadata for BOTH channels',()=>{
  const t=fixture({photos:4,reels:true});assert.equal(t.run().queued,1);
  assert.equal(t.inputs[0].metadata.facebook.type,'reel');assert.equal(t.inputs[1].metadata.instagram.type,'reel');
  assert.equal(t.inputs[0].assets[0].video.metadata,undefined);
  assert.equal(t.inputs[1].assets[0].video.metadata.thumbnailOffset,2000);
  for(const input of t.inputs){assert.equal(input.assets.length,1);assert.match(input.assets[0].video.url,/\.mp4$/);}
});
test('publishing disabled by default makes zero Buffer calls',()=>{
  const t=fixture();delete t.properties.SOCIAL_PUBLISHING_ENABLED;assert.equal(t.run().skipped,true);assert.equal(t.inputs.length,0);
  assert.throws(()=>t.ctx.createOrReconcileSocialPost_(t.queue,2,t.row.slice(),'test','fb','text',t.media,'facebook'),/disabled/);
});
test('disabled social trigger setup performs no trigger reads, deletions or installations',()=>{
  for(const enabled of [undefined,'false']) {
    const t=fixture();if(enabled===undefined)delete t.properties.SOCIAL_PUBLISHING_ENABLED;
    else t.properties.SOCIAL_PUBLISHING_ENABLED=enabled;
    let calls=0;t.ctx.ScriptApp={getProjectTriggers:()=>{calls++;return [];},deleteTrigger:()=>calls++,newTrigger:()=>calls++};
    assert.throws(()=>t.ctx.setupDailySocialTriggers(),/explicit owner activation/);
    assert.equal(calls,0);
  }
});
for(const [label,change] of [
  ['zero authoritative inventory',t=>t.setQuantity(0)],
  ['unknown authoritative inventory',t=>t.setQuantity('')],
  ['contradictory/missing source evidence',t=>{t.sheets['Inventory Source Evidence'].data[1][5]='';}],
  ['Airtable zero',t=>{t.fields['Quantity Available']=0;}],
  ['Airtable null',t=>{t.fields['Quantity Available']=null;}],
  ['Post to Website off',t=>{t.fields['Post to Website']=false;}],
  ['Airtable Reserved',t=>{t.fields.Status='Reserved';}],
  ['Airtable Draft',t=>{t.fields.Status='Draft';}],
  ['Airtable sold out',t=>{t.fields.Status='Sold Out';}],
  ['Airtable record missing',t=>{t.ctx.socialReadAirtable_=()=>[];}],
  ['catalog record removed',t=>{t.catalog.data.splice(1,1);}],
  ['catalog publication flag off',t=>{t.catalog.data[1][t.catalog.data[0].indexOf('POST TO WEBSITE')]='No';}]
]) test(label+' prevents all create calls and retires candidate',()=>{
  const t=fixture();change(t);t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Skip');
});
test('changed ordered photo identities require new approval, not a fallback',()=>{
  const t=fixture();t.fields.Photos.reverse();t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Draft');
});
test('replaced attachment requires new approval',()=>{
  const t=fixture();t.fields.Photos[0].id='attReplacement';t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Draft');
});
test('rotating Airtable URLs preserve source/operation identity and reuse approval',()=>{
  const t=fixture(),before=t.ctx.buildSocialSourceHash_(t.source);
  t.fields.Photos.forEach(p=>{p.url+='&rotated=yes';});assert.equal(t.run().queued,1);
  assert.equal(t.ctx.buildSocialSourceHash_(t.ctx.readSocialSourceMap_(t.sheets['Website Export']).get(t.key)),before);
});
test('missing Photos blocks even when stock/manual/reference URLs exist',()=>{
  const t=fixture();t.fields.Photos=[];t.fields['Reference Image URL']='https://example.com/reference';
  t.row[4]='https://example.com/manual';t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Needs Image');
});
test('malformed Photos fail closed',()=>{
  const t=fixture();t.fields.Photos[0].id='';t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Needs Image');
});
test('changed render facts invalidate approval',()=>{
  const t=fixture();t.fields['Card Spec 1']='12 MIL';t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Draft');
});
test('queue manifest tampering cannot select unrelated Cloudinary assets',()=>{
  const t=fixture();const edited=plain(t.plan);edited.publicIds[0]='unrelated';
  t.notes.set('2:5',JSON.stringify(edited));t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Draft');
});
test('manual media URL is never sent or used as fallback',()=>{
  const t=fixture();t.row[4]='https://example.com/not-product';assert.equal(t.run().queued,1);
  assert.ok(t.inputs.every(i=>i.assets.every(a=>a.image.url.startsWith('https://res.cloudinary.com/'))));
});
test('sold out during Cloudinary resolution produces zero Buffer creates',()=>{
  const t=fixture();t.ctx.socialResolveCloudinary_=()=>{t.setQuantity(0);return t.media;};
  t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Skip');
});
test('sold out during Buffer remote reconciliation produces zero create calls',()=>{
  const t=fixture(),read=t.ctx.readBufferPostsForReconciliation_;
  t.ctx.readBufferPostsForReconciliation_=(...args)=>{const result=read(...args);t.setQuantity(0);return result;};
  t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Skip');
});
test('photos change immediately after intent persistence blocks create and preserves journal',()=>{
  const t=fixture();t.queue.afterWrite=op=>{if(op.c===19)t.fields.Photos.reverse();};
  t.run();assert.equal(t.inputs.length,0);assert.equal(t.row[12],'Draft');assert.ok(t.notes.get('2:14'));
});
test('stock changes after Facebook acceptance preserves receipt, blocks Instagram and cadence survives Skip',()=>{
  const t=fixture();t.onCreate=()=>t.setQuantity(0);assert.equal(t.run().partial,1);assert.equal(t.inputs.length,1);
  assert.equal(t.row[13],'post-1');assert.equal(t.row[12],'Skip');assert.equal(t.ctx.hasSocialPostQueuedWithinHours_(48),true);
  assert.equal(JSON.parse(t.notes.get('2:14')).state,'ACKNOWLEDGED');
});
test('photo changes after first channel block second without losing receipt',()=>{
  const t=fixture();t.onCreate=()=>t.fields.Photos.reverse();t.run();
  assert.equal(t.inputs.length,1);assert.equal(t.row[13],'post-1');assert.equal(t.row[12],'Draft');
});
test('receipt identity uses ordered stable IDs and never signed delivery URLs',()=>{
  const t=fixture();t.run();const note=JSON.parse(t.notes.get('2:14'));
  assert.equal(note.kind,'INVICTA_BUFFER_INTENT_V2');assert.deepEqual(note.payload.photoIds,plain(t.plan.photoIds));
  assert.equal(JSON.stringify(note).includes('https://'),false);assert.equal(note.payload.mode,'shareNow');
});
test('cadence holds at less than 48 hours, allows exact 48-hour boundary even for Skip history',()=>{
  const t=fixture();t.row[12]='Skip';t.row[15]=new Date(t.ctx.Date.now()-48*3600000+1);
  assert.equal(t.ctx.hasSocialPostQueuedWithinHours_(48),true);
  t.row[15]=new Date(t.ctx.Date.now()-48*3600000);assert.equal(t.ctx.hasSocialPostQueuedWithinHours_(48),false);
});
test('missing Cloudinary config blocks all Buffer creates',()=>{
  const t=fixture();delete t.ctx.socialResolveCloudinary_; // restore actual contract by reloading file
  t.ctx.socialResolveCloudinary_=createRuntime().ctx.socialResolveCloudinary_;
  t.run();assert.equal(t.inputs.length,0);
});
test('duplicate Airtable key blocks sender',()=>{
  const t=fixture();t.ctx.socialReadAirtable_=()=>[{fields:t.fields},{fields:t.fields}];t.run();assert.equal(t.inputs.length,0);
});
test('duplicate Product Catalog key blocks sender',()=>{
  const t=fixture();t.catalog.data.push(t.catalog.data[1].slice());t.run();assert.equal(t.inputs.length,0);
});
test('strategy is mixed and deterministic, Reel opt-in does not make every product video',()=>{
  const t=fixture();
  for(const [count,reels,expected] of [[1,true,'Image'],[2,true,'Carousel'],[3,true,'Carousel'],[4,false,'Carousel'],[4,true,'Reel']]) {
    const source={...t.source,photos:Array.from({length:count},(_,i)=>({id:'att'+i}))};
    assert.equal(t.ctx.socialMediaPlan_(source,reels).type,expected);
  }
});
test('unusable/duplicate Photos never silently fall back',()=>{
  const t=fixture();
  assert.throws(()=>t.ctx.socialPhotos_({Photos:[t.fields.Photos[0],t.fields.Photos[0]]}),/Unusable/);
  assert.deepEqual(plain(t.ctx.socialPhotos_({'Reference Image URL':'https://example.com'})),[]);
});
test('all existing rows reconciled, absent/sold-out rows retired and old Ready loses approval',()=>{
  const t=fixture();t.notes.delete('2:5');t.row[4]='https://example.com/stock';t.queue.data.push(['ABSENT','','','','','','','','','','','','Ready']);
  t.ctx.reconcileSocialQueue_(t.queue,new Map([[t.key,t.source]]));
  assert.equal(t.row[12],'Draft');assert.equal(t.row[4],'');assert.equal(t.queue.data[2][12],'Skip');
});
test('same manifest preserves explicit Ready on subsequent preparation',()=>{
  const t=fixture();t.ctx.reconcileSocialQueue_(t.queue,new Map([[t.key,t.source]]));assert.equal(t.row[12],'Ready');
});
test('receipt/error/legacy evidence is preserved during reconciliation, never reset into new operation',()=>{
  const t=fixture();t.row[13]='old-fb';t.row[18]='Buffer send failed: historical error';t.row[12]='Ready';
  t.notes.set('2:14','old journal evidence');const before=t.row.slice();
  t.ctx.reconcileSocialQueue_(t.queue,new Map([[t.key,t.source]]));
  assert.equal(t.row[12],'Skip');for(const index of [4,9,10,13,14,17,18])assert.equal(t.row[index],before[index]);
  assert.equal(t.notes.get('2:14'),'old journal evidence');
});
for(const key of ['HD-1004669158','HD-1007846436']) test(key+' historical hold cannot publish or reset receipts',()=>{
  const t=fixture();t.row[0]=key;const source={...t.source,productKey:key};
  t.ctx.reconcileSocialQueue_(t.queue,new Map([[key,source]]));assert.equal(t.row[12],'Skip');assert.equal(t.inputs.length,0);
});
test('new physical row insertion retains one existing queue/schema, Draft not Ready',()=>{
  const t=fixture();t.queue.maxRows=2;const source={...t.source,productKey:'SYNTH-SECOND'};
  t.ctx.reconcileSocialQueue_(t.queue,new Map([[t.key,t.source],[source.productKey,source]]));
  assert.equal(t.queue.data[2][0],'SYNTH-SECOND');assert.equal(t.queue.data[2][12],'Draft');
  assert.equal(t.queue.data[2].length,19);assert.ok(t.notes.get('3:5'));assert.ok(t.queue.getMaxRows()>=3);
});
test('legacy V1 durable intents remain readable and untouched',()=>{
  const t=fixture(),payload={productKey:t.key,mediaUrl:'https://example.com/old'};
  const intent={kind:'INVICTA_BUFFER_INTENT_V1',payload,operationKey:t.ctx.socialOperationKey_(payload),
    rowFingerprint:'old',state:'PUBLISHING',startedAt:new Date(t.ctx.Date.now()).toISOString()};
  t.notes.set('2:14',JSON.stringify(intent));assert.deepEqual(plain(t.ctx.readSocialBufferIntent_(t.queue.getRange(2,14))),intent);
});
test('source implementation has no Stock Image/Reference Image fallback dependency',()=>{
  const file=fs.readFileSync(new URL('../Invicta Appscript Files/BufferSocialSync.js',import.meta.url),'utf8');
  assert.equal(file.includes('stockImageUrl'),false);assert.equal(file.includes('STOCK IMAGE URL'),false);
});
test('actual Airtable price precision is preserved in media facts',()=>{
  const t=fixture();t.fields.Price=1.955;
  assert.equal(t.ctx.socialRenderFacts_(t.fields).price,'$1.955 / sq ft');
});
test('Buffer transport, HTTP, malformed JSON and GraphQL failures redact remote secret text',()=>{
  const t=createRuntime(),hidden='DO-NOT-LOG-token-or-signed-url';
  for(const response of [()=>{throw Error(hidden);},
    ()=>({getResponseCode:()=>401,getContentText:()=>hidden}),
    ()=>({getResponseCode:()=>200,getContentText:()=>hidden}),
    ()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({errors:[{message:hidden}]})})]) {
    t.ctx.UrlFetchApp.fetch=response;
    assert.throws(()=>t.ctx.bufferGraphql_('secret-test','query',{}),error=>{
      assert.doesNotMatch(error.message,/DO-NOT-LOG|secret-test/);return /reconcile before retry/.test(error.message);
    });
  }
});
test('actual Cloudinary resolver verifies metadata and pins immutable public delivery version',()=>{
  const t=createRuntime();Object.assign(t.properties,{CLOUDINARY_CLOUD_NAME:'test-cloud',CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret'});
  t.ctx.Utilities.base64Encode=value=>Buffer.from(value).toString('base64');
  const id='invicta-social/photos-v1/testHash',plan={publicIds:[id],hashes:['hash'],resourceType:'image'};
  const asset={public_id:id,resource_type:'image',type:'upload',version:123,format:'jpg',bytes:10000,width:1080,height:1350,
    context:{custom:{source_hash:'hash'}}};
  t.ctx.UrlFetchApp.fetch=(url,options)=>{
    assert.match(url,/resources\/image\/upload\//);assert.equal(new URL(url).searchParams.get('media_metadata'),'true');assert.equal(options.method,'get');
    assert.equal(options.headers.Authorization,'Basic '+Buffer.from('test-key:test-secret').toString('base64'));
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify(asset)};
  };
  assert.deepEqual(plain(t.ctx.socialResolveCloudinary_(plan).urls),['https://res.cloudinary.com/test-cloud/image/upload/v123/'+id+'.jpg']);
  asset.context.custom.source_hash='wrong';assert.throws(()=>t.ctx.socialResolveCloudinary_(plan),/fingerprint/);
  t.ctx.UrlFetchApp.fetch=()=>{throw Error('DO-NOT-LOG-secret');};
  assert.throws(()=>t.ctx.socialResolveCloudinary_(plan),error=>error.message==='Cloudinary lookup failed; publishing blocked.');
});
console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;

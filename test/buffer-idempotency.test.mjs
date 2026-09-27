import assert from 'node:assert/strict';
import { createRuntime, Sheet, plain } from './fixtures/catalog-lifecycle-runtime.mjs';
let pass=0,fail=0;
function test(name,fn){try{fn();pass++;console.log('ok - '+name);}catch(e){fail++;console.log('NOT OK - '+name);console.error(e);}}
const headers=['PRODUCT KEY','PRODUCT NAME','CATEGORY','PRICE','MEDIA URL','MEDIA TYPE','PRODUCT URL','CONTENT TYPE',
  'HOOK','FACEBOOK CAPTION','INSTAGRAM CAPTION','HASHTAGS','SOCIAL STATUS','FB BUFFER POST ID','IG BUFFER POST ID',
  'LAST POSTED AT','GENERATED AT','SOURCE HASH','ERROR'];
function fixture(){
  const t=createRuntime({quantity:10});
  Object.assign(t.properties,{BUFFER_API_KEY:'test-only',BUFFER_ORGANIZATION_ID:'org',
    BUFFER_FACEBOOK_CHANNEL_ID:'fb',BUFFER_INSTAGRAM_CHANNEL_ID:'ig'});
  const source={productKey:'SYNTH-SOCIAL',displayName:'Synthetic oak',category:'Flooring',priceLabel:'$1.50/sq ft',
    description:'Synthetic',highlights:'Test only',stockImageUrl:'https://example.com/image.jpg',eligible:true};
  const values=['SYNTH-SOCIAL','Synthetic oak','Flooring','$1.50/sq ft',source.stockImageUrl,'Image',
    'https://example.com/product','Post','Hook','FB synthetic caption','IG synthetic caption','#Test','Ready',
    '','','','',t.ctx.buildSocialSourceHash_(source),''];
  const queue=new Sheet('Social Queue',headers,[values]);
  t.sheets['Social Queue']=queue;
  const notes=new Map(),range=queue.getRange.bind(queue);
  queue.getRange=(r,c,n=1,m=1)=>Object.assign(range(r,c,n,m),{
    getNote:()=>notes.get(r+':'+c)||'',setNote:v=>{notes.set(r+':'+c,v);return queue.getRange(r,c,n,m);}});
  t.ctx.readSocialSourceMap_=()=>new Map([[source.productKey,source]]);
  let held=false;
  t.ctx.LockService.getScriptLock=()=>({tryLock(){if(held)return false;held=true;return true;},releaseLock(){held=false;}});
  const remote=[],events=[];
  t.ctx.bufferGraphql_=(_,query,vars)=>{
    if(query.startsWith('query InvictaReconcile')){
      events.push('read');return {posts:{edges:remote.map(node=>({node:plain(node)})),pageInfo:{hasNextPage:false}}};
    }
    assert.match(query,/mutation CreatePost/);events.push('create');
    const input=vars.input,id='post-'+(remote.length+1);
    remote.push({id,text:input.text,channelId:input.channelId,status:'scheduled',createdAt:new Date().toISOString(),
      assets:[{source:input.assets[0].image.url}]});
    t.onCreate?.(remote.at(-1));
    return {createPost:{post:{id,dueAt:new Date().toISOString()}}};
  };
  return Object.assign(t,{queue,notes,remote,events,row:queue.data[1],run:()=>t.ctx.sendReadySocialPostsToBuffer(),
    resetReady(){queue.data[1][12]='Ready';}});
}
test('first publish persists durable channel intent before remote creation and queues both receipts',()=>{
  const t=fixture();t.onCreate=post=>{
    const note=JSON.parse(t.notes.get('2:'+(post.channelId==='fb'?14:15)));
    assert.equal(note.state,'PUBLISHING');assert.equal(t.row[12],'Error');
  };
  assert.equal(t.run().queued,1);assert.equal(t.remote.length,2);assert.equal(t.row[12],'Queued');
  assert.equal(t.row[13],'post-1');assert.equal(t.row[14],'post-2');
});
test('retry of successful/already published row creates nothing even if manually reset Ready',()=>{
  const t=fixture();t.run();t.run();t.resetReady();t.run();assert.equal(t.remote.length,2);
});
test('Buffer success plus local ID write failure reconciles without recreating successful channel',()=>{
  const t=fixture();let failOnce=true;
  t.queue.beforeWrite=op=>{if(op.c===14&&failOnce){failOnce=false;throw Error('Injected ID write failure');}};
  t.run();assert.equal(t.remote.length,1);assert.equal(t.row[13],'');assert.equal(t.row[12],'Error');
  t.resetReady();t.run();assert.equal(t.remote.filter(p=>p.channelId==='fb').length,1);
  assert.equal(t.row[13],'post-1');assert.equal(t.row[12],'Error'); // uncertain sibling requires review
});
test('lost acknowledgement / timeout after accepted create is reconciled, never duplicated',()=>{
  const t=fixture();let once=true;t.onCreate=()=>{if(once){once=false;throw Error('Ambiguous remote timeout');}};
  t.run();assert.equal(t.remote.length,1);assert.equal(JSON.parse(t.notes.get('2:14')).state,'PUBLISHING');
  t.resetReady();t.run();assert.equal(t.remote.length,1);assert.equal(t.row[13],'post-1');
});
test('crash after intent but before remote call does not assume absence proves failure',()=>{
  const t=fixture();t.ctx.createBufferImagePost_=()=>{throw Error('Process terminated before/inside transport');};
  t.run();assert.equal(t.events.filter(x=>x==='create').length,0);
  t.resetReady();t.run();assert.equal(t.events.filter(x=>x==='create').length,0);
  assert.match(t.row[18],/no provable remote match/);
});
test('overlapping execution cannot acquire ScriptLock or duplicate the row',()=>{
  const t=fixture();let checked=false;t.onCreate=()=>{if(!checked){checked=true;assert.throws(t.run,/active/);}};
  t.run();assert.equal(t.remote.length,2);
});
test('preflight remote match is reused instead of another create',()=>{
  const t=fixture();t.remote.push({id:'existing',channelId:'fb',text:'FB synthetic caption\n\n#Test',assets:[{source:t.row[4]}]});
  t.run();assert.equal(t.row[13],'existing');assert.equal(t.remote.filter(x=>x.channelId==='fb').length,1);
});
test('historical Buffer Error reset Ready is review-only when no matching remote post exists',()=>{
  const t=fixture();t.row[18]='Buffer send failed: Address unavailable';t.run();assert.equal(t.remote.length,0);
  assert.match(t.row[18],/manual review/);
});
test('edited content after intent and malformed journal fail safe',()=>{
  const t=fixture();t.ctx.createBufferImagePost_=()=>{throw Error('uncertain');};t.run();
  t.resetReady();t.row[9]='Edited caption';t.run();assert.equal(t.remote.length,0);
  assert.match(t.row[18],/differs from durable/);
  t.resetReady();t.notes.set('2:14','not JSON');t.run();assert.equal(t.remote.length,0);
});
test('changed approval during preflight blocks remote create',()=>{
  const t=fixture(),original=t.ctx.readBufferPostsForReconciliation_;
  t.ctx.readBufferPostsForReconciliation_=(...a)=>{const x=original(...a);t.row[12]='Skip';return x;};
  t.run();assert.equal(t.remote.length,0);
});
test('duplicate Product Key or multiple remote matches fail safe',()=>{
  const t=fixture();t.queue.data.push(t.row.slice());t.run();assert.equal(t.remote.length,0);
  const u=fixture();const p={id:'a',channelId:'fb',text:'FB synthetic caption\n\n#Test',assets:[{source:u.row[4]}]};
  u.remote.push(p,{...p,id:'b'});u.run();assert.equal(u.events.filter(x=>x==='create').length,0);
});
test('incomplete remote pagination fails closed with no create',()=>{
  const t=fixture();t.ctx.bufferGraphql_=()=>({posts:{edges:[],pageInfo:{hasNextPage:true,endCursor:'repeat'}}});
  t.run();assert.equal(t.remote.length,0);assert.match(t.row[18],/pagination/);
});
test('read-only production audit never changes queue or creates a post',()=>{
  const t=fixture(),before=plain(t.queue.data);const a=t.ctx.auditSocialBufferQueue();
  assert.equal(a.rows,1);assert.equal(a.ready.length,1);assert.deepEqual(plain(t.queue.data),before);
  assert.equal(t.queue.writes.length,0);assert.equal(t.notes.size,0);assert.equal(t.remote.length,0);
});
console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;

import assert from 'node:assert/strict';
import {createRuntime,row,catalogHeaders,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
let pass=0,fail=0;
function test(name,fn){try{fn();pass++;console.log('ok - '+name);}catch(e){fail++;console.log('NOT OK - '+name);console.error(e);}}
function fixture(){
  const t=createRuntime({quantity:10});t.properties.GEMINI_API_KEY='synthetic-mock-key';
  t.catalog.data.push(row(catalogHeaders,{'DISPLAY NAME':'SYNTHETIC connectivity fixture','PRODUCT KEY':'SYNTH-GEMINI',
    'PRODUCT ID':'SYNTH-GEMINI','SOURCE ITEM':'Disposable test item','POST TO WEBSITE':'No','ENRICHMENT STATUS':'PENDING'}));
  return t;
}
test('normal production enrichment performs one real-shaped Interactions request and review writeback only to fixture',()=>{
  const t=fixture(),before=plain(t.catalog.data[1]);let calls=0;
  t.ctx.UrlFetchApp.fetch=(url,opts)=>{
    calls++;assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(opts.headers['x-goog-api-key'],t.properties.GEMINI_API_KEY);
    const payload=JSON.parse(opts.payload);assert.equal(payload.model,'gemini-3.5-flash-lite');
    assert.deepEqual(payload.tools,[{type:'google_search'}]);assert.match(payload.input,/SYNTH-GEMINI/);
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({outputs:[{type:'text',text:JSON.stringify({
      match_status:'NOT_FOUND',confidence:'LOW',notes:'Synthetic item unverified',highlights:[],card_specs:[]})}]})};
  };
  const summary=t.ctx.runCatalogEnrichment();assert.equal(calls,1);assert.equal(summary.processed,1);
  assert.equal(summary.needsReview,1);assert.equal(summary.failed,0);assert.deepEqual(plain(t.catalog.data[1]),before);
  assert.equal(t.catalog.data[2][24],'NEEDS REVIEW');assert.equal(t.catalog.data[2][12],'No');
  assert.ok(t.catalog.writes.every(w=>w.r===3));assert.match(t.catalog.data[2][25],/Synthetic item unverified/);
  assert.equal(t.catalog.data[2][15],'');assert.equal(t.catalog.data[2][16],'');
});
test('invalid production Gemini credential fails fixture without replacement or real product writes',()=>{
  const t=fixture();let calls=0;t.ctx.UrlFetchApp.fetch=()=>{calls++;return {getResponseCode:()=>403,getContentText:()=>'{"error":{"message":"not authorized"}}'};};
  const summary=t.ctx.runCatalogEnrichment();assert.equal(calls,1);assert.equal(summary.failed,1);
  assert.equal(t.catalog.data[2][24],'FAILED');assert.ok(t.catalog.writes.every(w=>w.r===3));
});
test('missing Gemini property blocks before any fixture or real-product writes',()=>{
  const t=fixture();delete t.properties.GEMINI_API_KEY;assert.throws(()=>t.ctx.runCatalogEnrichment(),/Missing Script Property/);
  assert.equal(t.catalog.writes.length,0);
});
test('manual/native run still excludes historical legacy PENDING products',()=>{
  const t=fixture();t.catalog.data[2][26]='LEG-SYNTH';let calls=0;t.ctx.UrlFetchApp.fetch=()=>{calls++;throw Error('forbidden');};
  assert.equal(t.ctx.runCatalogEnrichment().processed,0);assert.equal(calls,0);assert.equal(t.catalog.writes.length,0);
});
console.log(`${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;

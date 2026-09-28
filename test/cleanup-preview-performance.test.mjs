import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createRuntime,catalogHeaders,inventoryHeaders,row,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
const D=864000000,now=Date.parse('2026-09-26T12:00:00Z');
let failures=0;
function test(name,fn){try{fn();console.log('ok - '+name);}catch(error){failures++;console.error('NOT OK - '+name+'\n'+error.stack);}}
function add(t,i,{quantity=5,since,remote=true,stock}={}){
  const sku=String(1001234567+i),id='HD-'+sku,key='PREVIEW-'+sku,item='Preview '+i;
  t.catalog.data.push(row(catalogHeaders,{'PRODUCT KEY':key,'PRODUCT ID':id,'RETAIL SKU':sku,RETAILER:'Home Depot','SOURCE ITEM':item,'DISPLAY NAME':item,'WEBSITE CATEGORY':'Flooring'}));
  t.inventory.data.push(row(inventoryHeaders,{'PRODUCT KEY':key,'PRODUCT ID':id,'RETAIL SKU':sku,RETAILER:'Home Depot',ITEM:item,'QUANTITY AVAILABLE':quantity}));
  t.sheets['Inventory Source Evidence'].data.push([item,'Home Depot',sku,id,20,quantity,'2026-09-01T00:00:00Z']);
  if(remote)t.records.push({id:'rec-'+i,fields:{'Product Key':key,'Quantity Available':quantity,
    'Available Sq Ft':stock===undefined?(typeof quantity==='number'?quantity*20:null):stock,
    'Sold Out Since':since===undefined?null:since}});
  return key;
}
function prepare(t){for(const sheet of Object.values(t.sheets))sheet.maxRows=Math.max(sheet.maxRows,sheet.data.length+1);}
function instrument(t){
  const counts={};for(const sheet of Object.values(t.sheets)){
    counts[sheet.name]={ranges:0,values:0,displays:0};
    const original=sheet.getRange.bind(sheet),count=counts[sheet.name];
    sheet.getRange=(...args)=>{count.ranges++;const range=original(...args),getValues=range.getValues,getDisplayValues=range.getDisplayValues;
      range.getValues=()=>{count.values++;return getValues();};
      range.getDisplayValues=()=>{count.displays++;return getDisplayValues();};return range;};
  }
  let airtable=0;const original=t.ctx.iwaFetchAll_;
  t.ctx.iwaFetchAll_=(token,fields)=>{airtable++;assert.deepEqual(plain(fields),['Product Key','Sold Out Since','Available Sq Ft','Quantity Available']);t.ctx.iwaRequest_.callCount_++;return original(token);};
  return {counts,get airtable(){return airtable;}};
}
// Frozen decision oracle from the pre-optimization scoped preview, exercised
// only in this test. The production apply implementation is not replaced.
function oldScopedDecision(t,key){
  const catalog=t.ctx.readSheetTable_(t.catalog,'PRODUCT KEY');
  t.ctx.readCatalogSourceEvidence_(t.ss);
  const records=t.ctx.iwaFetchAll_('test-only'),archive=t.ctx.readCatalogArchive_(t.ss);
  const archived=archive.rows.find(r=>t.ctx.normalizeKey_(r[archive.map['PRODUCT KEY']])===key);
  const state=archived?t.ctx.catalogText_(archived[archive.map['CLEANUP STATE']]):'';
  const snapshot=catalog.rows.find(r=>t.ctx.normalizeKey_(r[catalog.map['PRODUCT KEY']])===key);
  const get=h=>snapshot?snapshot[catalog.map[h]]:archived[archive.map[h]];
  if(state==='COMPLETE')return false;
  const quantity=t.ctx.catalogConfirmedStock_(t.ss,get).quantity;
  const record=records.find(r=>t.ctx.normalizeKey_(r.fields['Product Key'])===key),f=record?record.fields:{};
  const saved=archived?t.ctx.catalogArchiveValue_(archived[archive.map['SOLD OUT SINCE']]):undefined;
  const value=record?f['Sold Out Since']:saved,since=typeof value==='string'?Date.parse(value):NaN;
  if(state!=='AIRTABLE REMOVED'){
    const zero=quantity===0&&(record?t.ctx.catalogLifecycleStock_(get('WEBSITE CATEGORY')==='Flooring'?f['Available Sq Ft']:undefined,f['Quantity Available'])===0:state==='ARCHIVED');
    if(!zero||!Number.isFinite(since)||now<since+D)return false;
    if(!snapshot)throw Error('Catalog missing before verified Airtable removal.');
  }
  return true;
}
test('full preview of 1201 active products uses constant sheet reads, one bulk Airtable fetch and no writes',()=>{
  const t=createRuntime({now,quantity:0,since:new Date(now-D).toISOString()});t.properties.CATALOG_LIFECYCLE_CLEANUP_ENABLED='false';
  const expected=[t.records[0].fields['Product Key']];
  for(let i=1;i<=1200;i++){
    const config=i%4===0?{quantity:0,since:new Date(now-D).toISOString()}:
      i%4===1?{quantity:5,since:new Date(now-D).toISOString()}:
        i%4===2?{quantity:0,since:new Date(now-D+1).toISOString()}:
          {quantity:'',since:new Date(now-D).toISOString(),stock:null};
    const key=add(t,i,config);if(i%4===0||i%4===2)expected.push(key);
  }
  // Synthetic source universe larger than production; these unrelated rows
  // expose accidental O(catalog × source rows) matching in the preview path.
  for(let i=1201;i<=6000;i++)t.sheets['Inventory Source Evidence'].data.push(['Historical '+i,'Home Depot',String(2001234567+i),'HD-'+(2001234567+i),1,0,'2025-01-01']);
  prepare(t);const io=instrument(t),start=performance.now();const result=t.ctx.runSoldOutCatalogCleanup();const elapsed=performance.now()-start;
  assert.deepEqual(plain(result.eligible),expected);assert.equal(result.counts.active,1201);
  assert.equal(result.counts.confirmedPositive,300);assert.equal(result.counts.confirmedZero,601);assert.equal(result.counts.unknown,300);
  assert.equal(result.eligible.length,601);assert.equal(result.failures.length,0);assert.equal(result.metrics.complete,true);
  assert.equal(io.airtable,1);assert.equal(result.metrics.airtableApiCalls,1);
  assert.ok(io.counts['Inventory Source Evidence'].ranges<=6,JSON.stringify(io.counts));
  assert.ok(io.counts['Product Inventory'].ranges<=6,JSON.stringify(io.counts));
  assert.equal(t.catalog.writes.length,0);assert.equal(t.sheets['Inventory Source Evidence'].writes.length,0);
  assert.equal(t.events.length,0);assert.equal(t.sheets['Product Catalog Archive'],undefined);
  assert.ok(elapsed<10000,'synthetic preview should remain comfortably below 10s locally: '+elapsed);
});
test('scoped and unscoped immediate-retirement decisions agree; future expiry never holds Catalog active',()=>{
  const t=createRuntime({now,quantity:0,since:new Date(now-D).toISOString()});
  const recent=add(t,1,{quantity:0,since:new Date(now-D+1).toISOString()});
  const positive=add(t,2,{quantity:5,since:new Date(now-D).toISOString()});
  const unknown=add(t,3,{quantity:'',since:new Date(now-D).toISOString(),stock:null});
  const malformed=add(t,4,{quantity:0,since:'not-a-date'});
  const missing=add(t,5,{quantity:0,remote:false});
  prepare(t);const full=t.ctx.runSoldOutCatalogCleanup();
  assert.deepEqual(plain(full.eligible),['STAGE-ARCHIVE-UNIT',recent,missing]);
  for(const key of ['STAGE-ARCHIVE-UNIT',recent,positive,unknown,malformed,missing]){
    const scoped=t.ctx.runSoldOutCatalogCleanup({productKeys:[key]});
    assert.equal(scoped.eligible.includes(key),full.eligible.includes(key),key);
    assert.equal(scoped.failures.length,0);
  }
  assert.match(full.eligibleDetails.find(x=>x.productKey===recent).action,/ARCHIVE/);
  assert.match(full.rejected.find(x=>x.productKey===positive).reason,/POSITIVE/);
  assert.match(full.rejected.find(x=>x.productKey===unknown).reason,/UNKNOWN/);
  assert.match(full.rejected.find(x=>x.productKey===malformed).reason,/INVALID/);
  assert.match(full.eligibleDetails.find(x=>x.productKey===missing).remoteIdentity,/ABSENT/);
});
test('duplicate catalog and Airtable keys abort preview before any write',()=>{
  const catalog=createRuntime();catalog.catalog.data.push(catalog.catalog.data[1].slice());prepare(catalog);
  assert.throws(()=>catalog.ctx.runSoldOutCatalogCleanup(),/Unsafe catalog identities/);assert.equal(catalog.catalog.writes.length,0);
  const remote=createRuntime();remote.records.push(plain(remote.records[0]));
  assert.throws(()=>remote.ctx.runSoldOutCatalogCleanup(),/Unsafe Airtable Product Keys/);assert.equal(remote.events.length,0);
});
test('tampered archive hash fails closed before candidate reporting',()=>{
  const t=createRuntime(),headers=Object.keys(t.ctx.readCatalogArchive_(t.ss).map);
  const archive=t.ss.insertSheet('Product Catalog Archive');
  archive.data[0]=headers;
  archive.data[1]=row(archive.data[0],{'PRODUCT KEY':'STAGE-ARCHIVE-UNIT','CLEANUP STATE':'ARCHIVED','SNAPSHOT HASH':'tampered'});
  assert.throws(()=>t.ctx.runSoldOutCatalogCleanup(),/Snapshot Hash mismatch/);
  assert.equal(archive.writes.length,0);assert.equal(t.records.length,1);
});
test('projected Airtable pages request only fields needed for preview',()=>{
  const t=createRuntime();t.useRealNetwork();const suffixes=[];
  t.ctx.iwaRequest_=(token,method,suffix)=>{assert.equal(method,'get');suffixes.push(suffix);return suffixes.length===1?{records:[],offset:'next'}:{records:[]};};
  assert.equal(t.ctx.iwaFetchAll_('test-only',['Product Key','Sold Out Since','Available Sq Ft','Quantity Available']).length,0);
  assert.equal(suffixes.length,2);
  for(const suffix of suffixes){assert.match(suffix,/fields%5B%5D=Product%20Key/);assert.match(suffix,/fields%5B%5D=Sold%20Out%20Since/);assert.doesNotMatch(suffix,/Photos/);}
  assert.match(suffixes[1],/offset=next/);
});
test('indexed confirmation agrees with the original source matcher on identity/fallback/conflict cases',()=>{
  const cases=[
    t=>{},
    t=>t.setQuantity(4),
    t=>t.setQuantity(''),
    t=>{t.inventory.data[1][inventoryHeaders.indexOf('QUANTITY AVAILABLE')]=4;},
    t=>{t.sheets['Inventory Source Evidence'].data[1][3]='HD-CONFLICT';},
    t=>{t.catalog.data[1][catalogHeaders.indexOf('PRODUCT ID')]='HD-OLD-ID';},
    t=>{t.catalog.data[1][catalogHeaders.indexOf('PRODUCT ID')]='HD-OLD-ID';t.sheets['Inventory Source Evidence'].data.push(['Synthetic lifecycle oak','Home Depot','1001234568','HD-1001234568',20,0,'2026-09-01']);},
    t=>{t.sheets['Inventory Source Evidence'].data.push(['Synthetic lifecycle oak','Home Depot','1001234567','HD-1001234567',20,0,'2026-09-01']);}
  ];
  for(const mutate of cases){const t=createRuntime();mutate(t);prepare(t);
    const get=h=>t.catalog.data[1][catalogHeaders.indexOf(h)];
    const table=t.ctx.readCatalogSourceEvidence_(t.ss);
    const original=plain(t.ctx.catalogConfirmedStock_(t.ss,get,table));
    const indexed=plain(t.ctx.catalogConfirmedStock_(t.ss,get,t.ctx.indexCatalogSourceEvidence_(table)));
    assert.deepEqual(indexed,original);
  }
});
if(failures)process.exitCode=1;

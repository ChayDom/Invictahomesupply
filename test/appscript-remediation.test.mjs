import assert from 'node:assert/strict';
import {createRuntime,catalogHeaders,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
let failed=0;
function test(name,fn){try{fn();console.log('ok - '+name);}catch(e){failed++;console.error('NOT OK - '+name+'\n'+e.stack);}}
const source=t=>t.sheets['Inventory Source Evidence'];
const get=t=>h=>t.catalog.data[1][t.catalog.data[0].indexOf(h)];
const stock=t=>t.ctx.catalogConfirmedStock_(t.ss,get(t));
for(const [balance,expected] of [[4,'In Stock'],[0,'Sold Out'],['','Contact for Availability'],['invalid','Contact for Availability'],[null,'Contact for Availability'],[-1,'Contact for Availability']])test('source -> view -> Export -> Airtable balance '+balance,()=>{
  const t=createRuntime({quantity:4});source(t).data[1][5]=balance;
  if(balance!==4)t.inventory.data=[t.inventory.data[0]]; // disappeared positive view is NOT proof
  t.sync();assert.equal(t.records[0].fields.Status,expected);
  assert.equal(t.records[0].fields['Post to Website'],true);
  if(balance!==0)assert.equal(t.records[0].fields['Sold Out Since'],null);
  else {const stamp=t.records[0].fields['Sold Out Since'];t.events.length=0;t.sync();assert.equal(t.records[0].fields['Sold Out Since'],stamp);assert.equal(t.events.length,0);}
});
test('disappearance + missing source remains unknown and never cleans',()=>{
  const t=createRuntime();t.inventory.data=[t.inventory.data[0]];source(t).data=[source(t).data[0]];
  t.sync();assert.equal(stock(t).state,'UNKNOWN');assert.equal(t.records[0].fields.Status,'Contact for Availability');assert.equal(t.cleanup().removed,0);
});
for(const balances of [[0,3],[0,0],[0,''],[3,'bad']])test('multiple source balances '+JSON.stringify(balances),()=>{
  const t=createRuntime();const a=source(t).data[1].slice();source(t).data=[source(t).data[0],...balances.map(v=>{const r=a.slice();r[5]=v;return r;})];
  t.sync();assert.equal(stock(t).quantity,balances.every(v=>typeof v==='number')?balances.reduce((a,b)=>a+b):'');
  assert.equal(t.records[0].fields.Status,balances.includes('')||balances.includes('bad')?'Contact for Availability':balances[1]>0?'In Stock':'Sold Out');
});
test('source identity conflict never becomes zero',()=>{
  const t=createRuntime();source(t).data[1][3]='HD-CONFLICT';assert.equal(stock(t).state,'UNKNOWN');t.sync();assert.equal(t.records[0].fields['Sold Out Since'],null);
});
test('ambiguous corrected item match is unknown',()=>{
  const t=createRuntime();source(t).data[1][2]='newsku';source(t).data[1][3]='HD-NEWSKU';
  const other=source(t).data[1].slice();other[2]='different';other[3]='HD-DIFFERENT';source(t).data.push(other);
  assert.equal(stock(t).state,'UNKNOWN');
});
test('active SKU correction uses existing planner and retains key/record',()=>{
  const t=createRuntime({quantity:4});const key=get(t)('PRODUCT KEY'),id=t.records[0].id;
  for(const [h,v] of Object.entries({'RETAIL SKU':'1012206811','PRODUCT KEY':'HD-1012206811','PRODUCT ID':'HD-1012206811'}))t.inventory.data[1][t.inventory.data[0].indexOf(h)]=v;
  source(t).data[1][2]='1012206811';source(t).data[1][3]='HD-1012206811';
  assert.equal(t.ctx.runProductCatalogMaintenance().added,0);t.sync();assert.equal(t.records[0].id,id);assert.equal(get(t)('PRODUCT KEY'),key);assert.equal(t.records[0].fields.Status,'In Stock');
});
test('old source adjustment after COMPLETE is flagged, not new acquisition',()=>{
  const t=createRuntime();t.cleanup();t.setQuantity(3);source(t).data[1][6]='2026-09-01T00:00:00Z';
  assert.equal(t.ctx.runProductCatalogMaintenance().added,0);assert.equal(t.records.length,0);
});
test('later purchase after COMPLETE gets fresh identity/archive unchanged',()=>{
  const t=createRuntime();t.cleanup();const archived=JSON.stringify(t.ctx.readCatalogArchive_(t.ss).rows);t.setQuantity(3);
  assert.equal(t.ctx.runProductCatalogMaintenance().added,1);assert.match(t.catalog.data.find(r=>String(r[26]).startsWith('ACQ-'))[26],/^ACQ-/);assert.equal(JSON.stringify(t.ctx.readCatalogArchive_(t.ss).rows),archived);
});
for(const property of ['AIRTABLE_BASE_ID','AIRTABLE_ENVIRONMENT','AIRTABLE_WORKBOOK_ID'])test('missing '+property+' blocks sync/cleanup/transport before fetch',()=>{
  const t=createRuntime();delete t.properties[property];let calls=0;t.ctx.UrlFetchApp.fetch=()=>{calls++;throw Error('unexpected');};
  assert.throws(()=>t.sync(),/approved/);assert.throws(()=>t.cleanup(),/approved/);t.useRealNetwork();assert.throws(()=>t.ctx.iwaRequest_('fake','delete',''),/approved/);assert.equal(calls,0);assert.equal(t.events.length,0);
});
test('production base with staging workbook fails closed',()=>{
  const t=createRuntime();t.properties.AIRTABLE_BASE_ID='apptugvm4r5tm2OIt';assert.throws(()=>t.cleanup(),/approved/);assert.equal(t.events.length,0);
});
for(const position of [0,10,28])test('cleanup K position '+position+' and AIRTABLE REMOVED recovery',()=>{
  const t=createRuntime();const old=t.catalog.data[0],headers=old.filter(h=>h!=='AUTO BOX PRICE');headers.splice(position,0,'AUTO BOX PRICE');
  t.catalog.data=t.catalog.data.map(r=>headers.map(h=>r[old.indexOf(h)]));let once=true;
  t.catalog.beforeWrite=()=>{if(once){once=false;throw Error('interrupted catalog clear');}};
  assert.equal(t.cleanup().failures.length,1);assert.equal(t.records.length,0);assert.equal(t.cleanup().removed,1);
  assert.ok(t.catalog.writes.every(w=>w.m>0&&(w.c>position+1||w.c+w.m-1<position+1)));assert.ok(t.catalog.formula.startsWith('=MAP'));
});
test('valid COMPLETE archive Date/string normalization accepts identical hash',()=>{
  const t=createRuntime();t.cleanup();const a=t.ctx.readCatalogArchive_(t.ss);const hash=a.rows[0][a.map['SNAPSHOT HASH']];
  a.sheet.data[1][a.map['SOLD OUT SINCE']]=new t.ctx.Date(a.rows[0][a.map['SOLD OUT SINCE']]);
  assert.equal(t.ctx.readCatalogArchive_(t.ss).rows[0][a.map['SNAPSHOT HASH']],hash);
});
for(const [header,value] of [['PRODUCT ID','HD-TAMPER'],['RETAIL SKU','TAMPER'],['SOLD OUT SINCE','2020-01-01T00:00:00Z'],['SNAPSHOT HASH',''],['SNAPSHOT HASH','malformed']])test('COMPLETE archive tamper '+header+' '+value,()=>{
  const t=createRuntime();t.cleanup();const a=t.ctx.readCatalogArchive_(t.ss);a.sheet.data[1][a.map[header]]=value;
  assert.throws(()=>t.ctx.runProductCatalogMaintenance(),/Snapshot Hash/);assert.equal(t.records.length,0);
});
test('duplicate COMPLETE archive key fails closed',()=>{
  const t=createRuntime();t.cleanup();const a=t.ctx.readCatalogArchive_(t.ss);a.sheet.data.push(a.sheet.data[1].slice());assert.throws(()=>t.ctx.readCatalogArchive_(t.ss),/Duplicate archive/);
});
test('queue excludes cleared, legacy, terminal and archived rows',()=>{
  for(const [key,status] of [['','PENDING'],['LEG-HD-1','PENDING'],['LEGACY|HD|A','PENDING'],['HD-X','PROCESSING'],['HD-X','FAILED'],['HD-X','STANDARD'],['HD-X','ENRICHED - VERIFIED'],['HD-X','NEEDS REVIEW']]){
    const t=createRuntime();t.catalog.data[1][26]=key;t.catalog.data[1][24]=status;t.catalog.data[1][15]='';assert.equal(t.ctx.queueMissingCatalogEnrichment(),0);
  }
});
test('native Date readback of archive timestamps preserves write verification/retry',()=>{
  const t=createRuntime(),insert=t.ss.insertSheet;
  t.ss.insertSheet=name=>{const s=insert(name);if(name==='Product Catalog Archive')s.afterWrite=op=>{
    if(op.r===2)for(const h of ['SOLD OUT SINCE','ARCHIVED AT']){const c=s.data[0].indexOf(h);if(typeof s.data[1]?.[c]==='string')s.data[1][c]=new t.ctx.Date(s.data[1][c]);}
  };return s;};
  const request=t.ctx.iwaRequest_;t.ctx.iwaRequest_=()=>{throw Error('interrupted');};assert.equal(t.cleanup().failures.length,1);
  t.ctx.iwaRequest_=request;assert.equal(t.cleanup().removed,1);assert.equal(t.ctx.readCatalogArchive_(t.ss).rows[0][15],'COMPLETE');
});
test('zero source contradicted by positive inventory is not sold out',()=>{
  const t=createRuntime({quantity:4});source(t).data[1][5]=0;t.sync();assert.equal(t.records[0].fields.Status,'Contact for Availability');assert.equal(t.cleanup().removed,0);
});
if(failed)process.exit(1);

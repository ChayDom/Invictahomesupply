import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRuntime,Sheet,catalogHeaders,inventoryHeaders,exportHeaders,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
const D=864000000,now=Date.parse('2026-09-26T12:00:00Z');
let failed=0;
function test(name,fn){try{fn();console.log('ok - '+name);}catch(e){failed++;console.error('NOT OK - '+name+'\n'+e.stack);}}
const active=t=>t.catalog.data.slice(1).filter(r=>r[catalogHeaders.indexOf('PRODUCT KEY')]);
const archive=t=>t.ctx.readCatalogArchive_(t.ss);
const state=t=>{const a=archive(t);return a.rows[0]?.[a.map['CLEANUP STATE']];};
const changeArchive=(t,h,v)=>{const a=archive(t);a.sheet.data[1][a.map[h]]=v;};
for(const offset of [-1,0,1])test('cleanup exact ten-day boundary '+offset+' ms',()=>{
  const t=createRuntime({now,since:new Date(now-D-offset).toISOString()});
  const s=t.cleanup();assert.equal(s.removed,offset<0?0:1);assert.equal(s.failures.length,0);
  assert.equal(active(t).length,offset<0?1:0);assert.equal(t.records.length,offset<0?1:0);
});
for(const quantity of [null,undefined,'',-1,NaN,Infinity,5])test('unknown/positive source never archived: '+String(quantity),()=>{
  const t=createRuntime();t.setQuantity(quantity);assert.equal(t.cleanup().removed,0);
  assert.equal(archive(t).rows.length,0);assert.equal(t.records.length,1);assert.equal(active(t).length,1);
});
for(const since of [null,'','invalid'])test('missing/invalid timestamp never deleted: '+String(since),()=>{
  const t=createRuntime({since});assert.equal(t.cleanup().removed,0);assert.equal(archive(t).rows.length,0);
});
test('archive verified before Airtable, catalog cleared last, history/K2/schema unchanged',()=>{
  const t=createRuntime();const history=JSON.stringify(t.inventory.data),backup=JSON.stringify(t.sheets['Product Catalog Backup 2026-09-26'].data),formula=t.catalog.formula;
  const request=t.ctx.iwaRequest_;
  t.ctx.iwaRequest_=(...args)=>{
    if(args[1]==='delete'){assert.equal(state(t),'ARCHIVED');assert.equal(active(t).length,1);}
    return request(...args);
  };
  t.catalog.beforeWrite=()=>{assert.equal(t.records.length,0);assert.equal(state(t),'AIRTABLE REMOVED');};
  assert.equal(t.cleanup().removed,1);assert.equal(state(t),'COMPLETE');assert.equal(archive(t).rows.length,1);
  assert.equal(t.catalog.formula,formula);assert.equal(t.catalog.getLastColumn(),29);
  assert.equal(JSON.stringify(t.inventory.data),history);assert.equal(JSON.stringify(t.sheets['Product Catalog Backup 2026-09-26'].data),backup);
  assert.equal(t.inventory.writes.length,0);t.refreshExport();assert.equal(t.sheets['Website Export'].data.length,1);
});
test('preview and default disabled apply do not write',()=>{
  const t=createRuntime();assert.equal(t.ctx.runSoldOutCatalogCleanup().eligible.length,1);
  assert.equal(t.catalog.writes.length,0);assert.equal(archive(t).rows.length,0);
  delete t.properties.CATALOG_LIFECYCLE_CLEANUP_ENABLED;
  assert.throws(()=>t.cleanup(),/disabled/);assert.equal(t.records.length,1);
});
test('archive write failure retains both active records and retries',()=>{
  const t=createRuntime();const headers=plain(t.ctx.readCatalogArchive_(t.ss).map);
  const a=t.ss.insertSheet('Product Catalog Archive');a.data[0]=Object.keys(headers);
  a.beforeWrite=()=>{throw Error('archive unavailable');};
  assert.equal(t.cleanup().failures.length,1);assert.equal(t.records.length,1);assert.equal(active(t).length,1);
  a.beforeWrite=()=>{};assert.equal(t.cleanup().removed,1);
});
test('Airtable delete failure retains catalog and one retriable archive',()=>{
  const t=createRuntime(),request=t.ctx.iwaRequest_;
  t.ctx.iwaRequest_=(...a)=>{if(a[1]==='delete')throw Error('network failure');return request(...a);};
  assert.equal(t.cleanup().failures.length,1);assert.equal(active(t).length,1);assert.equal(t.records.length,1);
  assert.equal(state(t),'ARCHIVED');t.ctx.iwaRequest_=request;assert.equal(t.cleanup().removed,1);assert.equal(archive(t).rows.length,1);
});
test('successful remote deletion with failed acknowledgement resumes without recreation',()=>{
  const t=createRuntime(),request=t.ctx.iwaRequest_;let once=true;
  t.ctx.iwaRequest_=(...a)=>{const result=request(...a);if(a[1]==='delete'&&once){once=false;throw Error('connection lost after delete');}return result;};
  assert.equal(t.cleanup().failures.length,1);assert.equal(t.records.length,0);assert.equal(active(t).length,1);
  t.sync();assert.equal(t.records.length,0,'intervening sync must not resurrect deleted key');
  assert.equal(t.cleanup().removed,1);assert.equal(state(t),'COMPLETE');assert.equal(archive(t).rows.length,1);
});
test('catalog clear failure and partial clear safely resume',()=>{
  const t=createRuntime();let once=true;
  t.catalog.beforeWrite=op=>{if(op.c===12&&once){once=false;throw Error('second clear failed');}};
  assert.equal(t.cleanup().failures.length,1);assert.equal(t.records.length,0);assert.equal(state(t),'AIRTABLE REMOVED');
  assert.equal(t.cleanup().removed,1);assert.equal(state(t),'COMPLETE');
});
test('crash after catalog clearing resumes journal-only completion',()=>{
  const t=createRuntime();
  const original=t.ctx.setCatalogArchiveState_;
  t.ctx.setCatalogArchiveState_=(...args)=>{if(args[2]==='COMPLETE')throw Error('state acknowledgement interrupted');return original(...args);};
  assert.equal(t.cleanup().failures.length,1);assert.equal(active(t).length,0);assert.equal(state(t),'AIRTABLE REMOVED');
  t.ctx.setCatalogArchiveState_=original;assert.equal(t.cleanup().removed,1);assert.equal(state(t),'COMPLETE');
});
test('corrupted archive blocks retry deletion',()=>{
  const t=createRuntime(),request=t.ctx.iwaRequest_;t.ctx.iwaRequest_=()=>{throw Error('stop');};t.cleanup();
  changeArchive(t,'DISPLAY NAME','tampered');t.ctx.iwaRequest_=request;
  assert.throws(()=>t.cleanup(),/Snapshot Hash/);assert.equal(active(t).length,1);assert.equal(t.records.length,1);
});
test('duplicate cleanup and maintenance are idempotent and do not resurrect history',()=>{
  const t=createRuntime();t.cleanup();const before=JSON.stringify(archive(t).rows);
  assert.equal(t.cleanup().removed,0);assert.equal(t.ctx.runProductCatalogMaintenance().added,0);
  assert.equal(active(t).length,0);assert.equal(JSON.stringify(archive(t).rows),before);
});
test('restock before cleanup preserves key/record and clears timer',()=>{
  const t=createRuntime({since:new Date(now-D+1).toISOString()});const id=t.records[0].id,key=t.records[0].fields['Product Key'];
  assert.equal(t.cleanup().removed,0);t.setQuantity(4);t.sync();
  assert.equal(t.records[0].id,id);assert.equal(t.records[0].fields['Product Key'],key);
  assert.equal(t.records[0].fields['Sold Out Since'],null);assert.equal(t.records[0].fields.Status,'In Stock');
  assert.equal(t.ctx.runProductCatalogMaintenance().added,0);assert.equal(active(t).length,1);
});
test('unknown inventory clears timer and never starts or advances lifecycle',()=>{
  const t=createRuntime();t.setQuantity('');t.sync();assert.equal(t.records[0].fields['Sold Out Since'],null);
  assert.equal(t.records[0].fields.Status,'Contact for Availability');assert.equal(t.cleanup().removed,0);
});
test('cancelled delete attempt can restock then start a genuinely new zero interval',()=>{
  const t=createRuntime(),request=t.ctx.iwaRequest_;t.ctx.iwaRequest_=()=>{throw Error('stop');};t.cleanup();
  t.ctx.iwaRequest_=request;t.setQuantity(2);t.sync();t.cleanup();assert.equal(state(t),'CANCELLED');
  t.setQuantity(0);t.sync();const since=t.records[0].fields['Sold Out Since'];assert.equal(t.cleanup().removed,0);
  t.setClock(Date.parse(since)+D);assert.equal(t.cleanup().removed,1);assert.equal(archive(t).rows.length,1);
});
test('repurchase gets new permanent key/current ID/PENDING, never resurrects archived key',()=>{
  const t=createRuntime();t.cleanup();const before=JSON.stringify(archive(t).rows);t.setQuantity(3);
  assert.equal(t.ctx.runProductCatalogMaintenance().added,1);const c=active(t)[0];
  assert.match(c[catalogHeaders.indexOf('PRODUCT KEY')],/^ACQ-/);
  assert.equal(c[catalogHeaders.indexOf('PRODUCT ID')],'HD-1001234567');assert.equal(c[catalogHeaders.indexOf('ENRICHMENT STATUS')],'PENDING');
  assert.equal(t.ctx.isCatalogRowEligibleForEnrichment_(c,t.ctx.getCatalogColumns_(t.catalog)),true);
  assert.equal(JSON.stringify(archive(t).rows),before);assert.equal(t.ctx.runProductCatalogMaintenance().added,0);
  c[catalogHeaders.indexOf('POST TO WEBSITE')]='Yes';c[catalogHeaders.indexOf('SELL PRICE ($/SQ FT OR EACH)')]=1.5;
  c[catalogHeaders.indexOf('SQ FT PER UNIT')]=20;t.refreshExport();
  assert.equal(t.sheets['Website Export'].data[1][exportHeaders.indexOf('AVAILABLE SQ FT')],60);
  t.ctx.syncWebsiteExportToAirtable({});assert.equal(t.records.length,1);assert.notEqual(t.records[0].id,'rec-synthetic');
  assert.equal(t.records[0].fields['Product Key'],c[catalogHeaders.indexOf('PRODUCT KEY')]);assert.equal(t.records[0].fields['Date Added'],'2026-09-26');
});
test('active SKU correction preserves Product Key and same Airtable record',()=>{
  const t=createRuntime({quantity:3});
  for(const [h,v] of Object.entries({'RETAIL SKU':'1012206811','PRODUCT KEY':'HD-1012206811','PRODUCT ID':'HD-1012206811'}))t.inventory.data[1][inventoryHeaders.indexOf(h)]=v;
  assert.equal(t.ctx.runProductCatalogMaintenance().added,0);assert.equal(active(t)[0][catalogHeaders.indexOf('PRODUCT KEY')],'STAGE-ARCHIVE-UNIT');
  assert.equal(active(t)[0][catalogHeaders.indexOf('PRODUCT ID')],'HD-1012206811');t.sync();assert.equal(t.records[0].id,'rec-synthetic');
});
test('archived stale export cannot republish Airtable or enter Social Queue',()=>{
  const t=createRuntime(),old=plain(t.sheets['Website Export'].data);t.cleanup();
  old[1][exportHeaders.indexOf('IN STOCK')]=true;t.sheets['Website Export'].data=old;
  t.ctx.syncWebsiteExportToAirtable({});assert.equal(t.records.length,0);
  assert.equal(t.ctx.readSocialSourceMap_(t.sheets['Website Export']).size,0);
});
test('non-flooring zero gets same retention and controlled cleanup',()=>{
  const t=createRuntime({category:'Tools'});t.sync();assert.equal(t.records[0].fields.Status,'Sold Out');
  assert.equal(t.cleanup().removed,1);
});
test('Website Export formula preserves unknown/zero, requires active ID/key, derives acquisition pack coverage',()=>{
  const formula=fs.readFileSync(new URL('./fixtures/website-export-lifecycle.formula',import.meta.url),'utf8');
  assert.doesNotMatch(formula,/'Product Inventory'!I2:I>0/);
  assert.match(formula,/keys,FILTER\('Product Catalog'!AA2:AA/);
  assert.match(formula,/'Product Catalog'!AA2:AA<>""/);
  assert.match(formula,/ARRAYFORMULA\(IF\(ISNUMBER\('Lifecycle Inventory'!C:C\)/);
  assert.match(formula,/avail,MAP\(qty,pack/);
  assert.doesNotMatch(formula,/'Product Inventory'!J:J/);
  assert.match(formula,/XLOOKUP\(k,'Product Catalog'!AA:AA,column/);
  const t=createRuntime();assert.equal(t.sheets['Website Export'].data.length,2);
  t.setQuantity('');assert.equal(t.sheets['Website Export'].data.length,2);
  assert.equal(t.sheets['Website Export'].data[1][exportHeaders.indexOf('AVAILABLE SQ FT')],'');
});
test('archived product never consumes a Gemini request',()=>{
  const t=createRuntime();t.cleanup();t.properties.GEMINI_API_KEY='test-only';
  const s=t.ctx.runCatalogEnrichment();assert.equal(s.processed,0);
});
test('archive missing identity or malformed state fails closed before maintenance',()=>{
  const t=createRuntime();t.cleanup();changeArchive(t,'PRODUCT KEY','');
  assert.throws(()=>t.ctx.runProductCatalogMaintenance(),/Archive row missing/);
  const other=createRuntime();other.cleanup();changeArchive(other,'CLEANUP STATE','BROKEN');
  assert.throws(()=>other.ctx.runProductCatalogMaintenance(),/Invalid archive cleanup state/);
});
if(failed)process.exit(1);

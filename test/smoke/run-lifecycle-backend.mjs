// Explicit opt-in. Actual repository Apps Script + real isolated Airtable,
// with a durable local workbook model (NOT a bound Google Apps Script run).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRuntime,catalogHeaders,plain} from '../fixtures/catalog-lifecycle-runtime.mjs';

if(!process.argv.includes('--apply-staging'))throw Error('Requires explicit --apply-staging');
if(process.env.AIRTABLE_BASE_ID!=='appLzUBCXBMzrgVx1'||!process.env.AIRTABLE_TOKEN)throw Error('Isolated staging credentials required');
const out=path.resolve(process.env.LIFECYCLE_OUTPUT||'outputs/lifecycle-backend');fs.mkdirSync(out,{recursive:true});
const resumed=process.argv.includes('--resume');
const prior=resumed?JSON.parse(fs.readFileSync(path.join(out,'results.json'),'utf8')):null;
const key=prior?.key||'STAGE-ARCHIVE-LIVE-'+crypto.randomUUID().toUpperCase(),allowedKeys=[key],now=Date.now(),D=864000000;
const t=createRuntime({key,quantity:4,remote:false,now});
if(resumed){
  const snapshot=JSON.parse(fs.readFileSync(path.join(out,'isolated-workbook.json'),'utf8'));
  for(const [name,saved] of Object.entries(snapshot)) {
    const sheet=t.sheets[name]||t.ss.insertSheet(name);sheet.data=saved.data;sheet.formula=saved.formula;
  }
}
t.properties.AIRTABLE_TOKEN=process.env.AIRTABLE_TOKEN;t.properties.AIRTABLE_BASE_ID=process.env.AIRTABLE_BASE_ID;
t.useRealNetwork();
t.ctx.Utilities.sleep=ms=>{if(ms>10000)throw Error('Test clock produced unsafe transport wait');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);};
t.ctx.UrlFetchApp.fetch=(url,options)=>{
  const worker=process.env.LIFECYCLE_RPC_DIR?'./airtable-connector-worker.mjs':'./airtable-staging-worker.mjs';
  const child=spawnSync(process.execPath,[fileURLToPath(new URL(worker,import.meta.url))],{
    input:JSON.stringify({url,options,allowedKeys}),encoding:'utf8',timeout:60000});
  if(child.status!==0)throw Error('Staging-only transport failed (secret output withheld)');
  const result=JSON.parse(child.stdout);return {getResponseCode:()=>result.code,getContentText:()=>result.body,getAllHeaders:()=>result.headers};
};
const records=()=>t.ctx.iwaFetchAll_(t.properties.AIRTABLE_TOKEN);
const product=k=>records().find(r=>r.fields['Product Key']===k);
const initial=records().filter(r=>r.fields['Product Key']!==key),report=prior||{started:new Date().toISOString(),scope:'actual Apps Script in VM + real staging Airtable + isolated local workbook model',base:process.env.AIRTABLE_BASE_ID,key,checks:[],recordIds:[]};
const persist=()=>{
  fs.writeFileSync(path.join(out,'isolated-workbook.json'),JSON.stringify(Object.fromEntries(Object.entries(t.sheets).map(([n,s])=>[n,{data:s.data,formula:s.formula}])),null,2));
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));
};
const insert=t.ss.insertSheet;t.ss.insertSheet=n=>{const s=insert(n);s.afterWrite=persist;return s;};t.catalog.afterWrite=persist;
if(t.sheets['Product Catalog Archive'])t.sheets['Product Catalog Archive'].afterWrite=persist;
const check=(name,fn)=>{fn();report.checks.push({name,status:'PASS'});console.log('PASS '+name);persist();};
const sync=()=>{const s=t.sync();assert.equal(s.rejected,0);return product(key);};
const history=JSON.stringify(t.inventory.data),backup=JSON.stringify(t.sheets['Product Catalog Backup 2026-09-26'].data),k2=t.catalog.formula;
let id,since,newKey;
if(!resumed){
check('A positive inventory/new publication',()=>{const p=sync();id=p.id;report.recordIds.push(id);assert.equal(p.fields.Status,'In Stock');assert.equal(p.fields['Quantity Available'],4);assert.ok(!p.fields['Sold Out Since']);});
check('L active SKU correction retains key and Airtable ID',()=>{
  const im=t.ctx.buildHeaderMap_(t.inventory.data[0]);t.inventory.data[1][im['RETAIL SKU']]='1012206811';
  t.inventory.data[1][im['PRODUCT ID']]='HD-1012206811';t.inventory.data[1][im['PRODUCT KEY']]='HD-1012206811';
  assert.equal(t.ctx.runProductCatalogMaintenance().added,0);assert.equal(sync().id,id);
  assert.equal(t.catalog.data[1][catalogHeaders.indexOf('PRODUCT KEY')],key);
});
check('B first confirmed zero observation stamps once',()=>{t.setQuantity(0);const p=sync();since=p.fields['Sold Out Since'];assert.equal(Date.parse(since),now);assert.equal(p.fields.Status,'Sold Out');});
check('C repeated zero does not refresh timestamp',()=>{t.setClock(now+1000);assert.equal(sync().fields['Sold Out Since'],since);});
check('D less than ten days retains active record',()=>{t.setClock(Date.parse(since)+D-1);assert.equal(t.cleanup().removed,0);assert.equal(product(key).id,id);});
check('I restock retains identity and clears timer',()=>{t.setQuantity(3);const p=sync();assert.equal(p.id,id);assert.ok(!p.fields['Sold Out Since']);assert.equal(p.fields.Status,'In Stock');});
check('K unknown clears timer and cannot archive',()=>{t.setQuantity('');const p=sync();assert.equal(p.fields.Status,'Contact for Availability');assert.ok(!p.fields['Sold Out Since']);assert.equal(t.cleanup().removed,0);});
check('restart confirmed zero timer (no historical backdating)',()=>{t.setClock(Date.now());t.setQuantity(0);since=sync().fields['Sold Out Since'];});
}else{
  id=report.recordIds[0];const a=t.ctx.readCatalogArchive_(t.ss);since=a.rows[0][a.map['SOLD OUT SINCE']];
  check('interrupted transport retained active catalog/Airtable and durable verified archive',()=>{
    assert.equal(product(key).id,id);t.ctx.verifyCatalogArchive_(a,key);
    assert.ok(t.catalog.data.some(r=>r[catalogHeaders.indexOf('PRODUCT KEY')]===key));
  });
}
check('E/F/G/H exact boundary archives before real Airtable deletion/catalog clear',()=>{
  t.setClock(Date.parse(since)+D);const s=t.cleanup();assert.equal(s.failures.length,0);assert.equal(s.removed,1);
  assert.equal(product(key),undefined);assert.equal(t.ctx.readCatalogArchive_(t.ss).rows.length,1);
  assert.ok(!t.catalog.data.slice(1).some(r=>r[catalogHeaders.indexOf('PRODUCT KEY')]===key));
  t.refreshExport();assert.equal(t.sheets['Website Export'].data.length,1);
});
check('duplicate cleanup and maintenance do not resurrect',()=>{assert.equal(t.cleanup().removed,0);assert.equal(t.ctx.runProductCatalogMaintenance().added,0);});
check('J same-SKU repurchase creates new permanent key/PENDING/new Airtable ID',()=>{
  const archived=JSON.stringify(t.ctx.readCatalogArchive_(t.ss).rows);t.setQuantity(2);assert.equal(t.ctx.runProductCatalogMaintenance().added,1);
  const c=t.catalog.data.find(r=>String(r[catalogHeaders.indexOf('PRODUCT KEY')]).startsWith('ACQ-'));newKey=c[catalogHeaders.indexOf('PRODUCT KEY')];
  assert.notEqual(newKey,key);assert.equal(c[catalogHeaders.indexOf('PRODUCT ID')],'HD-1012206811');
  assert.equal(c[catalogHeaders.indexOf('ENRICHMENT STATUS')],'PENDING');allowedKeys.push(newKey);
  assert.equal(JSON.stringify(t.ctx.readCatalogArchive_(t.ss).rows),archived);
  // Manual approval/material data in the isolated fixture only. No Gemini run.
  c[catalogHeaders.indexOf('POST TO WEBSITE')]='Yes';c[catalogHeaders.indexOf('SQ FT PER UNIT')]=20;
  c[catalogHeaders.indexOf('SELL PRICE ($/SQ FT OR EACH)')]=1.5;t.refreshExport();
  t.setClock(Date.now());t.ctx.syncWebsiteExportToAirtable({productKeys:[newKey]});
  const p=product(newKey);assert.notEqual(p.id,id);assert.ok(!p.fields['Sold Out Since']);report.recordIds.push(p.id);
  assert.equal(p.fields['Available Sq Ft'],40);report.newKey=newKey;
});
check('synthetic repurchase cleaned through same archive transaction',()=>{
  t.setQuantity(0);t.refreshExport();t.ctx.syncWebsiteExportToAirtable({productKeys:[newKey]});
  const p=product(newKey);t.setClock(Date.parse(p.fields['Sold Out Since'])+D);
  const s=t.ctx.runSoldOutCatalogCleanup({apply:true,productKeys:[newKey]});assert.equal(s.failures.length,0);assert.equal(s.removed,1);
  assert.equal(product(newKey),undefined);assert.equal(t.ctx.readCatalogArchive_(t.ss).rows.length,2);
});
check('initial ten staging fixtures unchanged; history/K2 retained',()=>{
  assert.deepEqual(records(),initial);assert.equal(t.inventory.writes.length,0);
  assert.equal(JSON.stringify(t.sheets['Product Catalog Backup 2026-09-26'].data),backup);assert.equal(t.catalog.formula,k2);
  // The source fixture was deliberately changed for SKU/quantity; source history
  // columns, source sheets and historical backup were never written by scripts.
  assert.equal(t.inventory.data[1][6],20);assert.equal(t.inventory.data[1][10],1);
});
report.finished=new Date().toISOString();persist();console.log('Staging acceptance complete; only two newly-created synthetic records removed after durable archival.');

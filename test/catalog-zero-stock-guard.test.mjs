import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRuntime, catalogHeaders, exportHeaders, plain} from './fixtures/catalog-lifecycle-runtime.mjs';
let failed=0;
const test=(name,fn)=>{try{fn();console.log('ok - '+name);}catch(e){failed++;console.error('NOT OK - '+name+'\n'+e.stack);}};
const get=(t,h)=>t.catalog.data[1][t.catalog.data[0].indexOf(h)];
const set=(t,h,v)=>{t.catalog.data[1][t.catalog.data[0].indexOf(h)]=v;};
const fresh=opts=>{const t=createRuntime({since:'2026-09-25T12:00:00Z',...opts});t.properties.CATALOG_LIFECYCLE_CLEANUP_ENABLED='false';return t;};

test('Kobalt LOW-4913885 Buy 1 Balance 0: only Yes -> No, no K/identity/history writes',()=>{
  const t=fresh({key:'LOW-4913885',category:'Tools'});
  const identity={'RETAILER':"Lowe's",'RETAIL SKU':'4913885','PRODUCT ID':'LOW-4913885','SOURCE ITEM':'Kobalt regression fixture'};
  for(const [h,v] of Object.entries(identity))set(t,h,v);
  t.inventory.data=[t.inventory.data[0]]; // Zero products disappear from positive inventory.
  t.sheets['Inventory Source Evidence'].data[1]=['Kobalt regression fixture',"Lowe's",'4913885','LOW-4913885',1,0,'2026-09-01'];
  const before=plain(t.catalog.data),formula=t.catalog.formula,source=JSON.stringify(t.sheets['Inventory Source Evidence'].data);
  const result=t.ctx.runProductCatalogMaintenance();
  assert.equal(result.updated,1);assert.equal(result.added,0);assert.equal(get(t,'POST TO WEBSITE'),'No');
  before[1][catalogHeaders.indexOf('POST TO WEBSITE')]='No';assert.deepEqual(plain(t.catalog.data),before);
  assert.deepEqual(t.catalog.writes.map(w=>[w.r,w.c,w.method,w.values]),[[2,13,'setValue',[['No']]]]);
  assert.equal(t.catalog.formula,formula);assert.equal(JSON.stringify(t.sheets['Inventory Source Evidence'].data),source);
  t.sync();assert.equal(t.sheets['Website Export'].data[1][exportHeaders.indexOf('QUANTITY AVAILABLE')],0);
  assert.equal(t.sheets['Website Export'].data[1][exportHeaders.indexOf('IN STOCK')],false);
  assert.equal(t.records[0].fields['Post to Website'],false);assert.equal(t.records[0].fields.Status,'Sold Out');
  assert.equal(t.ctx.readSocialSourceMap_(t.sheets['Website Export']).get('LOW-4913885').eligible,false);
  assert.match(fs.readFileSync(new URL('../netlify/functions/inventory.mts',import.meta.url),'utf8'),/Post to Website/);
  assert.equal(t.ctx.runProductCatalogMaintenance().updated,0);
});
test('positive owner No remains No; no unpublished Airtable record is created',()=>{
  const t=fresh({quantity:4,remote:false});set(t,'POST TO WEBSITE','No');
  assert.equal(t.ctx.runProductCatalogMaintenance().updated,0);t.sync();
  assert.equal(get(t,'POST TO WEBSITE'),'No');assert.equal(t.records.length,0);assert.equal(t.events.length,0);
});
test('zero -> restock leaves owner No, same record/key, clears timer; owner alone republishes',()=>{
  const t=fresh();t.ctx.runProductCatalogMaintenance();t.sync();const id=t.records[0].id,key=get(t,'PRODUCT KEY');
  t.setQuantity(4);t.ctx.runProductCatalogMaintenance();t.sync();
  assert.equal(get(t,'POST TO WEBSITE'),'No');assert.equal(t.records[0].fields['Post to Website'],false);
  assert.equal(t.records[0].fields.Status,'In Stock');assert.equal(t.records[0].fields['Sold Out Since'],null);
  assert.equal(t.records[0].id,id);assert.equal(get(t,'PRODUCT KEY'),key);
  set(t,'POST TO WEBSITE','Yes');t.ctx.runProductCatalogMaintenance();t.sync();assert.equal(t.records[0].fields['Post to Website'],true);
});
for(const balance of ['',null,-1,NaN])test('unknown '+String(balance)+' retains owner permission and cannot delete',()=>{
  const t=fresh();t.setQuantity(balance);t.properties.CATALOG_LIFECYCLE_CLEANUP_ENABLED='true';
  t.ctx.runProductCatalogMaintenance();assert.equal(get(t,'POST TO WEBSITE'),'Yes');
  assert.equal(t.records.length,1);assert.equal(t.ctx.readCatalogArchive_(t.ss).rows.length,0);
  assert.ok(!t.events.includes('delete'));
});
test('positive inventory contradicting zero fails closed without correcting permission',()=>{
  const t=fresh({quantity:4});t.sheets['Inventory Source Evidence'].data[1][5]=0;
  t.ctx.runProductCatalogMaintenance();assert.equal(get(t,'POST TO WEBSITE'),'Yes');assert.equal(t.catalog.writes.length,0);
});
test('unpublished zero gets first timestamp once, expires after full ten days, no curated remote field changes',()=>{
  const t=fresh();t.records[0].fields['Sold Out Since']=null;t.records[0].fields['Quantity Available']=3;
  t.records[0].fields['Available Sq Ft']=60;t.records[0].fields.Photos=[{id:'owner-photo'}];
  t.ctx.runProductCatalogMaintenance();t.sync();const since=t.records[0].fields['Sold Out Since'];
  assert.equal(t.records[0].fields['Quantity Available'],0);assert.deepEqual(t.records[0].fields.Photos,[{id:'owner-photo'}]);
  t.setClock(Date.parse(since)+864000000-1);t.events.length=0;t.sync();assert.equal(t.events.length,0);
  assert.equal(t.records[0].fields['Sold Out Since'],since);assert.equal(t.ctx.runSoldOutCatalogCleanup().eligible.length,1,'zero is immediately eligible for Catalog retirement');
  t.properties.CATALOG_LIFECYCLE_CLEANUP_ENABLED='true';t.setClock(Date.parse(since)+864000000);
  assert.equal(t.cleanup().removed,1);assert.equal(t.records.length,0);
});
test('unpublished uncertainty clears timer, remains off and cannot be deleted',()=>{
  const t=fresh();t.ctx.runProductCatalogMaintenance();t.sync();t.setQuantity('');t.sync();
  assert.equal(t.records[0].fields['Post to Website'],false);assert.equal(t.records[0].fields['Sold Out Since'],null);
  assert.equal(t.records[0].fields.Status,'Contact for Availability');
  t.properties.CATALOG_LIFECYCLE_CLEANUP_ENABLED='true';assert.equal(t.cleanup().removed,0);
});
test('guard resolves projected corrected SKU with reordered headers; never changes permanent key',()=>{
  const t=fresh();const old=t.catalog.data[0],headers=old.slice().reverse();
  t.catalog.data=t.catalog.data.map(r=>headers.map(h=>r[old.indexOf(h)]));
  for(const h of ['PRODUCT KEY','PRODUCT ID','RETAIL SKU'])t.inventory.data[1][t.inventory.data[0].indexOf(h)]=h==='RETAIL SKU'?'1012206811':'HD-1012206811';
  t.sheets['Inventory Source Evidence'].data[1][2]='1012206811';t.sheets['Inventory Source Evidence'].data[1][3]='HD-1012206811';
  t.ctx.runProductCatalogMaintenance();assert.equal(get(t,'POST TO WEBSITE'),'No');assert.equal(get(t,'PRODUCT KEY'),'STAGE-ARCHIVE-UNIT');
  assert.equal(get(t,'PRODUCT ID'),'HD-1012206811');
});
test('enabled apply scans many ineligible products with one source read and zero remote rechecks',()=>{
  const t=fresh({quantity:4});t.properties.CATALOG_LIFECYCLE_CLEANUP_ENABLED='true';
  for(let i=0;i<100;i++){const r=t.catalog.data[1].slice();r[26]='EXTRA-'+i;r[27]='HD-'+(2000000000+i);r[2]=String(2000000000+i);r[28]='unmatched '+i;t.catalog.data.push(r);}
  t.catalog.maxRows=200;let reads=0,fetches=0;const read=t.ctx.readCatalogSourceEvidence_,fetch=t.ctx.iwaFetchAll_;
  t.ctx.readCatalogSourceEvidence_=(...a)=>{reads++;return read(...a);};t.ctx.iwaFetchAll_=(...a)=>{fetches++;return fetch(...a);};
  const s=t.ctx.cleanupSoldOutCatalogLocked_({apply:true});assert.equal(s.eligible.length,0);assert.equal(s.failures.length,0);
  assert.equal(reads,1);assert.equal(fetches,1);assert.equal(t.catalog.writes.length,0);
});
test('cached initial source never replaces fresh pre-delete recheck after archive',()=>{
  const t=createRuntime();const verify=t.ctx.verifyCatalogArchive_;
  t.ctx.verifyCatalogArchive_=(...a)=>{verify(...a);t.sheets['Inventory Source Evidence'].data[1][5]=2;};
  const s=t.cleanup();assert.equal(s.archived,1);assert.equal(s.removed,0);assert.equal(s.failures.length,1);
  assert.equal(t.records.length,1);assert.ok(!t.events.includes('delete'));assert.equal(get(t,'PRODUCT KEY'),'STAGE-ARCHIVE-UNIT');
});
if(failed)process.exit(1);

import assert from 'node:assert/strict';
import {createRuntime,Sheet,catalogHeaders,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
const now=Date.parse('2026-09-26T12:00:00Z'),D=864000000,key='STAGE-ARCHIVE-UNIT';
let failed=0;
function test(name,fn){try{fn();console.log('ok - '+name);}catch(e){failed++;console.error('NOT OK - '+name+'\n'+e.stack);}}
const active=t=>t.catalog.data.slice(1).filter(r=>r[t.catalog.data[0].indexOf('PRODUCT KEY')]);
const archive=t=>t.ctx.readCatalogArchive_(t.ss);
const state=t=>{const a=archive(t);return a.rows[0][a.map['CLEANUP STATE']];};
const source=t=>t.sheets['Inventory Source Evidence'];
function recent(options={}){return createRuntime({now,since:new Date(now).toISOString(),...options});}
function social(t){
  const statuses=['Draft','Ready','Needs Image','Needs Copy','Error','Queued'];
  const rows=statuses.map(status=>{const r=new Array(19).fill('');r[0]=key;r[12]=status;
    if(status==='Queued'){r[13]='fb-history';r[14]='ig-history';r[15]='2026-01-01';r[18]='immutable receipt';}return r;});
  const evergreen=new Array(19).fill('');evergreen[0]='EVERGREEN|EDU-001';evergreen[12]='Draft';rows.push(evergreen);
  const queue=t.sheets['Social Queue']=new Sheet('Social Queue',Array.from({length:19},(_,i)=>'column-'+i),rows);
  queue.getRange(7,14).setNote('immutable operation journal');return queue;
}
function purchase(t){t.setClock(now+4*86400000);t.acquire(3);assert.equal(t.ctx.runProductCatalogMaintenance().added,1);
  const b=active(t)[0];assert.match(b[26],/^ACQ-/);assert.equal(b[12],'');return b;}

test('controlled maintenance preserves owner SKU/identity when source SKU is missing; explicit corrections still apply',()=>{
  const t=recent(),row=t.catalog.data[1],map=t.ctx.readSheetTable_(t.catalog,'PRODUCT KEY').map;
  row[map['RETAIL SKU']]='1004851221';row[map['PRODUCT ID']]='HD-1004851221';
  const s={retailer:row[map.RETAILER],retailSku:'',productId:key,item:row[map['SOURCE ITEM']],fields:{}};
  let changes=t.ctx.sourceCatalogChanges_(s,row,map);
  assert.ok(!changes.some(c=>['RETAIL SKU','PRODUCT ID'].includes(c.header)));
  s.retailSku='1004851222';s.productId='HD-1004851222';
  changes=t.ctx.sourceCatalogChanges_(s,row,map);
  assert.equal(changes.find(c=>c.header==='RETAIL SKU').value,s.retailSku);
  assert.equal(changes.find(c=>c.header==='PRODUCT ID').value,s.productId);
});

test('immediate zero archives, clears Catalog/Export, retires every social occurrence and preserves K/receipts/evergreen',()=>{
  const t=recent(),q=social(t),history=plain(q.data[6]),evergreen=plain(q.data[7]),formula=t.catalog.formula;
  t.records[0].fields.Photos=[{id:'owner-photo'}];const s=t.cleanup();
  assert.equal(s.archived,1);assert.equal(s.cleared,1);assert.equal(s.socialRetired,6);assert.equal(s.removed,0);assert.equal(s.failures.length,0);
  assert.equal(active(t).length,0);assert.equal(t.sheets['Website Export'].data.length,1);assert.equal(t.records.length,1);
  assert.equal(t.records[0].fields.Status,'Sold Out');assert.equal(t.records[0].fields['Quantity Available'],0);
  assert.equal(t.records[0].fields['Available Sq Ft'],0);assert.equal(t.records[0].fields['Sold Out Since'],new Date(now).toISOString());
  assert.deepEqual(t.records[0].fields.Photos,[{id:'owner-photo'}]);assert.equal(t.records[0].fields['Post to Website'],true);
  assert.ok(q.data.slice(1,7).every(r=>r[12]==='Skip'));history[12]='Skip';assert.deepEqual(q.data[6],history);
  assert.equal(q.getRange(7,14).getNote(),'immutable operation journal');assert.deepEqual(q.data[7],evergreen);assert.equal(t.catalog.formula,formula);
  assert.equal(state(t),'ARCHIVED');assert.equal(t.catalog.getLastColumn(),29);assert.equal(t.sheets['Website Export'].getLastColumn(),29);
});
test('Kobalt never-published zero archives without creating any remote record',()=>{
  const t=recent({key:'LOW-4913885',remote:false,category:'Tools'});t.catalog.data[1][12]='';
  assert.equal(t.ctx.runSoldOutCatalogCleanup({apply:true}).cleared,1);assert.equal(active(t).length,0);
  assert.equal(t.records.length,0);assert.ok(!t.events.some(m=>['patch','post','delete'].includes(m)));
  assert.equal(archive(t).rows[0][archive(t).map['PRODUCT KEY']],'LOW-4913885');
});
test('before day ten old remote and pending archive remain, with no active Catalog; exact expiry completes',()=>{
  const t=recent();t.cleanup();t.setClock(now+D-1);assert.equal(t.cleanup().removed,0);assert.equal(t.records.length,1);
  assert.equal(state(t),'ARCHIVED');assert.equal(active(t).length,0);t.setClock(now+D);assert.equal(t.cleanup().removed,1);
  assert.equal(t.records.length,0);assert.equal(state(t),'COMPLETE');assert.equal(t.events.filter(m=>m==='delete').length,1);
});
test('day-four new source acquisition opens B while A remains sold out; sync preserves grace record',()=>{
  const t=recent();t.cleanup();const saved=JSON.stringify(archive(t).rows);const b=purchase(t);
  assert.equal(t.records[0].fields['Product Key'],key);assert.equal(t.records[0].fields.Status,'Sold Out');assert.equal(state(t),'ARCHIVED');
  b[12]='Yes';b[9]=1.5;b[8]=20;b[7]='Box';t.ctx.syncWebsiteExportToAirtable({});
  assert.equal(t.records.length,2);const a=t.records.find(r=>r.fields['Product Key']===key),remoteB=t.records.find(r=>r.fields['Product Key']===b[26]);
  assert.equal(a.fields['Post to Website'],true);assert.equal(a.fields['Sold Out Since'],new Date(now).toISOString());
  assert.equal(remoteB.fields['Quantity Available'],3);assert.equal(remoteB.fields['Sold Out Since'],null);assert.equal(JSON.stringify(archive(t).rows),saved);
  assert.equal(t.ctx.runProductCatalogMaintenance().added,0);
});
test('A day-ten cleanup with same-SKU B deletes only A, preserving every B field and key',()=>{
  const t=recent();t.cleanup();const b=purchase(t);b[12]='Yes';b[9]=2;b[8]=20;b[7]='Box';t.ctx.syncWebsiteExportToAirtable({});
  const before=plain(t.records.find(r=>r.fields['Product Key']===b[26])),catalog=plain(b);
  t.setClock(now+D);assert.equal(t.cleanup().removed,1);assert.equal(state(t),'COMPLETE');assert.equal(t.records.length,1);
  assert.deepEqual(t.records[0],before);assert.deepEqual(active(t)[0],catalog);assert.equal(t.ctx.runProductCatalogMaintenance().added,0);
});
test('new B uses independent social occurrence; old history is not reused',()=>{
  const t=recent(),q=social(t);q.data=[q.data[0],q.data[6],q.data[7]];t.cleanup();const b=purchase(t);b[12]='Yes';b[9]=2;b[8]=20;b[7]='Box';t.ctx.syncWebsiteExportToAirtable({});
  const remote=t.records.find(r=>r.fields['Product Key']===b[26]);remote.fields.Photos=[{id:'attNewPhoto1',type:'image/jpeg',width:800,height:800,url:'https://example.com/owner.jpg'}];
  t.ctx.reconcileSocialQueue_(q,t.ctx.readSocialSourceMap_(t.sheets['Website Export']));
  const rows=q.data.slice(1).filter(r=>r[0]===b[26]);assert.equal(rows.length,1);assert.equal(rows[0][12],'Draft');
  assert.equal(rows[0][13],'');assert.equal(rows[0][14],'');assert.equal(q.data[1][12],'Skip');assert.equal(q.data[1][13],'fb-history');
});
test('changed original source after retirement cannot resurrect A, open B or delete remote A',()=>{
  const t=recent();t.cleanup();t.setQuantity(3);source(t).data[1][6]=new Date(now+4*86400000).toISOString();
  assert.equal(t.ctx.runProductCatalogMaintenance().added,0);assert.equal(active(t).length,0);assert.equal(state(t),'ARCHIVED');
  t.setClock(now+D);assert.equal(t.cleanup().removed,0);assert.equal(t.cleanup().failures.length,1);assert.equal(t.records.length,1);
});
for(const type of ['missing original','invalid later date','invalid later balance','duplicate old row'])test('archived evidence fails closed: '+type,()=>{
  const t=recent();t.cleanup();
  if(type==='missing original')source(t).data.splice(1,1);
  else {const extra=source(t).data[1].slice();if(type==='invalid later date'){extra[4]=3;extra[5]=3;extra[6]='unknown';}
    if(type==='invalid later balance'){extra[5]='';extra[6]=new Date(now+4*86400000).toISOString();}source(t).data.push(extra);}
  t.setClock(now+D);assert.equal(t.cleanup().removed,0);assert.equal(t.records.length,1);assert.ok(!t.events.includes('delete'));
});
test('post-retirement unknown never changes archive to CANCELLED or resets sold-out timer',()=>{
  const t=recent();t.cleanup();const before=JSON.stringify(archive(t).rows);t.setQuantity('');t.sync();t.cleanup();
  assert.equal(JSON.stringify(archive(t).rows),before);assert.equal(t.records[0].fields['Sold Out Since'],new Date(now).toISOString());
});
test('initial unknown cannot archive/clear/retire anything',()=>{
  const t=recent(),q=social(t),before=plain(q.data);t.setQuantity('');t.cleanup();
  assert.equal(archive(t).rows.length,0);assert.equal(active(t).length,1);assert.deepEqual(q.data,before);assert.equal(t.events.length,0);
});
test('cancelled pre-clear correction restarts zero timer even without an intervening Airtable sync',()=>{
  const t=createRuntime({now}),write=t.ctx.writeCatalogArchive_;let once=true;
  t.ctx.writeCatalogArchive_=(...args)=>{const a=write(...args);if(once){once=false;t.setQuantity(2);}return a;};
  t.cleanup();assert.equal(state(t),'CANCELLED');assert.equal(active(t).length,1);
  t.setClock(now+1);t.setQuantity(0);assert.equal(t.cleanup().removed,0);
  assert.equal(t.records[0].fields['Sold Out Since'],new Date(now+1).toISOString());assert.equal(state(t),'ARCHIVED');
});
for(const point of ['after archive','after social','after clear','before delete','after delete'])test('retry resumes exact lifecycle after '+point,()=>{
  const t=recent(),q=social(t);let once=true;
  if(point==='after archive'){const f=t.ctx.writeCatalogArchive_;t.ctx.writeCatalogArchive_=(...a)=>{const r=f(...a);if(once){once=false;throw Error('interrupted');}return r;};}
  if(point==='after social'){const f=t.ctx.retireCatalogSocialKey_;t.ctx.retireCatalogSocialKey_=(...a)=>{const r=f(...a);if(once){once=false;throw Error('interrupted');}return r;};}
  if(point==='after clear'){t.catalog.afterWrite=op=>{if(op.method==='clearContent'&&op.c===12&&once){once=false;throw Error('interrupted');}};}
  if(point.includes('delete')){t.setClock(now+D);const f=t.ctx.iwaRequest_;t.ctx.iwaRequest_=(...a)=>{
    if(a[1]==='delete'&&once){once=false;if(point==='after delete')f(...a);throw Error('interrupted');}return f(...a);};}
  assert.equal(t.cleanup().failures.length,1);assert.equal(archive(t).rows.length,1);
  const result=t.cleanup();assert.equal(result.failures.length,0);assert.equal(active(t).length,0);assert.equal(archive(t).rows.length,1);
  assert.ok(q.data.slice(1,7).every(r=>r[12]==='Skip'));t.setClock(now+D);t.cleanup();assert.equal(state(t),'COMPLETE');assert.equal(t.records.length,0);
});
test('owner edit after archive is preserved, not silently cleared',()=>{
  const t=recent(),f=t.ctx.writeCatalogArchive_;t.ctx.writeCatalogArchive_=(...a)=>{const r=f(...a);t.catalog.data[1][9]=9.99;return r;};
  assert.equal(t.cleanup().failures.length,1);assert.equal(active(t)[0][9],9.99);assert.equal(t.records.length,1);
});
test('normal sync cannot overwrite archived timer/status or recreate missing A',()=>{
  const t=recent();t.cleanup();const before=plain(t.records);t.ctx.syncWebsiteExportToAirtable({});assert.deepEqual(t.records,before);
  t.records=[];t.ctx.syncWebsiteExportToAirtable({});assert.equal(t.records.length,0);
});
test('remote identity/timer mutation and reappeared active key block day-ten deletion',()=>{
  for(const change of ['id','timer','catalog']){const t=recent(),row=t.catalog.data[1].slice();t.cleanup();t.setClock(now+D);
    if(change==='id')t.records[0].id='rec-wrong';if(change==='timer')t.records[0].fields['Sold Out Since']=new Date(now+1).toISOString();
    if(change==='catalog'){t.catalog.data.push(row);t.refreshExport();}
    assert.equal(t.cleanup().removed,0);assert.equal(t.records.length,1);assert.ok(!t.events.includes('delete'));}
});
if(failed)process.exit(1);

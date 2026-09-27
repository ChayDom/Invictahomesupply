import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRuntime,plain} from './fixtures/catalog-lifecycle-runtime.mjs';
let failed=0;
function test(name,fn){try{fn();console.log('ok - '+name);}catch(e){failed++;console.error('NOT OK - '+name+'\n'+e.stack);}}
const formula=fs.readFileSync(new URL('./fixtures/source-evidence.formula',import.meta.url),'utf8').trim();
// Test model of native projection/filter only, NOT a second stock engine or a
// Sheets formula evaluator. Native formula and spill expansion are verified live.
const columns=[0,24,3,23,5,11,4];
const project=rows=>rows.map(r=>columns.map(c=>r[c]??'')).filter(r=>r.some(v=>String(v).length>0));
const master=(sku,balance)=>{const r=new Array(25).fill('');
  r[0]='Source growth '+sku;r[3]=sku;r[4]=46292;r[5]=4;r[11]=balance;r[23]='HD-'+sku;r[24]='Home Depot';return r;};
const observe=(t,sku)=>plain(t.ctx.catalogConfirmedStock_(t.ss,h=>({RETAILER:'Home Depot','PRODUCT ID':'HD-'+sku,'SOURCE ITEM':'Source growth '+sku})[h]));
function evidence(t,rows){const s=t.sheets['Inventory Source Evidence'];s.data=[s.data[0],...project(rows)];s.maxRows=Math.max(50,s.data.length);}
test('source formula has one open-ended minimum-width import, blank preservation and empty-row filter',()=>{
  assert.match(formula,/"'Master Sheet'!A1:Y"/);assert.equal((formula.match(/IMPORTRANGE\(/g)||[]).length,1);
  assert.match(formula,/CHOOSECOLS\(data,1,25,4,24,6,12,5\)/);
  assert.match(formula,/IF\(LEN\(picked\)=0,"",picked\)/);assert.match(formula,/FILTER\(clean,BYROW/);
  assert.doesNotMatch(formula,/4038|20000|50000|QUERY|IFERROR|VALUE\(/);
});
test('physical source rows 4038 and 4039+ survive compaction; future blanks ignored',()=>{
  const rows=Array.from({length:4100},()=>new Array(25).fill(''));
  rows[4037]=master('G4038',4);rows[4038]=master('G4039',4);rows[4099]=master('G4100',4);
  assert.deepEqual(project(rows).map(r=>r[2]),['G4038','G4039','G4100']);
});
for(const [balance,state,quantity] of [[4,'IN STOCK',4],[0,'CONFIRMED ZERO',0],['','UNKNOWN',''],['invalid','UNKNOWN',''],[null,'UNKNOWN',''],['0','UNKNOWN','']])
  test('future row beyond 4038 with balance '+JSON.stringify(balance)+' uses authoritative lifecycle state '+state,()=>{
    const t=createRuntime({quantity:4}),rows=Array.from({length:4042},()=>[]);rows[4038]=master('GROWTH',balance);
    evidence(t,rows);const result=observe(t,'GROWTH');assert.equal(result.state,state);assert.equal(result.quantity,quantity);
  });
test('source growth creates no Catalog identities and existing sync remains unchanged',()=>{
  const t=createRuntime({quantity:4});t.sync();const oldCatalog=plain(t.catalog.data),oldRecords=plain(t.records);
  const old=t.sheets['Inventory Source Evidence'].data[1].slice();
  const rows=Array.from({length:4042},()=>[]);rows[4038]=master('FUTURE-POS',4);rows[4039]=master('FUTURE-ZERO',0);rows[4040]=master('FUTURE-BAD','invalid');
  evidence(t,rows);t.sheets['Inventory Source Evidence'].data.splice(1,0,old);t.events.length=0;t.sync();
  assert.deepEqual(plain(t.catalog.data),oldCatalog);assert.deepEqual(plain(t.records),oldRecords);assert.equal(t.events.length,0);
  assert.equal(t.sheets['Lifecycle Inventory'].data.length,2);
});
if(failed)process.exit(1);

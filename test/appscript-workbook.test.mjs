#!/usr/bin/env node
// Runs actual bound-project functions in a VM with Sheets and network services mocked.
// Website Export is a formula fixture here, not an execution of the live Sheets formula.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scripts = path.join(root, 'Invicta Appscript Files');
const catalogHeaders = [
  'DISPLAY NAME', 'RETAILER', 'RETAIL SKU', 'BRAND', 'MODEL', 'WEBSITE CATEGORY',
  'WEB SUBCATEGORY', 'UNIT TYPE', 'SQ FT PER UNIT', 'SELL PRICE ($/SQ FT OR EACH)',
  'AUTO BOX PRICE', 'COMPARABLE RETAIL PRICE', 'POST TO WEBSITE', 'STOCK IMAGE URL',
  'PRODUCT URL', 'DESCRIPTION', 'HIGHLIGHTS', 'THICKNESS MM', 'WEAR LAYER MIL',
  'UNDERLAYMENT ATTACHED', 'WATER RESISTANCE', 'CARD SPEC 1', 'CARD SPEC 2', 'CARD SPEC 3',
  'ENRICHMENT STATUS', 'NOTES', 'PRODUCT KEY', 'PRODUCT ID', 'SOURCE ITEM'
];
const inventoryHeaders = ['PRODUCT KEY', 'PRODUCT ID', 'RETAIL SKU', 'ITEM', 'CATEGORY',
  'RETAILER', 'SUBCATEGORY', 'BRAND', 'MODEL', 'UNIT TYPE', 'SQ FT PER UNIT'];
const exportHeaders = ['PRODUCT KEY', 'DISPLAY NAME', 'CATEGORY', 'BRAND', 'MODEL',
  'RETAIL SKU', 'RETAILER', 'QUANTITY AVAILABLE', 'UNIT TYPE', 'SQ FT PER UNIT',
  'AVAILABLE SQ FT', 'WEBSITE PRICE', 'DESCRIPTION', 'HIGHLIGHTS', 'PRODUCT URL',
  'STOCK IMAGE URL', 'POST TO WEBSITE', 'ENRICHMENT STATUS', 'IN STOCK',
  'COMPARABLE RETAIL PRICE', 'BOX PRICE', 'SUBCATEGORY', 'THICKNESS MM', 'WEAR LAYER MIL',
  'UNDERLAYMENT ATTACHED', 'WATER RESISTANCE', 'CARD SPEC 1', 'CARD SPEC 2', 'CARD SPEC 3'];
const row = (headers, fields) => headers.map(h => fields[h] ?? '');
const plain = value => JSON.parse(JSON.stringify(value));

class Sheet {
  constructor(name, headers, rows = []) {
    this.name = name; this.headers = headers.slice(); this.data = [headers.slice(), ...rows.map(r => r.slice())];
    this.maxRows = 50; this.writes = []; this.formats = []; this.validations = [];
    this.insertions = []; this.numberFormats = Object.create(null);
    for (const h of ['SELL PRICE ($/SQ FT OR EACH)','AUTO BOX PRICE','COMPARABLE RETAIL PRICE']) {
      const c = headers.indexOf(h) + 1;
      if (c > 0) this.numberFormats['2:'+c] = '$#,##0.00';
    }
    this.formula = name === 'Product Catalog' ? '=MAP(I2:I,J2:J,LAMBDA(area,price,area*price))' : '';
  }
  getLastColumn() { return this.headers.length; }
  getMaxRows() { return this.maxRows; }
  getLastRow() { return this.formula ? this.maxRows : this.data.length; }
  insertRowsAfter(after, count) {
    assert.equal(after,this.maxRows);
    this.insertions.push({after,count}); this.maxRows += count;
  }
  getDataRange() { return this.getRange(1, 1, this.data.length, this.headers.length); }
  getRange(r, c, n = 1, m = 1) {
    assert.ok([r,c,n,m].every(Number.isInteger) && [r,c,n,m].every(v => v > 0), 'valid sheet coordinates');
    assert.ok(r+n-1 <= this.maxRows,'range must fit physical sheet rows');
    const sheet = this;
    const read = () => Array.from({length:n}, (_,i) => Array.from({length:m}, (_,j) => sheet.data[r+i-1]?.[c+j-1] ?? ''));
    const write = (values,method) => {
      if (sheet.name === 'Product Catalog') {
        const spill = sheet.headers.indexOf('AUTO BOX PRICE') + 1;
        assert.ok(c > spill || c + m - 1 < spill, 'no write may intersect the spill column');
      }
      sheet.writes.push({r,c,n,m,method,values:plain(values)});
      for(let i=0;i<n;i++) {
        sheet.data[r+i-1] ||= new Array(sheet.headers.length).fill('');
        for(let j=0;j<m;j++) sheet.data[r+i-1][c+j-1] = values[i][j];
      }
    };
    const readFormats = () => Array.from({length:n}, (_,i) => Array.from({length:m},
      (_,j) => sheet.numberFormats[(r+i)+':'+(c+j)] ?? 'General'));
    return {
      coordinates: {r,c,n,m},
      getValues: read,
      getDisplayValues: () => read().map(row => row.map(String)),
      getValue: () => read()[0][0],
      getFormula: () => r === 2 && c === sheet.headers.indexOf('AUTO BOX PRICE') + 1 ? sheet.formula : '',
      setValue(value) { write([[value]],'setValue'); },
      setValues(values) { assert.equal(values.length,n); values.forEach(v=>assert.equal(v.length,m)); write(values,'setValues'); },
      setFormula(formula) { write([[formula]],'setFormula'); },
      setFormulas(formulas) { write(formulas,'setFormulas'); },
      setDataValidation(rule) { sheet.validations.push({r,c,n,m,rule}); },
      getNumberFormat: () => readFormats()[0][0],
      getNumberFormats: readFormats,
      setNumberFormat(format) {
        sheet.formats.push({r,c,n,m,format});
        for(let i=0;i<n;i++) for(let j=0;j<m;j++) sheet.numberFormats[(r+i)+':'+(c+j)] = format;
      },
      setNumberFormats(formats) {
        assert.equal(formats.length,n); formats.forEach(v=>assert.equal(v.length,m));
        sheet.formats.push({r,c,n,m,numberFormats:plain(formats)});
        for(let i=0;i<n;i++) for(let j=0;j<m;j++) sheet.numberFormats[(r+i)+':'+(c+j)] = formats[i][j];
      },
      copyTo(target, type) {
        assert.equal(type,'format');
        sheet.formats.push({r,c,n,m,type,target:target.coordinates});
        const formats=readFormats(), dest=target.coordinates;
        target.setNumberFormats(Array.from({length:dest.n},(_,i)=>
          Array.from({length:dest.m},(_,j)=>formats[i%n][j%m])));
      }
    };
  }
}
function runtime(catalogRows = [], invRows = [], headers = catalogHeaders) {
  const catalog = new Sheet('Product Catalog',headers,catalogRows);
  const inventory = new Sheet('Product Inventory',inventoryHeaders,invRows);
  const sheets = { 'Product Catalog':catalog, 'Product Inventory':inventory };
  const lock = { waitLock(){}, tryLock(){return true;}, releaseLock(){} };
  const ctx = vm.createContext({
    console: {log(){},warn(){},error(){}},
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({getSheetByName:name=>sheets[name]}),
      flush(){}, CopyPasteType:{PASTE_FORMAT:'format'},
      newDataValidation: () => ({
        requireValueInList(values){this.values=values;return this;},
        setAllowInvalid(value){this.allowInvalid=value;return this;},
        build(){return {values:this.values,allowInvalid:this.allowInvalid};}
      })
    },
    LockService:{getScriptLock:()=>lock},
    PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'mock-token'})},
    Utilities: {
      sleep(){},formatDate:()=> '2026-09-26',
      DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
      computeDigest:(_,input)=>crypto.createHash('sha256').update(input).digest(),
      base64EncodeWebSafe:bytes=>Buffer.from(bytes).toString('base64url')
    },
    UrlFetchApp:{fetch(){throw new Error('Live requests forbidden in tests');}},
    ScriptApp:{getProjectTriggers(){throw new Error('Triggers forbidden in tests');}}
  });
  for(const name of ['Config','ProductCatalogLifecycle','ProductCatalogMaintenance','LegacyRepair','AdminTools',
    'CatalogEnrichment','EnrichmentAdmin','WebsiteAirtableSync','BufferSocialSync']) {
    vm.runInContext(fs.readFileSync(path.join(scripts,name+'.js'),'utf8'),ctx,{filename:name+'.js'});
  }
  return {ctx,catalog,inventory,sheets};
}
const sourceFields = {
  'PRODUCT KEY':'HD-1001234567','PRODUCT ID':'HD-1001234567','RETAIL SKU':'1001234567',
  ITEM:'Test oak flooring',CATEGORY:'Flooring',RETAILER:'Home Depot',SUBCATEGORY:'Luxury Vinyl Plank',
  BRAND:'Test Brand',MODEL:'Oak 20', 'UNIT TYPE':'Box','SQ FT PER UNIT':20
};
const sourceRow = fields => row(inventoryHeaders,{...sourceFields,...fields});
function legacyFields(extra={}) {
  return { 'PRODUCT KEY':'LEG-HD-001518','PRODUCT ID':'LEG-HD-001518',
    RETAILER:'Home Depot','SOURCE ITEM':'Test oak flooring',...extra };
}
const value = (sheet,header,index=1) => sheet.data[index][sheet.headers.indexOf(header)];
let failed=0;
function test(name,run) {
  try{run();console.log('ok - '+name);}catch(e){failed++;console.error('NOT OK - '+name+'\n'+e.stack);}
}

test('header resolver accepts normalized headers, rejects duplicates and missing schema',()=>{
  const {ctx,catalog}=runtime();
  assert.equal(ctx.buildHeaderMap_(['  retail   sku '])['RETAIL SKU'],0);
  assert.throws(()=>ctx.buildHeaderMap_(['RETAIL SKU',' retail sku ']),/Duplicate/);
  assert.equal(ctx.getCatalogColumns_(catalog).PRODUCT_KEY,27);
  catalog.data[0][2]='INVALID';
  assert.throws(()=>ctx.getCatalogColumns_(catalog),/missing required/);
});
test('reordered catalog and inventory attributes resolve by headers',()=>{
  const headers=catalogHeaders.slice().reverse();
  const {ctx,catalog}=runtime([], [sourceRow()],headers);
  ctx.runProductCatalogMaintenance();
  assert.equal(value(catalog,'PRODUCT KEY'),'HD-1001234567');
  assert.equal(value(catalog,'WEBSITE CATEGORY'),'Flooring');
});
test('new standard product populates every available source field and leaves manual fields blank',()=>{
  const {ctx,catalog}=runtime([], [sourceRow()]);
  assert.deepEqual(plain(ctx.runProductCatalogMaintenance()),{updated:0,added:1});
  const expected={ 'PRODUCT KEY':'HD-1001234567','PRODUCT ID':'HD-1001234567',
    RETAILER:'Home Depot','RETAIL SKU':'1001234567','SOURCE ITEM':'Test oak flooring',
    'DISPLAY NAME':'Test oak flooring','WEBSITE CATEGORY':'Flooring',
    'WEB SUBCATEGORY':'Luxury Vinyl Plank',BRAND:'Test Brand',MODEL:'Oak 20',
    'UNIT TYPE':'Box','SQ FT PER UNIT':20,'ENRICHMENT STATUS':'PENDING' };
  for(const h of catalogHeaders) assert.equal(value(catalog,h),expected[h]??'',h);
  assert.equal(catalog.data.length,2);
  assert.equal(catalog.validations.length,4);
  assert.equal(catalog.validations.find(v=>v.c===13).rule.allowInvalid,false);
});
test('maintenance never writes K2/spill or per-row formulas and ignores formula-only tails',()=>{
  const {ctx,catalog}=runtime([], [sourceRow()]);
  const formula=catalog.formula;
  ctx.runProductCatalogMaintenance();
  ctx.ensureProductCatalogAutoBoxPriceFormulas_();
  assert.equal(catalog.formula,formula);
  assert.equal(catalog.writes[0].r,2);
  assert.ok(catalog.writes.every(w=>w.c>11||w.c+w.m-1<11));
});
for(const scenario of [
  {name:'existing physical capacity',maxRows:50,headers:catalogHeaders},
  {name:'inserted physical row',maxRows:2,headers:catalogHeaders},
  {name:'reordered headers with inserted row',maxRows:2,headers:catalogHeaders.slice().reverse()}
]) test('appended price formats preserve workbook J/K/L formatting: '+scenario.name,()=>{
  const {ctx,catalog}=runtime([row(scenario.headers,legacyFields({'SOURCE ITEM':'Template product'}))],
    [sourceRow()],scenario.headers);
  catalog.maxRows=scenario.maxRows;
  const formats={
    'SELL PRICE ($/SQ FT OR EACH)':'[$$-en-US]#,##0.000',
    'AUTO BOX PRICE':'$#,##0.00;($#,##0.00)',
    'COMPARABLE RETAIL PRICE':'"USD "#,##0.00'
  };
  for(const [h,format] of Object.entries(formats)) {
    catalog.getRange(2,scenario.headers.indexOf(h)+1).setNumberFormat(format);
  }
  const spill=scenario.headers.indexOf('AUTO BOX PRICE')+1;
  const formula=catalog.getRange(2,spill).getFormula();
  assert.equal(ctx.runProductCatalogMaintenance().added,1);
  for(const [h,format] of Object.entries(formats)) {
    assert.equal(catalog.getRange(3,scenario.headers.indexOf(h)+1).getNumberFormat(),format,h);
  }
  assert.ok(catalog.writes.every(w=>w.c>spill||w.c+w.m-1<spill),'no value/formula setter touches K');
  assert.equal(catalog.getRange(2,spill).getFormula(),formula);
  assert.ok(catalog.formats.some(f=>f.type==='format' && f.target.r===3 && f.target.c===1 && f.target.m===29));
  assert.deepEqual(catalog.insertions,scenario.maxRows===2?[{after:2,count:1}]:[]);
  assert.equal(value(catalog,'PRODUCT KEY',2),'HD-1001234567');
});
test('first product inherits authoritative row 2 currency formats without disturbing K2',()=>{
  const {ctx,catalog}=runtime([], [sourceRow()]);
  const formula=catalog.formula;
  ctx.runProductCatalogMaintenance();
  for(const c of [10,11,12]) assert.equal(catalog.getRange(2,c).getNumberFormat(),'$#,##0.00');
  assert.equal(catalog.formula,formula);
});
test('running maintenance twice adds only one product',()=>{
  const {ctx,catalog}=runtime([], [sourceRow()]);
  ctx.runProductCatalogMaintenance();
  assert.equal(ctx.runProductCatalogMaintenance().added,0);
  assert.equal(catalog.data.length,2);
});
test('legacy SKU reconciliation updates the same row and preserves permanent key and manual values',()=>{
  const manual={ 'SELL PRICE ($/SQ FT OR EACH)':1.49,'POST TO WEBSITE':'Yes',
    'STOCK IMAGE URL':'https://example.com/manual.jpg','COMPARABLE RETAIL PRICE':3.99,
    DESCRIPTION:'Human description',NOTES:'Human note' };
  const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields(manual))],[sourceRow({'RETAIL SKU':'1012206811','PRODUCT KEY':'HD-1012206811','PRODUCT ID':'HD-1012206811'})]);
  ctx.runProductCatalogMaintenance();
  assert.equal(catalog.data.length,2);
  assert.equal(value(catalog,'PRODUCT KEY'),'LEG-HD-001518');
  assert.equal(value(catalog,'PRODUCT ID'),'HD-1012206811');
  assert.equal(value(catalog,'RETAIL SKU'),'1012206811');
  Object.entries(manual).forEach(([h,v])=>assert.equal(value(catalog,h),v));
  ctx.runProductCatalogMaintenance();
  assert.equal(catalog.data.length,2);
});
test('standard SKU A to B correction with changed source key preserves the initial key',()=>{
  const {ctx,catalog,inventory}=runtime([], [sourceRow()]);
  ctx.runProductCatalogMaintenance();
  inventory.data[1]=sourceRow({'PRODUCT KEY':'HD-1009938752','PRODUCT ID':'HD-1009938752','RETAIL SKU':'1009938752'});
  assert.equal(ctx.runProductCatalogMaintenance().added,0);
  assert.equal(value(catalog,'PRODUCT KEY'),'HD-1001234567');
  assert.equal(value(catalog,'PRODUCT ID'),'HD-1009938752');
  assert.equal(value(catalog,'RETAIL SKU'),'1009938752');
});
test('stable source key resolves correction even when item title changes',()=>{
  const {ctx,catalog,inventory}=runtime([], [sourceRow()]);
  ctx.runProductCatalogMaintenance();
  inventory.data[1]=sourceRow({'PRODUCT ID':'HD-1009938752','RETAIL SKU':'1009938752',ITEM:'Corrected title'});
  ctx.runProductCatalogMaintenance();
  assert.equal(value(catalog,'PRODUCT KEY'),'HD-1001234567');
  assert.equal(value(catalog,'SOURCE ITEM'),'Corrected title');
});
test('duplicate sources, conflicting keys and ambiguous fallback fail before any writes',()=>{
  const duplicate=runtime([], [sourceRow(),sourceRow()]);
  assert.throws(()=>duplicate.ctx.runProductCatalogMaintenance(),/Duplicate Product Inventory/);
  assert.equal(duplicate.catalog.writes.length,0);
  const ambiguous=runtime([row(catalogHeaders,legacyFields()),row(catalogHeaders,legacyFields({'PRODUCT KEY':'LEG-HD-001519','PRODUCT ID':'LEG-HD-001519'}))],[sourceRow()]);
  assert.throws(()=>ambiguous.ctx.runProductCatalogMaintenance(),/Ambiguous/);
  assert.equal(ambiguous.catalog.writes.length,0);
  const conflict=runtime([
    row(catalogHeaders,legacyFields({'PRODUCT KEY':'HD-1001234567'})),
    row(catalogHeaders,legacyFields({'PRODUCT KEY':'LEG-HD-001519','PRODUCT ID':'HD-1001234567','SOURCE ITEM':'Another product'}))
  ],[sourceRow()]);
  assert.throws(()=>conflict.ctx.runProductCatalogMaintenance(),/Ambiguous/);
  assert.equal(conflict.catalog.writes.length,0);
});
test('orphan catalog rows are detected before appending',()=>{
  const {ctx,catalog}=runtime([row(catalogHeaders,{'DISPLAY NAME':'Orphan','SOURCE ITEM':'Orphan'})],[sourceRow()]);
  assert.throws(()=>ctx.runProductCatalogMaintenance(),/MISSING PRODUCT KEY/);
  assert.equal(catalog.writes.length,0);
});
test('source-refresh compatibility handler updates existing products without appending new products',()=>{
  const {ctx,catalog}=runtime([], [sourceRow()]);
  ctx.refreshProductCatalogSourceFields();
  assert.equal(catalog.data.length,1);
});
test('legacy repair handler uses the same identity planner without adding rows',()=>{
  const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields())],[sourceRow()]);
  ctx.reconcileLegacyCatalogRowsAutomatically_();
  assert.equal(value(catalog,'PRODUCT KEY'),'LEG-HD-001518');
  assert.equal(value(catalog,'PRODUCT ID'),'HD-1001234567');
  assert.equal(catalog.data.length,2);
});
const verified = extra => ({
  match_status:'EXACT',confidence:'HIGH',sourceUrls:['https://example.com/exact-sku'],
  display_name:'Verified oak',brand:'Brand',model:'Model-X',
  website_category:'Flooring',web_subcategory:'Luxury Vinyl Plank',unit_type:'Box',
  sq_ft_per_unit:20,description:'Verified description.',
  highlights:['Attached pad','Click lock installation','Oak finish'],
  thickness_mm:5,wear_layer_mil:12,underlayment_attached:'Yes',water_resistance:'Waterproof',
  card_specs:['12 MIL','5 mm','Attached pad'],...extra
});
test('verified enrichment populates customer fields and all R:X attributes using current headers',()=>{
  const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields({'ENRICHMENT STATUS':'PENDING'}))]);
  const original=catalog.data[1].slice();
  assert.equal(ctx.applyCatalogEnrichmentResult_(catalog,2,original,verified()),'ENRICHED - VERIFIED');
  const expected={ 'DISPLAY NAME':'Verified oak',BRAND:'Brand',MODEL:'Model-X',
    DESCRIPTION:'Verified description.','WEB SUBCATEGORY':'Luxury Vinyl Plank',
    'UNIT TYPE':'Box','SQ FT PER UNIT':20,'THICKNESS MM':5,'WEAR LAYER MIL':12,
    'UNDERLAYMENT ATTACHED':'Yes','WATER RESISTANCE':'Waterproof',
    'CARD SPEC 1':'12 MIL','CARD SPEC 2':'5 mm','CARD SPEC 3':'Attached pad' };
  for(const [h,v] of Object.entries(expected)) assert.equal(value(catalog,h),v,h);
  assert.equal(value(catalog,'HIGHLIGHTS').split('\n').length,3);
  assert.equal(value(catalog,'ENRICHMENT STATUS'),'ENRICHED - VERIFIED');
  assert.match(value(catalog,'NOTES'),/Sources:/);
});
test('enrichment fills blanks without overwriting human fields, including concurrent edits',()=>{
  const manual={'DISPLAY NAME':'Human name',BRAND:'Human brand',MODEL:'Human model',
    DESCRIPTION:'Human description',HIGHLIGHTS:'Human highlights','SELL PRICE ($/SQ FT OR EACH)':1.99,
    'COMPARABLE RETAIL PRICE':3.99,'POST TO WEBSITE':'Yes','STOCK IMAGE URL':'https://example.com/human.jpg',
    'WEAR LAYER MIL':0};
  const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields(manual))]);
  const snapshot=catalog.data[1].slice();
  catalog.data[1][catalogHeaders.indexOf('CARD SPEC 1')]='Concurrent human spec';
  ctx.applyCatalogEnrichmentResult_(catalog,2,snapshot,verified({stock_image_url:'https://example.com/ai.jpg'}));
  for(const [h,v] of Object.entries(manual)) assert.equal(value(catalog,h),v);
  assert.equal(value(catalog,'CARD SPEC 1'),'Concurrent human spec');
});
test('ambiguous, uncited or invalid-highlights enrichment remains NEEDS REVIEW',()=>{
  for(const extra of [{match_status:'LIKELY'},{sourceUrls:[]},{highlights:['one','two']},
    {highlights:['one two three four five six seven eight nine','two','three']}]){
    const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields())]);
    assert.equal(ctx.applyCatalogEnrichmentResult_(catalog,2,catalog.data[1].slice(),verified(extra)),'NEEDS REVIEW');
    assert.equal(value(catalog,'DESCRIPTION'),'');
    assert.equal(value(catalog,'THICKNESS MM'),'');
  }
});
test('unknown or invalid optional flooring specifications stay blank rather than guessed',()=>{
  const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields())]);
  ctx.applyCatalogEnrichmentResult_(catalog,2,catalog.data[1].slice(),verified({
    sq_ft_per_unit:'unknown',thickness_mm:-1,wear_layer_mil:0,
    underlayment_attached:'maybe',water_resistance:'probably waterproof',card_specs:[]
  }));
  for(const h of ['SQ FT PER UNIT','THICKNESS MM','WEAR LAYER MIL','UNDERLAYMENT ATTACHED',
    'WATER RESISTANCE','CARD SPEC 1','CARD SPEC 2','CARD SPEC 3']) assert.equal(value(catalog,h),'',h);
});
test('enrichment rejects stale identity snapshots before writing customer fields',()=>{
  const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields())]);
  const snapshot=catalog.data[1].slice();
  catalog.data[1][catalogHeaders.indexOf('RETAIL SKU')]='corrected';
  assert.throws(()=>ctx.applyCatalogEnrichmentResult_(catalog,2,snapshot,verified()),/changed/);
  assert.equal(catalog.writes.length,0);
});
test('highlight validator permits 3–5 concise bullets and rejects oversized/duplicate entries',()=>{
  const {ctx}=runtime();
  const result=ctx.parseGeminiJson_(JSON.stringify(verified({highlights:[
    'one two three four five six seven eight nine','A','a','B','C','D','E','F'
  ]})));
  assert.deepEqual(plain(result.highlights),['A','B','C','D','E']);
  assert.ok(result.highlights.every(h=>h.split(/\s+/).length<=8));
  assert.match(ctx.buildGeminiEnrichmentPrompt_({}),/no more than 8 words/);
});
test('enrichment queue avoids repeat review/failed runs without removed columns',()=>{
  const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields({
    'PRODUCT KEY':'HD-1001234567','PRODUCT ID':'HD-1001234567','ENRICHMENT STATUS':'PENDING'}))]);
  const columns=ctx.getCatalogColumns_(catalog);
  assert.equal(ctx.isCatalogRowEligibleForEnrichment_(catalog.data[1],columns),true);
  for(const status of ['NEEDS REVIEW','FAILED','PROCESSING','ENRICHED - VERIFIED','STANDARD']){
    catalog.data[1][columns.ENRICHMENT_STATUS-1]=status;
    assert.equal(ctx.isCatalogRowEligibleForEnrichment_(catalog.data[1],columns),false,status);
  }
  assert.equal(ctx.auditCatalogEnrichment().totalProducts,1);
});
test('actual enrichment orchestrator runs with mock Gemini response and current schema',()=>{
  const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields({
    'PRODUCT KEY':'HD-1001234567','PRODUCT ID':'HD-1001234567','ENRICHMENT STATUS':'PENDING'}))]);
  ctx.callGeminiProductEnrichment_=()=>verified();
  const result=ctx.runCatalogEnrichment();
  assert.equal(result.enriched,1);
  assert.equal(value(catalog,'THICKNESS MM'),5);
  assert.equal(ctx.runCatalogEnrichment().processed,0);
});
for(const key of ['LEG-HD-001518','LEGACY|HD|TEST',' leg-hd-001518 ']) {
  test('historical key with PENDING is never automatically enriched: '+key,()=>{
    const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields({'PRODUCT KEY':key,'ENRICHMENT STATUS':'PENDING'}))]);
    assert.equal(ctx.isCatalogRowEligibleForEnrichment_(catalog.data[1],ctx.getCatalogColumns_(catalog)),false);
    let calls=0; ctx.callGeminiProductEnrichment_=()=>{calls++;return verified();};
    assert.equal(ctx.runCatalogEnrichment().processed,0);
    assert.equal(calls,0); assert.equal(catalog.writes.length,0);
    assert.equal(ctx.auditCatalogEnrichment().pending,0);
  });
}
test('completed standard content with blank or PENDING status consumes no Gemini request',()=>{
  for(const status of ['', 'PENDING']) {
    const {ctx,catalog}=runtime([row(catalogHeaders,legacyFields({
      'PRODUCT KEY':'HD-1001234567','DISPLAY NAME':'Complete name',DESCRIPTION:'Complete description',
      HIGHLIGHTS:'Attached pad\nClick lock\nOak finish','ENRICHMENT STATUS':status}))]);
    assert.equal(ctx.isCatalogRowEligibleForEnrichment_(catalog.data[1],ctx.getCatalogColumns_(catalog)),false);
    ctx.callGeminiProductEnrichment_=()=>{throw new Error('Completed content must not request Gemini');};
    assert.equal(ctx.runCatalogEnrichment().processed,0);
    assert.equal(catalog.writes.length,0);
  }
});
test('intentional bulk requeue only queues incomplete standard rows, never legacy or excluded statuses',()=>{
  const states=[
    ['HD-new',''],['HD-pending','PENDING'],['LEG-HD-001518','PENDING'],['LEGACY|HD|TEST','PENDING'],
    ['HD-review','NEEDS REVIEW'],['HD-failed','FAILED'],['HD-processing','PROCESSING'],
    ['HD-verified','ENRICHED - VERIFIED'],['HD-standard','STANDARD'],['HD-excluded','DO NOT ENRICH']
  ];
  const rows=states.map(([key,status])=>row(catalogHeaders,legacyFields({'PRODUCT KEY':key,'ENRICHMENT STATUS':status})));
  rows.push(row(catalogHeaders,legacyFields({'PRODUCT KEY':'HD-complete',DESCRIPTION:'Complete',HIGHLIGHTS:'Complete'})));
  const {ctx,catalog}=runtime(rows);
  assert.equal(ctx.queueMissingCatalogEnrichment(),2);
  assert.equal(value(catalog,'ENRICHMENT STATUS',1),'PENDING');
  assert.equal(value(catalog,'ENRICHMENT STATUS',2),'PENDING');
  for(let i=2;i<states.length;i++) assert.equal(value(catalog,'ENRICHMENT STATUS',i+1),states[i][1]);
  assert.equal(catalog.writes.length,2);
  assert.equal(ctx.auditCatalogEnrichment().pending,2);
});
function exportFixture(catalog, currentId) {
  // Model the user-supplied formula contract: current ID lookup yields the stored permanent key.
  const found=catalog.data.slice(1).filter(r=>r[catalog.headers.indexOf('PRODUCT ID')]===currentId);
  assert.equal(found.length,1);
  const get=h=>found[0][catalog.headers.indexOf(h)];
  return row(exportHeaders,{
    'PRODUCT KEY':get('PRODUCT KEY'),'DISPLAY NAME':get('DISPLAY NAME')||'Flooring',
    CATEGORY:'Flooring',BRAND:get('BRAND'),MODEL:get('MODEL'),'RETAIL SKU':get('RETAIL SKU'),
    RETAILER:get('RETAILER'),'QUANTITY AVAILABLE':10,'UNIT TYPE':'Box','SQ FT PER UNIT':20,
    'AVAILABLE SQ FT':200,'WEBSITE PRICE':1.49,DESCRIPTION:'Description',HIGHLIGHTS:'Attached pad',
    'POST TO WEBSITE':'Yes','IN STOCK':true,'COMPARABLE RETAIL PRICE':3.99,'BOX PRICE':30,
    'ENRICHMENT STATUS':'ENRICHED - VERIFIED','STOCK IMAGE URL':'https://example.com/image.jpg'
  });
}
test('reconciled export contract sends the same permanent key to Airtable after SKU correction',()=>{
  const {ctx,catalog,inventory,sheets}=runtime([row(catalogHeaders,legacyFields())],[sourceRow()]);
  ctx.runProductCatalogMaintenance();
  const record={id:'rec-stable',fields:{'Product Key':'LEG-HD-001518','Status':'In Stock','Date Added':'2025-01-01'}};
  let payloads=[];
  ctx.iwaFetchAll_=()=>[record];
  ctx.iwaRequest_=(_token,method,_suffix,payload)=>{
    assert.equal(method,'patch');payloads.push(plain(payload));
    for(const r of payload.records) if(r.fields['Product Key']) Object.assign(record.fields,r.fields);
    return {};
  };
  sheets['Website Export']=new Sheet('Website Export',exportHeaders,[exportFixture(catalog,'HD-1001234567')]);
  assert.equal(ctx.syncWebsiteExportToAirtable({productKeys:['LEG-HD-001518']}).updated,1);
  assert.equal(payloads[0].records[0].fields['Was Price'],3.99);
  assert.deepEqual(payloads[0].performUpsert.fieldsToMergeOn,['Product Key']);
  inventory.data[1]=sourceRow({'PRODUCT ID':'HD-1009938752','PRODUCT KEY':'HD-1009938752','RETAIL SKU':'1009938752'});
  ctx.runProductCatalogMaintenance();
  sheets['Website Export']=new Sheet('Website Export',exportHeaders,[exportFixture(catalog,'HD-1009938752')]);
  payloads=[];
  const result=ctx.syncWebsiteExportToAirtable({productKeys:['LEG-HD-001518']});
  assert.equal(result.created,0); assert.equal(result.updated,1);
  assert.equal(payloads[0].records[0].fields['Product Key'],'LEG-HD-001518');
  assert.equal(record.id,'rec-stable');
  assert.equal(record.fields['Retail SKU'],'1009938752');
  assert.equal(record.fields['Date Added'],'2025-01-01');
  payloads=[];
  assert.equal(ctx.syncWebsiteExportToAirtable({productKeys:['LEG-HD-001518']}).unchanged,1);
  assert.equal(payloads.length,0);
});
function lifecycleSync(fields={},existing=null) {
  const {ctx,sheets}=runtime();
  const source={ 'PRODUCT KEY':'LEG-HD-001518','DISPLAY NAME':'Synthetic oak',CATEGORY:'Flooring',
    'POST TO WEBSITE':'Yes','IN STOCK':false,'AVAILABLE SQ FT':0,'QUANTITY AVAILABLE':0,...fields };
  sheets['Website Export']=new Sheet('Website Export',exportHeaders,[row(exportHeaders,source)]);
  const records=existing ? [existing] : [];
  const payloads=[];
  ctx.iwaFetchAll_=()=>records;
  ctx.iwaRequest_=(_token,method,_suffix,payload)=>{
    assert.equal(method,'patch');payloads.push(plain(payload));
    for(const r of payload.records) {
      if(r.fields['Product Key']) {
        assert.deepEqual(plain(payload.performUpsert.fieldsToMergeOn),['Product Key']);
        let record=records.find(x=>x.fields['Product Key']===r.fields['Product Key']);
        if(!record){record={id:'rec-same',fields:{}};records.push(record);}
        Object.assign(record.fields,r.fields);
      } else Object.assign(records.find(x=>x.id===r.id).fields,r.fields);
    }
    return {};
  };
  return {ctx,sheets,records,payloads,run:()=>ctx.syncWebsiteExportToAirtable({})};
}
test('confirmed zero is retained, stamped once, and repeated sync performs no write',()=>{
  const t=lifecycleSync();assert.equal(t.run().created,1);
  const record=t.records[0],stamp=record.fields['Sold Out Since'];
  assert.ok(Number.isFinite(Date.parse(stamp)));assert.equal(record.fields.Status,'Sold Out');
  assert.equal(record.fields['Post to Website'],true);
  t.payloads.length=0;assert.equal(t.run().unchanged,1);assert.equal(t.payloads.length,0);
  assert.equal(record.fields['Sold Out Since'],stamp);assert.equal(t.records.length,1);
});
test('existing sold-out record gets first observation, never Date Added as historical backdate',()=>{
  const t=lifecycleSync({}, {id:'rec-history',fields:{'Product Key':'LEG-HD-001518',Status:'Sold Out','Date Added':'2020-01-01'}});
  t.run();const r=t.records[0];assert.equal(r.id,'rec-history');assert.equal(r.fields['Date Added'],'2020-01-01');
  assert.ok(Date.parse(r.fields['Sold Out Since'])>Date.parse('2026-01-01'));
});
test('restock and corrected SKU update same key/record, clear timestamp, and later zero starts new period',()=>{
  const old='2026-01-01T00:00:00.000Z';
  const t=lifecycleSync({'AVAILABLE SQ FT':200,'QUANTITY AVAILABLE':10,'RETAIL SKU':'corrected'},
    {id:'rec-stable',fields:{'Product Key':'LEG-HD-001518',Status:'Sold Out','Sold Out Since':old}});
  t.run();const r=t.records[0];assert.equal(r.fields.Status,'In Stock');assert.equal(r.fields['Sold Out Since'],null);
  assert.equal(r.id,'rec-stable');assert.equal(r.fields['Retail SKU'],'corrected');
  const data=t.sheets['Website Export'].data[1];data[exportHeaders.indexOf('AVAILABLE SQ FT')]=0;data[exportHeaders.indexOf('QUANTITY AVAILABLE')]=0;
  t.run();assert.equal(r.fields.Status,'Sold Out');assert.notEqual(r.fields['Sold Out Since'],old);assert.equal(t.records.length,1);
});
for(const unknown of ['',null,undefined,'   ',false,'uncertain',-1,NaN,Infinity])test('unknown inventory '+String(unknown)+' clears the active lifecycle without unpublishing',()=>{
  const t=lifecycleSync({'AVAILABLE SQ FT':unknown,'QUANTITY AVAILABLE':unknown},
    {id:'rec-stable',fields:{'Product Key':'LEG-HD-001518','Sold Out Since':'2020-01-01T00:00:00.000Z',Status:'In Stock'}});
  t.run();assert.equal(t.records[0].fields.Status,'Contact for Availability');
  assert.equal(t.records[0].fields['Sold Out Since'],null);assert.equal(t.records[0].fields['Post to Website'],true);
});
test('explicit publication opt-out still unpublishes without deleting; non-flooring gate/status unchanged',()=>{
  const existing={id:'rec-stable',fields:{'Product Key':'LEG-HD-001518','Post to Website':true,Status:'Reserved'}};
  const t=lifecycleSync({'POST TO WEBSITE':'No'},existing);t.run();assert.equal(existing.fields['Post to Website'],false);assert.equal(t.records.length,1);
  const other=lifecycleSync({CATEGORY:'Tools','IN STOCK':true,'QUANTITY AVAILABLE':3},
    {id:'rec-tool',fields:{'Product Key':'LEG-HD-001518',Status:'Reserved'}});
  other.run();assert.equal(other.records[0].fields.Status,'Reserved');assert.equal(other.records[0].fields['Sold Out Since'],null);
  const out=lifecycleSync({CATEGORY:'Tools','IN STOCK':false}, {id:'rec-tool',fields:{'Product Key':'LEG-HD-001518','Post to Website':true}});
  out.run();assert.equal(out.records[0].fields['Post to Website'],true);assert.equal(out.records[0].fields.Status,'Sold Out');
});
test('zero-stock export remains ineligible for automatic Social Queue despite website retention',()=>{
  const t=lifecycleSync();const headers=plain(vm.runInContext('SOCIAL_REQUIRED_HEADERS_',t.ctx));
  t.sheets['Social Queue']=new Sheet('Social Queue',headers);
  assert.equal(t.ctx.syncSocialQueueFromCatalog().added,0);
});

test('Airtable refuses duplicate export or Airtable keys before writes',()=>{
  const {ctx,catalog,inventory,sheets}=runtime([], [sourceRow()]);
  ctx.runProductCatalogMaintenance();
  const fixture=exportFixture(catalog,'HD-1001234567');
  sheets['Website Export']=new Sheet('Website Export',exportHeaders,[fixture,fixture]);
  let writes=0;ctx.iwaRequest_=()=>{writes++;};
  assert.throws(()=>ctx.syncWebsiteExportToAirtable({}),/Duplicate Website Export/);
  assert.equal(writes,0);
  sheets['Website Export']=new Sheet('Website Export',exportHeaders,[fixture]);
  ctx.iwaFetchAll_=()=>[{fields:{'Product Key':'HD-1001234567'}},{fields:{'Product Key':'HD-1001234567'}}];
  assert.throws(()=>ctx.syncWebsiteExportToAirtable({}),/Duplicate Airtable/);
  assert.equal(writes,0);
});
test('Social Queue sync uses current export and preserves approvals, media, Buffer IDs and source hash',()=>{
  const {ctx,catalog,sheets}=runtime([], [sourceRow()]);
  ctx.runProductCatalogMaintenance();
  const headers=plain(vm.runInContext('SOCIAL_REQUIRED_HEADERS_',ctx));
  const queue=new Sheet('Social Queue',headers);
  sheets['Social Queue']=queue;
  sheets['Website Export']=new Sheet('Website Export',exportHeaders,[exportFixture(catalog,'HD-1001234567')]);
  assert.equal(ctx.syncSocialQueueFromCatalog().added,1);
  const key=value(queue,'PRODUCT KEY');
  assert.equal(value(queue,'PRICE'),'$1.49/sq ft');
  assert.match(value(queue,'PRODUCT URL'),new RegExp(key));
  assert.ok(value(queue,'SOURCE HASH'));
  const index=h=>headers.indexOf(h);
  queue.data[1][index('MEDIA URL')]='https://example.com/manual.jpg';
  queue.data[1][index('SOCIAL STATUS')]='Ready';
  queue.data[1][index('FACEBOOK CAPTION')]='Human caption';
  queue.data[1][index('FB BUFFER POST ID')]='buffer-fb';
  queue.data[1][index('IG BUFFER POST ID')]='buffer-ig';
  queue.data[1][index('LAST POSTED AT')]='2026-01-01';
  ctx.syncSocialQueueFromCatalog();
  assert.equal(queue.data.length,2);
  assert.equal(value(queue,'MEDIA URL'),'https://example.com/manual.jpg');
  assert.equal(value(queue,'SOCIAL STATUS'),'Ready');
  assert.equal(value(queue,'FB BUFFER POST ID'),'buffer-fb');
  assert.equal(value(queue,'IG BUFFER POST ID'),'buffer-ig');
  assert.equal(value(queue,'LAST POSTED AT'),'2026-01-01');
  sheets['Website Export'].data[1][exportHeaders.indexOf('DESCRIPTION')]='Changed verified facts';
  ctx.syncSocialQueueFromCatalog();
  assert.equal(value(queue,'SOCIAL STATUS'),'Needs Copy');
  assert.equal(value(queue,'FACEBOOK CAPTION'),'Human caption');
});
if(failed) { console.error(failed+' test(s) failed.'); process.exit(1); }
console.log('All Apps Script workbook tests passed.');

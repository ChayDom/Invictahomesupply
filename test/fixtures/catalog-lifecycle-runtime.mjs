// Runs repository Apps Script against an isolated workbook model, never live Sheets.
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

export const catalogHeaders = ['DISPLAY NAME','RETAILER','RETAIL SKU','BRAND','MODEL','WEBSITE CATEGORY',
  'WEB SUBCATEGORY','UNIT TYPE','SQ FT PER UNIT','SELL PRICE ($/SQ FT OR EACH)','AUTO BOX PRICE',
  'COMPARABLE RETAIL PRICE','POST TO WEBSITE','STOCK IMAGE URL','PRODUCT URL','DESCRIPTION','HIGHLIGHTS',
  'THICKNESS MM','WEAR LAYER MIL','UNDERLAYMENT ATTACHED','WATER RESISTANCE','CARD SPEC 1','CARD SPEC 2',
  'CARD SPEC 3','ENRICHMENT STATUS','NOTES','PRODUCT KEY','PRODUCT ID','SOURCE ITEM'];
export const inventoryHeaders = ['PRODUCT KEY','PRODUCT ID','RETAIL SKU','ITEM','CATEGORY','RETAILER',
  'TOTAL BUY QUANTITY','TOTAL SOLD QUANTITY','QUANTITY AVAILABLE','AVAILABLE SQ FT','BATCH COUNT','ID TYPE','SUBCATEGORY'];
export const exportHeaders = ['PRODUCT KEY','DISPLAY NAME','CATEGORY','BRAND','MODEL','RETAIL SKU','RETAILER',
  'QUANTITY AVAILABLE','UNIT TYPE','SQ FT PER UNIT','AVAILABLE SQ FT','WEBSITE PRICE','DESCRIPTION','HIGHLIGHTS',
  'PRODUCT URL','STOCK IMAGE URL','POST TO WEBSITE','ENRICHMENT STATUS','IN STOCK','COMPARABLE RETAIL PRICE',
  'BOX PRICE','SUBCATEGORY','THICKNESS MM','WEAR LAYER MIL','UNDERLAYMENT ATTACHED','WATER RESISTANCE',
  'CARD SPEC 1','CARD SPEC 2','CARD SPEC 3'];
export const row = (headers, fields) => headers.map(h => fields[h] ?? '');
export const plain = x => JSON.parse(JSON.stringify(x));
export class Sheet {
  constructor(name, headers=[], rows=[]) {
    this.name=name; this.data=[headers.slice(),...rows.map(r=>r.slice())]; this.maxRows=50;
    this.formula=name==='Product Catalog'?'=MAP(I2:I,J2:J,LAMBDA(a,p,a*p))':'';
    this.writes=[]; this.formats=[]; this.beforeWrite=()=>{}; this.afterWrite=()=>{};
  }
  getLastColumn(){return this.data[0].length;}
  getMaxRows(){return this.maxRows;}
  getLastRow(){return this.data.length;}
  insertRowsAfter(_,n){this.maxRows+=n;}
  setColumnWidth(c,width){this.formats.push({column:c,width});}
  setFrozenRows(n){this.formats.push({frozenRows:n});}
  autoResizeRows(r,n){this.formats.push({autoRows:[r,n]});}
  getDataRange(){return this.getRange(1,1,this.data.length,this.getLastColumn());}
  getRange(r,c,n=1,m=1) {
    assert.ok([r,c,n,m].every(v=>Number.isInteger(v)&&v>0),'positive dimensions');
    assert.ok(r+n-1<=this.maxRows);
    const sheet=this;
    const read=()=>Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>sheet.data[r+i-1]?.[c+j-1]??''));
    const write=(values,method)=>{
      assert.ok(['Product Catalog','Product Catalog Archive','Social Queue','Lifecycle Inventory','Evergreen Social Content'].includes(sheet.name),'history sheets are read-only');
      if(sheet.name==='Product Catalog') {
        const spill=sheet.data[0].indexOf('AUTO BOX PRICE')+1;
        assert.ok(c>spill||c+m-1<spill,'never write/clear K');
      }
      const operation={r,c,n,m,values:plain(values),method};
      sheet.beforeWrite(operation);
      for(let i=0;i<n;i++) {
        sheet.data[r+i-1] ||= [];
        for(let j=0;j<m;j++) sheet.data[r+i-1][c+j-1]=values[i][j];
      }
      sheet.writes.push(operation); sheet.afterWrite(operation);
    };
    return {
      getValues:read,getDisplayValues:()=>read().map(r=>r.map(String)),getValue:()=>read()[0][0],
      getFormula:()=>sheet.formula,
      setValues:v=>write(v,'setValues'),setValue:v=>write([[v]],'setValue'),
      getNote:()=>sheet.notes?.[r+':'+c]||'',setNote:value=>{sheet.notes||={};sheet.notes[r+':'+c]=value;},
      clearContent:()=>write(Array.from({length:n},()=>new Array(m).fill('')),'clearContent'),
      copyTo(){},getNumberFormats:()=>Array.from({length:n},()=>new Array(m).fill('$#,##0.00')),
      getNumberFormat:()=>'$#,##0.00',setNumberFormats(){},setNumberFormat(){},getDataValidation:()=>null,setDataValidation(){},
      setWrap(value){sheet.formats.push({r,c,n,m,wrap:value});return this;},
      setVerticalAlignment(value){sheet.formats.push({r,c,n,m,vertical:value});return this;},
      setFontWeight(value){sheet.formats.push({r,c,n,m,weight:value});return this;},
      setBackground(value){sheet.formats.push({r,c,n,m,background:value});return this;}
    };
  }
}
export function createRuntime({now=Date.parse('2026-09-26T12:00:00Z'),key='STAGE-ARCHIVE-UNIT',quantity=0,since,
  category='Flooring',stock,remote=true}={}) {
  const source={ 'PRODUCT KEY':'HD-1001234567','PRODUCT ID':'HD-1001234567','RETAIL SKU':'1001234567',
    ITEM:'Synthetic lifecycle oak',CATEGORY:category,RETAILER:'Home Depot',
    'TOTAL BUY QUANTITY':20,'TOTAL SOLD QUANTITY':20-quantity,'QUANTITY AVAILABLE':quantity,
    'AVAILABLE SQ FT':typeof quantity==='number'?quantity*20:'','BATCH COUNT':1,'ID TYPE':'SKU',SUBCATEGORY:'Luxury Vinyl Plank'};
  const fields={'PRODUCT KEY':key,'PRODUCT ID':source['PRODUCT ID'],'RETAIL SKU':source['RETAIL SKU'],
    RETAILER:source.RETAILER,'SOURCE ITEM':source.ITEM,'DISPLAY NAME':source.ITEM,'WEBSITE CATEGORY':category,
    'WEB SUBCATEGORY':'Luxury Vinyl Plank','SQ FT PER UNIT':20,'UNIT TYPE':'Box','POST TO WEBSITE':'Yes',
    'SELL PRICE ($/SQ FT OR EACH)':1.5,'COMPARABLE RETAIL PRICE':3,'DESCRIPTION':'Synthetic test only',
    'ENRICHMENT STATUS':'ENRICHED - VERIFIED'};
  const catalog=new Sheet('Product Catalog',catalogHeaders,[row(catalogHeaders,fields)]);
  const inventory=new Sheet('Product Inventory',inventoryHeaders,[row(inventoryHeaders,source)]);
  const sheets={'Product Catalog':catalog,'Product Inventory':inventory,
    'Inventory Source Evidence':new Sheet('Inventory Source Evidence',
      ['ITEM','RETAILER','RETAIL SKU','PRODUCT ID','BUY QUANTITY','BALANCE','BUY DATE'],
      [[source.ITEM,source.RETAILER,source['RETAIL SKU'],source['PRODUCT ID'],20,quantity,'2026-09-01T00:00:00Z']]),
    'Website Export':new Sheet('Website Export',exportHeaders),
    'Current Inventory':new Sheet('Current Inventory',['Batch ID','Purchased','Sold'],[['history',20,20]]),
    'Product Catalog Backup 2026-09-26':new Sheet('Product Catalog Backup 2026-09-26',['History'],[['untouched']])};
  const properties={AIRTABLE_TOKEN:'test-only',AIRTABLE_BASE_ID:'appLzUBCXBMzrgVx1',
    AIRTABLE_ENVIRONMENT:'staging',AIRTABLE_WORKBOOK_ID:'isolated-test-workbook',CATALOG_LIFECYCLE_CLEANUP_ENABLED:'true'};
  const events=[];let clock=now,uuid=0,records=remote?[{id:'rec-synthetic',createdTime:new Date(now).toISOString(),fields:{
    'Product Key':key,'Quantity Available':quantity,'Available Sq Ft':stock??(typeof quantity==='number'?quantity*20:null),
    Status:'Sold Out','Sold Out Since':since===undefined?new Date(now-864000000).toISOString():since,'Post to Website':true}}]:[];
  class Clock extends Date {constructor(...args){super(...(args.length?args:[clock]));} static now(){return clock;}}
  const ss={getId:()=> 'isolated-test-workbook',getSheetByName:n=>sheets[n],insertSheet:n=>sheets[n]=new Sheet(n)};
  const ctx=vm.createContext({Date:Clock,console:{log(){},warn(){},error(){}},
    SpreadsheetApp:{getActiveSpreadsheet:()=>ss,flush(){if(!refreshing)refreshExport();},CopyPasteType:{PASTE_FORMAT:'format'},
      newDataValidation:()=>({requireValueInList(){return this;},setAllowInvalid(){return this;},build(){return {};}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:n=>properties[n]??null})},
    LockService:{getScriptLock:()=>({waitLock(){},tryLock(){return true;},releaseLock(){}})},
    Utilities:{getUuid:()=>crypto.randomUUID(),sleep(){},formatDate:d=>new Date(d).toISOString().slice(0,10),
      DigestAlgorithm:{SHA_256:'SHA_256'},Charset:{UTF_8:'UTF_8'},
      computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest()),
      base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},
    UrlFetchApp:{fetch(){throw Error('Live requests forbidden');}},ScriptApp:{getProjectTriggers(){throw Error('Triggers forbidden');}}});
  for(const name of ['Config','CatalogSourceConfirmation','ProductCatalogLifecycle','ProductCatalogMaintenance','LegacyRepair','AdminTools',
    'CatalogEnrichment','EnrichmentAdmin','WebsiteAirtableSync','BufferSocialSync','SocialMedia','EvergreenSocial','EvergreenSocialLibrary']) {
    vm.runInContext(fs.readFileSync(new URL('../../Invicta Appscript Files/'+name+'.js',import.meta.url),'utf8'),ctx,{filename:name+'.js'});
  }
  const realRequest=ctx.iwaRequest_,realFetch=ctx.iwaFetchAll_;
  ctx.iwaFetchAll_=()=>plain(records);
  ctx.iwaRequest_=(token,method,suffix,payload)=>{
    events.push(method);
    if(method==='get') return {records:plain(records)};
    if(method==='delete') {
      const archived=ctx.readCatalogArchive_(ss);ctx.verifyCatalogArchive_(archived,key);
      records=records.filter(r=>r.id!==decodeURIComponent(suffix.split('=')[1]));
      return {};
    }
    const result=payload.records.map(r=>{
      if(method==='patch'){
        const found=records.find(x=>r.id?x.id===r.id:x.fields['Product Key']===r.fields['Product Key']);
        if(found){Object.assign(found.fields,r.fields);return found;}
      }
      const created={id:'rec-new-'+(++uuid),createdTime:new Date(clock).toISOString(),fields:plain(r.fields)};
      records.push(created);return created;
    });return {records:result};
  };
  let refreshing=false;
  function refreshExport() {
    refreshing=true;
    // Formula contract model: catalog permanent-key join to source confirmation.
    // This does NOT execute the native Sheets engine.
    const cm=ctx.buildHeaderMap_(catalog.data[0]),im=ctx.buildHeaderMap_(inventory.data[0]);
    ctx.refreshCatalogLifecycleInventory_(ss);
    sheets['Website Export'].data=[exportHeaders, ...catalog.data.slice(1).flatMap(c=>{
      if(!c[cm['PRODUCT KEY']])return [];
      const g=h=>c[cm[h]],q=ctx.catalogConfirmedStock_(ss,g).quantity,pack=g('SQ FT PER UNIT');
      return [row(exportHeaders,{'PRODUCT KEY':g('PRODUCT KEY'),'DISPLAY NAME':g('DISPLAY NAME'),CATEGORY:g('WEBSITE CATEGORY'),
        'RETAIL SKU':g('RETAIL SKU'),RETAILER:g('RETAILER'),'QUANTITY AVAILABLE':q,'SQ FT PER UNIT':pack,
        'UNIT TYPE':g('UNIT TYPE'),'AVAILABLE SQ FT':typeof q==='number'&&q>=0&&typeof pack==='number'&&pack>0?q*pack:'',
        'WEBSITE PRICE':g('SELL PRICE ($/SQ FT OR EACH)'),'BOX PRICE':pack*g('SELL PRICE ($/SQ FT OR EACH)'),
        'COMPARABLE RETAIL PRICE':g('COMPARABLE RETAIL PRICE'),'POST TO WEBSITE':g('POST TO WEBSITE'),
        'IN STOCK':q>0,DESCRIPTION:g('DESCRIPTION'),'ENRICHMENT STATUS':g('ENRICHMENT STATUS'),SUBCATEGORY:g('WEB SUBCATEGORY')})];
    })];
    refreshing=false;
  }
  const setQuantity=q=>{
    inventory.data[1][inventoryHeaders.indexOf('QUANTITY AVAILABLE')]=q;
    sheets['Inventory Source Evidence'].data[1][5]=q;
    refreshExport();
  };
  const acquire=q=>{
    const evidence=sheets['Inventory Source Evidence'];
    const acquired=evidence.data[1].slice();acquired[4]=q;acquired[5]=q;acquired[6]=new Date(clock+1).toISOString();
    evidence.data.push(acquired);inventory.data[1][inventoryHeaders.indexOf('QUANTITY AVAILABLE')]=q;refreshExport();
  };
  refreshExport();
  return {ctx,ss,sheets,catalog,inventory,properties,events,refreshExport,setQuantity,acquire,
    useRealNetwork:()=>{ctx.iwaRequest_=realRequest;ctx.iwaFetchAll_=realFetch;},
    get records(){return records;},set records(v){records=v;},setClock:n=>{clock=n;ctx.iwaRequest_.lastRequestAt_=0;},
    cleanup:()=>ctx.runSoldOutCatalogCleanup({apply:true,productKeys:[key]}),
    sync:()=>{refreshExport();return ctx.syncWebsiteExportToAirtable({productKeys:[key]});}};
}

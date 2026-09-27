import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({window:{AIRTABLE_CONFIG:{},SITE_CONFIG:{}},document:{addEventListener(){}}});
vm.runInContext(fs.readFileSync(new URL('../inventory.js',import.meta.url),'utf8'),ctx);
const since='2026-10-01T12:34:56.000Z', boundary=Date.parse(since)+864000000;
const fields={'Product Key':'LEG-HD-001518',Category:'Flooring',Name:'Synthetic oak','Available Sq Ft':0,'Quantity Available':0,'Sold Out Since':since,'Date Added':new Date().toISOString()};
const item=(extra={})=>ctx.mapAirtableRecord('rec-stable',{...fields,...extra});
let failures=0;
function test(name,fn){try{fn();console.log('ok - '+name)}catch(e){failures++;console.error('NOT OK - '+name+'\n'+e.stack)}}
for(const [delta,visible] of [[-1,true],[0,false],[1,false]])test('exact UTC ten-day boundary '+delta+' ms',()=>assert.equal(ctx.isVisibleInBrowse(item(),boundary+delta),visible));
test('stable backend timestamp mapped verbatim; Sold Out takes priority over New',()=>{
 const i=item();assert.equal(i.soldOutSince,since);assert.equal(i.productKey,fields['Product Key']);
 assert.equal(i.statusLabel,'Sold Out');assert.match(ctx.statusBadge(i),/Sold Out/);assert.doesNotMatch(ctx.statusBadge(i),/>New</);
});
for(const value of [null,undefined,'','invalid'])test('missing/invalid timestamp '+String(value)+' never invents expiry',()=>assert.equal(ctx.isVisibleInBrowse(item({'Sold Out Since':value}),boundary+1),true));
test('positive stock overrides stale Sold Out status/time, retains identity, and actual quantity',()=>{
 const i=item({'Available Sq Ft':20.1,'Quantity Available':1,Status:'Sold Out'});
 assert.equal(i.statusLabel,'In Stock');assert.equal(i.id,'rec-stable');assert.equal(ctx.isVisibleInBrowse(i,boundary+1),true);
 assert.match(ctx.flooringAvailabilitySummary(i),/20.1 sq ft available/);
});
for(const value of [null,undefined,'',-1,NaN,Infinity])test('unknown stock '+String(value)+' ignores old timestamp and stale In Stock status',()=>{
 const i=item({'Available Sq Ft':value,'Quantity Available':value,Status:'In Stock'});
 assert.equal(i.statusLabel,'Contact for Availability');assert.equal(ctx.isVisibleInBrowse(i,boundary+1),true);
});
test('quantity can confirm zero when square footage is absent; status text cannot',()=>{
 assert.equal(item({'Available Sq Ft':null,'Quantity Available':0,Status:'In Stock'}).statusLabel,'Sold Out');
 assert.equal(item({'Available Sq Ft':null,'Quantity Available':null,Status:'Sold Out'}).statusLabel,'Contact for Availability');
});
test('known quantity without square footage shows actual boxes, never Contact or invented square footage',()=>{
 const i=item({'Available Sq Ft':null,'Quantity Available':5,'Unit Type':'Box'});
 assert.equal(i.statusLabel,'In Stock');assert.equal(ctx.flooringAvailabilitySummary(i),'5 boxes available');
 assert.equal(ctx.flooringAvailabilitySummary(item({'Available Sq Ft':null,'Quantity Available':0})),'Sold Out');
});
test('non-flooring zero shares lifecycle; positive Reserved hold remains',()=>{
 const i=item({Category:'Tools',Status:'Reserved'});assert.equal(i.statusLabel,'Sold Out');assert.equal(ctx.isVisibleInBrowse(i,boundary),false);
 const positive=item({Category:'Tools',Status:'Reserved','Quantity Available':3});assert.equal(positive.statusLabel,'Reserved');assert.equal(ctx.isVisibleInBrowse(positive,boundary),true);
});
test('browse expiry never mutates persisted item or removes direct identity',()=>{
 const i=item(),before=JSON.stringify(i);ctx.isVisibleInBrowse(i,boundary);assert.equal(JSON.stringify(i),before);
 assert.equal(i.productKey,'LEG-HD-001518');
});
test('fulfillment markup and quote context contain no freight or pallet offer',()=>{
 const i=item({'Available Sq Ft':100});
 const copy=ctx.flooringFulfillmentMarkup(i,true);
 assert.match(copy,/Flooring is currently available for local pickup in McKinney, TX\. We do not currently ship individual flooring orders\./);
 assert.doesNotMatch(copy,/freight|pallet|may be available/i);
 const contact=fs.readFileSync(new URL('../contact.html',import.meta.url),'utf8');assert.doesNotMatch(contact,/freight|pallet/i);
});
if(failures)process.exit(1);

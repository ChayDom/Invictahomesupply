import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const context = vm.createContext({
  window:{AIRTABLE_CONFIG:{},SITE_CONFIG:{},location:{pathname:"/product.html",search:"",hash:""}},
  document:{addEventListener(){},getElementById(){return null},querySelectorAll(){return []}},
  localStorage:{getItem(){return null}},sessionStorage:{getItem(){return null}},console,URL,URLSearchParams
});
vm.runInContext(fs.readFileSync(new URL("../inventory.js",import.meta.url),"utf8"),context);
const base={id:"record-1",productKey:"permanent-1",retailSku:"SKU-22",name:"Silver Oak",webCategory:"Flooring",webSubcategory:"Luxury Vinyl Plank",statusLabel:"In Stock",price:1.55,boxPrice:31.16,sqFtPerUnit:20.1,availableSqFt:7185};
let failures=0;
function test(name,fn){try{fn();console.log("ok - "+name)}catch(error){failures++;console.error("NOT OK - "+name+"\n"+error.stack)}}
function estimate(area,waste=10,changes={}){return context.calcProjectEstimate(area,waste,{...base,...changes})}
for(const waste of [0,5,10,15])test(waste+"% waste uses shared math and authoritative Box Price",()=>{
  const r=estimate(1000,waste);
  assert.equal(r.recommended,1000*(1+waste/100));
  assert.equal(r.cases,Math.ceil(r.recommended/20.1));
  assert.equal(r.purchased,r.cases*20.1);
  assert.equal(r.cost,r.cases*31.16);
  assert.equal(r.costComputed,false);
});
test("decimal pack and rounded catalog Box Price: 55 cases, 1105.5 coverage, 1713.80 cost",()=>{
  const r=estimate(1000);assert.equal(r.cases,55);assert.equal(r.purchased,1105.5);assert.equal(r.cost,1713.8);
  assert.notEqual(r.cost,r.purchased*base.price);
});
test("exact whole-box floating boundary does not add an extra box",()=>assert.equal(estimate(100,10,{sqFtPerUnit:22}).cases,5));
test("real fractional remainder rounds boxes upward",()=>assert.equal(estimate(100.001,10,{sqFtPerUnit:22}).cases,6));
test("sufficient inventory reports no shortage",()=>{const r=estimate(1000);assert.equal(r.sufficient,true);assert.equal(r.shortageSqFt,null)});
test("exact inventory boundary is sufficient",()=>assert.equal(estimate(100,0,{sqFtPerUnit:20,availableSqFt:100}).sufficient,true));
test("insufficient inventory uses purchased coverage, not recommended area",()=>{
  const r=estimate(1000,10,{availableSqFt:834.22});assert.equal(r.sufficient,false);assert.ok(Math.abs(r.shortageSqFt-271.28)<1e-9);
  assert.match(context.calcProjectSummaryMarkup(1000,10,{...base,availableSqFt:834.22}),/271.28 sq ft additional/);
});
test("known zero stock is insufficient even when status is Out of Stock",()=>assert.equal(estimate(100,10,{availableSqFt:0,statusLabel:"Out of Stock"}).sufficient,false));
for(const value of [undefined,null,"",NaN,Infinity,-1])test("unknown inventory "+String(value)+" never claims stock or shortage",()=>{
  const r=estimate(100,10,{availableSqFt:value});assert.equal(r.inventoryKnown,false);assert.equal(r.sufficient,null);assert.equal(r.shortageSqFt,null);
});
for(const value of [undefined,null,"",0,-5,NaN,Infinity])test("missing/invalid pack "+String(value)+" requires confirmation",()=>{
  const r=estimate(100,10,{sqFtPerUnit:value});assert.equal(r.cases,null);assert.equal(r.purchased,null);assert.equal(r.cost,null);assert.equal(r.sufficient,null);assert.equal(r.shortageSqFt,null);
});
test("missing box price uses existing explicitly labeled approximate fallback",()=>{
  const r=estimate(100,10,{boxPrice:null});assert.equal(r.cost,r.cases*base.price*base.sqFtPerUnit);assert.equal(r.costComputed,true);
  assert.match(context.calcProjectSummaryMarkup(100,10,{...base,boxPrice:null}),/Approximate material price derived/);
});
test("missing both prices does not fabricate $0",()=>{
  assert.equal(estimate(100,10,{boxPrice:null,price:null}).cost,null);
  assert.doesNotMatch(context.calcProjectSummaryMarkup(100,10,{...base,boxPrice:null,price:null}),/\$0|NaN|Infinity/);
});
test("Box Price still works when square-foot price is missing",()=>assert.equal(estimate(100,10,{price:null}).cost,6*31.16));
for(const input of ["",null,undefined,"abc",0,-1,NaN,Infinity,Number.MAX_VALUE])test("invalid/overflow project "+String(input)+" is safe",()=>{
  const r=estimate(input);assert.equal(r.valid,false);assert.equal(r.cases,null);
  assert.doesNotMatch(context.calcProjectSummaryMarkup(input,10,base),/NaN|Infinity|0 boxes/);
});
test("tiny positive project needs one case",()=>assert.equal(estimate(.00001).cases,1));
test("large valid project remains finite",()=>{const r=estimate(1e12);assert.ok(Number.isFinite(r.cost));assert.ok(r.cases>0)});
test("unsafe case count does not expose Infinity or a bogus cost",()=>{const r=estimate(1e300,0);assert.equal(r.cases,null);assert.equal(r.cost,null)});
test("invalid waste value is rejected",()=>assert.equal(estimate(100,7).valid,false));
test("quote payload carries base area without applying waste twice",()=>{
  const fields=context.quoteProjectFields(base,{projectSqFt:1000,wastePercentage:10});
  assert.equal(fields["project-sqft"],1000);assert.equal(fields["recommended-sqft"],1100);
  assert.equal(fields["boxes-needed"],55);assert.equal(fields["actual-coverage"],1105.5);
  assert.equal(fields["estimated-material-cost"],"1713.80");assert.equal(fields["inventory-status"],"Sufficient");
  assert.equal(fields["retail-sku"],"SKU-22");assert.equal(fields["pickup-location"],"McKinney, TX");
  assert.match(fields.fulfillment,/no individual parcel shipping/);
});
test("quote serialization matches display precision without changing calculation precision",()=>{
  const state={projectSqFt:450,wastePercentage:10};
  const estimate=context.calcProjectEstimate(450,10,base);
  const fields=context.quoteProjectFields(base,state);
  assert.equal(String(fields["recommended-sqft"]),"495");
  assert.equal(String(fields["recommended-sqft"]),context.calcRound2(estimate.recommended));
  assert.equal(estimate.recommended,450*1.1);
  const fractional=context.quoteProjectFields(base,{projectSqFt:146.6666666667,wastePercentage:5});
  assert.equal(String(fractional["project-sqft"]),"146.67");
  assert.equal(String(fractional["recommended-sqft"]),"154");
});

test("unknown quote stock and pack do not carry false shortage",()=>{
  const fields=context.quoteProjectFields({...base,availableSqFt:null,sqFtPerUnit:null},{projectSqFt:100,wastePercentage:5});
  assert.equal(fields["inventory-status"],"Unknown");assert.equal(fields["inventory-shortage-sqft"],"");assert.equal(fields["boxes-needed"],"");
});
test("input state is keyed by permanent identity, independent of SKU corrections",()=>{
  assert.equal(context.flooringProjectKey(base),context.flooringProjectKey({...base,retailSku:"CORRECTED"}));
  assert.notEqual(context.flooringProjectKey(base),context.flooringProjectKey({...base,productKey:"other"}));
});
test("flooring pickup, delivery and freight are separate policy concepts",()=>{
  const p=context.fulfillmentForItem(base);assert.equal(p.shipping,"unavailable");assert.equal(p.localDelivery,"contact");assert.equal(p.freight,"contact-large-orders");
  const html=context.flooringFulfillmentMarkup(base,true);assert.match(html,/Local Pickup Only/);assert.match(html,/may be available/);assert.match(html,/discuss freight options/);
});
test("non-flooring has no flooring shipping restriction or calculator",()=>{
  const regular={...base,webCategory:"Appliances"};assert.equal(context.fulfillmentForItem(regular),null);
  assert.equal(context.flooringFulfillmentMarkup(regular,true),"");assert.equal(context.calculateProjectLink(regular),"");
});
for(const value of [undefined,null,0,-1,"invalid",NaN,Infinity,1.55,1])test("invalid/equal/lower Comparable Retail "+String(value)+" stays hidden",()=>{
  assert.equal(context.validComparableRetail({...base,wasPrice:value}),false);assert.equal(context.comparableRetailMarkup({...base,wasPrice:value}),"");
});
test("valid higher Comparable Retail shows actual data only",()=>{
  assert.match(context.comparableRetailMarkup({...base,wasPrice:3.29}),/Comparable Retail \$3.29 \/ sq ft/);
});
test("missing selling price prevents comparable retail claim",()=>assert.equal(context.validComparableRetail({...base,price:null,wasPrice:3.29}),false));
test("low stock still shows actual square feet",()=>assert.match(context.flooringAvailabilitySummary({...base,qtyAvailable:1,availableSqFt:20.1}),/20.1 sq ft available/));
test("unknown and zero quantities have distinct customer-facing wording",()=>{
  assert.equal(context.flooringAvailabilitySummary({...base,availableSqFt:null}),"Contact for Availability");
  assert.match(context.flooringAvailabilitySummary({...base,availableSqFt:0}),/Out of Stock/);
});
test("dynamic facets support 22 MIL and 6.5 mm without hardcoded product choices",()=>{
  assert.equal(context.facetWearLayerOptions([{wearLayerMil:22}])[0],22);
  assert.equal(context.facetThicknessOptions([{thicknessMm:6.5}])[0],6.5);
});
test("unknown flooring stock remains contactable without claiming In Stock",()=>{
  const item={...base,statusLabel:"Contact for Availability",availableSqFt:null,qtyAvailable:null};
  assert.equal(context.canInquire(item),true);
  assert.match(context.actionButtons(item),/Check Availability/);
  assert.doesNotMatch(context.actionButtons(item),/Get a Quote/);
});
if(failures)process.exit(1);

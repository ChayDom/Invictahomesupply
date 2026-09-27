import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mockInventory} from './fixtures/mock-inventory.mjs';
const since='2026-10-01T12:34:56.000Z',boundary=Date.parse(since)+864000000;
function fixture(){return {records:[
 {id:'rec-zero',fields:{'Product Key':'STAGE-ZERO',Name:'TEST Zero Oak',Category:'Flooring',Subcategory:'Luxury Vinyl Plank',Price:1.5,'Box Price':30,'Sq Ft Per Unit':20,'Available Sq Ft':0,'Quantity Available':0,'Sold Out Since':since,'Date Added':'2026-10-10',Status:'In Stock'}},
 {id:'rec-positive',fields:{'Product Key':'STAGE-POSITIVE',Name:'TEST Positive Oak',Category:'Flooring',Subcategory:'Luxury Vinyl Plank',Brand:'TEST Ridge',Price:1.5,'Box Price':30,'Sq Ft Per Unit':20,'Available Sq Ft':100,'Quantity Available':5,Status:'Sold Out'}},
 {id:'rec-unknown',fields:{'Product Key':'STAGE-UNKNOWN',Name:'TEST Unknown Oak',Category:'Flooring',Subcategory:'Luxury Vinyl Plank',Price:1.5,'Sold Out Since':since,Status:'In Stock'}},
 {id:'rec-tool',fields:{'Product Key':'STAGE-TOOL',Name:'TEST Drill',Category:'Tools','Quantity Available':0,Status:'Reserved','Sold Out Since':since}}
]};}
for(const width of [390,1440])for(const [delta,count] of [[-1,3],[0,2],[1,2]])test(`browse exact boundary ${delta}ms ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.clock.install({time:boundary+delta});await page.clock.pauseAt(boundary+delta);
 await mockInventory(page,{body:fixture()});await page.goto('/shop.html?cat=Flooring');
 const cards=page.locator(width===390?'.contractor-card:visible':'#catalog-grid .product-card');await expect(cards).toHaveCount(count);
 if(delta<0){const zero=cards.filter({hasText:'TEST Zero Oak'});await expect(zero).toContainText('Sold Out');await expect(zero.locator('.badge-new')).toHaveCount(0);}
 else {await expect(cards.filter({hasText:'TEST Zero Oak'})).toHaveCount(0);await page.fill('#search-input','TEST Zero Oak');await expect(cards).toHaveCount(0);}
});
test('expired record remains directly accessible with same permanent key and calculator',async({page})=>{
 await page.clock.install({time:boundary+1});await mockInventory(page,{body:fixture()});await page.goto('/product.html?id=STAGE-ZERO');
 await expect(page.locator('h1')).toContainText('TEST Zero Oak');await expect(page.locator('.product-price')).toContainText('Sold Out');
 await page.fill('#project-sqft','100');await expect(page.locator('#project-results')).toContainText('Not enough inventory');
});
test('cached and already-open browse crosses exact boundary without resetting timestamp',async({page})=>{
 await page.clock.install({time:boundary-1000});await page.clock.pauseAt(boundary-1000);await mockInventory(page,{body:fixture()});
 await page.goto('/shop.html?cat=Flooring');await expect(page.locator('#catalog-grid .product-card')).toHaveCount(3);
 await page.clock.fastForward(1000);await expect(page.locator('#catalog-grid .product-card')).toHaveCount(2);
 await page.reload();await expect(page.locator('#catalog-grid .product-card')).toHaveCount(2);
 const cached=await page.evaluate(()=>JSON.parse(localStorage.getItem('invicta_inventory_cache_v8')));
 expect(cached.data.find(i=>i.productKey==='STAGE-ZERO').soldOutSince).toBe(since);
 await page.click('#flooring-calc-full-link');await expect(page.locator('#calc-product-select')).not.toContainText('TEST Zero Oak');
});
test('positive/unknown status ignores stale labels; expired stock excluded from homepage counts',async({page})=>{
 await page.clock.install({time:boundary+1});await mockInventory(page,{body:fixture()});await page.goto('/shop.html?cat=Flooring');
 const positive=page.locator('.product-card').filter({hasText:'TEST Positive Oak'}),unknown=page.locator('.product-card').filter({hasText:'TEST Unknown Oak'});
 await expect(positive).not.toContainText(/Sold Out|Contact for Availability/);await expect(positive).toContainText('100');
 await expect(unknown).toContainText('Contact for Availability');await page.goto('/index.html');
 await expect(page.locator('#new-arrivals-grid')).not.toContainText('TEST Zero Oak');
});
test('restock preserves identity; positive non-flooring Reserved hold remains',async({page})=>{
 await page.clock.install({time:boundary+1});const body=fixture();body.records[0].fields['Available Sq Ft']=60;body.records[0].fields['Quantity Available']=3;body.records[0].fields['Sold Out Since']=null;
 body.records[3].fields['Quantity Available']=3;
 await mockInventory(page,{body});await page.goto('/shop.html?cat=Flooring');await expect(page.locator('#catalog-grid .product-card')).toHaveCount(3);
 await expect(page.locator('.product-card').filter({hasText:'TEST Zero Oak'})).not.toContainText('Sold Out');
 await page.goto('/shop.html?cat=Tools');await expect(page.locator('.product-card').filter({hasText:'TEST Drill'})).toContainText('Reserved');
 await expect(page.locator('#flooring-fulfillment-notice')).toBeHidden();
});

test('non-flooring zero expires; backend-removed product is not found; new acquisition may be NEW',async({page})=>{
 await page.clock.install({time:boundary});await mockInventory(page,{body:fixture()});
 await page.goto('/shop.html?cat=Tools');await expect(page.locator('.product-card').filter({hasText:'TEST Drill'})).toHaveCount(0);
 const body=fixture();body.records=body.records.filter(r=>r.id!=='rec-zero');
 body.records.push({id:'rec-new-acquisition',fields:{...fixture().records[0].fields,'Product Key':'ACQ-NEW',
   Name:'TEST Repurchased Oak','Available Sq Ft':100,'Quantity Available':5,'Sold Out Since':null,'Date Added':new Date(boundary).toISOString()}});
 await page.unroute('**/api/inventory');await mockInventory(page,{body});
 await page.evaluate(()=>localStorage.clear());await page.goto('/product.html?id=STAGE-ZERO');
 await expect(page.locator('body')).toContainText(/not found/i);
 await page.goto('/shop.html?cat=Flooring');await expect(page.locator('.product-card').filter({hasText:'TEST Repurchased Oak'}).locator('.badge-new')).toHaveText('New');
});
for(const width of [390,1440])test(`sold out and unknown accessibility ${width}px and exact fulfillment FAQ`,async({page})=>{
 await page.setViewportSize({width,height:1000});await page.clock.setFixedTime(boundary-86400000);
 await mockInventory(page,{body:fixture()});await page.goto('/shop.html?cat=Flooring');await expect(page.locator('.product-card:visible,.contractor-card:visible').first()).toBeVisible();
 const scan=await new AxeBuilder({page}).analyze();expect(scan.violations.map(v=>v.id)).toEqual([]);
 await expect(page.locator('#flooring-fulfillment-notice')).toContainText('Local delivery is available for an additional fee. Contact us for a delivery quote.');
 await page.goto('/contact.html');await expect(page.locator('#faq')).toContainText('Local delivery is available for an additional fee. Contact us for a delivery quote.');
 await expect(page.locator('body')).not.toContainText(/freight|pallet/i);
});

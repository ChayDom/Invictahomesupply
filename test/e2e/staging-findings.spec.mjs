import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mockInventory,mockFormSubmit} from './fixtures/mock-inventory.mjs';
import {FLOORING_SHOPPING_FIXTURE as fixture} from './fixtures/flooring-shopping.mjs';

for(const width of [390,1440])for(const url of ['/index.html','/shop.html?cat=Flooring','/product.html?id=LEG-HD-001157']){
 test(`staging findings: all axe rules ${width}px ${url}`,async({page})=>{
  await page.setViewportSize({width,height:1000});await mockInventory(page,{body:fixture});await page.goto(url);
  await expect(page.locator('.product-card:visible,.contractor-card:visible,.product-detail-info:visible').first()).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);
  const results=await new AxeBuilder({page}).analyze();
  expect(results.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
 });
}
test('mobile sort and photo links have product-specific names with and without images',async({page})=>{
 const body=structuredClone(fixture);body.records[2].fields.Name='Silver "Oak" & Cedar';
 body.records[2].fields.Photos=[{url:'https://example.com/photo.png',thumbnails:{small:{url:'https://example.com/photo.png'}}}];
 await page.route('https://example.com/**',r=>r.fulfill({status:200,contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"/>'}));
 await page.setViewportSize({width:390,height:1000});await mockInventory(page,{body});await page.goto('/shop.html?cat=Flooring');
 await expect(page.locator('#sort-select')).toHaveAccessibleName('Sort by');
 const links=page.locator('.contractor-card-photo');await expect(links.first()).toBeVisible();
 for(const link of await links.all()){
  const name=await link.locator('..').locator('.contractor-card-name').innerText();
  await expect(link).toHaveAccessibleName('View details for '+name);
 }
 await expect(links.filter({has:page.locator('img')})).toHaveCount(1);
 await expect(links.filter({has:page.locator('img')})).toHaveAccessibleName('View details for Silver "Oak" & Cedar');
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('button',{name:'Contractor View',exact:true}).click();
 for(const link of await page.locator('.contractor-product-photo').all())await expect(link).toHaveAccessibleName(/^View details for .+/);
});
for(const action of ['quote','calculator'])test(`all axe rules with ${action} modal open`,async({page})=>{
 await mockInventory(page,{body:fixture});await page.goto('/product.html?id=LEG-HD-001157');await page.fill('#project-sqft','450');
 if(action==='quote')await page.getByRole('button',{name:'Get a Quote',exact:true}).click();
 else await page.click('#project-multi-room');
 const results=await new AxeBuilder({page}).analyze();
 expect(results.violations.map(v=>({id:v.id,impact:v.impact,targets:v.nodes.map(n=>n.target)}))).toEqual([]);
});
test('450 sq ft 10% waste serializes 495 in hidden fields and mock submitted payload',async({page})=>{
 const submissions=await mockFormSubmit(page);await mockInventory(page,{body:fixture});
 await page.goto('/product.html?id=LEG-HD-001157');await page.fill('#project-sqft','450');
 await expect(page.locator('#project-results')).toContainText('495 sq ft');
 await page.getByRole('button',{name:'Get a Quote',exact:true}).click();
 await expect(page.locator('#quote-form [name="recommended-sqft"]')).toHaveValue('495');
 await page.locator('#quote-form [name="name"]').fill('Synthetic');await page.locator('#quote-form [name="phone"]').fill('2145550100');
 await page.click('#quote-submit-btn');await expect(page.locator('#quote-modal-success-view')).toBeVisible();
 expect(submissions).toHaveLength(1);expect(submissions[0]['recommended-sqft']).toBe('495');
});

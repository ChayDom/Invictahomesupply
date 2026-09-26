import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {mockInventory,mockFormSubmit} from "./fixtures/mock-inventory.mjs";
import {FLOORING_SHOPPING_FIXTURE as fixture} from "./fixtures/flooring-shopping.mjs";
const productUrl="/product.html?id=LEG-HD-001157#project-calculator";
async function start(page, url=productUrl, body=fixture){
  await mockInventory(page,{body});await page.goto(url);
  await expect(page.locator(".product-card:visible, .contractor-card:visible, #project-sqft:visible").first()).toBeVisible();
}
async function result(page,label,value,scope="#project-results"){
  await expect(page.locator(scope).locator(".project-results > div").filter({has:page.getByText(label,{exact:true})}).locator("dd")).toHaveText(value);
}
async function fillRoom(page,n,l,w){
  const room=page.locator(".calc-room").nth(n);
  await room.locator('[data-dim="length-ft"]').fill(l);
  await room.locator('[data-dim="width-ft"]').fill(w);
}

test("flooring cards, Contractor View and detail show pickup and real comparable pricing",async({page})=>{
  await start(page,"/shop.html?cat=Flooring");
  await expect(page.locator("#flooring-fulfillment-notice")).toBeVisible();
  const card=page.locator(".product-card").filter({hasText:"Silver Oak"});
  await expect(card).toContainText("Local Pickup Only");
  await expect(card).toContainText("McKinney, TX");await expect(card).toContainText("Comparable Retail $3.29");
  await expect(card).toContainText("$31.16 / box");await expect(card).toContainText("7,185 sq ft");
  await card.getByRole("link",{name:"Calculate My Project"}).click();
  await expect(page.locator("#project-sqft")).toBeFocused();
  await expect(page.locator(".flooring-fulfillment")).toContainText("We do not currently ship individual flooring orders");
  await expect(page.locator(".flooring-fulfillment")).toContainText("Local delivery may be available");
  await expect(page.locator(".flooring-fulfillment")).toContainText("discuss freight options");
});
for(const [waste,recommended,boxes,coverage,cost] of [
  [0,"1,000 sq ft","50","1,005 sq ft","$1,558.00"],
  [5,"1,050 sq ft","53","1,065.3 sq ft","$1,651.48"],
  [10,"1,100 sq ft","55","1,105.5 sq ft","$1,713.80"],
  [15,"1,150 sq ft","58","1,165.8 sq ft","$1,807.28"]
])test("product calculator "+waste+"% waste uses rounded Box Price",async({page})=>{
  await start(page);await page.fill("#project-sqft","1000");await page.selectOption("#project-waste",String(waste));
  await result(page,"Recommended",recommended);await result(page,"Boxes Needed",boxes);
  await result(page,"Actual Coverage",coverage);await result(page,"Estimated Material",cost);
  await expect(page.locator("#project-results")).toContainText("enough flooring for this project");
});
test("exact shortage uses whole-case purchased coverage",async({page})=>{
  const body=structuredClone(fixture);body.records[2].fields["Available Sq Ft"]=834.22;
  await start(page,productUrl,body);await page.fill("#project-sqft","1000");
  await expect(page.locator("#project-results")).toContainText("Not enough inventory for this project");
  await expect(page.locator("#project-results")).toContainText("271.28 sq ft additional flooring needed");
});
for(const field of ["Available Sq Ft","Sq Ft Per Unit"])test("missing "+field+" avoids false stock and shortage",async({page})=>{
  const body=structuredClone(fixture);delete body.records[2].fields[field];
  await start(page,productUrl,body);await page.fill("#project-sqft","1000");
  await expect(page.locator("#project-results")).toContainText("Inventory quantity confirmation required");
  await expect(page.locator("#project-results")).not.toContainText("additional flooring needed");
  if(field==="Sq Ft Per Unit")await result(page,"Boxes Needed","Pack size confirmation required");
});
test("missing prices and invalid inputs never show $0, NaN or Infinity",async({page})=>{
  const body=structuredClone(fixture);delete body.records[2].fields["Box Price"];delete body.records[2].fields.Price;
  await start(page,productUrl,body);await page.fill("#project-sqft","1000");
  await result(page,"Estimated Material","Price confirmation required");
  for(const area of ["","0","-1"]){
    await page.fill("#project-sqft",area);await expect(page.locator("#project-results")).toContainText("Enter a positive project area");
  }
  await expect(page.locator("#project-results")).not.toContainText(/NaN|Infinity|\$0/);
});
test("quote submission carries full calculated project and fulfillment",async({page})=>{
  const submissions=await mockFormSubmit(page);
  await start(page);await page.fill("#project-sqft","1000");
  await page.getByRole("button",{name:"Get a Quote",exact:true}).click();
  await expect(page.locator("#quote-sqft-input")).toHaveValue("1000");
  await expect(page.locator("#quote-project-context")).toContainText("$1,713.80");
  await page.locator('#quote-form [name="name"]').fill("Test Customer");
  await page.locator('#quote-form [name="phone"]').fill("2145550100");
  await page.click("#quote-submit-btn");
  await expect(page.locator("#quote-modal-success-view")).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({
    "product-key":"LEG-HD-001157","product-name":"Silver Oak Luxury Vinyl Plank",
    "retail-sku":"100123456","project-sqft":"1000","waste-percent":"10",
    "recommended-sqft":"1100","boxes-needed":"55","actual-coverage":"1105.5",
    "estimated-material-cost":"1713.80","available-sqft":"7185","inventory-status":"Sufficient",
    "box-price":"$31.16","pickup-location":"McKinney, TX","cost-basis":"Catalog Box Price"
  });expect(submissions[0].fulfillment).toContain("no individual parcel shipping");
});
test("editing quote area refreshes all hidden project fields",async({page})=>{
  await start(page);await page.fill("#project-sqft","1000");await page.selectOption("#project-waste","5");
  await page.getByRole("button",{name:"Get a Quote",exact:true}).click();await page.fill("#quote-sqft-input","200");
  await expect(page.locator('#quote-form [name="project-sqft"]')).toHaveValue("200");
  await expect(page.locator('#quote-form [name="recommended-sqft"]')).toHaveValue("210");
  await expect(page.locator('#quote-form [name="boxes-needed"]')).toHaveValue("11");
});
test("general calculator multi-room feet/inches names, quote state and reset",async({page})=>{
  await start(page,"/shop.html?cat=Flooring");
  await page.click("#flooring-calc-full-link");await page.selectOption("#calc-product-select","recFLOORING001");
  await page.locator(".calc-room-name input").fill("Living Room");await fillRoom(page,0,"10","12");
  await page.locator('.calc-room [data-dim="length-in"]').fill("6");
  await page.click("#calc-add-room");await page.locator(".calc-room-name input").nth(1).fill("Bedroom 1");
  await fillRoom(page,1,"5","4");await expect(page.locator("#calc-total-area")).toHaveText("146 sq ft");
  await page.click('.calc-waste-btn[data-waste="5"]');await expect(page.locator("#calc-recommended")).toHaveText("153.3 sq ft");
  await result(page,"Boxes Needed","8","#calc-purchase-summary");
  await expect(page.locator("#calc-purchase-summary")).toContainText("Local Pickup Only");
  await page.click("#calc-use-for-quote");await expect(page.locator("#quote-sqft-input")).toHaveValue("146");
  await expect(page.locator('#quote-form [name="waste-percent"]')).toHaveValue("5");
  await expect(page.locator('#quote-form [name="recommended-sqft"]')).toHaveValue("153.3");
  await page.click("#quote-modal-close");await page.click("#flooring-calc-full-link");
  await expect(page.locator("#calc-product-select")).toHaveValue("");
  await expect(page.locator(".calc-room")).toHaveCount(1);await expect(page.locator("#calc-purchase-summary")).toBeHidden();
});
test("general quote never leaks project state between products",async({page})=>{
  await start(page,"/shop.html?cat=Flooring");await page.click("#flooring-calc-full-link");
  await page.selectOption("#calc-product-select","recFLOORING001");await fillRoom(page,0,"10","10");await page.click("#calc-use-for-quote");
  await page.click("#quote-modal-close");
  await page.locator('#catalog-grid [data-quote-id="recFLOORING002"]').click();
  await expect(page.locator("#quote-sqft-input")).toHaveValue("");
  await expect(page.locator('#quote-form [name="project-sqft"]')).toHaveValue("");
  await expect(page.locator('#quote-form [name="boxes-needed"]')).toHaveValue("");
});
for(const query of ["Silver Oak","LifeProof","22 MIL","6.5 mm","waterproof","100123456"])test("search supports customer field "+query,async({page})=>{
  await start(page,"/shop.html?cat=Flooring");await page.fill("#search-input",query);
  await expect(page.locator("#catalog-grid .product-card").filter({hasText:"Silver Oak"})).toBeVisible();
});
test("dynamic filters combine brand/type/specs/search and reset",async({page})=>{
  await start(page,"/shop.html?cat=Flooring");
  await page.selectOption("#brand-filter","LifeProof");await page.selectOption("#subcategory-filter","Luxury Vinyl Plank");
  await page.selectOption("#wear-layer-filter","22");await page.selectOption("#thickness-filter","6.5");
  await page.selectOption("#water-resistance-filter","Waterproof");await page.selectOption("#underlayment-filter","Yes");
  await page.fill("#search-input","Silver Oak");await expect(page.locator("#catalog-grid .product-card")).toHaveCount(1);
  await page.fill("#search-input","no such material");await expect(page.locator("#catalog-grid .product-card")).toHaveCount(0);
  await page.click("#clear-all-filters-btn");await expect(page.locator("#catalog-grid .product-card")).toHaveCount(3);
});
test("Contractor View retains calculator and accurate price/fulfillment",async({page})=>{
  await start(page,"/shop.html?cat=Flooring");await page.click('[data-view="contractor"]');
  const row=page.locator("#contractor-table-body tr").filter({hasText:"Silver Oak"});
  await expect(row).toContainText("Local Pickup Only");await expect(row).toContainText("$31.16");
  await expect(row.getByRole("link",{name:"Calculate My Project"})).toBeVisible();
  const heights=await row.locator("td").evaluateAll(cells=>cells.map(c=>c.getBoundingClientRect().height));
  expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);
});
test("non-flooring retains availability flow without pickup-only labels",async({page})=>{
  await start(page,"/shop.html?cat=Appliances");
  await expect(page.locator("#flooring-fulfillment-notice")).toBeHidden();
  await expect(page.locator("#catalog-grid .flooring-pickup")).toHaveCount(0);
  await expect(page.locator("#catalog-grid .project-calculate-link")).toHaveCount(0);
  await page.locator('#catalog-grid [data-availability-id="recAPPLIANCE001"]').click();
  await expect(page.locator("#availability-modal-overlay")).toBeVisible();
});
for(const width of [320,390,430,880,1440])test("product calculator and modal no overflow at "+width,async({page})=>{
  await page.setViewportSize({width,height:1000});await start(page);await page.fill("#project-sqft","1000");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await expect(page.locator("#project-multi-room")).toBeVisible();
  expect((await page.locator("#project-multi-room").boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.click("#project-multi-room");await expect(page.locator("#calc-product-select")).toBeFocused();
  await fillRoom(page,0,"10","12");expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
  await page.keyboard.press("Escape");await expect(page.locator("#calc-modal-overlay")).toBeHidden();
  await expect(page.locator("#project-multi-room")).toBeFocused();
});
test("calculator and calculated quote retain accessible controls and focus trap",async({page})=>{
  await start(page);await page.fill("#project-sqft","1000");
  let scan=await new AxeBuilder({page}).include("#product-detail-root").analyze();
  expect(scan.violations.filter(v=>["critical","serious"].includes(v.impact))).toEqual([]);
  await page.click("#project-multi-room");
  scan=await new AxeBuilder({page}).include("#calc-modal-overlay").analyze();
  expect(scan.violations.filter(v=>["critical","serious"].includes(v.impact))).toEqual([]);
  await page.locator("#calc-modal-close").focus();await page.keyboard.press("Shift+Tab");
  await expect(page.locator("#calc-done")).toBeFocused();
});

test("unknown stock remains contactable and known zero is clearly out of stock",async({page})=>{
  const body=structuredClone(fixture);
  delete body.records[2].fields["Available Sq Ft"];delete body.records[2].fields["Quantity Available"];
  await start(page,productUrl,body);
  await expect(page.locator(".product-price")).toContainText("Contact for Availability");
  await page.getByRole("button",{name:"Check Availability",exact:true}).click();
  await expect(page.locator("#availability-modal-overlay")).toBeVisible();
  await page.click("#availability-modal-close");
  body.records[2].fields["Available Sq Ft"]=0;await mockInventory(page,{body});
  await page.evaluate(()=>localStorage.clear());await page.reload();
  await expect(page.locator(".product-price")).toContainText("Out of Stock");
  await page.fill("#project-sqft","100");await expect(page.locator("#project-results")).toContainText("Not enough inventory");
});
test("mobile Flooring Calculator entry and filter drawer remain usable",async({page})=>{
  await page.setViewportSize({width:390,height:844});await start(page,"/shop.html?cat=Flooring");
  await page.click("#mobile-calc-btn");await expect(page.locator("#calc-modal-overlay")).toBeVisible();
  await fillRoom(page,0,"10","10");await expect(page.locator("#calc-recommended")).toHaveText("110 sq ft");
  await page.keyboard.press("Escape");await expect(page.locator("#mobile-calc-btn")).toBeFocused();
  await page.click("#mobile-filters-btn");await page.selectOption("#wear-layer-filter","22");
  await page.click("#sidebar-apply-btn-mobile");await expect(page.locator("#catalog-grid .product-card")).toHaveCount(1);
});
test("flooring detail gallery retains click and keyboard selection",async({page})=>{
  const body=structuredClone(fixture);
  body.records[2].fields.Photos=[{url:"https://images.example.test/images/mock-one.png"},{url:"https://images.example.test/images/mock-two.png"}];
  await page.route("**/images/mock-*.png",route=>route.fulfill({contentType:"image/svg+xml",body:'<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>'}));
  await start(page,productUrl,body);
  await page.locator(".product-detail-media .thumb").nth(1).click();
  await expect(page.locator("[data-main-photo]")).toHaveAttribute("src",/mock-two/);
  await page.locator(".product-detail-media .thumb").first().focus();await page.keyboard.press("Enter");
  await expect(page.locator("[data-main-photo]")).toHaveAttribute("src",/mock-one/);
});

test("collapsed desktop cards align but expanding details does not stretch siblings",async({page})=>{
  await page.setViewportSize({width:1440,height:1000});await start(page,"/shop.html?cat=Flooring");
  const cards=page.locator("#catalog-grid .product-card");
  const heights=await cards.evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
  expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);
  await cards.first().locator("summary").click();
  expect(await page.locator("#catalog-grid").evaluate(n=>getComputedStyle(n).alignItems)).toBe("start");
});
test("quote to multi-room calculator preserves customer fields and avoids double waste",async({page})=>{
  await start(page,"/shop.html?cat=Flooring");
  await page.locator('#catalog-grid [data-quote-id="recFLOORING001"]').click();
  await page.locator('#quote-form [name="name"]').fill("Existing customer");
  await page.click("#quote-calc-link");
  await expect(page.locator("#calc-product-select")).toHaveValue("recFLOORING001");
  await expect(page.locator(".calc-room .calc-input").first()).toBeFocused();
  await fillRoom(page,0,"10","12");await page.click("#calc-use-for-quote");
  await expect(page.locator('#quote-form [name="name"]')).toHaveValue("Existing customer");
  await expect(page.locator("#quote-sqft-input")).toHaveValue("120");
  await expect(page.locator('#quote-form [name="recommended-sqft"]')).toHaveValue("132");
});

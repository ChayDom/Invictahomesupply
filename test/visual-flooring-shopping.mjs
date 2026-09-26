// Run against the local Python test server only. All catalog/form requests mocked.
// node test/visual-flooring-shopping.mjs <absolute-output-directory>
import fs from "node:fs";
import path from "node:path";
import {chromium} from "@playwright/test";
import {mockInventory,mockFormSubmit} from "./e2e/fixtures/mock-inventory.mjs";
import {FLOORING_SHOPPING_FIXTURE as fixture} from "./e2e/fixtures/flooring-shopping.mjs";
const output=process.argv[2];
if(!output || !path.isAbsolute(output))throw new Error("Provide an absolute screenshot output directory.");
fs.mkdirSync(output,{recursive:true});
const browser=await chromium.launch();
try{
  for(const width of [390,1440]){
    const page=await browser.newPage({viewport:{width,height:1000}});
    await mockFormSubmit(page);await mockInventory(page,{body:fixture});
    await page.goto("http://127.0.0.1:8099/shop.html?cat=Flooring");
    await page.locator(".product-card:visible, .contractor-card:visible").first().waitFor();
    await page.screenshot({path:path.join(output,"flooring-shop-"+width+".png"),fullPage:true});
    if(width===1440){
      await page.click('[data-view="contractor"]');
      await page.screenshot({path:path.join(output,"flooring-contractor-desktop.png"),fullPage:true});
    }
    await page.goto("http://127.0.0.1:8099/product.html?id=LEG-HD-001157#project-calculator");
    await page.fill("#project-sqft","1000");
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(output,"flooring-product-"+width+".png"),fullPage:true});
    await page.click("#project-multi-room");
    await page.locator('.calc-room [data-dim="length-ft"]').fill("10");
    await page.locator('.calc-room [data-dim="width-ft"]').fill("12");
    await page.screenshot({path:path.join(output,"flooring-multi-room-"+width+".png")});
    await page.keyboard.press("Escape");await page.getByRole("button",{name:"Get a Quote",exact:true}).click();
    await page.screenshot({path:path.join(output,"flooring-quote-"+width+".png")});
    await page.close();
  }
  console.log("Saved 9 synthetic-catalog screenshots to "+output);
}finally{await browser.close();}

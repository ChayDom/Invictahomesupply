import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../shop.html", import.meta.url), "utf8");
assert.match(html, /<title>Discount Flooring &amp; Home Improvement Inventory \| Invicta Home Supply<\/title>/);
assert.match(html, /<link rel="canonical" href="https:\/\/invictahomesupply\.com\/shop">/);
assert.match(html, /McKinney, TX and the DFW area/);
console.log("ok - shop SEO metadata is locally relevant and canonical");

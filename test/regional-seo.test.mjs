import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pages = [
  ["dfw-north-texas", "DFW & North Texas"],
  ["durant-ok", "Durant, Oklahoma"],
  ["northwest-arkansas", "Northwest Arkansas"],
];

function read(route) {
  return fs.readFileSync(path.join(root, "service-area", route, "index.html"), "utf8");
}

const documents = pages.map(([route, label]) => ({ route, label, html: read(route) }));
const titles = new Set();
const descriptions = new Set();
for (const { route, html } of documents) {
  assert.match(html, /<title>[^<]+<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]+">/);
  assert.match(html, new RegExp(`rel="canonical" href="https://invictahomesupply\\.com/service-area/${route}"`));
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="twitter:description"/);
  assert.match(html, /"@type":"WebPage"/);
  assert.match(html, /"@type":"Service"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /href="\/shop"/);
  assert.match(html, /href="\/contact\.html"/);
  assert.match(html, /href="\/service-area\//);
  assert.doesNotMatch(html, /"openingHours"|"address"\s*:/i);
  assert.doesNotMatch(html, /netlify\.app/);
  titles.add(html.match(/<title>([^<]+)/)[1]);
  descriptions.add(html.match(/<meta name="description" content="([^"]+)/)[1]);
}
assert.equal(titles.size, 3);
assert.equal(descriptions.size, 3);

const homepage = fs.readFileSync(path.join(root, "index.html"), "utf8");
assert.match(homepage, /"name": "McKinney"/);
assert.match(homepage, /Dallas-Fort Worth \/ North Texas/);
assert.match(homepage, /\/service-area\/dfw-north-texas/);
assert.match(homepage, /\/service-area\/durant-ok/);
assert.match(homepage, /\/service-area\/northwest-arkansas/);
assert.doesNotMatch(homepage, /"openingHours"|"address"\s*:/);

const inventory = fs.readFileSync(path.join(root, "inventory.js"), "utf8");
assert.match(inventory, /class="comparable-retail"/);
assert.match(inventory, /class="price-avail price-avail-qty"/);
assert.doesNotMatch(inventory, /availParts/);

console.log("ok - regional pages have unique metadata, schema, links, and conservative claims");
console.log("ok - homepage local schema and product-card price/availability separation are present");

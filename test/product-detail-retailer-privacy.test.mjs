#!/usr/bin/env node
// ===================================================================
// Regression test: the Retailer field (where Invicta sourced a product)
// must never be shown to customers, while remaining fully available
// internally.
//
// Background: productDetailSpecRows() (inventory.js, used only by
// initProductDetail() on product.html) used to add("Retailer",
// item.retailer) as a visible spec row on the product-detail page —
// the only place any code rendered item.retailer as text. Removed. This
// does NOT touch mapAirtableRecord() (still maps Airtable's "Retailer"
// field into item.retailer) or searchMatches() (still matches search
// queries against item.retailer internally) — Retailer stays real,
// fetched, internal data; it's only ever kept out of rendered HTML.
//
// Also guards against the two ways this fix could go wrong: dropping
// Brand/Model/Subcategory/other specs along with Retailer, or confusing
// a brand name that reads like a retailer (e.g. "Home Decorators
// Collection") with the actual internal Retailer field — Brand must
// always render regardless of what string it holds.
//
// Imports the real inventory.js via vm.runInThisContext (same fake-DOM
// technique as test/product-page-client-metadata.test.mjs) — no
// reimplementation of productDetailSpecRows()/initProductDetail() here.
//
// Run with: node test/product-detail-retailer-privacy.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");

// --- Minimal fake DOM (same shape as test/product-page-client-metadata.test.mjs) ---
function makeAttrElement(initial = {}) {
  const attrs = { ...initial };
  return {
    getAttribute(name) { return attrs[name] ?? null; },
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
    remove() {},
  };
}

function makeContainer() {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function freshDocumentState() {
  const elements = {
    'meta[name="description"]': makeAttrElement({ content: "generic description" }),
    'link[rel="canonical"]': makeAttrElement({ href: "https://invictahomesupply.com/product.html" }),
    'meta[property="og:type"]': makeAttrElement({ content: "website" }),
    'meta[property="og:url"]': makeAttrElement({ content: "https://invictahomesupply.com/product.html" }),
    'meta[property="og:title"]': makeAttrElement({ content: "Product | Invicta Home Supply" }),
    'meta[property="og:description"]': makeAttrElement({ content: "generic description" }),
    'meta[property="og:image"]': makeAttrElement({ content: "https://invictahomesupply.com/assets/og/invicta-og-image.png" }),
    'meta[name="twitter:title"]': makeAttrElement({ content: "Product | Invicta Home Supply" }),
    'meta[name="twitter:description"]': makeAttrElement({ content: "generic description" }),
    'meta[name="twitter:image"]': makeAttrElement({ content: "https://invictahomesupply.com/assets/og/invicta-og-image.png" }),
  };
  const container = makeContainer();
  let metaRobotsEl = null;
  const doc = {
    title: "Product | Invicta Home Supply",
    getElementById: (id) => (id === "product-detail-root" ? container : null),
    querySelector: (sel) => {
      if (sel === 'meta[name="robots"]') return metaRobotsEl;
      return elements[sel] || null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => {
      const el = makeAttrElement({});
      el.tagName = tag;
      return el;
    },
    head: { appendChild: (el) => { metaRobotsEl = el; } },
    addEventListener: () => {},
    body: { classList: { add() {}, remove() {}, toggle() {} } },
  };
  return { doc, elements, container };
}

globalThis.window = { AIRTABLE_CONFIG: {}, SITE_CONFIG: { phoneHref: "+12145522145" }, location: { search: "?id=LEG-HD-001157", hash: "", pathname: "/product.html", href: "https://invictahomesupply.com/product.html?id=LEG-HD-001157" } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
let currentDoc = freshDocumentState().doc;
globalThis.document = new Proxy({}, {
  get: (_t, prop) => currentDoc[prop],
  set: (_t, prop, value) => { currentDoc[prop] = value; return true; },
});

vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

function flooringItem(overrides) {
  return {
    id: "recTEST0000000001",
    productKey: "LEG-HD-001157",
    name: "Test Oak LVP Flooring",
    webCategory: "Flooring",
    webSubcategory: "Luxury Vinyl Plank",
    brand: "LifeProof",
    model: "LP-4400",
    retailer: "Home Depot",
    price: 2.49,
    sqFtPerUnit: 24,
    availableSqFt: 480,
    thicknessMm: 5,
    wearLayerMil: 12,
    statusLabel: "In Stock",
    details: "Waterproof luxury vinyl plank flooring, brand-new overstock.",
    photos: ["https://example.com/photo1.jpg"],
    ...overrides,
  };
}

let failures = 0;
function test(name, fn) {
  const { doc, elements, container } = freshDocumentState();
  currentDoc = doc;
  globalThis.window.location = { search: "?id=LEG-HD-001157", hash: "", pathname: "/product.html", href: "https://invictahomesupply.com/product.html?id=LEG-HD-001157" };
  try {
    fn({ doc, elements, container });
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.stack || err.message}`);
  }
}

test("the rendered product-detail page never includes the word 'Retailer' as a label", ({ container }) => {
  initProductDetail([flooringItem()]);
  assert.doesNotMatch(container.innerHTML, /Retailer/);
});

test("the rendered product-detail page never includes the internal retailer value's text", ({ container }) => {
  initProductDetail([flooringItem({ retailer: "Acme Wholesale Liquidators" })]);
  assert.doesNotMatch(container.innerHTML, /Acme Wholesale Liquidators/);
});

test("Brand still renders, even though it happens to sound like a retailer's private-label line ('Home Decorators Collection') — Brand is never confused with Retailer", ({ container }) => {
  initProductDetail([flooringItem({ brand: "Home Decorators Collection", retailer: "Home Depot" })]);
  assert.match(container.innerHTML, /Home Decorators Collection/);
  // The actual internal retailer value must still not leak into the page.
  assert.doesNotMatch(container.innerHTML, />Home Depot</);
});

test("Model, Subcategory, and Flooring's structured specs (Wear Layer, Thickness) still render", ({ container }) => {
  initProductDetail([flooringItem()]);
  assert.match(container.innerHTML, /LP-4400/);
  assert.match(container.innerHTML, /Luxury Vinyl Plank/);
  assert.match(container.innerHTML, /12 MIL/);
  assert.match(container.innerHTML, /5 mm/);
});

test("a non-Flooring item still renders Brand, Subcategory, and Quantity Available with no Retailer row", ({ container }) => {
  initProductDetail([flooringItem({
    webCategory: "Appliances",
    webSubcategory: "Refrigerator",
    brand: "Whirlpool",
    retailer: "Lowe's",
    qtyAvailable: 3,
  })]);
  assert.match(container.innerHTML, /Whirlpool/);
  assert.match(container.innerHTML, /Refrigerator/);
  assert.match(container.innerHTML, /Quantity Available/);
  assert.doesNotMatch(container.innerHTML, /Retailer/);
  assert.doesNotMatch(container.innerHTML, /Lowe's/);
});

test("product-page metadata (title/canonical/OG/Twitter) never includes the retailer value", ({ elements }) => {
  initProductDetail([flooringItem({ retailer: "Acme Wholesale Liquidators" })]);
  for (const key of Object.keys(elements)) {
    const value = elements[key].getAttribute("content") ?? elements[key].getAttribute("href") ?? "";
    assert.doesNotMatch(value, /Acme Wholesale Liquidators/, `${key} must not leak the retailer value`);
  }
  assert.doesNotMatch(currentDoc.title, /Acme Wholesale Liquidators/);
});

test("internal data is unaffected: mapAirtableRecord() still maps Airtable's Retailer field onto item.retailer", () => {
  const mapped = mapAirtableRecord("rec123", {
    "Name": "Test Item",
    "Category": "Flooring",
    "Retailer": "Home Depot",
    "Post to Website": true,
  });
  assert.equal(mapped.retailer, "Home Depot");
});

test("internal data is unaffected: searchMatches() still matches a query against item.retailer", () => {
  const item = flooringItem({ retailer: "Menards" });
  assert.equal(searchMatches(item, "menards"), true);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll product-detail retailer-privacy tests passed.");

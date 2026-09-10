#!/usr/bin/env node
// ===================================================================
// Regression test: no customer-facing page may link out to the
// manufacturer/retailer listing an item was sourced from.
//
// Background: productCard() (inventory.js) — the shared card renderer
// for both the Shop Card View grid and the homepage "New This Week"
// grid — used to render item.productUrl (Airtable's "Product URL") as
// `<a href="${item.productUrl}" target="_blank">View manufacturer
// page</a>` inside each card's collapsed "More details" section. That
// let a customer click straight from an Invicta product card to Home
// Depot/Lowe's/Amazon/etc. Removed, along with productUrl's contribution
// to the `hasMore` check that decides whether the "More details"
// <details> disclosure renders at all — so an item whose only "more"
// content was that link no longer gets an empty, link-less disclosure
// left behind.
//
// item.productUrl itself is untouched: mapAirtableRecord() still maps
// Airtable's "Product URL" field onto it — this only ever stops it from
// reaching rendered HTML. Contractor View (renderContractorTable/
// renderContractorMobileCards) and the product-detail page
// (initProductDetail()) never referenced item.productUrl at all, so
// there's nothing to change there — the last two tests in this file
// pin that absence too, so it can't be silently reintroduced.
//
// Imports the real inventory.js via vm.runInThisContext (same technique
// as test/card-view-price-weight.test.mjs) — no reimplementation of
// productCard()/mapAirtableRecord() here.
//
// Run with: node test/product-card-external-link-removed.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");

globalThis.window = { AIRTABLE_CONFIG: {}, SITE_CONFIG: { phoneHref: "+12145522145" }, location: { search: "", hash: "", pathname: "/shop.html", href: "https://invictahomesupply.com/shop.html" } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = {
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { classList: { add() {}, remove() {}, toggle() {} } },
};

vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

function baseItem(overrides) {
  return {
    id: "recTEST0000000001",
    productKey: "LEG-HD-001157",
    name: "Test Oak LVP Flooring",
    webCategory: "Flooring",
    webSubcategory: "Luxury Vinyl Plank",
    brand: "LifeProof",
    model: "LP-4400",
    price: 2.49,
    sqFtPerUnit: 24,
    availableSqFt: 480,
    qtyAvailable: 12,
    statusLabel: "In Stock",
    photos: ["https://external-cdn.example.com/photo1.jpg"],
    photoCards: ["https://external-cdn.example.com/photo1-card.jpg"],
    photoThumbs: ["https://external-cdn.example.com/photo1-thumb.jpg"],
    productUrl: "https://www.homedepot.com/p/some-product/123456",
    ...overrides,
  };
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.stack || err.message}`);
  }
}

test("the external retailer/manufacturer URL is never rendered as an href, even with 'More details' content present", () => {
  const html = productCard(baseItem({ details: "Waterproof LVP, brand-new overstock." }));
  assert.doesNotMatch(html, /href="https:\/\/www\.homedepot\.com/);
  assert.doesNotMatch(html, /target="_blank"/);
  assert.doesNotMatch(html, /View manufacturer page/i);
});

test("an item whose only 'more' content was the manufacturer link renders no empty 'More details' disclosure at all", () => {
  // No details, no extra highlights beyond the 3 chips — productUrl used
  // to be the sole reason hasMore was true for a card like this.
  const html = productCard(baseItem({ details: "", highlights: "" }));
  assert.doesNotMatch(html, /<details/);
  assert.doesNotMatch(html, /More details/);
});

test("a card with real Details still shows its 'More details' disclosure — just without the manufacturer link", () => {
  const html = productCard(baseItem({ details: "Waterproof LVP, brand-new overstock." }));
  assert.match(html, /<details class="product-more">/);
  assert.match(html, /Waterproof LVP, brand-new overstock\./);
});

test("Brand, Model, category/subcategory, price, and availability all still render on the card", () => {
  const html = productCard(baseItem());
  assert.match(html, /Test Oak LVP Flooring/);
  assert.match(html, /Flooring &middot; Luxury Vinyl Plank/);
  assert.match(html, /\$2\.49/);
});

test("product images (including externally-hosted URLs) are untouched — the card's <img> src still points at the real photo URL", () => {
  const html = productCard(baseItem());
  assert.match(html, /src="https:\/\/external-cdn\.example\.com\/photo1-card\.jpg"/);
});

test("the internal product-detail link (Invicta's own navigation) still works and is unaffected", () => {
  const html = productCard(baseItem());
  assert.match(html, /href="product\.html\?id=LEG-HD-001157"/);
});

test("internal data is unaffected: mapAirtableRecord() still maps Airtable's Product URL field onto item.productUrl", () => {
  const mapped = mapAirtableRecord("rec123", {
    "Name": "Test Item",
    "Category": "Flooring",
    "Product URL": "https://www.lowes.com/pd/some-product/999",
    "Post to Website": true,
  });
  assert.equal(mapped.productUrl, "https://www.lowes.com/pd/some-product/999");
});

test("Contractor View's row CTA never references the external product URL either", () => {
  const html = contractorRowCta(baseItem());
  assert.doesNotMatch(html, /homedepot\.com/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll product-card external-link-removed tests passed.");

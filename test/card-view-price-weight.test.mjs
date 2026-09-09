#!/usr/bin/env node
// ===================================================================
// Regression coverage for Card View's price-expression bold weight.
//
// Background: verified (via getComputedStyle in a real Playwright
// render, at both 1440px and 390px) that priceBlock()'s ".price-line"
// and its child ".price-unit" were already both font-weight: 700 for
// both Flooring ("$2.01 / sq ft") and non-Flooring ("$199 each") cards,
// and that the quantity/availability line (".price-avail", e.g. "8
// available") was already font-weight: 500 — i.e. this task's requested
// formatting already matched the spec exactly, with no code change
// needed. Nothing in inventory.js or styles.css changed for this task;
// this file exists only so that already-correct contract can't silently
// regress later (no prior test asserted these three weights or that the
// price number and its unit share one weight).
//
// The Contractor View is untouched by this task and already covered by
// test/contractor-availability-format.test.mjs — not duplicated here.
//
// CSS weights are asserted two ways:
//  1. Directly against styles.css's source rules (these tests don't load
//     a real stylesheet engine, so this is the only way to pin the
//     actual shipped values without a browser).
//  2. Against priceBlock()'s real HTML output (imported from
//     inventory.js via vm.runInThisContext, same technique as
//     test/quote-eligibility.test.mjs) — confirming price-line/price-unit
//     wrap the number and unit respectively for both categories, and
//     that the quantity text is never placed inside either of those
//     bold-weight classes.
//
// Run with: node test/card-view-price-weight.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");
const stylesSrc = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");

globalThis.window = { AIRTABLE_CONFIG: {}, SITE_CONFIG: { phoneHref: "+12145522145" }, location: { search: "", hash: "", pathname: "/", href: "http://localhost/" } };
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

function flooringItem(overrides) {
  return {
    webCategory: "Flooring", webSubcategory: "Luxury Vinyl Plank",
    price: 2.01, sqFtPerUnit: 20.1, availableSqFt: 3737.22, qtyAvailable: 199, boxPrice: 42.11,
    statusLabel: "In Stock", photos: [], photoThumbs: [],
    ...overrides,
  };
}

function nonFlooringItem(overrides) {
  return {
    webCategory: "Tools", sellUnit: "each", price: 199, qtyAvailable: 8, wasPrice: 249,
    statusLabel: "In Stock", photos: [], photoThumbs: [],
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
    console.error(`  ${err.message}`);
  }
}

function cssRuleBody(selector) {
  const re = new RegExp(selector.replace(/[.[\]]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = stylesSrc.match(re);
  assert.ok(m, `expected to find a CSS rule for ${selector}`);
  return m[1];
}

// --- CSS contract: price-line and price-unit share one weight; the
//     quantity/availability line stays medium, not bold. -----------------

test("CSS: .product-price .price-line is font-weight 700", () => {
  assert.match(cssRuleBody(".product-price .price-line"), /font-weight:\s*700/);
});

test("CSS: .product-price .price-unit is font-weight 700 (same as price-line)", () => {
  assert.match(cssRuleBody(".product-price .price-unit"), /font-weight:\s*700/);
});

test("CSS: .product-price .price-avail (quantity/availability text) is font-weight 500, not bold", () => {
  const body = cssRuleBody(".product-price .price-avail");
  assert.match(body, /font-weight:\s*500/);
  assert.doesNotMatch(body, /font-weight:\s*700/);
});

// --- priceBlock() HTML structure: number and unit both land inside the
//     bold-weight classes; quantity text never does. ----------------------

test("priceBlock: Flooring wraps the number in .price-line and the unit in .price-unit, both present for \"$2.01 / sq ft\"", () => {
  const html = priceBlock(flooringItem());
  assert.match(html, /<div class="price-line">\$2\.01 <span class="price-unit">\/ sq ft<\/span><\/div>/);
});

test("priceBlock: non-Flooring wraps the number in .price-line and the unit in .price-unit, both present for \"$199 each\"", () => {
  const html = priceBlock(nonFlooringItem());
  assert.match(html, /<div class="price-line">\$199 <span class="price-unit">each<\/span><\/div>/);
});

test("priceBlock: non-Flooring quantity text (\"8 available\") is rendered in .price-avail, never inside .price-line/.price-unit", () => {
  const html = priceBlock(nonFlooringItem());
  const priceLineMatch = html.match(/<div class="price-line">.*?<\/div>/s);
  assert.equal(priceLineMatch[0].includes("available"), false);
  assert.match(html, /<div class="price-avail">Retail \$249 &middot; 8 available<\/div>/);
});

test("priceBlock: singular quantity wording (\"1 available\") also stays out of the bold price-line", () => {
  const html = priceBlock(nonFlooringItem({ qtyAvailable: 1, wasPrice: undefined }));
  const priceLineMatch = html.match(/<div class="price-line">.*?<\/div>/s);
  assert.equal(priceLineMatch[0].includes("available"), false);
  assert.match(html, /<div class="price-avail">1 available<\/div>/);
});

test("priceBlock: Flooring's own bold total-sq-ft presentation (price-avail-qty) is unchanged by this task", () => {
  const html = priceBlock(flooringItem());
  assert.match(html, /<div class="price-avail price-avail-qty"><span class="contractor-avail-lines"><strong class="contractor-avail-sqft">3,737\.22 sq ft<\/strong><span class="contractor-avail-boxes">199 boxes available<\/span><\/span><\/div>/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll card-view-price-weight tests passed.");

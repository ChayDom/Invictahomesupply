#!/usr/bin/env node
// ===================================================================
// Regression test for the homepage "starting LVP price" calculation.
//
// Background: an audit found the homepage briefly showing $1.20/sq ft
// instead of the expected $1.35/sq ft. Root-cause tracing (see the
// branch's commit history / PR description) found this was NOT a
// filtering bug in inventory.js or in netlify/functions/inventory.mts
// — the $1.20 row (TrafficMaster Big Horn, Product Key HD-1014211860)
// was, at the time, a genuinely published, in-stock, positive-quantity
// Airtable record, so both the server-side "Post to Website" gate and
// the client-side eligibility logic were behaving exactly as designed
// against that data. This test does not depend on live Airtable data
// at all — it feeds a small, fully-controlled fixture straight into
// computeLvpStartingPrice() (inventory.js) to lock in the eligibility
// rule itself: Flooring category, Luxury Vinyl Plank subcategory,
// in stock, a genuinely positive quantity, and a genuinely positive
// per-sq-ft price. An "unpublished" row is modeled by simply omitting
// it from the fixture array — that mirrors reality, since
// netlify/functions/inventory.mts filters unpublished rows out of the
// /api/inventory response before the client ever sees them; there is
// no "Post to Website" field on the client-side item shape to check.
//
// Run with: node test/homepage-lvp-price.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");

// Minimal browser-global stubs so inventory.js's top-level code (which
// only runs its DOMContentLoaded-gated init on a real page) can load
// without a DOM. None of these are exercised by computeLvpStartingPrice
// itself — it's a pure function over the items array — but inventory.js
// references window/localStorage/sessionStorage at module scope.
globalThis.window = { AIRTABLE_CONFIG: {}, location: { search: "", hash: "", pathname: "/", href: "http://localhost/" } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { classList: { add() {}, remove() {}, toggle() {} } },
};

// vm.runInThisContext (not a plain require/import) so inventory.js's
// top-level `function` declarations attach to globalThis exactly like a
// classic <script> tag would, making computeLvpStartingPrice callable
// below without inventory.js needing any module exports of its own.
vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

function baseItem(overrides) {
  return {
    id: overrides.productKey,
    productKey: overrides.productKey,
    name: overrides.name,
    webCategory: "Flooring",
    webSubcategory: "Luxury Vinyl Plank",
    statusLabel: "In Stock",
    qtyAvailable: 10,
    price: 0,
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

// ---------------------------------------------------------------------
// Fixture 1 (the audit scenario): an unpublished $1.20 LVP is modeled by
// its ABSENCE from the array (see file header) — a published $1.35 LVP,
// and an out-of-stock LVP priced even lower than both. Expected result:
// $1.35, the lowest price among items that are actually eligible.
// ---------------------------------------------------------------------
test("homepage LVP starting price ignores unpublished/out-of-stock rows and returns $1.35", () => {
  const items = [
    // Represents the published $1.35 LVP — the correct answer.
    baseItem({ productKey: "HD-1013090173", name: "TrafficMaster Antler Ridge 6 MIL Waterproof Click Lock LVP", price: 1.35, qtyAvailable: 48 }),
    // Out-of-stock LVP priced lower than $1.35 — must never win regardless of price.
    baseItem({ productKey: "HD-1012740834", name: "Home Decorators Collection Highland Lake 12 MIL LVP", price: 0.99, qtyAvailable: 0, statusLabel: "Sold Out" }),
    // NOTE: the unpublished $1.20 TrafficMaster Big Horn (HD-1014211860) is
    // intentionally NOT included here — an unpublished Airtable record
    // never reaches this array in production (see file header), so a
    // regression fixture representing "unpublished" must omit it rather
    // than include it with some client-side-only flag that doesn't exist.
  ];
  assert.equal(computeLvpStartingPrice(items), 1.35);
});

test("a genuinely lower-priced, in-stock, positive-quantity LVP legitimately wins", () => {
  const items = [
    baseItem({ productKey: "A", price: 1.35, qtyAvailable: 48 }),
    baseItem({ productKey: "B", price: 1.20, qtyAvailable: 23 }),
  ];
  assert.equal(computeLvpStartingPrice(items), 1.20, "the lowest eligible price should win when it really is eligible");
});

test("zero quantity disqualifies an LVP row even when Status still says In Stock", () => {
  const items = [
    baseItem({ productKey: "A", price: 1.35, qtyAvailable: 48 }),
    baseItem({ productKey: "B", price: 0.50, qtyAvailable: 0, statusLabel: "In Stock" }),
  ];
  assert.equal(computeLvpStartingPrice(items), 1.35, "qtyAvailable <= 0 must be excluded even if statusLabel claims In Stock");
});

test("non-LVP Flooring subcategories (e.g. Laminate) never affect the LVP price", () => {
  const items = [
    baseItem({ productKey: "A", price: 1.35, qtyAvailable: 48 }),
    baseItem({ productKey: "B", price: 0.10, qtyAvailable: 999, webSubcategory: "Laminate" }),
  ];
  assert.equal(computeLvpStartingPrice(items), 1.35);
});

test("non-Flooring categories never affect the LVP price", () => {
  const items = [
    baseItem({ productKey: "A", price: 1.35, qtyAvailable: 48 }),
    baseItem({ productKey: "B", price: 0.01, qtyAvailable: 999, webCategory: "Tools", webSubcategory: "" }),
  ];
  assert.equal(computeLvpStartingPrice(items), 1.35);
});

test("a zero or negative price is never treated as a valid starting price", () => {
  const items = [
    baseItem({ productKey: "A", price: 0, qtyAvailable: 48 }),
    baseItem({ productKey: "B", price: -5, qtyAvailable: 48 }),
  ];
  assert.equal(computeLvpStartingPrice([]), null);
  assert.equal(computeLvpStartingPrice(items), null, "no item has a positive price, so there is no eligible starting price");
});

test("an empty catalog returns null rather than $0 or NaN", () => {
  assert.equal(computeLvpStartingPrice([]), null);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll homepage LVP starting-price tests passed.");

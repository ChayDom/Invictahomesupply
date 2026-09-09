#!/usr/bin/env node
// ===================================================================
// Regression tests for the flooring quantity-display refinement:
// flooringAvailabilityLabel() now returns a two-line block (bold sq-ft
// total, normal-weight box count below it, no parentheses) whenever
// both figures are present — used by the desktop Contractor View table,
// the Contractor mobile cards, and the Card View/product-detail
// priceBlock()'s availability line (all three already showed sq ft and
// box count together before this change; see inventory.js).
//
// Box-count wording is genuinely singular/plural-correct ("1 box
// available" / "199 boxes available"), even though the only reachable
// count here is > 2 (1 and 2 get their own low-stock messages,
// unchanged by this task).
//
// Imports the real inventory.js via vm.runInThisContext (same technique
// as test/quote-eligibility.test.mjs) — no reimplementation of the
// formatting logic here.
//
// Run with: node test/contractor-availability-format.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");

const tableBody = { innerHTML: "" };
const cardsContainer = { innerHTML: "" };
globalThis.window = { AIRTABLE_CONFIG: {}, SITE_CONFIG: { phoneHref: "+12145522145" }, location: { search: "", hash: "", pathname: "/", href: "http://localhost/" } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = {
  getElementById: (id) => {
    if (id === "contractor-table-body") return tableBody;
    if (id === "contractor-cards") return cardsContainer;
    return null;
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { classList: { add() {}, remove() {}, toggle() {} } },
};

vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

function flooringItem(overrides) {
  return {
    id: "recTEST0000000001",
    productKey: "TEST-0001",
    name: "Test Flooring Item",
    webCategory: "Flooring",
    webSubcategory: "Luxury Vinyl Plank",
    price: 2.01,
    sqFtPerUnit: 20.1,
    availableSqFt: 3737.22,
    qtyAvailable: 199,
    boxPrice: 42.11,
    statusLabel: "In Stock",
    photos: [],
    photoThumbs: [],
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

// --- boxAvailabilityText: singular/plural wording -----------------------

test("boxAvailabilityText: singular \"1 box available\"", () => {
  assert.equal(boxAvailabilityText(1), "1 box available");
});

test("boxAvailabilityText: plural \"199 boxes available\"", () => {
  assert.equal(boxAvailabilityText(199), "199 boxes available");
});

test("boxAvailabilityText: never adds parentheses", () => {
  assert.equal(boxAvailabilityText(199).includes("("), false);
  assert.equal(boxAvailabilityText(199).includes(")"), false);
});

// --- flooringAvailabilityLabel: two-line block ---------------------------

test("flooringAvailabilityLabel: sq ft + boxes (>2) returns a bold sq-ft line and a normal-weight boxes-available line", () => {
  const label = flooringAvailabilityLabel(flooringItem());
  assert.match(label, /<strong class="contractor-avail-sqft">3,737\.22 sq ft<\/strong>/);
  assert.match(label, /<span class="contractor-avail-boxes">199 boxes available<\/span>/);
});

test("flooringAvailabilityLabel: no parentheses around the box count", () => {
  const label = flooringAvailabilityLabel(flooringItem());
  assert.equal(label.includes("("), false);
  assert.equal(label.includes(")"), false);
});

test("flooringAvailabilityLabel: preserves decimal precision from availableSqFt", () => {
  assert.match(flooringAvailabilityLabel(flooringItem({ qtyAvailable: 15, availableSqFt: 301.5 })), />301\.5 sq ft</);
  // A whole-number total shows no trailing decimal (sqFtAvailable()'s existing rule — unchanged).
  assert.match(flooringAvailabilityLabel(flooringItem({ qtyAvailable: 15, availableSqFt: 300 })), />300 sq ft</);
});

test("flooringAvailabilityLabel: sq-ft-only (no box count derivable) stays a single plain string, unchanged", () => {
  const label = flooringAvailabilityLabel(flooringItem({ qtyAvailable: undefined, sqFtPerUnit: undefined, availableSqFt: 480 }));
  assert.equal(label, "480 sq ft");
});

test("flooringAvailabilityLabel: low-stock messages (1 or 2 boxes) are untouched by this change", () => {
  assert.equal(flooringAvailabilityLabel(flooringItem({ qtyAvailable: 1 })), "Last box");
  assert.equal(flooringAvailabilityLabel(flooringItem({ qtyAvailable: 2 })), "Only 2 boxes left");
});

test("flooringAvailabilityLabel: no availability data at all returns null (unchanged)", () => {
  assert.equal(flooringAvailabilityLabel(flooringItem({ qtyAvailable: undefined, sqFtPerUnit: undefined, availableSqFt: undefined })), null);
});

// --- Rendered into the desktop Contractor View table ----------------------

test("renderContractorTable: a flooring row with boxes > 2 renders the two-line quantity block in its Available cell", () => {
  renderContractorTable([flooringItem()]);
  assert.match(tableBody.innerHTML, /<strong class="contractor-avail-sqft">3,737\.22 sq ft<\/strong>/);
  assert.match(tableBody.innerHTML, /<span class="contractor-avail-boxes">199 boxes available<\/span>/);
  assert.equal(tableBody.innerHTML.includes("(199 boxes)"), false);
});

test("renderContractorTable: low-stock row (2 boxes) keeps the existing single-line low-stock-emph treatment", () => {
  renderContractorTable([flooringItem({ qtyAvailable: 2 })]);
  assert.match(tableBody.innerHTML, /class="low-stock-emph">Only 2 boxes left<\/td>/);
});

// --- Rendered into the Contractor mobile cards -----------------------------

test("renderContractorMobileCards: same two-line block appears in the mobile card's availability div", () => {
  renderContractorMobileCards([flooringItem()]);
  assert.match(cardsContainer.innerHTML, /<strong class="contractor-avail-sqft">3,737\.22 sq ft<\/strong>/);
  assert.match(cardsContainer.innerHTML, /<span class="contractor-avail-boxes">199 boxes available<\/span>/);
});

// --- Rendered into Card View / product-detail priceBlock() ----------------

test("priceBlock: Flooring card gives the sq-ft/box pair its own price-avail-qty line, separate from the box-price/coverage line", () => {
  const html = priceBlock(flooringItem());
  assert.match(html, /<div class="price-avail price-avail-qty"><span class="contractor-avail-lines"><strong class="contractor-avail-sqft">3,737\.22 sq ft<\/strong><span class="contractor-avail-boxes">199 boxes available<\/span><\/span><\/div>/);
  // The box-price/coverage-per-box line is untouched — still its own separate div, still middot-joined, still no availability text mixed in.
  assert.match(html, /<div class="price-avail">\$42\.11 \/ box &middot; 20\.1 sq ft \/ box<\/div>/);
});

test("priceBlock: non-Flooring categories are completely unaffected by this change", () => {
  const nonFlooring = {
    webCategory: "Tools", sellUnit: "box", price: 12.5, qtyAvailable: 199, wasPrice: 20,
  };
  const html = priceBlock(nonFlooring);
  assert.equal(html.includes("contractor-avail-sqft"), false);
  assert.equal(html.includes("contractor-avail-boxes"), false);
  assert.match(html, /199 boxes available/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll contractor-availability-format tests passed.");

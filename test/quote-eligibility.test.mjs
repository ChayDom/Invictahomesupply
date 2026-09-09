#!/usr/bin/env node
// ===================================================================
// Regression tests for the "Get a Quote" flooring eligibility rule.
//
// Background: "Get a Quote" was gated purely on `item.webCategory ===
// "Flooring"` (+ in-stock) in both actionButtons() (card grid) and
// initProductDetail() (product-detail page). That's too broad — the
// same Category also covers underlayment, saws, tools, and trim/
// transitions, none of which should ever get a sq-ft quote CTA.
// isQuoteEligibleFlooring() (inventory.js) replaces both call sites with
// one shared rule: Category === "Flooring", Subcategory in the positive
// QUOTE_ELIGIBLE_FLOORING_SUBCATEGORIES allowlist (case/whitespace-
// normalized), in stock, and a genuinely positive price/sq-ft-per-unit/
// available-sq-ft (a quote can't be built without that data, and this
// never invents a placeholder to make an otherwise-incomplete row
// eligible).
//
// Imports the real inventory.js via vm.runInThisContext (same technique
// as test/homepage-lvp-price.test.mjs) — no reimplementation of the
// eligibility rule here, this exercises the actual production function.
//
// Run with: node test/quote-eligibility.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");

// Same minimal browser-global stubs as test/homepage-lvp-price.test.mjs
// — inventory.js references window/localStorage/sessionStorage/document
// at module scope even though none of that is exercised by the pure
// functions under test here.
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

function baseItem(overrides) {
  return {
    id: "recTEST0000000001",
    productKey: "TEST-0001",
    name: "Test Flooring Item",
    webCategory: "Flooring",
    webSubcategory: "Luxury Vinyl Plank",
    sellUnit: "box",
    price: 1.99,
    sqFtPerUnit: 20.1,
    availableSqFt: 402,
    boxPrice: 40,
    qtyAvailable: 20,
    statusLabel: "In Stock",
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
// Approved subcategories -> eligible with otherwise-valid data.
// ---------------------------------------------------------------------
const APPROVED_SUBCATEGORIES = [
  "Luxury Vinyl Plank", "Laminate", "Hybrid Resilient", "Bamboo Engineered",
  "Engineered Hardwood", "Glue Down", "Vinyl Tile", "Tile",
  "Vinyl Composition Tile", "Sheet Vinyl",
];
APPROVED_SUBCATEGORIES.forEach((sub) => {
  test(`${sub} -> quote-eligible`, () => {
    assert.equal(isQuoteEligibleFlooring(baseItem({ webSubcategory: sub })), true);
  });
});

test("approved subcategory with different capitalization is still eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ webSubcategory: "hYbRiD resilient" })), true);
});
test("approved subcategory with surrounding whitespace is still eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ webSubcategory: "  Laminate  " })), true);
});

// ---------------------------------------------------------------------
// Excluded subcategories under Category = Flooring.
// ---------------------------------------------------------------------
const EXCLUDED_SUBCATEGORIES = [
  "Underlayment", "Flooring Saw", "Flooring Tools", "Trim", "Molding",
  "Transitions", "Installation Accessories", "Adhesive", "Other Flooring",
];
EXCLUDED_SUBCATEGORIES.forEach((sub) => {
  test(`${sub} (Category=Flooring) -> not quote-eligible`, () => {
    assert.equal(isQuoteEligibleFlooring(baseItem({ webSubcategory: sub })), false);
  });
});

test("blank subcategory -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ webSubcategory: "" })), false);
});
test("unrecognized flooring subcategory -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ webSubcategory: "Some New Material Nobody Approved" })), false);
});

// ---------------------------------------------------------------------
// Category / availability gates.
// ---------------------------------------------------------------------
test("non-Flooring category -> not quote-eligible even with an approved-sounding subcategory", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ webCategory: "Tools", webSubcategory: "Luxury Vinyl Plank" })), false);
});
test("out-of-stock flooring material -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ statusLabel: "Sold Out" })), false);
});

// ---------------------------------------------------------------------
// Required numeric fields — zero, missing, or non-numeric all disqualify.
// ---------------------------------------------------------------------
test("zero price -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ price: 0 })), false);
});
test("missing price -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ price: undefined })), false);
});
test("zero sq ft per unit -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ sqFtPerUnit: 0 })), false);
});
test("missing sq ft per unit -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ sqFtPerUnit: undefined })), false);
});
test("zero available sq ft -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ availableSqFt: 0 })), false);
});
test("missing available sq ft -> not quote-eligible", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ availableSqFt: undefined })), false);
});
test("numeric field supplied as a string is rejected, not coerced (fails closed, never crashes)", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ price: "1.99" })), false);
});
test("invalid numeric string -> not quote-eligible, no crash", () => {
  assert.equal(isQuoteEligibleFlooring(baseItem({ price: "not-a-number" })), false);
});
test("null/undefined item -> not quote-eligible, no crash", () => {
  assert.equal(isQuoteEligibleFlooring(null), false);
  assert.equal(isQuoteEligibleFlooring(undefined), false);
});

// ---------------------------------------------------------------------
// Real fixture: VERT HAUS Raw Linen Oak (Product Key LEG-HD-001157),
// verified directly against the live "Website Products" Airtable table
// during the original diagnostic session — Category=Flooring,
// Subcategory=Hybrid Resilient, Status=In Stock, Price=1.665,
// Sq Ft Per Unit=27, Available Sq Ft=2160. All required data present
// and valid -> quote-eligible.
// ---------------------------------------------------------------------
test("Raw Linen Oak's real Airtable fixture is quote-eligible", () => {
  const rawLinenOak = baseItem({
    id: "reccGvluKvHC4ibal",
    productKey: "LEG-HD-001157",
    name: "VERT HAUS Raw Linen Oak 10 mm Waterproof Hybrid Resilient Flooring",
    webSubcategory: "Hybrid Resilient",
    price: 1.665,
    sqFtPerUnit: 27,
    availableSqFt: 2160,
    boxPrice: 45,
    qtyAvailable: 80,
    statusLabel: "In Stock",
  });
  assert.equal(isQuoteEligibleFlooring(rawLinenOak), true);
});

// ---------------------------------------------------------------------
// Card grid and product-detail page must never disagree — both render
// paths call the exact same helper, so this is really a check that
// neither actionButtons() nor initProductDetail() re-derives eligibility
// locally instead of calling it.
// ---------------------------------------------------------------------
[
  baseItem({ webSubcategory: "Luxury Vinyl Plank" }),
  baseItem({ webSubcategory: "Underlayment" }),
  baseItem({ webSubcategory: "Other Flooring" }),
  baseItem({ price: undefined }),
  baseItem({ webCategory: "Tools" }),
].forEach((item, i) => {
  test(`card grid and product-detail eligibility agree (case ${i + 1})`, () => {
    const cardHasQuoteButton = actionButtons(item).includes("data-quote-id");
    assert.equal(cardHasQuoteButton, isQuoteEligibleFlooring(item), "actionButtons() disagreed with isQuoteEligibleFlooring()");
  });
});

test("an eligible card renders exactly one Get a Quote button (no duplicates)", () => {
  const html = actionButtons(baseItem({}));
  const count = (html.match(/data-quote-id/g) || []).length;
  assert.equal(count, 1);
});
test("an ineligible-but-available card renders zero quote buttons", () => {
  const html = actionButtons(baseItem({ webSubcategory: "Underlayment" }));
  assert.equal(html.includes("data-quote-id"), false);
});
test("an out-of-stock flooring item renders zero quote buttons (disabled pill instead)", () => {
  const html = actionButtons(baseItem({ statusLabel: "Sold Out" }));
  assert.equal(html.includes("data-quote-id"), false, "should not render a quote button while out of stock");
  assert.equal(html.includes("Sold Out"), true, "should render the status pill");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll quote-eligibility tests passed.");

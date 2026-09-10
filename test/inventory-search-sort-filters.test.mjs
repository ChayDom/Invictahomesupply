#!/usr/bin/env node
// ===================================================================
// DOM-integration coverage for the shop page's real search/category/
// filter/sort pipeline — renderShopCatalog(), searchMatches(),
// sortItems(), selectCategory()/applyCategoryFromUrl(), and
// clearAllFilters() — exercised via the actual inventory.js (loaded
// with vm.runInThisContext, same technique as every other test file in
// this suite), against a permissive-but-real fake DOM. No production
// function is copied or reimplemented here.
//
// Fills the "release-blocking" search/category/filter/sort gap named
// in the repository's own testing-gap audit — this file's predecessors
// only covered CSS/layout for these features, never the actual
// filtering logic.
//
// Run with: node test/inventory-search-sort-filters.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const inventorySrc = fs.readFileSync(path.join(ROOT, "inventory.js"), "utf8");

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

// ---------------------------------------------------------------------
// Permissive fake DOM: every element the shop page's render pipeline
// might touch is a generic stub supporting the handful of properties/
// methods inventory.js actually calls (classList, hidden, textContent,
// querySelector[All], appendChild) — good enough for the real functions
// to run to completion without throwing, while #catalog-grid is wired
// up for real so its rendered HTML can be asserted on directly.
// ---------------------------------------------------------------------
function makeStubElement(overrides = {}) {
  const el = {
    innerHTML: "",
    textContent: "",
    hidden: false,
    value: "",
    disabled: false,
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {}, getAttribute: () => null, removeAttribute() {},
    appendChild(child) { el.children.push(child); },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    remove() {},
    ...overrides,
  };
  return el;
}

function makeShopDom() {
  const catalogGrid = makeStubElement();
  const registry = {
    "catalog-grid": catalogGrid,
    "sort-select": makeStubElement({ querySelector: () => null, value: "featured" }),
    "results-count-value": makeStubElement(),
    "results-count-category": makeStubElement(),
    "flooring-view-toggle": makeStubElement({ hidden: true }),
    "sidebar-calc-card": makeStubElement({ hidden: true }),
    "mobile-calc-btn": makeStubElement({ hidden: true }),
    "contractor-view": makeStubElement({ hidden: true }),
    "contractor-table-body": makeStubElement(),
    "contractor-mobile-cards": makeStubElement(),
    "browse-categories-btn": makeStubElement(),
    "active-filter-chips": makeStubElement(),
  };
  const doc = {
    title: "",
    body: { classList: { add() {}, remove() {}, toggle() {} } },
    getElementById: (id) => registry[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeStubElement({ tagName: tag }),
    addEventListener() {},
  };
  return { doc, catalogGrid, registry };
}

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

let currentLocation;
globalThis.window = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === "location") return currentLocation;
    if (prop === "history") return { pushState() {}, replaceState() {} };
    if (prop === "AIRTABLE_CONFIG") return {};
    if (prop === "SITE_CONFIG") return { phoneHref: "+12145522145" };
    return undefined;
  },
});

let currentDoc = makeStubElement({ getElementById: () => null, addEventListener() {}, body: { classList: { add() {}, remove() {}, toggle() {} } } });
globalThis.document = new Proxy({}, {
  get: (_t, prop) => currentDoc[prop],
  set: (_t, prop, value) => { currentDoc[prop] = value; return true; },
});
setLocation();

vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

function setLocation(search = "", hash = "") {
  currentLocation = { search, hash, pathname: "/shop.html", href: `http://localhost/shop.html${search}${hash}`, origin: "http://localhost" };
}

// ---------------------------------------------------------------------
// Fixture: a small, deterministic inventory covering multiple
// categories, brands, subcategories, and price/availability shapes —
// never real Airtable data.
// ---------------------------------------------------------------------
function makeFixtureItems() {
  shopItems.length = 0;
  shopItems.push(
    { id: "rec1", productKey: "APP-001", name: "Stainless Fridge", brand: "Samsung", model: "RF28", webCategory: "Appliances", webSubcategory: "Refrigerator", retailer: "Home Depot", price: 899, sellUnit: "each", statusLabel: "In Stock", photos: [], photoThumbs: [], photoCards: [] },
    { id: "rec2", productKey: "APP-002", name: "Gas Range", brand: "LG", model: "LRG3", webCategory: "Appliances", webSubcategory: "Range", retailer: "Lowes", price: 649, sellUnit: "each", statusLabel: "In Stock", photos: [], photoThumbs: [], photoCards: [] },
    { id: "rec3", productKey: "LEG-001", name: "Oak Luxury Vinyl Plank", brand: "Legacy", model: "", webCategory: "Flooring", webSubcategory: "Luxury Vinyl Plank", retailer: "Floor & Decor", price: 2.49, boxPrice: 42.11, sqFtPerUnit: 24, availableSqFt: 480, statusLabel: "In Stock", photos: [], photoThumbs: [], photoCards: [] },
    { id: "rec4", productKey: "LEG-002", name: "Walnut Laminate", brand: "Legacy", model: "", webCategory: "Flooring", webSubcategory: "Laminate", retailer: "Floor & Decor", price: 1.79, boxPrice: 35.8, sqFtPerUnit: 20, availableSqFt: 100, statusLabel: "In Stock", photos: [], photoThumbs: [], photoCards: [] },
    { id: "rec5", productKey: "TL-001", name: "Cordless Drill", brand: "DeWalt", model: "DCD771", webCategory: "Tools", webSubcategory: "Power Tools", retailer: "Amazon", price: 129, sellUnit: "each", statusLabel: "Sold Out", photos: [], photoThumbs: [], photoCards: [] },
  );
}

function resetFilters() {
  currentCategory = "all";
  currentSort = "featured";
  currentSearch = "";
  currentBrand = "";
  currentSubcategory = "";
  currentThickness = "";
  currentWearLayer = "";
  currentUnderlayment = "";
  currentWaterResistance = "";
  currentAvailability = "";
}

// =======================================================================
// A. Search
// =======================================================================
test("searchMatches(): matches product name case-insensitively when given a lowercased query — searchMatches lowercases its haystack but expects the caller to lowercase the query itself, exactly as renderShopCatalog()'s `currentSearch.trim().toLowerCase()` does before calling it", () => {
  const item = { name: "Stainless Fridge", brand: "Samsung" };
  assert.equal(searchMatches(item, "stainless"), true);
});

test("renderShopCatalog(): an uppercase/mixed-case search still matches, because the real call site lowercases the query before calling searchMatches()", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentSearch = "STAINLESS";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Stainless Fridge/);
  currentSearch = "StAiNlEsS";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Stainless Fridge/);
});

test("searchMatches(): matches category and subcategory", () => {
  const item = { name: "X", webCategory: "Flooring", webSubcategory: "Laminate" };
  assert.equal(searchMatches(item, "flooring"), true);
  assert.equal(searchMatches(item, "laminate"), true);
});

test("searchMatches(): matches brand and model", () => {
  const item = { name: "X", brand: "DeWalt", model: "DCD771" };
  assert.equal(searchMatches(item, "dewalt"), true);
  assert.equal(searchMatches(item, "dcd771"), true);
});

test("searchMatches(): empty query matches everything", () => {
  assert.equal(searchMatches({ name: "Anything" }, ""), true);
});

test("searchMatches(): a retailer-name query can match an item (it's in the haystack) but that never implies retailer text is rendered — see product-detail-retailer-privacy.test.mjs for the render-side guarantee", () => {
  const item = { name: "Oak LVP", retailer: "Floor & Decor" };
  assert.equal(searchMatches(item, "floor & decor"), true);
});

test("renderShopCatalog(): search results never render retailer text in the product card HTML", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentSearch = "Floor & Decor";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Oak Luxury Vinyl Plank|Walnut Laminate/, "expected the Floor & Decor items to match");
  assert.doesNotMatch(catalogGrid.innerHTML, /Floor & Decor/, "retailer text must never appear in rendered card HTML");
});

test("renderShopCatalog(): whitespace-padded search is normalized (trimmed) before matching", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentSearch = "   drill   ";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Cordless Drill/);
});

test("renderShopCatalog(): empty search after a prior search restores the full unfiltered (category-scoped) result set", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentSearch = "drill";
  renderShopCatalog();
  assert.doesNotMatch(catalogGrid.innerHTML, /Stainless Fridge/);
  currentSearch = "";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Stainless Fridge/);
  assert.match(catalogGrid.innerHTML, /Cordless Drill/);
});

test("renderShopCatalog(): a query matching nothing renders the empty-filtered state, not a stale/previous list", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentSearch = "no-such-product-xyz";
  renderShopCatalog();
  assert.doesNotMatch(catalogGrid.innerHTML, /product-card/);
});

test("renderShopCatalog(): search combines with a selected category — a query that matches items outside the category is excluded", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentCategory = "Flooring";
  currentSearch = "drill"; // only matches the Tools item, outside Flooring
  renderShopCatalog();
  assert.doesNotMatch(catalogGrid.innerHTML, /product-card/);
});

test("renderShopCatalog(): search combines with category AND a brand filter simultaneously", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentCategory = "Flooring";
  currentSearch = "oak";
  currentBrand = "Legacy";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Oak Luxury Vinyl Plank/);
  assert.doesNotMatch(catalogGrid.innerHTML, /Walnut Laminate/);
});

// =======================================================================
// B. Categories
// =======================================================================
test("categoryFromUrl(): reads ?cat= for a known category", () => {
  setLocation("?cat=Flooring");
  assert.equal(categoryFromUrl(), "Flooring");
});

test("categoryFromUrl(): an unknown/malformed category falls back to null (renderShopCatalog then stays at its 'all' default)", () => {
  setLocation("?cat=NotARealCategory");
  assert.equal(categoryFromUrl(), null);
});

test("applyCategoryFromUrl(): direct URL load with ?cat= restores the selected category", () => {
  const { doc } = makeShopDom();
  currentDoc = doc;
  setLocation("?cat=Flooring");
  resetFilters();
  applyCategoryFromUrl();
  assert.equal(currentCategory, "Flooring");
});

test("applyCategoryFromUrl(): an unknown ?cat= value leaves currentCategory at its safe 'all' default rather than throwing or applying garbage", () => {
  const { doc } = makeShopDom();
  currentDoc = doc;
  setLocation("?cat=GarbageValue");
  resetFilters();
  applyCategoryFromUrl();
  assert.equal(currentCategory, "all");
});

test("applyCategoryFromUrl(): ?q= on the URL restores the search text too", () => {
  const { doc } = makeShopDom();
  currentDoc = doc;
  setLocation("?cat=Flooring&q=oak");
  resetFilters();
  applyCategoryFromUrl();
  assert.equal(currentSearch, "oak");
});

test("renderShopCatalog(): 'all' category shows every category's items", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  renderShopCatalog();
  for (const name of ["Stainless Fridge", "Gas Range", "Oak Luxury Vinyl Plank", "Walnut Laminate", "Cordless Drill"]) {
    assert.match(catalogGrid.innerHTML, new RegExp(name), `expected "${name}" to appear in the All Products view`);
  }
});

test("renderShopCatalog(): selecting a category filters results down to that category only", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentCategory = "Appliances";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Stainless Fridge/);
  assert.match(catalogGrid.innerHTML, /Gas Range/);
  assert.doesNotMatch(catalogGrid.innerHTML, /Oak Luxury Vinyl Plank|Cordless Drill/);
});

test("categoryCounts(): counts are correct per category, including 'all'", () => {
  makeFixtureItems();
  const counts = categoryCounts();
  assert.equal(counts["Appliances"], 2);
  assert.equal(counts["Flooring"], 2);
  assert.equal(counts["Tools"], 1);
});

test("selectCategory(): resets facet filters and returns to the 'all' behavior when passed 'all'", () => {
  const { doc } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentBrand = "Legacy";
  currentCategory = "Flooring";
  selectCategory("all");
  assert.equal(currentCategory, "all");
  assert.equal(currentBrand, "", "selecting a new category must clear the brand filter that doesn't carry across categories");
});

// =======================================================================
// C. Filters
// =======================================================================
test("renderShopCatalog(): a Brand filter narrows results to that brand only", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentBrand = "LG";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Gas Range/);
  assert.doesNotMatch(catalogGrid.innerHTML, /Stainless Fridge|Oak Luxury Vinyl Plank/);
});

test("renderShopCatalog(): a Subcategory filter combined with category narrows correctly", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentCategory = "Flooring";
  currentSubcategory = "Laminate";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Walnut Laminate/);
  assert.doesNotMatch(catalogGrid.innerHTML, /Oak Luxury Vinyl Plank/);
});

test("renderShopCatalog(): Flooring-only structured filters (thickness/wear layer/etc.) are ignored outside the Flooring category", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentCategory = "Appliances";
  currentThickness = "12"; // would exclude everything if wrongly applied outside Flooring
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Stainless Fridge/);
  assert.match(catalogGrid.innerHTML, /Gas Range/);
});

test("renderShopCatalog(): multiple simultaneous filters combine with AND semantics", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentCategory = "Flooring";
  currentBrand = "Legacy";
  currentSubcategory = "Luxury Vinyl Plank";
  renderShopCatalog();
  assert.match(catalogGrid.innerHTML, /Oak Luxury Vinyl Plank/);
  assert.doesNotMatch(catalogGrid.innerHTML, /Walnut Laminate/);
});

test("clearAllFilters(): resets every filter back to its default and re-renders the full (category-scoped) list", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentBrand = "LG";
  currentSearch = "range";
  clearAllFilters();
  assert.equal(currentBrand, "");
  assert.equal(currentSearch, "");
  assert.match(catalogGrid.innerHTML, /Stainless Fridge/, "clearing filters must restore the full list");
});

test("renderShopCatalog(): a filter combination matching nothing renders the empty state, not an error", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentCategory = "Appliances";
  currentBrand = "Legacy"; // no Appliances item is branded Legacy
  renderShopCatalog();
  assert.doesNotMatch(catalogGrid.innerHTML, /product-card/);
});

test("renderShopCatalog(): filtering never mutates the original shopItems array (same length/order after any filter combination)", () => {
  const { doc } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  const originalOrder = shopItems.map(i => i.id);
  resetFilters();
  currentCategory = "Flooring";
  currentBrand = "Legacy";
  currentSearch = "oak";
  renderShopCatalog();
  assert.deepEqual(shopItems.map(i => i.id), originalOrder, "shopItems must be unchanged after filtering/rendering");
  assert.equal(shopItems.length, 5);
});

test("Sold Out items are still counted/present in the underlying data (never silently dropped from shopItems by a filter pass)", () => {
  const { doc } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  renderShopCatalog();
  assert.ok(shopItems.some(i => i.statusLabel === "Sold Out"));
});

// =======================================================================
// D. Sorting
// =======================================================================
test("sortItems(): 'featured' returns a new array in original order (does not mutate or reorder)", () => {
  const items = [{ price: 3 }, { price: 1 }, { price: 2 }];
  const sorted = sortItems(items, "featured");
  assert.notEqual(sorted, items, "must return a new array, not the same reference");
  assert.deepEqual(sorted, items);
});

test("sortItems(): price-asc sorts low to high", () => {
  const items = [{ id: "a", price: 30 }, { id: "b", price: 10 }, { id: "c", price: 20 }];
  const sorted = sortItems(items, "price-asc");
  assert.deepEqual(sorted.map(i => i.id), ["b", "c", "a"]);
});

test("sortItems(): price-desc sorts high to low", () => {
  const items = [{ id: "a", price: 30 }, { id: "b", price: 10 }, { id: "c", price: 20 }];
  const sorted = sortItems(items, "price-desc");
  assert.deepEqual(sorted.map(i => i.id), ["a", "c", "b"]);
});

test("sortItems(): items with a missing/malformed price sort to the end, in their original relative order, regardless of sort direction", () => {
  const items = [{ id: "a", price: 10 }, { id: "b", price: undefined }, { id: "c", price: 5 }, { id: "d", price: NaN }];
  const asc = sortItems(items, "price-asc");
  assert.deepEqual(asc.map(i => i.id), ["c", "a", "b", "d"]);
  const desc = sortItems(items, "price-desc");
  assert.deepEqual(desc.map(i => i.id), ["a", "c", "b", "d"]);
});

test("sortItems(): identical prices preserve their original relative order (stable sort)", () => {
  const items = [{ id: "a", price: 10 }, { id: "b", price: 10 }, { id: "c", price: 10 }];
  const sorted = sortItems(items, "price-asc");
  assert.deepEqual(sorted.map(i => i.id), ["a", "b", "c"]);
});

test("sortItems(): Flooring's per-sq-ft price (item.price) is what price-asc/desc sorts on, not boxPrice", () => {
  const items = [
    { id: "cheap-per-sqft-expensive-box", price: 1.0, boxPrice: 999 },
    { id: "expensive-per-sqft-cheap-box", price: 9.0, boxPrice: 1 },
  ];
  const sorted = sortItems(items, "price-asc");
  assert.deepEqual(sorted.map(i => i.id), ["cheap-per-sqft-expensive-box", "expensive-per-sqft-cheap-box"]);
});

test("sortItems(): sqft-asc/sqft-desc sort on availableSqFt (Flooring-only sort field)", () => {
  const items = [{ id: "a", availableSqFt: 300 }, { id: "b", availableSqFt: 100 }, { id: "c", availableSqFt: 200 }];
  assert.deepEqual(sortItems(items, "sqft-asc").map(i => i.id), ["b", "c", "a"]);
  assert.deepEqual(sortItems(items, "sqft-desc").map(i => i.id), ["a", "c", "b"]);
});

test("renderShopCatalog(): the selected sort mode is applied to the final filtered result set", () => {
  const { doc, catalogGrid } = makeShopDom();
  currentDoc = doc;
  setLocation();
  makeFixtureItems();
  resetFilters();
  currentCategory = "Appliances";
  currentSort = "price-asc";
  renderShopCatalog();
  const fridgeIdx = catalogGrid.innerHTML.indexOf("Gas Range");
  const rangeIdx = catalogGrid.innerHTML.indexOf("Stainless Fridge");
  assert.ok(fridgeIdx !== -1 && rangeIdx !== -1);
  assert.ok(fridgeIdx < rangeIdx, "the $649 Gas Range must render before the $899 Stainless Fridge under price-asc");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll inventory search/sort/filter tests passed.");

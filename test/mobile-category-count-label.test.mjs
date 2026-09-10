#!/usr/bin/env node
// ===================================================================
// Regression test for the mobile/tablet selected-category pill beside
// the shop.html Filters button.
//
// Background: #results-count only ever showed "N items" — on mobile,
// where the selected category is buried inside the closed Filters
// drawer, that gave no visible cue which category was active without
// opening the drawer. updateResultsCount() (inventory.js) now also
// writes #results-count-category (the bare category name, or empty for
// "all") and prefixes #results-count-value with "· " once a category
// is selected, so the separator/count read at regular weight next to
// the bold category name rather than both being bold. It also toggles
// a "has-category" class on #results-count itself.
//
// styles.css only ever displays #results-count-category, and only ever
// applies the .has-category pill (dark-green --charcoal fill — the same
// color .filter-btn.active/:hover uses for a selected/pressed "All
// Products" — bold white category name, softer --cream-dim "· N items",
// pill radius, but with none of .filter-btn's hover/cursor/button
// semantics), at the same @media (max-width: 880px) breakpoint that
// turns the sidebar into the off-canvas Filters drawer. Desktop keeps
// the exact original plain count-only text, and "All Products" is never
// given an unnecessary pill of its own (the All Products control
// already communicates that state) at any width.
//
// A popstate listener was also added (initShopControls(), inventory.js)
// so currentCategory — and therefore this label — actually follows the
// browser's own Back/Forward, which nothing previously listened for.
//
// Exercises the real inventory.js via vm.runInThisContext (same
// technique as test/quote-eligibility.test.mjs), calling the actual
// production functions (applyCategoryFromUrl, selectCategory,
// initShopControls, the popstate handler it registers) against a
// minimal fake DOM/window — no reimplementation of the label logic.
//
// Run with: node test/mobile-category-count-label.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");
const stylesSrc = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const shopSrc = fs.readFileSync(path.join(__dirname, "..", "shop.html"), "utf8");

// ---------------------------------------------------------------------
// Minimal fake DOM: every element "exists" as a harmless generic stub
// (classList/addEventListener/etc. all no-ops, except classList, which
// is a real Set-backed implementation so tests can assert "has-category"
// was actually toggled) except the three real elements under test,
// #results-count, #results-count-category and #results-count-value —
// same approach as test/mobile-nav-escape.test.mjs, widened slightly
// since initShopControls()/renderShopCatalog() touch many optional
// elements that are all already null-/optional-chain-guarded in
// production (renderGrid, updateActiveFilterChips, updateViewToggle,
// updateFacetFilterOptions, bindFlooringCalcCard, etc.) — a generic
// stub exercises those exact guards rather than papering over them with
// getElementById returning null everywhere.
// ---------------------------------------------------------------------
function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, force) => {
      const shouldHave = typeof force === "boolean" ? force : !set.has(c);
      if (shouldHave) set.add(c); else set.delete(c);
      return shouldHave;
    },
  };
}

function makeStubElement() {
  const attrs = {};
  const el = {
    textContent: "",
    innerHTML: "",
    value: "",
    hidden: false,
    classList: makeClassList(),
    style: {},
    dataset: {},
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    appendChild() {},
    closest() { return null; },
    focus() {},
  };
  return el;
}

function setupFakeDom({ search = "", hash = "" } = {}) {
  const countEl = makeStubElement();
  const categoryEl = makeStubElement();
  const valueEl = makeStubElement();
  const registry = {
    "results-count": countEl,
    "results-count-category": categoryEl,
    "results-count-value": valueEl,
  };

  const popstateListeners = [];
  const doc = {
    getElementById: (id) => registry[id] || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    body: { classList: { add() {}, remove() {}, toggle() {} } },
  };
  const win = {
    AIRTABLE_CONFIG: {},
    SITE_CONFIG: { phoneHref: "+12145522145" },
    location: { search, hash, pathname: "/shop.html", href: `http://localhost/shop.html${search}${hash}` },
    history: { pushState() {}, replaceState() {} },
    addEventListener(type, cb) { if (type === "popstate") popstateListeners.push(cb); },
  };
  globalThis.document = doc;
  globalThis.window = win;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

  return { countEl, categoryEl, valueEl, win, firePopstate: () => popstateListeners.forEach((cb) => cb()) };
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

// inventory.js is loaded exactly once — vm.runInThisContext re-declares
// its top-level `let`/`const` bindings on every call, which throws on a
// second run in the same realm. Every function it defines reads
// globalThis.document/window dynamically on each call rather than
// capturing them at load time, so swapping in a fresh fake DOM/window
// per test via setupFakeDom() (below) still exercises real, isolated
// state — initShopControls() itself resets the category-relevant
// module state (shopItems, currentCategory, currentBrand, etc.) each
// time it's called, same as a real page load would.
//
// Minimal placeholder globals so the module-scope code that runs at
// load time (window.AIRTABLE_CONFIG assignment, loadFlooringViewMode()
// reading localStorage, the DOMContentLoaded registration) doesn't
// throw; every test below replaces globalThis.document/window with its
// own fake before calling any inventory.js function.
globalThis.window = { location: { search: "", hash: "" } };
globalThis.document = { addEventListener() {} };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

// --- 1. Selecting a category updates the label immediately, pilled --
test("selecting a category (Appliances, 2 items) shows category 'Appliances', count '· 2 items', and marks the pill", () => {
  const { countEl, categoryEl, valueEl } = setupFakeDom();
  initShopControls([
    { id: "r1", webCategory: "Appliances", statusLabel: "In Stock", qtyAvailable: 3 },
    { id: "r2", webCategory: "Appliances", statusLabel: "In Stock", qtyAvailable: 1 },
    { id: "r3", webCategory: "Flooring", webSubcategory: "Laminate", statusLabel: "In Stock", qtyAvailable: 5 },
  ]);
  selectCategory("Appliances");
  assert.equal(categoryEl.textContent, "Appliances");
  assert.equal(valueEl.textContent, "· 2 items");
  assert.equal(countEl.classList.contains("has-category"), true);
});

test("selecting a category with exactly one result uses singular wording: 'Water Heaters' / '· 1 item'", () => {
  const { countEl, categoryEl, valueEl } = setupFakeDom();
  initShopControls([
    { id: "r1", webCategory: "Water Heaters", statusLabel: "In Stock", qtyAvailable: 1 },
    { id: "r2", webCategory: "Appliances", statusLabel: "In Stock", qtyAvailable: 1 },
  ]);
  selectCategory("Water Heaters");
  assert.equal(categoryEl.textContent, "Water Heaters");
  assert.equal(valueEl.textContent, "· 1 item");
  assert.equal(countEl.classList.contains("has-category"), true);
});

test("a long category name ('Electrical & Lighting') is written out in full — never truncated", () => {
  const { countEl, categoryEl, valueEl } = setupFakeDom();
  initShopControls([
    { id: "r1", webCategory: "Electrical & Lighting", statusLabel: "In Stock", qtyAvailable: 4 },
  ]);
  selectCategory("Electrical & Lighting");
  assert.equal(categoryEl.textContent, "Electrical & Lighting");
  assert.equal(valueEl.textContent, "· 1 item");
  assert.equal(countEl.classList.contains("has-category"), true);
});

// --- 2. Selecting All Products keeps the existing count-only text, no pill
test("selecting All Products leaves the category span empty, drops the pill marker, and keeps plain count text", () => {
  const { countEl, categoryEl, valueEl } = setupFakeDom();
  initShopControls([
    { id: "r1", webCategory: "Appliances", statusLabel: "In Stock", qtyAvailable: 1 },
    { id: "r2", webCategory: "Flooring", webSubcategory: "Laminate", statusLabel: "In Stock", qtyAvailable: 1 },
  ]);
  selectCategory("Appliances");
  assert.equal(countEl.classList.contains("has-category"), true);
  selectCategory("all");
  assert.equal(categoryEl.textContent, "");
  assert.equal(valueEl.textContent, "2 items");
  assert.equal(countEl.classList.contains("has-category"), false);
});

// --- 3. Loading a category from the URL -------------------------------
test("loading /shop.html?cat=Flooring directly sets the pilled label via applyCategoryFromUrl()", () => {
  const { countEl, categoryEl, valueEl } = setupFakeDom({ search: "?cat=Flooring" });
  applyCategoryFromUrl();
  updateResultsCount(46);
  assert.equal(categoryEl.textContent, "Flooring");
  assert.equal(valueEl.textContent, "· 46 items");
  assert.equal(countEl.classList.contains("has-category"), true);
});

test("an unrecognized ?cat= value falls back to All Products (count-only, unpilled), never a broken label", () => {
  const { countEl, categoryEl, valueEl } = setupFakeDom({ search: "?cat=NotARealCategory" });
  // categoryFromUrl() deliberately returns null for an unrecognized value
  // (see its own comment in inventory.js) — applyCategoryFromUrl() then
  // leaves currentCategory exactly as it was, same as a real first page
  // load where it's already "all" by default. Reset explicitly here since
  // this test runs after others that changed it, so this test starts from
  // that same real-world "all" starting point rather than depending on
  // suite ordering.
  selectCategory("all");
  applyCategoryFromUrl();
  updateResultsCount(58);
  assert.equal(categoryEl.textContent, "");
  assert.equal(valueEl.textContent, "58 items");
  assert.equal(countEl.classList.contains("has-category"), false);
});

// --- 4. Browser Back/Forward keeps the label (and pill) synchronized -
test("browser Back/Forward (popstate) re-syncs the label/pill to the URL's category, not just the click path", () => {
  const { countEl, categoryEl, valueEl, firePopstate, win } = setupFakeDom({ search: "" });
  initShopControls([
    { id: "r1", webCategory: "Flooring", webSubcategory: "Laminate", statusLabel: "In Stock", qtyAvailable: 46 },
    { id: "r2", webCategory: "Appliances", statusLabel: "In Stock", qtyAvailable: 1 },
  ]);
  selectCategory("Flooring");
  assert.equal(categoryEl.textContent, "Flooring");
  assert.equal(countEl.classList.contains("has-category"), true);

  // Simulate the browser restoring an earlier history entry: the URL is
  // now back to bare /shop.html (no ?cat=), then popstate fires.
  win.location.search = "";
  win.location.href = "http://localhost/shop.html";
  firePopstate();
  assert.equal(categoryEl.textContent, "", "back to All Products should clear the category name");
  assert.equal(valueEl.textContent, "2 items");
  assert.equal(countEl.classList.contains("has-category"), false, "back to All Products should drop the pill");

  // And forward again to a specific category.
  win.location.search = "?cat=Appliances";
  win.location.href = "http://localhost/shop.html?cat=Appliances";
  firePopstate();
  assert.equal(categoryEl.textContent, "Appliances");
  assert.equal(valueEl.textContent, "· 1 item");
  assert.equal(countEl.classList.contains("has-category"), true);
});

// --- 5. CSS: mobile/tablet-only pill, desktop unchanged ---------------
function mediaBlockContaining(maxWidth, selectorSnippet) {
  const re = new RegExp(`@media \\(max-width:\\s*${maxWidth}px\\)\\s*\\{([\\s\\S]*?)\\n\\}\\n`, "gm");
  let m;
  while ((m = re.exec(stylesSrc))) {
    if (m[0].includes(selectorSnippet)) return m[0];
  }
  assert.fail(`expected an @media (max-width: ${maxWidth}px) block containing "${selectorSnippet}"`);
}

test("styles.css: #results-count-category is display:none by default (desktop count-only, unchanged)", () => {
  const baseMatch = stylesSrc.match(/\n\.results-count-category\s*\{([^}]*)\}/);
  assert.ok(baseMatch, "expected a base (non-media) .results-count-category rule");
  assert.match(baseMatch[1], /display:\s*none/);
});

test("styles.css: no top-level (non-media) .has-category rule exists — the pill only ever applies inside the mobile/tablet breakpoint (every actual rule is indented, i.e. nested inside a media block)", () => {
  assert.doesNotMatch(stylesSrc, /^\.results-count\.has-category/m);
});

test("styles.css: the 880px Filters-drawer breakpoint (mobile/tablet) turns #results-count-category on, allows wrapping, and pills .has-category in dark green", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  assert.match(block, /\.results-count-category\s*\{[^}]*display:\s*inline/);
  assert.match(block, /\.results-count\s*\{[^}]*white-space:\s*normal/);
  assert.match(block, /\.results-count\.has-category\s*\{[^}]*border-radius:\s*999px/);
  assert.match(block, /\.results-count\.has-category\s*\{[^}]*background:\s*var\(--charcoal\)/);
  assert.match(block, /\.results-count\.has-category\s*\{[^}]*border:\s*1px solid var\(--charcoal\)/);
  assert.match(block, /\.results-count\.has-category\s*\{[^}]*flex-wrap:\s*wrap/);
});

test("styles.css: inside the pill, the category name is bold white and the '· N items' half is a softer off-white, regular weight", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  assert.match(block, /\.results-count\.has-category\s+\.results-count-category\s*\{[^}]*color:\s*#fff/);
  assert.match(block, /\.results-count\.has-category\s+\.results-count-value\s*\{[^}]*color:\s*var\(--cream-dim\)/);
  // font-weight:700 for the category name and 400 for the count come from
  // the shared (non-pill-specific) .results-count-category/.results-count-value
  // rules — same base rules the pill doesn't override, confirmed here so a
  // future edit can't silently drop the bold/regular contrast.
  const categoryBase = stylesSrc.match(/\n\.results-count-category\s*\{([^}]*)\}/);
  const valueBase = stylesSrc.match(/\n\.results-count-value\s*\{([^}]*)\}/);
  assert.match(categoryBase[1], /font-weight:\s*700/);
  assert.match(valueBase[1], /font-weight:\s*400/);
});

test("styles.css: the pill has no cursor/hover/active/focus button styling — it's a status readout, not a control", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  const pillMatch = block.match(/\.results-count\.has-category\s*\{([^}]*)\}/);
  assert.ok(pillMatch, "expected a .results-count.has-category rule");
  assert.doesNotMatch(pillMatch[1], /cursor:\s*pointer/);
  assert.doesNotMatch(block, /\.results-count\.has-category:hover/);
  assert.doesNotMatch(block, /\.results-count\.has-category:active/);
  assert.doesNotMatch(block, /\.results-count\.has-category:focus/);
});

test("shop.html: #results-count still wraps #results-count-category and #results-count-value beside the unchanged Filters/Browse Categories buttons", () => {
  assert.match(shopSrc, /id="results-count-category"/);
  assert.match(shopSrc, /id="results-count-value"/);
  assert.match(shopSrc, /id="mobile-filters-btn"[\s\S]*?Filters[\s\S]*?<\/button>/);
  assert.match(shopSrc, /id="browse-categories-btn"/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll mobile-category-count-label tests passed.");

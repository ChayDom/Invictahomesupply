#!/usr/bin/env node
// ===================================================================
// Regression tests for the homepage hero price's loading/failure states.
//
// Background: index.html previously shipped a hardcoded "$1.50" hero
// price that was visible until /api/inventory resolved (which on a cold
// cache can take several seconds) — a plausible-looking but potentially
// stale number a visitor could mistake for the real, current price.
// index.html now ships a neutral CSS skeleton (.hero-price-skeleton,
// with an sr-only "Loading current flooring price" label) instead;
// inventory.js's updateHomepageDynamicContent() replaces it with the
// real price on success, or setHeroPriceUnavailable() replaces the
// whole "from $X / sq ft" clause with a neutral "View current
// inventory" link on failure or when no eligible LVP row exists —
// never a fake/stale number either way.
//
// Part A checks the real index.html/styles.css source directly (string
// checks, matching this project's existing test style — see
// test/shop-subscribe-panel.test.mjs). Part B loads the real
// inventory.js via vm.runInThisContext (same technique as
// test/homepage-lvp-price.test.mjs) against a minimal hand-rolled DOM,
// exercising the actual production functions.
//
// Run with: node test/homepage-hero-price.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const stylesCss = fs.readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");

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
// Part A: static markup/CSS.
// ---------------------------------------------------------------------
test("index.html no longer contains the hardcoded $1.50 hero price", () => {
  assert.equal(indexHtml.includes(">$1.50<"), false, "the literal $1.50 fallback should be gone");
});

test("index.html's #hero-price starts as a neutral skeleton with an accessible loading label, not a number", () => {
  const match = indexHtml.match(/<span class="hero-price[^"]*" id="hero-price"[^>]*>([\s\S]*?)<\/span>/);
  assert.ok(match, "#hero-price should exist");
  assert.equal(match[1].includes("$"), false, "no dollar amount should be present before JS runs");
  assert.match(match[1], /Loading current flooring price/, "an accessible loading label should be present");
});

test("#hero-price carries role=status and aria-live=polite for a single clean announcement when the real price arrives", () => {
  const tagMatch = indexHtml.match(/<span class="hero-price[^"]*" id="hero-price"([^>]*)>/);
  assert.ok(tagMatch);
  assert.match(tagMatch[1], /role="status"/);
  assert.match(tagMatch[1], /aria-live="polite"/);
});

test("the skeleton CSS reserves width via ch units (font-size-relative, minimizes layout shift) and has a reduced-motion fallback", () => {
  assert.match(stylesCss, /\.hero-price-skeleton\s*\{[^}]*min-width:\s*[\d.]+ch/);
  assert.match(stylesCss, /prefers-reduced-motion:\s*reduce[\s\S]{0,200}\.hero-price-skeleton\s*\{\s*animation:\s*none/);
});

// ---------------------------------------------------------------------
// Part B: the real inventory.js functions, against a minimal fake DOM
// (classList/attributes only — no browser, no new dependency).
// ---------------------------------------------------------------------
function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    contains: (c) => set.has(c),
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
  };
}

function makeHeroPriceEl() {
  const attrs = { role: "status", "aria-live": "polite" };
  let text = "";
  let html = '<span class="sr-only">Loading current flooring price</span>';
  const lineEl = {
    _html: '<placeholder/>',
    set innerHTML(v) { this._html = v; },
    get innerHTML() { return this._html; },
  };
  const el = {
    classList: makeClassList(["hero-price", "hero-price-skeleton"]),
    setAttribute(k, v) { attrs[k] = v; },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    set textContent(v) { text = v; html = null; },
    get textContent() { return text; },
    closest(sel) { return sel === ".hero-line-nowrap" ? lineEl : null; },
  };
  return { el, lineEl, attrs };
}

// inventory.js's top-level const/let bindings (CACHE_KEY, etc.) live in
// vm.runInThisContext's script-level scope, not on globalThis — running
// it more than once per process re-declares them and throws. Load it
// exactly once; each test below only swaps out globalThis.document
// before calling the already-loaded functions.
globalThis.window = { AIRTABLE_CONFIG: {}, location: { search: "", hash: "", pathname: "/", href: "http://localhost/", origin: "http://localhost" } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, body: { classList: makeClassList() } };
vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

function setupInventoryEnv() {
  const { el: priceEl, lineEl, attrs } = makeHeroPriceEl();
  const sqftEl = { textContent: "—" };
  const tiles = [];
  globalThis.document = {
    getElementById: (id) => (id === "hero-price" ? priceEl : id === "stat-sqft" ? sqftEl : null),
    querySelectorAll: (sel) => (sel === ".category-tile[href]" ? tiles : []),
    querySelector: () => null,
    addEventListener() {},
    body: { classList: makeClassList() },
  };
  return { priceEl, lineEl, sqftEl, attrs };
}

function baseItem(overrides) {
  return {
    id: overrides.productKey, productKey: overrides.productKey, name: overrides.name,
    webCategory: "Flooring", webSubcategory: "Luxury Vinyl Plank", statusLabel: "In Stock",
    qtyAvailable: 10, price: 0, availableSqFt: 0, ...overrides,
  };
}

test("a successful load with an eligible LVP row removes the skeleton and displays the real formatted price", () => {
  const { priceEl, attrs } = setupInventoryEnv();
  const items = [baseItem({ productKey: "A", price: 1.2, qtyAvailable: 23, availableSqFt: 550.85 })];
  updateHomepageDynamicContent(items);
  assert.equal(priceEl.textContent, "$1.20", "price should match the current fixture exactly");
  assert.equal(priceEl.classList.contains("hero-price-skeleton"), false, "skeleton class should be removed");
  assert.equal(attrs["aria-live"], undefined, "aria-live should be removed once real content is set (avoids re-announcing on later tile updates)");
});

test("a successful load also displays the formatted sq-ft total with an en-US thousands separator", () => {
  const { sqftEl } = setupInventoryEnv();
  const items = [
    baseItem({ productKey: "A", price: 1.2, qtyAvailable: 23, availableSqFt: 60000 }),
    baseItem({ productKey: "B", webSubcategory: "Laminate", price: 1.1, qtyAvailable: 40, availableSqFt: 40120.12 }),
  ];
  updateHomepageDynamicContent(items);
  assert.equal(sqftEl.textContent, "100,120");
});

test("no eligible LVP row (empty catalog or a failed fetch, which produces []) replaces the price clause with a neutral inventory link — never a fake number", () => {
  const { priceEl, lineEl } = setupInventoryEnv();
  updateHomepageDynamicContent([]);
  assert.equal(priceEl.textContent, "", "no digits should ever be written to the price element itself in this path");
  assert.match(lineEl.innerHTML, /View current inventory/);
  assert.match(lineEl.innerHTML, /href="\/shop\?cat=Flooring"/, "the link must still point at the real Inventory page");
});

test("the failure-state link never re-introduces $1.50 or any other hardcoded price text", () => {
  const { lineEl } = setupInventoryEnv();
  updateHomepageDynamicContent([]);
  assert.equal(/\$[\d.]/.test(lineEl.innerHTML), false);
});

test("a catalog with only non-LVP Flooring (no eligible LVP row) still resolves to the neutral link, not a stuck skeleton", () => {
  const { lineEl } = setupInventoryEnv();
  const items = [baseItem({ productKey: "A", webSubcategory: "Laminate", price: 1.1, qtyAvailable: 40, availableSqFt: 500 })];
  updateHomepageDynamicContent(items);
  assert.match(lineEl.innerHTML, /View current inventory/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll homepage hero-price loading/failure-state tests passed.");

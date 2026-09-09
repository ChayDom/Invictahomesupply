#!/usr/bin/env node
// ===================================================================
// Regression tests for inventory.js's client-side product-page metadata
// update (updateProductPageMetadata()/setProductPageRobotsMeta(), called
// from initProductDetail()).
//
// This is explicitly the FALLBACK/reinforcement layer, not the fix for
// social crawlers — the actual initial-HTML-response fix is
// netlify/edge-functions/product-meta.ts (see test/product-meta.test.mjs).
// These tests cover: a real browser's title/canonical/OG staying correct
// after client-side rendering, and the invalid-state noindex meta being
// added/removed correctly across renders.
//
// Imports the real inventory.js via vm.runInThisContext (same technique
// as test/quote-eligibility.test.mjs) — no reimplementation of the
// update logic here.
//
// Run with: node test/product-page-client-metadata.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const inventorySrc = fs.readFileSync(path.join(__dirname, "..", "inventory.js"), "utf8");

// --- Minimal fake DOM ------------------------------------------------
// Only the handful of elements/selectors initProductDetail() and its
// metadata helpers actually touch: the product-detail-root container,
// the known <meta>/<link> tags product.html ships statically, and
// document.title/document.head for the robots-meta create/remove path.

function makeAttrElement(initial = {}, onRemove) {
  const attrs = { ...initial };
  return {
    getAttribute(name) { return attrs[name] ?? null; },
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
    remove() { removedElements.push(this); if (onRemove) onRemove(); },
    _attrs: attrs,
  };
}

let removedElements = [];
let metaRobotsEl = null; // absent by default, like the real static product.html

function makeContainer() {
  return {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function freshDocumentState() {
  removedElements = [];
  metaRobotsEl = null;
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
  const doc = {
    title: "Product | Invicta Home Supply",
    getElementById: (id) => (id === "product-detail-root" ? container : null),
    querySelector: (sel) => {
      if (sel === 'meta[name="robots"]') return metaRobotsEl;
      return elements[sel] || null;
    },
    querySelectorAll: () => [],
    createElement: (tag) => {
      const el = makeAttrElement({}, () => { if (metaRobotsEl === el) metaRobotsEl = null; });
      el.tagName = tag;
      return el;
    },
    head: {
      appendChild: (el) => { metaRobotsEl = el; },
    },
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

function baseItem(overrides) {
  return {
    id: "recTEST0000000001",
    productKey: "LEG-HD-001157",
    name: "Test Oak LVP Flooring",
    webCategory: "Flooring",
    webSubcategory: "Luxury Vinyl Plank",
    price: 2.49,
    sqFtPerUnit: 24,
    availableSqFt: 480,
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

test("a valid product updates document.title", ({ doc }) => {
  initProductDetail([baseItem()]);
  assert.equal(doc.title, "Test Oak LVP Flooring | Invicta Home Supply");
});

test("a valid product updates the canonical link to include the encoded Product Key", ({ elements }) => {
  initProductDetail([baseItem()]);
  assert.equal(elements['link[rel="canonical"]'].getAttribute("href"), "https://invictahomesupply.com/product.html?id=LEG-HD-001157");
});

test("a valid product's canonical never uses window.location's own (possibly preview) hostname", ({ elements }) => {
  globalThis.window.location.href = "https://final-pre-production--invictahomesupply.netlify.app/product.html?id=LEG-HD-001157";
  initProductDetail([baseItem()]);
  const href = elements['link[rel="canonical"]'].getAttribute("href");
  assert.equal(href.startsWith("https://invictahomesupply.com/"), true);
});

test("a valid product sets og:url equal to the canonical", ({ elements }) => {
  initProductDetail([baseItem()]);
  assert.equal(elements['meta[property="og:url"]'].getAttribute("content"), elements['link[rel="canonical"]'].getAttribute("href"));
});

test("a valid product sets og:type to 'product'", ({ elements }) => {
  initProductDetail([baseItem()]);
  assert.equal(elements['meta[property="og:type"]'].getAttribute("content"), "product");
});

test("a valid product's og:image uses its own first photo", ({ elements }) => {
  initProductDetail([baseItem()]);
  assert.equal(elements['meta[property="og:image"]'].getAttribute("content"), "https://example.com/photo1.jpg");
});

test("a product with no photos falls back to the site's social-sharing image", ({ elements }) => {
  initProductDetail([baseItem({ photos: [] })]);
  assert.equal(elements['meta[property="og:image"]'].getAttribute("content"), "https://invictahomesupply.com/assets/og/invicta-og-image.png");
});

test("a valid product's Twitter title/description match its own name/description", ({ elements }) => {
  initProductDetail([baseItem()]);
  assert.equal(elements['meta[name="twitter:title"]'].getAttribute("content"), "Test Oak LVP Flooring | Invicta Home Supply");
  assert.equal(elements['meta[name="twitter:description"]'].getAttribute("content"), "Waterproof luxury vinyl plank flooring, brand-new overstock.");
});

test("a valid product removes any stale robots noindex meta from an earlier render", ({ doc }) => {
  // Simulate the not-found path having already run once on this document.
  const stale = makeAttrElement({ name: "robots", content: "noindex, follow" }, () => { metaRobotsEl = null; });
  metaRobotsEl = stale;
  initProductDetail([baseItem()]);
  assert.equal(doc.querySelector('meta[name="robots"]'), null);
});

test("a missing id adds a noindex, follow robots meta", ({ doc }) => {
  globalThis.window.location.search = "";
  initProductDetail([baseItem()]);
  assert.equal(doc.querySelector('meta[name="robots"]').getAttribute("content"), "noindex, follow");
});

test("an unknown id adds a noindex, follow robots meta", ({ doc }) => {
  globalThis.window.location.search = "?id=DOES-NOT-EXIST";
  initProductDetail([baseItem()]);
  assert.equal(doc.querySelector('meta[name="robots"]').getAttribute("content"), "noindex, follow");
});

test("an invalid page's title/OG are never overwritten with stale product data", ({ doc, elements }) => {
  globalThis.window.location.search = "?id=DOES-NOT-EXIST";
  initProductDetail([baseItem()]);
  assert.equal(doc.title, "Product | Invicta Home Supply"); // untouched generic value
  assert.equal(elements['meta[property="og:title"]'].getAttribute("content"), "Product | Invicta Home Supply");
});

test("an invalid page still renders a working link back to Inventory", ({ container }) => {
  globalThis.window.location.search = "?id=DOES-NOT-EXIST";
  initProductDetail([baseItem()]);
  assert.equal(container.innerHTML.includes('href="/shop"'), true);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll product-page client-metadata tests passed.");

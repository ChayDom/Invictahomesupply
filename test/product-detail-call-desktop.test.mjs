#!/usr/bin/env node
// ===================================================================
// Regression test for product-detail's own Call action going
// mobile/tablet-only, independent of the header's Call/Text behavior
// (see header-desktop-phone-text.test.mjs, untouched by this change)
// and independent of the Text Us secondary link (see
// inquiry-forms-check-availability-and-quote.test.mjs).
//
// Background: product-detail's actions row used to always render a
// visible "Call" tel: link on every width. At 881px+ that's the same
// unwanted-OS-app-picker problem the header's own Call/Text buttons
// already solve for at this exact breakpoint — a desktop visitor
// should never get a tel: prompt from a plain click. Below 881px the
// Call button's existing behavior is completely unchanged.
//
// The fix: initProductDetail() tags the Call anchor with
// .product-detail-call (see inventory.js); styles.css hides it via
// display:none inside the existing @media (min-width: 881px) block
// that also hides .text-us-secondary/.contractor-text-us (same
// guarantee: dropped from layout AND tab order/hit-testing, not just
// visually hidden), and a second, later @media (min-width: 881px)
// block gives the row's two remaining buttons (primary CTA, Back to
// inventory) flex: 1 1 100% so each fills the row instead of sharing
// it at the normal 160px basis — that second block has to be placed
// after .product-detail-actions .btn's own unconditional base rule to
// win the cascade tie (see the comment in styles.css explaining why
// the same override in the earlier 881px block would silently lose).
//
// "Computed visibility, not only CSS source text": the cascade
// evaluator below (same technique as
// test/header-desktop-phone-text.test.mjs) computes real
// display/flex values for the required width matrix directly from the
// shipped CSS text, rather than trusting that the right-looking rule
// exists somewhere in the file.
//
// Run with: node test/product-detail-call-desktop.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const inventorySrc = fs.readFileSync(path.join(ROOT, "inventory.js"), "utf8");
const stylesSrc = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

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
// Part 1: render initProductDetail() for real via the same fake-DOM
// sandbox technique as test/inquiry-forms-check-availability-and-quote.test.mjs.
// ---------------------------------------------------------------------
globalThis.window = { AIRTABLE_CONFIG: {}, SITE_CONFIG: { phoneHref: "+12145522145" }, location: { search: "?id=LEG-HD-001157", hash: "", pathname: "/product.html", href: "https://invictahomesupply.com/product.html?id=LEG-HD-001157" } };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

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
  return { innerHTML: "", querySelector: () => null, querySelectorAll: () => [] };
}
function freshDocumentState() {
  const elements = {
    'meta[name="description"]': makeAttrElement({ content: "" }),
    'link[rel="canonical"]': makeAttrElement({ href: "" }),
    'meta[property="og:type"]': makeAttrElement({ content: "" }),
    'meta[property="og:url"]': makeAttrElement({ content: "" }),
    'meta[property="og:title"]': makeAttrElement({ content: "" }),
    'meta[property="og:description"]': makeAttrElement({ content: "" }),
    'meta[property="og:image"]': makeAttrElement({ content: "" }),
    'meta[name="twitter:title"]': makeAttrElement({ content: "" }),
    'meta[name="twitter:description"]': makeAttrElement({ content: "" }),
    'meta[name="twitter:image"]': makeAttrElement({ content: "" }),
  };
  const container = makeContainer();
  let metaRobotsEl = null;
  const doc = {
    title: "",
    getElementById: (id) => (id === "product-detail-root" ? container : null),
    querySelector: (sel) => (sel === 'meta[name="robots"]' ? metaRobotsEl : (elements[sel] || null)),
    querySelectorAll: () => [],
    createElement: (tag) => { const el = makeAttrElement({}); el.tagName = tag; return el; },
    head: { appendChild: (el) => { metaRobotsEl = el; } },
    addEventListener: () => {},
    body: { classList: { add() {}, remove() {}, toggle() {} } },
  };
  return { doc, container };
}
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
    price: 2.49,
    boxPrice: 42.11,
    sqFtPerUnit: 24,
    availableSqFt: 480,
    statusLabel: "In Stock",
    photos: ["https://example.com/photo1.jpg"],
    ...overrides,
  };
}
function nonEligibleItem(overrides) {
  return flooringItem({ webCategory: "Appliances", webSubcategory: "Refrigerator", price: 649, boxPrice: undefined, sqFtPerUnit: undefined, ...overrides });
}

function renderProductDetail(item) {
  const { doc, container } = freshDocumentState();
  currentDoc = doc;
  initProductDetail([item]);
  return container.innerHTML;
}

test("initProductDetail(): the Call anchor carries the product-detail-call class, keeps its tel: href and data-tel-link binding hook, unchanged wording", () => {
  const html = renderProductDetail(nonEligibleItem());
  const m = html.match(/<a href="tel:" data-tel-link class="[^"]*"[^>]*>Call<\/a>/);
  assert.ok(m, "expected a tel: Call anchor with data-tel-link");
  assert.match(m[0], /class="[^"]*\bproduct-detail-call\b[^"]*"/);
});

test("initProductDetail(): regular (non-eligible) product — exactly one primary Check Availability button, Call, Text Us, and Back to inventory each appear exactly once, no duplicate labels", () => {
  const html = renderProductDetail(nonEligibleItem());
  assert.equal((html.match(/>Check Availability</g) || []).length, 1);
  assert.doesNotMatch(html, />Get a Quote</);
  assert.equal((html.match(/>Call</g) || []).length, 1);
  assert.equal((html.match(/>Text Us</g) || []).length, 1);
  assert.equal((html.match(/>Back to inventory</g) || []).length, 1);
});

test("initProductDetail(): quote-eligible Flooring — exactly one primary Get a Quote button, Call, Text Us, and Back to inventory each appear exactly once, no Check Availability anywhere", () => {
  const html = renderProductDetail(flooringItem());
  assert.equal((html.match(/>Get a Quote</g) || []).length, 1);
  assert.doesNotMatch(html, />Check Availability</);
  assert.equal((html.match(/>Call</g) || []).length, 1);
  assert.equal((html.match(/>Text Us</g) || []).length, 1);
  assert.equal((html.match(/>Back to inventory</g) || []).length, 1);
});

test("initProductDetail(): Back to inventory renders with a working href at every item state, including out-of-stock", () => {
  for (const item of [nonEligibleItem(), flooringItem(), flooringItem({ statusLabel: "Sold Out" })]) {
    const html = renderProductDetail(item);
    const m = html.match(/<a href="([^"]+)" class="btn btn-outline">Back to inventory<\/a>/);
    assert.ok(m, "expected a Back to inventory link with a real href");
    assert.ok(m[1].length > 0);
  }
});

// ---------------------------------------------------------------------
// Part 2: computed CSS cascade — same technique as
// test/header-desktop-phone-text.test.mjs.
// ---------------------------------------------------------------------
function declaredValue(selector, prop, blockSrc) {
  const re = new RegExp(selector.replace(/[.#]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = blockSrc.match(re);
  if (!m) return null;
  const d = m[1].match(new RegExp(prop.replace(/[.#]/g, "\\$&") + ":\\s*([a-z0-9%\\-. ]+)"));
  return d ? d[1].trim() : null;
}
function computedValue(selector, prop, width) {
  let value = null;
  const baseMatch = stylesSrc.match(new RegExp(`\\n${selector.replace(/[.#]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  if (baseMatch) value = declaredValue(selector, prop, `${selector} {${baseMatch[1]}}`);
  const re = /@media \(min-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}\n/g;
  let m;
  while ((m = re.exec(stylesSrc))) {
    const minWidth = Number(m[1]);
    if (width < minWidth) continue;
    const d = declaredValue(selector, prop, m[0]);
    if (d) value = d;
  }
  return value;
}
function isVisible(selector, width) { return computedValue(selector, "display", width) !== "none"; }

const CALL_MATRIX = [
  [320, true], [390, true], [430, true], [768, true], [880, true],
  [881, false], [1024, false], [1440, false],
];
for (const [width, expectedVisible] of CALL_MATRIX) {
  test(`computed cascade at ${width}px: .product-detail-call is ${expectedVisible ? "visible" : "hidden"}`, () => {
    assert.equal(isVisible(".btn.product-detail-call", width), expectedVisible);
  });
}

test("computed cascade: .product-detail-call is display:none (not visibility:hidden/opacity:0) at 881px+ — removed from layout, tab order, and hit-testing, not just invisible", () => {
  assert.equal(computedValue(".btn.product-detail-call", "display", 1024), "none");
});

test("computed cascade: .product-detail-actions .btn is 160px-basis below 881px (unchanged desktop-Call-era layout) and full-width (100%) at 881px+", () => {
  for (const width of [320, 390, 768, 880]) {
    assert.equal(computedValue(".product-detail-actions .btn", "flex", width), "1 1 160px", `expected the original 160px basis at ${width}px`);
  }
  for (const width of [881, 1024, 1440]) {
    assert.equal(computedValue(".product-detail-actions .btn", "flex", width), "1 1 100%", `expected full-width stacking at ${width}px`);
  }
});

test("computed cascade: .text-us-secondary and .contractor-text-us are still hidden at 881px+ (unaffected by this change) — desktop never shows Text Us", () => {
  for (const width of [881, 1024, 1440]) {
    assert.equal(isVisible(".btn.text-us-secondary", width), false);
    assert.equal(isVisible(".btn.contractor-text-us", width), false);
  }
  for (const width of [320, 390, 768, 880]) {
    assert.equal(isVisible(".btn.text-us-secondary", width), true);
  }
});

test("styles.css: no rule leaves an empty flex row — .product-detail-actions itself keeps display:flex/flex-wrap at every width (no width-specific display override removes the container)", () => {
  assert.doesNotMatch(stylesSrc, /\.product-detail-actions\s*\{[^}]*display:\s*none/);
  const base = stylesSrc.match(/\n\.product-detail-actions\s*\{([^}]*)\}/);
  assert.ok(base, "expected a base .product-detail-actions rule");
  assert.match(base[1], /display:\s*flex/);
  assert.match(base[1], /flex-wrap:\s*wrap/);
});

// ---------------------------------------------------------------------
// Part 3: no horizontal overflow at 320px — same reasoning as the
// inquiry-forms suite's equivalent check: no fixed pixel width wider
// than 320px on the affected selectors.
// ---------------------------------------------------------------------
test("styles.css: neither .product-detail-actions nor its .btn children set a fixed pixel width wider than 320px", () => {
  for (const selector of [".product-detail-actions", ".product-detail-actions .btn"]) {
    const re = new RegExp(selector.replace(/[.#]/g, "\\$&") + "\\s*\\{([^}]*)\\}", "g");
    let m;
    while ((m = re.exec(stylesSrc))) {
      const fixedWidth = m[1].match(/(?<!max-|min-)width:\s*(\d+)px/);
      if (fixedWidth) assert.ok(Number(fixedWidth[1]) <= 320, `${selector} sets width:${fixedWidth[1]}px, which would overflow a 320px viewport`);
    }
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll product-detail Call desktop-hide tests passed.");

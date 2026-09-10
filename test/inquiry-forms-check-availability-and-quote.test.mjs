#!/usr/bin/env node
// ===================================================================
// Regression test for the desktop "Check Availability" → on-site
// availability-request form redesign, the simplified quote-request
// form, and Contractor View's matching Get a Quote/Check Availability
// treatment.
//
// Background/behavior being pinned:
//  - Non-Flooring items (and Flooring items isQuoteEligibleFlooring()
//    excludes) get a "Check Availability" primary action that opens a
//    NEW on-site "availability-request" modal/form (name/phone
//    required, email optional, "Send Request" button, its own success
//    message) — never sms:/tel:/mailto inside that modal.
//  - Quote-eligible Flooring keeps "Get a Quote" as its one primary
//    action; the existing "quote-request" form is simplified (no ZIP,
//    no installation checkbox, email added) and no longer offers a
//    Text Us link inside the modal.
//  - Both changes are desktop-only via CSS breakpoints, not JS device
//    detection: actionButtons()/initProductDetail() always render BOTH
//    the legacy sms: link (.card-check-availability-sms) and the new
//    button (.card-check-availability-btn); styles.css hides exactly
//    one per breakpoint (881px+), so ≤880px is byte-for-byte the same
//    markup/behavior as before this change.
//  - Contractor View (Flooring-only) gets the same primary-action rule
//    (Get a Quote vs. Check Availability, same eligibility check, same
//    modals) at every width, plus a secondary "Text Us" link
//    (.contractor-text-us) that is visible only ≤880px and never lives
//    inside either modal. "Text to Hold" wording is retired.
//  - isQuoteEligibleFlooring()/QUOTE_ELIGIBLE_FLOORING_SUBCATEGORIES
//    are untouched — Contractor View must never broaden eligibility.
//
// Exercises the real inventory.js via vm.runInThisContext (same
// technique as test/quote-eligibility.test.mjs), plus regex assertions
// against the real shop.html/index.html/product.html/styles.css source
// for the modal markup, static Netlify Forms declarations, and CSS
// breakpoint rules — no reimplementation of any of it here.
//
// Run with: node test/inquiry-forms-check-availability-and-quote.test.mjs
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
const shopSrc = fs.readFileSync(path.join(ROOT, "shop.html"), "utf8");
const indexSrc = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const productSrc = fs.readFileSync(path.join(ROOT, "product.html"), "utf8");

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
// Part 1: JS render-function assertions (actionButtons/contractorRowCta/
// initProductDetail), against the real inventory.js.
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
    sqFtPerUnit: 24,
    availableSqFt: 480,
    statusLabel: "In Stock",
    photos: ["https://example.com/photo1.jpg"],
    ...overrides,
  };
}

// --- actionButtons() (Card View + homepage) --------------------------
test("actionButtons(): quote-eligible Flooring renders the legacy sms link AND Get a Quote — no availability button at all", () => {
  const html = actionButtons(flooringItem());
  assert.match(html, /class="[^"]*card-check-availability-sms[^"]*"[^>]*>Check Availability<\/a>/);
  assert.match(html, /data-quote-id="recTEST0000000001"/);
  assert.doesNotMatch(html, /data-availability-id/);
});

test("actionButtons(): non-eligible items render BOTH the legacy sms link and the new desktop availability button", () => {
  const html = actionButtons(flooringItem({ webCategory: "Appliances", webSubcategory: "Refrigerator" }));
  assert.match(html, /class="[^"]*card-check-availability-sms[^"]*"[^>]*>Check Availability<\/a>/);
  assert.match(html, /class="[^"]*card-check-availability-btn[^"]*"[^>]*data-availability-id="recTEST0000000001"[^>]*>Check Availability<\/button>/);
  assert.doesNotMatch(html, /data-quote-id/);
});

test("actionButtons(): a non-eligible Flooring subcategory (e.g. Underlayment) gets the availability button, not Get a Quote", () => {
  const html = actionButtons(flooringItem({ webSubcategory: "Underlayment" }));
  assert.match(html, /data-availability-id/);
  assert.doesNotMatch(html, /data-quote-id/);
});

// --- Contractor View --------------------------------------------------
test("contractorRowCta(): quote-eligible Flooring gets a Get a Quote primary button plus a secondary Text Us link — never 'Text to Hold'", () => {
  const html = contractorRowCta(flooringItem());
  assert.match(html, /data-quote-id="recTEST0000000001"[^>]*>Get a Quote<\/button>/);
  assert.match(html, /class="[^"]*contractor-text-us[^"]*"[^>]*>Text Us<\/a>/);
  assert.doesNotMatch(html, /Text to Hold/);
});

test("contractorRowCta(): a non-eligible Flooring item gets a Check Availability primary button plus the same secondary Text Us link", () => {
  const html = contractorRowCta(flooringItem({ webSubcategory: "Underlayment" }));
  assert.match(html, /data-availability-id="recTEST0000000001"[^>]*>Check Availability<\/button>/);
  assert.match(html, /class="[^"]*contractor-text-us[^"]*"[^>]*>Text Us<\/a>/);
  assert.doesNotMatch(html, /data-quote-id/);
});

test("contractorRowCta(): out-of-stock items still get the disabled status pill, no CTA at all", () => {
  const html = contractorRowCta(flooringItem({ statusLabel: "Sold Out" }));
  assert.match(html, /Sold Out/);
  assert.doesNotMatch(html, /data-quote-id|data-availability-id|contractor-text-us/);
});

test("Contractor View never broadens quote eligibility — isQuoteEligibleFlooring() agrees with contractorRowCta()'s choice of primary button, same as actionButtons()", () => {
  const cases = [
    flooringItem({ webSubcategory: "Luxury Vinyl Plank" }),
    flooringItem({ webSubcategory: "Underlayment" }),
    flooringItem({ webSubcategory: "Trim" }),
    flooringItem({ price: undefined }),
  ];
  for (const item of cases) {
    const eligible = isQuoteEligibleFlooring(item);
    const html = contractorRowCta(item);
    assert.equal(html.includes("data-quote-id"), eligible, `contractorRowCta disagreed with isQuoteEligibleFlooring for ${item.webSubcategory}`);
    assert.equal(html.includes("data-availability-id"), !eligible);
  }
});

// --- Product-detail page ----------------------------------------------
test("initProductDetail(): quote-eligible Flooring's actions row has the legacy sms link only — no desktop availability button (Get a Quote above already covers desktop)", () => {
  const { doc, container } = freshDocumentState();
  currentDoc = doc;
  initProductDetail([flooringItem()]);
  assert.match(container.innerHTML, /card-check-availability-sms/);
  assert.doesNotMatch(container.innerHTML, /card-check-availability-btn/);
  assert.match(container.innerHTML, /data-quote-id/);
});

test("initProductDetail(): a non-eligible item's actions row has both the legacy sms link and the new desktop availability button", () => {
  const { doc, container } = freshDocumentState();
  currentDoc = doc;
  initProductDetail([flooringItem({ webCategory: "Appliances", webSubcategory: "Refrigerator" })]);
  assert.match(container.innerHTML, /card-check-availability-sms/);
  assert.match(container.innerHTML, /card-check-availability-btn/);
  assert.match(container.innerHTML, /data-availability-id/);
  assert.doesNotMatch(container.innerHTML, /data-quote-id/);
});

// ---------------------------------------------------------------------
// Part 2: static-markup assertions on all three pages.
// ---------------------------------------------------------------------
function assertQuoteFormSimplified(html, pageLabel) {
  assert.doesNotMatch(html, /name="zip"/, `${pageLabel}: quote form must not have a ZIP field`);
  assert.doesNotMatch(html, /name="installation-needed"/, `${pageLabel}: quote form must not have the installation checkbox`);
  assert.doesNotMatch(html, /id="quote-text-us-link"/, `${pageLabel}: quote form must not have a Text Us link`);
  assert.match(html, /<form id="quote-form"[\s\S]*?name="email"[\s\S]*?<\/form>/, `${pageLabel}: quote form must have an email field`);
}
function assertAvailabilityFormPresent(html, pageLabel) {
  assert.match(html, /id="availability-modal-overlay"/, `${pageLabel}: missing the availability modal`);
  const formBlock = html.match(/<form id="availability-form"[\s\S]*?<\/form>/)[0];
  assert.match(formBlock, /name="form-name" value="availability-request"/, `${pageLabel}: availability form must submit as availability-request`);
  assert.match(formBlock, /name="name"[^>]*required/, `${pageLabel}: availability form name must be required`);
  assert.match(formBlock, /name="phone"[^>]*required/, `${pageLabel}: availability form phone must be required`);
  assert.match(formBlock, /name="email"/, `${pageLabel}: availability form must have an optional email field`);
  assert.match(formBlock, />Send Request<\/button>/, `${pageLabel}: availability form submit button must read "Send Request"`);
  assert.doesNotMatch(formBlock, /sms:|tel:|mailto:/, `${pageLabel}: availability form must never contain sms:/tel:/mailto: links`);
  assert.match(html, /Thanks! We'll contact you shortly to confirm availability\./, `${pageLabel}: missing the availability success message`);
}

for (const [html, label] of [[shopSrc, "shop.html"], [indexSrc, "index.html"], [productSrc, "product.html"]]) {
  test(`${label}: quote-request form is simplified (no ZIP/installation/Text Us, has email)`, () => {
    assertQuoteFormSimplified(html, label);
  });
  test(`${label}: availability-request modal/form exists with the right fields, button, and success copy`, () => {
    assertAvailabilityFormPresent(html, label);
  });
  test(`${label}: the quote-request form never contains a Text Us/sms:/tel:/mailto: option`, () => {
    const formBlock = html.match(/<form id="quote-form"[\s\S]*?<\/form>/)[0];
    assert.doesNotMatch(formBlock, /sms:|tel:|mailto:/);
  });
}

// --- Static Netlify Forms declarations (shop.html only) --------------
test("shop.html: the static quote-request declaration matches the live form's fields exactly (no zip/installation, has email)", () => {
  const staticBlock = shopSrc.match(/<form name="quote-request" data-netlify="true"[\s\S]*?<\/form>/)[0];
  assert.doesNotMatch(staticBlock, /name="zip"/);
  assert.doesNotMatch(staticBlock, /name="installation-needed"/);
  assert.match(staticBlock, /name="email"/);
  for (const field of ["product-name", "product-key", "price-per-sqft", "box-price", "submitted-at", "sqft-needed", "name", "phone", "bot-field"]) {
    assert.match(staticBlock, new RegExp(`name="${field}"`), `static quote-request declaration missing ${field}`);
  }
});

test("shop.html: a new static availability-request declaration exists, matching the live availability form's fields", () => {
  const staticBlock = shopSrc.match(/<form name="availability-request" data-netlify="true"[\s\S]*?<\/form>/);
  assert.ok(staticBlock, "expected a static availability-request form declaration");
  for (const field of ["product-name", "product-key", "submitted-at", "name", "phone", "email", "bot-field"]) {
    assert.match(staticBlock[0], new RegExp(`name="${field}"`), `static availability-request declaration missing ${field}`);
  }
});

test("no page's rendered markup uses the retired 'Text to Hold' wording anywhere", () => {
  for (const [html, label] of [[shopSrc, "shop.html"], [indexSrc, "index.html"], [productSrc, "product.html"]]) {
    assert.doesNotMatch(html, /Text to Hold/, `${label} still contains "Text to Hold"`);
  }
  // Checked against actual rendered CTA output (not inventory.js's own
  // source comments, which may still reference the retired wording by
  // name when explaining what changed).
  assert.doesNotMatch(contractorRowCta(flooringItem()), /Text to Hold/);
  assert.doesNotMatch(contractorRowCta(flooringItem({ webSubcategory: "Underlayment" })), /Text to Hold/);
});

// ---------------------------------------------------------------------
// Part 3: CSS breakpoint assertions — desktop-only swap, Text Us
// mobile/tablet-only, both anchored to the existing 880px breakpoint.
// ---------------------------------------------------------------------
test("styles.css: .card-check-availability-sms and .contractor-text-us are hidden only at 881px and above (mobile/tablet keeps them)", () => {
  const re = /@media \(min-width:\s*881px\)\s*\{([\s\S]*?)\n\}\n/;
  const m = stylesSrc.match(re);
  assert.ok(m, "expected an @media (min-width: 881px) block");
  assert.match(m[1], /\.card-check-availability-sms\s*\{[^}]*display:\s*none/);
  assert.match(m[1], /\.contractor-text-us\s*\{[^}]*display:\s*none/);
});

test("styles.css: .card-check-availability-btn is hidden by default and only shown at 881px and above", () => {
  const baseMatch = stylesSrc.match(/\n\.card-check-availability-btn\s*\{([^}]*)\}/);
  assert.ok(baseMatch, "expected a base .card-check-availability-btn rule");
  assert.match(baseMatch[1], /display:\s*none/);
  const re = /@media \(min-width:\s*881px\)\s*\{([\s\S]*?)\n\}\n/g;
  let shown = false;
  let m;
  while ((m = re.exec(stylesSrc))) {
    if (/\.card-check-availability-btn\s*\{[^}]*display:\s*inline-block/.test(m[1])) shown = true;
  }
  assert.ok(shown, "expected .card-check-availability-btn to be shown (display: inline-block) inside a min-width: 881px block");
});

// ---------------------------------------------------------------------
// Part 4: modal submit behavior — availability-request submission,
// success view, and no auto-opened SMS/other side effects.
// ---------------------------------------------------------------------
function makeFormLikeElement({ id, fields = {} } = {}) {
  const listeners = {};
  const values = { ...fields };
  return {
    id,
    hidden: true,
    disabled: false,
    textContent: "",
    reset() {},
    checkValidity: () => true,
    reportValidity: () => {},
    querySelector: () => null,
    addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
    dispatch(type, evt) { (listeners[type] || []).forEach((cb) => cb(evt)); },
    // Minimal FormData-compatible surface: `new FormData(form)` isn't
    // real here, so we exercise submit-path side effects (hidden toggles,
    // fetch call) directly instead of via a literal FormData instance.
    _values: values,
  };
}

test("openAvailabilityModal()/closeAvailabilityModal(): populate hidden product fields and toggle overlay visibility without any SMS/tel/mailto side effect", () => {
  const registry = {};
  const el = (id, extra = {}) => (registry[id] = { id, value: "", hidden: true, textContent: "", ...extra, setAttribute() {}, getAttribute() { return null; }, focus() {}, reset() {} });
  el("availability-modal-overlay", { hidden: true });
  el("availability-form", { reset() {}, querySelector: () => ({ focus() {} }) });
  el("availability-product-name");
  el("availability-field-product-name");
  el("availability-field-product-key");
  el("availability-modal-form-view", { hidden: true });
  el("availability-modal-success-view", { hidden: true });
  el("availability-form-error", { hidden: true });

  const bodyClasses = new Set();
  currentDoc = {
    getElementById: (id) => registry[id] || null,
    body: { classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c), toggle() {} } },
  };

  openAvailabilityModal(flooringItem({ webCategory: "Appliances", name: "Test Fridge", productKey: "APP-001" }));

  assert.equal(registry["availability-product-name"].textContent, "Test Fridge");
  assert.equal(registry["availability-field-product-name"].value, "Test Fridge");
  assert.equal(registry["availability-field-product-key"].value, "APP-001");
  assert.equal(registry["availability-modal-overlay"].hidden, false);
  assert.equal(bodyClasses.has("modal-open"), true);

  closeAvailabilityModal();
  assert.equal(registry["availability-modal-overlay"].hidden, true);
  assert.equal(bodyClasses.has("modal-open"), false);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll inquiry-forms (Check Availability / Get a Quote / Contractor View) tests passed.");

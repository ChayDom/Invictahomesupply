#!/usr/bin/env node
// ===================================================================
// Regression test for the "Check Availability" / "Get a Quote" inquiry
// flow: exactly one primary form-opening button per item at every
// width, plus a secondary "Text Us" sms: link visible only at 880px
// and below (CSS-only — no JS device detection), the on-site
// "availability-request" and "quote-request" Netlify Forms, and their
// accessible-modal behavior (focus management, Escape/overlay close,
// Tab trapping, duplicate-submission prevention).
//
// Current design (post duplicate-button fix):
//  - actionButtons()/contractorRowCta()/initProductDetail() each render
//    ONE primary dark button (always visible, identical markup at every
//    width — never toggled by CSS or JS): "Get a Quote" for
//    isQuoteEligibleFlooring() items (opens the quote-request modal),
//    "Check Availability" for everything else (opens the
//    availability-request modal). A single secondary outlined "Text Us"
//    link (.text-us-secondary on cards/product-detail,
//    .contractor-text-us in Contractor View) uses the existing
//    product-specific sms: link and is hidden only at 881px+ via CSS
//    (styles.css's @media (min-width: 881px) block) — the exact
//    complement of the Filters-drawer breakpoint, and independent of
//    the header nav's own 1150/1151px breakpoint.
//  - Neither modal ever contains a Text Us/sms:/tel:/mailto: option.
//  - isQuoteEligibleFlooring()/QUOTE_ELIGIBLE_FLOORING_SUBCATEGORIES are
//    untouched — Contractor View must never broaden eligibility.
//  - The availability-request form: Name + Phone required, optional
//    "Message or quantity needed (optional)" textarea, no email/zip/
//    installation, "Send Request" submit button.
//  - The quote-request form: Approx. Sq Ft Needed + Name + Phone
//    required, optional "Questions or notes (optional)" textarea, no
//    email/zip/installation, "Request Quote" submit button.
//  - Both modals: unique IDs/aria-labelledby, role="dialog"
//    aria-modal="true", focus the first customer input on open, Escape
//    and overlay-click close, Tab is trapped within the modal, closing
//    restores focus to the exact button that opened it, a pending
//    submission disables the submit button so a second click/Enter
//    can't double-submit, and reopening for a different product resets
//    any prior success/error state.
//
// Exercises the real inventory.js via vm.runInThisContext (same
// technique as test/quote-eligibility.test.mjs and
// test/header-desktop-phone-text.test.mjs), plus regex/computed-cascade
// assertions against the real shop.html/index.html/product.html/
// styles.css source — no reimplementation of any of it here.
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
async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.stack || err.message}`);
  }
}

// ---------------------------------------------------------------------
// Load the real inventory.js into a fake-DOM sandbox (same pattern as
// test/header-desktop-phone-text.test.mjs / the prior version of this
// file) so actionButtons()/contractorRowCta()/initProductDetail()/the
// modal functions all run for real.
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
    activeElement: null,
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
globalThis.FormData = class {
  constructor(form) { this._entries = Object.entries((form && form._values) || {}); }
  forEach(cb) { this._entries.forEach(([k, v]) => cb(v, k)); }
};

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

// ---------------------------------------------------------------------
// Tiny cascade evaluator (same technique as
// test/header-desktop-phone-text.test.mjs) for computed visibility of
// .text-us-secondary / .contractor-text-us across real widths — proves
// the ACTUAL rendered/hidden state a browser would compute, not just
// that the CSS text exists somewhere.
// ---------------------------------------------------------------------
function declaredDisplay(selector, blockSrc) {
  const re = new RegExp(selector.replace(/[.#]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = blockSrc.match(re);
  if (!m) return null;
  const d = m[1].match(/display:\s*([a-z-]+)/);
  return d ? d[1] : null;
}
function computedDisplay(selector, width) {
  const baseMatch = stylesSrc.match(new RegExp(`\\n${selector.replace(/[.#]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  let value = baseMatch ? declaredDisplay(selector, `${selector} {${baseMatch[1]}}`) : "block";
  const re = /@media \(min-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}\n/g;
  let m;
  while ((m = re.exec(stylesSrc))) {
    const minWidth = Number(m[1]);
    if (width < minWidth) continue;
    const d = declaredDisplay(selector, m[0]);
    if (d) value = d;
  }
  return value;
}
function isVisible(selector, width) { return computedDisplay(selector, width) !== "none"; }

// ---------------------------------------------------------------------
// Group 1/2/3: regular product / eligible Flooring / non-eligible
// Flooring, at 390px and 1024px, via actionButtons() — the function
// shared by the homepage "New This Week" cards and Shop Card View.
// ---------------------------------------------------------------------
for (const width of [390, 1024]) {
  const mobile = width <= 880;

  test(`actionButtons() @ ${width}px: regular (non-eligible) product — exactly one primary "Check Availability" button, opens the availability modal, never labeled on the sms link`, () => {
    const html = actionButtons(nonEligibleItem());
    const primaryMatches = html.match(/data-availability-id="recTEST0000000001"/g) || [];
    assert.equal(primaryMatches.length, 1, "expected exactly one Check Availability button");
    assert.doesNotMatch(html, /data-quote-id/);
    assert.match(html, /<button[^>]*data-availability-id="recTEST0000000001"[^>]*>Check Availability<\/button>/);
    assert.ok(isVisible(".btn-dark", width) !== false, "primary btn-dark is never CSS-hidden");
    // The primary button carries no text-us-secondary/contractor-text-us
    // class, so it is never subject to the ≥881px hide rule.
    const primaryTag = html.match(/<button[^>]*data-availability-id[^>]*>/)[0];
    assert.doesNotMatch(primaryTag, /text-us-secondary|contractor-text-us/);
    const smsTag = html.match(/<a[^>]*text-us-secondary[^>]*>Text Us<\/a>/);
    assert.ok(smsTag, "expected a secondary Text Us sms link");
    assert.doesNotMatch(smsTag[0], />Check Availability</, 'the sms link must never be labeled "Check Availability"');
    const smsVisible = isVisible(".text-us-secondary", width);
    assert.equal(smsVisible, mobile, `Text Us should be ${mobile ? "visible" : "hidden"} at ${width}px`);
  });

  test(`actionButtons() @ ${width}px: quote-eligible Flooring — exactly one primary "Get a Quote" button, opens the quote modal, no Check Availability`, () => {
    const html = actionButtons(flooringItem());
    const primaryMatches = html.match(/data-quote-id="recTEST0000000001"/g) || [];
    assert.equal(primaryMatches.length, 1, "expected exactly one Get a Quote button");
    assert.doesNotMatch(html, /data-availability-id/);
    assert.doesNotMatch(html, />Check Availability</);
    assert.match(html, /<button[^>]*data-quote-id="recTEST0000000001"[^>]*>Get a Quote<\/button>/);
    const smsVisible = isVisible(".text-us-secondary", width);
    assert.equal(smsVisible, mobile, `Text Us should be ${mobile ? "visible" : "hidden"} at ${width}px`);
  });
}

test("actionButtons(): a non-eligible Flooring subcategory (e.g. Underlayment) gets Check Availability, not Get a Quote", () => {
  const html = actionButtons(flooringItem({ webSubcategory: "Underlayment" }));
  assert.match(html, /data-availability-id/);
  assert.doesNotMatch(html, /data-quote-id/);
});

test("actionButtons(): out-of-stock items render only the disabled status pill — no primary button, no Text Us", () => {
  const html = actionButtons(flooringItem({ statusLabel: "Sold Out" }));
  assert.match(html, />Sold Out</);
  assert.doesNotMatch(html, /data-quote-id|data-availability-id|text-us-secondary/);
});

// ---------------------------------------------------------------------
// Group 4: per-view repeats — homepage / Shop Card View share
// actionButtons() via productCard(), already covered above. Product-
// detail, Contractor desktop, and Contractor mobile get their own
// render functions and are checked here.
// ---------------------------------------------------------------------
test("productCard() (homepage 'New This Week' + Shop Card View): renders actionButtons() output with no duplicate CTA", () => {
  const html = productCard(nonEligibleItem({ photoCards: ["https://example.com/card.jpg"], photoThumbs: ["https://example.com/thumb.jpg"] }));
  const checkAvailMatches = html.match(/>Check Availability</g) || [];
  assert.equal(checkAvailMatches.length, 1, "expected exactly one 'Check Availability' label on the card");
});

test("initProductDetail(): non-eligible item's actions row has exactly one primary Check Availability button and a secondary Text Us link, no duplicate labels", () => {
  const { doc, container } = freshDocumentState();
  currentDoc = doc;
  initProductDetail([nonEligibleItem()]);
  const html = container.innerHTML;
  assert.equal((html.match(/>Check Availability</g) || []).length, 1);
  assert.match(html, /data-availability-id="recTEST0000000001"/);
  assert.doesNotMatch(html, /data-quote-id/);
  assert.match(html, /class="[^"]*text-us-secondary[^"]*"[^>]*>Text Us<\/a>/);
  const smsTag = html.match(/class="[^"]*text-us-secondary[^"]*"[^>]*>[^<]*<\/a>/)[0];
  assert.doesNotMatch(smsTag, />Check Availability</, 'the sms link must never be labeled "Check Availability"');
});

test("initProductDetail(): quote-eligible Flooring's actions row has exactly one primary Get a Quote button and a secondary Text Us link, no Check Availability anywhere", () => {
  const { doc, container } = freshDocumentState();
  currentDoc = doc;
  initProductDetail([flooringItem()]);
  const html = container.innerHTML;
  assert.equal((html.match(/>Get a Quote</g) || []).length, 1);
  assert.doesNotMatch(html, />Check Availability</);
  assert.match(html, /class="[^"]*text-us-secondary[^"]*"[^>]*>Text Us<\/a>/);
});

test("initProductDetail(): out-of-stock item shows only the disabled status pill, no primary button, no Text Us, still has Call/Back links", () => {
  const { doc, container } = freshDocumentState();
  currentDoc = doc;
  initProductDetail([flooringItem({ statusLabel: "Sold Out" })]);
  const html = container.innerHTML;
  assert.doesNotMatch(html, /data-quote-id|data-availability-id|text-us-secondary/);
  assert.match(html, />Sold Out</);
  assert.match(html, /data-tel-link/);
  assert.match(html, />Back to inventory</);
});

// --- Contractor View (desktop row + the same markup doubles as the
// mobile-card CTA source in this codebase — see contractorRowCta()) ---
test("contractorRowCta(): quote-eligible Flooring — desktop shows Get a Quote only (Text Us CSS-hidden ≥881px); mobile shows Get a Quote + Text Us — never 'Text to Hold'", () => {
  const html = contractorRowCta(flooringItem());
  assert.match(html, /data-quote-id="recTEST0000000001"[^>]*>Get a Quote<\/button>/);
  assert.match(html, /class="[^"]*contractor-text-us[^"]*"[^>]*>Text Us<\/a>/);
  assert.doesNotMatch(html, /data-availability-id/);
  assert.doesNotMatch(html, /Text to Hold/);
  assert.equal(isVisible(".contractor-text-us", 1024), false, "Text Us must be hidden on Contractor desktop (≥881px)");
  assert.equal(isVisible(".contractor-text-us", 390), true, "Text Us must be visible on Contractor mobile (≤880px)");
});

test("contractorRowCta(): non-eligible item — desktop shows Check Availability only; mobile shows Check Availability + Text Us", () => {
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

test("Contractor View never broadens quote eligibility — isQuoteEligibleFlooring() agrees with contractorRowCta()'s and actionButtons()' choice of primary button", () => {
  const cases = [
    flooringItem({ webSubcategory: "Luxury Vinyl Plank" }),
    flooringItem({ webSubcategory: "Underlayment" }),
    flooringItem({ webSubcategory: "Trim" }),
    flooringItem({ price: undefined }),
  ];
  for (const item of cases) {
    const eligible = isQuoteEligibleFlooring(item);
    const rowHtml = contractorRowCta(item);
    const cardHtml = actionButtons(item);
    assert.equal(rowHtml.includes("data-quote-id"), eligible, `contractorRowCta disagreed with isQuoteEligibleFlooring for ${item.webSubcategory}`);
    assert.equal(rowHtml.includes("data-availability-id"), !eligible);
    assert.equal(cardHtml.includes("data-quote-id"), eligible, `actionButtons disagreed with isQuoteEligibleFlooring for ${item.webSubcategory}`);
  }
});

test("no page's rendered markup uses the retired 'Text to Hold' wording anywhere", () => {
  for (const [html, label] of [[shopSrc, "shop.html"], [indexSrc, "index.html"], [productSrc, "product.html"]]) {
    assert.doesNotMatch(html, /Text to Hold/, `${label} still contains "Text to Hold"`);
  }
  assert.doesNotMatch(contractorRowCta(flooringItem()), /Text to Hold/);
  assert.doesNotMatch(contractorRowCta(flooringItem({ webSubcategory: "Underlayment" })), /Text to Hold/);
});

// ---------------------------------------------------------------------
// CSS: the .text-us-secondary/.contractor-text-us breakpoint, computed
// across the full required matrix, and the old per-button toggle
// classes are gone for good (they'd reintroduce the duplicate-button
// bug if resurrected).
// ---------------------------------------------------------------------
const VISIBILITY_MATRIX = [
  [320, true], [390, true], [430, true], [768, true], [880, true],
  [881, false], [1024, false], [1440, false],
];
for (const [width, expectedVisible] of VISIBILITY_MATRIX) {
  test(`computed cascade at ${width}px: .text-us-secondary and .contractor-text-us are ${expectedVisible ? "visible" : "hidden"}`, () => {
    assert.equal(isVisible(".text-us-secondary", width), expectedVisible);
    assert.equal(isVisible(".contractor-text-us", width), expectedVisible);
  });
}

test("styles.css: the retired .card-check-availability-sms/.card-check-availability-btn toggle classes do not exist anywhere", () => {
  assert.doesNotMatch(stylesSrc, /card-check-availability/);
  assert.doesNotMatch(inventorySrc, /card-check-availability/);
});

test("styles.css: no leftover rule hides the primary Get a Quote/Check Availability button at any width (it must be visible at every width)", () => {
  assert.doesNotMatch(stylesSrc, /\[data-quote-id\]\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(stylesSrc, /\.product-card \.product-actions \[data-quote-id\]/);
});

// ---------------------------------------------------------------------
// Group: static Netlify Forms declarations (shop.html only) — exact
// field sets per spec, with email/zip/installation-needed absent.
// ---------------------------------------------------------------------
test("shop.html: static quote-request declaration has exactly the required fields, no email/zip/installation", () => {
  const staticBlock = shopSrc.match(/<form name="quote-request" data-netlify="true"[\s\S]*?<\/form>/)[0];
  const required = ["product-name", "product-key", "price-per-sqft", "box-price", "submitted-at", "sqft-needed", "name", "phone", "notes", "bot-field"];
  for (const field of required) {
    assert.match(staticBlock, new RegExp(`name="${field}"`), `static quote-request declaration missing ${field}`);
  }
  const names = [...staticBlock.matchAll(/<input[^>]*\sname="([a-z-]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(names)].sort(), [...required].sort(), "quote-request static field set must match exactly");
  assert.doesNotMatch(staticBlock, /name="email"|name="zip"|name="installation-needed"/);
});

test("shop.html: static availability-request declaration has exactly the required fields, no email/zip/installation", () => {
  const staticBlock = shopSrc.match(/<form name="availability-request" data-netlify="true"[\s\S]*?<\/form>/)[0];
  const required = ["product-name", "product-key", "price", "submitted-at", "name", "phone", "message", "bot-field"];
  for (const field of required) {
    assert.match(staticBlock, new RegExp(`name="${field}"`), `static availability-request declaration missing ${field}`);
  }
  const names = [...staticBlock.matchAll(/<input[^>]*\sname="([a-z-]+)"/g)].map(m => m[1]);
  assert.deepEqual([...new Set(names)].sort(), [...required].sort(), "availability-request static field set must match exactly");
  assert.doesNotMatch(staticBlock, /name="email"|name="zip"|name="installation-needed"/);
});

test("index.html and product.html do not duplicate the static Netlify form declarations (only shop.html carries them)", () => {
  for (const [html, label] of [[indexSrc, "index.html"], [productSrc, "product.html"]]) {
    assert.doesNotMatch(html, /<form name="quote-request" data-netlify/, `${label} must not duplicate the static quote-request declaration`);
    assert.doesNotMatch(html, /<form name="availability-request" data-netlify/, `${label} must not duplicate the static availability-request declaration`);
  }
});

// ---------------------------------------------------------------------
// Group: live modal markup on all three pages — product context,
// required fields, exact labels/placeholders, exact submit-button text,
// exact success/error copy, no email/zip/installation/Text Us/tel/sms
// inside either modal, accessibility attributes.
// ---------------------------------------------------------------------
function extractById(html, id) {
  // Grabs the full <div id="..."> ... its matching closing </div> block
  // for the two known modal wrapper ids used below is unnecessary here —
  // callers only need the <form id="..."> ... </form> block, which is
  // never nested inside another <form>.
  const m = html.match(new RegExp(`<form id="${id}"[\\s\\S]*?<\\/form>`));
  assert.ok(m, `expected a <form id="${id}"> block`);
  return m[0];
}

for (const [html, label] of [[shopSrc, "shop.html"], [indexSrc, "index.html"], [productSrc, "product.html"]]) {
  test(`${label}: quote modal has product-name/price context, required Sq Ft/Name/Phone, the exact Notes textarea, Request Quote button, no email/zip/installation/Text Us/sms/tel/mailto`, () => {
    assert.match(html, /id="quote-modal-overlay"/);
    assert.match(html, /id="quote-product-name"/);
    assert.match(html, /id="quote-product-price"/);
    const form = extractById(html, "quote-form");
    assert.match(form, /name="sqft-needed"[^>]*required/);
    assert.match(form, /name="name"[^>]*required/);
    assert.match(form, /name="phone"[^>]*required/);
    assert.match(form, /<span>Questions or notes \(optional\)<\/span>\s*<textarea name="notes"[^>]*placeholder="Add any questions or details about your project">/);
    assert.match(form, />Request Quote<\/button>/);
    assert.match(form, /name="bot-field"/);
    assert.doesNotMatch(form, /name="email"|name="zip"|name="installation-needed"/);
    assert.doesNotMatch(form, /sms:|tel:|mailto:/);
    assert.doesNotMatch(html, /id="quote-text-us-link"/);
    assert.match(html, /Something went wrong\. Please try again or call us\./);
  });

  test(`${label}: quote modal's Approx. Sq Ft Needed field has the exact helper copy, associated via aria-describedby with no duplicate ids, and submitted fields are unchanged`, () => {
    const form = extractById(html, "quote-form");
    // Helper copy sits immediately after the sqft input, inside the same
    // .form-field wrapper — not merely present anywhere in the form.
    assert.match(form, /<input type="number" name="sqft-needed" id="quote-sqft-input"[^>]*aria-describedby="([a-zA-Z0-9_-]+)"[^>]*>\s*<p class="form-field-help" id="\1">An approximate square footage is enough for us to provide a price estimate\.<\/p>/);
    const idMatch = form.match(/id="(quote-sqft-help[a-zA-Z0-9_-]*)"/);
    assert.ok(idMatch, "expected a quote-sqft-help id on the helper <p>");
    const helpId = idMatch[1];
    const idOccurrences = html.match(new RegExp(`id="${helpId}"`, "g")) || [];
    assert.equal(idOccurrences.length, 1, `helper-text id "${helpId}" must not be duplicated anywhere on ${label}`);
    // The helper text must never leak into the general availability form.
    const availabilityForm = extractById(html, "availability-form");
    assert.doesNotMatch(availabilityForm, /An approximate square footage is enough for us to provide a price estimate\./);
    // Submitted (non-hidden-context) form fields are unchanged by this
    // copy addition — same required set, same names, as already pinned
    // above; this just re-confirms none of them were touched here.
    const submittedFieldNames = [...form.matchAll(/<(?:input|textarea)[^>]*\sname="([a-z-]+)"/g)].map(m => m[1]);
    assert.deepEqual(submittedFieldNames, ["form-name", "product-name", "product-key", "price-per-sqft", "box-price", "submitted-at", "bot-field", "sqft-needed", "name", "phone", "notes"]);
  });

  test(`${label}: quote modal is an accessible dialog with unique ids and matching aria-labelledby`, () => {
    const overlayBlock = html.match(/<div class="modal-overlay" id="quote-modal-overlay"[\s\S]*?<div class="modal"[^>]*>/)[0];
    assert.match(overlayBlock, /role="dialog"/);
    assert.match(overlayBlock, /aria-modal="true"/);
    assert.match(overlayBlock, /aria-labelledby="quote-product-name"/);
  });

  test(`${label}: availability modal has product-name/price context, required Name/Phone, the exact Message textarea, Send Request button, no email/zip/installation/tel/sms/mailto`, () => {
    assert.match(html, /id="availability-modal-overlay"/);
    assert.match(html, /id="availability-product-name"/);
    assert.match(html, /id="availability-product-price"/);
    const form = extractById(html, "availability-form");
    assert.match(form, /name="name"[^>]*required/);
    assert.match(form, /name="phone"[^>]*required/);
    assert.match(form, /<span>Message or quantity needed \(optional\)<\/span>\s*<textarea name="message"[^>]*placeholder="For example: quantity needed or any questions">/);
    assert.match(form, />Send Request<\/button>/);
    assert.match(form, /name="bot-field"/);
    assert.doesNotMatch(form, /name="email"|name="zip"|name="installation-needed"|name="sqft-needed"/);
    assert.doesNotMatch(form, /sms:|tel:|mailto:/);
    assert.match(html, /Thanks! We&#39;ll contact you shortly to confirm availability\.|Thanks! We'll contact you shortly to confirm availability\./);
  });

  test(`${label}: availability modal is an accessible dialog with unique ids and matching aria-labelledby, distinct from the quote modal's ids`, () => {
    const overlayBlock = html.match(/<div class="modal-overlay" id="availability-modal-overlay"[\s\S]*?<div class="modal"[^>]*>/)[0];
    assert.match(overlayBlock, /role="dialog"/);
    assert.match(overlayBlock, /aria-modal="true"/);
    assert.match(overlayBlock, /aria-labelledby="availability-product-name"/);
    // No id collisions between the two modals' hidden/product fields.
    assert.doesNotMatch(html, /id="quote-field-product-name"[\s\S]*id="quote-field-product-name"/);
  });

  test(`${label}: neither modal ever contains a Text Us/sms:/tel:/mailto option`, () => {
    const quoteForm = extractById(html, "quote-form");
    const availabilityForm = extractById(html, "availability-form");
    for (const form of [quoteForm, availabilityForm]) {
      assert.doesNotMatch(form, /Text Us/);
      assert.doesNotMatch(form, /sms:|tel:|mailto:/);
    }
  });
}

// ---------------------------------------------------------------------
// Modal behavior: focus management, Escape/overlay close, Tab trap,
// duplicate-submission prevention, and correct reset/repopulation on
// reopen — exercised against the real openQuoteModal/closeQuoteModal/
// bindQuoteModal and their availability-modal counterparts.
// ---------------------------------------------------------------------
function makeFocusable(id, extra = {}) {
  const el = {
    id,
    hidden: false,
    disabled: false,
    textContent: "",
    value: "",
    offsetParent: {},
    _listeners: {},
    addEventListener(type, cb) { (this._listeners[type] = this._listeners[type] || []).push(cb); },
    dispatchEvent(type, evt) { (this._listeners[type] || []).forEach(cb => cb(evt)); },
    setAttribute() {}, getAttribute() { return null; },
    focus() { currentDoc.activeElement = this; },
    ...extra,
  };
  return el;
}

// Builds a full fake registry for one modal ("quote" or "availability"),
// wired the same way the real DOM is: overlay.querySelectorAll(...)
// returns the modal's real focus order (close button -> form controls ->
// submit button), and document-level keydown/click listeners are
// captured so Escape/overlay-click/Tab can be exercised exactly as a
// browser would deliver them.
function makeModalHarness(kind) {
  const isQuote = kind === "quote";
  const registry = {};
  const bodyClasses = new Set();
  const docListeners = {};

  const closeBtn = makeFocusable(`${kind}-modal-close`);
  const nameInput = makeFocusable("name-input", { value: "" });
  const phoneInput = makeFocusable("phone-input", { value: "" });
  const notesInput = makeFocusable("notes-input", { value: "" });
  const submitBtn = makeFocusable(`${kind}-submit-btn`);
  const focusOrder = [closeBtn, nameInput, phoneInput, notesInput, submitBtn];

  const formValues = isQuote
    ? { "form-name": "quote-request", "sqft-needed": "120", name: "Jane Doe", phone: "2145551212", notes: "" }
    : { "form-name": "availability-request", name: "Jane Doe", phone: "2145551212", message: "" };

  const form = {
    id: `${kind}-form`,
    reset() {},
    checkValidity: () => true,
    reportValidity: () => {},
    querySelector: (sel) => {
      if (sel === '[name="sqft-needed"]') return makeFocusable("sqft-input");
      if (sel === '[name="name"]') return nameInput;
      return null;
    },
    _listeners: {},
    addEventListener(type, cb) { (this._listeners[type] = this._listeners[type] || []).push(cb); },
    dispatch(type, evt) { return Promise.all((this._listeners[type] || []).map(cb => cb(evt))); },
    _values: formValues,
  };

  const overlay = {
    id: `${kind}-modal-overlay`,
    hidden: true,
    addEventListener(type, cb) { (this._listeners = this._listeners || {}), (this._listeners[type] = this._listeners[type] || []).push(cb); },
    dispatch(type, evt) { ((this._listeners && this._listeners[type]) || []).forEach(cb => cb(evt)); },
    querySelectorAll: () => focusOrder,
  };

  Object.assign(registry, {
    [`${kind}-modal-overlay`]: overlay,
    [`${kind}-form`]: form,
    [`${kind}-modal-close`]: closeBtn,
    [`${kind}-modal-done`]: makeFocusable(`${kind}-modal-done`),
    [`${kind}-modal-form-view`]: makeFocusable(`${kind}-modal-form-view`, { hidden: false }),
    [`${kind}-modal-success-view`]: makeFocusable(`${kind}-modal-success-view`, { hidden: true }),
    [`${kind}-form-error`]: makeFocusable(`${kind}-form-error`, { hidden: true }),
    [`${kind}-submit-btn`]: submitBtn,
    [`${kind}-field-product-name`]: makeFocusable(`${kind}-field-product-name`),
    [`${kind}-field-product-key`]: makeFocusable(`${kind}-field-product-key`),
    [`${kind}-field-submitted-at`]: makeFocusable(`${kind}-field-submitted-at`),
    [`${isQuote ? "quote" : "availability"}-product-name`]: makeFocusable("product-name-display"),
    [`${isQuote ? "quote" : "availability"}-product-price`]: makeFocusable("product-price-display"),
  });
  if (isQuote) {
    registry["quote-field-price-per-sqft"] = makeFocusable("quote-field-price-per-sqft");
    registry["quote-field-box-price"] = makeFocusable("quote-field-box-price");
  } else {
    registry["availability-field-price"] = makeFocusable("availability-field-price");
  }

  const doc = {
    activeElement: null,
    getElementById: (id) => registry[id] || null,
    body: { classList: { add: (c) => bodyClasses.add(c), remove: (c) => bodyClasses.delete(c), toggle() {} } },
    addEventListener(type, cb) { (docListeners[type] = docListeners[type] || []).push(cb); },
    dispatchKeydown(evt) { (docListeners.keydown || []).forEach(cb => cb(evt)); },
  };

  return { doc, registry, bodyClasses, overlay, form, submitBtn, focusOrder, closeBtn, nameInput };
}

for (const kind of ["quote", "availability"]) {
  const isQuote = kind === "quote";
  const openModal = isQuote ? openQuoteModal : openAvailabilityModal;
  const closeModal = isQuote ? closeQuoteModal : closeAvailabilityModal;
  const bindModal = isQuote ? bindQuoteModal : bindAvailabilityModal;
  const item = isQuote ? flooringItem() : nonEligibleItem();

  test(`open${isQuote ? "Quote" : "Availability"}Modal(): populates product name/price and hidden fields, focuses the first customer input, shows the modal, restores focus to the trigger on close`, () => {
    const h = makeModalHarness(kind);
    currentDoc = h.doc;
    const trigger = makeFocusable("trigger-btn");

    openModal(item, trigger);

    assert.equal(h.registry[`${kind}-modal-overlay`].hidden, false);
    assert.equal(h.bodyClasses.has("modal-open"), true);
    assert.equal(h.registry[`${isQuote ? "quote" : "availability"}-product-name`].textContent, item.name);
    assert.equal(h.registry[`${kind}-field-product-name`].value, item.name);
    assert.equal(h.registry[`${kind}-field-product-key`].value, item.productKey);
    if (isQuote) {
      assert.equal(h.registry["quote-field-price-per-sqft"].value, "$2.49");
      assert.equal(h.registry["quote-field-box-price"].value, "$42.11");
    } else {
      assert.equal(h.registry["availability-field-price"].value, "$649.00");
    }
    // Modal opens with the form view showing and any stale success/error
    // state reset — this matters for reopening on a second product.
    assert.equal(h.registry[`${kind}-modal-form-view`].hidden, false);
    assert.equal(h.registry[`${kind}-modal-success-view`].hidden, true);
    assert.equal(h.registry[`${kind}-form-error`].hidden, true);
    assert.equal(h.registry[`${kind}-submit-btn`].disabled, false);

    closeModal();
    assert.equal(h.registry[`${kind}-modal-overlay`].hidden, true);
    assert.equal(h.bodyClasses.has("modal-open"), false);
    assert.equal(currentDoc.activeElement, trigger, "closing must restore focus to the exact element that opened the modal");
  });

  test(`open${isQuote ? "Quote" : "Availability"}Modal(): reopening for a different product resets success/error state and repopulates fresh product data every time`, () => {
    const h = makeModalHarness(kind);
    currentDoc = h.doc;
    h.registry[`${kind}-modal-form-view`].hidden = true;
    h.registry[`${kind}-modal-success-view`].hidden = false;
    h.registry[`${kind}-form-error`].hidden = false;
    h.registry[`${kind}-submit-btn`].disabled = true;
    h.registry[`${kind}-submit-btn`].textContent = "Sending...";

    const otherItem = isQuote ? flooringItem({ id: "recOTHER", name: "Other Flooring", productKey: "OTH-001", price: 3.99, boxPrice: 79.99 })
      : nonEligibleItem({ id: "recOTHER", name: "Other Appliance", productKey: "OTH-001", price: 199 });
    openModal(otherItem, makeFocusable("other-trigger"));

    assert.equal(h.registry[`${kind}-modal-form-view`].hidden, false);
    assert.equal(h.registry[`${kind}-modal-success-view`].hidden, true);
    assert.equal(h.registry[`${kind}-form-error`].hidden, true);
    assert.equal(h.registry[`${kind}-submit-btn`].disabled, false);
    assert.equal(h.registry[`${kind}-field-product-name`].value, otherItem.name);
    assert.equal(h.registry[`${kind}-field-product-key`].value, "OTH-001");
  });

  test(`bind${isQuote ? "Quote" : "Availability"}Modal(): Escape closes the modal`, () => {
    const h = makeModalHarness(kind);
    currentDoc = h.doc;
    bindModal();
    openModal(item, makeFocusable("trigger-btn"));
    h.doc.dispatchKeydown({ key: "Escape", preventDefault() {} });
    assert.equal(h.registry[`${kind}-modal-overlay`].hidden, true);
  });

  test(`bind${isQuote ? "Quote" : "Availability"}Modal(): clicking the overlay backdrop closes the modal, but clicking inside the modal does not`, () => {
    const h = makeModalHarness(kind);
    currentDoc = h.doc;
    bindModal();
    openModal(item, makeFocusable("trigger-btn"));
    h.overlay.dispatch("click", { target: h.overlay });
    assert.equal(h.registry[`${kind}-modal-overlay`].hidden, true);

    openModal(item, makeFocusable("trigger-btn-2"));
    h.overlay.dispatch("click", { target: h.nameInput });
    assert.equal(h.registry[`${kind}-modal-overlay`].hidden, false, "a click on modal content must not close it");
  });

  test(`bind${isQuote ? "Quote" : "Availability"}Modal(): Tab from the last focusable element wraps to the first, and Shift+Tab from the first wraps to the last`, () => {
    const h = makeModalHarness(kind);
    currentDoc = h.doc;
    bindModal();
    openModal(item, makeFocusable("trigger-btn"));

    h.focusOrder[h.focusOrder.length - 1].focus();
    let prevented = false;
    h.doc.dispatchKeydown({ key: "Tab", shiftKey: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(currentDoc.activeElement, h.focusOrder[0], "Tab past the last element must wrap to the first");

    h.focusOrder[0].focus();
    prevented = false;
    h.doc.dispatchKeydown({ key: "Tab", shiftKey: true, preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(currentDoc.activeElement, h.focusOrder[h.focusOrder.length - 1], "Shift+Tab before the first element must wrap to the last");
  });

  await testAsync(`bind${isQuote ? "Quote" : "Availability"}Modal(): a pending submission disables the submit button so a second click/Enter cannot double-submit; success re-enables it and never opens sms:`, async () => {
    const h = makeModalHarness(kind);
    currentDoc = h.doc;
    bindModal();
    openModal(item, makeFocusable("trigger-btn"));

    let fetchCalls = 0;
    let smsOpened = false;
    const originalFetch = globalThis.fetch;
    const originalOpen = globalThis.open;
    globalThis.fetch = async () => { fetchCalls++; return { ok: true, status: 200 }; };
    globalThis.open = (url) => { if (String(url).startsWith("sms:")) smsOpened = true; };
    try {
      const p1 = h.form.dispatch("submit", { preventDefault() {} });
      // Fired again immediately, simulating a double-click before the
      // first request resolves — must be a no-op because submitBtn is
      // already disabled synchronously at the top of the handler.
      const p2 = h.form.dispatch("submit", { preventDefault() {} });
      await Promise.all([p1, p2]);

      assert.equal(fetchCalls, 1, "a second submit while one is pending must not fire a second request");
      assert.equal(h.registry[`${kind}-modal-form-view`].hidden, true);
      assert.equal(h.registry[`${kind}-modal-success-view`].hidden, false);
      assert.equal(h.registry[`${kind}-submit-btn`].disabled, false, "submit button must re-enable after a successful submission");
      assert.equal(smsOpened, false, "a successful submission must never auto-open an sms: link");
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.open = originalOpen;
    }
  });

  await testAsync(`bind${isQuote ? "Quote" : "Availability"}Modal(): a failed submission shows the error message (with role=alert in markup), re-enables the submit button, and does not show the success view`, async () => {
    const h = makeModalHarness(kind);
    currentDoc = h.doc;
    bindModal();
    openModal(item, makeFocusable("trigger-btn"));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
      await h.form.dispatch("submit", { preventDefault() {} });
      assert.equal(h.registry[`${kind}-form-error`].hidden, false);
      assert.equal(h.registry[`${kind}-modal-success-view`].hidden, true);
      assert.equal(h.registry[`${kind}-submit-btn`].disabled, false);
    } finally {
      globalThis.fetch = originalFetch;
      console.warn = originalWarn;
    }
  });
}

test("styles.css: error text elements use role=alert in markup (association with the form) for both modals on every page", () => {
  for (const [html, label] of [[shopSrc, "shop.html"], [indexSrc, "index.html"], [productSrc, "product.html"]]) {
    assert.match(html, /id="quote-form-error" role="alert"/, `${label}: quote-form-error must have role="alert"`);
    assert.match(html, /id="availability-form-error" role="alert"/, `${label}: availability-form-error must have role="alert"`);
  }
});

// ---------------------------------------------------------------------
// No horizontal overflow at 320px: the modal is a relative-width box
// (width:100%, max-width:440px) that fits inside any viewport at or
// above its own minimum content width, and nothing in the form styling
// forces a fixed width wider than a 320px viewport.
// ---------------------------------------------------------------------
test("styles.css: .modal has no fixed pixel width wider than 320px, scales via width:100% + max-width, and scrolls internally instead of overflowing", () => {
  const modalBlock = stylesSrc.match(/\n\.modal\s*\{([^}]*)\}/)[0];
  assert.match(modalBlock, /width:\s*100%/);
  assert.match(modalBlock, /max-height:\s*90vh/);
  assert.match(modalBlock, /overflow-y:\s*auto/);
  const fixedWidth = modalBlock.match(/(?<!max-)width:\s*(\d+)px/);
  assert.ok(!fixedWidth, ".modal must not set a fixed pixel width (would overflow narrow viewports)");
});

test("styles.css: no form-field/input/textarea rule sets a fixed min-width wider than 320px that would force horizontal overflow", () => {
  const re = /\.form-field[^{]*\{[^}]*\}/g;
  let m;
  while ((m = re.exec(stylesSrc))) {
    const minWidthMatch = m[0].match(/min-width:\s*(\d+)px/);
    if (minWidthMatch) {
      assert.ok(Number(minWidthMatch[1]) <= 320, `found a form-field rule with min-width:${minWidthMatch[1]}px, which would overflow a 320px viewport: ${m[0]}`);
    }
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll inquiry-forms (Check Availability / Get a Quote / Contractor View) tests passed.");

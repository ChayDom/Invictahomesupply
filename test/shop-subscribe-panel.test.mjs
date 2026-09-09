#!/usr/bin/env node
// ===================================================================
// Regression tests for the Shop page's compact subscribe panel
// placement and its reuse of the shared subscription handler.
//
// Background: a short/filtered result set left a large empty gap in
// the main content column, because .shop-layout is a CSS grid whose
// implicit row sizes to the taller of its two columns (sidebar vs. main
// content — see .shop-layout in styles.css), and the sidebar's filter
// groups/calculator card are routinely taller than a 1-row result set.
// The commit that first added this panel (a6ea958, from
// claude/code-changes-branch-prod-q7sdi3) placed it as a .shop-layout
// SIBLING, after the whole results section — which does not fix the
// gap (it just adds new content after the still-empty space). This
// integration instead moves the panel INSIDE .shop-results (the main-
// content column), after both #catalog-grid and #contractor-view, so a
// taller main column there actually shrinks the shared grid row.
//
// Part A below checks the real shop.html markup directly (string/
// position checks — no browser, no HTML parser dependency, matching
// this project's existing test style). Part B checks that app.js's
// existing bindSubscribeForms()/bindOneSubscribeForm() — completely
// unmodified by this change — still binds the shop panel's form
// correctly and independently of the homepage's form, with no
// duplicate submission and no second handler/endpoint.
//
// Run with: node test/shop-subscribe-panel.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shopHtml = fs.readFileSync(path.join(__dirname, "..", "shop.html"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

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
// Part A: static markup — exactly one panel, positioned inside
// .shop-results, after both possible results views, before the footer.
// ---------------------------------------------------------------------
test("shop.html has exactly one compact subscribe panel", () => {
  const count = (shopHtml.match(/class="optin optin-compact"/g) || []).length;
  assert.equal(count, 1, "there should be exactly one .optin.optin-compact section on the Shop page");
});

test("shop.html has exactly one #subscribe-form-shop element (no duplicate IDs)", () => {
  const count = (shopHtml.match(/id="subscribe-form-shop"/g) || []).length;
  assert.equal(count, 1);
});

test("the compact panel is positioned after #catalog-grid, after #contractor-cards, and before the footer", () => {
  const catalogGridIdx = shopHtml.indexOf('id="catalog-grid"');
  const contractorCardsIdx = shopHtml.indexOf('id="contractor-cards"');
  const panelIdx = shopHtml.indexOf('class="optin optin-compact"');
  const footerIdx = shopHtml.indexOf("<footer");
  assert.ok(catalogGridIdx > 0, "#catalog-grid should exist");
  assert.ok(contractorCardsIdx > 0, "#contractor-cards should exist");
  assert.ok(panelIdx > 0, "the compact panel should exist");
  assert.ok(footerIdx > 0, "the footer should exist");
  assert.ok(panelIdx > catalogGridIdx, "panel must come after the standard card grid (#catalog-grid)");
  assert.ok(panelIdx > contractorCardsIdx, "panel must come after the Flooring mobile/Contractor result cards (#contractor-cards)");
  assert.ok(panelIdx < footerIdx, "panel must come before the site footer");
});

test("the compact panel is nested inside .shop-results (the main-content column), not a .shop-layout sibling", () => {
  const shopResultsOpenIdx = shopHtml.indexOf('<div class="shop-results">');
  const panelIdx = shopHtml.indexOf('class="optin optin-compact"');
  // .shop-results is the last major element to open before the panel and
  // isn't closed again until after it — cheaply verified here by the
  // panel appearing after .shop-results opens and before the immediately
  // following </section> that closes the whole shop-section (a
  // .shop-layout sibling placement, like the panel's original home in
  // a6ea958, would put the panel AFTER that </section> instead).
  const shopSectionCloseAfterPanel = shopHtml.indexOf("</section>", panelIdx);
  const quoteModalCommentIdx = shopHtml.indexOf("Get a Quote modal");
  assert.ok(panelIdx > shopResultsOpenIdx, ".shop-results must open before the panel");
  assert.ok(shopSectionCloseAfterPanel > 0 && shopSectionCloseAfterPanel < quoteModalCommentIdx,
    "the panel should be closed out along with .shop-results/.shop-layout/.shop-section, before the Get a Quote modal markup — not sitting after the whole shop-section as a sibling");
});

test("the homepage's own subscribe form is untouched (separate id, still present)", () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  const count = (indexHtml.match(/id="subscribe-form"[^-]/g) || []).length;
  assert.ok(count >= 1, "homepage should still have its own #subscribe-form");
});

// ---------------------------------------------------------------------
// Part B: the shared handler (app.js, unmodified by this change) binds
// the shop panel's form the same way it binds the homepage's — same
// technique as test/mobile-nav-escape.test.mjs (a minimal hand-rolled
// DOM loaded via vm, not a real browser).
// ---------------------------------------------------------------------
function makeClassList(initial = []) {
  const set = new Set(initial);
  return { contains: (c) => set.has(c), add: (c) => set.add(c), remove: (c) => set.delete(c) };
}

function makeFormElement({ id }) {
  const dataset = {};
  const attrs = {};
  const children = {
    email: { type: "email", value: "test@example.com" },
    submit: { type: "submit", textContent: "Subscribe", disabled: false },
    status: { classList: makeClassList(["optin-status"]), hidden: true, textContent: "", setAttribute(k, v) { attrs[k] = v; }, removeAttribute(k) { delete attrs[k]; } },
    company: { name: "company", value: "" },
  };
  const listeners = {};
  return {
    id,
    dataset,
    querySelector(sel) {
      if (sel === 'input[type="email"]') return children.email;
      if (sel === 'button[type="submit"]') return children.submit;
      if (sel === ".optin-status") return children.status;
      if (sel === 'input[name="company"]') return children.company;
      return null;
    },
    addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
    reset() {},
    reportValidity() { return true; },
    async submit(evt = { preventDefault() {} }) {
      for (const cb of listeners.submit || []) await cb(evt);
    },
    _children: children,
  };
}

async function runSharedHandlerTest() {
  const homepageForm = makeFormElement({ id: "subscribe-form" });
  const shopForm = makeFormElement({ id: "subscribe-form-shop" });
  const forms = [homepageForm, shopForm];

  const fetchCalls = [];
  globalThis.fetch = async (url, opts) => {
    fetchCalls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, json: async () => ({ message: "ok" }) };
  };
  globalThis.document = {
    querySelectorAll: (sel) => (sel === "form.optin-form" ? forms : []),
    querySelector: () => null,
    getElementById: () => null,
    addEventListener(type, cb) { if (type === "DOMContentLoaded") cb(); },
    body: { classList: makeClassList() },
  };
  globalThis.window = { SITE_CONFIG: { phoneDisplay: "", phoneHref: "", email: "", city: "", hours: "", pickupAddress: "", businessName: "", facebookUrl: "", instagramUrl: "" }, scrollY: 0, addEventListener() {} };

  vm.runInThisContext(appSrc, { filename: "app.js" });
  // app.js's own DOMContentLoaded handler already called bindSubscribeForms()
  // via the stub above; both forms should now be bound.

  test("both the homepage form and the shop panel's form get bound (dataset guard set on each)", () => {
    assert.equal(homepageForm.dataset.subscribeBound, "true");
    assert.equal(shopForm.dataset.subscribeBound, "true");
  });

  await shopForm.submit();
  test("submitting the shop panel's form posts to /api/subscribe exactly once, independently of the homepage form", () => {
    assert.equal(fetchCalls.length, 1);
    assert.equal(fetchCalls[0].url, "/api/subscribe");
    assert.equal(fetchCalls[0].body.email, "test@example.com");
  });

  await homepageForm.submit();
  test("submitting the homepage form afterward also posts once, using the same endpoint (no separate handler/endpoint)", () => {
    assert.equal(fetchCalls.length, 2);
    assert.equal(fetchCalls[1].url, "/api/subscribe");
  });

  await shopForm.submit();
  test("submitting the same form twice results in exactly two total calls (one per submit — no double-binding, no double-fire per submit)", () => {
    assert.equal(fetchCalls.length, 3);
  });
}

await runSharedHandlerTest();

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll Shop subscribe-panel placement/handler tests passed.");

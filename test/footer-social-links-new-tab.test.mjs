#!/usr/bin/env node
// ===================================================================
// Regression test for footer Facebook/Instagram links opening in a new
// tab (app.js).
//
// Background: every page's Facebook/Instagram footer link is a bare
// <a href="#" data-fb-link>/<a href="#" data-ig-link> placeholder;
// app.js's DOMContentLoaded handler is the one place that sets their
// real href (from window.SITE_CONFIG.facebookUrl/instagramUrl) for
// every page at once. This test proves that same code now also sets
// target="_blank" rel="noopener noreferrer" on exactly those two link
// kinds, and never on an ordinary internal link (or the tel/sms/mail
// links), while their destinations and visible text stay untouched.
//
// Same house style as test/mobile-nav-escape.test.mjs: loads the real
// app.js via vm.runInThisContext against a minimal hand-rolled DOM.
//
// Run with: node test/footer-social-links-new-tab.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function makeElement(initialAttrs = {}, textContent = "") {
  const attrs = { ...initialAttrs };
  return {
    textContent,
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    get href() { return attrs.href ?? null; },
    set href(v) { attrs.href = v; },
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    addEventListener() {},
  };
}

function setupFakeDom() {
  const fbLink = makeElement({ href: "#" }, "Facebook");
  const igLink = makeElement({ href: "#" }, "Instagram");
  const telLink = makeElement({ href: "#" }, "(214) 552-2145");
  const smsLink = makeElement({ href: "#" }, "Text us");
  const mailLink = makeElement({ href: "#" }, "hello@invictahomesupply.com");
  const internalLink = makeElement({ href: "/shop.html" }, "Shop");

  const registry = {
    "a[data-fb-link]": [fbLink],
    "a[data-ig-link]": [igLink],
    "a[data-tel-link]": [telLink],
    "a[data-sms-link]": [smsLink],
    "a[data-mail-link]": [mailLink],
    "a[data-internal-link]": [internalLink],
  };

  const docListeners = {};
  const doc = {
    querySelector: () => null,
    querySelectorAll: (sel) => registry[sel] || [],
    addEventListener(type, cb) { (docListeners[type] = docListeners[type] || []).push(cb); },
    fireDocumentEvent(type, evt) { (docListeners[type] || []).forEach((cb) => cb(evt)); },
  };
  globalThis.document = doc;
  globalThis.window = {
    SITE_CONFIG: {
      businessName: "Invicta Home Supply",
      phoneDisplay: "(214) 552-2145",
      phoneHref: "+12145522145",
      email: "hello@invictahomesupply.com",
      city: "McKinney, TX",
      hours: "Daily by appointment",
      pickupAddress: "By appointment.",
      facebookUrl: "https://www.facebook.com/invictahomesupply/",
      instagramUrl: "https://www.instagram.com/invictahomesupplydfw/",
    },
    scrollY: 0,
    addEventListener() {},
  };
  vm.runInThisContext(appSrc, { filename: "app.js" });
  doc.fireDocumentEvent("DOMContentLoaded");
  return { fbLink, igLink, telLink, smsLink, mailLink, internalLink };
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

test("the Facebook footer link opens in a new tab with target=_blank and rel=noopener noreferrer", () => {
  const { fbLink } = setupFakeDom();
  assert.equal(fbLink.getAttribute("target"), "_blank");
  assert.equal(fbLink.getAttribute("rel"), "noopener noreferrer");
});

test("the Instagram footer link opens in a new tab with target=_blank and rel=noopener noreferrer", () => {
  const { igLink } = setupFakeDom();
  assert.equal(igLink.getAttribute("target"), "_blank");
  assert.equal(igLink.getAttribute("rel"), "noopener noreferrer");
});

test("the Facebook/Instagram destinations and visible text are unchanged", () => {
  const { fbLink, igLink } = setupFakeDom();
  assert.equal(fbLink.href, "https://www.facebook.com/invictahomesupply/");
  assert.equal(fbLink.textContent, "Facebook");
  assert.equal(igLink.href, "https://www.instagram.com/invictahomesupplydfw/");
  assert.equal(igLink.textContent, "Instagram");
});

test("tel/sms/mail links never receive target or rel", () => {
  const { telLink, smsLink, mailLink } = setupFakeDom();
  for (const link of [telLink, smsLink, mailLink]) {
    assert.equal(link.getAttribute("target"), null);
    assert.equal(link.getAttribute("rel"), null);
  }
});

test("an ordinary internal link is untouched by app.js's social-link handling", () => {
  const { internalLink } = setupFakeDom();
  assert.equal(internalLink.getAttribute("target"), null);
  assert.equal(internalLink.getAttribute("rel"), null);
  assert.equal(internalLink.href, "/shop.html");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll footer social-link new-tab tests passed.");

#!/usr/bin/env node
// ===================================================================
// Regression tests for Escape-key handling on the mobile nav (app.js).
//
// Background: the hamburger menu toggled nav.primary-nav open/closed on
// click, but Escape had no effect on it — unlike the quote and
// calculator modals (inventory.js), which already close on Escape.
// app.js now adds one additional, self-guarded `keydown` listener that
// only acts while nav.primary-nav has .open, closing it, clearing
// aria-expanded, and returning focus to the menu-toggle button. It does
// not touch the Filters drawer or either modal.
//
// Same house style as test/homepage-lvp-price.test.mjs and
// test/quote-eligibility.test.mjs: no browser, no new dependency. Loads
// the real app.js via vm.runInThisContext against a minimal hand-rolled
// DOM (classList/attributes/focus/event listeners only — no real CSS or
// layout), so this exercises the actual production event-handling code,
// not a reimplementation of it.
//
// Run with: node test/mobile-nav-escape.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appSrc = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

// ---------------------------------------------------------------------
// Minimal fake DOM — just enough surface area for app.js's
// DOMContentLoaded handler to run without throwing, plus real
// classList/attribute/focus/event-listener behavior for the two
// elements (.menu-toggle, nav.primary-nav) this test actually exercises.
// ---------------------------------------------------------------------
function makeClassList(initial = []) {
  const set = new Set(initial);
  return {
    contains: (c) => set.has(c),
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    toggle: (c, force) => {
      const shouldHave = typeof force === "boolean" ? force : !set.has(c);
      if (shouldHave) set.add(c); else set.delete(c);
      return shouldHave;
    },
  };
}

function makeElement() {
  const attrs = {};
  const listeners = {};
  const el = {
    classList: makeClassList(),
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    addEventListener(type, cb) { (listeners[type] = listeners[type] || []).push(cb); },
    dispatch(type, evt) { (listeners[type] || []).forEach((cb) => cb(evt)); },
    focus() { globalThis.document.activeElement = el; },
  };
  return el;
}

function setupFakeDom() {
  const toggle = makeElement();
  const nav = makeElement();
  const docListeners = {};
  const doc = {
    activeElement: null,
    querySelector: (sel) => (sel === ".menu-toggle" ? toggle : sel === "nav.primary-nav" ? nav : null),
    querySelectorAll: () => [],
    addEventListener(type, cb) { (docListeners[type] = docListeners[type] || []).push(cb); },
    fireDocumentEvent(type, evt) { (docListeners[type] || []).forEach((cb) => cb(evt)); },
  };
  globalThis.document = doc;
  globalThis.window = {
    SITE_CONFIG: { phoneDisplay: "", phoneHref: "", email: "", city: "", hours: "", pickupAddress: "", businessName: "", facebookUrl: "", instagramUrl: "" },
    scrollY: 0,
    addEventListener() {},
  };
  vm.runInThisContext(appSrc, { filename: "app.js" });
  // Fire the DOMContentLoaded handler app.js registered, same as a real
  // page load would once the DOM is ready.
  doc.fireDocumentEvent("DOMContentLoaded");
  return { toggle, nav, doc };
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

test("clicking the toggle opens the nav and sets aria-expanded=true", () => {
  const { toggle, nav } = setupFakeDom();
  toggle.dispatch("click");
  assert.equal(nav.classList.contains("open"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
});

test("Escape closes the open nav, clears aria-expanded, and returns focus to the toggle", () => {
  const { toggle, nav, doc } = setupFakeDom();
  toggle.dispatch("click"); // open it first
  doc.fireDocumentEvent("keydown", { key: "Escape" });
  assert.equal(nav.classList.contains("open"), false, "nav should be closed after Escape");
  assert.equal(toggle.getAttribute("aria-expanded"), "false", "aria-expanded should be false after Escape");
  assert.equal(doc.activeElement, toggle, "focus should return to the menu-toggle button after Escape");
});

test("Escape while the nav is already closed is a no-op (no error, no state change)", () => {
  const { nav, doc } = setupFakeDom();
  doc.fireDocumentEvent("keydown", { key: "Escape" });
  assert.equal(nav.classList.contains("open"), false);
});

test("a non-Escape key while the nav is open does nothing", () => {
  const { toggle, nav, doc } = setupFakeDom();
  toggle.dispatch("click");
  doc.fireDocumentEvent("keydown", { key: "Enter" });
  assert.equal(nav.classList.contains("open"), true, "nav should remain open for any key other than Escape");
});

test("existing click-to-toggle behavior is preserved (open, then close, via click alone)", () => {
  const { toggle, nav } = setupFakeDom();
  toggle.dispatch("click");
  assert.equal(nav.classList.contains("open"), true);
  toggle.dispatch("click");
  assert.equal(nav.classList.contains("open"), false, "a second click should close the nav again");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll mobile-nav Escape-key tests passed.");

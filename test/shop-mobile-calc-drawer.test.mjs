#!/usr/bin/env node
// ===================================================================
// Regression test for the Flooring Calculator placement fix on shop.html
// at mobile/tablet widths.
//
// Background: #sidebar-calc-card ("Flooring calculator" quick-calc
// card) is the first element inside .sidebar-scroll, same DOM node used
// for both the desktop sidebar and the mobile off-canvas Filters drawer
// (@media max-width: 880px in styles.css). inventory.js only ever toggles
// its [hidden] attribute by category (Flooring vs not) — with no width
// awareness — so on mobile, selecting Flooring made this card the first
// thing the drawer showed, ahead of the "Filters" heading itself.
//
// Fix: inside that same @media (max-width: 880px) block, force
// .sidebar-calc-card to display: none regardless of its [hidden] state,
// so the drawer always opens straight onto "Filters" + the actual filter
// controls. The standalone #mobile-calc-btn ("Flooring Calculator" button
// in .results-toolbar, above the mobile Filters button) is untouched —
// it already opens the full multi-room calculator modal directly, is
// already the drawer's replacement entry point, and needed no change.
// Desktop (>880px) keeps showing the sidebar quick-calc card exactly as
// before — this test asserts that block is untouched too.
//
// Pure CSS/markup assertions (regex over styles.css/shop.html source),
// same house style as test/shop-filter-row-overflow.test.mjs — no
// browser, no changes to any calculator formula or filter logic.
//
// Run with: node test/shop-mobile-calc-drawer.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const stylesSrc = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const shopSrc = fs.readFileSync(path.join(ROOT, "shop.html"), "utf8");

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

// styles.css has multiple separate @media (max-width: Npx) blocks
// scattered throughout for unrelated components — this returns the
// specific one that contains the given selector snippet, not just the
// first block at that breakpoint in the file.
function mediaBlockContaining(maxWidth, selectorSnippet) {
  const re = new RegExp(`@media \\(max-width:\\s*${maxWidth}px\\)\\s*\\{([\\s\\S]*?)\\n\\}\\n`, "gm");
  let m;
  while ((m = re.exec(stylesSrc))) {
    if (m[0].includes(selectorSnippet)) return m[0];
  }
  assert.fail(`expected an @media (max-width: ${maxWidth}px) block containing "${selectorSnippet}"`);
}

test("the drawer breakpoint (@media max-width: 880px, which governs .shop-sidebar's off-canvas drawer) forces .sidebar-calc-card to display: none", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  assert.match(block, /\.sidebar-calc-card\s*\{[^}]*display:\s*none/);
});

test("the drawer-hiding rule does not touch .sidebar-filters-head, .filter-group, or any select — filters stay intact in the drawer", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  assert.doesNotMatch(block, /\.sidebar-filters-head\s*\{[^}]*display:\s*none/);
  assert.doesNotMatch(block, /\.filter-group\s*\{[^}]*display:\s*none/);
});

test("the drawer-hiding rule does not touch #mobile-calc-btn — the standalone button stays as its own entry point", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  assert.doesNotMatch(block, /\.mobile-calc-btn\s*\{[^}]*display:\s*none/);
  assert.match(block, /\.mobile-calc-btn\s*\{[^}]*display:\s*inline-flex/);
});

test("desktop (outside the 880px drawer breakpoint) still shows the sidebar quick-calc card via its base rule, unforced", () => {
  const baseRuleMatch = stylesSrc.match(/(?<!\{[^}]*)\n\.sidebar-calc-card\s*\{([^}]*)\}/);
  assert.ok(baseRuleMatch, "expected a base (non-media) .sidebar-calc-card rule to still exist");
  assert.doesNotMatch(baseRuleMatch[1], /display:\s*none/, "the base rule itself must not force display: none — only the mobile/tablet drawer breakpoint does");
});

test("shop.html: the sidebar quick-calc card (#sidebar-calc-card) and its 'Calculate multiple rooms' link are unchanged, still inside .sidebar-scroll", () => {
  assert.match(shopSrc, /<div class="sidebar-scroll">\s*<div class="sidebar-calc-card" id="sidebar-calc-card" hidden>/);
  assert.match(shopSrc, /<h3>Flooring calculator<\/h3>/);
  assert.match(shopSrc, /id="flooring-calc-full-link">Calculate multiple rooms<\/button>/);
});

test("shop.html: the standalone mobile #mobile-calc-btn ('Flooring Calculator') still exists above #mobile-filters-btn in the results toolbar", () => {
  const toolbarMatch = shopSrc.match(/<div class="results-toolbar">([\s\S]*?)<div class="results-count"/);
  assert.ok(toolbarMatch, "expected to find .results-toolbar markup");
  const toolbar = toolbarMatch[1];
  const calcIdx = toolbar.indexOf('id="mobile-calc-btn"');
  const filtersIdx = toolbar.indexOf('id="mobile-filters-btn"');
  assert.ok(calcIdx !== -1 && filtersIdx !== -1, "expected both #mobile-calc-btn and #mobile-filters-btn in the results toolbar");
  assert.ok(calcIdx < filtersIdx, "#mobile-calc-btn must appear before #mobile-filters-btn in the markup");
  assert.match(toolbar.slice(calcIdx), />\s*Flooring Calculator\s*<\/button>/);
});

test("shop.html: the 10% waste hint and quick-calc input/button markup are untouched (no formula/wording change)", () => {
  assert.match(shopSrc, /Adds 10% for cuts and waste\./);
  assert.match(shopSrc, /id="flooring-calc-sqft"[^>]*placeholder="Room sq ft"/);
  assert.match(shopSrc, /id="flooring-calc-btn">Calculate<\/button>/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll shop-mobile-calc-drawer tests passed.");

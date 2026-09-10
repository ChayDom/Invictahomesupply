#!/usr/bin/env node
// ===================================================================
// Regression test for the shop.html mobile filter-row horizontal
// overflow fix at the narrowest supported width (320px).
//
// Background: at max-width: 700px, .filter-row is forced to
// flex-wrap: nowrap so its two visible mobile buttons ("All Products" +
// "Browse Categories") stay on one line. Their combined natural width
// fits down to ~340px, but at exactly 320px it overflowed the viewport
// by ~2px (measured: document.documentElement.scrollWidth 322px vs
// clientWidth 320px), confirmed via rendered bounding-box measurements
// to be entirely caused by #browse-categories-btn's right edge landing
// past 320px — nothing else on the page contributed.
//
// Fix: .filter-row gets flex-wrap: wrap back inside the existing
// @media (max-width: 360px) block (already used for other
// narrowest-phone-only adjustments). flex-wrap only takes effect once
// content actually doesn't fit on one line, so this is a no-op at
// 340-360px (still renders on one line there, confirmed unchanged) and
// only wraps "Browse Categories" onto its own line at 320px. No text,
// padding, font-size, or touch-target change to either button (both
// confirmed byte-for-byte identical before/after: 30px/32px tall).
//
// Run with: node test/shop-filter-row-overflow.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const stylesSrc = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

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

function cssRuleBody(selector, withinBlock) {
  const haystack = withinBlock || stylesSrc;
  const re = new RegExp(selector.replace(/[.[\]()>:]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = haystack.match(re);
  assert.ok(m, `expected to find a CSS rule for ${selector}`);
  return m[1];
}

// styles.css has multiple separate @media (max-width: Npx) blocks
// scattered throughout for unrelated components — this returns the
// specific one that contains the given selector, not just the first
// block at that breakpoint in the file.
function mediaBlockContaining(maxWidth, selectorSnippet) {
  const re = new RegExp(`@media \\(max-width:\\s*${maxWidth}px\\)\\s*\\{([\\s\\S]*?)\\n\\}\\n`, "gm");
  let m;
  while ((m = re.exec(stylesSrc))) {
    if (m[0].includes(selectorSnippet)) return m[0];
  }
  assert.fail(`expected an @media (max-width: ${maxWidth}px) block containing "${selectorSnippet}"`);
}

test("styles.css: the @media (max-width: 360px) block sets .filter-row back to flex-wrap: wrap", () => {
  const block = mediaBlockContaining(360, ".filter-row");
  const body = cssRuleBody(".filter-row", block);
  assert.match(body, /flex-wrap:\s*wrap/);
});

test("the @media (max-width: 700px) block still forces .filter-row to flex-wrap: nowrap (340-700px unaffected)", () => {
  const block = mediaBlockContaining(700, ".filter-row");
  const body = cssRuleBody(".filter-row", block);
  assert.match(body, /flex-wrap:\s*nowrap/);
});

test("the 360px fix does not touch .filter-btn padding/font-size (no touch-target or text-size regression)", () => {
  const block = mediaBlockContaining(360, ".filter-row");
  assert.doesNotMatch(block, /\.filter-btn\s*\{[^}]*padding/);
  assert.doesNotMatch(block, /\.filter-btn\s*\{[^}]*font-size/);
});

test("the 360px block does not add overflow-x: hidden anywhere (defect must be fixed by layout, not masked)", () => {
  const block = mediaBlockContaining(360, ".filter-row");
  assert.doesNotMatch(block, /overflow-x:\s*hidden/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll shop-filter-row-overflow tests passed.");

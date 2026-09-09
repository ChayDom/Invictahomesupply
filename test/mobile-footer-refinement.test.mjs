#!/usr/bin/env node
// ===================================================================
// Regression tests for the mobile-footer (≤600px) refinement:
// shortened subscribe-link wording (same destination) on every page,
// and the new ≤600px .footer-grid CSS (wider Company column, Contact
// spanning full width, tighter link spacing) — scoped so it never
// touches the existing ≤900px tablet layout or the desktop footer.
//
// Run with: node test/mobile-footer-refinement.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const stylesSrc = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
const PAGES = ["index.html", "shop.html", "about.html", "contact.html", "product.html"];

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
  const re = new RegExp(selector.replace(/[.[\]>:]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = haystack.match(re);
  assert.ok(m, `expected to find a CSS rule for ${selector}`);
  return m[1];
}

// styles.css has several separate @media (max-width: 900px) (and other)
// blocks scattered throughout for unrelated components — this returns
// the specific one that contains the given selector, not just the
// first block at that breakpoint in the file.
function mediaBlockContaining(maxWidth, selectorSnippet) {
  const re = new RegExp(`@media \\(max-width:\\s*${maxWidth}px\\)\\s*\\{([\\s\\S]*?)\\n\\}\\n`, "gm");
  let m;
  while ((m = re.exec(stylesSrc))) {
    if (m[0].includes(selectorSnippet)) return m[0];
  }
  assert.fail(`expected an @media (max-width: ${maxWidth}px) block containing "${selectorSnippet}"`);
}

// --- Wording change, every page, same destination -----------------------

for (const page of PAGES) {
  test(`${page}: subscribe link reads "Weekly inventory updates — Subscribe" and keeps its destination`, () => {
    const html = fs.readFileSync(path.join(ROOT, page), "utf8");
    assert.match(html, /<a href="\/#inventory-updates">Weekly inventory updates — Subscribe<\/a>/);
    assert.equal(html.includes("Get weekly inventory updates"), false);
  });
}

// --- New ≤600px footer CSS exists and is scoped correctly ----------------

test("styles.css: a @media (max-width: 600px) block exists for .footer-grid", () => {
  const block = mediaBlockContaining(600, ".footer-grid");
  assert.match(block, /\.footer-grid\s*\{/);
});

test("≤600px: .footer-grid gives Company (2nd column) more width than Inventory (1st) — not an even split", () => {
  const block = mediaBlockContaining(600, ".footer-grid");
  const body = cssRuleBody(".footer-grid", block);
  const m = body.match(/grid-template-columns:\s*([\d.]+)fr\s+([\d.]+)fr/);
  assert.ok(m, "expected two fr-unit columns in the ≤600px .footer-grid rule");
  const [, first, second] = m.map(Number);
  assert.ok(second > first, `expected the 2nd (Company) column wider than the 1st (Inventory): got ${first}fr / ${second}fr`);
});

test("≤600px: Contact (4th child) spans the full grid width", () => {
  const block = mediaBlockContaining(600, ".footer-grid");
  assert.match(block, /\.footer-grid\s*>\s*div:nth-child\(4\)\s*\{\s*grid-column:\s*1\s*\/\s*-1;?\s*\}/);
});

test("≤600px: footer link/heading spacing is reduced from the shared defaults (0.88rem/8px, 16px)", () => {
  const block = mediaBlockContaining(600, ".footer-grid");
  const linkBody = cssRuleBody(".footer-grid p, .footer-grid a", block);
  assert.match(linkBody, /font-size:\s*0\.82rem/);
  assert.match(linkBody, /margin-bottom:\s*6px/);
  const h4Body = cssRuleBody(".footer-grid h4", block);
  assert.match(h4Body, /margin-bottom:\s*10px/);
});

test("the existing ≤900px tablet .footer-grid rule is untouched (still the even 1fr 1fr split)", () => {
  const block = mediaBlockContaining(900, ".footer-grid");
  const body = cssRuleBody(".footer-grid", block);
  assert.match(body, /grid-template-columns:\s*1fr\s+1fr/);
  assert.match(body, /gap:\s*24px\s+32px/);
});

test("the shared/desktop .footer-grid rule (the first, undecorated .footer-grid rule in the file — outside any media query) is untouched — still the 4-column 1.6fr layout", () => {
  const body = cssRuleBody(".footer-grid", stylesSrc);
  assert.match(body, /grid-template-columns:\s*1\.6fr\s+1fr\s+1fr\s+1fr/);
});

test("the shared .footer-grid p, .footer-grid a rule (desktop default, first occurrence in the file) still reads 0.88rem/8px", () => {
  const body = cssRuleBody(".footer-grid p, .footer-grid a", stylesSrc);
  assert.match(body, /font-size:\s*0\.88rem/);
  assert.match(body, /margin-bottom:\s*8px/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll mobile-footer-refinement tests passed.");

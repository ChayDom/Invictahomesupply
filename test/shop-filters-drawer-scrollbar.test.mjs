#!/usr/bin/env node
// ===================================================================
// Regression test for the mobile/tablet Filters-drawer scrollbar-gutter
// fix on shop.html.
//
// Background: .shop-sidebar's own 16px padding (the desktop rule) left
// .sidebar-scroll — the drawer's inner scrolling region on mobile
// (@media max-width: 880px) — with no reserved space of its own for a
// native scrollbar. The scrollbar rendered flush against
// .sidebar-scroll's unpadded right edge, overlapping whatever filter
// content (select borders/arrows, the top "Clear all" link, headings)
// also extended to that same edge.
//
// Fix: .sidebar-scroll gets `margin-right: -16px` (canceling the
// parent's right padding so the scrollable box — and the native
// scrollbar it renders — reaches the drawer's true far-right edge) plus
// `padding-right: 10px` (an 8-12px gutter between that scrollbar and
// the actual content, not instead of one). A thin/subtle scrollbar
// style is added for browsers that support customizing it
// (scrollbar-width/scrollbar-color for Firefox, ::-webkit-scrollbar for
// Chromium-based browsers) — scrolling itself (overflow-y: auto) is
// untouched, never hidden or disabled. padding-bottom gives the same
// breathing room below the final filter group, clear of the sticky
// Clear All/Show Results footer (a real flex sibling, not an overlay,
// so it can't cover content regardless — this is spacing polish).
//
// Pure CSS-source assertions (regex over styles.css), same house style
// as test/shop-filter-row-overflow.test.mjs and
// test/shop-mobile-calc-drawer.test.mjs — no browser, no changes to any
// filtering/calculator logic. (Live-rendered geometry — no horizontal
// overflow, the gutter's actual pixel size, and the last filter group
// being reachable above the sticky footer — was additionally confirmed
// via a real headless-Chromium render at 320/390/430px during manual
// verification; that isn't repeated here since this suite has no
// browser dependency.)
//
// Run with: node test/shop-filters-drawer-scrollbar.test.mjs
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

function ruleBody(block, selector) {
  const re = new RegExp(selector.replace(/[.#[\]()>:]/g, "\\$&") + "\\s*\\{([^}]*)\\}");
  const m = block.match(re);
  assert.ok(m, `expected to find a CSS rule for ${selector}`);
  return m[1];
}

test("styles.css: the 880px Filters-drawer breakpoint moves .sidebar-scroll's right edge to the drawer's true far-right edge (cancels the parent's 16px right padding)", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  const body = ruleBody(block, ".sidebar-scroll");
  assert.match(body, /margin-right:\s*-16px/);
});

test("styles.css: .sidebar-scroll reserves an 8-12px gutter (padding-right) between the scrollbar and its content", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  const body = ruleBody(block, ".sidebar-scroll");
  const m = body.match(/padding-right:\s*(\d+)px/);
  assert.ok(m, "expected a padding-right declaration on .sidebar-scroll");
  const px = Number(m[1]);
  assert.ok(px >= 8 && px <= 12, `expected padding-right between 8-12px, got ${px}px`);
});

test("styles.css: vertical scrolling is never disabled or hidden — overflow-y stays auto, no overflow: hidden on .sidebar-scroll", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  const body = ruleBody(block, ".sidebar-scroll");
  assert.match(body, /overflow-y:\s*auto/);
  assert.doesNotMatch(body, /overflow-y:\s*hidden/);
  assert.doesNotMatch(body, /overflow:\s*hidden/);
});

test("styles.css: a thin/subtle scrollbar style is declared for browsers that support customizing it, without removing the native scrollbar outright", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  assert.match(block, /\.sidebar-scroll\s*\{[^}]*scrollbar-width:\s*thin/);
  assert.match(block, /\.sidebar-scroll::-webkit-scrollbar\s*\{[^}]*width:\s*\d+px/);
  // "thin/subtle" — never fully hidden (width: 0) or display:none'd.
  assert.doesNotMatch(block, /\.sidebar-scroll::-webkit-scrollbar\s*\{[^}]*width:\s*0/);
  assert.doesNotMatch(block, /\.sidebar-scroll::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
});

test("styles.css: the drawer's sticky bottom Clear All/Show Results bar (.sidebar-mobile-actions) is untouched by this fix", () => {
  const block = mediaBlockContaining(880, ".shop-sidebar");
  const body = ruleBody(block, ".sidebar-mobile-actions");
  assert.match(body, /display:\s*flex/);
  assert.doesNotMatch(body, /display:\s*none/);
});

test("styles.css: desktop's .shop-sidebar/.sidebar-scroll rules (outside the 880px breakpoint) are unchanged — no margin-right/padding-right/scrollbar overrides there", () => {
  // The base (non-media) .sidebar-scroll rule, defined once near the top
  // of the stylesheet ahead of every @media block.
  const baseMatch = stylesSrc.match(/\n\.sidebar-scroll\s*\{([^}]*)\}/);
  assert.ok(baseMatch, "expected a base (non-media) .sidebar-scroll rule");
  assert.doesNotMatch(baseMatch[1], /margin-right/);
  assert.doesNotMatch(baseMatch[1], /scrollbar-width/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll shop-filters-drawer-scrollbar tests passed.");

#!/usr/bin/env node
// ===================================================================
// Regression test for the header's contact-method breakpoint: plain,
// non-clickable phone text at 881px and up vs. real clickable
// Call/Text tel:/sms: icon buttons at 880px and below.
//
// Background: the header's own nav breakpoint (max-width: 1150px —
// where nav.primary-nav hides and the hamburger takes over) does NOT
// control this. Reusing it would leave the real tel:/sms: buttons live
// for every Windows/laptop visitor at very common 900px/1024px/1150px
// window widths, silently triggering an OS tel:/sms: app-picker prompt
// for an action that makes no sense on a laptop. This feature has its
// own, independent breakpoint: <=880px keeps the real Call/Text icon
// buttons and hides the plain number (unchanged from before this
// pass); >=881px shows the plain <span class="header-phone-text"
// data-phone> (no href/role/tabindex/click handler — populated by
// app.js's existing generic [data-phone] -> SITE_CONFIG.phoneDisplay
// binding, no new JS) and hides .contact-cta (both tel:/sms: anchors)
// via display:none — which, being display:none rather than merely
// visually hidden, also removes those anchors from the tab order and
// from click/keyboard reach entirely (a display:none ancestor makes
// every descendant unfocusable and unclickable in every browser,
// regardless of the descendant's own attributes — there is no CSS
// escape hatch for a plain, unconditional ancestor display:none, and
// this file has no !important or other override on .contact-cta-btn's
// own display that could reintroduce one). Between 881-1150px the
// hamburger nav and the plain phone number legitimately coexist — the
// nav's own 1150/1151px breakpoint is untouched by this feature.
//
// "Computed visibility, not only CSS source text": rather than only
// grepping for the expected rules (still done, further down, to prove
// the actual mechanism), this test extracts the real declarations for
// .header-phone-text and .contact-cta from styles.css (the base rule
// and the @media (min-width: 881px) rule) and evaluates the same
// cascade a browser would — later same-specificity rule wins once its
// media condition matches — for every width in the required test
// matrix, then asserts the resulting display value. This is a real,
// mechanical computation over the shipped CSS text, not a hand-typed
// expectation of what "should" happen.
//
// A real headless-Chromium render (not part of this dependency-free
// suite — no browser is a project dependency here) was additionally
// used during manual verification to confirm actual computed
// getComputedStyle().display, .cursor, and offsetParent (the standard
// "can this actually receive focus/clicks" check — null for any
// display:none element or display:none ancestor) at every width in the
// matrix below, matching this test's own computed results exactly.
//
// Run with: node test/header-desktop-phone-text.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const stylesSrc = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");

const PAGES = ["index.html", "shop.html", "product.html", "about.html", "contact.html", "subscribe-confirmed.html", "unsubscribed.html"];

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

function mediaBlockContaining(query, selectorSnippet) {
  const re = new RegExp(`@media \\(${query}\\)\\s*\\{([\\s\\S]*?)\\n\\}\\n`, "gm");
  let m;
  while ((m = re.exec(stylesSrc))) {
    if (m[0].includes(selectorSnippet)) return m[0];
  }
  return null;
}

// ---------------------------------------------------------------------
// Tiny cascade evaluator, scoped to exactly the two selectors this
// feature cares about — not a general CSS engine. Later same-
// specificity rules win once their @media condition matches; a plain
// class selector's base (non-media) declaration is the fallback.
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
  let value = baseMatch ? declaredDisplay(selector, `${selector} {${baseMatch[1]}}`) : null;

  // Every @media (min-width: Npx) block in the file that mentions this
  // selector, in source order — a later matching rule overrides an
  // earlier one, same as a real browser's cascade for equal specificity.
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

// --- Computed-visibility matrix, per the required test widths --------
const MATRIX = [
  [320, "hidden", "visible"],
  [390, "hidden", "visible"],
  [430, "hidden", "visible"],
  [768, "hidden", "visible"],
  [880, "hidden", "visible"],
  [881, "visible", "hidden"],
  [900, "visible", "hidden"],
  [1024, "visible", "hidden"],
  [1150, "visible", "hidden"],
  [1151, "visible", "hidden"],
  [1440, "visible", "hidden"],
];

for (const [width, expectedPhone, expectedContactCta] of MATRIX) {
  test(`computed cascade at ${width}px: .header-phone-text is ${expectedPhone}, .contact-cta is ${expectedContactCta}`, () => {
    const phoneDisplay = computedDisplay(".header-phone-text", width);
    const ctaDisplay = computedDisplay(".contact-cta", width);
    assert.equal(phoneDisplay === "none" ? "hidden" : "visible", expectedPhone, `.header-phone-text computed to display:${phoneDisplay} at ${width}px`);
    assert.equal(ctaDisplay === "none" ? "hidden" : "visible", expectedContactCta, `.contact-cta computed to display:${ctaDisplay} at ${width}px`);
    // Exactly one of the two is ever visible — never both, never neither.
    assert.notEqual(phoneDisplay === "none", ctaDisplay === "none");
  });
}

// --- Nav behavior is untouched: its own 1150/1151px breakpoint -------
test("the nav's own breakpoint (max-width: 1150px, where nav.primary-nav hides and the hamburger appears) is untouched — it does not gate the phone/contact-cta swap", () => {
  const navBlock = mediaBlockContaining("max-width:\\s*1150px", "nav.primary-nav");
  assert.ok(navBlock, "expected the existing nav breakpoint block");
  assert.match(navBlock, /nav\.primary-nav\s*\{[^}]*display:\s*none/);
  assert.match(navBlock, /\.menu-toggle\s*\{[^}]*display:\s*flex/);
  // This block must not itself decide .header-phone-text/.contact-cta
  // visibility — that comes from the separate 881px rule.
  assert.doesNotMatch(navBlock, /\.header-phone-text/);
  assert.doesNotMatch(navBlock, /\.contact-cta\s*\{[^}]*display:\s*none/);
});

test("nav.primary-nav/.menu-toggle visibility at 881-1150px is unaffected: hamburger stays up, full nav does not appear early", () => {
  for (const width of [881, 900, 1024, 1150]) {
    // nav.primary-nav's only display:none rule is inside the untouched
    // max-width:1150px block, which still applies at these widths.
    const navBlock = mediaBlockContaining("max-width:\\s*1150px", "nav.primary-nav");
    assert.ok(width <= 1150, "sanity: this check only applies at/below the nav breakpoint");
    assert.match(navBlock, /nav\.primary-nav\s*\{[^}]*display:\s*none/);
  }
});

test("the 881px breakpoint is its own rule, not folded into or renamed from the 1150/1151px nav breakpoint", () => {
  const block = mediaBlockContaining("min-width:\\s*881px", "header-phone-text");
  assert.ok(block, "expected a dedicated @media (min-width: 881px) block for the phone/contact-cta swap");
  assert.match(block, /\.header-phone-text\s*\{[^}]*display:\s*inline-block/);
  assert.match(block, /\.contact-cta\s*\{[^}]*display:\s*none/);
  // No stray min-width:1151px rule left over governing this swap.
  assert.doesNotMatch(stylesSrc, /@media \(min-width:\s*1151px\)\s*\{[^}]*(header-phone-text|contact-cta)/s);
});

test("no !important or other override exists on .contact-cta-btn that could keep it visible/focusable once its .contact-cta ancestor is display:none", () => {
  assert.doesNotMatch(stylesSrc, /\.contact-cta-btn\s*\{[^}]*display:\s*[a-z-]+\s*!important/);
  assert.doesNotMatch(stylesSrc, /\.contact-cta\s*\{[^}]*display:\s*[a-z-]+\s*!important/);
});

// --- HTML: every page that ships the header carries the new element,
// as a bare non-interactive <span>, and its existing Call/Text buttons
// are untouched. -----------------------------------------------------
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(ROOT, page), "utf8");

  test(`${page}: header has a plain <span class="header-phone-text" data-phone> with no interactive attributes`, () => {
    const m = html.match(/<span class="header-phone-text"[^>]*><\/span>/);
    assert.ok(m, "expected the header-phone-text span");
    const tag = m[0];
    assert.match(tag, /data-phone/);
    assert.doesNotMatch(tag, /href=/);
    assert.doesNotMatch(tag, /role=/);
    assert.doesNotMatch(tag, /tabindex=/);
    assert.doesNotMatch(tag, /onclick=/i);
  });

  test(`${page}: header-phone-text is a sibling of .contact-cta inside .nav-actions (not nested inside it, not replacing it)`, () => {
    const m = html.match(/<div class="nav-actions">\s*<span class="header-phone-text"[^>]*><\/span>\s*<div class="contact-cta">/);
    assert.ok(m, "expected header-phone-text immediately before .contact-cta inside .nav-actions");
  });

  test(`${page}: the existing Call/Text tel:/sms: buttons are unchanged`, () => {
    assert.match(html, /<a href="tel:" data-tel-link class="contact-cta-btn contact-cta-call"/);
    assert.match(html, /<a href="sms:" data-sms-link class="contact-cta-btn contact-cta-text"/);
  });
}

// --- Styling: no interactive semantics, colors match the header ------
test("styles.css: .header-phone-text has no cursor:pointer and uses the existing charcoal header text color", () => {
  const baseMatch = stylesSrc.match(/\n\.header-phone-text\s*\{([^}]*)\}/);
  assert.ok(baseMatch, "expected a base (non-media) .header-phone-text rule");
  assert.doesNotMatch(baseMatch[1], /cursor:\s*pointer/);
  assert.match(baseMatch[1], /color:\s*var\(--charcoal\)/);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll header-desktop-phone-text tests passed.");

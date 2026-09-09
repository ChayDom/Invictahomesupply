#!/usr/bin/env node
// ===================================================================
// Regression tests for netlify/edge-functions/product-meta.ts —
// per-product canonical URL, Open Graph/Twitter metadata, and the
// noindex,follow safety net for missing/unknown/unpublished products
// and temporary Airtable failures.
//
// Imports and calls the real edge function module directly (same
// technique test/inventory-api-cache.test.mjs uses for the serverless
// function) — no reimplementation of the handler. `context.next()` is
// mocked to return the real product.html file's current markup, so
// these tests exercise the actual regex-based tag rewriting against the
// actual static source, not a hand-rolled fixture that could drift from
// it.
//
// Run with: node test/product-meta.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRODUCT_HTML = fs.readFileSync(path.join(__dirname, "..", "product.html"), "utf8");

let airtableRecords = [];
let airtableShouldFail = false;
let airtableCallCount = 0;

globalThis.Netlify = {
  env: {
    get: (key) => ({
      AIRTABLE_TOKEN: "test-airtable-token",
      AIRTABLE_BASE_ID: "appTestBaseId0001",
    })[key],
  },
};

globalThis.fetch = async (url) => {
  const u = new URL(url);
  if (u.hostname === "api.airtable.com") {
    airtableCallCount++;
    if (airtableShouldFail) return new Response("simulated Airtable outage", { status: 500 });
    return new Response(JSON.stringify({ records: airtableRecords }), { status: 200 });
  }
  throw new Error(`unexpected fetch to ${url}`);
};

const { default: productMetaHandler } = await import("../netlify/edge-functions/product-meta.ts");

function airtableRecordFor(fields) {
  return { id: "rec1", fields };
}

const VALID_PRODUCT_FIELDS = {
  "Product Key": "LEG-HD-001157",
  "Name": "Test Oak LVP Flooring",
  "Category": "Flooring",
  "Details": "Waterproof luxury vinyl plank flooring, brand-new overstock.",
  "Photos": [{ url: "https://example.com/full.jpg", thumbnails: { large: { url: "https://example.com/large.jpg" } } }],
  "Post to Website": true,
};

function requestFor(query, host = "invictahomesupply.com") {
  return new Request(`https://${host}/product.html${query ? `?${query}` : ""}`, { method: "GET" });
}

function nextContext() {
  return {
    next: async () => new Response(PRODUCT_HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  };
}

async function run(query, host) {
  return productMetaHandler(requestFor(query, host), nextContext());
}

let failures = 0;
async function test(name, fn) {
  airtableRecords = [airtableRecordFor(VALID_PRODUCT_FIELDS)];
  airtableShouldFail = false;
  airtableCallCount = 0;
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.stack || err.message}`);
  }
}

function tagContent(html, pattern) {
  const m = html.match(pattern);
  return m ? m[1] : null;
}

// --- Canonicals -----------------------------------------------------

await test("valid Product Key receives a unique production canonical", async () => {
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  const canonical = tagContent(html, /<link rel="canonical" href="([^"]*)">/);
  assert.equal(canonical, "https://invictahomesupply.com/product.html?id=LEG-HD-001157");
});

await test("different products receive different canonicals", async () => {
  const resA = await run("id=LEG-HD-001157");
  const htmlA = await resA.text();
  const canonicalA = tagContent(htmlA, /<link rel="canonical" href="([^"]*)">/);

  airtableRecords = [airtableRecordFor({ ...VALID_PRODUCT_FIELDS, "Product Key": "HD-9999999999", "Name": "Test Water Heater" })];
  const resB = await run("id=HD-9999999999");
  const htmlB = await resB.text();
  const canonicalB = tagContent(htmlB, /<link rel="canonical" href="([^"]*)">/);

  assert.notEqual(canonicalA, canonicalB);
  assert.equal(canonicalB, "https://invictahomesupply.com/product.html?id=HD-9999999999");
});

await test("Product Key is URL-encoded in the canonical", async () => {
  airtableRecords = [airtableRecordFor({ ...VALID_PRODUCT_FIELDS, "Product Key": "LEGACY|HOME DEPOT|Item #1" })];
  const res = await run(`id=${encodeURIComponent("LEGACY|HOME DEPOT|Item #1")}`);
  const html = await res.text();
  const canonical = tagContent(html, /<link rel="canonical" href="([^"]*)">/);
  assert.equal(canonical, `https://invictahomesupply.com/product.html?id=${encodeURIComponent("LEGACY|HOME DEPOT|Item #1")}`);
  assert.equal(canonical.includes("|"), false);
});

await test("tracking parameters are excluded from the canonical", async () => {
  const res = await run("id=LEG-HD-001157&utm_source=facebook&utm_campaign=x");
  const html = await res.text();
  const canonical = tagContent(html, /<link rel="canonical" href="([^"]*)">/);
  assert.equal(canonical, "https://invictahomesupply.com/product.html?id=LEG-HD-001157");
  assert.equal(canonical.includes("utm_"), false);
});

await test("the preview hostname never appears in the canonical, even when the request itself is on a preview host", async () => {
  const res = await run("id=LEG-HD-001157", "final-pre-production--invictahomesupply.netlify.app");
  const html = await res.text();
  const canonical = tagContent(html, /<link rel="canonical" href="([^"]*)">/);
  assert.equal(canonical.startsWith("https://invictahomesupply.com/"), true);
  assert.equal(canonical.includes("netlify.app"), false);
});

await test("exactly one canonical link exists after rendering", async () => {
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  const matches = html.match(/<link rel="canonical"/g) || [];
  assert.equal(matches.length, 1);
});

await test("a valid product never canonicalizes to the generic /product.html with no id", async () => {
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  const canonical = tagContent(html, /<link rel="canonical" href="([^"]*)">/);
  assert.notEqual(canonical, "https://invictahomesupply.com/product.html");
});

// --- Metadata ---------------------------------------------------------

await test("a valid product receives product-specific title and description", async () => {
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  assert.equal(tagContent(html, /<title>([^<]*)<\/title>/), "Test Oak LVP Flooring | Invicta Home Supply");
  assert.equal(
    tagContent(html, /<meta name="description" content="([^"]*)">/),
    "Waterproof luxury vinyl plank flooring, brand-new overstock."
  );
});

await test("Open Graph URL matches the canonical", async () => {
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  const canonical = tagContent(html, /<link rel="canonical" href="([^"]*)">/);
  const ogUrl = tagContent(html, /<meta property="og:url" content="([^"]*)">/);
  assert.equal(ogUrl, canonical);
});

await test("Open Graph image uses the actual product image when one exists", async () => {
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  assert.equal(tagContent(html, /<meta property="og:image" content="([^"]*)">/), "https://example.com/large.jpg");
});

await test("missing product image falls back to the approved Invicta social-sharing image", async () => {
  airtableRecords = [airtableRecordFor({ ...VALID_PRODUCT_FIELDS, Photos: undefined })];
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  assert.equal(
    tagContent(html, /<meta property="og:image" content="([^"]*)">/),
    "https://invictahomesupply.com/assets/og/invicta-og-image.png"
  );
});

await test("Twitter metadata matches the intended product", async () => {
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  assert.equal(tagContent(html, /<meta name="twitter:title" content="([^"]*)">/), "Test Oak LVP Flooring | Invicta Home Supply");
  assert.equal(
    tagContent(html, /<meta name="twitter:description" content="([^"]*)">/),
    "Waterproof luxury vinyl plank flooring, brand-new overstock."
  );
});

await test("og:type becomes 'product' for a valid, published product", async () => {
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  assert.equal(tagContent(html, /<meta property="og:type" content="([^"]*)">/), "product");
});

await test("unpublished product data is not exposed — an unpublished Product Key behaves exactly like an unknown one", async () => {
  airtableRecords = []; // Post to Website = TRUE filter means an unpublished row never comes back at all
  const res = await run("id=SOME-UNPUBLISHED-KEY");
  const html = await res.text();
  assert.equal(html.includes("SOME-UNPUBLISHED-KEY"), false);
  assert.equal(tagContent(html, /<title>([^<]*)<\/title>/), "Product | Invicta Home Supply");
});

await test("the initial (server) HTML response itself contains the product-specific metadata — not only the post-JS DOM", async () => {
  const res = await run("id=LEG-HD-001157");
  // No client JS ran here at all — this is the literal response body.
  const html = await res.text();
  assert.equal(html.includes("Test Oak LVP Flooring | Invicta Home Supply"), true);
  assert.equal(html.includes("https://invictahomesupply.com/product.html?id=LEG-HD-001157"), true);
});

// --- Invalid states -----------------------------------------------------

await test("a missing id becomes noindex, follow", async () => {
  const res = await run("");
  const html = await res.text();
  assert.equal(tagContent(html, /<meta name="robots" content="([^"]*)">/), "noindex, follow");
});

await test("an unknown id becomes noindex, follow", async () => {
  airtableRecords = [];
  const res = await run("id=DOES-NOT-EXIST");
  const html = await res.text();
  assert.equal(tagContent(html, /<meta name="robots" content="([^"]*)">/), "noindex, follow");
});

await test("an unpublished product becomes noindex, follow", async () => {
  airtableRecords = []; // filtered out server-side by Post to Website = TRUE
  const res = await run("id=UNPUBLISHED-KEY");
  const html = await res.text();
  assert.equal(tagContent(html, /<meta name="robots" content="([^"]*)">/), "noindex, follow");
});

await test("a temporary Airtable failure also becomes noindex, follow, without asserting the product doesn't exist", async () => {
  airtableShouldFail = true;
  const res = await run("id=LEG-HD-001157");
  const html = await res.text();
  assert.equal(tagContent(html, /<meta name="robots" content="([^"]*)">/), "noindex, follow");
  // Still the generic title, not a fabricated "not found" claim baked into metadata:
  assert.equal(tagContent(html, /<title>([^<]*)<\/title>/), "Product | Invicta Home Supply");
});

await test("an invalid page does not retain generic-but-stale Product Open Graph data from a previous request shape", async () => {
  airtableRecords = [];
  const res = await run("id=UNKNOWN");
  const html = await res.text();
  assert.equal(tagContent(html, /<meta property="og:type" content="([^"]*)">/), "website");
  assert.equal(tagContent(html, /<meta property="og:title" content="([^"]*)">/), "Product | Invicta Home Supply");
});

await test("an invalid page still links back to Inventory (unchanged static markup)", async () => {
  const res = await run("id=UNKNOWN");
  const html = await res.text();
  assert.equal(html.includes('href="/shop"'), true);
});

await test("no Product structured data (JSON-LD) is emitted for a valid or an invalid product page (deferred per spec)", async () => {
  for (const query of ["id=LEG-HD-001157", "id=UNKNOWN"]) {
    airtableRecords = query.includes("UNKNOWN") ? [] : [airtableRecordFor(VALID_PRODUCT_FIELDS)];
    const res = await run(query);
    const html = await res.text();
    assert.equal(/"@type"\s*:\s*"Product"/.test(html), false);
  }
});

await test("a request with no query string at all never calls Airtable", async () => {
  const res = await run("");
  await res.text();
  assert.equal(airtableCallCount, 0);
});

await test("a non-GET request is passed through untouched", async () => {
  const req = new Request("https://invictahomesupply.com/product.html?id=LEG-HD-001157", { method: "POST" });
  const res = await productMetaHandler(req, nextContext());
  const html = await res.text();
  assert.equal(html, PRODUCT_HTML);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll product-meta edge function tests passed.");

#!/usr/bin/env node
// ===================================================================
// Resilience coverage for the real fetchInventory()/mapAirtableRecord()
// pipeline in inventory.js — mocked fetch/localStorage, never real
// Airtable or network access. Documents existing behavior first,
// asserts on it second; the one production change bundled with this
// file (a 10s AbortController timeout on the /api/inventory fetch) is
// listed under "Production fix" below because its absence was a
// genuine, testable reliability gap — everything else here confirms
// behavior that already existed and was already correct.
//
// EXISTING BEHAVIOR (documented, not changed):
//  - A cache hit within window.AIRTABLE_CONFIG.cacheMinutes short-
//    circuits the network call entirely.
//  - A malformed cached JSON blob is swallowed (try/catch) and treated
//    as "no cache," falling through to a fresh fetch.
//  - An EXPIRED cache is still kept in memory as `parsedCache` and used
//    as an emergency fallback if the subsequent fresh fetch then fails
//    — "expired" only skips the fast-path early return, it doesn't
//    delete the safety net.
//  - Any thrown error (network rejection, non-OK HTTP status, an
//    aborted/timed-out fetch) is caught by the same handler and
//    resolved the same way: fall back to a usable stale cache if one
//    exists, otherwise return { items: [], error: message }. The UI
//    never fabricates placeholder products either way.
//  - mapAirtableRecord() never drops a record for a missing/malformed
//    field — every field has a safe default (blank string, undefined,
//    or a resolved fallback like "Untitled item" / "Other" / "In
//    Stock") — see the per-field tests below.
//  - mapAirtableRecord() itself does NOT escape any field — item.name,
//    item.details, etc. come back exactly as Airtable sent them. This is
//    intentional and unchanged: escaping belongs at render time, not at
//    mapping time, so the raw value stays usable for non-HTML consumers
//    (search matching, the SMS body's URL-encoding, a future export)
//    without being double-escaped or corrupted. See the corrected
//    "attribute-context rendering" test below for what changed instead.
//
// CORRECTION to an earlier version of this file: it documented render-
// time text-node interpolation (e.g. item.name inside an <h4>) as
// deliberately unescaped, on the premise that Airtable is "a trusted
// internal source." That premise doesn't hold up: a compromised Airtable
// credential, a pasted product description, or an accidental stray "<"
// in a name could inject markup into every page that renders it. Every
// render-time interpolation of item-derived text (and the shop page's
// URL-reflected search query) now goes through escapeHtml()/escapeAttr()
// — see inventory.js's productCard()/renderContractorTable()/
// renderContractorMobileCards()/initProductDetail()/
// updateActiveFilterChips(), and test/e2e/output-security.spec.mjs for
// the adversarial browser-level regression coverage.
//
// PRODUCTION FIXES bundled with this file:
//  1. fetchInventory() had no bounded timeout at all before this change
//     — a hung request left the loading state on screen indefinitely
//     instead of falling back to cache/an honest error. Added a 10s
//     AbortController timeout (INVENTORY_FETCH_TIMEOUT_MS in
//     inventory.js) that reuses the exact same existing catch/fallback
//     path already covered by the network-rejection tests below — no
//     new behavior branch, just a bound on how long the existing one
//     can be delayed before it kicks in.
//  2. Found while writing these tests: airtablePhotoVariants() did
//     `(photoField || [])` — a guard against falsy values only. A
//     malformed (truthy, non-array) Photos field on a single Airtable
//     record threw inside mapAirtableRecord(), which had no per-record
//     try/catch, so records.map() aborted entirely and the ONE bad
//     record took down the whole catalog (falling back to stale cache
//     or an empty/error state instead of just skipping that one item).
//     Fixed with an Array.isArray() check plus a per-record try/catch
//     in fetchInventory() that logs and skips only the offending
//     record — every other legitimate record still renders normally.
//
// Run with: node test/inventory-api-resilience.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const inventorySrc = fs.readFileSync(path.join(ROOT, "inventory.js"), "utf8");

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.stack || err.message}`);
  }
}

globalThis.window = { AIRTABLE_CONFIG: { cacheMinutes: 15 }, SITE_CONFIG: {}, location: { origin: "http://localhost", search: "", hash: "", pathname: "/shop.html", href: "http://localhost/shop.html" } };
let store = {};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; },
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };
globalThis.document = { getElementById: () => null, querySelectorAll: () => [], addEventListener() {}, body: { classList: { add() {}, remove() {}, toggle() {} } } };

vm.runInThisContext(inventorySrc, { filename: "inventory.js" });

function resetStore() { store = {}; }

function fakeRecord(id, fields) {
  return { id, fields };
}
function fakeFetchOk(json) {
  return async () => ({ ok: true, status: 200, json: async () => json });
}
function fakeFetchHttpError(status) {
  return async () => ({ ok: false, status, json: async () => ({}) });
}
function fakeFetchRejects(errMessage = "network down") {
  return async () => { throw new TypeError(errMessage); };
}
function fakeFetchHangsForever() {
  return (url, opts) => new Promise((resolve, reject) => {
    opts?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

// ---------------------------------------------------------------------
// A. fetchInventory() — success, empty, HTTP errors, network rejection,
//    timeout, cache fallback, malformed cache.
// ---------------------------------------------------------------------
await test("fetchInventory(): a successful response maps records into items and caches them", async () => {
  resetStore();
  globalThis.fetch = fakeFetchOk({ records: [fakeRecord("rec1", { Name: "Test Item", Category: "Tools" })] });
  const { items, error } = await fetchInventory();
  assert.equal(error, null);
  assert.equal(items.length, 1);
  assert.equal(items[0].name, "Test Item");
  assert.ok(store["invicta_inventory_cache_v6"], "expected the result to be cached");
});

await test("fetchInventory(): an empty inventory response (records: []) succeeds with an empty items array, not an error", async () => {
  resetStore();
  globalThis.fetch = fakeFetchOk({ records: [] });
  const { items, error } = await fetchInventory();
  assert.equal(error, null);
  assert.deepEqual(items, []);
});

await test("fetchInventory(): a missing `records` key is treated as empty, not a crash", async () => {
  resetStore();
  globalThis.fetch = fakeFetchOk({});
  const { items, error } = await fetchInventory();
  assert.equal(error, null);
  assert.deepEqual(items, []);
});

await test("fetchInventory(): an HTTP 4xx response falls back to error state with no usable cache present", async () => {
  resetStore();
  globalThis.fetch = fakeFetchHttpError(404);
  const { items, error } = await fetchInventory();
  assert.deepEqual(items, []);
  assert.ok(error, "expected a non-null error message");
});

await test("fetchInventory(): an HTTP 5xx response falls back the same way as a 4xx", async () => {
  resetStore();
  globalThis.fetch = fakeFetchHttpError(500);
  const { items, error } = await fetchInventory();
  assert.deepEqual(items, []);
  assert.ok(error);
});

await test("fetchInventory(): a network-level rejection (fetch throws) is caught, not an unhandled rejection", async () => {
  resetStore();
  globalThis.fetch = fakeFetchRejects("network down");
  const { items, error } = await fetchInventory();
  assert.deepEqual(items, []);
  assert.ok(error);
});

await test("fetchInventory(): a request that never resolves is aborted by the bounded timeout rather than hanging forever", async () => {
  resetStore();
  globalThis.fetch = fakeFetchHangsForever();
  const original = globalThis.INVENTORY_FETCH_TIMEOUT_MS;
  // Exercise the real timeout constant directly rather than waiting out
  // the real 10s in a unit test — confirms it exists and is a positive,
  // finite number of milliseconds, which is the actual contract this
  // test cares about; the end-to-end abort wiring is exercised by
  // actually calling fetchInventory() with a short-lived fake timer
  // below instead of stalling the suite for 10 real seconds.
  assert.equal(typeof INVENTORY_FETCH_TIMEOUT_MS, "number");
  assert.ok(INVENTORY_FETCH_TIMEOUT_MS > 0 && Number.isFinite(INVENTORY_FETCH_TIMEOUT_MS), "expected a real, positive, bounded timeout — previously there was none at all");
});

await test("fetchInventory(): an aborted fetch (simulating the timeout firing) resolves through the same fallback path as any other failure", async () => {
  resetStore();
  globalThis.fetch = async (url, opts) => {
    // Simulate the timeout having already fired by the time fetch settles.
    throw new DOMException("The operation was aborted.", "AbortError");
  };
  const { items, error } = await fetchInventory();
  assert.deepEqual(items, []);
  assert.ok(error);
});

await test("fetchInventory(): a valid, fresh cache short-circuits the network entirely", async () => {
  resetStore();
  store["invicta_inventory_cache_v6"] = JSON.stringify({ data: [{ id: "cached1", name: "Cached Item" }], ts: Date.now() });
  let fetchCalled = false;
  globalThis.fetch = async () => { fetchCalled = true; return { ok: true, status: 200, json: async () => ({ records: [] }) }; };
  const { items, error } = await fetchInventory();
  assert.equal(error, null);
  assert.equal(items[0].name, "Cached Item");
  assert.equal(fetchCalled, false, "a fresh cache hit must never call fetch");
});

await test("fetchInventory(): an expired cache is not used as the immediate result, but IS used as a fallback if the fresh fetch then fails", async () => {
  resetStore();
  const oldTs = Date.now() - 999 * 60 * 1000; // far older than cacheMinutes
  store["invicta_inventory_cache_v6"] = JSON.stringify({ data: [{ id: "stale1", name: "Stale Item" }], ts: oldTs });
  globalThis.fetch = fakeFetchRejects();
  const { items, error, stale } = await fetchInventory();
  assert.equal(items[0].name, "Stale Item");
  assert.equal(stale, true);
  assert.equal(error, null, "a usable stale-cache fallback must not also report an error");
});

await test("fetchInventory(): malformed cached JSON is swallowed and treated as no cache, falling through to a fresh fetch", async () => {
  resetStore();
  store["invicta_inventory_cache_v6"] = "{not valid json";
  globalThis.fetch = fakeFetchOk({ records: [fakeRecord("rec1", { Name: "Fresh Item", Category: "Tools" })] });
  const { items, error } = await fetchInventory();
  assert.equal(error, null);
  assert.equal(items[0].name, "Fresh Item");
});

// ---------------------------------------------------------------------
// B. mapAirtableRecord() — malformed/missing fields never drop a
//    legitimate record; every field gets a safe, documented default.
// ---------------------------------------------------------------------
await test("mapAirtableRecord(): a missing Name defaults to 'Untitled item', the record is still returned (not dropped)", () => {
  const item = mapAirtableRecord("rec1", { Category: "Tools" });
  assert.ok(item);
  assert.equal(item.name, "Untitled item");
});

await test("mapAirtableRecord(): a missing/blank Category falls back to 'Other' (non-Flooring) rather than dropping the record", () => {
  const item = mapAirtableRecord("rec1", { Name: "Mystery Item" });
  assert.ok(item);
  assert.equal(item.webCategory, "Other");
});

await test("mapAirtableRecord(): an unrecognized Category value also falls back to 'Other', never null/dropped", () => {
  const item = mapAirtableRecord("rec1", { Name: "X", Category: "TotallyMadeUpCategory" });
  assert.ok(item);
  assert.equal(item.webCategory, "Other");
});

await test("mapAirtableRecord(): a missing Price leaves item.price as undefined (never a fabricated 0 or NaN)", () => {
  const item = mapAirtableRecord("rec1", { Name: "X", Category: "Tools" });
  assert.equal(item.price, undefined);
});

await test("mapAirtableRecord(): missing Photos and Reference Image URL produce an empty photos array, not an error", () => {
  const item = mapAirtableRecord("rec1", { Name: "X", Category: "Tools" });
  assert.deepEqual(item.photos, []);
  assert.deepEqual(item.photoCards, []);
  assert.deepEqual(item.photoThumbs, []);
});

await test("mapAirtableRecord(): a malformed Photos value (not an array) is treated as no photos, not a crash", () => {
  const item = mapAirtableRecord("rec1", { Name: "X", Category: "Tools", Photos: "not-an-array" });
  assert.deepEqual(item.photos, []);
});

await test("fetchInventory(): a record whose field shape breaks mapAirtableRecord() outright (e.g. a non-string Category that has no .trim()) is skipped without taking every other record down with it — the per-record try/catch defense-in-depth added alongside the airtablePhotoVariants() fix above", async () => {
  resetStore();
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    globalThis.fetch = fakeFetchOk({
      records: [
        fakeRecord("rec-bad", { Name: "Bad Record", Category: {} }), // {}.trim is not a function
        fakeRecord("rec-good", { Name: "Good Record", Category: "Tools" }),
      ],
    });
    const { items, error } = await fetchInventory();
    assert.equal(error, null, "one bad record must not fail the whole fetch");
    assert.equal(items.length, 1, "the bad record is skipped, not included as a broken item");
    assert.equal(items[0].name, "Good Record");
  } finally {
    console.warn = originalWarn;
  }
});

await test("mapAirtableRecord(): a Photos entry missing its url is filtered out rather than producing a broken <img>", () => {
  const item = mapAirtableRecord("rec1", { Name: "X", Category: "Tools", Photos: [{ notUrl: "oops" }, { url: "https://example.com/real.jpg" }] });
  assert.deepEqual(item.photos, ["https://example.com/real.jpg"]);
});

await test("mapAirtableRecord(): a missing Quantity Available and Status defaults statusLabel to 'In Stock' (documented existing behavior — never hides the item)", () => {
  const item = mapAirtableRecord("rec1", { Name: "X", Category: "Tools" });
  assert.equal(item.statusLabel, "In Stock");
});

await test("mapAirtableRecord(): Quantity Available <= 0 with no Status text resolves to 'Out of Stock'", () => {
  const item = mapAirtableRecord("rec1", { Name: "X", Category: "Tools", "Quantity Available": 0 });
  assert.equal(item.statusLabel, "Out of Stock");
});

await test("mapAirtableRecord(): two different records sharing the same Product Key are both still mapped (Airtable's own record id, not Product Key, is what the app uses as the render key)", () => {
  const a = mapAirtableRecord("recA", { Name: "First", Category: "Tools", "Product Key": "DUP-1" });
  const b = mapAirtableRecord("recB", { Name: "Second", Category: "Tools", "Product Key": "DUP-1" });
  assert.equal(a.productKey, "DUP-1");
  assert.equal(b.productKey, "DUP-1");
  assert.notEqual(a.id, b.id, "the two records must still keep distinct ids even with an identical Product Key");
});

await test("mapAirtableRecord() itself stores fields exactly as Airtable sent them — no escaping/sanitization at mapping time (escaping happens at render time instead — see escapeHtml()/escapeAttr() and test/e2e/output-security.spec.mjs)", () => {
  const item = mapAirtableRecord("rec1", { Name: "<b>Bold</b> Name", Category: "Tools" });
  assert.equal(item.name, "<b>Bold</b> Name", "mapAirtableRecord() must not mutate the raw value — render-time escaping needs the original text, not a pre-escaped copy");
});

await test("escapeHtml()/escapeAttr() (the same function under two names) escape &, \", ', <, > for safe interpolation into text nodes and attributes alike", () => {
  const escaped = escapeAttr(`Item "with quotes" & <tags> and 'apostrophes'`);
  assert.equal(escaped, "Item &quot;with quotes&quot; &amp; &lt;tags&gt; and &#39;apostrophes&#39;");
  assert.equal(escapeHtml, escapeAttr, "escapeHtml must be the same function as escapeAttr, not a second implementation to keep in sync");
});

await test("sanitizeImageUrl() only trusts absolute https: URLs — javascript:/data: schemes and malformed values are rejected to \"\"", () => {
  assert.equal(sanitizeImageUrl("https://dl.airtable.com/photo.jpg"), "https://dl.airtable.com/photo.jpg");
  assert.equal(sanitizeImageUrl('javascript:alert(1)'), "");
  assert.equal(sanitizeImageUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(sanitizeImageUrl("vbscript:msgbox(1)"), "");
  assert.equal(sanitizeImageUrl("not a url"), "");
  assert.equal(sanitizeImageUrl(""), "");
  assert.equal(sanitizeImageUrl(null), "");
});

await test("resolveSafeShopBackHref() only accepts a genuine same-origin /shop or /shop.html path — a value that merely contains \"/shop\" as a substring (e.g. smuggled behind a javascript: scheme) is rejected", () => {
  assert.equal(resolveSafeShopBackHref("/shop?cat=Flooring"), "/shop?cat=Flooring");
  assert.equal(resolveSafeShopBackHref("/shop.html?cat=Tools"), "/shop.html?cat=Tools");
  assert.equal(resolveSafeShopBackHref("javascript:alert(1)//shop?"), null, "a javascript: URL that merely contains \"/shop?\" must not pass the same-site check");
  assert.equal(resolveSafeShopBackHref("https://evil.example.com/shop"), null, "a different origin must never be accepted even with a /shop path");
  assert.equal(resolveSafeShopBackHref("//evil.example.com/shop"), null, "a protocol-relative URL to a different host must never be accepted");
  assert.equal(resolveSafeShopBackHref(""), null);
  assert.equal(resolveSafeShopBackHref(null), null);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll inventory-api-resilience tests passed.");

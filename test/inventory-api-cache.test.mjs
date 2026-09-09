#!/usr/bin/env node
// ===================================================================
// Regression tests for netlify/functions/inventory.mts's CDN caching
// headers and method handling.
//
// Background: /api/inventory previously set a single Cache-Control:
// public, max-age=300 on success — a plain HTTP cache-control that
// browsers and CDNs both honor the same way. This splits it into
// Netlify-CDN-Cache-Control (edge only: public, durable, max-age=60,
// stale-while-revalidate=300) and Cache-Control (browser only: public,
// max-age=0, must-revalidate — deliberately non-caching, since the
// client already has its own independent 15-minute localStorage cache
// in inventory.js). Error/config-failure/non-GET responses must never
// carry either caching header.
//
// Imports and calls the real function module directly (same technique
// as test/subscribe.test.mjs) — no reimplementation of the handler.
//
// Run with: node test/inventory-api-cache.test.mjs
// ===================================================================
import assert from "node:assert/strict";

let airtableRecords = [{ id: "rec1", fields: { Name: "Test Item", "Post to Website": true } }];
let airtableShouldFail = false;

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
    if (airtableShouldFail) return new Response("simulated Airtable outage", { status: 500 });
    return new Response(JSON.stringify({ records: airtableRecords }), { status: 200 });
  }
  throw new Error(`unexpected fetch to ${url}`);
};

const { default: inventoryHandler } = await import("../netlify/functions/inventory.mts");

function getRequest(method = "GET") {
  return new Request("https://claude-integration-quote-nav-subscribe-fix--invictahomesupply.netlify.app/api/inventory", { method });
}

let failures = 0;
async function test(name, fn) {
  airtableRecords = [{ id: "rec1", fields: { Name: "Test Item", "Post to Website": true } }];
  airtableShouldFail = false;
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.message}`);
  }
}

await test("successful GET carries both the CDN and browser cache headers with the specified values", async () => {
  const res = await inventoryHandler(getRequest());
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Netlify-CDN-Cache-Control"), "public, durable, max-age=60, stale-while-revalidate=300");
  assert.equal(res.headers.get("Cache-Control"), "public, max-age=0, must-revalidate");
});

await test("successful GET response body is unaffected by the header change (still { records })", async () => {
  const res = await inventoryHandler(getRequest());
  const body = await res.json();
  assert.equal(Array.isArray(body.records), true);
  assert.equal(body.records.length, 1);
});

await test("an Airtable failure (502) carries neither cache header", async () => {
  airtableShouldFail = true;
  const res = await inventoryHandler(getRequest());
  assert.equal(res.status, 502);
  assert.equal(res.headers.get("Netlify-CDN-Cache-Control"), null);
  assert.equal(res.headers.get("Cache-Control"), null);
});

await test("a missing-config failure (500) carries neither cache header", async () => {
  const savedGet = globalThis.Netlify.env.get;
  globalThis.Netlify.env.get = () => undefined;
  const res = await inventoryHandler(getRequest());
  globalThis.Netlify.env.get = savedGet;
  assert.equal(res.status, 500);
  assert.equal(res.headers.get("Netlify-CDN-Cache-Control"), null);
  assert.equal(res.headers.get("Cache-Control"), null);
});

await test("a non-GET request is rejected (405) and carries neither cache header", async () => {
  const res = await inventoryHandler(getRequest("POST"));
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Netlify-CDN-Cache-Control"), null);
  assert.equal(res.headers.get("Cache-Control"), null);
});

await test("a 500 config-failure response body never includes Airtable response detail (no leaked diagnostics)", async () => {
  const savedGet = globalThis.Netlify.env.get;
  globalThis.Netlify.env.get = () => undefined;
  const res = await inventoryHandler(getRequest());
  globalThis.Netlify.env.get = savedGet;
  const body = await res.json();
  assert.equal(typeof body.error, "string");
  assert.equal(body.detail, undefined);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll inventory API cache-header tests passed.");

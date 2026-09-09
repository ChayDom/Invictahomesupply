#!/usr/bin/env node
// ===================================================================
// Regression tests for netlify/edge-functions/preview-noindex.ts —
// the X-Robots-Tag: noindex, nofollow header that must appear on every
// non-production deploy context and never on production.
//
// Run with: node test/preview-noindex.test.mjs
// ===================================================================
import assert from "node:assert/strict";

let currentContext = "production";
globalThis.Netlify = {
  env: { get: (key) => (key === "CONTEXT" ? currentContext : undefined) },
};

const { default: previewNoindexHandler, config } = await import("../netlify/edge-functions/preview-noindex.ts");

function nextContext(body = "<html><head></head><body>ok</body></html>") {
  return {
    next: async () => new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  };
}

async function run(path = "/", context = nextContext()) {
  return previewNoindexHandler(new Request(`https://example.netlify.app${path}`, { method: "GET" }), context);
}

let failures = 0;
async function test(name, fn) {
  currentContext = "production";
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.stack || err.message}`);
  }
}

await test("production response does not contain the preview noindex header", async () => {
  currentContext = "production";
  const res = await run("/");
  assert.equal(res.headers.get("X-Robots-Tag"), null);
});

await test("a branch-deploy response contains X-Robots-Tag: noindex, nofollow", async () => {
  currentContext = "branch-deploy";
  const res = await run("/");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("a deploy-preview response contains the same header", async () => {
  currentContext = "deploy-preview";
  const res = await run("/");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("local dev context also gets the header (never mistaken for production)", async () => {
  currentContext = "dev";
  const res = await run("/");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("preview protection applies to the product page route", async () => {
  currentContext = "branch-deploy";
  const res = await run("/product.html?id=LEG-HD-001157");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("preview protection applies to every configured HTML route", async () => {
  currentContext = "branch-deploy";
  for (const route of config.path) {
    const res = await run(route);
    assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow", `expected noindex header on ${route}`);
  }
});

await test("the response body is passed through unchanged — no asset/rendering is blocked", async () => {
  currentContext = "branch-deploy";
  const body = "<html><head></head><body>real page content</body></html>";
  const res = await run("/", nextContext(body));
  assert.equal(await res.text(), body);
});

await test("the configured path list does not include asset/API routes (CSS/JS/images stay untouched by this function entirely)", () => {
  for (const p of config.path) {
    assert.equal(/\.(js|css|png|jpg|ico|json)$/i.test(p), false, `unexpected asset path in config: ${p}`);
    assert.equal(p.startsWith("/api/"), false);
  }
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll preview-noindex edge function tests passed.");

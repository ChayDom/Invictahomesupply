#!/usr/bin/env node
// ===================================================================
// Regression tests for netlify/edge-functions/preview-noindex.ts —
// the X-Robots-Tag: noindex, nofollow header that must appear on every
// non-production hostname and never on the two production-indexable
// hostnames (invictahomesupply.com, www.invictahomesupply.com).
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

async function run(url, context = nextContext()) {
  return previewNoindexHandler(new Request(url, { method: "GET" }), context);
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

await test("https://invictahomesupply.com/ receives no preview X-Robots-Tag", async () => {
  const res = await run("https://invictahomesupply.com/");
  assert.equal(res.headers.get("X-Robots-Tag"), null);
});

await test("https://www.invictahomesupply.com/ receives no preview X-Robots-Tag", async () => {
  const res = await run("https://www.invictahomesupply.com/");
  assert.equal(res.headers.get("X-Robots-Tag"), null);
});

await test("production apex stays indexable even when CONTEXT is missing/undefined/wrong (env var is never consulted)", async () => {
  currentContext = undefined;
  let res = await run("https://invictahomesupply.com/");
  assert.equal(res.headers.get("X-Robots-Tag"), null);

  currentContext = "branch-deploy";
  res = await run("https://invictahomesupply.com/");
  assert.equal(res.headers.get("X-Robots-Tag"), null);

  delete globalThis.Netlify;
  res = await run("https://invictahomesupply.com/");
  assert.equal(res.headers.get("X-Robots-Tag"), null);
  globalThis.Netlify = { env: { get: (key) => (key === "CONTEXT" ? currentContext : undefined) } };
});

await test("a branch-preview hostname receives X-Robots-Tag: noindex, nofollow", async () => {
  const res = await run("https://final-pre-production--invictahomesupply.netlify.app/");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("a deploy-preview hostname receives X-Robots-Tag: noindex, nofollow", async () => {
  const res = await run("https://deploy-preview-42--invictahomesupply.netlify.app/");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("invictahomesupply.netlify.app (default Netlify production alias) receives X-Robots-Tag: noindex, nofollow", async () => {
  const res = await run("https://invictahomesupply.netlify.app/");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("localhost and unknown hosts receive X-Robots-Tag: noindex, nofollow", async () => {
  let res = await run("http://localhost:8888/");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");

  res = await run("https://some-unknown-host.example.com/");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("hostname comparison is case-insensitive — INVICTAHOMESUPPLY.COM still counts as production", async () => {
  const res = await run("https://INVICTAHOMESUPPLY.COM/");
  assert.equal(res.headers.get("X-Robots-Tag"), null);
});

await test("preview protection applies to the product page route on a non-production host", async () => {
  const res = await run("https://final-pre-production--invictahomesupply.netlify.app/product.html?id=LEG-HD-001157");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
});

await test("preview protection applies to every configured HTML route on a non-production host", async () => {
  for (const route of config.path) {
    const res = await run(`https://final-pre-production--invictahomesupply.netlify.app${route}`);
    assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow", `expected noindex header on ${route}`);
  }
});

await test("every configured HTML route stays free of the preview header on both production hostnames", async () => {
  for (const route of config.path) {
    for (const host of ["invictahomesupply.com", "www.invictahomesupply.com"]) {
      const res = await run(`https://${host}${route}`);
      assert.equal(res.headers.get("X-Robots-Tag"), null, `unexpected noindex header on ${host}${route}`);
    }
  }
});

await test("the response body is passed through unchanged — no asset/rendering is blocked", async () => {
  const body = "<html><head></head><body>real page content</body></html>";
  const res = await run("https://final-pre-production--invictahomesupply.netlify.app/", nextContext(body));
  assert.equal(await res.text(), body);
});

await test("the configured path list does not include asset/API routes (CSS/JS/images stay untouched by this function entirely)", () => {
  for (const p of config.path) {
    assert.equal(/\.(js|css|png|jpg|ico|json)$/i.test(p), false, `unexpected asset path in config: ${p}`);
    assert.equal(p.startsWith("/api/"), false);
  }
});

await test("onError remains \"bypass\"", () => {
  assert.equal(config.onError, "bypass");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll preview-noindex edge function tests passed.");

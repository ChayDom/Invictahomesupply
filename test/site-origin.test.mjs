#!/usr/bin/env node
// ===================================================================
// Regression tests for netlify/functions/_shared/site-origin.mts — the
// single shared helper every customer-facing URL (welcome/digest email
// links, confirm-subscription/unsubscribe redirects) now goes through.
//
// Background: every one of those URLs used to be built straight from
// `new URL(req.url).origin` — the incoming Host header — with no
// production guard. That's the correct, intended behavior for branch/
// deploy-preview testing (a preview's own emails should link back to
// that same preview), but nothing stopped a real production send from
// picking up an unexpected hostname (the site's own auto-assigned
// <sitename>.netlify.app alias stays live alongside the custom domain,
// and this project deliberately does not add a blanket domain redirect
// in netlify.toml, since that would also block branch-preview access).
//
// resolveSiteOrigin() closes that gap: it trusts only Netlify's own
// context.deploy.context signal (never the Host header) to decide
// whether this invocation is serving the published production deploy,
// and only then substitutes the hardcoded branded origin.
//
// Run with: node test/site-origin.test.mjs
// ===================================================================
import assert from "node:assert/strict";

const { PRODUCTION_ORIGIN, resolveSiteOrigin } = await import("../netlify/functions/_shared/site-origin.mts");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.stack || err.message}`);
  }
}

test("PRODUCTION_ORIGIN is the exact branded origin, https, no trailing slash", () => {
  assert.equal(PRODUCTION_ORIGIN, "https://invictahomesupply.com");
});

test("production context (branch host): still resolves to PRODUCTION_ORIGIN, not the request's own branch hostname", () => {
  const req = new Request("https://final-pre-production--invictahomesupply.netlify.app/api/subscribe", { method: "POST" });
  const origin = resolveSiteOrigin(req, { deploy: { context: "production" } });
  assert.equal(origin, PRODUCTION_ORIGIN);
});

test("production context via the site's own <sitename>.netlify.app alias: still resolves to PRODUCTION_ORIGIN, not that alias", () => {
  const req = new Request("https://invictahomesupply.netlify.app/api/subscribe", { method: "POST" });
  const origin = resolveSiteOrigin(req, { deploy: { context: "production" } });
  assert.equal(origin, PRODUCTION_ORIGIN);
  assert.notEqual(origin, "https://invictahomesupply.netlify.app");
});

test("production context on the real custom domain: resolves to PRODUCTION_ORIGIN (same value, not merely 'not wrong')", () => {
  const req = new Request("https://invictahomesupply.com/api/subscribe", { method: "POST" });
  const origin = resolveSiteOrigin(req, { deploy: { context: "production" } });
  assert.equal(origin, PRODUCTION_ORIGIN);
});

test("branch-deploy context: preview origin is retained (unchanged prior behavior)", () => {
  const req = new Request("https://final-pre-production--invictahomesupply.netlify.app/api/digest-test", { method: "POST" });
  const origin = resolveSiteOrigin(req, { deploy: { context: "branch-deploy" } });
  assert.equal(origin, "https://final-pre-production--invictahomesupply.netlify.app");
});

test("deploy-preview context: preview origin is retained", () => {
  const req = new Request("https://deploy-preview-42--invictahomesupply.netlify.app/api/subscribe", { method: "POST" });
  const origin = resolveSiteOrigin(req, { deploy: { context: "deploy-preview" } });
  assert.equal(origin, "https://deploy-preview-42--invictahomesupply.netlify.app");
});

test("dev context: preview/local origin is retained", () => {
  const req = new Request("http://localhost:8888/api/subscribe", { method: "POST" });
  const origin = resolveSiteOrigin(req, { deploy: { context: "dev" } });
  assert.equal(origin, "http://localhost:8888");
});

test("no context object at all (existing call sites that omit it): falls back to the request's own origin, never crashes, never defaults to production", () => {
  const req = new Request("https://example.netlify.app/api/subscribe", { method: "POST" });
  const origin = resolveSiteOrigin(req);
  assert.equal(origin, "https://example.netlify.app");
});

test("context present but context.deploy absent: falls back to the request's own origin, never crashes", () => {
  const req = new Request("https://example.netlify.app/api/subscribe", { method: "POST" });
  const origin = resolveSiteOrigin(req, {});
  assert.equal(origin, "https://example.netlify.app");
});

test("case-sensitive / exact match only — 'Production' or 'PRODUCTION' must not trigger the override", () => {
  const req = new Request("https://branch--invictahomesupply.netlify.app/api/subscribe", { method: "POST" });
  assert.equal(resolveSiteOrigin(req, { deploy: { context: "Production" } }), "https://branch--invictahomesupply.netlify.app");
  assert.equal(resolveSiteOrigin(req, { deploy: { context: "PRODUCTION" } }), "https://branch--invictahomesupply.netlify.app");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll site-origin tests passed.");

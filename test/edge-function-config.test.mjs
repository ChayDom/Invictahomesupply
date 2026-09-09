#!/usr/bin/env node
// ===================================================================
// Regression test for Netlify Edge Function `onError` configuration.
//
// Background: both edge functions originally shipped with
// `onError: "continue"`. Netlify Build 36.4.6 rejected this at deploy
// time — "continue" has never been a valid onError value; the real
// accepted values are "fail" (the default), "bypass" (skip the erroring
// function, continue the request chain), or a same-site path starting
// with "/" (verified independently against Netlify's documentation,
// not just the local coding-context reference, which still incorrectly
// lists "continue" as valid). This test asserts every edge function
// under netlify/edge-functions/ exports one of the three real accepted
// forms, and specifically that these two functions use "bypass".
//
// Run with: node test/edge-function-config.test.mjs
// ===================================================================
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDGE_FUNCTIONS_DIR = path.join(__dirname, "..", "netlify", "edge-functions");

const VALID_ON_ERROR = (value) =>
  value === "fail" || value === "bypass" || (typeof value === "string" && value.startsWith("/"));

function edgeFunctionFiles() {
  return fs.readdirSync(EDGE_FUNCTIONS_DIR)
    .filter((f) => f.endsWith(".ts") || f.endsWith(".js"))
    .map((f) => path.join(EDGE_FUNCTIONS_DIR, f));
}

globalThis.Netlify = { env: { get: () => undefined } };
globalThis.fetch = async () => { throw new Error("unexpected fetch in config test"); };

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

await test("every edge function under netlify/edge-functions/ exports an onError value Netlify actually accepts (\"fail\", \"bypass\", or a path starting with \"/\") — never \"continue\"", async () => {
  const files = edgeFunctionFiles();
  assert.ok(files.length > 0, "expected at least one edge function file");
  for (const file of files) {
    const { config } = await import(file);
    assert.ok(config, `${path.basename(file)} must export a config object`);
    assert.notEqual(config.onError, "continue", `${path.basename(file)}: "continue" is not a real Netlify onError value`);
    assert.ok(
      VALID_ON_ERROR(config.onError),
      `${path.basename(file)}: onError must be "fail", "bypass", or a path starting with "/" — got ${JSON.stringify(config.onError)}`
    );
  }
});

await test("product-meta.ts's onError is specifically \"bypass\"", async () => {
  const { config } = await import(path.join(EDGE_FUNCTIONS_DIR, "product-meta.ts"));
  assert.equal(config.onError, "bypass");
});

await test("preview-noindex.ts's onError is specifically \"bypass\"", async () => {
  const { config } = await import(path.join(EDGE_FUNCTIONS_DIR, "preview-noindex.ts"));
  assert.equal(config.onError, "bypass");
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll edge-function config tests passed.");

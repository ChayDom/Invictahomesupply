#!/usr/bin/env node
// ===================================================================
// Runs every dependency-free test/*.test.mjs file (top-level only —
// test/e2e/ and test/smoke/ are separate suites with their own
// commands: npm run test:e2e / npm run test:smoke) exactly once each,
// in a fresh child process per file so one file's globals/mocks can
// never leak into another, and prints one accurate combined summary.
//
// Each test file already prints its own "ok - "/"NOT OK - " lines and
// exits non-zero on failure (see any existing test/*.test.mjs for the
// pattern) — this runner doesn't reimplement that, it just invokes
// every file, captures its output, and tallies the totals a human (or
// CI) actually wants to see in one place.
//
// Run with: npm run test:unit  (or: node test/run-unit-tests.mjs)
// ===================================================================
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith(".test.mjs"))
  .sort();

if (files.length === 0) {
  console.error("No test/*.test.mjs files found.");
  process.exit(1);
}

let totalPass = 0;
let totalFail = 0;
let filesFailed = 0;
const failedFiles = [];

// Some tests import .ts/.mts Netlify Functions/Edge Functions source
// directly (e.g. `import("../netlify/edge-functions/preview-noindex.ts")`)
// to test the real deployed code. Node has no built-in TypeScript
// support on the Node 20 baseline this project targets, so every child
// process is launched with tsx's ESM loader registered — it strips types
// transparently and is a no-op for plain .mjs files.
const TSX_ESM_LOADER = fileURLToPath(import.meta.resolve("tsx/esm"));

for (const file of files) {
  const fullPath = path.join(__dirname, file);
  const result = spawnSync(process.execPath, ["--import", TSX_ESM_LOADER, fullPath], { encoding: "utf8" });
  const out = (result.stdout || "") + (result.stderr || "");
  const pass = (out.match(/^ok - /gm) || []).length;
  const fail = (out.match(/^NOT OK - /gm) || []).length;
  totalPass += pass;
  totalFail += fail;
  const ok = result.status === 0 && fail === 0;
  if (!ok) {
    filesFailed++;
    failedFiles.push(file);
    console.log(`\n=== ${file} (FAILED, exit ${result.status}) ===`);
    console.log(out.trim());
  } else {
    console.log(`${file}: ${pass} passed`);
  }
}

console.log("\n---------------------------------------------");
console.log(`Files run: ${files.length} (${filesFailed} failed)`);
console.log(`Tests: ${totalPass} passed, ${totalFail} failed`);
if (failedFiles.length) {
  console.log(`Failed files: ${failedFiles.join(", ")}`);
}

process.exit(totalFail > 0 || filesFailed > 0 ? 1 : 0);

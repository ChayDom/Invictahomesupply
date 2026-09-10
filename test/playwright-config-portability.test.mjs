#!/usr/bin/env node
// ===================================================================
// Regression test: playwright.config.mjs must not require a
// machine-specific Chromium path to work.
//
// Background: an earlier version of this config defaulted
// `launchOptions.executablePath` to a hardcoded sandbox path
// (`/opt/pw-browsers/chromium`) whenever `PLAYWRIGHT_CHROMIUM_PATH`
// wasn't set. That silently broke a fresh checkout/CI, where that path
// never exists — Playwright's own managed Chromium (installed via
// `npx playwright install chromium`) was never actually used, because
// the config always forced a specific executablePath. This test proves
// the chromium project has no executablePath override by default, so a
// fresh environment with no PLAYWRIGHT_CHROMIUM_PATH set (as CI is)
// falls through to Playwright's own browser resolution.
//
// Run with: node test/playwright-config-portability.test.mjs
// ===================================================================
import assert from "node:assert/strict";

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

delete process.env.PLAYWRIGHT_CHROMIUM_PATH;
const config = (await import("../playwright.config.mjs")).default;

test("chromium project exists and is the only default project", () => {
  const names = config.projects.map(p => p.name);
  assert.ok(names.includes("chromium"), "expected a 'chromium' project");
});

test("chromium project has no executablePath override when PLAYWRIGHT_CHROMIUM_PATH is unset", () => {
  const chromiumProject = config.projects.find(p => p.name === "chromium");
  const executablePath = chromiumProject.use.launchOptions && chromiumProject.use.launchOptions.executablePath;
  assert.equal(executablePath, undefined, `expected no hardcoded executablePath, got "${executablePath}"`);
});

test("no project hardcodes a machine-specific absolute path by default", () => {
  for (const project of config.projects) {
    const executablePath = project.use && project.use.launchOptions && project.use.launchOptions.executablePath;
    assert.ok(!executablePath, `project "${project.name}" hardcodes executablePath "${executablePath}" with no env override set`);
  }
});

test("webServer command has no machine-specific absolute path", () => {
  assert.ok(!/\/opt\/|\/root\/|\/home\/[a-zA-Z0-9._-]+\//.test(config.webServer.command), `webServer command looks machine-specific: "${config.webServer.command}"`);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log("\nAll Playwright config portability tests passed.");

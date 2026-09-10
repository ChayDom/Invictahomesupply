// ===================================================================
// Playwright config for the local, network-mocked E2E suite.
//
// Chromium is the release-blocking browser and uses the sandbox/CI's
// pre-installed executable directly (PLAYWRIGHT_CHROMIUM_PATH, falling
// back to the common pre-installed path) rather than depending on
// Playwright's own browser download — see docs/LOCAL_DEVELOPMENT.md for
// why (`playwright install` is unnecessary and, in some sandboxes,
// blocked/unneeded entirely).
//
// Firefox and WebKit are configured as optional projects, NOT part of
// the default `npm run test:e2e` run — they require their own browser
// binaries (`npx playwright install firefox webkit`), which are not
// guaranteed to be present in every environment this repo is developed
// in. Run them explicitly with `npm run test:e2e:firefox` /
// `npm run test:e2e:webkit` once those browsers are installed.
// ===================================================================
import { defineConfig, devices } from "@playwright/test";

const CHROMIUM_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || "/opt/pw-browsers/chromium";
const PORT = Number(process.env.E2E_PORT || 8099);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./test/e2e",
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { open: "never", outputFolder: "test/e2e/report" }]],
  outputDir: "test/e2e/test-results",
  use: {
    baseURL: BASE_URL,
    // Traces/screenshots only on failure/retry — never on a passing run,
    // so CI artifacts stay small and never accidentally capture a
    // passing page that happened to have sensitive-looking mock data.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: `python3 -m http.server ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 15000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { executablePath: CHROMIUM_PATH },
      },
    },
    // Optional, not run by default — see header comment.
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
});

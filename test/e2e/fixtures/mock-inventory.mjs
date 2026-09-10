// ===================================================================
// Reusable /api/inventory network interception for Playwright specs.
// Every E2E test that needs product data calls mockInventory(page, ...)
// instead of hitting a real Netlify Function/Airtable — no external
// network access, no live records, ever.
// ===================================================================
import { INVENTORY_FIXTURE } from "./inventory.mjs";

/**
 * Intercepts GET /api/inventory and returns a fixture response.
 * @param {import('@playwright/test').Page} page
 * @param {{ status?: number, body?: object, delayMs?: number, fail?: boolean }} [opts]
 *   - status: HTTP status to return (default 200)
 *   - body: response JSON (default the standard fixture)
 *   - delayMs: artificial delay before responding (for slow/loading-state tests)
 *   - fail: if true, aborts the request entirely (simulates a network failure)
 */
export async function mockInventory(page, opts = {}) {
  const { status = 200, body = INVENTORY_FIXTURE, delayMs = 0, fail = false } = opts;
  await page.route("**/api/inventory", async (route) => {
    if (fail) {
      await route.abort("failed");
      return;
    }
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

/** Intercepts a Netlify Forms POST ("/") and records the encoded body without ever sending it anywhere real. */
export async function mockFormSubmit(page) {
  const submissions = [];
  await page.route("**/", async (route, request) => {
    if (request.method() === "POST") {
      const body = request.postData() || "";
      const params = new URLSearchParams(body);
      submissions.push(Object.fromEntries(params.entries()));
      await route.fulfill({ status: 200, contentType: "text/plain", body: "ok" });
      return;
    }
    await route.continue();
  });
  return submissions;
}

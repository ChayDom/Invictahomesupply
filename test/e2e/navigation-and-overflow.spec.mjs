// ===================================================================
// E2E: header navigation, mobile nav Escape behavior, internal link
// health, and horizontal-overflow sweeps across the public pages at
// every required width.
// ===================================================================
import { test, expect } from "@playwright/test";
import { mockInventory } from "./fixtures/mock-inventory.mjs";

const PUBLIC_PAGES = ["/index.html", "/shop.html", "/about.html", "/contact.html"];
const OVERFLOW_WIDTHS = [320, 390, 880, 881, 1024, 1440];

test.describe("Header navigation", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  test("32. the mobile nav opens via the hamburger, and Escape closes it and returns focus to the toggle", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/index.html");
    const toggle = page.locator(".menu-toggle");
    await toggle.click();
    await expect(page.locator("nav.primary-nav")).toHaveClass(/open/);
    await page.keyboard.press("Escape");
    await expect(page.locator("nav.primary-nav")).not.toHaveClass(/open/);
    await expect(toggle).toBeFocused();
  });

  test("33. every header nav link resolves without a 404", async ({ page }) => {
    await page.goto("/index.html");
    const hrefs = await page.locator("nav.primary-nav a").evaluateAll((els) => els.map((el) => el.getAttribute("href")));
    for (const href of hrefs) {
      if (!href || href.startsWith("#")) continue;
      let res = await page.request.get(href);
      // netlify.toml rewrites the extensionless "/shop" to shop.html (status
      // 200, URL unchanged) — a Netlify-only rule this suite's plain
      // `python3 -m http.server` doesn't implement. Falling back to the
      // literal .html file confirms the link's real target exists without
      // requiring a full Netlify Dev server for this local E2E run.
      if (res.status() === 404 && !href.includes(".") && !href.startsWith("http")) {
        res = await page.request.get(`${href}.html`);
      }
      expect(res.status(), `expected ${href} to not 404`).toBeLessThan(400);
    }
  });
});

test.describe("No horizontal overflow", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  for (const url of PUBLIC_PAGES) {
    for (const width of OVERFLOW_WIDTHS) {
      test(`30. ${url} has no horizontal overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url);
        await page.waitForLoadState("networkidle");
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        expect(overflow, `${url} overflows horizontally at ${width}px`).toBe(false);
      });
    }
  }
});

test.describe("Local asset health", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  test("29. every local asset request on the homepage returns successfully", async ({ page }) => {
    const failed = [];
    page.on("requestfailed", (req) => {
      if (!req.url().includes("fonts.googleapis.com") && !req.url().includes("fonts.gstatic.com")) failed.push(req.url());
    });
    const badStatus = [];
    page.on("response", (res) => {
      const url = res.url();
      if ((url.includes("/assets/") || url.endsWith(".css") || url.endsWith(".js")) && res.status() >= 400) {
        badStatus.push(`${res.status()} ${url}`);
      }
    });
    await page.goto("/index.html");
    await page.waitForLoadState("networkidle");
    expect(failed, "unexpected failed local requests").toEqual([]);
    expect(badStatus, "unexpected 4xx/5xx on local assets").toEqual([]);
  });
});

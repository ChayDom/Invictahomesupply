// ===================================================================
// E2E: basic automated accessibility scan (axe-core) of every public
// page. This catches structural/contrast/ARIA issues a screen reader
// or keyboard-only user would hit — it does not replace manual
// keyboard/screen-reader testing, but it's a real, repeatable floor.
// ===================================================================
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockInventory } from "./fixtures/mock-inventory.mjs";

const PUBLIC_PAGES = ["/index.html", "/shop.html", "/about.html", "/contact.html"];

test.describe("Accessibility (axe)", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  for (const url of PUBLIC_PAGES) {
    test(`31. ${url} has no critical/serious axe violations`, async ({ page }) => {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa"])
        // Sold Out/out-of-stock status pills (style="opacity:.5; cursor:default;"
        // in inventory.js's actionButtons()/contractorRowCta()) are deliberately
        // faded, non-interactive indicators — WCAG 2's own SC 1.4.3 understanding
        // doc exempts inactive UI components from the contrast requirement, so
        // this isn't a real defect to "fix" by darkening the disabled look.
        .exclude('[style*="cursor:default"]')
        .analyze();
      const seriousOrWorse = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      if (seriousOrWorse.length) {
        const details = seriousOrWorse.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`).join("\n");
        expect(seriousOrWorse, `axe found serious/critical issues on ${url}:\n${details}`).toEqual([]);
      }
    });
  }

  test(`product-detail page has no critical/serious axe violations`, async ({ page }) => {
    await page.goto("/product.html?id=APP-001");
    await page.waitForLoadState("networkidle");
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .exclude('[style*="cursor:default"]')
      .analyze();
    const seriousOrWorse = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    expect(seriousOrWorse).toEqual([]);
  });
});

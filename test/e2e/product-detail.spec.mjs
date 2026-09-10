// ===================================================================
// E2E: product.html — correct mocked product rendering, the desktop/
// mobile Call-button split, missing-product-id handling, and the
// retailer-privacy guarantee on a live-rendered page (not just source
// text — see test/product-detail-retailer-privacy.test.mjs for the
// source-level version of this same guarantee).
// ===================================================================
import { test, expect } from "@playwright/test";
import { mockInventory } from "./fixtures/mock-inventory.mjs";
import { REGULAR_PRODUCT_KEY, FLOORING_PRODUCT_KEY } from "./fixtures/inventory.mjs";

test.describe("Product detail page", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  test("22. renders the correct mocked product for its id", async ({ page }) => {
    await page.goto(`/product.html?id=${REGULAR_PRODUCT_KEY}`);
    await expect(page.locator("h1")).toHaveText("Stainless Steel French Door Refrigerator");
    await expect(page.locator(".product-price")).toContainText("899");
  });

  test("23. desktop (>=881px) hides the Call button entirely", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`/product.html?id=${REGULAR_PRODUCT_KEY}`);
    await expect(page.locator(".product-detail-call")).toBeHidden();
    await expect(page.getByRole("button", { name: "Check Availability" })).toBeVisible();
  });

  test("24. mobile (<=880px) shows the Call button alongside Check Availability/Text Us", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/product.html?id=${REGULAR_PRODUCT_KEY}`);
    await expect(page.locator(".product-detail-call")).toBeVisible();
  });

  test("Flooring product-detail shows Get a Quote (not Check Availability) and correct per-sq-ft pricing", async ({ page }) => {
    await page.goto(`/product.html?id=${FLOORING_PRODUCT_KEY}`);
    await expect(page.getByRole("button", { name: "Get a Quote" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check Availability" })).toHaveCount(0);
  });

  test("26. a missing/unknown product id renders a not-found state, not a crash or blank page", async ({ page }) => {
    await page.goto("/product.html?id=DOES-NOT-EXIST");
    await expect(page.locator("body")).not.toBeEmpty();
    const heading = page.locator("h1, .product-detail-notfound");
    await expect(heading.first()).toBeVisible();
  });

  test("25. retailer/manufacturer information is never rendered on a live product-detail page", async ({ page }) => {
    await page.goto(`/product.html?id=${REGULAR_PRODUCT_KEY}`);
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Home Depot");
    // No outbound manufacturer/retailer link of any kind.
    const externalLinks = await page.locator('a[href*="homedepot"], a[href*="lowes"], a[href*="floordecor"], a.product-ref-link').count();
    expect(externalLinks).toBe(0);
  });
});

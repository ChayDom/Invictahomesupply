// ===================================================================
// E2E: shop.html — inventory loading, category browsing, search, sort,
// filters, their combinations, the mobile Filters drawer, and the
// Card View / Contractor View toggle. All network calls are mocked
// (see fixtures/mock-inventory.mjs) — no live Airtable/Netlify access.
// ===================================================================
import { test, expect } from "@playwright/test";
import { mockInventory } from "./fixtures/mock-inventory.mjs";

test.describe("Shop page", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  test("1. homepage loads mocked inventory and renders product cards", async ({ page }) => {
    await page.goto("/index.html");
    await expect(page.locator(".product-card").first()).toBeVisible();
    // "New This Week" grid on the homepage shares the same fixture data.
    await expect(page.getByText("Stainless Steel French Door Refrigerator")).toBeVisible();
  });

  test("shop.html loads and renders every fixture product in the All Products view", async ({ page }) => {
    await page.goto("/shop.html");
    await expect(page.locator(".product-card")).toHaveCount(6);
  });

  test("2. Browse Categories opens and selecting a category filters results", async ({ page }) => {
    await page.goto("/shop.html");
    await page.click("#browse-categories-btn");
    await expect(page.locator("#category-browser-overlay")).toBeVisible();
    await page.click('.category-browser-item[data-filter="Flooring"]');
    await expect(page.locator("#category-browser-overlay")).toBeHidden();
    await expect(page.locator(".product-card")).toHaveCount(3);
    // Scoped to the Card View grid — the same product name also appears in
    // the (hidden) Contractor View table/cards, and an unscoped getByText
    // would hit all three and fail Playwright's strict-mode uniqueness check.
    await expect(page.locator("#catalog-grid").getByText("Legacy Oak Luxury Vinyl Plank")).toBeVisible();
  });

  test("3. the selected category stays visibly identified outside the category panel", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    await expect(page.locator('.filter-btn[data-filter="Flooring"]')).toHaveClass(/active/);
  });

  test("4. search filters results by product name, case-insensitively", async ({ page }) => {
    await page.goto("/shop.html");
    await page.fill("#search-input", "DRILL");
    await expect(page.locator(".product-card")).toHaveCount(1);
    await expect(page.getByText("Cordless Drill Kit")).toBeVisible();
  });

  test("search: clearing the query restores the full result set", async ({ page }) => {
    await page.goto("/shop.html");
    await page.fill("#search-input", "drill");
    await expect(page.locator(".product-card")).toHaveCount(1);
    await page.fill("#search-input", "");
    await expect(page.locator(".product-card")).toHaveCount(6);
  });

  test("search: a query with no matches renders the empty state, not stale results", async ({ page }) => {
    await page.goto("/shop.html");
    await page.fill("#search-input", "nonexistent-product-xyz");
    await expect(page.locator(".product-card")).toHaveCount(0);
    await expect(page.locator("#catalog-grid")).toContainText(/no matching items/i);
  });

  test("5. sort changes the rendered order of results", async ({ page }) => {
    await page.goto("/shop.html?cat=Appliances");
    await page.selectOption("#sort-select", "price-asc");
    const names = await page.locator(".product-card h4").allTextContents();
    expect(names[0]).toContain("Gas Range"); // $649, cheaper than the $899 fridge
  });

  test("6. a Brand filter narrows results to that brand", async ({ page }) => {
    await page.goto("/shop.html");
    await page.selectOption("#brand-filter", "LG");
    await expect(page.locator(".product-card")).toHaveCount(1);
    await expect(page.getByText("Gas Range with Convection Oven")).toBeVisible();
  });

  test("7. search + category + filter combination narrows correctly together", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    await page.fill("#search-input", "legacy");
    await page.selectOption("#brand-filter", "Legacy");
    await expect(page.locator(".product-card")).toHaveCount(2);
  });

  test("filters: Clear all resets search, category-scoped brand/type filters", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    await page.selectOption("#brand-filter", "Legacy");
    await expect(page.locator(".product-card")).toHaveCount(2);
    await page.click("#clear-all-filters-btn");
    await expect(page.locator(".product-card")).toHaveCount(3);
  });

  test("8. mobile Filters drawer opens, an applied filter narrows results, and closing works", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/shop.html?cat=Flooring");
    await page.click("#mobile-filters-btn");
    await expect(page.locator("#shop-sidebar")).toHaveClass(/open/);
    await page.selectOption("#brand-filter", "Legacy");
    await page.click("#sidebar-apply-btn-mobile");
    // The drawer is a fixed, translateX-off-screen panel (see styles.css's
    // .shop-sidebar mobile rules) rather than display:none/[hidden], so it
    // still has a bounding box and reads as "visible" to Playwright even
    // while closed — the "open" class is the real open/closed signal.
    await expect(page.locator("#shop-sidebar")).not.toHaveClass(/open/);
    await expect(page.locator(".product-card")).toHaveCount(2);
  });

  test("10. Card View / Contractor View toggle switches the rendered view for Flooring", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    await expect(page.locator("#catalog-grid")).toBeVisible();
    await page.click('[data-view="contractor"]');
    await expect(page.locator("#contractor-view")).toBeVisible();
    await expect(page.locator("#catalog-grid")).toBeHidden();
  });

  test("21. Back/Forward browser navigation restores the selected category", async ({ page }) => {
    await page.goto("/shop.html");
    await page.click('.filter-btn[data-filter="Flooring"]');
    await expect(page.locator(".product-card")).toHaveCount(3);
    await page.click('.filter-btn[data-filter="Appliances"]');
    await expect(page.locator(".product-card")).toHaveCount(2);
    await page.goBack();
    await expect(page.locator(".product-card")).toHaveCount(3);
    await page.goForward();
    await expect(page.locator(".product-card")).toHaveCount(2);
  });

  test("25. retailer/manufacturer names never render anywhere on the shop page", async ({ page }) => {
    await page.goto("/shop.html");
    const bodyText = await page.locator("body").innerText();
    for (const retailer of ["Home Depot", "Lowes", "Floor & Decor", "Amazon"]) {
      expect(bodyText).not.toContain(retailer);
    }
  });

  test("27. an empty inventory response renders the empty-catalog state, not an error or a crash", async ({ page }) => {
    await mockInventory(page, { body: { records: [] } });
    await page.goto("/shop.html");
    await expect(page.locator(".product-card")).toHaveCount(0);
    await expect(page.locator("#catalog-grid")).toBeVisible();
  });

  test("28. an API failure (500) renders an honest error state, not a blank/broken page", async ({ page }) => {
    await mockInventory(page, { status: 500 });
    await page.goto("/shop.html");
    await expect(page.locator(".product-card")).toHaveCount(0);
    await expect(page.locator("#catalog-grid")).toBeVisible();
  });
});

test.describe("Flooring calculator (E2E)", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  test("9. the sidebar quick-calculator computes the correct sq-ft-plus-waste result", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    await page.fill("#flooring-calc-sqft", "100");
    await page.click("#flooring-calc-btn");
    await expect(page.locator("#flooring-calc-result")).toContainText("110");
  });

  test("the full calculator modal computes length x width plus 10% waste for a single room", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    await page.click("#flooring-calc-full-link");
    await expect(page.locator("#calc-modal-overlay")).toBeVisible();
    await page.fill('.calc-room[data-room-id] [data-dim="length-ft"]', "10");
    await page.fill('.calc-room[data-room-id] [data-dim="width-ft"]', "12");
    await expect(page.locator("#calc-total-area")).toContainText("120");
    await expect(page.locator("#calc-recommended")).toContainText("132");
  });
});

// ===================================================================
// E2E: Check Availability / Get a Quote modals across Card View,
// Contractor View, and product-detail pages — desktop vs. mobile CTA
// rules, form field population, validation, focus management, and the
// static Netlify Forms field encoding (intercepted, never actually
// submitted anywhere real).
// ===================================================================
import { test, expect } from "@playwright/test";
import { mockInventory, mockFormSubmit } from "./fixtures/mock-inventory.mjs";

test.describe("Check Availability / Get a Quote — Card View", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  test("11. desktop: a regular product opens the Check Availability modal, and only that primary action shows", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/shop.html?cat=Appliances");
    const card = page.locator(".product-card").filter({ hasText: "Stainless Steel French Door Refrigerator" });
    await expect(card.getByRole("button", { name: "Check Availability" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Text Us" })).toBeHidden();
    await card.getByRole("button", { name: "Check Availability" }).click();
    await expect(page.locator("#availability-modal-overlay")).toBeVisible();
    await expect(page.locator("#availability-product-name")).toHaveText("Stainless Steel French Door Refrigerator");
  });

  test("12. mobile: a regular product shows Check Availability + Text Us", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/shop.html?cat=Appliances");
    const card = page.locator(".product-card").filter({ hasText: "Stainless Steel French Door Refrigerator" });
    await expect(card.getByRole("button", { name: "Check Availability" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Text Us" })).toBeVisible();
  });

  test("13. desktop: an eligible Flooring product shows Get a Quote only", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/shop.html?cat=Flooring");
    const card = page.locator(".product-card").filter({ hasText: "Legacy Oak Luxury Vinyl Plank" });
    await expect(card.getByRole("button", { name: "Get a Quote" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Check Availability" })).toHaveCount(0);
    await expect(card.getByRole("link", { name: "Text Us" })).toBeHidden();
  });

  test("14. mobile: an eligible Flooring product shows Get a Quote + Text Us", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/shop.html?cat=Flooring");
    // Below 700px, Flooring forces the compact Contractor-View cards
    // (#contractor-cards) instead of the regular .product-card tile grid —
    // see the documented @media (max-width: 700px) block in styles.css
    // (body.is-flooring-view #catalog-grid { display: none !important }).
    // The regular .product-card grid genuinely isn't reachable here.
    const card = page.locator("#contractor-cards .contractor-card").filter({ hasText: "Legacy Oak Luxury Vinyl Plank" });
    await expect(card.getByRole("button", { name: "Get a Quote" })).toBeVisible();
    await expect(card.getByRole("link", { name: "Text Us" })).toBeVisible();
  });

  test("a non-eligible Flooring subcategory (Underlayment) still gets Check Availability, not Get a Quote", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    const card = page.locator(".product-card").filter({ hasText: "Premium Underlayment Roll" });
    await expect(card.getByRole("button", { name: "Check Availability" })).toBeVisible();
  });
});

test.describe("Contractor View eligibility", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
  });

  test("15. Contractor View follows the same Get a Quote / Check Availability eligibility rules as Card View", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    await page.click('[data-view="contractor"]');
    const eligibleRow = page.locator("#contractor-table-body tr", { hasText: "Legacy Oak Luxury Vinyl Plank" });
    await expect(eligibleRow.getByRole("button", { name: "Get a Quote" })).toBeVisible();
    const nonEligibleRow = page.locator("#contractor-table-body tr", { hasText: "Premium Underlayment Roll" });
    await expect(nonEligibleRow.getByRole("button", { name: "Check Availability" })).toBeVisible();
  });
});

test.describe("Availability modal", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
    await page.goto("/shop.html?cat=Appliances");
  });

  test("16. product name and price are populated when the modal opens", async ({ page }) => {
    await page.locator(".product-card").filter({ hasText: "Gas Range" }).getByRole("button", { name: "Check Availability" }).click();
    await expect(page.locator("#availability-product-name")).toHaveText("Gas Range with Convection Oven");
    await expect(page.locator("#availability-product-price")).toContainText("649");
  });

  test("18. required-field validation blocks submission when Name/Phone are empty", async ({ page }) => {
    await page.locator(".product-card").first().getByRole("button", { name: "Check Availability" }).click();
    const nameInput = page.locator('#availability-form [name="name"]');
    await expect(nameInput).toHaveAttribute("required", "");
    const phoneInput = page.locator('#availability-form [name="phone"]');
    await expect(phoneInput).toHaveAttribute("required", "");
  });

  test("19. the optional message field accepts free text and is submitted", async ({ page }) => {
    const submissions = await mockFormSubmit(page);
    await page.locator(".product-card").first().getByRole("button", { name: "Check Availability" }).click();
    await page.fill('#availability-form [name="name"]', "Jane Doe");
    await page.fill('#availability-form [name="phone"]', "2145551212");
    await page.fill('#availability-form [name="message"]', "Do you have 2 units?");
    await page.click("#availability-submit-btn");
    await expect(page.locator("#availability-modal-success-view")).toBeVisible();
    expect(submissions.length).toBe(1);
    expect(submissions[0]["form-name"]).toBe("availability-request");
    expect(submissions[0].message).toBe("Do you have 2 units?");
    expect(submissions[0].name).toBe("Jane Doe");
  });

  test("20. Escape closes the modal and focus returns to the button that opened it", async ({ page }) => {
    const trigger = page.locator(".product-card").first().getByRole("button", { name: "Check Availability" });
    await trigger.click();
    await expect(page.locator("#availability-modal-overlay")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#availability-modal-overlay")).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("20b. Tab is trapped inside the open modal", async ({ page }) => {
    await page.locator(".product-card").first().getByRole("button", { name: "Check Availability" }).click();
    const closeBtn = page.locator("#availability-modal-close");
    await closeBtn.focus();
    await page.keyboard.press("Shift+Tab");
    const submitBtn = page.locator("#availability-submit-btn");
    await expect(submitBtn).toBeFocused();
  });
});

test.describe("Quote modal", () => {
  test.beforeEach(async ({ page }) => {
    await mockInventory(page);
    await page.goto("/shop.html?cat=Flooring");
  });

  test("17. product name and flooring per-sq-ft/box prices are populated", async ({ page }) => {
    await page.locator(".product-card").filter({ hasText: "Legacy Oak Luxury Vinyl Plank" }).getByRole("button", { name: "Get a Quote" }).click();
    await expect(page.locator("#quote-product-name")).toHaveText("Legacy Oak Luxury Vinyl Plank");
    await expect(page.locator("#quote-product-price")).toContainText("2.49");
    await expect(page.locator("#quote-product-price")).toContainText("42.11");
  });

  test("19b. the optional notes field is submitted with the encoded form data", async ({ page }) => {
    const submissions = await mockFormSubmit(page);
    await page.locator(".product-card").filter({ hasText: "Legacy Oak" }).getByRole("button", { name: "Get a Quote" }).click();
    await page.fill('#quote-form [name="sqft-needed"]', "150");
    await page.fill('#quote-form [name="name"]', "Contractor Bob");
    await page.fill('#quote-form [name="phone"]', "2145559999");
    await page.fill('#quote-form [name="notes"]', "Need it by Friday");
    await page.click("#quote-submit-btn");
    await expect(page.locator("#quote-modal-success-view")).toBeVisible();
    expect(submissions[0]["form-name"]).toBe("quote-request");
    expect(submissions[0].notes).toBe("Need it by Friday");
  });
});

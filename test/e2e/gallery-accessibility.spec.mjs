import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mockInventory } from "./fixtures/mock-inventory.mjs";
import { FLOORING_SHOPPING_FIXTURE as fixture } from "./fixtures/flooring-shopping.mjs";

const disclaimer = "Material estimate only. Taxes and delivery fees are not included. Final stock and pricing require confirmation.";
async function openGallery(page, url) {
  const body = structuredClone(fixture);
  body.records[2].fields.Photos = [
    { url: "https://images.example.test/images/mock-one.png" },
    { url: "https://images.example.test/images/mock-two.png" }
  ];
  await mockInventory(page, { body });
  await page.route("**/images/mock-*.png", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="green"/></svg>' }));
  await page.goto(url);
}
async function checkControls(page, gallery) {
  const buttons = gallery.locator("button.thumb");
  await expect(buttons).toHaveCount(2);
  await expect(gallery.locator('img[role="button"], img[tabindex]')).toHaveCount(0);
  await buttons.nth(1).click();
  await expect(gallery.locator("[data-main-photo]")).toHaveAttribute("src", /mock-two/);
  await expect(buttons.nth(1)).toHaveAttribute("aria-current", "true");
  await buttons.first().focus();
  await page.keyboard.press("Enter");
  await expect(gallery.locator("[data-main-photo]")).toHaveAttribute("src", /mock-one/);
  await expect(buttons.first()).toHaveAttribute("aria-current", "true");
  await expect(buttons.nth(1)).not.toHaveAttribute("aria-current", "true");
  await page.keyboard.press("Tab");
  await expect(buttons.nth(1)).toBeFocused();
  await page.keyboard.press("Space");
  await expect(gallery.locator("[data-main-photo]")).toHaveAttribute("src", /mock-two/);
  await expect(buttons.nth(1)).toBeFocused();
  await expect(buttons.nth(1)).toHaveCSS("outline-style", "solid");
  const bounds = await buttons.nth(1).boundingBox();
  expect(bounds.width).toBe(40); expect(bounds.height).toBe(40);
}
for (const width of [390, 1440]) test(`detail gallery: semantic buttons, keyboard, accessibility and copy at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await openGallery(page, "/product.html?id=LEG-HD-001157");
  await checkControls(page, page.locator(".product-detail-media"));
  await page.fill("#project-sqft", "1000");
  await expect(page.locator(".project-estimate-note")).toHaveText(disclaimer);
  await expect(page.locator(".calc-disclaimer")).toHaveText(disclaimer);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations.filter(v => v.id === "presentation-role-conflict" || ["critical", "serious"].includes(v.impact))).toEqual([]);
});
test("desktop shop thumbnails retain native keyboard behavior and accessibility", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openGallery(page, "/shop.html?cat=Flooring");
  await checkControls(page, page.locator(".product-card").filter({ has: page.locator("button.thumb") }).first());
  await expect(page.locator(".calc-disclaimer")).toHaveText(disclaimer);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations.filter(v => v.id === "presentation-role-conflict" || ["critical", "serious"].includes(v.impact))).toEqual([]);
});

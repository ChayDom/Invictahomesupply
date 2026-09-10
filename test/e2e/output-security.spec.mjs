// ===================================================================
// Adversarial output-security regression tests.
//
// Airtable-derived text (and the shop page's URL-reflected search query)
// used to be interpolated into rendered HTML with no escaping at all —
// see the "CORRECTION" note in test/inventory-api-resilience.test.mjs.
// This file proves the fix at the actual browser/DOM level: a poisoned
// fixture record (never real Airtable/customer data) carries known XSS
// payloads through every rendering path a real compromised record or
// pasted product description could reach, and asserts none of them ever
// execute, inject a live element/handler, or produce an unsafe href/src.
//
// All network calls are mocked (mockInventory/mockFormSubmit) — nothing
// here ever contacts real Airtable or submits a real form anywhere.
// ===================================================================
import { test, expect } from "@playwright/test";
import { mockInventory, mockFormSubmit } from "./fixtures/mock-inventory.mjs";

const SCRIPT_TAG = "<script>window.__xss=1</script>";
const IMG_ONERROR = '<img src=x onerror="window.__xss=1">';
const ATTR_BREAKOUT = '" onmouseover="window.__xss=1';
const UNICODE_NAME = `Legacy Oak & "Rustic" 'Vintage' <Plank> — 8mm café résumé`;

const POISONED_FIXTURE = {
  records: [
    {
      id: "recXSS001",
      fields: {
        "Name": `${SCRIPT_TAG}${IMG_ONERROR}${ATTR_BREAKOUT}`,
        "Category": "Tools",
        "Subcategory": `Power Tools${ATTR_BREAKOUT}`,
        "Brand": `DeWalt${IMG_ONERROR}`,
        "Model": `<b>Model</b>`,
        "Product Key": "XSS-001",
        "Price": 99,
        "Quantity Available": 5,
        "Details": `Free text with ${SCRIPT_TAG}`,
        "Highlights": `Line one ${IMG_ONERROR}\nLine two ${ATTR_BREAKOUT}`,
        "Card Spec 1": `${SCRIPT_TAG}`,
        "Photos": [
          { url: "javascript:alert(1)", thumbnails: { small: { url: "javascript:alert(1)" }, large: { url: "javascript:alert(1)" } } },
        ],
      },
    },
    {
      id: "recXSSDATA002",
      fields: {
        "Name": "Data URL Item",
        "Category": "Tools",
        "Product Key": "XSS-002",
        "Price": 49,
        "Quantity Available": 5,
        "Reference Image URL": "data:text/html,<script>alert(1)</script>",
      },
    },
    {
      id: "recLEGIT003",
      fields: {
        "Name": UNICODE_NAME,
        "Category": "Flooring",
        "Subcategory": "Luxury Vinyl Plank",
        "Brand": "Legacy",
        "Product Key": "LEGIT-003",
        "Price": 2.99,
        "Quantity Available": 20,
        "Available Sq Ft": 480,
        "Sq Ft Per Unit": 24,
      },
    },
  ],
};

test.describe("Output security: adversarial Airtable content", () => {
  test.beforeEach(async ({ page }) => {
    // Flag flipped by an executed payload — checked after every render.
    await page.addInitScript(() => { window.__xss = 0; });
    await mockInventory(page, { body: POISONED_FIXTURE });
  });

  test("no injected <script> or event-handler payload executes when the shop grid renders", async ({ page }) => {
    await page.goto("/shop.html");
    await page.waitForLoadState("networkidle");
    // Give any injected onerror/onload a moment to fire, if it were live.
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss)).toBe(0);
  });

  test("the malicious name renders as literal, visible text — not markup", async ({ page }) => {
    await page.goto("/shop.html");
    const card = page.locator(".product-card").filter({ has: page.locator('[data-availability-id="recXSS001"], [data-quote-id="recXSS001"]') });
    const heading = card.locator("h4");
    // No live <script>/<img> child was actually created from the payload.
    await expect(heading.locator("script")).toHaveCount(0);
    await expect(heading.locator("img")).toHaveCount(0);
    // The raw text is preserved (not stripped/mangled) and shown as text.
    const text = await heading.textContent();
    expect(text).toContain("<script>window.__xss=1</script>");
    expect(text).toContain('<img src=x onerror="window.__xss=1">');
  });

  test("no unsafe href/src (javascript:/data:/vbscript:) is ever rendered for the poisoned or data-URL item", async ({ page }) => {
    await page.goto("/shop.html");
    await page.waitForLoadState("networkidle");
    const unsafe = await page.evaluate(() => {
      const bad = [];
      document.querySelectorAll("a[href], img[src]").forEach(el => {
        const value = el.getAttribute("href") || el.getAttribute("src") || "";
        // javascript:/vbscript: are never legitimate here; a data: URI is
        // only a real risk if it can carry executable/markup content
        // (text/html, and friends) — a plain data:image/* URI (e.g. a
        // static inline logo/favicon already on the page, unrelated to
        // this fixture) is inert and not what this check is for.
        if (/^\s*(javascript|vbscript):/i.test(value)) bad.push(value);
        if (/^\s*data:(?!image\/)/i.test(value)) bad.push(value);
      });
      return bad;
    });
    expect(unsafe, `found unsafe URL(s): ${JSON.stringify(unsafe)}`).toEqual([]);
  });

  test("the attribute-breakout payload cannot inject a live onmouseover handler", async ({ page }) => {
    await page.goto("/shop.html");
    await page.waitForLoadState("networkidle");
    const card = page.locator('[data-category="Tools"]').first();
    await card.hover();
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__xss)).toBe(0);
  });

  test("legitimate Unicode/punctuation-heavy product data still renders correctly, unescaped-looking, on the shop grid", async ({ page }) => {
    await page.goto("/shop.html?cat=Flooring");
    const card = page.locator(".product-card").filter({ hasText: "Legacy Oak" });
    const text = await card.locator("h4").textContent();
    expect(text).toBe(`Legacy Oak & "Rustic" 'Vintage' <Plank> — 8mm café résumé`);
  });

  test("retailer/source information stays hidden even for the poisoned records", async ({ page }) => {
    await page.goto("/shop.html");
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("Home Depot");
    expect(bodyText).not.toContain("Lowes");
  });

  test("product-detail page for the poisoned item: no script executes, title/meta stay valid, name renders as text", async ({ page }) => {
    await page.goto("/product.html?id=XSS-001");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__xss)).toBe(0);

    // document.title/meta content are set via safe DOM APIs (document.title=,
    // setAttribute) — this proves the wild payload doesn't break the tags or
    // leave them containing an unclosed/injected fragment.
    const title = await page.title();
    expect(title).toContain("| Invicta Home Supply");
    const description = await page.locator('meta[name="description"]').getAttribute("content");
    expect(typeof description).toBe("string");

    const heading = page.locator("h1");
    await expect(heading.locator("script")).toHaveCount(0);
    const headingText = await heading.textContent();
    expect(headingText).toContain("<script>window.__xss=1</script>");
  });

  test("product-detail page for the data: URL item never renders an unsafe image src", async ({ page }) => {
    await page.goto("/product.html?id=XSS-002");
    await page.waitForLoadState("networkidle");
    const mainPhoto = page.locator("[data-main-photo]");
    if (await mainPhoto.count()) {
      const src = await mainPhoto.getAttribute("src");
      expect(src || "").not.toMatch(/^data:text\/html/i);
    }
  });

  test("a crafted ?from= back-link cannot become a javascript: URL on the product-detail 'Back to inventory' link", async ({ page }) => {
    await page.goto('/product.html?id=LEGIT-003&from=javascript:alert(1)//shop?');
    await page.waitForLoadState("networkidle");
    const hrefs = await page.locator(".product-detail-back, a:has-text('Back to inventory')").evaluateAll(
      els => els.map(el => el.getAttribute("href"))
    );
    for (const href of hrefs) {
      expect(href || "").not.toMatch(/^javascript:/i);
    }
  });

  test("forms still submit the correct plain-text product name/key for a poisoned item, via intercepted local POST", async ({ page }) => {
    // mockFormSubmit's "**/" route pattern is broad enough to intercept the
    // initial page load/asset requests too — registered only after the
    // page has already loaded (same convention as test/e2e/inquiry.spec.mjs),
    // so it only ever needs to catch the later real POST to "/".
    await page.goto("/shop.html");
    const submissions = await mockFormSubmit(page);
    await page.locator('[data-availability-id="recXSS001"]').click();
    await page.fill('#availability-form [name="name"]', "Jane Doe");
    await page.fill('#availability-form [name="phone"]', "2145551212");
    await page.click("#availability-submit-btn");
    await expect(page.locator("#availability-modal-success-view")).toBeVisible();
    expect(submissions.length).toBe(1);
    // The hidden product-name field is set via .value (a safe DOM property
    // assignment, never innerHTML), so the exact raw name reaches the
    // business unmangled — escaping is a rendering concern only, never a
    // data-integrity one.
    expect(submissions[0]["product-name"]).toBe(`${SCRIPT_TAG}${IMG_ONERROR}${ATTR_BREAKOUT}`);
  });
});

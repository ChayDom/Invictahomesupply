#!/usr/bin/env node
// ===================================================================
// Read-only deployment smoke test.
//
// Targets a REAL deployed site over the network (unlike every other
// test/*.test.mjs and test/e2e/* file, which run entirely offline
// against mocked data) — so it is deliberately conservative:
//
//   - Never runs without an explicit target: SMOKE_BASE_URL must be set.
//     There is no default/production fallback, so a bare `npm run
//     test:smoke` can never accidentally hit a real site.
//   - HTTPS-only, unless the target is an explicit local override
//     (SMOKE_ALLOW_HTTP=1 or a loopback host), so this can't be pointed
//     at a plaintext endpoint by accident.
//   - GET/HEAD only. Never submits a form, subscribes an email, calls a
//     Netlify Function that changes state, or follows a tel:/sms: link.
//   - Requires no credentials and writes nothing anywhere.
//
// Run it with:
//   SMOKE_BASE_URL=https://deploy-preview-123--invicta.netlify.app npm run test:smoke
//   SMOKE_BASE_URL=https://invictahomesupply.com SMOKE_EXPECT_CONTEXT=production npm run test:smoke
// ===================================================================

const BASE_URL = process.env.SMOKE_BASE_URL;
const EXPECT_CONTEXT = process.env.SMOKE_EXPECT_CONTEXT || ""; // "preview" | "production" | ""
const ALLOW_HTTP = process.env.SMOKE_ALLOW_HTTP === "1";

let passed = 0;
let failed = 0;
const failures = [];

function ok(label) {
  passed++;
  console.log(`ok - ${label}`);
}

function notOk(label, detail) {
  failed++;
  failures.push({ label, detail });
  console.log(`NOT OK - ${label}${detail ? ` — ${detail}` : ""}`);
}

async function check(label, fn) {
  try {
    await fn();
    ok(label);
  } catch (err) {
    notOk(label, err && err.message ? err.message : String(err));
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

function isLoopbackHost(hostname) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function fetchGet(path, opts = {}) {
  const url = new URL(path, BASE_URL);
  const res = await fetch(url, { method: opts.method || "GET", redirect: "manual" });
  return res;
}

async function main() {
  if (!BASE_URL) {
    console.error(
      "SMOKE_BASE_URL is not set. Refusing to run — this test never assumes a " +
        "default target (production included). Set it explicitly, e.g.:\n" +
        "  SMOKE_BASE_URL=https://invictahomesupply.com npm run test:smoke"
    );
    process.exit(1);
  }

  let target;
  try {
    target = new URL(BASE_URL);
  } catch {
    console.error(`SMOKE_BASE_URL is not a valid URL: ${BASE_URL}`);
    process.exit(1);
  }

  if (target.protocol !== "https:") {
    const localOverrideOk = ALLOW_HTTP || isLoopbackHost(target.hostname);
    if (!localOverrideOk) {
      console.error(
        `Refusing to run against a non-HTTPS target (${BASE_URL}). ` +
          "Set SMOKE_ALLOW_HTTP=1 to explicitly override for a local/non-TLS target."
      );
      process.exit(1);
    }
  }

  console.log(`Smoke testing ${BASE_URL}${EXPECT_CONTEXT ? ` (expecting context: ${EXPECT_CONTEXT})` : ""}\n`);

  const PAGES = ["/", "/shop.html", "/about.html", "/contact.html"];
  const CRITICAL_ASSETS = ["/styles.css", "/app.js", "/inventory.js"];
  const RETAILER_NAMES = ["Home Depot", "Lowes", "Lowe's", "Floor & Decor", "Amazon"];

  let homepageBody = "";
  let shopBody = "";
  let productPageStatus = null;

  for (const page of PAGES) {
    await check(`${page} returns 200`, async () => {
      const res = await fetchGet(page);
      assert(res.status === 200, `got ${res.status}`);
      const body = await res.text();
      if (page === "/") homepageBody = body;
      if (page === "/shop.html") shopBody = body;
    });
  }

  await check("product page shell (product.html) returns 200", async () => {
    const res = await fetchGet("/product.html");
    productPageStatus = res.status;
    assert(res.status === 200, `got ${res.status}`);
  });

  await check("robots.txt returns 200", async () => {
    const res = await fetchGet("/robots.txt");
    assert(res.status === 200, `got ${res.status}`);
  });

  await check("sitemap.xml returns 200", async () => {
    const res = await fetchGet("/sitemap.xml");
    assert(res.status === 200, `got ${res.status}`);
  });

  for (const asset of CRITICAL_ASSETS) {
    await check(`critical asset ${asset} returns 200`, async () => {
      const res = await fetchGet(asset);
      assert(res.status === 200, `got ${res.status}`);
    });
  }

  await check("/api/inventory responds successfully (contents not printed)", async () => {
    const res = await fetchGet("/api/inventory");
    assert(res.status === 200, `got ${res.status}`);
    const body = await res.text();
    assert(body.length > 0, "empty response body");
    // Deliberately never logs `body` — this only proves the endpoint is up.
  });

  // ---- X-Robots-Tag / indexability, per the preview-noindex edge function ----
  await check("homepage X-Robots-Tag matches its deploy context", async () => {
    const res = await fetchGet("/");
    const header = res.headers.get("x-robots-tag") || "";
    const isNoindex = /noindex/i.test(header);
    if (EXPECT_CONTEXT === "production") {
      assert(!isNoindex, `expected no noindex on production, got X-Robots-Tag: "${header}"`);
    } else if (EXPECT_CONTEXT === "preview") {
      assert(isNoindex, `expected "noindex, nofollow" on preview, got X-Robots-Tag: "${header}"`);
    }
    // With no SMOKE_EXPECT_CONTEXT given, this is informational only — the
    // header presence/absence is reported via the check label passing,
    // but no expectation is asserted either way.
  });

  // ---- Privacy: retailer/source names must never leak to visitors ----
  await check("no retailer/source names leak on the homepage or shop page", async () => {
    for (const retailer of RETAILER_NAMES) {
      assert(!homepageBody.includes(retailer), `found "${retailer}" on homepage`);
      assert(!shopBody.includes(retailer), `found "${retailer}" on shop page`);
    }
  });

  // ---- Static Netlify Forms declarations present (build-time detection) ----
  await check("static Netlify Forms declarations are present (quote-request, availability-request)", async () => {
    assert(shopBody.includes('data-netlify="true"'), "no data-netlify=\"true\" form found");
    assert(shopBody.includes('name="quote-request"'), "quote-request form not found");
    assert(shopBody.includes('name="availability-request"'), "availability-request form not found");
  });

  // ---- Internal link health: every same-origin href found on the homepage ----
  await check("internal links on the homepage resolve without a server error", async () => {
    const hrefs = Array.from(homepageBody.matchAll(/href="([^"]+)"/g))
      .map(m => m[1])
      .filter(href => href && !href.startsWith("#") && !href.startsWith("mailto:") && !href.startsWith("tel:") && !href.startsWith("sms:") && !/^https?:\/\//i.test(href));
    const uniqueHrefs = [...new Set(hrefs)];
    const badLinks = [];
    for (const href of uniqueHrefs) {
      const res = await fetchGet(href);
      if (res.status >= 500) badLinks.push(`${href} -> ${res.status}`);
    }
    assert(badLinks.length === 0, `server errors on: ${badLinks.join(", ")}`);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});

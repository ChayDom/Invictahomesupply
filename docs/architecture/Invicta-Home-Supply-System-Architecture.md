# Invicta Home Supply — system architecture

Repository architecture for the current, already-migrated workbook. Live formulas,
installed triggers and external records require the acceptance test in
[Apps Script refactor and acceptance](../APPS_SCRIPT_WORKBOOK_REFACTOR.md).
No schema migration or automatic production deployment is part of this change.

## 1. Data flow and ownership

Retailer/source sheets → Current Inventory → Product Inventory → Product Catalog
→ formula-driven Website Export → Apps Script → Airtable → Netlify → website.

Website Export also feeds Social Queue → Buffer → Facebook / Instagram.
Sheets owns inventory, merchandising, prices and publishing; Airtable is a mirror.
The repository's Apps Script files are a snapshot, not an automatically deployed project.

## 2. Workbook and Apps Script

### Product Catalog: 29 named columns

The exact A:AC contract and field-by-field acceptance matrix are documented in
the [refactor checklist](../APPS_SCRIPT_WORKBOOK_REFACTOR.md#all-29-catalog-fields).
`CATALOG_HEADERS` in Config.js centralizes these names. Header normalization
trims/collapses whitespace and ignores case; missing/duplicate headers fail before
maintenance writes. Catalog/Inventory/Export readers resolve headers, not old positions.

### Identity and reconciliation

- Retail SKU is editable retailer data.
- Product ID is the current retailer/SKU business identity (HD-, LOW-, WM-).
- Product Key is permanent after initial creation, including legacy LEG-* keys.

Maintenance and legacy repair share one preflight planner. It searches permanent
key, current ID and retailer/SKU; if none match it allows only a unique normalized
retailer + SOURCE ITEM match. Conflicting identities, duplicate keys/IDs, missing
catalog keys and multiple source products claiming one row fail before writes.
Both standard and legacy SKU corrections update the existing row without changing
its key. No fuzzy matching or persisted extra reconciliation key is introduced.

If source key, ID/SKU and title all change together, no reliable link remains.
Resolve that case manually before maintenance; the script cannot distinguish it
from a new product. Names shared by multiple products are never guessed.

### Maintenance and pricing

`runProductCatalogMaintenance()` reads Product Inventory by headers, plans all
updates/additions, acquires a script lock, writes changed fields and audits identities.
Existing public menu/trigger handler names remain. Source refresh and automatic
legacy reconciliation update existing rows only.

New rows explicitly receive source identity, source title, categories and every
available supported source attribute; status starts PENDING. Manual sell price,
comparable price, publish flag and curated image are not copied from another product.
Formatting is copied across the entire new row (including K) without values/formulas.
Sell, box and comparable-price number formats are inherited column-by-column from
the preceding catalog row, or row 2's existing template when the catalog is empty;
no hardcoded currency pattern is introduced. Required non-price numeric formats and
Post/Underlayment/Water Resistance/Enrichment Status validations are applied.

AUTO BOX PRICE is solely the workbook's K2 spill formula. New row writes are split
around that header's resolved column. No Apps Script writes a value or formula in
its spill range, including K2. Formula-only tails do not determine the append row;
partially populated product rows are audited rather than overwritten.

### Enrichment

Only non-legacy blank/PENDING keyed rows with source titles and missing description
or highlights are eligible. Completed content is not reprocessed for missing optional
specs. Permanent keys starting LEG- or LEGACY| are excluded even with PENDING status.
PROCESSING, verified, STANDARD, review, failed and other excluded statuses do not retry.
The manually invoked queueMissingCatalogEnrichment helper shares this same eligibility
gate; it is not a legacy or excluded-status override. No targeted legacy requeue exists
in this snapshot; legacy enrichment requires a separately reviewed manual workflow.
No deleted lock, timestamp or confidence column is required.

The existing Gemini transport/search grounding remains. Customer content is
blank-filled only after EXACT + HIGH + cited results with a description and 3–5
sanitized highlights, each at most eight words. Uncertain results become NEEDS REVIEW.
Confidence remains an API-result gate, not a workbook column.

Supported structured fields include subcategory, unit, case coverage and flooring
thickness, wear layer, underlayment, water resistance and three card specs.
Unknown/invalid optional values remain blank. Current row values are reread before
applying results to retain intervening human edits and reject changed key/SKU.
Notes retain diagnostics and citations. Manual prices and publishing are untouched.

### Website Export and Airtable

Website Export is the user's existing 29-column formula-driven publishing boundary.
Its current Product Inventory ID resolves Product Catalog PRODUCT ID and returns
the catalog's permanent PRODUCT KEY. Apps Script does not replace those formulas.
COMPARABLE RETAIL PRICE occupies the former export hash slot and maps to Airtable
`Was Price`, which inventory.js already consumes.

Airtable continues to upsert by `Product Key`. SKU corrections update the same
record. Existing Date Added/status semantics, eligibility, retry/backoff and
unpublishing (not deleting) remain. Duplicate export or existing Airtable keys
abort before remote writes. Existing sync concurrency is not redesigned in this refactor.

### Social Queue and Buffer

Export reading is header-based. The 19 Social Queue columns intentionally remain
a fixed, order-validated operational contract for existing Buffer handlers:
PRODUCT KEY, PRODUCT NAME, CATEGORY, PRICE, MEDIA URL, MEDIA TYPE, PRODUCT URL,
CONTENT TYPE, HOOK, FACEBOOK CAPTION, INSTAGRAM CAPTION, HASHTAGS, SOCIAL STATUS,
FB BUFFER POST ID, IG BUFFER POST ID, LAST POSTED AT, GENERATED AT, SOURCE HASH, ERROR.

SOURCE HASH remains a legitimate content-change approval safeguard. Media handling,
captions, approval statuses, Buffer IDs and posting history remain unchanged.
Changed export content still requests new copy rather than silently publishing it.

## 3. Netlify architecture

**VERIFIED FROM CODE / CONFIGURATION.**

- **Static frontend:** plain HTML/CSS/JS at the repo root (`index.html`,
  `shop.html`, `about.html`, `contact.html`, `product.html`,
  `subscribe-confirmed.html`, `unsubscribed.html`, `app.js`, `inventory.js`,
  `styles.css`) — no framework, no build step for the site itself.
- **Serverless Functions** (`netlify/functions/`, configured via
  `netlify.toml`'s `[build] functions = "netlify/functions"`):

| Function | Route | Purpose (VERIFIED FROM CODE) |
|---|---|---|
| `inventory.mts` | `GET /api/inventory` | Reads Airtable `Website Products` filtered to `Post to Website = TRUE()`, paginates through all pages, returns JSON. CDN-cached 60s (durable, 5-min stale-while-revalidate); browser cache explicitly disabled (`max-age=0, must-revalidate`) since the client keeps its own 15-minute `localStorage` cache. |
| `subscribe.mts` | `POST /api/subscribe` | Single-opt-in email subscription. Honeypot bot check, per-IP rate limit (8/10min), creates/reactivates an `Inventory Subscribers` record, sends a welcome email (only if `BUSINESS_MAILING_ADDRESS` is configured). Always returns one neutral success message regardless of new/reactivated/already-active, so the response can't reveal which case applied. |
| `confirm-subscription.mts` | `GET /api/confirm-subscription` | **Legacy-only** — activates an old double-opt-in Pending record. Nothing in the current site links to it; kept only so old emails' links don't 404. |
| `unsubscribe.mts` | `GET /api/unsubscribe` | Marks a subscriber Unsubscribed by token. Idempotent — re-clicking an already-used link still redirects to success. |
| `weekly-digest.mts` | scheduled, cron `0 15,16 * * 5` | The real weekly "new inventory" email sender. Fires at both 15:00 and 16:00 UTC every Friday (to cover both sides of the US Central Time DST transition) but only actually sends on whichever invocation is genuinely 10am America/Chicago; the other exits immediately. Additionally gated behind `WEEKLY_DIGEST_ENABLED`. |
| `digest-test.mts` | `POST /api/digest-test` | An isolated preview of the weekly digest — refuses to run in the production deploy context, requires a bearer token (`DIGEST_TEST_TOKEN`), sends only to a fixed `DIGEST_TEST_RECIPIENT`, rate-limited (3/hour/IP), never writes `Last Digest Sent At`. |

Shared helpers (`netlify/functions/_shared/`): `products.mts` (digest
product eligibility query), `subscribers.mts` (subscriber CRUD against
Airtable), `resend.mts` (email sending via Resend + welcome-email template),
`rate-limit.mts` (in-memory, per-warm-container, per-key sliding window —
resets on cold start; documented in its own file header as a real but modest
limitation, not a distributed rate limiter), `site-origin.mts` (resolves the
canonical origin for links: hardcoded production origin when
`context.deploy.context === "production"`, otherwise the request's own
origin — so branch-preview emails/redirects still point at that branch),
`digest.mts` (shared digest-building logic used by both `weekly-digest.mts`
and `digest-test.mts`).

- **Edge Functions** (`netlify/edge-functions/`):

| Function | Route | Purpose (VERIFIED FROM CODE) |
|---|---|---|
| `preview-noindex.ts` | every HTML route | Adds `X-Robots-Tag: noindex, nofollow` on every hostname **except** the two production hostnames (`invictahomesupply.com`, `www.invictahomesupply.com`), decided purely from the parsed request URL's hostname — never from `CONTEXT` or the raw `Host` header (a prior version keyed off `CONTEXT` and was observed failing in production; see the file's own comment for the root-cause writeup). `onError: "bypass"` — a failure here never blocks the page. |
| `product-meta.ts` | `/product.html` | Server-side rewrite of `<title>`, meta description, canonical link, and Open Graph/Twitter Card tags for a specific product — needed because social-preview crawlers don't execute the client-side JS that would otherwise update these. Looks up the product in Airtable (`Post to Website = TRUE` + matching Product Key); on any failure (missing key, unpublished, Airtable down, or an unexpected exception) it always falls back to serving the original page with just a safety-net `noindex, follow` meta tag added — never an error page. |

- **Deployment from GitHub:** Netlify builds from this GitHub repository;
  `main` is production, `final-pre-production` is the staging/branch-deploy
  target (§4). **REQUIRES LIVE-SYSTEM VERIFICATION**: the exact Netlify site
  configuration (deploy contexts, DNS, redirect/proxy rules beyond
  `netlify.toml`) beyond what `netlify.toml` itself declares.

### 3.1 Inventory API request trace

**VERIFIED FROM CODE.**

```
Browser (shop.html / index.html / product.html via inventory.js)
  ↓ fetchInventory(), 10s AbortController timeout
  Check localStorage cache (key "invicta_inventory_cache_v6",
    valid for 15 minutes — window.AIRTABLE_CONFIG.cacheMinutes)
  ↓ cache miss/expired
  GET /api/inventory
    ↓
  Netlify Function inventory.mts
    ↓ GET (paginated) https://api.airtable.com/v0/{base}/{table}
      ?filterByFormula={Post to Website} = TRUE()
    ↓
  Airtable "Website Products"
    ↓ JSON { records: [...] }
  Netlify Function returns { records } with
    Netlify-CDN-Cache-Control: 60s durable / 300s stale-while-revalidate
    Cache-Control: max-age=0, must-revalidate (browser cache disabled)
    ↓
  Browser: mapAirtableRecord() per record (skips a malformed record with a
    console.warn rather than crashing the whole catalog), writes fresh
    localStorage cache, renders product cards
```

On a fetch failure, `fetchInventory()` falls back to the last successfully
cached data if any exists (still real data, just possibly stale); only when
there is truly no cached data does it surface an error state to the UI.

---

## 4. Testing and release safety

`npm run test:unit` discovers top-level test files; Apps Script tests mock
SpreadsheetApp, Gemini, Airtable and Social Queue. On runtimes with native TypeScript
stripping it uses that support; Node 20 continues using tsx. Module imports use URLs
to support Windows. Source-inspection tests expect repository LF line endings.

`npm run test:e2e` runs Chromium against local static files with network fixtures.
Firefox/WebKit are optional projects. The deployed-site smoke test requires an
explicit URL and is separate from workbook acceptance.

All handler names remain, but installed schedules are not observable from this
snapshot. Review actual project triggers manually; do not run trigger setup during
refactor validation. Existing manifest/timezone and production settings are unchanged.

Before release, back up the bound project and workbook, test in an isolated copy
with safe external destinations, and execute the full new-item + SKU-correction
acceptance checklist. Only a maintainer with explicit release approval should copy
reviewed code into the bound project. Do not merge to main or deploy automatically.

## 5. Risks requiring live verification

- Actual Product Inventory/Website Export formulas and K2 expansion are not in Git.
- Missing/ambiguous identities must be repaired by an operator; key changes are forbidden.
- Apps Script writes are not transactional. After an interrupted write, inspect the row
  and identity audit before rerunning; never delete/rebuild the catalog.
- AI EXACT/HIGH plus citations is a gate, not proof of correctness; review actual facts.
- Airtable hourly/manual runs can overlap; existing synchronization has no script lock.
- Trigger inventory, external permissions and attachment population need owner verification.

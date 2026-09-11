# Invicta Home Supply — End-to-End System Architecture

**Companion technical reference to `Invicta-Home-Supply-System-Architecture.pptx`.**

Status: reconstructed directly from the repository at commit `713d4d2` on
`final-pre-production` / `main` (branches are identical as of this writing).
Every claim below is labeled:

- **VERIFIED FROM CODE** — read directly from an executable file in this repo.
- **VERIFIED FROM CONFIGURATION** — read from a config file (`netlify.toml`,
  `appsscript.json`, `package.json`, etc.) or a documentation comment inside
  the code (e.g. Code.js's own architecture comment).
- **REQUIRES LIVE-SYSTEM VERIFICATION** — cannot be proven from this
  repository alone (live Google Sheet contents, installed Apps Script
  triggers, Airtable's actual field schema/automations, Script Properties
  values, Netlify environment variable values). Never invented.

Nothing in this document reproduces a credential, API key, token, spreadsheet
ID, or Airtable base ID. Where the source code contains a literal base ID or
similar identifier, this document refers to it by name only.

---

## 1. What is Invicta Home Supply's system? (plain language first)

Invicta Home Supply buys home-improvement and flooring inventory from
different retailers and resells it locally in the DFW/McKinney, Texas area.
Because inventory comes from many different places, in many different
formats, the business needs one clean, trustworthy way to decide **what
actually shows up on the website**, **with what information**, and **at what
price** — without a person having to manually retype every product.

**Analogy — the whole system as a warehouse:**

| Real-world idea | Technical name |
|---|---|
| The warehouse's paper ledger / master records office | Google Sheets |
| The workers who move, clean up, and double-check information between ledgers | Google Apps Script |
| The full product reference library, one card per product ever carried | Product Catalog (a Google Sheet tab) |
| The loading dock where only approved, ready-to-ship items get placed | Website Export (a Google Sheet tab) |
| The fast, always-open front counter catalog customers actually see | Airtable |
| The store's engine room — the servers that build and run the storefront | Netlify |
| The storefront itself | invictahomesupply.com |
| The person walking in | The customer |

The technical flow behind that story (**VERIFIED FROM CODE** — this is
`Code.js`'s own documented architecture, `Invicta Appscript Files/Code.js`):

```
Retailer inventory (e.g. Walmart Shopping workbook)
  → Current Inventory
  → Product Inventory
  → Product Catalog
  → Website Export
  → Apps Script sync
  → Airtable ("Website Products" table)
  → Netlify Function (/api/inventory)
  → Website (inventory.js)
  → Customer
```

The name "Walmart Shopping" for the source workbook, and the existence of a
"Current Inventory" tab, are **documented inside `Code.js`'s own architecture
comment** (VERIFIED FROM CONFIGURATION) but neither sheet is read or written
by any Apps Script function in this repository — no code in this project
touches "Current Inventory" or a retailer-specific source sheet directly.
**REQUIRES LIVE-SYSTEM VERIFICATION**: whether "Current Inventory" and
"Walmart Shopping" still reflect the live workbook's actual tab names today,
and whether other retailer source sheets exist.

---

## 2. The layers, in order

### 2.1 Inventory sources (retailer sheets)

**Documented architecture (VERIFIED FROM CONFIGURATION):** `Code.js`'s
architecture comment names "Walmart Shopping" as the entry point workbook.
This is the documented design of the pipeline, not a live-system claim.

**Current live configuration (REQUIRES LIVE-SYSTEM VERIFICATION):** whether
"Walmart Shopping" is the only retailer source workbook today, or additional
retailer sources now feed the pipeline, and whether the live workbook's tab
names/format still match this description. Nothing in this repository reads
a retailer-specific sheet directly, so none of this can be cross-checked
against executable code — do not assume additional retailers, sheet names,
or formats beyond what `Code.js`'s comment states.

### 2.2 Current Inventory

**Documented architecture (VERIFIED FROM CONFIGURATION):** `Code.js`'s
architecture comment places this layer immediately after the retailer
source and before Product Inventory. This documented role is not in
question.

**Current live configuration (REQUIRES LIVE-SYSTEM VERIFICATION):** no Apps
Script file in this repository reads or writes a sheet by this name, so its
documented role cannot be cross-checked against executable code. Whether a
tab by this name still exists in the live workbook today, and whether its
structure still matches this description, cannot be confirmed from this
repository.

### 2.3 Product Inventory

**VERIFIED FROM CODE.** Sheet name: `Product Inventory`
(`INVENTORY_CONFIG.PRODUCT_INVENTORY_SHEET`, `Config.js`). Read by
`refreshProductCatalogSourceFields()` and `syncProductCatalogKeys()`
(`ProductCatalogMaintenance.js`) and by `legacyRepairPlan_()`
(`LegacyRepair.js`). Columns A–F are read positionally as: A Product Key, B
Product ID, C Retail SKU, D Item, E Category, F Retailer (comment in
`refreshProductCatalogSourceFields()`). `LegacyRepair.js` reads the same
sheet by **header name** instead (`PRODUCT KEY`, `PRODUCT ID`, `RETAIL SKU`,
`RETAILER`, and either `ITEM` or `SOURCE ITEM`) — the two files rely on
different reading strategies for the same sheet, so a header rename would
break `LegacyRepair.js` silently while `ProductCatalogMaintenance.js` (purely
positional) would keep running against the wrong columns.

Product Inventory is never written by any Apps Script file in this
repository — it is treated as a read-only upstream source everywhere it
appears.

### 2.4 Product Catalog

**VERIFIED FROM CODE.** Sheet name: `Product Catalog`
(`INVENTORY_CONFIG.PRODUCT_CATALOG_SHEET`). This is the permanent product
library — one durable row per product the business has ever carried,
including historical/legacy products no longer sourced anywhere. Full
column map (`CATALOG_COLUMNS`, `Config.js`):

| # | Column | Owner (who is allowed to write it) |
|---|---|---|
| 1 | Display Name | Gemini enrichment (fills blank only) / manual |
| 2 | Website Category | Gemini enrichment (fills blank only) / manual |
| 3 | Retailer | `refreshProductCatalogSourceFields()` (from Product Inventory) |
| 4 | Retail SKU | `refreshProductCatalogSourceFields()` |
| 5 | Brand | Gemini enrichment / manual |
| 6 | Model | Gemini enrichment / manual |
| 7 | Sq Ft Per Unit | manual / upstream, read by Auto Box Price formula |
| 8 | Sell Price | manual, read by Auto Box Price formula |
| 9 | Auto Box Price | formula, written once by `ensureProductCatalogAutoBoxPriceFormulas_()` |
| 10 | Post to Website | manual (business decision) |
| 11 | Stock Image URL | Gemini enrichment (fills blank only, safety-checked) / manual |
| 12 | Product URL | Gemini enrichment / manual |
| 13 | Description | Gemini enrichment (fills blank only) / manual |
| 14 | Highlights | Gemini enrichment (fills blank only) / manual |
| 15 | Enrichment Status | `syncProductCatalogKeys()` (sets `PENDING` on new rows), `CatalogEnrichment.js` |
| 16 | Notes | `CatalogEnrichment.js` (`appendCatalogNote_`) |
| 17 | Unit Type | upstream / manual |
| 18 | Source Item | `refreshProductCatalogSourceFields()` |
| 19 | Source Category | `refreshProductCatalogSourceFields()` |
| 20 | **Product Key** | set once at row creation, **never changed again** |
| 21 | Match Key | `refreshProductCatalogSourceFields()`, `LegacyRepair.js` |
| 22 | Product ID | `refreshProductCatalogSourceFields()`, `LegacyRepair.js` |
| 23 | Current Sync Hash | referenced in `Config.js` comment; **no Apps Script file in this repo reads or writes it** — REQUIRES LIVE-SYSTEM VERIFICATION for its actual role |
| 24 | Last Synced Hash | same as above — REQUIRES LIVE-SYSTEM VERIFICATION |
| 25 | Content Locked | read by `CatalogEnrichment.js` eligibility check; never written by any file in this repo — REQUIRES LIVE-SYSTEM VERIFICATION for how it gets set |
| 26 | Enrichment Confidence | `CatalogEnrichment.js` |
| 27 | Last Enriched At | `CatalogEnrichment.js` |
| 33 (AG) | Card Spec 1 | Gemini enrichment (fills blank only) |
| 34 (AH) | Card Spec 2 | Gemini enrichment (fills blank only) |
| 35 (AI) | Card Spec 3 | Gemini enrichment (fills blank only) |

Columns 28–32 are not referenced by any file in this repository —
**REQUIRES LIVE-SYSTEM VERIFICATION** for what (if anything) occupies them in
the live sheet.

Product Catalog is a superset of raw inventory: it is the only layer that
carries customer-facing content (display name, description, highlights,
images, category) and the only layer with a **permanent** identity column
(Product Key) that survives a product's retailer/SKU changing over time.

### 2.5 Product identity: Product Key, Match Key, Product ID

**VERIFIED FROM CODE / CONFIGURATION** (`Code.js` comment + `LegacyRepair.js`
+ `ProductCatalogMaintenance.js`):

- **Product Key** (column 20) — the permanent fingerprint. Assigned once,
  when a row is created, and never changed again by any code in this
  repository. Historical products keep keys like `LEG-HD-001515` forever,
  even after a real retail SKU is later found for them.
- **Match Key** (column 21) — "which current Product Inventory row does this
  catalog row correspond to right now." Updated when a real retail SKU
  becomes available.
- **Product ID** (column 22) — the current retailer-code + SKU identity
  (e.g. `HD-1013910175`), refreshed from Product Inventory whenever it
  changes.

**Example:** A product enters the catalog with no clean retailer SKU yet, so
it's given permanent key `LEG-HD-001515`. Months later, a real Home Depot SKU
appears in Product Inventory for that same physical product. Legacy
reconciliation (below) updates the row's **Match Key** and **Product ID** to
the new SKU-based identity — but its **Product Key stays `LEG-HD-001515`
forever.** Permanent Product Key + legacy reconciliation prevents this
specific legacy-to-real-SKU duplicate path **when exactly one unambiguous
Product Inventory match exists** — an ambiguous or unmatched candidate is
skipped rather than guessed (§2.7). The identity audit
(`auditProductCatalogDuplicateKeys()`, §2.6) remains the protection against
other duplicate scenarios.

`legacyRepairIsLegacyKey_()` recognizes two legacy key shapes: `LEG-...` and
the older `LEGACY|...` format (both still supported for backward
compatibility).

### 2.6 Product Catalog Maintenance — `runProductCatalogMaintenance()`

**VERIFIED FROM CODE**, `ProductCatalogMaintenance.js`. This is the master
orchestration function. Actual current order (confirmed by reading the
function body, not just its comment):

```
runProductCatalogMaintenance()
  ├── LockService.getScriptLock().waitLock(30000)   // guards the whole run
  ├── reconcileLegacyCatalogRowsAutomatically_()     // 1. legacy repair FIRST
  ├── syncProductCatalogKeys()                       // 2. add genuinely-new rows
  ├── ensureProductCatalogAutoBoxPriceFormulas_()     // 3. formulas
  ├── refreshProductCatalogSourceFields()             // 4. refresh owned fields
  ├── SpreadsheetApp.flush()                          // 5. force writes to commit
  └── auditProductCatalogDuplicateKeys({throwOnIssues: true})  // 6. hard-fail audit
```

What each step protects against:

| Step | Protects against |
|---|---|
| Lock | Two maintenance runs (scheduled + manual) corrupting the sheet by writing at the same time |
| Legacy reconciliation first | A legacy row and a "new" row both existing for the same physical product once a SKU appears |
| `syncProductCatalogKeys()` | Missing genuinely-new products from Product Inventory |
| Auto Box Price formulas | Manually-entered, error-prone box pricing |
| Source-field refresh | Catalog rows drifting out of sync with Product Inventory's retailer/SKU/item/category |
| `SpreadsheetApp.flush()` | Reading stale, not-yet-committed values in the audit step that follows |
| Final audit (`throwOnIssues: true`) | Silently completing a run that actually produced duplicate/missing identities — this makes the **whole run fail loudly** rather than leaving corrupted data unnoticed |

If any step throws, the `catch` block logs `PRODUCT CATALOG MAINTENANCE
FAILED` and re-throws (so the trigger shows a failure), and the `finally`
block always releases the lock.

### 2.7 Legacy reconciliation — `LegacyRepair.js`

**VERIFIED FROM CODE.** Matching rule: a legacy catalog row (`LEG-...` or
`LEGACY|...` in Product Key) is reconciled to a Product Inventory row only
when **exactly one** Product Inventory record shares the same normalized
Retailer + Item/Source Item identity. Zero matches → skipped as "unmatched."
More than one match → skipped as "ambiguous" (never guessed). Fields updated
on a match: Match Key, Product ID, Retail SKU, Retailer, Source Item — never
the permanent Product Key.

Two entry points share the same planning logic (`legacyRepairPlan_()`):
- `repairAndUpgradeLegacyCatalogRows()` — manual, shows a dry-run preview
  dialog and asks for explicit Yes/No confirmation before applying anything.
- `reconcileLegacyCatalogRowsAutomatically_()` — used by the scheduled
  `runProductCatalogMaintenance()`; applies unambiguous matches with no
  confirmation prompt (there's no one to prompt during a scheduled run).

### 2.8 Automatic pricing — Auto Box Price

**VERIFIED FROM CODE**, `ensureProductCatalogAutoBoxPriceFormulas_()`. This
writes an actual spreadsheet formula into column 9 (Auto Box Price) for any
row that has a Product Key and does not already have a formula there
(existing formulas are never overwritten). The formula, in the sheet's own
column letters:

```
=IF(OR(G{row}="", H{row}=""), "",
   LET(x, G{row}*H{row}, w, INT(x), d, x - w,
       IF(d = 0, w, IF(d < 0.75, w + 0.5, w + 1))))
```

In plain terms: **Sq Ft Per Unit (G) × Sell Price (H)**, then rounded based
on the cents remainder — **`.00`** stays the whole dollar amount unchanged;
**`.01`–`.74`** becomes the base whole-dollar amount plus **$0.50**; **`.75`–`.99`**
rounds up to the **next whole dollar**. (The `.01`–`.74` case is not a
"round down" — it adds $0.50 to the base whole dollar rather than dropping
the cents.) If either input is blank, the cell is blank.

There is **no separate flooring-vs-non-flooring branch in this formula** —
it applies uniformly to every row. The practical flooring/non-flooring
difference described in earlier project discussion comes from *which rows
have a non-blank Sq Ft Per Unit* (flooring is priced per square foot and
typically populates this field; most non-flooring items leave it blank, so
the formula naturally evaluates to blank for them) — this is a **field-
presence effect, not a coded category check**, and should be described that
way rather than as an explicit if/else on category.

### 2.9 Gemini enrichment — `CatalogEnrichment.js`

**VERIFIED FROM CODE.** Purpose: fill in missing customer-facing content
(display name, category, brand, model, description, highlights, a stock
image, and up to three "Card Specs") for catalog rows that don't have it yet
— using Google's Gemini API with Google Search grounding for identity
verification, never invented content.

```
Product Catalog row missing content
  ↓ isCatalogRowEligibleForEnrichment_()
Eligible? (has Product Key + Source Item, not LEG-, not locked,
           not already fully described, status not
           PROCESSING/FAILED/ENRICHED-VERIFIED,
           not NEEDS REVIEW with a prior enrichment timestamp)
  ↓ yes
Status set to PROCESSING, sheet flushed
  ↓
callGeminiProductEnrichment_() — Gemini model "gemini-3.5-flash-lite"
  with a google_search tool, via
  https://generativelanguage.googleapis.com/v1beta/interactions
  ↓
parseGeminiJson_() — strict JSON parsing + field-level sanitization
  (display name ≤70 chars, highlights ≤45 chars each / 4–6 max,
   card specs ≤24 chars each / 3 max, dedup, enum-check confidence
   and match_status)
  ↓
applyCatalogEnrichmentResult_()
  ↓
verified?  (match_status EXACT AND confidence HIGH AND at least one
            citation URL AND website_category present AND description
            present AND ≥4 highlights)
  ├── YES → ENRICHED - VERIFIED, fills ONLY currently-blank fields,
  │         never overwrites existing manual content
  └── NO  → NEEDS REVIEW, nothing customer-facing written, a note is
            appended explaining why
```

**Existing content is never overwritten** — `applyCatalogEnrichmentResult_()`
checks `!existingValue && proposedValue` before writing each field. A
retailer SKU is explicitly prevented from being mistaken for a manufacturer
model number (`isSameComparableValue_()` blanks `result.model` if it matches
the retail SKU). Runs under `LockService.getScriptLock().tryLock(30000)` —
this waits/tries for up to 30 seconds to acquire the lock. Only if it still
cannot acquire the lock after that wait does the code explicitly throw
(`if (!lock.tryLock(30000)) { throw ... }`), rather than proceeding to run
concurrently with another still-active enrichment run.

**Batch size:** `ENRICHMENT_CONFIG.BATCH_SIZE = 5` per invocation
(`runCatalogEnrichment()`); a separate `runCatalogEnrichmentTest()` also
exists, hardcoded to a limit of 5.

### 2.10 What Gemini is allowed to generate

**VERIFIED FROM CODE** (`buildGeminiEnrichmentPrompt_()` and
`parseGeminiJson_()`):

- Short display name — 35–60 characters targeted, 70-character hard cap
  enforced in code (anything longer is discarded to empty string).
- Exactly one approved broad `website_category` from the fixed list (below)
  — the prompt explicitly instructs Gemini to use `Other` rather than invent
  a new one, and `normalizeWebsiteCategory_()` **independently re-validates**
  the returned value against that same list regardless of what the model
  says, discarding anything that doesn't match.
- Brand / model — model is discarded if it's just the retail SKU restated.
- A two-sentence factual description.
- 4–6 short highlights, each ≤45 characters, deduplicated.
- Up to 3 "Card Specs," each ≤24 characters, deduplicated, never repeating
  brand/model/name/retailer/SKU.
- A product URL.
- A stock image URL — **only** written when it passes `isSafeImageUrl_()`:
  must be `https://`, no whitespace, and not a bare retailer product-listing
  page (Home Depot `/p/`, Lowe's `/pd/`, Walmart `/ip/` URLs are explicitly
  rejected as "not a direct image").

**Confidence/citation gate:** customer-facing fields are written **only**
when `match_status === "EXACT"`, `confidence === "HIGH"`, at least one
citation URL was returned, and the response has a non-empty category,
description, and ≥4 highlights. Anything short of that is `NEEDS REVIEW` —
verified/nothing-written, not a partial write.

### 2.11 Website categories — the approved taxonomy

**VERIFIED FROM CODE**, `WEBSITE_CATEGORY_VALUES` in `Config.js` (also
re-exported as `IWA_H_CATEGORY_VALUES` in `WebsiteAirtableSync.js`, and
mirrored — with matching names — in the website's own `CATEGORY_CONFIG` in
`inventory.js`). The current 19-value taxonomy:

```
Flooring, Water Heaters, Appliances, Plumbing & Bath, Lawn & Outdoor, Tools,
Electrical & Lighting, Electronics & Smart Home, Paint & Supplies,
Building Materials, Doors & Windows, Heating & Cooling, Home & Furniture,
Cleaning & Household, Health & Personal Care, Automotive, Sports & Fitness,
Toys & Collectibles, Other
```

Analogy: the **broad category is the store aisle** ("Flooring"); the
**specific product name/type belongs in Display Name or a highlight/spec**,
not the category. Gemini is prevented from inventing a new top-level
category by two independent layers: the prompt instruction itself, and
`normalizeWebsiteCategory_()`'s hard re-validation against this exact list
regardless of what text comes back.

### 2.12 Website Export — the publishing boundary

**VERIFIED FROM CONFIGURATION** (`Config.js` header comment): *"Website
Export is formula-driven and is not written by Apps Script."* No Apps Script
file in this repository writes to the Website Export sheet — it is read-only
input to `syncWebsiteExportToAirtable()`. Its actual eligibility formulas
(how it decides `Post to Website`/`In Stock` from Product Catalog) are
**REQUIRES LIVE-SYSTEM VERIFICATION** — they live in the spreadsheet itself,
not in any file in this repo.

What is verified is the **column contract** the sync code depends on
(`required` array in `syncWebsiteExportToAirtable()`): `Product Key`,
`Display Name`, `Category`, `Brand`, `Model`, `Retail SKU`, `Retailer`,
`Quantity Available`, `Unit Type`, `Sq Ft Per Unit`, `Available Sq Ft`,
`Website Price`, `Description`, `Highlights`, `Product URL`,
`Stock Image URL`, `Post to Website`, `In Stock`, `Box Price`,
`Subcategory`, `Thickness MM`, `Wear Layer MIL`, `Underlayment Attached`,
`Water Resistance`, `Card Spec 1`, `Card Spec 2`, `Card Spec 3`. If any of
these headers is missing, the entire sync throws before processing any row.

Conceptual eligibility boundary (last-mile filter applied by the sync
function itself, on top of whatever the sheet's own formulas already
decided):

```
Website Export row
  ↓
Post to Website = Yes?  AND  In Stock = TRUE?      ← LIVE-SHEET FORMULA
  ↓ no → skipped entirely (not even considered)      (Website Export's own
  ↓ yes                                               formulas — not Apps Script)
Category / Water Resistance / Underlayment Attached  ← SYNC-TIME CODE
  all valid enum values?                               (WebsiteAirtableSync.js,
  ↓ no → THIS ROW rejected (logged with Product Key    verified from source)
         + reason), sync continues
  ↓ yes
→ eligible for Airtable upsert
```

These are two different mechanisms, not one blended step: the `Post to
Website`/`In Stock` decision is live-sheet formula logic whose exact rules
are **REQUIRES LIVE-SYSTEM VERIFICATION**; Product Key presence and enum
validity are checked in code, at sync time, by `WebsiteAirtableSync.js` —
**VERIFIED FROM CODE**.

### 2.13 Apps Script → Airtable synchronization — `WebsiteAirtableSync.js`

**VERIFIED FROM CODE.** Function: `syncWebsiteExportToAirtable(options)`.
Accepts an optional `productKeys` list to scope a run to specific products
(`options.productKeys`); otherwise processes every eligible row.

```
Read "Website Export" sheet (getDataRange — every row, every column)
  ↓
Validate required headers exist (throws for the whole run if not)
  ↓
Fetch every existing Airtable record once (iwaFetchAll_) — used to
  preserve "Date Added" and read the current "Status" per record
  ↓
For each Website Export row:
  Post to Website=Yes AND In Stock=TRUE?  → else skip row
  (if options.productKeys given, also filter to that set)
  ↓
  Validate Category / Water Resistance / Underlayment Attached
    ↓ invalid → row REJECTED (added to rejectedRows with reason,
                logged), loop continues to the next row — one bad
                row never aborts the run
    ↓ valid → build the Airtable record payload
  ↓
Batch upsert (Airtable "patch" with performUpsert on Product Key),
  BATCH_SIZE = 10 records per request, 250ms pause between batches
  ↓
Identify "stale" records: currently Post to Website=true in Airtable,
  but NOT in this run's eligible set and NOT rejected this run
  ↓
Batch-set those stale records' "Post to Website" to false
  (UNPUBLISH — never delete)
  ↓
Return/console.log a summary: synced, unpublished, approvedRows,
  rejected count + rejectedRows detail
```

**Preserved operational fields:** `Status` is written as the *existing*
Airtable value if present, defaulting to `"In Stock"` only when there is no
existing value (i.e. only for a genuinely new record) — this repo's current
code does **not** unconditionally overwrite Status on every sync, unlike an
earlier draft version once reviewed for this project. `Date Added` is
similarly preserved from the existing record (or backfilled from the
record's Airtable `createdTime`) rather than reset on every sync.

**Controlled-value validation** (`iwaEnum_()`): throws for an unrecognized
non-blank value, but that throw is caught **per-row**, inside the row's own
`try/catch` — it never escapes to abort the whole sync. This is why one bad
controlled-value row does not abort the whole sync — that row is rejected
and logged, and the loop continues. Other kinds of systemic failure (a
missing required column, or Airtable remaining unreachable after every
retry) can still abort the run entirely; the per-row catch only covers
controlled-value validation, not every possible failure.
`Water Resistance` additionally normalizes legacy `Yes`/`No` values
(`iwaWaterResistance_()`) to `Waterproof`/`Not Water Resistant` before
falling through to strict enum validation for anything else.

**Retry/backoff** (`iwaRequest_()`): minimum 220ms between any two Airtable
requests (`MIN_REQUEST_INTERVAL_MS`); up to 5 attempts
(`MAX_ATTEMPTS`) for a `429` or any `5xx` response, honoring the response's
`Retry-After` header when present, otherwise exponential backoff
(`1000 × 2^(attempt-1)` ms, capped at 30s). A `4xx` other than 429 fails
immediately without retrying (it's treated as not transient).

**Concurrency:** `syncWebsiteExportToAirtable()` does **not** call
`LockService` anywhere in this file — unlike `runProductCatalogMaintenance()`
and `runCatalogEnrichment()`, this sync has no lock guarding it against
overlapping runs. See §11 (Risks) — this is a real, currently-unmitigated
gap, not something to design around silently.

### 2.14 Airtable

**VERIFIED FROM CODE / CONFIGURATION.** Airtable is **not** the source of
truth — Google Sheets (Product Catalog specifically) is. Airtable exists as
the fast, website-ready, API-queryable publication layer: everything the
website reads comes from Airtable's `Website Products` table. Most
publishing fields (Product Key, Name, Category, Price, Details, Highlights,
and the rest of the sync payload) are overwritten on every sync run —
Google Sheets is authoritative for those. **Not every field works the same
way, though** — see the field-by-field ownership breakdown below. Editing a
record directly in Airtable does not feed back into Google Sheets in either
direction verified by this repository's code.

**Field-by-field ownership (verified from `WebsiteAirtableSync.js`):**

| Field(s) | Who owns / writes it |
|---|---|
| Product Key, Name, Category, Price, Details, Highlights, and most other publishing fields | Overwritten on every sync — Google Sheets is authoritative |
| `Status` (operational) | Preserved from the existing Airtable record; only defaulted to `"In Stock"` for a brand-new record — **not** unconditionally overwritten |
| `Photos` | Read by the website, but **not written by the current Apps Script sync** — REQUIRES LIVE-SYSTEM VERIFICATION for what populates it |
| `Date Added` | Preserved from the existing record (or backfilled from Airtable's own `createdTime`) — never reset on each sync |

Known `Website Products` fields, established from the sync payload and the
site's own field-reads (`inventory.js`'s `mapAirtableRecord()`,
`_shared/products.mts`, `product-meta.ts`): `Product Key`, `Name`,
`Category`, `Brand`, `Model`, `Retail SKU`, `Retailer`, `Price`,
`Price Basis`, `Box Price`, `Quantity Available`, `Unit Type`,
`Sq Ft Per Unit`, `Available Sq Ft`, `Details`, `Highlights`,
`Card Spec 1/2/3`, `Product URL`, `Reference Image URL`, `Post to Website`,
`Status`, `Date Added`, `Subcategory`, `Thickness MM`, `Wear Layer MIL`,
`Underlayment Attached`, `Water Resistance`, `Photos` (an Airtable
attachment field, read by the website but never written by the Apps Script
sync — **REQUIRES LIVE-SYSTEM VERIFICATION** for how it's populated), and
(for the separate `Inventory Subscribers` table, unrelated to product data)
`Email`, `Status`, `Confirmation Token`, `Unsubscribe Token`,
`Consent Text`, `Consent Timestamp`, `Confirmed At`, `Unsubscribed At`,
`Last Digest Sent At`.

The literal Airtable base ID is hardcoded in `WebsiteAirtableSync.js`
(`IWA_SYNC_HARDENED.BASE_ID`) and is intentionally **not reproduced in this
document**. Table name: `Website Products` (products),
`Inventory Subscribers` (subscribers, name **REQUIRES LIVE-SYSTEM
VERIFICATION** — code reads it from an env var defaulting to that name, per
`_shared/subscribers.mts`).

### 2.15 Controlled values and safety (validation summary)

| Field | Allowed values | Enforced by |
|---|---|---|
| Category | 19-value list (§2.11) | `iwaEnum_()` in `WebsiteAirtableSync.js`; independently re-validated for Gemini output by `normalizeWebsiteCategory_()` |
| Water Resistance | `Waterproof`, `Water Resistant`, `Not Water Resistant`, `Unknown` (legacy `Yes`/`No` normalized first) | `iwaWaterResistance_()` |
| Underlayment Attached | `Yes`, `No` | `iwaEnum_()` |

Why one bad controlled-value row does not abort the whole sync: every enum
check above happens **inside the per-row loop**, wrapped in its own
`try/catch` — a thrown validation error is caught, the row is added to
`rejectedRows` with its Product Key and reason, and the loop moves on to the
next row. The overall `syncWebsiteExportToAirtable()` call still returns a
normal summary object; nothing about one bad row aborts the batch upserts
for every other already-validated row. This per-row catch is scoped to
controlled-value validation specifically — other systemic failures (a
missing required column, or Airtable unreachable after every retry
attempt) can still abort the run.

---

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

## 4. Production vs. pre-production

**VERIFIED FROM CODE / CONFIGURATION / this engagement's own deployment
history.**

```
final-pre-production (staging branch)
  → Netlify branch deploy (staging environment)
  → X-Robots-Tag: noindex, nofollow + <meta name="robots" content="noindex, follow">
    (preview-noindex.ts / product-meta.ts's own safety-net meta tag)
  → manual + automated testing (unit, Playwright E2E, manual smoke workflow)
  → Pull Request → main
  → main
  → Netlify production deploy
  → invictahomesupply.com
  → indexable (no noindex header/meta — preview-noindex.ts explicitly
     skips both production hostnames)
```

As of this document, `main` and `final-pre-production` point at the
identical commit (`713d4d2`) — the working agreement established during this
engagement is that `final-pre-production` is now a **permanent** staging
branch (not a disposable feature branch): ongoing work lands there first,
gets a Netlify branch deploy for validation, and is promoted to `main` via
pull request. After each promotion, `final-pre-production` is fast-forwarded
back to `main`'s new HEAD so the two never diverge outside of an active
feature window.

`preview-noindex.ts` is what actually keeps a staging/preview deploy out of
Google — it is a hostname allowlist, not a Netlify configuration setting, so
it is exactly as reliable as that source file, wherever it is deployed from.

---

## 5. Testing

**VERIFIED FROM CODE / CONFIGURATION** (`package.json`,
`test/run-unit-tests.mjs`, `playwright.config.mjs`,
`.github/workflows/*.yml`), and from an actual local run performed as part
of this project's CI-fix work:

- **Unit tests:** `npm run test:unit` → `node test/run-unit-tests.mjs`. Runs
  every `test/*.test.mjs` file (31 files) as its own child process (isolated
  globals/mocks per file), launched with `--import tsx/esm` so files that
  import real `.ts`/`.mts` Netlify source (Edge Functions, Functions) can
  load under Node 20 without a separate build step. **As last verified:
  526 tests passed, 0 failed, across all 31 files.**
- **Playwright E2E:** `npm run test:e2e` → `playwright test --project=chromium`
  (80 tests, chromium only by default; firefox/webkit exist as opt-in
  projects, `npm run test:e2e:firefox` / `:webkit`). Runs against a local
  static file server (`python3 -m http.server`) with every network call
  intercepted via fixtures (`test/e2e/fixtures/mock-inventory.mjs`) — no
  live Airtable/Netlify dependency. **As last verified: 80/80 passed.**
- **Manual smoke workflow:** `.github/workflows/smoke-manual.yml` —
  `workflow_dispatch` only (never runs on push/PR/schedule), runs
  `test/smoke/run-smoke-test.mjs` against a caller-supplied real deployed
  URL (a Netlify deploy preview or production). Zero dependencies, GET/HEAD
  only, no secrets required. Only dispatchable once present on the
  repository's default branch (a GitHub platform requirement discovered
  during this engagement).
- **GitHub Actions:** `.github/workflows/test.yml` — runs on push/PR to
  `main` and `final-pre-production`; installs deps, installs Playwright's
  Chromium, runs `npm test` (unit then E2E). Deliberately never runs the
  live smoke test (per the workflow's own header comment).
- **Netlify deploy checks:** Netlify posts its own deploy-preview/branch-
  deploy status as a GitHub commit status (visible as a check on the PR),
  separate from the GitHub Actions `test` check — both were required to be
  green before this engagement's own production merge (PR #13).

---

## 6. Automation / triggers (Apps Script)

**VERIFIED FROM CONFIGURATION** (`Code.js`'s own documentation comment) for
the *intended* schedule; **REQUIRES LIVE-SYSTEM VERIFICATION** for whether
these triggers are actually installed in the live Apps Script project today
(this repository is a code snapshot, not a live trigger list —
`ScriptApp.getProjectTriggers()` is only called defensively inside
`setupCatalogEnrichmentTrigger()` to avoid creating a duplicate, which
implies triggers are normally created once and left running, not proof of
current installation state):

| Trigger (documented) | Schedule (documented) | What it does |
|---|---|---|
| `runProductCatalogMaintenance` | Every six hours | Full catalog maintenance pipeline (§2.6) |
| `syncWebsiteExportToAirtable` | Hourly | Publishes eligible products to Airtable, unpublishes ineligible ones |
| `runCatalogEnrichment` | Daily, ~3 AM Central | Processes up to 5 catalog rows needing Gemini enrichment |

`setupCatalogEnrichmentTrigger()` (`EnrichmentAdmin.js`) is the one piece of
trigger-creation code in this repository: it checks for an existing trigger
calling `runCatalogEnrichment` and, if none exists, creates a daily trigger
at hour 3 (`ScriptApp.newTrigger(...).timeBased().everyDays(1).atHour(3)`).
No equivalent setup function exists in this repo for the six-hour catalog
maintenance trigger or the hourly Airtable sync trigger — **REQUIRES
LIVE-SYSTEM VERIFICATION** for how/when those two were created.

---

## 7. Failure scenarios

| Problem | Protection | Verified in |
|---|---|---|
| Duplicate Product Key / Match Key / Product ID / Retailer+SKU identity | `auditProductCatalogDuplicateKeys({throwOnIssues: true})` fails the whole maintenance run loudly rather than letting it pass silently | `ProductCatalogMaintenance.js`, `AdminTools.js` |
| Ambiguous legacy match (more than one Product Inventory candidate) | Skipped, never guessed | `LegacyRepair.js` |
| Bad Airtable enum value (Category / Water Resistance / Underlayment) | That row is rejected (logged with Product Key + reason); the sync continues for every other row | `WebsiteAirtableSync.js` (`iwaEnum_`, per-row try/catch) |
| Gemini uncertain about a product | Result marked `NEEDS REVIEW`; no customer-facing field written | `CatalogEnrichment.js` |
| Gemini invents a top-level category | Rejected/blanked by `normalizeWebsiteCategory_()` regardless of what the model returns | `CatalogEnrichment.js` |
| Gemini returns a non-image / retailer-page "image" URL | Rejected by `isSafeImageUrl_()` | `CatalogEnrichment.js` |
| Product no longer eligible for the website | Its Airtable record's `Post to Website` is set to `false` — **never deleted** | `WebsiteAirtableSync.js` |
| Airtable network error / rate limit (429/5xx) | Retry with `Retry-After`-aware exponential backoff, up to 5 attempts | `WebsiteAirtableSync.js` (`iwaRequest_`) |
| One malformed inventory record from Airtable | That single record is skipped (`console.warn`); the rest of the catalog still renders | `inventory.js` (`fetchInventory`) |
| Inventory API unreachable | Client falls back to last-known-good `localStorage` cache before showing an error | `inventory.js` |
| Two maintenance/enrichment runs overlapping | `LockService` — a second run is skipped (`runProductCatalogMaintenance`) or throws (`runCatalogEnrichment`) rather than corrupting data with concurrent writes | `ProductCatalogMaintenance.js`, `CatalogEnrichment.js` |
| **Airtable sync overlapping with itself** | **No lock exists in `WebsiteAirtableSync.js`.** This is a real, currently-unmitigated gap (see §11) | — |
| Preview/staging deploy accidentally indexed by Google | `preview-noindex.ts` adds `X-Robots-Tag: noindex, nofollow` on every non-production hostname | `netlify/edge-functions/preview-noindex.ts` |
| A product page's social-preview metadata going stale/wrong | `product-meta.ts` rewrites title/description/canonical/OG tags server-side per request, always falling back to a safe noindex response rather than an error | `netlify/edge-functions/product-meta.ts` |

---

## 8. Security and credentials

**VERIFIED FROM CODE / CONFIGURATION.** No secret value is reproduced
anywhere in this document or its companion slide deck.

Where credentials live, by system:

- **Apps Script:** `PropertiesService.getScriptProperties()` — specifically
  `GEMINI_API_KEY` (`ENRICHMENT_CONFIG.API_KEY_PROPERTY`) and
  `AIRTABLE_TOKEN` (`IWA_SYNC_HARDENED.TOKEN_PROPERTY`). Both are read only
  via `PropertiesService`, never hardcoded, and the code throws a clear
  error naming the missing property rather than failing silently or
  falling back to a default.
- **Netlify environment variables** (documented, names only, in
  `docs/ENVIRONMENT_VARIABLES.md`): `AIRTABLE_TOKEN`, `AIRTABLE_BASE_ID`,
  `AIRTABLE_TABLE_NAME`, `AIRTABLE_SUBSCRIBERS_TOKEN`,
  `AIRTABLE_SUBSCRIBERS_TABLE_NAME`, `RESEND_API_KEY`,
  `WEEKLY_DIGEST_ENABLED`, `BUSINESS_MAILING_ADDRESS`, `DIGEST_TEST_TOKEN`,
  `DIGEST_TEST_RECIPIENT`. The products token and the subscribers token are
  deliberately separate and independently scoped/revocable.
- **GitHub:** current CI workflows (`.github/workflows/*.yml`) reference no
  GitHub secrets — both run entirely against public code and mocked
  fixtures.

Credentials should never be committed to Git. `.gitignore` in this
repository already excludes `.env`/`.env.*` (with an explicit
`.env.example`-names-only exception), and no `.env`, `.pem`, `.key`,
`credentials`, `secret`, `clasp.json`, or token-bearing file is currently
tracked in this repository (verified by a direct file-list scan during this
engagement).

---

## 9. How to safely change the system

**VERIFIED FROM this engagement's own established branch strategy and code
comments** (not invented):

| Kind of change | Path |
|---|---|
| Inventory / catalog data change | Google Sheets / Apps Script — outside this repository's normal PR flow entirely |
| Website UI / behavior change | `final-pre-production` first |
| Validate | Netlify branch deploy (staging) + automated tests |
| Approve | Pull Request into `main` |
| Ship | Merge → Netlify production deploy from `main` |

**Should not be casually edited:**
- `Invicta Appscript Files/*.js` in this repo is a **snapshot**, not the
  live, deployable project — editing it here does not change production
  Apps Script behavior; the live project must be updated directly (e.g. via
  `clasp push` from a maintainer's machine) and then the snapshot re-synced
  here.
- `CATALOG_COLUMNS` / `INVENTORY_CONFIG` (`Config.js`) — these are
  positional column-number contracts; changing a column's position in the
  live sheet without updating this map (or vice versa) silently
  misattributes data.
- `WEBSITE_CATEGORY_VALUES` — changing this list changes what Gemini is
  allowed to assign **and** what the Airtable sync accepts **and** what the
  website itself recognizes (`inventory.js`'s own `CATEGORY_CONFIG` mirrors
  the same names) — a change made in only one place produces mismatches
  across the other two.
- `netlify/edge-functions/preview-noindex.ts`'s `PRODUCTION_HOSTNAMES` set —
  this is the entire mechanism that keeps staging out of Google search;
  editing it incorrectly could either index a staging deploy or de-index
  production.

---

## 10. System summary / cheat sheet

```
Retailer sheets → Current Inventory → Product Inventory → Product Catalog
  → Website Export → Apps Script sync → Airtable → Netlify Function
  → Website → Customer
```

**"Something's wrong — where do I look?"**

| Symptom | Look here |
|---|---|
| Inventory numbers/data look wrong | Google Sheets (Product Inventory / Website Export formulas) |
| Same product appears twice in the catalog | `runProductCatalogMaintenance()` / `auditProductCatalogDuplicateKeys()` output |
| A product's description/category/image looks AI-generated-wrong | `CatalogEnrichment.js` — check its Notes column entry and Enrichment Status |
| A product on the site doesn't match what's in Airtable | `WebsiteAirtableSync.js` — check its execution log / `rejectedRows` |
| The website shows an error or stale data | Netlify's `inventory.mts` function logs, then Airtable's own status |
| Something looks broken on the page itself (layout, buttons, calculator) | Website code — `inventory.js` / `app.js` / `styles.css` |
| A deploy didn't go out, or went to the wrong place | GitHub Actions / Netlify deploy dashboard |

---

## 11. Appendix — risks and possible improvements (NOT the current-system spec)

This section is deliberately separate from everything above. It does not
describe how the system currently behaves; it flags things worth a decision.

1. **`WebsiteAirtableSync.js` has no `LockService` guard.** Every other
   scheduled write path in this project (`runProductCatalogMaintenance()`,
   `runCatalogEnrichment()`) takes a script lock; the hourly Airtable sync
   does not. Two overlapping runs (e.g. a manual run started while the
   hourly trigger is also executing) could race on the same Airtable
   records.
2. **Columns 23–25** (Current Sync Hash, Last Synced Hash, Content Locked)
   are referenced in `Config.js`'s column map but not read or written by any
   Apps Script file in this repository. Either they're maintained by a
   process outside this codebase, or they're vestigial — worth confirming
   live rather than assuming either.
3. **Two different column-reading strategies for the same sheet.**
   `ProductCatalogMaintenance.js` reads Product Inventory positionally
   (columns A–F by index); `LegacyRepair.js` reads the same sheet by header
   name. A header reorder in the live sheet would silently break the
   positional reader while the header-based reader kept working correctly
   against the new layout — an inconsistency worth resolving one way or the
   other.
4. **No installed-trigger verification exists in this repo.** Only the
   daily enrichment trigger has a setup/dedup function
   (`setupCatalogEnrichmentTrigger()`). The six-hour maintenance and hourly
   sync triggers have no equivalent — there is no code-level guarantee
   against a duplicate trigger being created for either of them, or a way to
   verify from code alone that they're currently installed at all.

---

## 12. Questions requiring your input before this architecture can be called complete

These cannot be answered from the repository and are not guessed anywhere
above:

1. Does "Current Inventory" still exist as a live sheet tab, and what does
   it actually contain? (Referenced only in `Code.js`'s documentation
   comment.)
2. Is "Walmart Shopping" the only retailer source workbook today, or are
   there others feeding Product Inventory?
3. What do Website Export's own formulas actually check when deciding
   `Post to Website` / `In Stock`? (Config.js states Website Export is
   formula-driven and not written by Apps Script — its formulas themselves
   aren't visible from this repository.)
4. Are `runProductCatalogMaintenance`, `syncWebsiteExportToAirtable`, and
   `runCatalogEnrichment` currently installed as time-driven triggers in the
   live Apps Script project, and do their actual schedules match §6's
   documented intent?
5. What do Product Catalog columns 23–25 (Current Sync Hash, Last Synced
   Hash, Content Locked) actually do today, and what sets `Content Locked`?
6. What populates the Airtable `Photos` attachment field, since no code in
   this repository writes it?
7. Is the `Inventory Subscribers` table name in Airtable exactly that, or
   configured differently via `AIRTABLE_SUBSCRIBERS_TABLE_NAME`?
8. Is `WEEKLY_DIGEST_ENABLED` currently set to `true` in production, i.e.
   is the weekly digest actually sending today?

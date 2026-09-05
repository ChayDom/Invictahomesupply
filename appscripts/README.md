# Apps Script — Product Catalog / Website Export sync

These scripts run in the Google Sheets Apps Script project behind Product
Catalog and Website Export — they are **not** deployed as part of this
website's build. They live here for version control and review only; a
human still copies/deploys them into the Apps Script editor.

Production pipeline these scripts are part of:

```
Current Inventory -> Product Inventory -> Product Catalog -> Website Export
        -> Airtable "Website Products" -> Netlify function -> website
```

## Files

- `ProductCatalog_Maintenance_v2.js` — **received and reviewed.** Header-based
  replacement for the old positional-column maintenance writer that was
  generating malformed duplicate rows. See review notes below.
- `WebsiteExport_Airtable_Sync_v2.js` — **received and reviewed.** Header-based
  Website Export → Airtable "Website Products" upsert sync. See review notes
  below.

## `ProductCatalog_Maintenance_v2.js` — review notes

**Verdict: sound design, no bugs found that would block a dry run.**

What it does right:
- Every field access goes through a header-name → column-index map built by
  reading row 1 of each sheet (`pcmReadTable_`) — this is the actual fix for
  the positional-column bug; no hardcoded column letters/indices anywhere.
- Never writes to `PRODUCT KEY` on an existing Product Catalog row —
  identity is permanent, matching the "Product Key is the stable identity,
  never Product ID" rule.
- Refuses to proceed at all if the *existing* Product Catalog already
  contains a duplicate `PRODUCT KEY` or `MATCH KEY` (throws during the
  initial scan, before touching Product Inventory) — and separately refuses
  to *create* a new duplicate while planning appends. Both checks fire
  identically in dry-run and real-run mode, so `runProductCatalogMaintenanceDryRun()`
  will genuinely surface a duplicate-creation problem without writing
  anything.
- Only initializes `WEBSITE CATEGORY` / `WEB SUBCATEGORY` on an existing row
  **when they're currently blank** (`pcmPlanSetIfBlank_`) — never
  overwrites a value someone already set. `SOURCE CATEGORY` on an existing
  row is never touched at all (explicit comment: preserved as historical
  metadata). It doesn't touch `Thickness MM`/`Wear Layer MIL`/`Underlayment
  Attached`/`Water Resistance` or `Quantity Available` anywhere — those stay
  fully in the hands of the enrichment process and Product Inventory,
  respectively, exactly as required.
- Uses `LockService` so two runs can't interleave.

Two things worth knowing, neither of which blocks a dry run:
- `targetRow` for a brand-new key is tracked in-memory as `-1` before the
  row actually exists. `-1` is truthy in JS, so if that sentinel were ever
  looked up as if it were a real row number, `sheet.getRange(-1, ...)` would
  throw. In the current code this can't actually happen — `seenInventoryKeys`
  already prevents the same Product Inventory key from being processed
  twice in one run, which is the only way to reach that path. Still, it's a
  fragile pattern (relies on that guard staying in place); a small
  hardening for a future revision would be checking `.has()` explicitly
  instead of relying on truthiness of `.get()`.
- When a `LEGACY|...` row's identity (normalized Retailer + Item) matches
  **more than one** legacy row, the script deliberately does not guess —
  it increments `summary.ambiguousLegacy` and creates a new row instead of
  reconciling. That's the safe choice, but it means those cases silently
  produce a duplicate-content new row rather than reusing the old one until
  a human resolves the ambiguity by hand. Check `summary.ambiguousLegacy`
  after the dry run — if it's non-zero, look at those rows before running
  for real.

## `WebsiteExport_Airtable_Sync_v2.js` — review notes

**Verdict: sound design, matches the real Airtable schema. One real
operational risk (rate limiting) should be fixed before running it against
the full catalog; safe to test now against the current small record set.**

What it does right:
- Every Airtable field name written in the `fields` object was checked
  against the live `Website Products` schema (pulled via the Airtable MCP
  earlier in this project) and is correct: `Category`, `Brand`, `Model`,
  `Retail SKU`, `Retailer`, `Price`, `Price Basis`, `Box Price`, `Quantity
  Available`, `Unit Type`, `Sq Ft Per Unit`, `Available Sq Ft`, `Details`,
  `Highlights`, `Product URL`, `Reference Image URL`, `Post to Website`,
  `Subcategory`, `Thickness MM`, `Wear Layer MIL`, `Underlayment Attached`,
  `Water Resistance`. The `required` header list (`DISPLAY NAME`, `WEBSITE
  PRICE`, `DESCRIPTION`, `STOCK IMAGE URL`, `IN STOCK`, etc.) is the
  **Website Export sheet's own column headers**, not Airtable field names —
  those are correctly translated into the real Airtable field names inside
  `fields` (e.g. sheet column `DESCRIPTION` → Airtable field `Details`,
  sheet column `WEBSITE PRICE` → Airtable field `Price`). No stale field
  names carried over from the earlier "Website Category" / "Display Name" /
  "Retail Price" misunderstanding.
- Confirmed by PATCH partial-update semantics: since `fields` never
  includes `Photos`, `Was Price`, `Status`, `Date Added`, or `Date
  Reserved`, an upsert genuinely cannot touch those columns — the header
  comment's claims are structurally true, not just documented intent.
- There is no "In Stock" field in the live Airtable schema (confirmed via
  `get_table_schema` earlier) — this script correctly never tries to write
  one. Instead it reads `IN STOCK` and `POST TO WEBSITE` from the Website
  Export sheet and folds both into the single real field `Post to Website`
  (`post && inStock`). This is the right design for a schema with no
  separate stock flag, and it retroactively confirms why `inventory.js`'s
  `resolveStatusLabel()` Tier 1 (`In Stock` boolean) is currently
  unreachable-but-harmless — that field was never expected to exist.
- Missing/stale records are unpublished (`Post to Website: false`), never
  deleted — matches the "never delete, only unpublish" requirement.
- Upserts by `Product Key` via `performUpsert.fieldsToMergeOn`, batches of
  10 (Airtable's per-request max), `LockService` not needed here since this
  is a single sequential script with no concurrent trigger overlap risk
  documented elsewhere.

Real risk found — **no rate-limit handling**:
- Airtable enforces 5 requests/sec per base. For the current ~24-record
  test set this is a non-issue (3 batches). Once the full ~566-product
  catalog is flowing through Website Export, this becomes ~57 upsert
  batches, plus the paginated `iwaFetchAll_` GETs, plus the stale-unpublish
  PATCH batches — all fired back-to-back with no `Utilities.sleep()` and no
  429 retry/backoff in `iwaRequest_`. Apps Script can execute
  `UrlFetchApp.fetch()` calls fast enough to trip the limit, and a 429
  response is not handled — it will throw and abort the whole sync
  mid-run. **Recommend adding a short `Utilities.sleep(200)` between
  batches and a retry-with-backoff on HTTP 429 in `iwaRequest_` before
  running this against the full catalog.** Not a blocker for testing at
  the current small scale.

Minor note:
- `Category`, `Unit Type`, `Underlayment Attached`, and `Water Resistance`
  are passed straight through from the sheet text with `typecast: true`
  and no normalization/allowlist check before sending. This is the
  mechanism that produced the 11-value Category taxonomy sprawl found
  earlier in this project (any spelling/casing variant silently becomes a
  new Airtable select choice). Not a bug in this script specifically — it's
  doing what upsert-with-typecast is supposed to do — but a normalization
  or "must match a known value" check on the Website Export side (or right
  before this script sends the payload) would prevent future drift.

Reminder (not a code issue): confirm the `AIRTABLE_TOKEN` Script Property
this sync uses is a **write-capable** token, and that it is a **different**
token from whatever the Netlify function (`inventory.mts`) uses to read
records — the website should only ever hold a read-only token client- and
server-side.

## Before re-enabling the 6-hour trigger

1. Run `runProductCatalogMaintenanceDryRun()` in the Apps Script editor.
2. Share the returned summary object (or the `console.log` output) —
   specifically `existingMatched`, `newProducts`, `ambiguousLegacy`,
   `skippedDuplicateInventoryKey`, `fieldChanges` — for a sanity check
   against the current ~566-product catalog.
3. Confirm `ambiguousLegacy` is 0, or that any non-zero cases have been
   reviewed manually.
4. Run `runProductCatalogMaintenance()` for real once the dry run looks
   right, then re-check Product Catalog directly for duplicate `PRODUCT
   KEY`/`MATCH KEY` values (the script's own `pcmAuditDuplicates_` also
   does this automatically after a real run and throws if it finds any —
   but that happens after the write, so it's a safety net, not a
   pre-check).
5. Only then re-enable the trigger.

`WebsiteExport_Airtable_Sync_v2.js` is a separate trigger/schedule from the
Product Catalog maintenance one and can be tested independently at the
current small record count. Before pointing it at the full ~566-product
catalog on a recurring schedule, add the rate-limit handling noted above.

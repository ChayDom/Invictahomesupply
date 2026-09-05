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
- `WebsiteExport_Airtable_Sync_v2.js` — **not yet received.** Pending before
  this folder (and the Website Export → Airtable field mapping) can be
  considered complete.

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

**Still waiting on `WebsiteExport_Airtable_Sync_v2.js` before the trigger
question can be answered in full** — the Website Export mapping for the 5
new Flooring fields, and how it upserts into Airtable's `Website Products`
table, haven't been reviewed yet.

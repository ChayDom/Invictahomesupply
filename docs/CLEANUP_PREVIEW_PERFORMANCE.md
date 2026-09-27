# Sold-out cleanup preview performance

`runSoldOutCatalogCleanup()` remains preview-only by default. The production
Script Property `CATALOG_LIFECYCLE_CLEANUP_ENABLED` must remain `false` until a
separate owner-approved destructive-cleanup release; this work does not enable
it. No cleanup trigger is installed by this change.

The unscoped preview used to re-read `Inventory Source Evidence` and `Product
Inventory` for every Catalog key. At 562 synthetic products and 2,999 source
rows, the old path made 2,815 `getRange` calls to **each** of those two sheets
and one paginated Airtable fetch. The main cost was Spreadsheet service calls,
not N+1 Airtable calls. The archived journal was also searched linearly for
each key, and source rows were repeatedly filtered and mapped.

The new preview takes one bulk snapshot of Catalog, Archive, Source Evidence,
Product Inventory, and the four necessary Airtable fields. It validates every
archive hash and rejects duplicate permanent keys before reporting candidates.
It builds in-memory Product Key and source-identity indexes, then evaluates
each Catalog/journal key once using the existing authoritative source-stock
rules. It reports candidates, rejection reasons, active positive/zero/unknown
counts, timer counts, elapsed milliseconds, stage timings, and actual Airtable
fetch attempts. Every preview result is a read-only snapshot; a candidate is
not authorization to delete.

The `apply:true` path is unchanged. It still requires the disabled-by-default
opt-in and performs fresh source, Airtable identity, archive-hash and catalog
rechecks immediately before destructive operations. Do not set the opt-in,
run apply, or add an automatic cleanup trigger as part of preview validation.

The preview's timing stages are Catalog read/identity, Archive read/hash,
Source/Inventory read/index, Airtable fetch, and in-memory match. Individual
Spreadsheet `getRange` calls are not monkey-patched in production; the local
synthetic profiler records exact counts. With 562 products and 2,999 source
rows, the optimized path made five `getRange` calls per Source and Product
Inventory sheet, one Airtable bulk fetch, and took 32 ms in the isolated local
model. Native Spreadsheet service latency is different; use a complete native
production preview to establish actual elapsed runtime.

For production acceptance, run `runSoldOutCatalogCleanup()` **without** an
`apply` option after verifying the exact bound project/workbook and that the
cleanup property is `false`. Review all returned candidate Product Keys and
reasons. Zero eligible means no deletion is proposed. Do not act on candidates
until the owner separately approves a destructive-cleanup process.

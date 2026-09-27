# Merchandise sold-out lifecycle — staging candidate

Catalog / Export remain 29 columns; K2 owns AUTO BOX PRICE. Netlify and browser
inventory remain read-only. Controlled Apps Script maintenance owns cleanup.

## Active versus historical

Active: Product Catalog, Website Export, Airtable Website Products and customer
inventory. Read-only history: retailer purchase/sales source sheets, Current
Inventory transactions, Product Inventory buy/sold/batch aggregates, and Product
Catalog Backup 2026-09-26. Social Queue keeps approvals/captions/Buffer history.

Do not physically delete Catalog rows: this can move formula/reference positions
and the K2 spill origin. Instead clear A:J and L:AC (header-resolved), preserving
K, row positions and formatting. Blank slots are not active records; trailing
slots may be reused. Old keys survive only in the separate archive.

## Inventory / boundary

- Flooring: finite nonnegative Available Sq Ft, falling back to finite nonnegative
  Quantity Available. Other categories use quantity.
- Positive: In Stock, clear Sold Out Since, same active key/record. Deliberate
  positive non-flooring Reserved/Draft holds remain exceptions.
- Unknown/blank/null/invalid: Contact for Availability, clear timer, keep active.
- Zero: Sold Out, first confirmed-zero UTC timestamp once; repeated zero never
  resets it. Sold Out overrides the existing seven-day NEW badge.
- Hide/cleanup eligibility: `now >= Date.parse(Sold Out Since) + 864000000`.
  Ten full 24-hour days, not calendar days. Missing/invalid time fails open for
  browsing and closed for deletion. Unknown/restocked products ignore old time.
- Before backend cleanup, expired direct links can still show the sold-out item;
  after fresh inventory no longer contains it they show not found. Normal caches
  are not immediately purged across all devices. Cache v8 invalidates old status
  mappings; open browsing tabs still rerender at the exact expiration boundary.

## Lightweight archive / retry journal

`Product Catalog Archive` has 18 header-resolved columns, not a full catalog copy:
Product Key, Product ID, Retailer, Retail SKU, Display Name, Source Item, Category,
Subcategory, Sold Out Since, Archived At, Removed At, final sell/comparable prices,
final quantity, Product URL, Cleanup State, Airtable Record ID, Snapshot Hash.

Order under the existing ScriptLock:

1. Require unique identities, fresh source quantity exactly zero, Airtable
   confirmed zero, valid timestamp, and the complete retention interval.
2. Archive metadata; flush/verify readback and immutable snapshot hash.
3. Recheck source/remote identity, timestamp and stock; delete that exact Airtable
   record and verify absence. Journal AIRTABLE REMOVED.
4. Re-find catalog by permanent key, clear the two value ranges around K, verify
   absence, then journal COMPLETE / Removed At.

Archive failure retains both active records. Remote deletion failure retains
Catalog and one ARCHIVED journal. Retries handle lost delete acknowledgements,
partial catalog clearing and lost final acknowledgements without duplicate
archives or key resurrection. This is a resumable transaction, not an atomic
transaction across Sheets/Airtable. Stock is rechecked immediately before delete;
external source edits are not locked by ScriptLock and cannot be made atomic.

Before removal, a restock/unknown cancels a pending journal (CANCELLED). A later
complete zero interval can re-arm that unsuccessful row. Completed archive
history never changes. Missing archive identities/invalid states abort
maintenance; corrupted snapshot hashes block destructive retries.

## Identity / export / enrichment / social

Active SKU correction keeps permanent key and Airtable record. After COMPLETE,
zero/unknown historical sources cannot recreate the product. Confirmed positive
reacquisition receives ACQ-UUID, current retailer/SKU Product ID, and PENDING
enrichment. Existing enrichment and manual publication approval still apply;
no automatic approval is added. Upsert remains keyed only by Product Key.
New record Date Added supports NEW; archived key/date is never reused.

Archive is not an enrichment input. Retired keys cannot enter Social Queue or
publish via a stale export. Sync cannot recreate a deleted pending/complete key;
existing pending records can still report restock or uncertainty.

The old Export qty>0 filter must go, but merely removing it is unsafe: its
missing-catalog fallback exposes historical source keys. The prepared
`test/fixtures/website-export-lifecycle.formula` includes zero/unknown ONLY with
an active Catalog Product ID and nonblank permanent key. No fallback identity.
MAP gives an explicit row-wise active mask. Quantity blanks are preserved;
Available Sq Ft uses current quantity/current catalog pack size. U2:AC2's nine
existing permanent-key lookups remain unchanged. This avoids Product Inventory
J's old key lookup losing coverage with a new ACQ key; accounting formulas remain
untouched. IFNA handles an empty active set.

Formula is prepared/contract-tested, NOT applied to production and NOT executed
in native isolated Sheets yet. Native formula/spill acceptance is still required;
the VM workbook model is not the Sheets engine.

## Opt-in / staging safety

`runSoldOutCatalogCleanup()` previews only. Applying requires explicit Script
Property CATALOG_LIFECYCLE_CLEANUP_ENABLED=true and `{apply:true}`. Optional
`productKeys` scopes the run. Existing catalog maintenance invokes cleanup under
its lock only when enabled. No new trigger is installed. AIRTABLE_BASE_ID supports
the isolated test base; the original production fallback is unchanged. Add Sold
Out Since datetime to production before any separately approved release.

Live acceptance executes actual Apps Script in a VM, with durable isolated local
workbook data and real staging Airtable. Clock advancement tests the ten-day
boundary; it never fabricates a historical first-zero date. Only newly-created
synthetic keys may mutate. This proves real upsert/delete, NOT a deployed bound
project. Netlify secret retrieval can be unavailable; the authorized Airtable
connector fulfills the transport without exposing/changing that secret.

No production workbook, Apps Script, triggers, Airtable, subscriber, email or
social writes. Production prerequisites: native isolated formula/K2 acceptance,
bound-project staging execution, archive permissions/backup, review of preview,
explicit cleanup opt-in, proper Airtable schema/token permissions and release
approval. Test suite: full units, Apps Script lifecycle/failures, Chromium and axe.

## Fulfillment (unchanged)

Local Pickup Only • McKinney, TX

Flooring is currently available for local pickup in McKinney, TX. We do not currently ship individual flooring orders.

Local delivery is available for an additional fee. Contact us for a delivery quote.

No customer-facing freight/pallet wording is restored.

# Active-only merchandise lifecycle

Product Catalog and its formula-driven Website Export contain active lifecycles
only. Both schemas remain 29 columns. Source/accounting sheets are read-only.
Product Catalog Archive permanently retains sold-out identity/history.

## Immediate retirement and retained display

Under the existing ScriptLock, the existing six-hour maintenance handler:

1. Requires unique permanent Product Keys and authoritative CONFIRMED ZERO.
2. Forces the exact Catalog row's POST TO WEBSITE to No.
3. Observes zero/Status Sold Out on an **existing** Airtable record, preserving
   Photos, prices, display permission, and its first Sold Out Since. A missing
   timestamp is stamped once. A malformed timestamp requires manual review.
4. Writes one RETIRING archive snapshot, flushes, reads back, and verifies its
   hash. It also freezes matching source rows and non-K Catalog values.
5. Rechecks source evidence and the exact Catalog row. Concurrent owner edits
   cause a safe hold, not a broad rewrite or a silent loss of curated fields.
6. Marks every product social occurrence Skip, preserving captions, receipt
   cells/notes and historical Buffer journals. Evergreen is never touched.
7. Rechecks source evidence, clears only header-resolved non-K Catalog ranges,
   flushes, and verifies absence from Catalog and active Website Export.
8. Journals ARCHIVED: active retirement finished; remote retention pending.

No physical Catalog row deletion or K value/formula write is performed. K2 and
its MAP spill remain workbook-owned. No source-derived rows are deleted.

Never-published products with no Airtable record are archived without creating
one. Their verified absence is recorded in the archive's source manifest.

The website's read-only API selects Airtable Post to Website=true. For an old
record, this flag means **retained sold-out display**, not active Catalog/social
publication. Normal sync excludes all retired keys from writes and stale
unpublishing; only lifecycle cleanup owns their fixed zero/timer observation.
It never recreates an absent old key or merges identities by SKU.

The migration may restore explicitly owner-approved old sold-out display
permissions, without resetting Sold Out Since. There is no automatic permission
grant for new/returned inventory or previously unpublished products.

## Exact retention and cleanup

Retention is exactly `10 * 24 * 60 * 60 * 1000 = 864000000` milliseconds.
Before `now >= Sold Out Since + 864000000`, remote records remain. At that exact
boundary the backend requires:

- valid archive/hash, exact permanent key, fixed timestamp and saved record ID;
- unchanged zero evidence for the **old acquisition**, not aggregate new stock;
- old key absent from active Catalog and Export;
- fresh remote identity, zero quantity/coverage and matching timestamp.

Delete only that exact record ID, verify absence, journal AIRTABLE REMOVED, then
COMPLETE / Removed At. A missing record is verified absent rather than recreated.
A never-published lifecycle also completes after retention without a remote
write. ARCHIVED does not require an active Catalog snapshot to finish cleanup.

RETIRING separates an interrupted first phase from completed active retirement.
Retries finish partial non-K clearing, lost finalization and lost delete
acknowledgements without duplicate archives. A finalized old key reappearing in
Catalog blocks cleanup; it is never silently cleared/reactivated.

## Source evidence and new acquisitions

The archive adds one optional `SOURCE EVIDENCE` column; no Catalog/Export schema
change. It stores a versioned source-row multiset and non-K Catalog snapshot.
Its content participates in the existing immutable snapshot hash. Legacy archive
hashes remain valid without that field; historical rows are never silently
rehashed. Legacy histories lacking frozen evidence require manual review before
opening a later acquisition.

Every original source row must remain present and unchanged, including duplicate
multiplicity and zero balance. Additional matching rows must have valid positive
purchase quantities, reliable balances, and Buy Date strictly later than Archived
At. Undated/same-day ambiguous additions, missing originals and accounting
corrections fail closed. Aggregate positive inventory must be explainable by
later acquisitions; it is not authority to cancel old history.

A confidently later positive acquisition can open `ACQ-<UUID>` while A is still
ARCHIVED. B uses the current retailer/SKU Product ID, PENDING enrichment and blank
manual publication permission. A and B may overlap in Airtable: A sold out, B
active. B receives its own social occurrence and cannot reuse A's approval/media
or receipts. B's positive quantity never prevents safe old-A deletion.

Before active clearing, an original-source correction can cancel an unfinished
transition (CANCELLED). After clearing, original-source changes require manual
recovery with preserved source/archive evidence; never resurrect the old key.
UNKNOWN never starts a transition, clears Catalog, deletes remote records, or
automatically creates a new lifecycle.

## Operations and verification

`runSoldOutCatalogCleanup()` defaults to a full read-only preview, including
action, archive state, timestamp, remote identity, social statuses/receipt flags,
and later acquisition evidence. Optional productKeys scopes existing execution.
Review all real migration keys before one controlled maintenance run.

Keep `CATALOG_LIFECYCLE_CLEANUP_ENABLED=true`. No new flag or trigger is needed.
The intended trigger set remains maintenance, Airtable sync, enrichment and
social publishing. Their existing settings/cadence are unchanged by this change.
Normal send-time stock/Photos validation remains the final social safety layer.
ScriptLock does not lock external owner/source edits; fresh rechecks narrow, but
cannot eliminate, the cross-service race window.

Backend-only releases use `[skip netlify]`, including their merge commit. Do not
trigger a website deploy. Unit coverage includes immediate retirement, exact
expiry, same-SKU overlap, unknown/corrections, owner edits and phase retries;
existing Chromium regression checks remain required before rollout.

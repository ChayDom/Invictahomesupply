# Backend automation acceptance and Buffer recovery

This pass changes only Buffer publishing/reconciliation helpers, isolated tests, and this runbook. No frontend, Netlify, enrichment policy, Catalog/Export schema, lifecycle eligibility, or automatic cleanup changes.

## Architecture and failure mode

The previous sender holds ScriptLock but only stores a Buffer ID **after** remote creation. A successful remote request followed by a local write failure or lost response can leave a Ready/Error row without an ID; resetting Ready could then create a duplicate.

Buffer's [documented CreatePostInput](https://developers.buffer.com/types/CreatePostInput.html) has no documented native idempotency key or client mutation ID. Do not assume an undocumented HTTP header deduplicates this mutation. The [posts query](https://developers.buffer.com/examples/get-paginated-posts.html) provides read-only cursor pagination; exact channel/text/asset matches can recover a receipt, but a missing match cannot prove a timed-out request failed.

The production Social Queue has a strict seven-option status dropdown. Preserve it and all 19 columns. The existing FB/IG BUFFER POST ID cells own the operation:

- Cell value: acknowledged remote post ID, as before.
- Cell note: versioned JSON publishing intent/receipt. Includes permanent Product Key, channel, approved text/media/source hash, deterministic SHA-256 operation key, approved-row fingerprint, first attempt time, state and remote ID when acknowledged.
- Existing Error status plus ERROR text represents PUBLISHING/RECONCILE; existing Queued status represents both-channel acknowledgement. No separate ledger, properties store or product identity is created.

## Guarded send sequence

1. Retain the existing ScriptLock, Website Export eligibility/source-hash checks, image-only policy, one-product-per-run and rolling 48-hour gate.
2. Re-read the row under lock. Reject duplicate/missing keys, changed approval/content, unknown or corrupted notes, or changed operation/channel fingerprints.
3. Read all six remote post statuses using bounded cursor pagination (50/page; maximum 20 pages; truncated/malformed listings fail closed).
4. A unique exact channel/text/single-asset match recovers the remote ID. Multiple matches require owner review.
5. A new operation with no prior intent/error and no remote match persists intent in its ID-cell note, changes status to Error with PUBLISHING explanation, flushes, reads it back, and rechecks the row **before** creating remotely.
6. After success, persist ACKNOWLEDGED plus remote ID in the note before writing the ID value. Both successful receipts result in Queued as before.
7. A prior intent, historical Buffer send error, timeout, crash or uncertain acknowledgement with no provable match **never creates again**. It remains Error/RECONCILE. Absence, eventual consistency, deletion, altered remote media, missing authorization or pagination limits are not proof of failure.

Do not clear ID-cell notes, clear receipts, or reset an ambiguous row to bypass review. Ordinary cell-value/source-sync edits preserve notes and cause fingerprint mismatch rather than a new post. Deliberately removing the journal destroys evidence and is outside the supported retry workflow. For historical receipts without notes, existing nonblank IDs are preserved and never recreated.

`auditSocialBufferQueue()` is read-only: bulk-reads Buffer, reports queue statuses/Ready keys, missing saved IDs, exact-content duplicates and historical uncertain Buffer rows. It has no mutation or Sheet write. It must not be confused with `sendReadySocialPostsToBuffer()`.

## Acceptance evidence (2026-09-27)

- Three registered production Head triggers owned by chytu589@gmail.com; project timezone America/Chicago. Maintenance every 6h; Airtable daily midnight–1 AM; enrichment daily 3–4 AM. No social/cleanup registration.
- Maintenance actual Time-Driven run at 6:00:42 PM: Completed, 4.49 seconds; 562 checked, no findings, zero updates/additions. Current sync/enrichment registrations await their next daily windows; earlier pre-rollout executions do not establish acceptance for these registrations.
- Normal `runCatalogEnrichment()` manually exercised one disposable PENDING Catalog fixture in blank row 564, POST TO WEBSITE=No, at 6:15:16 PM. `gemini-3.5-flash-lite`, POST `https://generativelanguage.googleapis.com/v1beta/interactions`, google_search enabled. One processed, zero failed, one NEEDS REVIEW. Structured response parsing and status/notes writeback succeeded; verified-content safeguards correctly withheld customer-facing content.
- All 562 real Catalog rows were identical before/after that run. Fixture input was restored to blank using only A:J and L:AC user-entered values; row validation and K2 MAP formula retained. No website/Airtable/social publication of the fixture.
- Initial production Social Queue audit: 64 products: Ready 20, Queued 7, Draft 23, Needs Image 9, Error 3, Skip 2. Seven rows have both channel IDs; no partial ID rows. All 20 Ready rows have media/captions/source hash and could publish if posting is enabled. The Dyson row HD-1007846436 has a historical Buffer address-unavailable error and neither receipt; remote outcome requires reconciliation, not a blind retry.
- Live read-only Buffer audit at 6:25:22 PM completed successfully: 25 remote posts across all six statuses; no exact channel/text/asset duplicates. Twelve of fourteen historical saved IDs were found. Lake Annette HD-1004669158 (row 7) has two saved IDs absent from the complete listing; Dyson HD-1007846436 (row 13) has no provable remote match. Do not clear these receipts or assume missing posts mean a create never succeeded. Owner review is required for both rows and the 20 Ready approvals.
- Buffer documents `saveToDraft:true` as non-publishing. The guarded helper supports this only when explicitly passed by controlled acceptance; the normal sender never supplies it. A remote draft is not silently treated as a queued live receipt. Live draft acceptance uses one synthetic queue fixture under ScriptLock with social triggers absent; verify draft state, intentionally remove only its local ID, reconcile the same remote ID, and remove only the verified synthetic draft/fixture. No scheduled/sent post may be created or deleted by this acceptance helper.
- The live draft create/retry/delete test was **not executed**: action-time confirmation for deleting that exact synthetic cloud draft is pending. No Buffer mutation or synthetic Social Queue fixture was created. Remove the unexecuted temporary Apps Script acceptance helper before handoff; retain its local source for a later explicitly approved test. Live read-only reconciliation passed; remote-create acceptance remains outstanding rather than being reported as successful.
- **Social posting remains OFF.** Owner must review the 20 Ready approvals and any unresolved remote evidence before activation. Do not call setupDailySocialTriggers: it also restores preparation/email jobs and replaces registrations, beyond the intended narrowly approved posting restoration.
- **CATALOG_LIFECYCLE_CLEANUP_ENABLED remains false.** Do not run apply or create a cleanup trigger. Future real candidate approval is a separate owner decision.

## Regression coverage

`test/buffer-idempotency.test.mjs`: first send, successful retry/already-Queued row, local ID-write failure, accepted-request timeout, crash after durable intent, overlapping ScriptLock acquisition, existing remote receipt, no-match historical uncertainty, edited/malformed row, changed approval, duplicate keys/matches, invalid pagination, read-only audit, draft-only retry, and rejection of draft-as-queued confusion.

`test/gemini-connectivity.test.mjs`: normal Interactions request/parsing/review writeback isolated to fixture; missing/invalid production credential fails safely without substitution; legacy PENDING exclusion unchanged. Existing lifecycle/source/archive tests remain required.

Final local suite: **789 passed, 0 failed across 42 files** (15 Buffer tests and 4 Gemini tests). Run on an isolated LF-normalized copy to accommodate existing newline-sensitive fixtures on Windows; tracked source and the preserved untracked patch were not normalized or overwritten. JavaScript syntax checks and `git diff --check` passed. No website browser suite or Netlify deployment was needed for this backend-only change.

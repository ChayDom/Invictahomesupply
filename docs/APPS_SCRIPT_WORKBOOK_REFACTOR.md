# Apps Script current-workbook refactor and acceptance

Status: local refactor and mocked verification; **not production-complete**.
Mandatory actual-workbook new-item and SKU-correction acceptance is pending.
Workbook: Invicta Inventory & Product Catalog,
`1mB0F1zDjy0BoJvEKU81Z-WnGlkSJOPM6cwNUR3a7Oj4`.

## Assessment and interruption recovery

The existing architecture was preferable to a replacement: retain formula-driven
Website Export, Airtable's permanent-key upsert/retry/unpublish logic, Gemini
transport and Social Queue's approval hash. The old maintenance and legacy paths
duplicated reconciliation and depended on deleted/positional fields. They now share
one header-based preflight planner; no second identity engine, migration or export
formula generator was added.

Recovery reviewed git status, diff/stat, untracked files, branch and the last ten
commits before further edits. Branch: codex/appscript-current-workbook, based on
59e3249. No new refactor commit was assumed successful.

| Recovered file | Classification at recovery | Follow-up |
|---|---|---|
| Config.js | Incomplete but salvageable | Header/schema/orphan-row tests |
| ProductCatalogMaintenance.js | Incomplete but salvageable | Identity, append, validation and spill tests |
| LegacyRepair.js | Incomplete but salvageable | Shared planner and unchanged-key tests |
| AdminTools.js | Complete and correct on inspection | Duplicate/orphan audit tests |
| Code.js | Complete and correct on inspection | Current architecture documentation |
| CatalogEnrichment.js | Incomplete but salvageable | Flooring tests; preserve numeric zero/manual edits |
| EnrichmentAdmin.js | Complete and correct on inspection | Current-schema queue/audit tests |
| WebsiteAirtableSync.js | Incomplete but salvageable | Permanent-key and comparable-price mock integration |
| BufferSocialSync.js | Complete and correct on inspection | Real queue-handler mock regression |
| node_modules / sibling npm-cache | Interrupted local setup, not source | npm ci rerun successfully |

All recovered JavaScript parsed; manifest/package/lock JSON parsed. No truncated
files, duplicated partial fixtures, debug source files or partial config were found.
Package.json, package-lock.json, appsscript.json and Playwright config were unchanged.
Tests/documentation had not yet been created; correct recovered work was preserved.

Additional changes: this document, architecture documentation, README,
test/appscript-workbook.test.mjs and two small Windows test portability repairs
(run-unit-tests.mjs and edge-function-config.test.mjs). Git's Windows checkout had
CRLF while stylesheet-inspection tests expect LF; local HTML/CSS line endings were
normalized to repository LF without changing their Git content.

## Runtime changes and contracts

- Config.js provides normalized header → index helpers and exact 29-column validation.
- Maintenance explicitly populates supported source fields and PENDING; never copies
  identity values from a preceding row.
- Permanent key/current ID/current SKU matching precedes a unique retailer/source-title
  fallback. Duplicate, conflicting and ambiguous identities fail before writes.
- Source refresh/legacy repair use the same planner and do not append new products.
- Source attributes and verified enrichment fill blanks; manual controls/prices/image
  and curated content survive. SKU/ID/source identity refresh on the same row.
- K2/spill values and formulas are never written. New row value writes skip that
  column, but full-row formatting includes it. J/K/L inherit their existing column
  currency formats from the prior catalog row (row 2's template for an empty catalog).
  Validation and non-price numeric formats are applied explicitly.
- Flooring enrichment includes coverage, thickness, wear layer, underlayment, water
  resistance and card specs. EXACT/HIGH/cited results require 3–5 valid short highlights.
- Comparable retail maps to existing Airtable Was Price. Upsert identity stays Product Key.
- Social Queue media, approval, IDs/history and SOURCE HASH behavior are retained.

### Approved-architecture follow-up: formatting and enrichment safety

These fixes do not change the 29-column schema, permanent identity model, K2 MAP
ownership or publishing architecture. PASTE_FORMAT is separate from value/formula
writes and safe on K; price formats come from the existing workbook, not an invented
currency pattern. If authoritative template formatting is wrong, correct it manually
in an approved workbook review rather than guessing a locale/format in code.

Automatic enrichment skips LEG-/LEGACY| permanent keys, including PENDING rows.
It also skips rows with both DESCRIPTION and HIGHLIGHTS populated, even with blank
or PENDING status; missing optional specs alone do not justify another Gemini call.
Incomplete non-legacy rows with source titles and blank/PENDING status remain eligible.
All other statuses, including STANDARD, NEEDS REVIEW, FAILED, PROCESSING and
ENRICHED - VERIFIED, remain excluded from unattended retry.

queueMissingCatalogEnrichment is an intentional manually invoked bulk helper for
eligible standard products only; it now shares the nightly gate and cannot turn a
legacy/excluded/completed row into an automatic candidate. There is no targeted legacy
override in this snapshot. Deliberate legacy research must use a separately reviewed
manual workflow; neither setting PENDING nor invoking the bulk helper authorizes it.
No deleted workbook column or hidden persistent approval flag is introduced.

Follow-up tests add four formatting cases (existing capacity, physical insertion,
reordered columns plus insertion, empty-catalog template) and five eligibility/queue
cases (both legacy prefixes, normalized legacy key, completed content, intentional
standard-only bulk requeue). Two existing queue/orchestration fixtures now use standard
keys rather than accidentally proving a legacy auto-enrichment path.

No old catalog column-number map remains. Numeric 1/2 used in ranges mean header/data
start rows, not legacy schema positions. The 19 Social Queue column positions are
intentionally retained: its existing full-order validator protects the Buffer handlers'
operational row contract. Header maps use zero-based indexes; SpreadsheetApp ranges
use one-based resolved indexes.

## Removed dependencies and repository search

Removed runtime dependencies: MATCH KEY, SOURCE CATEGORY, CURRENT SYNC HASH,
LAST SYNCED HASH, CONTENT LOCKED, ENRICHMENT CONFIDENCE, LAST ENRICHED AT.
Website Export's obsolete SYNC HASH slot is COMPARABLE RETAIL PRICE.
No deleted field is recreated. This paragraph is the intentional historical search
match; the rest of the code/docs use current architecture. Social Queue SOURCE HASH
is not one of those deleted fields and remains an active approval safeguard.
Gemini's JSON confidence and search's grounding confidence are not catalog columns.

Repeat the full tracked-file search before release:

```powershell
git grep -n -i -E 'match[ _]key|source[ _]category|current[ _]sync[ _]hash|last[ _]synced[ _]hash|content[ _]locked|enrichment[ _]confidence|last[ _]enriched[ _]at|sync[ _]hash'
```

Expected text matches: only this explanatory removal/search section. The tracked
historical architecture .pptx is also a binary match: its pre-refactor schema labels
are superseded, explicitly marked historical in INVICTA_ARCHITECTURE.md, and are
not runtime dependencies. The deck is preserved rather than silently rewritten.

## Tests and limitations

The focused Apps Script suite executes actual maintenance, enrichment orchestration,
Airtable sync and social queue handlers with mocked services. Its export lookup fixture
models the specified formula contract; it does **not** execute Google's live formula.
The spreadsheet mock rejects any write intersecting AUTO BOX PRICE.

Coverage: normalized/reordered/missing/duplicate headers; new products; idempotency;
legacy and standard SKU corrections; immutable keys; identity conflicts/orphans;
refresh and repair wrappers; flooring enrichment; concurrent human edits/numeric zero;
uncited/ambiguous results; concise highlight rules; queue eligibility; same Airtable
record after correction; comparable retail; unchanged sync; duplicate-key failures;
retained social approvals/media/IDs and changed-source reapproval.

Run `npm run test:unit`, `npm run test:e2e`; optionally Firefox/WebKit.
All local network behavior is mocked. Never run live sync/publish functions against
production simply to satisfy a test.

### Execution results (2026-09-26)

| Check | Result |
|---|---|
| npm ci with workspace-local cache | Passed; 9 packages installed |
| node test/appscript-workbook.test.mjs | 32 passed, 0 failed (9 follow-up cases added, 2 fixtures updated) |
| npm run test:unit | 558 passed, 0 failed; 32 files |
| playwright test --project=chromium --project=webkit --workers=2 --global-timeout=180000 | Chromium 80 + WebKit 80: 160 passed, 0 failed (1.4m combined) |
| Optional Firefox | Startup stalled; combined optional run stopped; no passing result claimed |
| Apps Script JS syntax / manifest, package, lock JSON | Passed |
| git diff --check | Passed |
| Live deployed-site smoke | Not run; no target supplied, not a workbook acceptance substitute |
| Actual-workbook acceptance / live Gemini, Airtable, Buffer | Not run; requires explicit owner approval |

The first full unit attempt exposed a Windows file-path import bug; the next exposed
tsx's os.userInfo failure in this restricted runtime. The runner now uses available
native type stripping (Node 24 here), retaining tsx for Node 20. Edge config imports
use file URLs. Windows CRLF checkout also caused CSS-inspection failures; restoring
the repository's LF checkout content resolved these without frontend changes.
No failed check was silently counted as passing. Node 20's fallback was not executed
locally; the existing CI environment remains the verification point for that path.

### Changed files

Nine recovered/refined Apps Script files: AdminTools.js, BufferSocialSync.js,
CatalogEnrichment.js, Code.js, Config.js, EnrichmentAdmin.js, LegacyRepair.js,
ProductCatalogMaintenance.js and WebsiteAirtableSync.js (under Invicta Appscript Files/).
Other changes: README.md; docs/INVICTA_ARCHITECTURE.md;
docs/architecture/Invicta-Home-Supply-System-Architecture.md;
docs/APPS_SCRIPT_WORKBOOK_REFACTOR.md; test/appscript-workbook.test.mjs;
test/run-unit-tests.mjs; test/edge-function-config.test.mjs. Total: 16 files.

No package/lock, manifest, Playwright config, frontend, Netlify or workflow content
changed. Downloaded browsers, node_modules, reports and npm cache are local setup/
generated artifacts, not source changes. There was no reset/discard of recovered work.
Changes remain uncommitted and unpushed on codex/appscript-current-workbook.

## Exact manual preparation before release

1. Review the feature-branch diff; do not merge/deploy automatically.
2. Export/back up the current bound Apps Script project and workbook. Record catalog
   counts/keys, original K2 formula, export formula and installed trigger list.
3. Create an isolated workbook/project copy with the same headers/formulas, safe
   Airtable sandbox destinations and disconnected Buffer posting. Do not change the
   live schema or introduce new columns. Check Gemini/Airtable Script Properties
   without committing credentials.
4. Copy the reviewed nine changed .js snapshots into the isolated project. Keep
   existing manifest/timezone. Do not call setupCatalogEnrichmentTrigger.
5. Verify all 29 Product Catalog and all 29 Website Export headers below. Check the
   existing K2 formula reaches newly inserted rows. Confirm SKU columns remain text
   where necessary to preserve leading zeros.
6. Run auditProductCatalogDuplicateKeys({throwOnIssues:true}) in the isolated project.
   Resolve issues manually, preserving every permanent key; never rebuild the catalog.
7. Execute the entire acceptance test below in the copy. Collect screenshots/values,
   counts and original Airtable record ID. A failure blocks approval.
8. Obtain explicit maintainer approval for production code installation and the
   controlled actual-workbook acceptance run. Neither is authorized by this refactor.
   Preserve existing triggers; review them manually, do not recreate them.
9. During an approved release window, a maintainer copies reviewed code to the actual
   bound project, runs the same controlled acceptance checklist, records evidence and
   monitors executions. Never send live Buffer posts as an incidental test.
10. If release fails, restore backed-up code and inspect any partly written rows before
    resuming. Do not delete products, rewrite permanent keys or reset Airtable.

## Mandatory end-to-end acceptance

Execution status: **NOT RUN against the actual workbook.**
Owner/date/product/key/original row/Airtable record ID/result: pending.

Use ONE entirely new, verified flooring product through the normal retailer/master
process so R:X and case pricing are exercised. Use confirmed source facts and citations;
mark truly unavailable facts blank/not applicable rather than guessing.

1. Record starting catalog row count, existing keys, K2 formula and export formula.
2. Add the new product through the normal source/master sheet, with reliable Retail SKU,
   retailer, source item, category and known structured facts.
3. Run the normal Current Inventory/Product Inventory process; verify exactly one
   current product with correct SKU, ID and inventory.
4. Run runProductCatalogMaintenance; verify exactly one appended catalog row and no
   missing identity/source fields. Record its permanent key and row number.
5. Inspect every field in the following A:AC matrix. Record actual value and classify
   each as populated, blank/manual or not applicable, with a reason.
6. Enter deliberate manual sell price, comparable retail, publish choice and image as
   applicable. Confirm K's box price appears from unchanged K2 (coverage × sell price);
   there is no new per-row formula. Check validation/formatting on the appended row.
7. Run controlled enrichment; verify applicable verified fields, R:X and 3–5 highlights
   of at most eight words each. Unverifiable facts remain blank; uncertainty is review.
   Confirm manual values are unchanged; retain citation evidence.
8. Run maintenance again: exactly one row for that key/product, no duplicate, same key.
9. Check Website Export: one product, original permanent key, current SKU, inventory,
   material price, box price, comparable retail, publish gate and applicable specs.
10. In the authorized isolated/controlled destination run Airtable sync: exactly one
    record keyed by the permanent key. Record Airtable record ID, Date Added and fields.
11. Run Social Queue generation only where applicable: same key, content hash/media/
    captions/approval/Buffer operational fields intact. Do not publish a Buffer post.
12. Deliberately correct Retail SKU in the SAME source/master product to another
    confirmed valid SKU; retain its retailer and source item so reconciliation is
    unambiguous. Run normal inventory regeneration and catalog maintenance.
13. Verify same catalog row and original permanent key, updated SKU and generated
    Product ID, no duplicate. Rerun maintenance to confirm idempotency.
14. Verify Website Export looks up the new current ID but returns the original key.
    Run authorized Airtable sync and confirm SAME record ID/key, updated SKU and
    preserved Date Added; no additional Airtable record.
15. Verify curated/manual fields and K2 remain unchanged and Social Queue still targets
    that key. Record before/after evidence. Owner signs off only after all steps pass.

### All 29 catalog fields

P = populated where supported by verified source/enrichment. M = blank/manual until
deliberately supplied. NA = not applicable only with a recorded reason. Capture both
initial maintenance and post-enrichment/correction values for EVERY field.

| Column | Authoritative header | Expected classification / evidence |
|---|---|---|
| A | DISPLAY NAME | P: source display/title; existing curated name retained |
| B | RETAILER | P: source retailer |
| C | RETAIL SKU | P: initial SKU, then corrected SKU |
| D | BRAND | P if confirmed; otherwise blank/NA |
| E | MODEL | P if confirmed; otherwise blank/NA |
| F | WEBSITE CATEGORY | P: source/verified approved category |
| G | WEB SUBCATEGORY | P if available; otherwise blank/NA |
| H | UNIT TYPE | P if source/verified; record actual unit |
| I | SQ FT PER UNIT | P for test flooring: verified coverage |
| J | SELL PRICE ($/SQ FT OR EACH) | M: enter explicit sell price, preserve it |
| K | AUTO BOX PRICE | P after I/J: derived ONLY from unchanged K2 |
| L | COMPARABLE RETAIL PRICE | M: verified comparison, preserved |
| M | POST TO WEBSITE | M: explicit Yes/No, never inferred by maintenance |
| N | STOCK IMAGE URL | M or verified safe enrichment image; preserve curated image |
| O | PRODUCT URL | P if confirmed; otherwise blank/NA |
| P | DESCRIPTION | P for verified enrichment; otherwise blank + review |
| Q | HIGHLIGHTS | P: 3–5 bullets, each <=8 words |
| R | THICKNESS MM | P for applicable flooring, numeric verified fact |
| S | WEAR LAYER MIL | P if applicable/verified; NA for no wear layer |
| T | UNDERLAYMENT ATTACHED | P if verified Yes/No; otherwise blank |
| U | WATER RESISTANCE | P if verified allowed value; otherwise blank/Unknown |
| V | CARD SPEC 1 | P if confirmed, concise; otherwise blank/NA |
| W | CARD SPEC 2 | P if confirmed, concise; otherwise blank/NA |
| X | CARD SPEC 3 | P if confirmed, concise; otherwise blank/NA |
| Y | ENRICHMENT STATUS | P: PENDING → PROCESSING → verified/review/failed |
| Z | NOTES | Blank initially; P for citation/diagnostic evidence |
| AA | PRODUCT KEY | P: permanent; identical before/after correction |
| AB | PRODUCT ID | P: current retailer/SKU; changes on correction |
| AC | SOURCE ITEM | P: normal source title, same product provenance |

### Website Export: 29 authoritative headers

```text
PRODUCT KEY | DISPLAY NAME | CATEGORY | BRAND | MODEL | RETAIL SKU | RETAILER
QUANTITY AVAILABLE | UNIT TYPE | SQ FT PER UNIT | AVAILABLE SQ FT | WEBSITE PRICE
DESCRIPTION | HIGHLIGHTS | PRODUCT URL | STOCK IMAGE URL | POST TO WEBSITE
ENRICHMENT STATUS | IN STOCK | COMPARABLE RETAIL PRICE | BOX PRICE | SUBCATEGORY
THICKNESS MM | WEAR LAYER MIL | UNDERLAYMENT ATTACHED | WATER RESISTANCE
CARD SPEC 1 | CARD SPEC 2 | CARD SPEC 3
```

## Risks / unresolved live checks

- If all source identities AND title change together, no safe link remains. Correct
  one attribute at a time or reconcile manually; do not guess or replace permanent key.
- Two products sharing one retailer/title make fallback ambiguous and abort the plan.
- K2/export formulas are outside Git; local mocks cannot validate actual spill/lookup.
- A catalog entry missing its permanent key blocks appends rather than being overwritten.
- Apps Script writes are nontransactional; partial service failures require inspection.
- AI exact/high claims and citations still require human review.
- Existing Airtable sync has no lock; do not overlap manual and scheduled live syncs.
- No production Apps Script deployment, trigger change, workbook migration, Airtable
  reset/write or Buffer posting was performed during local implementation.

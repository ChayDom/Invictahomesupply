# Native acceptance and controlled release gates

This package is preparation, not proof of native/bound execution. Never point a
test project at production. No production formula, schema, trigger or token is
changed by repository tests or staging deployment.

## F01 algorithm and accounting boundary

Current Inventory remains the positive accounting view; Product Inventory and
retailer/Master formulas remain unchanged. `Inventory Source Evidence` is a
read-only, full-source mirror, not a registry. `Lifecycle Inventory` is a
disposable five-column view: PRODUCT KEY, PRODUCT ID, QUANTITY AVAILABLE, STATE,
EVIDENCE. Apps Script refreshes it under the existing sync lock. Catalog and
Website Export each remain 29 columns. No historical Batch IDs are backfilled.

For each tracked Catalog Product Key, match retailer + current SKU-derived ID,
or stored Product ID. A nonlegacy stored ID disagreeing with SKU is a conflict.
When no direct match exists, use the existing normalized retailer + SOURCE ITEM
fallback only if all matching rows resolve to one product identity. No row-number
identity, fuzzy title matching or made-up acquisition identity is used.

Sum all valid matching balances, including zero rows. Every contributing Buy
Quantity must be finite numeric >0; Balance must be finite numeric >=0 and <=Buy
Quantity. Numeric strings, blanks, errors and negative values are unreliable.
One zero plus one positive is positive; all zero is confirmed zero. Any unreliable
matching row conservatively makes the exact stock total unknown, even if another
row is positive: never invent sufficient inventory. A positive Product Inventory
match contradicting a zero source also makes zero unconfirmed. Missing source
rows/matches are unknown, never zero. Explicit source errors are not coerced away.

Only existing tracked Catalog keys enter this view. A historical sold source row
alone cannot create a product. Source stock is re-read before archive/deletion;
StockLock does not lock human source edits. No distributed atomicity is claimed.
This simple model cannot detect an unobserved temporary restock or removal of
one of several same-identity source rows if the remaining evidence looks complete.
Owners must preserve source completeness and monitor imports. Native acceptance
must verify import freshness; a stale/broken source is not suitable for cleanup.

Active positive SKU corrections still use the existing maintenance planner,
preserving key/row/record. Source fallback also prevents disappearance of the old
SKU alone from becoming zero. After COMPLETE, a positive same-SKU source opens
a fresh ACQ key only with a valid later Buy Date (after archive time). Positive
old/undated accounting rows are flagged for manual review, not automatically
resurrected. This is a conservative purchase-evidence guard, not batch reconstruction.
Legitimate backdated purchases require intentional review before merchandising.

## Native workbook setup (dedicated project required)

1. Create a dedicated empty native workbook named `Invicta Native Acceptance` and
   record its URL/id. It must not be the production inventory/source workbook.
   Bind a new V8 Apps Script project; deploy **all** repository Apps Script files,
   including `CatalogSourceConfirmation.js`. Manifest timezone America/Chicago.
   Do not copy credentials or existing triggers from production.
2. Create Product Catalog A1:AC1 from the exact `catalogHeaders` fixture in
   `test/fixtures/catalog-lifecycle-runtime.mjs`; same for Product Inventory
   A1:M1 and Website Export A1:AC1. Exactly 29 Catalog/Export headers; do not add
   old Match Key/content lock/confidence/date fields. Social Queue uses the exact
   19 `SOCIAL_REQUIRED_HEADERS_` declarations. Archive is created by cleanup.
3. Create local Master Sheet and Inventory Source Evidence. Populate Master
   from `test/fixtures/native-source-cases.csv`. Master headers are ITEM, RETAILER,
   RETAIL SKU, PRODUCT ID, BUY QUANTITY, BALANCE, BUY DATE. Set evidence A1:
   `=ARRAYFORMULA(IF(LEN('Master Sheet'!A1:G100)=0,"",'Master Sheet'!A1:G100))`.
   Blank balances must remain blank, not numeric zero. Set native numeric dates
   or ISO strings deliberately; verify both forms. Do not import production
   transactions for synthetic acceptance.
4. Create Current Inventory with the same seven headers and local positive
   filter: `=IFNA(FILTER('Master Sheet'!A1:G100,(ROW('Master Sheet'!A1:A100)=1)+
   (ISNUMBER('Master Sheet'!F1:F100)*('Master Sheet'!F1:F100>0))),"")`.
   For this small fixture, populate Product Inventory identity/metadata rows
   from positive Current Inventory; preserve its 13-header contract and compare
   modeled positive-only semantics. Before production approval separately prove
   the existing actual Current/Product Inventory formulas in an isolated copy.
5. Catalog K2 is the only spill formula:
   `=MAP(I2:I,J2:J,LAMBDA(sqft,price,IF(OR(sqft="",price=""),"",LET(x,sqft*price,w,INT(x),d,x-w,IF(d=0,w,IF(d<0.75,w+0.5,w+1))))))`.
   Do not populate any other K values/formulas. Give K `$0.00`; deliberately set
   J General and L Text for append tests. Normal row-2 validation rules are
   inherited/applied by maintenance. Test physical row insertion and reordered
   headers only in isolated fixtures; restore native K2 at its relocated column.
6. Run maintenance first for positive new products; set manual publishing,
   category, Box unit, pack20, price1.50, comparable3, description/highlights.
   Seed previously tracked zero/unknown/invalid Catalog fixtures explicitly:
   Product Keys STAGE-NATIVE-ZERO / STAGE-NATIVE-UNKNOWN / STAGE-NATIVE-INVALID,
   current Product IDs HD-900000002 / HD-900000003 / HD-900000004, matching SKU,
   retailer/source item from CSV, POST TO WEBSITE Yes, and the same manual
   pack/price/content fields. These represent existing products, not new rows
   automatically created from historical sold inventory.
   Create Lifecycle Inventory by running `refreshCatalogLifecycleInventory_`.
   Set Export A2 to `test/fixtures/website-export-lifecycle.formula` (20 outputs).
   U2:AC2 are permanent-key lookups of Catalog K,G,R,S,T,U,V,W,X respectively:
   e.g. U2 `=MAP(A2:A,LAMBDA(k,IF(k="","",XLOOKUP(k,'Product Catalog'!AA:AA,'Product Catalog'!K:K,""))))`.
   Repeat replacing K with G,R,S,T,U,V,W,X for V:AC. Check no collisions or #REF.
7. For a later separately approved source hookup, evidence A1 is a bounded,
   blank-preserving mirror of the full Master Sheet, not Current Inventory:
   `=LET(data,IMPORTRANGE("APPROVED_SOURCE_WORKBOOK_ID","'Master Sheet'!A1:AB4038"),ARRAYFORMULA(IF(LEN(data)=0,"",data)))`.
   Confirm full source extent and permission/freshness; adjust the bound before
   it truncates new rows. Preserve all source rows, including zero and uncertain.
   This instruction is NOT permission to install a production formula now.

## Exact staging Script Properties

| Property | Value |
|---|---|
| AIRTABLE_BASE_ID | appLzUBCXBMzrgVx1 |
| AIRTABLE_ENVIRONMENT | staging |
| AIRTABLE_WORKBOOK_ID | actual dedicated native workbook ID |
| AIRTABLE_TOKEN | staging-only least-privilege PAT, entered privately |
| CATALOG_LIFECYCLE_CLEANUP_ENABLED | false initially; true only during scoped cleanup acceptance |

Do not install BUFFER_API_KEY/channel IDs or email/subscriber credentials. Gemini
is not needed for lifecycle testing. Native enrichment requires a separately
approved staging/test key or controlled mock response; do not call production
Gemini merely to make this package green. Never enable production social triggers.

Stage Airtable Website Products must have Product Key text, quantities/pack numeric,
Price/Box Price/Was Price currency, Post to Website checkbox, Sold Out Since
**dateTime**, ISO UTC timestamps and explicit `null` clearing. Stage currently
has text fields where production uses selects: verify option parity before
claiming select validation coverage. Needed Status values: In Stock, Sold Out,
Contact for Availability; retain Reserved/Draft. Unit Type: Box, Each, Sq Ft,
Roll. Price Basis: Per Sq Ft, Per Box, Each. Underlayment: Yes, No. Water Resistance:
Waterproof, Water Resistant, Not Water Resistant, Unknown. Category options are
the exact `IWA_H_CATEGORY_VALUES`; verify Retailer against fixture/source values.
Photos must remain untouched. Record base/table/workbook ids without PAT values.

## Native execution and expected results

Run only scoped synthetic Product Keys; record real Sheet/Airtable row/record IDs.

1. Maintenance -> refresh -> Export -> sync: one positive product, one key, one
   record; pack20/qty4 -> coverage80; Box Price30. Repeated maintenance/sync is
   idempotent. Legacy keys remain excluded from automatic enrichment.
2. Change source Balance to 0 and remove positive-only inventory entry: Sold Out,
   first current UTC Sold Out Since. Repeat zero: same stamp, no unnecessary PATCH.
3. Blank/invalid/missing/conflicting source: Contact for Availability, clear timer,
   no archive/delete. Restore zero: a new first-zero timestamp.
4. Two source rows 0+3 -> quantity3/coverage60; 0+0 -> zero; 0+blank -> unknown.
5. Correct SKU/Product ID in positive source/inventory, retain matching item:
   maintenance keeps Catalog row/key and Airtable record; no false sold-out.
6. Preview cleanup before 10 days: not eligible. True temporal acceptance uses
   first observed timestamp and waits 864000000ms. Browser boundary and modeled
   clock tests cover -1ms/equality/+1ms without native Date overrides. An isolated
   accelerated backend fixture may deliberately seed a test timestamp, but must
   be labeled simulation, never genuine first-zero/time-elapsed proof.
7. Exact expiry: archive first -> flush/readback/hash -> source/remote recheck ->
   remove exact staging Airtable record -> verify absent -> clear around K ->
   COMPLETE. Historical sheets and K2 are unchanged. Repeat cleanup: no duplicates.
8. Simulate archive/API/clear/final-state failures in dedicated tests. Resume
   ARCHIVED/AIRTABLE REMOVED correctly. COMPLETE tampered key/SKU/date/hash must
   abort authoritative reads. Back up then restore the **entire original verified
   row** for intentional repair; record operator/reason/before-after hash externally.
   No automatic rehash, silent trust or mutable-history admin shortcut exists.
9. Later positive purchase with Buy Date after archive -> new ACQ key/new record,
   PENDING/manual approval, old archive unchanged. Old/undated positive adjustment
   -> manual-review warning, no automatic new lifecycle.
10. Missing/wrong base/environment/workbook must fail before remote fetch/write.
    Queue status changed to PROCESSING under lock cannot be overwritten. Check
    J/K/L currency on appended rows, K-first/current/last cleanup, retained K2.

Only after manual handlers pass: install maintenance and sync time-based triggers
in the dedicated project via Apps Script Triggers UI, hourly maintenance followed
by hourly sync at different offsets; verify locks and execution logs. Enrichment
daily ~3AM Chicago via `setupCatalogEnrichmentTrigger` only when its test is
approved/key exists. Verify no duplicate/wrong handlers. Remove only dedicated
test triggers afterward. None of these steps has been run against production.

## F02 production migration — not executed

1. After native acceptance and separate approval, back up production schema/records;
   target only base apptugvm4r5tm2OIt / Website Products tblUyA3uFL6FmMw6T.
2. Add `Sold Out Since` as editable **dateTime**, not date-only/formula. Use UTC
   display/ISO semantics including time; store `new Date().toISOString()`; verify
   `null` clears the cell, not empty-string PATCH. Never backdate existing zero.
3. Add Contact for Availability to Status fldFqTKRLDSae5Ujj. Keep In Stock,
   Reserved, Sold Out and Draft. Current production is missing the new option.
4. Current owned selects already include all Category, Price Basis, Underlayment,
   Water Resistance options above. Unit Type lacks Case: do not publish the two
   existing unapproved Case rows until owners normalize to Box or explicitly
   approve adding Case with verified sync/frontend semantics. Retailer options
   are Home Depot, Lowes, Target, Walmart, Invicta Floors, Other, Costco; source
   retailer outside this list needs intentional normalization/option approval.
5. Product ID is not a production Airtable field; do not invent it. Product Key
   remains permanent upsert identity. Comparable Retail maps to existing Was Price.
6. Validate least-privilege PAT read/write scope restricted to this base/table;
   cleanup deletion uses record-write scope. Production target must be explicit:
   AIRTABLE_ENVIRONMENT=production, AIRTABLE_BASE_ID=apptugvm4r5tm2OIt,
   AIRTABLE_WORKBOOK_ID=1mB0F1zDjy0BoJvEKU81Z-WnGlkSJOPM6cwNUR3a7Oj4.
   Confirm historical PAT revoked/rotated, record confirmation only. Current
   stage/prod PATs must be separate; never print/test the historical credential.

## Netlify staging/release workflow

Run `npm run build` for an allowlisted dist-public artifact. Functions/edge code
remains separately bundled by Netlify, never copied into public assets. To deploy
set NETLIFY_CLI_PATH to authenticated run.js, then `npm run deploy:staging`.
The workflow requires a clean tracked candidate, exact dedicated site ID,
no custom domains, staging-only base/table/token, digest=false in all three
function contexts, and absence of every nonallowlisted credential key. It builds
using versioned config and deploys a draft alias, never --prod, then verifies
candidate manifest. Stage marker skips analytics, CSP blocks it, robots/noindex
remain. Verify manifest asset hashes and operational paths404 after deployment.

Production-site branch/preview builds are refused by the build script until
separately hardened. Existing production Netlify credentials/settings are not
modified here. Later restrict subscriber/Resend/write tokens to production
context; dedicate nonproduction bases/tokens and add runtime context write gates;
review form notification recipients before synthetic submission. Production
packaging uses the same allowlist without stage marker/robots/CSP overrides.

## Policy/deferred risks and ordered release gates

F13 unchanged: recommend PENDING-only unattended enrichment for an explicit queue;
it avoids accidental requests from blank status and makes review auditable. Blank
or PENDING is convenient for old incomplete standard rows but less intentional.
Keep current blank-or-PENDING until owner separately approves a policy change.

Buffer remote success before persisted post ID, concurrent subscriber GET-then-
POST and digest email-before-state persistence remain deferred cross-service
idempotency gaps. No social triggers/credentials are enabled during acceptance;
stage subscriber/email tokens are absent and digest false. Existing production
digest is already enabled, not newly enabled by this candidate: owner must accept
or disable that independent risk before production release. This task does not
change production settings to do so.

Remaining blockers: actual native/bound acceptance, source freshness/completeness
validation, production field migration, historical PAT confirmation, isolated
production contexts and controlled production acceptance. Order: review diff ->
isolated native package -> owner risk/policy decisions -> backup/migrate approved
production schema -> explicitly configure bound project -> separately deploy
Apps Script -> scoped real production acceptance/K2/archive/identity -> verify
trigger registrations/executions -> explicitly approve main/site release ->
observe. Never infer production trigger success from local VM/stage browser tests.

# Evergreen content: one queue, one publisher

This backend-only candidate is **not activation approval**. Social publishing and
cleanup stay OFF. No Netlify release is needed. Merge only with `[skip netlify]`
on the eventual merge/squash commit; do not deploy the website.

## Architecture and owner controls

After a separately approved Apps Script deployment, manually invoke
`initializeEvergreenSocialLibrary()` once in the existing inventory workbook.
It creates only **Evergreen Social Content**, never replaces an existing sheet,
never changes Product Catalog / Website Export / their 29-column schemas, and
never installs a trigger. Owner-authorized final acceptance adds this source tab
and Draft-only queue rows; it does not activate publishing or modify inventory.

The source has 11 columns:

| Column | Owner control |
| --- | --- |
| CONTENT ID | Permanent unique editorial ID; do not rename after use |
| CONTENT TYPE | Educational / Comparison / Tip / Brand |
| TITLE | Topic, up to 110 characters |
| CAPTION | Reviewed Facebook/Instagram caption, up to 1,800 characters |
| SLIDE 1–4 | Four reviewed text panels, up to 350 characters each |
| STATUS | Enabled / Disabled (source availability, **not publishing approval**) |
| COOLDOWN DAYS | 90–120; default 120 |
| SOURCES | HTTPS primary references, separated by whitespace |

Post history, counts and reuse eligibility derive from existing queue receipts;
they are not separately mutable counters in the library. Cloudinary identities
derive from copy/template hashes and live in the existing MEDIA URL cell note.
No second publishing queue, scheduling service, AI writer or new credential scope.

Invoke `prepareEvergreenSocialQueue()` manually. It appends **Draft only** to the
existing 19-column Social Queue. CONTENT TYPE explicitly identifies editorial
items. The existing PRODUCT KEY column stores a clearly namespaced queue ID,
`EVERGREEN|CONTENT-ID|occurrence`; this is **not an inventory Product Key**, is
never written to Airtable/Product Catalog, and cannot bypass the product guard.
Caption changes belong in the library, followed by preparation and reapproval.
Editing the queue caption alone blocks publication.

Preparation uploads/reuses immutable raw JSON snapshots containing **only public
editorial copy**, using existing Cloudinary credentials. This bridges the private
workbook to the existing GitHub media worker without publishing the workbook,
adding Google OAuth/service-account credentials to GitHub, or exposing inventory.
The function returns content IDs and render hashes (not credentials).

In the existing manual **Social media preparation (never publishes)** workflow:

1. Leave `product_key` blank and `reel` false.
2. Enter one `content_id` and its returned `content_hash`.
3. Run preparation; inspect all four version-pinned Cloudinary graphics.
4. Review claims, slides, caption and source references.
5. Manually change that queue item to **Ready** only after review.

The product workflow remains unchanged. The evergreen worker uses only the
existing Cloudinary cloud/key/secret variables; no Airtable or Buffer access is
needed. No new account, billing or secret is required.

## Rotation and cadence

The one sender repeats:

`Product → Educational → Product → Comparison → Product → Educational → Product → Brand/Tip`

Each queue occurrence with an accepted channel receipt, last-posted timestamp or
durable intent reserves one slot, including partial/uncertain sends. It does not
count channels separately. Existing historical receipt rows contribute to the
starting slot; plain Skip/legacy holds without receipt evidence do not.
Reconciliation of an existing Ready-with-journal operation has priority and may
not create a missing sibling. No new publication occurs inside the existing
global rolling 48-hour gate. Exactly 48 hours is allowed.

No appropriate approved item? **Wait** for the owner; do not auto-approve Drafts,
advance the rotation or add product fallback posts. Within a slot, IDs break ties
deterministically. Before the optional library is installed, the PR19 product-only
path is preserved; install/review the library before authorizing activation.

Reuse requires the exact cooldown boundary (`now >= latest evidence + days`), no
pending duplicate, and no unused Enabled, non-held topic available. A Skip without
publication evidence is an intentional hold, not automatic requeue permission.
To requeue intentionally, change that same held occurrence to Draft and prepare;
do not delete historical receipts. Missing/invalid historical dates fail closed.
Each permitted repeat gets a new occurrence/source identity while reusing identical
graphics. Earlier verified receipt IDs may be excluded from remote matching for
that new occurrence only. Unknown remote matches still prevent duplicate creation;
product V1/V2 payloads and receipt recovery are unchanged.

## Media and safety

The initializer formats only the new populated source area: wrapped/top-aligned
copy, bounded column widths, a light gray bold header and one frozen row. It does
not format inventory or product queue rows. Preparation preserves existing strict
Post/Reel validation on product rows and extends that validation only on each
editorial CONTENT TYPE cell, keeping strictness and dropdown UI. Unexpected
validation fails closed. An interrupted partial editorial row is repaired in
place as Draft; no second occurrence is created.

FFmpeg creates four 1080×1350 JPEG slides with the site's charcoal/cream/terracotta
colors, Invicta branding and website/McKinney CTA. No fake product images, external
retailer imagery, Canva or paid rendering. The Ubuntu runner uses DejaVu Sans Mono.
Text is written to files with `expansion=none`, never interpolated into FFmpeg
filters. Overflow fails preparation rather than silently truncating a claim.

`evergreen-v1 + content ID/type/title/caption/ordered slides/sources + layout`
defines the render hash; each slide has an ordered derived hash/public ID.
IDs: `invicta-social/evergreen-v1/<slide-hash>`. Public copy snapshots:
`invicta-social/evergreen-sources-v1/<render-hash>.json`.
All uploads use `overwrite=false`; cache reads verify identity/hash/format/size/
dimensions before reuse. Unchanged complete media requires no rendering/upload.
Edits create new immutable assets and reset nonhistorical approval to Draft.
Old receipt rows are never rewritten to republish changed content.

Evergreen send-time checks source presence, Enabled status, exact approved copy,
manifest/type/occurrence, duplicate pending content and cooldown, before resolving
media and again immediately before each Buffer create. Unused-topic priority is
also rechecked at send time, including a newly enabled topic after selection.
Product posts still require
current workbook/source evidence, positive stock, publication controls and ordered
owner Airtable Photos. No general-purpose inventory-check bypass was added.

The same Buffer helper, channel-specific journals and `shareNow` policy are used.
It cannot atomically eliminate a source edit after the final check; accepted
receipts are preserved and the next channel revalidates. The workflow is manual,
`contents: read`, pinned checkout, `persist-credentials: false`, standard public-repo
runner, 15-minute timeout, no schedule and no Buffer/Netlify secrets. Logs contain
only IDs/hash/counts or generic failures, never credentials or raw API errors.

## Initial editorial drafts

30 complete topics: **20 Educational, 6 Comparison, 2 Tip, 2 Brand**. Examples:

- Wear layer: 6, 12 or 22 MIL? — distinguishes MIL from mm; does not promise scratch-proof flooring.
- Does thicker always mean better? — compare core, finish, pad and permitted use.
- 5 mm / 12 MIL vs 7 mm / 22 MIL — compare full construction, not a universal winner.
- Waterproof vs water-resistant — does not promise flood-proof rooms or subfloors.
- Plan your local flooring pickup — existing approved pickup/delivery copy, no shipping promise.

These are editorial **drafts**, not automatically Ready or manufacturer-specific
recommendations. Product documentation always governs. Initial fact checking uses:

- [Shaw/COREtec SPC installation guide](https://pdmsview.shawinc.com/USFloors/COREtec/Installation/SPC-Installation-Guidelines-Unbranded-10162018): construction and model-specific installation/underlayment requirements.
- [Shaw specification example](https://pdmsview.shawinc.com/spec-viewer/?key=IyElJEc%2BRyMhJSQ%3D&region=EN-US): distinguishes wear-layer thickness and attached backing.
- [NALFA laminate FAQs](https://nalfa.com/laminate-flooring-faqs/): construction, care and room suitability.
- [NALFA abrasion-rating paper](https://nalfa.com/wp-content/uploads/2022/11/NALFA-AC-Rating-White-Paper_Final.pdf): abrasion alone does not measure all durability.
- [NALFA water-performance paper](https://nalfa.com/wp-content/uploads/2024/05/NALFA-White-Paper_Laminate-Flooring-Water-Performance_FINAL-4-17-24.pdf): water claims require defined conditions.

## Verification and remaining activation steps

Maintained unit coverage includes library/queue preparation, deterministic rotation,
manual approval, both source types sharing cadence, zero-create rejection paths,
cooldown boundaries, receipt recovery, owner holds, immutable snapshots and cache
reuse. `node test/evergreen-render-e2e.mjs` runs three real offline four-slide renders
and checks dimensions, format, size and byte-identical retry. It never publishes.
Local Windows font override is QA-only; production rendering remains on the
existing Linux runner. Existing product-safety tests remain maintained.

Before activation: approve/merge backend-only PR with skip marker, deploy reviewed
Apps Script source through the existing process, review the already installed
library (do not reseed), prepare remaining media using Cloudinary/GitHub and
manually approve enough topics for the rotation. Final non-publishing acceptance
is recorded below; deployment and activation remain separate approvals. **Do not enable
publishing or cleanup as part of this implementation.**

### Final live, non-publishing acceptance (2026-09-28)

- Full maintained units: **905 passed, 0 failed**, 45 files, isolated LF-normalized
  copy (matching GitHub checkout; native Windows has pre-existing CRLF-sensitive
  frontend fixture assertions). Includes 45 evergreen checks.
- Chromium browser regressions: **139 passed, 0 failed**, installed Chrome 152.
  Initial Chromium 90 run had one unrelated card-layout failure because that
  browser predates the existing CSS `:has()` rule; no frontend fix was made.
- Real offline graphics E2E: **3 passed, 0 failed**, 12 ordered graphics, correct
  JPEG dimensions/size and byte-identical retries. Samples: EDU-01, CMP-01, BRAND-02.
- Apps Script/modules syntax: **18 passed**; `git diff --check` passed.
- Before installation: **64 product rows: Draft 46, Needs Image 4, Skip 8,
  historical Queued 6, Ready 0; evergreen 0**. Seven receipt-bearing rows verified
  from live values and notes (six Queued plus Lake Annette).
- Owner-authorized acceptance added the 30-topic source and **30 evergreen Drafts**.
  Final total: **94 rows: Draft 76 (46 product + 30 evergreen), Needs Image 4,
  Skip 8, historical Queued 6, Ready 0**. The first 64 rows and all their notes
  were checked by digest before/after; Product Catalog / Website Export headers
  and native K2 formula were unchanged. Lake Annette/Dyson remain safely held.
  Read-only live source/Airtable Photos audit: **46 of 46 product Drafts eligible**,
  zero Airtable writes and zero Buffer creates during that audit.
- Live graphics examples: EDU-01 (wear layer), CMP-01 (5 mm / 12 MIL vs 7 mm /
  22 MIL), BRAND-01 (compare with confidence). Twelve ordered 1080×1350 JPEGs
  uploaded and validated through the actual Apps Script Cloudinary resolver;
  visual samples checked. Unchanged EDU-01 rerun: **reused 4, prepared 0**.
- Temporary EDU-01 copy edit changed fingerprint and blocked approved-fixture
  publication with **zero creates**. Four new immutable graphics were rendered.
  Original copy and source identity were restored afterward.
- Six **Buffer drafts only** (three topics × Facebook/Instagram), each with four
  ordered images and distinct fixture journal. Each lost-receipt retry recovered
  the same draft ID with **zero additional creates**. A temporary mutation
  firewall allowed only `saveToDraft:true` + `mode:addToQueue`; public `shareNow`
  and other mutations were rejected. No production queue row became Ready.
- Rotation from live seven-row offset and its complete next sequence are covered;
  48-hour exact boundary, no fallback, Draft/approval rejection, shared cadence,
  120-day boundary, unused priority and fail-closed historical dates passed.
- Live trigger installer test was rejected while OFF; the same three catalog/
  sync/enrichment handlers remained. No social or cleanup handler was installed.
- Final review removes the ten-track music implementation from the initial
  release. Silent `reel-v1` identities remain unchanged. See
  [music decision and retained license research](REEL_MUSIC_LICENSES.md).
- Real preparation creates Cloudinary assets and **non-publishing Buffer drafts**,
  not public posts. Retain prepared assets for cache reuse and clearly marked test
  drafts/receipt evidence until intentionally reviewed; do not schedule them.
- Temporary Apps Script acceptance files are removed and original PR19 production
  source read back. No temporary GitHub workflow/script is included in the PR.
  Backend deployment/merge remains separately approved work. Publishing and
  cleanup stay OFF; no Netlify deployment occurred.

With the current seven receipt-bearing historical rows (six Queued plus held
Lake Annette), installing the library makes the next fresh slot **Brand/Tip**.
Then it wraps to Product, Educational, Product, Comparison, Product, Educational,
Product. Historical evidence is retained rather than reset to force a new start.

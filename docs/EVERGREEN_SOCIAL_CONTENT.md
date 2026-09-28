# Evergreen content: one queue, one publisher

This backend-only candidate is **not activation approval**. Social publishing and
cleanup stay OFF. No Netlify release is needed. Merge only with `[skip netlify]`
on the eventual merge/squash commit; do not deploy the website.

## Architecture and owner controls

After a separately approved Apps Script deployment, manually invoke
`initializeEvergreenSocialLibrary()` once in the existing inventory workbook.
It creates only **Evergreen Social Content**, never replaces an existing sheet,
never changes Product Catalog / Website Export / their 29-column schemas, and
never installs a trigger. No production workbook was edited during implementation.

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
media and again immediately before each Buffer create. Product posts still require
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
Apps Script source through the existing process, seed/edit the library, prepare
media using Cloudinary/GitHub, manually approve enough topics for the rotation and
perform separately authorized non-publishing live acceptance. **Do not enable
publishing or cleanup as part of this implementation.**

### Candidate validation checkpoint

- Full maintained units: **915 passed, 0 failed**, 46 files, isolated LF-normalized
  copy (matching GitHub checkout; native Windows has pre-existing CRLF-sensitive
  frontend fixture assertions). Includes 39 new evergreen checks.
- Chromium browser regressions: **139 passed, 0 failed**, installed Chrome 152.
  Initial Chromium 90 run had one unrelated card-layout failure because that
  browser predates the existing CSS `:has()` rule; no frontend fix was made.
- Real offline graphics E2E: **3 passed, 0 failed**, 12 ordered graphics, correct
  JPEG dimensions/size and byte-identical retries. Samples: EDU-01, CMP-01, BRAND-02.
- Apps Script/modules syntax: **19 passed**; `git diff --check` passed.
- Read-only production queue check: **64 rows: Draft 46, Needs Image 4, Skip 8,
  historical Queued 6, Ready 0; evergreen 0**. Lake Annette/Dyson remain Skip with
  historical evidence retained. No workbook or approval changes were made.
- The production workbook has no evergreen source tab yet. The library and
  graphics capability are a review candidate, not a production installation.
- This one follow-up includes the previously completed, unpushed ten-track
  background-music candidate; no additional feature/paid-provider work was added.
- No real Buffer create, Cloudinary upload, production backend deployment, social
  trigger installation, cleanup enablement or Netlify deployment was performed.

With the current seven receipt-bearing historical rows (six Queued plus held
Lake Annette), installing the library makes the next fresh slot **Brand/Tip**.
Then it wraps to Product, Educational, Product, Comparison, Product, Educational,
Product. Historical evidence is retained rather than reset to force a new start.

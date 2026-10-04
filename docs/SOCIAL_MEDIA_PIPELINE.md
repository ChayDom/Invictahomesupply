# Photos-only social media pipeline (publishing OFF)

This is the shared backend pipeline. Do not deploy Netlify, turn on social
triggers, enable cleanup, merge blindly, or publish real Facebook/Instagram content
as part of acceptance.

## Evergreen manual-asset path

Educational, Comparison, Tip, and Brand posts use the production
`Evergreen Social Assets` registry as their current artwork authority. Each
approved row maps a Content ID to one bare Cloudinary public ID (the initial
36-row library uses `CONTENT ID == public ID`) and an explicit manual media
version. `prepareEvergreenSocialQueue()` verifies that registry entry and
reuses the same approved image for every occurrence of that Content ID; an
occurrence-number change does not trigger image generation or an upload.

Normal Evergreen preparation does not call OpenAI, Gemini, or an image worker,
does not fall back to historical v1/v2/v2.1 generated artwork, and skips a
missing or invalid manual asset without failing the whole run. A verified Draft
may be promoted only to `Awaiting Approval`. Owner review is still required to
change it to `Ready`; the Buffer sender remains unchanged and only processes
explicitly Ready rows. Historical generated assets and manifests remain intact
for audit/backward compatibility, but are not selected for new manual Evergreen
preparation. Product media continues to use the separate real-Photos path below.

## Architecture and cadence

For the optional educational/comparison source, shared rotation, graphic
preparation and manual approval, see [Evergreen content](EVERGREEN_SOCIAL_CONTENT.md).
It uses this same queue, cadence, publisher and receipts; the Photos-only
requirements below still apply to every inventory product.

Keep the existing 19-column Social Queue and permanent Product Key. Preparation
reconciles **all** rows, including products absent from Export. The existing
catalog source-confirmation helper and archive validation remain authoritative;
this code does not introduce another inventory engine.

Approved Ready candidate -> fresh Product Catalog / source evidence / archive /
Website Export and Airtable controls -> ordered approved Photos attachment IDs ->
immutable Cloudinary asset lookup -> final fresh eligibility / queue check ->
Buffer `mode: shareNow` -> per-channel durable journal and receipt.

The rolling 48-hour gate belongs to our automation, not Buffer's future slots.
First accepted channel, partial sends, uncertain PUBLISHING journals and historical
timestamps count even when status later becomes Skip. Exact 48 hours permits a new
product. At most one candidate is handled per run. An existing operation can only
reconcile; a retry cannot create the missing sibling automatically.

`shareNow` minimizes but does not atomically eliminate the race between inventory
and external platform publication. Buffer acceptance is not proof of publication;
Queued remains the workbook's existing hand-off status. Inspect Buffer/platform
status separately. Do not substitute addToQueue for normal inventory posts.

## Photos and intentional approval

Only `Website Products -> Photos` attachments are allowed. STOCK IMAGE URL,
Reference Image URL and manually pasted MEDIA URL are never publishing inputs.
Unsupported/duplicate/malformed Photos fail closed for owner review. Small images
under 300px are not automatically usable. Do not silently substitute an image.

Attachment IDs are ordered and stable; signed download URLs may rotate without
changing identity. Reorder/replacement/fact/format changes require new approval.
MEDIA URL's cell **note** stores the versioned approval manifest (photo IDs,
derived asset IDs, render fingerprint and fact hash). No new queue columns.
Prepare/review the media and both captions before deliberately setting Ready.
Old Ready rows are not considered approval of the new Photos-only media.

For an explicitly scoped operational repair, call
`syncSocialQueueFromCatalog([productKey, ...])` with 1–10 unique existing product
keys. This uses the normal reconciliation and authoritative source readers, but
preflights the entire scope and refuses historical/journaled, missing, ineligible,
or unusable-Photos rows before writing. It does not append rows or touch any
out-of-scope row/value/note, including historical and evergreen rows. A legacy
Ready row without a manifest becomes Draft with captions preserved. Current
approved fact changes retain the existing Needs Copy rule. Normal no-argument
daily reconciliation is unchanged. Run the existing preparation worker for each
scoped key/strategy to create or reuse durable assets, then manually review before
setting Ready; neither reconciliation nor the worker publishes.

Mixed strategy:

- One usable Photo: single image.
- Two or three: carousel.
- Four or more: carousel by default; optional Reel when `SOCIAL_REELS_ENABLED=true`.
- Image posts use up to ten ordered Photos; Reels use the first four to six.
- All attachment IDs participate in approval, even above the selected limit.
- Already posted, journaled, uncertain or manually skipped products are not
  automatically reset/reposted as another format.

Preparation may occur ahead of time, but publication always rechecks stock.
Positive canonical stock, active Catalog/Export controls, Airtable
`Status=In Stock`, `Post to Website=true`, positive numeric sellable quantity and
the approved Photos must all agree. Zero, unknown, missing, retired or ambiguous
products make zero Buffer create calls. A change after one channel succeeds blocks
the second and preserves the first receipt.

## Durable hosting and FFmpeg

The preparation worker has no Buffer, Sheets, Gemini or Netlify credentials.
It only reads the explicitly scoped production Website Products table and
uploads approved media into the owner-confirmed Cloudinary Free product environment.
No Airtable writes, unsigned upload preset, paid transformation, music, generative
product imagery, public GitHub artifact media URL or automatic media deletion.

Immutable image IDs: permanent Product Key + attachment ID + photos-v1.
Reel fingerprint: permanent key + ordered selected attachment IDs + reel-v1 +
actual name/price/spec/branding/CTA + 1080x1920 / 12 seconds / silent settings.
Existing valid assets are reused BEFORE downloads/rendering; mismatches fail closed.
Uploads are signed SHA256, overwrite=false, with a matching source_hash context.
Delivery URLs are pinned to the uploaded version; manual URLs are not trusted.

The worker normalizes image posts to 1080x1350 JPEG (4:5), <=8MB. Airtable sometimes
serves genuine Photos as binary/octet-stream; downloads still require allowlisted
Airtable delivery hosts and matching JPEG/PNG/WebP file signatures.

One Reel template: silent 1080x1920, 12 seconds, 30fps, H264/yuv420p MP4 with faststart,
gentle centered zoom, crossfades, actual product name/price/card specs, Invicta
Home Supply and McKinney/website CTA. Photos are resized once before looping to
avoid repeatedly decoding huge original attachments. Text is in local text files
with literal expansion, never shell/filter interpolation. ffprobe rejects format,
duration, size, bitrate, frame-rate or audio violations.

Standard ubuntu-24.04 GitHub Actions runner with distro FFmpeg/open DejaVu font.
Manual workflow_dispatch only; one Product Key; protected social-media environment;
contents:read; no schedule, paid larger runner, production deploy or publishing.
Template identity is versioned, not bit-for-bit MP4 encoding (FFmpeg security updates
can change bytes); stable fingerprints reuse the original uploaded asset.

Expected cost: $0 within Cloudinary Free allowances and public-repository standard
runner policy. Monitor usage; stop before quotas are exhausted. No account creation,
trial, payment method, billing activation or upgrade is performed automatically.

## Exact secure setup (owner)

Create/confirm the Cloudinary **Free** account/product environment. In Cloudinary's
console, find its Cloud name, API key and API secret. **Do not send secrets in chat.**
Do not use a Netlify environment variable or a tracked .env file.

GitHub: repository Settings -> Environments -> create/select **social-media**.
Restrict deployment branches to the reviewed backend branch/release and require
owner approval before credential-bearing runs.

| Value | GitHub environment storage | Apps Script Project Settings -> Script Properties |
| --- | --- | --- |
| Cloud name | Variable `CLOUDINARY_CLOUD_NAME` | `CLOUDINARY_CLOUD_NAME` |
| API key | Secret `CLOUDINARY_API_KEY` | `CLOUDINARY_API_KEY` |
| API secret | Secret `CLOUDINARY_API_SECRET` | `CLOUDINARY_API_SECRET` |
| New restricted Airtable read token | Secret `AIRTABLE_SOCIAL_READ_TOKEN` | Do not copy this token; reuse explicit existing production `AIRTABLE_TOKEN` |

The GitHub Airtable token needs only data.records:read on the production base,
not schema/record writes or access to unrelated bases. Never test historical
credentials. Cloudinary credentials stay server-side. Apps Script properties are
accessible to project editors; restrict editors appropriately. Never log values.

Keep `SOCIAL_PUBLISHING_ENABLED=false` (missing also disables), keep social triggers
OFF, and keep `CATALOG_LIFECYCLE_CLEANUP_ENABLED=false`. Default Reels OFF until the
sample/format is approved. Do not invoke setupDailySocialTriggers during acceptance.

After the workflow exists on the default branch, Actions -> Social media preparation
(never publishes) -> Run workflow -> reviewed ref -> explicit permanent Product Key.
Workflow registration/merge is a separate reviewed step; do not merge main if that
could trigger a Netlify production deploy. A local Node 20+ preparation run using
secure process environment is also supported; do not paste credentials into commands.

## Acceptance and activation gates

Completed without publishing:

- Full unit suite: **860 passed, 0 failed**, 44 files, including 47 social contract
  checks, 24 preparation-worker checks and all 15 existing Buffer idempotency checks.
  Run in an isolated LF-normalized copy because existing repository text fixtures
  are sensitive to Windows CRLF; source files were not bulk reformatted.
- Apps Script/worker syntax checks and `git diff --check` passed. All 18 public-only
  packaging checks passed; the new backend files are not website publish inputs.
- Real owner-photo render: LEG-HD-000959, four actual Airtable Photos, locally
  verified H264/yuv420p 1080x1920, 30fps, exactly 12 seconds, no audio, approximately
  3.3MB. Frames at 1/5/10 seconds visually checked for real product, readable name,
  price/specs/branding/CTA. Nothing uploaded or published for this render test.
- Existing PR #18 crash/lost-ID/timeout/uncertain-retry protections retained in V2;
  old V1 journals remain readable and are never silently reset.
- Mocked sender tests cover shareNow, ordered multi-image assets, explicit
  Facebook/Instagram Reel metadata, stock/photo/control changes at each preflight,
  mid-channel changes, duplicates, unknown stock and disabled publishing.
- Worker tests cover signed immutable uploads/reuse, fingerprints, safe downloads,
  no fallback, format contracts and preparation-only workflow.
- Current queue backed up before status/note-only cleanup and read back.
  All non-M cells (including media/captions/IDs/error/journal notes) unchanged.
- Production still has only the existing maintenance, enrichment and Airtable
  sync triggers; social/cleanup triggers absent. Cleanup opt-in remains false.
  Original production Apps Script files, Airtable records and production website
  remain unchanged. Namespaced acceptance helpers are temporary and removed after
  acceptance; candidate source is not activated by testing.

Final live queue classification (64 products):

| Status | Count | Meaning |
| --- | --- | --- |
| Ready | 0 | Nothing authorized for automatic publication |
| Draft | 46 | Photos present; preparation/caption review and renewed approval needed |
| Needs Image | 4 | Missing owner Photos |
| Skip | 8 | Three prior owner exclusions, three zero-stock, two historical holds |
| Queued | 6 | Historical receipts preserved, not new publication authorization |

Missing Photos: HD-1004753980, LEG-HD-001518, LEG-HD-001309, LEG-HD-001515.
Lake Annette HD-1004669158 is Skip; both saved IDs remain untouched.
Dyson HD-1007846436 is Skip; its ambiguous historical error is preserved.
Neither may be reset/reposted without separately reviewing the old operation.

## Live non-publishing acceptance — September 28, 2026

Secure configuration was supplied by the owner; no secret values were logged.
The restricted read-only Airtable token retrieved 67 Website Products records.
Owner Photos produced five immutable images and one silent 1080x1920, 12-second
H264 MP4 (3,274,095 bytes). Repeated lookup and rotated Airtable signed URLs reused
existing assets without duplicate uploads/renders. All six durable URLs were
reachable. Keep these reusable assets; they are not public social publications.

Buffer acceptance used only `saveToDraft:true` with `mode:addToQueue`, behind a
temporary firewall that rejected every publishing mutation. Production policy
remains `shareNow`, with the rolling 48-hour cadence controlled by Apps Script.

| Media | Facebook draft | Instagram draft |
| --- | --- | --- |
| Single image | 6abaa0e16219c00209b7bb1e | 6abaa1007c19a799daebffee |
| Four-image carousel | 6ab9ecef54f1e60c7e867585 | 6abaa0b26706f7fb0100d48f |
| Reel | 6abaa1356706f7fb0100e30a | 6abaa14d0b9d13a08baa3683 |

Every draft recovered its original ID after simulated receipt-value loss, with
one exact remote match and no duplicate create. Each fixture used a separate
media-type/channel journal. The first cross-channel temporary-fixture attempt
failed closed; no Instagram create occurred until isolated state was installed.
Acceptance journals and these six labeled drafts are retained as evidence;
**never schedule or publish them**. Real Social Queue rows were not edited.

Live-context rejection cases used isolated fixtures against current production
data, not destructive edits of real products: sold out, Post to Website false,
missing Photos, changed approved attachment order, missing source and publishing
disabled each produced **zero Buffer create calls**. The changed-set case used a
stale approval manifest, not an Airtable edit. The missing-source key was nonexistent.

Final queue remains 46 eligible Draft, 4 Needs Image, 8 Skip, 6 historical Queued,
and 0 Ready. All values/notes match the preserved post-cleanup historical snapshot.
Lake Annette and Dyson remain Skip with their existing evidence intact.

The acceptance run found and fixed two real integration issues: Cloudinary Admin
video metadata is flattened (codec/audio), unlike nested upload metadata; and
Facebook video assets must omit Instagram's `thumbnailOffset`. Strict codec,
silence, identity/hash and size checks remain intact, with rejection regressions.
Social trigger installation now fails before any trigger operation unless the
owner explicitly enables `SOCIAL_PUBLISHING_ENABLED`; no Draft becomes Ready
automatically. Publishing, social triggers and destructive cleanup remain OFF.

Local maintained verification: 860 unit tests and 139 Chromium E2E tests passed,
zero failures after resolving local Python/browser availability with runtime-only
overrides. Apps Script/worker syntax checks and `git diff --check` passed. Temporary
GitHub acceptance workflow/script are excluded from the final PR candidate; the
intended preparation workflow is manual-only, standard Ubuntu, contents-read-only,
pinned checkout, no persisted Git credential, and no Buffer/Netlify credentials.

Draft acceptance proves API submission, stored media and receipt recovery—not
actual Meta publication. No real Facebook/Instagram content was published.
An inventory change after the last check but before Meta publishes remains an
unavoidable remote race; `shareNow` minimizes it but does not make it atomic.

Still required before separately approved production activation:

1. Review/deploy only the two changed social Apps Script files with social OFF;
   preserve all other bound-project source/properties/triggers.
2. Preserve the completed media/draft acceptance evidence; do not repeat uploads
   or publish acceptance drafts as a test.
3. Review exact media, facts/captions and intentional queue approval.
4. Keep publishing OFF until the owner separately authorizes live activation.
   Normal sender never uses acceptance draft mode.
5. Read-only Buffer reconciliation, re-audit Ready, inspect owner quota/account plan.
6. Only after non-publishing acceptance passes and owner approves activation:
   enable SOCIAL_PUBLISHING_ENABLED and intended social schedules separately.

The GitHub `social-media` environment currently has no required reviewer or branch
restriction. Before operational use, the owner should configure those protections
and review account quotas. This acceptance did not alter credentials, scopes or
environment security settings. Merge/release must preserve `[skip netlify]` or
otherwise explicitly prevent an unintended Netlify production build.

## Official contracts

- [Buffer shareNow enum](https://developers.buffer.com/types/ShareMode.html)
- [Buffer durable media requirement](https://developers.buffer.com/guides/hosting-media.html)
- [Buffer video assets](https://developers.buffer.com/examples/create-video-post.html)
- [Facebook Reel metadata](https://developers.buffer.com/types/FacebookPostMetadataInput.html)
- [Instagram Reel metadata](https://developers.buffer.com/types/InstagramPostMetadataInput.html)
- [Cloudinary upload signatures](https://cloudinary.com/documentation/authentication_signatures)
- [Cloudinary Admin lookup](https://cloudinary.com/documentation/admin_api)
- [Cloudinary Free allowances](https://cloudinary.com/documentation/billing_and_plans)
- [Public standard Actions runners](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

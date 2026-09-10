# Troubleshooting

Common failure modes and how to diagnose each. This assumes read access to
the Netlify dashboard and, where noted, the Airtable base.

## Form submissions (Check Availability / Get a Quote) not arriving

1. Check Netlify's Forms dashboard (Site → Forms) for the `quote-request` and
   `availability-request` forms. If Netlify has never registered these forms
   at all, the static hidden `<form>` declarations in `shop.html` (search for
   `data-netlify="true"`) are missing or were changed in a way Netlify's
   build-time HTML parser can no longer detect — the field list there must
   exactly match the fields the live JS-submitted form sends. See
   `test/inquiry-forms-check-availability-and-quote.test.mjs` for the
   expected field sets.
2. If the forms are registered but a specific submission is missing, check
   the browser console on the live site for a failed `fetch("/", ...)` call
   (open a modal, submit, watch Network tab) — a non-2xx response usually
   means the static declaration and the live payload's field names drifted
   apart.
3. Confirm Netlify's spam filtering (Akismet) hasn't quarantined the
   submission — check the Forms dashboard's spam tab.
4. The honeypot field is `bot-field` — a submission with that field filled
   in is silently treated as spam by Netlify; this is expected for bots, not
   a bug.

## Newsletter subscription flow issues

- **Confirmation email never arrives**: check `RESEND_API_KEY` is set in
  Netlify's environment variables (see `docs/ENVIRONMENT_VARIABLES.md`).
  `netlify/functions/subscribe.mts` logs a warning (not an error) and skips
  sending if the key or `BUSINESS_MAILING_ADDRESS` is missing — check the
  function's logs in the Netlify dashboard.
- **"Already subscribed" for someone who never subscribed**: check the
  Website Subscribers Airtable table directly for a stray record with that
  email — the subscribe flow is idempotent against existing records.
- **Unsubscribe link doesn't work**: confirm `netlify/functions/unsubscribe.mts`
  is deployed (check the Functions tab in Netlify) and that the link's token
  parameter matches what the function expects — a stale/old-format link from
  a much earlier email could predate a token-format change.

## Weekly digest not sending

1. Confirm `WEEKLY_DIGEST_ENABLED` is set to a truthy value in Netlify's
   production environment variables — if unset/false, `weekly-digest.mts`
   runs on schedule but intentionally sends nothing.
2. Check the function's scheduled-run logs in the Netlify dashboard
   (Functions → weekly-digest) for the two Friday UTC firing times (see the
   cron in `netlify/functions/weekly-digest.mts` — it fires at both UTC hours
   that 10am America/Chicago can fall on across DST, and the non-matching one
   is expected to exit early with "skipped").
3. Confirm `RESEND_API_KEY` is set — same failure mode as the subscribe flow.
4. To test digest content/rendering without risking a real send, use the
   isolated `digest-test` endpoint (`netlify/functions/digest-test.mts`) —
   requires `DIGEST_TEST_TOKEN` and `DIGEST_TEST_RECIPIENT` to be set, refuses
   to run at all when Netlify's deploy context is production, and never
   touches the real "Last Digest Sent At" tracking field.

## Preview/branch deploy showing up in Google search results

This should never happen — `netlify/edge-functions/preview-noindex.ts` sends
`X-Robots-Tag: noindex, nofollow` on every hostname except the two
production-indexable ones (`invictahomesupply.com`,
`www.invictahomesupply.com`). If a preview URL is indexed:

1. Verify the header is actually present: `curl -I <preview-url>` and check
   for `x-robots-tag: noindex, nofollow`.
2. If missing, check the edge function is still declared in
   `netlify/edge-functions/` and not accidentally excluded by
   `netlify.toml` or a path config change (see `export const config` at the
   bottom of `preview-noindex.ts`).
3. Run `node test/preview-noindex.test.mjs` — it asserts the hostname
   allowlist logic directly.
4. If a stale preview URL was already indexed before the fix, request
   removal via Google Search Console — the header fix prevents future
   indexing but doesn't retroactively de-index old crawls.

## Product page shows wrong/missing metadata (title, OG image, canonical)

Check `netlify/edge-functions/product-meta.ts` and
`test/product-meta.test.mjs` / `test/product-page-client-metadata.test.mjs`.
An unknown or invalid product ID should render a `noindex, follow` robots
meta tag and never show stale data from a previous product — if it does,
that's a regression in this edge function.

## Retailer/sourcing information visible to customers

This must never happen. `item.retailer` and `item.productUrl` are mapped
from Airtable but are deliberately never rendered in any customer-facing
HTML — see `test/product-detail-retailer-privacy.test.mjs` and
`test/product-card-external-link-removed.test.mjs`. If either field appears
on the live site, treat it as a regression and check recent changes to
`inventory.js`'s render functions (`productCard`, `initProductDetail`,
`contractorRowCta`, `renderContractorTable`).

## Test suite failing locally but the site works fine

Each test file in `test/` runs against the real `inventory.js`/`styles.css`/
HTML source via `vm.runInThisContext` or regex-based extraction — a failure
usually means source text the test depends on (an id, a class name, a CSS
breakpoint value) changed. Read the specific assertion message; these tests
are written to name exactly what they expected versus what they found.

## General diagnostic checklist

- `git status --short --branch` — confirm you're on the branch you think
  you're on and the tree is clean.
- `git fetch --all --prune` then compare `HEAD` against `origin/main` /
  `origin/final-pre-production` — confirm you're testing what's actually
  deployed.
- Netlify dashboard → Deploys — confirm the latest deploy succeeded and
  matches the commit you expect (`git rev-parse HEAD` vs. the deploy's
  commit SHA shown in Netlify).

# Disaster Recovery

Failure scenarios for the systems this site depends on, and how to recover
from each. This complements `docs/ROLLBACK.md` (which covers reverting the
website's own code) — this file covers the data and integrations around it.

## Scope of the system

```
Google Sheets (source workbook)
  → Google Apps Script sync (appscripts/)
  → Airtable (Website Products / Website Subscribers tables)
  → Netlify Functions (netlify/functions/, netlify/edge-functions/)
  → Static site (HTML/CSS/JS, served by Netlify)
```

Each layer can fail independently. Recovery for one layer generally does not
require touching the others.

## Airtable is unreachable or returns errors

**Symptom:** the shop/homepage/product pages show an empty or error state
instead of inventory.

- `netlify/functions/inventory.mts` calls Airtable directly; if it fails, the
  client-side `fetchInventory()` in `inventory.js` falls back to its last
  successful cached response (`localStorage`, keyed by `CACHE_KEY`) if one
  exists and is still within the configured cache window, so a brief Airtable
  outage may be invisible to recent visitors.
- If there is no usable cache, the site shows `CATALOG_MESSAGES.error`
  ("Unable to load inventory" style copy) rather than crashing.
- **Recovery:** this is an upstream Airtable availability issue, not
  something to fix in this repo — wait for Airtable to recover, or check
  Airtable's status page. No website code change is needed for a transient
  outage.
- If Airtable is reachable but the *data* is wrong (e.g. a bad sync run),
  see "Bad data synced from Google Sheets" below — do not "fix" it by
  changing website code.

## Airtable API token compromised or needs rotation

1. In Airtable, revoke the affected personal access token immediately.
2. Generate a replacement token scoped the same way (same base, same
   permission level) as the one it replaces.
3. Update the corresponding Netlify environment variable
   (`AIRTABLE_TOKEN` or `AIRTABLE_SUBSCRIBERS_TOKEN` — see
   `docs/ENVIRONMENT_VARIABLES.md` for which does what) in the Netlify
   dashboard. No redeploy is required — Netlify Functions read environment
   variables at invocation time.
4. If the same token value was ever committed to git (check with
   `git log -p -- inventory.js netlify/ | grep -i "pat"` as a starting
   point, understanding this scans full history and can be slow), treat it
   as compromised regardless of whether it's currently in the working tree —
   git history is permanent and world-readable to anyone with repo access.
   Rotating the token (step 1) neutralizes the exposure without requiring a
   history rewrite; a history rewrite is a separate, much higher-risk
   decision (see the note in the most recent repository audit).

## Bad data synced from Google Sheets → Airtable

**Symptom:** wrong prices, wrong statuses, duplicate rows, or missing items
appear on the live site shortly after a sync run.

1. Do not attempt to "fix" this in website code — the website only displays
   what Airtable returns.
2. Check the Apps Script project's execution log (Extensions → Apps Script →
   Executions, from the source Google Sheet) for the most recent sync run's
   output/errors.
3. Correct the source data in the Google Sheet (Current Inventory / Product
   Inventory / Product Catalog / Website Export, per the pipeline in
   `README.md`), then re-run the sync.
4. If a bad sync already overwrote good Airtable records and the source
   sheet itself was also wrong at sync time, Airtable's own revision history
   (available on paid plans, per-record) may be the only way to recover the
   prior values — check before manually re-entering data.

## Netlify outage or failed deploy

- **Failed deploy:** check the deploy log in the Netlify dashboard for the
  build error. Since this is a static site with no build step for the HTML/
  CSS/JS, a failed deploy is most likely a syntax error in one of the
  `.mts`/`.ts` functions — check the specific function Netlify's log names.
- **Netlify platform outage:** nothing to do on our side; check Netlify's
  status page. The last successful deploy remains live during a platform
  outage affecting new deploys.
- **Wrong commit deployed:** compare the deploy's commit SHA (shown in the
  Netlify dashboard) against `git rev-parse origin/main`. If they differ,
  trigger a new deploy from the correct branch/commit, or use "Publish
  deploy" on the correct prior deploy in Netlify's deploy list.

## Resend (email) outage or API key issue

- Both the subscribe-confirmation/welcome email and the weekly digest fail
  soft: if `RESEND_API_KEY` is missing or the Resend API errors, the
  function logs a warning and continues (the subscription itself still
  succeeds in Airtable; the digest run is simply skipped for that firing).
- **Recovery:** fix or rotate `RESEND_API_KEY` in Netlify's environment
  variables; no data is lost on the Airtable side by an email failure.
- The weekly digest does not mark itself as "sent" (does not update the
  Last Digest Sent At tracking field) if sending fails, so a fixed key will
  allow the next scheduled run to pick up where it left off — it does not
  auto-retry the missed Friday, though; the test/digest-test endpoint can be
  used to manually verify a fix before the next scheduled run.

## Full loss of the GitHub repository

- Netlify's site remains live independently (it serves the last deployed
  build; it does not need git access to keep serving traffic).
- Recovery requires restoring from a local clone, a collaborator's clone, or
  GitHub's own backup/recovery process (if enabled) — there is no separate
  repository mirror maintained for this project as of this writing. This is
  a gap; a recommended mitigation is any team member keeping a local clone
  reasonably current.

## Suspected data breach / unauthorized access

1. Rotate every credential in `docs/ENVIRONMENT_VARIABLES.md` immediately
   (Airtable tokens, Resend API key) regardless of which one you suspect —
   rotating is cheap, guessing wrong about scope is not.
2. Check Airtable's activity/audit log (if available on your plan) for
   unexpected record changes.
3. Check Netlify's deploy history for any deploy you didn't initiate.
4. Review recent GitHub commit history and branch list for anything
   unfamiliar.
5. Only after containment, investigate root cause (e.g. a leaked token in
   git history, a compromised collaborator account, an exposed `.env` file).

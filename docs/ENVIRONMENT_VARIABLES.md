# Environment Variables

Names and purposes only. Never commit actual values — they live in the
Netlify dashboard (Site configuration → Environment variables) and, for the
Apps Script sync, in that project's Script Properties. This file documents
what each variable is *for*, not what it *is*.

## Airtable (inventory)

| Variable | Purpose |
|---|---|
| `AIRTABLE_TOKEN` | Personal access token used by `netlify/functions/inventory.mts` to read the Website Products table. |
| `AIRTABLE_BASE_ID` | The Airtable base ID that holds the Website Products table. |
| `AIRTABLE_TABLE_NAME` | Name of the products table to read (defaults to `"Website Products"` in code if unset). |

## Airtable (subscribers)

| Variable | Purpose |
|---|---|
| `AIRTABLE_SUBSCRIBERS_TOKEN` | Personal access token used by the subscribe/unsubscribe/confirm/digest functions to read and write the subscribers table. Kept separate from `AIRTABLE_TOKEN` so the subscriber-write path has its own, independently revocable credential. |
| `AIRTABLE_SUBSCRIBERS_TABLE_NAME` | Name of the subscribers table. |

## Email (Resend)

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | API key used to send transactional email: subscription-confirmation emails, the welcome email, and the weekly digest email. If unset, the app logs a warning and skips sending rather than failing the request. |

## Weekly digest

| Variable | Purpose |
|---|---|
| `WEEKLY_DIGEST_ENABLED` | Feature flag gating whether `netlify/functions/weekly-digest.mts` actually sends the scheduled Friday digest. Absent/false = the scheduled function still runs on its cron but performs no sends. |
| `BUSINESS_MAILING_ADDRESS` | Physical mailing address included in outgoing email footers (e.g. the welcome email), typically for CAN-SPAM compliance. If unset, the app logs a warning and sends without it rather than failing. |
| `DIGEST_TEST_TOKEN` | Bearer token required to call the isolated `digest-test` preview endpoint. If unset, that endpoint refuses all requests (503) — see `netlify/functions/digest-test.mts`. |
| `DIGEST_TEST_RECIPIENT` | The single fixed email address the `digest-test` endpoint is allowed to send its preview to. The endpoint can never be told a different recipient by the caller. |

## Netlify-provided (not set by us)

| Variable | Purpose |
|---|---|
| `CONTEXT` | Netlify's built-in deploy-context variable (`production` / `deploy-preview` / `branch-deploy` / `dev`). Historically used by the preview-noindex logic, but that logic has since been rewritten to key off the request's hostname instead (see the comment in `netlify/edge-functions/preview-noindex.ts` explaining why) — `CONTEXT` is not currently read by any function. Documented here in case it resurfaces in future work. |

Separately, `netlify/functions/digest-test.mts` also reads
`context.deploy?.context` from the function's `Context` object (not an env
var) to refuse running when Netlify considers the current deploy production.

## Build-time (netlify.toml)

No environment variables are referenced in `netlify.toml` itself; it only
configures the functions directory and two redirect rules (`/shop.html` →
`/shop`, `/shop` → `/shop.html`).

## Local development

No `.env` file is required to view the static pages locally (see
`docs/LOCAL_DEVELOPMENT.md`) — the Netlify Functions/Edge Functions that
depend on the variables above only run under `netlify dev` or in a real
Netlify deploy. If you introduce a `.env` file for local `netlify dev` use,
name it `.env` (already gitignored) and never commit it; a `.env.example`
listing variable *names* only (no values) is explicitly allowed by
`.gitignore` if you want to check one in.

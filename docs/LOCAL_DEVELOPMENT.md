# Local Development

This is a static site (no bundler, no build step, no `package.json`) plus a
handful of Netlify Functions/Edge Functions written in TypeScript (`.mts`/
`.ts`, run by Netlify's own runtime, not compiled by us).

## Viewing the static pages

No dependencies to install. From the repository root:

```
python3 -m http.server 8080
```

Then open `http://localhost:8080/shop.html` (or `index.html`, `product.html`,
etc.) in a browser.

Caveat: pages that call `/api/inventory` (the shop, homepage, product-detail
pages) will show their empty/error state under a plain static server, because
that endpoint is a Netlify Function and does not exist outside a Netlify
runtime. To see real inventory data locally you need either:

- `netlify dev` (Netlify CLI) running against this repo with the real
  environment variables configured (see `docs/ENVIRONMENT_VARIABLES.md`), or
- a mocked `/api/inventory` response (intercept the request in a headless
  browser, e.g. Playwright's `page.route()`, and return a fabricated
  `{ records: [...] }` payload shaped like an Airtable list response — this
  is how manual verification was done in past development sessions without
  touching real Airtable data).

## Running with `netlify dev`

If you have the Netlify CLI installed and are linked to this project:

```
netlify dev
```

This serves the static files and runs the functions/edge functions together,
proxying `/api/inventory` and the form-submission endpoints for real. You'll
need the environment variables from `docs/ENVIRONMENT_VARIABLES.md` set,
either via `netlify link` (pulling the site's real values) or a local `.env`
file (gitignored — never commit it).

## Node version

The test suite and Netlify Functions assume a modern Node (the functions use
`.mts` — native TypeScript module support). Use whatever Node version your
Netlify site is configured for (check Site configuration → Build & deploy →
Environment in the Netlify dashboard) to keep local behavior consistent with
production.

## Running the test suite

See `docs/TROUBLESHOOTING.md` and the section below — in short:

```
for f in test/*.test.mjs; do node "$f"; done
```

Each file is a standalone Node script (no test framework dependency), and
prints `ok - <name>` / `NOT OK - <name>` per assertion plus a final pass/fail
summary. Run them individually while iterating (`node test/quote-eligibility.test.mjs`),
and run the full set before committing.

## Manual browser verification

For anything involving CSS breakpoints, modal focus behavior, or visual
layout, source-level tests are not a substitute for actually rendering the
page. Past sessions used headless Chromium (Playwright) with the static
server above plus a mocked `/api/inventory` route to screenshot the shop
page, product cards, and both inquiry modals at 320/390/1024/1440px. There is
no committed script for this (it's ad hoc, since Playwright is not a project
dependency) — recreate it as needed rather than relying on stale screenshots.

## Editing Airtable-synced data

Never edit inventory or subscriber data directly through this codebase's
local dev setup. The source of truth is the Google Sheets → Apps Script →
Airtable pipeline described in `README.md` and `docs/INVICTA_ARCHITECTURE.md`.
Local development here is for website code only.

# Local Development

This is a static site (no bundler, no build step for the site itself) plus a
handful of Netlify Functions/Edge Functions written in TypeScript (`.mts`/
`.ts`, run by Netlify's own runtime, not compiled by us). `package.json`
exists only for the automated test suite's dependencies (Playwright) and
`npm` scripts — it does not build or bundle the site.

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

`package.json`'s `engines` field pins Node `>=20.9.0`, matching the version
range this suite (and Netlify Functions' `.mts` native TypeScript support)
was developed and verified against. Check Site configuration → Build & deploy
→ Environment in the Netlify dashboard if you need to confirm the exact
version production runs.

## Installing test dependencies

```
npm ci
```

Installs Playwright (`@playwright/test`) and its accessibility-scanning
addon (`@axe-core/playwright`) — the only dependencies this repo has. This
does **not** install browser binaries; see the next section.

### Playwright's browser

The E2E suite (`npm run test:e2e`) requires a Chromium binary. Most sandboxes
this project is developed in come with one pre-installed and set
`PLAYWRIGHT_BROWSERS_PATH`/`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD`, so **you
usually do not need to run `playwright install` at all** — `playwright.config.mjs`
already points at `PLAYWRIGHT_CHROMIUM_PATH` (or the common
`/opt/pw-browsers/chromium` path) by default.

If your machine has no such pre-installed browser, install one normally:

```
npx playwright install chromium
```

Firefox and WebKit are configured as optional, non-default projects
(`npm run test:e2e:firefox` / `npm run test:e2e:webkit`) for the rare case you
want to sanity-check cross-browser behavior — install their binaries first:

```
npx playwright install firefox webkit
```

Neither runs as part of `npm test` or CI; only Chromium is release-blocking.

## Running the test suite

```
npm run test:unit    # every test/*.test.mjs once, in its own process
npm run test:e2e     # mocked Playwright E2E, Chromium only
npm test             # test:unit then test:e2e — what CI runs
```

`test:unit` runs every top-level `test/*.test.mjs` file (each a standalone,
dependency-free Node script — no test framework, no compilation) via
`test/run-unit-tests.mjs`, which prints each file's `ok - <name>` /
`NOT OK - <name>` lines plus a combined pass/fail summary and exits non-zero
on any failure. Run a single file directly while iterating, e.g.
`node test/quote-eligibility.test.mjs`.

`test:e2e` runs the Playwright specs under `test/e2e/` against a local static
server (auto-started by `playwright.config.mjs`) with `/api/inventory` and
Netlify Forms submissions intercepted — see "Playwright E2E suite" below.
It never touches real Airtable data or submits a real form anywhere.

## Deployment smoke test (read-only, targets a real URL)

```
SMOKE_BASE_URL=https://deploy-preview-123--invicta.netlify.app npm run test:smoke
```

`test:smoke` (`test/smoke/run-smoke-test.mjs`) is the only test in this repo
that hits a real, deployed site instead of local mocks. It:

- **Never runs without `SMOKE_BASE_URL` set** — there is no default target,
  production included, so a bare `npm run test:smoke` always no-ops with an
  error rather than guessing what to test.
- Is **HTTPS-only** unless the target is loopback or `SMOKE_ALLOW_HTTP=1` is
  set explicitly.
- Only ever sends **GET/HEAD** requests — it never submits a form, subscribes
  an email, calls a state-changing function, or follows a `tel:`/`sms:` link.
  It writes nothing anywhere and needs no credentials.
- Optionally takes `SMOKE_EXPECT_CONTEXT=preview` or `SMOKE_EXPECT_CONTEXT=production`
  to assert the `X-Robots-Tag` header matches that deploy context (see
  `netlify/edge-functions/preview-noindex.ts`); omit it to skip that assertion.

## Playwright E2E suite

`test/e2e/` holds the Chromium specs, grouped by area (`shop.spec.mjs`,
`inquiry.spec.mjs`, `product-detail.spec.mjs`, `navigation-and-overflow.spec.mjs`,
`accessibility.spec.mjs`). `test/e2e/fixtures/inventory.mjs` is the single
deterministic fixture dataset every spec reuses; `test/e2e/fixtures/mock-inventory.mjs`
exports `mockInventory()` (intercepts `/api/inventory`) and `mockFormSubmit()`
(intercepts the Netlify Forms POST and decodes the submitted fields, without
ever sending them anywhere real) — every spec that needs product data or
submits a form uses one or both of these instead of touching a live endpoint.

**Inspecting a failure:** on failure, Playwright saves a screenshot, an
`error-context.md` DOM snapshot, and a trace under `test/e2e/test-results/`
(gitignored) and an HTML report under `test/e2e/report/` (also gitignored).
Open the trace with:

```
npx playwright show-trace test/e2e/test-results/<test-folder>/trace.zip
```

or the HTML report with:

```
npx playwright show-report test/e2e/report
```

**Updating fixtures safely:** `test/e2e/fixtures/inventory.mjs` uses raw
Airtable-shaped field names (never real product/retailer data) so it
exercises the real `mapAirtableRecord()` mapping — if you add a fixture
record, give it a clearly fake `rec...`-style id and keep field names/shapes
consistent with what Airtable actually sends (check `inventory.js`'s
`mapAirtableRecord()` for the field list). Never point a fixture at a real
Airtable record ID.

## Regenerating the hero image (AVIF/WebP)

See `README.md`'s asset-inventory entry for
`assets/hero/hero-living-room-flooring.{avif,webp,png}`: all three files must
stay the same 2007×783 crop of the same photo. If you replace the source
photo, regenerate all three together — AVIF quality ~60, WebP quality
82/method 6 — so they never drift out of sync with each other.

## Manual browser verification

For anything involving CSS breakpoints, modal focus behavior, or visual
layout, source-level tests are not a substitute for actually rendering the
page — but the Playwright E2E suite now covers the previously-ad-hoc manual
checks (screenshotting the shop page/cards/modals at 320/390/1024/1440px+)
as real, repeatable tests (see `test/e2e/navigation-and-overflow.spec.mjs`'s
overflow sweep). Reach for a one-off manual check only for something the
suite doesn't already assert.

## Editing Airtable-synced data

Never edit inventory or subscriber data directly through this codebase's
local dev setup. The source of truth is the Google Sheets → Apps Script →
Airtable pipeline described in `README.md` and `docs/INVICTA_ARCHITECTURE.md`.
Local development here is for website code only.

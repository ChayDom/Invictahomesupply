# Invicta Home Supply — website

A static site (Home, Inventory, About, Visit Us, plus a shareable
Product detail view) with a live inventory catalog powered by Airtable,
hosted on **Netlify** (not Cloudflare). No monthly hosting fee, no online
payment, no code editing required to add/remove/update items once it's
set up. The Flooring Calculator lives entirely on the Inventory page
(its own "Flooring Calculator" button in the filter bar) — it's not a
separate page or header nav link.

`shop.html` and `contact.html` keep their original filenames/URLs (for
existing links and SEO) even though their nav labels/on-page branding now
read "Inventory" and "Visit Us" — only the UI text changed, not the routes.

We are a **local supplier of brand-new overstock and value-priced home
improvement products** — never use "liquidation," "clearance," or "discount
warehouse" anywhere on the site or in listings. Also avoid specific savings
claims like "50% under retail" unless they're actually computed from that
item's own Price vs. Was Price — don't state a blanket sitewide discount
percentage.

## Source of truth: Product Catalog + Product Inventory → Website Export → Airtable → site

**Airtable is a synced mirror, not the source of truth.** The real pipeline
is:

```
Google Sheets "Product Catalog" + "Product Inventory"  (you edit here — identity, merchandising, price, publish controls, live stock)
        │  Apps Script: Website Export is combined from Product Catalog + live Product Inventory
        ▼
Google Sheet "Website Export"   (generated — don't hand-edit)
        │  Apps Script sync pushes Website Export rows into Airtable
        ▼
Airtable "Website Products" table   (synced mirror the site reads from)
        │  Netlify serverless function (read-only)
        ▼
This website
```

**Never add or fill in a field directly in Airtable** — it's not in
Product Catalog, so the next Apps Script sync can silently overwrite or
ignore it.

### This site reuses real fields — it does not invent duplicates

Two earlier passes through this migration proposed new fields (Web
Category/Sell Unit/Specs/Web Status, then Website Category/Web
Subcategory) that turned out to duplicate what already exists in
production. **Confirmed against the real "Website Products" Airtable
table** — Title Case, and there is a single `Category` field, not a
separate "Website Category":

| This site's concept | Real Airtable field | Notes |
|---|---|---|
| Website navigation category | `Category` | Same field as the broad/internal category — see "How the site behaves during migration" for how a not-yet-clean value still resolves safely. |
| Second-level category | `Subcategory` | New. Optional — e.g. Flooring → Luxury Vinyl Plank/Laminate/Tile/Sheet Vinyl/Engineered Hardwood/Bamboo, Water Heaters → Gas/Electric, Tools → Power Tools/Hand Tools. Works fine blank. |
| Stable upsert identity | `Product Key` | Permanent — never Product ID, a legacy product can get a new standardized Product ID while keeping the same Product Key. |
| Product title | `Name` | |
| Sell unit | `Unit Type` | Existing field, values `Box`/`Each`/`Sq Ft`/`Roll` (site compares case-insensitively). Blank infers `Sq Ft` for Flooring, `Each` otherwise. |
| Asking price | `Price` | |
| Retail/comparison price | `Was Price` | Powers the "Retail $1,049" line. (A rename to `Retail Price` was discussed as a "potentially later" change — this code reads `Was Price`, today's actual field; update this table and `mapAirtableRecord()` together if that rename happens.) |
| Stock count | `Quantity Available` | Combines Product Catalog with live Product Inventory — never duplicated back into Product Catalog. |
| Availability | `Status` text, falling back to `Quantity Available > 0` | See "How the site behaves" below — `Status` can carry a specific "Reserved"/"Sold Out" label the pill shows verbatim. There is no separate `In Stock` boolean field in the live schema. |
| Publish gate | `Post to Website` | Unchanged — see "Publishing safeguards" below. |
| Long description | `Details` | Shown in the card's collapsed "More details" section. |
| Structured Flooring chips | `Wear Layer MIL`, `Thickness MM`, `Underlayment Attached`, `Water Resistance` | New, Flooring-specific, authoritative when present — see "Flooring's structured fields" below. Never parsed from a title. |
| Chips / bullets (non-Flooring, and Flooring's remaining slots) | `Highlights` | Fills any chip slots the structured fields above don't use; the rest still shows in full in "More details". No dedicated Specs field — deliberate. |
| Product photo | `Photos` (attachment, wins if present) → `Reference Image URL` (single-URL fallback) | Either way the card shows one main image; a gallery/thumbnail row only appears when `Photos` actually has more than one attachment. |
| Reference link | `Product URL` | Optional "View manufacturer page" link in "More details". |
| Brand / Model / Retailer / Retail SKU | same names | Unchanged, already existed. |
| Flooring math | `Box Price`, `Sq Ft Per Unit`, `Available Sq Ft` | Unchanged, already existed — boxes available is still computed client-side as `Available Sq Ft ÷ Sq Ft Per Unit`, never entered directly. |
| "New this week" | `Date Added` | Derived automatically (last 7 days) — no manual New flag. Not guaranteed populated yet ("potentially later" per the schema discussion) — works fine blank (just never tagged "New"). |

**Not currently read/used:** `Price Basis` exists in the field list shared
but its intended meaning wasn't specified — flagging rather than guessing
at behavior for it. If it matters for pricing display, describe what it
represents and it can be wired in.

**Hosting-path note:** this repo is built for and currently deployed on
**Netlify** — there's a `netlify.toml`, and `netlify/functions/inventory.mts`
is a Netlify serverless function holding the Airtable credentials
server-side. So the actual path today is Website Export → Airtable →
**Netlify function** → website, not Cloudflare Pages. If a move to
Cloudflare Pages is planned, that's a separate infrastructure change (the
serverless proxy would need rewriting for Cloudflare's runtime) — flag it
explicitly before assuming it.

## Flooring's structured fields (Flooring is the most structured category)

Flooring gets real comparison data instead of relying on free-text
Highlights, because customers compare flooring specs more than they read
descriptions. These fields are **authoritative when present — never
parsed out of a title or Highlights**:

| Field | Type | Values |
|---|---|---|
| `Subcategory` | Single select or text | Luxury Vinyl Plank, Laminate, Tile, Sheet Vinyl, Engineered Hardwood, Bamboo, ... |
| `Thickness MM` | Number | e.g. `5`, `6`, `6.5`, `7`, `8`, `10`, `12` |
| `Wear Layer MIL` | Number | e.g. `4`, `6`, `12`, `20`, `22` — blank/not-applicable for products like laminate that don't have one |
| `Underlayment Attached` | Single select `Yes`/`No` | (single select keeps it aligned with the Google Sheet more easily than a checkbox) |
| `Water Resistance` | Single select | `Waterproof`, `Water Resistant`, `Not Water Resistant`, `Unknown` |

**Chip priority** (Flooring's compact card uses this, via
`chipsAndRemainingHighlights()` in `inventory.js`):
Wear Layer → Thickness → Underlayment → Water Resistance, in that order,
skipping any that are blank/not-applicable (and always skipping
`Unknown` Water Resistance — it's never shown as a chip or offered as a
filter option). If fewer than 3 of those are available, Highlights lines
fill the remaining chip slots — never force a placeholder for a field
that doesn't apply, e.g. laminate simply shows fewer chips instead of an
empty "MIL" chip. Non-Flooring categories have no structured fields yet,
so Highlights remains their primary chip source until they get some.

### Flooring: Card View / Contractor View toggle

Flooring is the only category with a second, user-toggled layout. A
"Card View" / "Contractor View" pill toggle appears next to Sort/the
Flooring Calculator button, Flooring-only, defaulting to Card View (the
same grid every other category uses) — remembered for the browser tab via
`sessionStorage` (`loadFlooringViewMode()`/`saveFlooringViewMode()`), so
switching categories and back, or reloading, doesn't lose the choice; a
fresh tab always starts on Card View.

- **Card View** — unchanged: the responsive card grid, dropdown Type/
  Brand + structured filters, and the "Get a Quote" button on each card.
- **Contractor View** — a denser comparison layout aimed at many SKUs at
  once: a live "N SKUs · N sq ft in stock" eyebrow and a heading that
  names the active Type filter, the same Type/Brand/Thickness/Wear Layer/
  Underlayment/Water Resistance/Availability filters rendered as pill
  buttons instead of dropdowns, and one "Text to Hold" CTA per row (no
  quote button here — Get a Quote stays a Card View action). Desktop
  shows a table (`renderContractorTable()`); at ≤700px it's stacked cards
  instead (`renderContractorMobileCards()` → `.contractor-cards`) — never
  a horizontally-scrolling table — both rendered from the identical
  filtered/sorted array, CSS just picks which one is visible per
  breakpoint.

A shared "How much flooring do I need?" calculator callout
(`#flooring-calc-callout`, `bindFlooringCalcCallout()`) sits near the top
of the results area in **both** views whenever Flooring is active — a
quick sq-ft-with-10%-waste estimate, independent of and never modifying
the real room-by-room Flooring Calculator modal (it links out to that
modal for anything more than a single quick number). It's a native
`<details>`: open by default on desktop/tablet, collapsed behind its own
summary line on mobile (≤700px) — set once per render from the viewport
width, not fought on every re-render once a visitor has toggled it
themselves.

Both views/filter controls read and write the **same** filter state
(`currentBrand`, `currentThickness`, etc.) — the pill buttons aren't a
separate filter system, just a different control bound to the same
variables, so switching views mid-session doesn't reset your filters.
The option-derivation logic (`facetBrandOptions()`, `facetThicknessOptions()`,
etc.) is shared by both the dropdown renderer and the pill renderer, so
"what counts as a valid option" is defined exactly once.

## How the site behaves during migration (nothing currently live disappears)

`Post to Website` remains the only publish gate — not `Category`. The
site's canonical category list is the 19 categories in `CATEGORY_CONFIG`
(`inventory.js`): Flooring, Water Heaters, Appliances, Plumbing & Bath,
Lawn & Outdoor, Tools, Electrical & Lighting, Electronics & Smart Home,
Paint & Supplies, Building Materials, Doors & Windows, Heating & Cooling,
Home & Furniture, Cleaning & Household, Health & Personal Care,
Automotive, Sports & Fitness, Toys & Collectibles, and Other. There is no
`Home Improvement` category anymore — it was retired as an overly broad
catch-all.

Unlike the old 7-category system, an item is **never unpublished because
of its `Category` value** — a `Category` that isn't an exact canonical
match falls back through an **explicit allowlist — this is not a
catch-all**, and anything that still doesn't resolve lands in the
always-visible `Other` category rather than being hidden:

| `Category` value | Resolves to |
|---|---|
| Exact match to one of the 19 canonical names above | That category |
| `Flooring` / `Appliances` / `Tools` / `Water Heaters` (loose legacy spelling) | The matching category |
| Contains "Plumbing" or "Sinks" | Plumbing & Bath |
| Contains "Lawn" or "Outdoor" | Lawn & Outdoor |
| Contains "Electrical", "Wiring", "Breakers", "Outlets", "Switches", "Lighting", "Blinds", or "Shutters" | Electrical & Lighting |
| Contains "Paint", "Primer", "Coatings", "Stains", or "Caulk" | Paint & Supplies |
| Contains "Lumber", "Roofing", "Insulation", "Drywall", "Concrete", "Siding", or "Building Materials" | Building Materials |
| Contains "Windows & Doors" or "Storm Doors" | Doors & Windows |
| Contains "HVAC", "Air Condition", "Evaporative Cooler", "Space Heaters", "Heating", or "Cooling" | Heating & Cooling |
| Contains "Furniture", "Shelving", "Home Storage", or "Décor" | Home & Furniture |
| Contains "Vacuums", "Cleaning", or "Household" | Cleaning & Household |
| Contains "Personal Care", "Hygiene", "Deodorant", "Grooming", or "Oral Care" | Health & Personal Care |
| Contains "Automotive" or "Vehicle" | Automotive |
| Contains "Sports", "Fitness", or "Exercise" | Sports & Fitness |
| Contains "Toys", "Collectibles", or "Games" | Toys & Collectibles |
| **Blank**, and `Unit Type` = `Sq Ft` or a flooring-specific field (`Sq Ft Per Unit`, `Box Price`, `Available Sq Ft`, `Thickness MM`, `Wear Layer MIL`) is a positive number | **Flooring** — this site was flooring-only pre-migration, so a blank-Category row with flooring attributes is almost certainly an existing flooring listing whose Category never got filled in |
| Blank, with none of those attributes | **Other** |
| Legacy `Home Improvement` value, or anything else non-blank and unrecognized | **Other** — a visible, intentional fallback bucket, not an unpublished item. The Product Catalog has since been reclassified onto the 19 canonical categories above, so this should be rare in practice; it exists as a safety net, not the expected path. |

  This logic lives in `resolveWebCategory()` / `LEGACY_CATEGORY_RULES` /
  `hasFlooringAttributes()` in `inventory.js`, deliberately isolated so
  the legacy/unknown-value fallback rules can be removed later without
  touching the exact-match path.
- Availability (`isAvailable()`/`resolveStatusLabel()`) prefers the
  `Status` text (shown verbatim on the pill when it's more specific than
  "In Stock", e.g. "Reserved"), then `Quantity Available > 0`. There is no
  separate `In Stock` boolean field in Airtable — confirmed against the
  live schema — so this doesn't check for one. A not-in-stock item is
  never hidden here — it renders with a disabled status pill instead of
  the Text button. In practice, once the Apps Script export rule below is
  in place, most such rows won't reach this site at all; the client-side
  fallback is just a safety net.

**The Netlify function's Airtable filter is `{Post to Website} = TRUE()`**
— see `netlify/functions/inventory.mts`. Don't change that filter to key
off `Category` until every in-scope row has a clean value there.

## Publishing safeguards — do not weaken these

`Category`/`Subcategory` and the structured Flooring fields are additive
display/filtering information. They must never become a way to publish
something that wouldn't otherwise qualify. Whatever sets
`Post to Website = TRUE` during the Product Catalog → Website Export →
Airtable sync must keep requiring **all** of:

- `Post to Website = TRUE`
- Available inventory greater than 0 (the discussed rule: `Post to Website
  = Yes AND Quantity Available > 0`)
- `Price` (Website Price) filled in
- Image approved/available
- Enrichment status is not `NEEDS REVIEW`
- For Flooring rows specifically: the flooring quantity and sq-ft fields
  are filled in

This site's code has no way to independently verify "available inventory"
or "enrichment status" — it only ever sees what the Netlify function reads
from Airtable, gated by `Post to Website`. So these checks have to keep
happening upstream; nothing about the display fields above should bypass
or loosen any of them.

## Rollout plan

1. Populate a **small test set** in Product Catalog (5-10 rows spanning a
   few categories, with `Category`/`Subcategory` filled in — Flooring rows
   should also get `Thickness MM`/`Wear Layer MIL`/`Underlayment
   Attached`/`Water Resistance` where they apply).
2. Run Website Export, then the Apps Script sync, then check the actual
   `Website Products` Airtable records against the field table above.
3. Use a deploy preview to sanity-check before merging/deploying live.
4. Only after every row you want published has a clean `Category` value
   should the Netlify function's filter be reconsidered — see "How the
   site behaves during migration" above for what happens either way.

### Marking items out of stock, sold, or new

- Zero out `Quantity Available` (or set `Status` to something other than
  "In Stock") to show a disabled status pill instead of the Text button —
  the item stays visible, it isn't removed. Uncheck `Post to Website` if
  you actually want it gone from the site.
- Anything with a **Date Added** within the last 7 days is automatically
  tagged "New" on the site — no extra field to manage, and "New This
  Week" on the homepage is derived from this, never a manual flag.

### Connect it to the site

The site never talks to Airtable directly from the browser — it calls its
own `/api/inventory` Netlify serverless function
(`netlify/functions/inventory.mts`), which holds the Airtable credentials
server-side. Nothing Airtable-related lives in `inventory.js` itself.

1. In Airtable, open your profile icon → **Builder/Developer hub** →
   **Personal access tokens** → create a new token.
2. Give it the `data.records:read` scope only (read-only — the site never
   writes back to Airtable), and add the base you just created under "Access".
3. Copy the token (you'll only see it once), and find your Base ID (Help →
   API documentation, or the URL when your base is open — starts with `app...`).
4. In **Netlify → Site settings → Environment variables**, set:
   - `AIRTABLE_TOKEN` — the personal access token
   - `AIRTABLE_BASE_ID` — your Base ID
   - `AIRTABLE_TABLE_NAME` — `Website Products` (optional; defaults to `Website Products` if unset)
5. Redeploy. The site will now show your real inventory through the
   function, filtered by `Post to Website`.

## Before you go live

Open **app.js** and edit the block at the top — every page pulls contact
info from here, so you only edit it once:

```js
window.SITE_CONFIG = {
  businessName: "Invicta Home Supply",
  phoneDisplay: "(555) 123-4567",     // your real number
  phoneHref: "+15551234567",           // same number, digits only, country code
  email: "hello@invictahomesupply.com",
  city: "Your City, ST",
  pickupAddress: "...",
  hours: "Mon–Sat, 9am–6pm",
  facebookUrl: "https://www.facebook.com/...",
};
```

**Note on `.js` files and Windows:** if Windows flags `app.js` or
`inventory.js` with a security warning when you unzip, right-click the zip
(or the file) → Properties → check "Unblock" → Apply. This is just Windows
being cautious about the `.js` file type — these are safe, plain JavaScript
files a browser reads, not something that runs on its own.

Then set up Airtable (see above) and add your real inventory there — you
won't need to touch shop.html or index.html again for day-to-day updates.

Also worth doing before your first post: text START to your own number to
confirm the opt-in link works, and open `marketplace-post-templates.md` for
ready-to-use text when you cross-post to Facebook Marketplace and local
groups.

## Deploying to invictahomesupply.com

The simplest free option is **Netlify**, since your domain is already
purchased separately (e.g. GoDaddy, Namecheap, Google Domains):

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop) and create a
   free account.
2. Drag the whole `invictahomesupply-site` folder onto the page. Netlify
   deploys it instantly and gives you a temporary URL — check that
   everything looks right there first.
3. In Netlify, go to **Site settings → Domain management → Add a domain**
   and enter `invictahomesupply.com`.
4. Netlify will show you DNS records to add (usually an A record and a
   CNAME for `www`). Log into wherever you bought the domain, open its DNS
   settings, and add those records.
5. DNS changes can take anywhere from a few minutes to ~24 hours to
   propagate. Netlify auto-issues a free HTTPS certificate once it's live.

**Alternatives**, same idea (host files, point DNS at them):
- **Vercel** (vercel.com) — similarly drag-and-drop / CLI-based.
- **GitHub Pages** — free if you don't mind pushing the folder to a GitHub
  repo first.
- **Your domain registrar's own hosting** — some registrars (GoDaddy,
  Namecheap) offer basic file hosting where you can upload these files
  directly without touching DNS at all.

If you'd rather do this together instead of following the steps solo, ask
and we can walk through it live using a browser tool.

## UI revamp (header, homepage, inventory page, product detail)

- **Header** — the top announcement bar and the separate "Contact Us" CTA
  are gone. One CTA remains ("See what's in stock"), plus a phone link
  with an icon that always reads `tel:+12145522145`. The header
  compacts on scroll (`.site-header.scrolled`, toggled by a scroll
  listener in `app.js`) to roughly 64-70px tall. At ≤480px it collapses
  to logo + phone icon + hamburger — the "Call or text" label and the CTA
  button both drop, but the phone icon stays a real tap target.
- **Homepage hero** — a real living-room LVP flooring photo
  (`assets/hero/hero-living-room-flooring.png`, set via the `--hero-photo`
  custom property on the `.hero` section in `index.html`), with a
  left-to-right dark green scrim (`styles.css`) keeping the left-aligned
  text readable while the photo shows through on the right. The `$X.XX`
  in the headline and the sq-ft figure in the stat strip are both
  computed live from the fetched inventory
  (`updateHomepageDynamicContent()` in `inventory.js`) — never hardcoded.
- **Category tiles** — also placeholder gradients (a large faint icon per
  tile) for the same reason; swap in real category photos when available.
- **Inventory page** — category tabs show a live item count (e.g.
  "Flooring (3)") and hide entirely at zero, computed once from the
  fetched set (`updateCategoryTabCounts()`). The active category reads
  from and writes to `?cat=<Category Name>` in the URL via
  `history.pushState`/`replaceState` (`syncCategoryUrl()`) — no full
  reload, Back/Forward work. Legacy `#slug` hash links (footer/older
  bookmarks) still resolve via `CATEGORY_SLUGS`.
- **No fake inventory, ever** — `FALLBACK_ITEMS`/sample data have been
  removed entirely. `fetchInventory()` now returns real items or an
  explicit error; a fetch failure with no usable prior cache renders
  `CATALOG_MESSAGES.error` ("We couldn't load inventory right now — text
  us and we'll check availability for you.") instead of anything a
  customer could mistake for real stock. A genuinely empty category
  shows "Nothing in this category right now — text us for what's
  coming."; an over-filtered/searched category shows the narrower "No
  matching items right now" message instead. Every grid/table shows
  "Loading inventory…" as static markup until the first render replaces it.
- **Product detail page** (`product.html?id=<Product Key>`) — a
  shareable, full-detail view reusing `priceBlock()`/`statusBadge()`/
  `smsHrefForItem()` from the card so pricing/availability/CTA logic
  isn't duplicated. Reads from the same fetched inventory as every other
  page (no separate API call). Sets `document.title` and the meta
  description dynamically once the item loads. Card/table product
  names and photos now link here (`productDetailHref()`).
- **SMS body format** changed to exactly `Hi, I'm interested in <name>
  (<Product Key>).` (`smsMessageForItem()`) — no more "SKU:" prefix or
  trailing question.

## File map

- `index.html` — homepage (dynamic-price hero, stat strip, category tiles, "New This Week" by Date Added, SMS opt-in)
- `shop.html` — Inventory page: category tabs w/ live counts, one responsive card grid shared by every category, plus Flooring's extra structured filter row and its Card View/Contractor View toggle (see below)
- `product.html` — shareable product detail view (`?id=<Product Key>`)
- `about.html` — story + 3 consolidated reasons + image slots + who-we-serve
- `contact.html` — Visit Us: contact info + FAQ
- `styles.css` — shared styles
- `app.js` — contact-info config + mobile menu + scroll-compact header + copyright year + SMS links
- `inventory.js` — Airtable config + fetch/cache (no fake fallback) + product card, Contractor View (table + mobile cards), and product detail rendering (chips/pricing structured-first for Flooring)
- `netlify/functions/inventory.mts` — serverless proxy to Airtable (holds the API token server-side; filters on `Post to Website = TRUE`)
- `marketplace-post-templates.md` — copy-paste posts for Marketplace/FB groups
- `assets/hero/hero-living-room-flooring.{avif,webp,png}` — the homepage hero photo, served via `.hero-photo` in `styles.css` as AVIF first, WebP second, PNG fallback (`image-set()`, no JS). All three are the same 2007×783 crop of the same photo — if the source photo is ever replaced, regenerate all three from the new PNG together (AVIF quality ~60, WebP quality 82/method 6) so they never drift out of sync with each other.
- `package.json` — test-suite-only dependencies (Playwright) and `npm` scripts; does not build or bundle the site
- `test/*.test.mjs` — dependency-free unit/DOM-integration tests run against the real source files
- `test/e2e/` — Playwright end-to-end specs (mocked network, Chromium)
- `test/smoke/run-smoke-test.mjs` — read-only smoke test against a real deployed URL
- `.github/workflows/test.yml` — CI: runs `npm test` on PRs/pushes to `main`/`final-pre-production`

## Testing

See `docs/LOCAL_DEVELOPMENT.md` for full setup. Summary:

```
npm ci                              # install Playwright (the only dependency)
npm run test:unit                   # 500+ dependency-free unit/DOM tests
npm run test:e2e                    # Playwright E2E, Chromium, fully mocked network
npm test                            # test:unit then test:e2e — what CI runs
SMOKE_BASE_URL=<url> npm run test:smoke   # read-only check against a real deploy
```

Every test in `test/` and `test/e2e/` runs entirely offline against real
source files and mocked network responses — never real Airtable data, and
never a real form submission. Only `test/smoke/run-smoke-test.mjs` talks to
a real deployed URL, and even it is GET/HEAD-only and refuses to run without
an explicit `SMOKE_BASE_URL`.

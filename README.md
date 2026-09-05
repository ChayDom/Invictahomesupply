# Invicta Home Supply — website

A 4-page static site (Home, Shop, About, Contact) with a live inventory
catalog powered by Airtable. No monthly hosting fee, no online payment, no
code editing required to add/remove/update items once it's set up.

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

**Chip priority** (compact card and the Flooring table's Specs column
both use this, via `chipsAndRemainingHighlights()` in `inventory.js`):
Wear Layer → Thickness → Underlayment → Water Resistance, in that order,
skipping any that are blank/not-applicable (and always skipping
`Unknown` Water Resistance — it's never shown as a chip or offered as a
filter option). If fewer than 3 of those are available, Highlights lines
fill the remaining chip slots — never force a placeholder for a field
that doesn't apply, e.g. laminate simply shows fewer chips instead of an
empty "MIL" chip. Non-Flooring categories have no structured fields yet,
so Highlights remains their primary chip source until they get some.

## How the site behaves during migration (nothing currently live disappears)

`Post to Website` remains the only publish gate — not `Category`. Until
every row has a clean 7-category `Category` value:

- A `Category` that isn't an exact match falls back through an **explicit
  allowlist — this is not a catch-all**:

  | `Category` value | Resolves to |
  |---|---|
  | `Flooring` | Flooring |
  | `Appliances` | Appliances |
  | `Tools` | Tools |
  | `Water Heaters` | Water Heaters |
  | Contains "Plumbing" or "Sinks" | Plumbing & Bath |
  | Contains "Lawn" or "Outdoor" | Lawn & Outdoor |
  | Contains "Lighting", "Windows & Doors", "Blinds", or "Shutters" | Home Improvement |
  | **Blank**, and `Unit Type` = `Sq Ft` or a flooring-specific field (`Sq Ft Per Unit`, `Box Price`, `Available Sq Ft`, `Thickness MM`, `Wear Layer MIL`) is a positive number | **Flooring** — this site was flooring-only pre-migration, so a blank-Category row with flooring attributes is almost certainly an existing flooring listing whose Category never got filled in |
  | Blank, with none of those attributes | **Not published** |
  | Anything else (non-blank, unrecognized — e.g. Electronics, Gaming, Toys, Collectibles, Health & Personal Care) | **Not published**, even if `Post to Website` is `TRUE` — those product lines are out of scope for this storefront and are never guessed into a tab |

  This logic lives in `resolveWebCategory()` / `LEGACY_CATEGORY_RULES` /
  `hasFlooringAttributes()` in `inventory.js`.
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

## File map

- `index.html` — homepage (hero, category tiles, mixed "New This Week", SMS opt-in)
- `shop.html` — full catalog: 7 category tabs, card grid for most categories, contractor-style table for Flooring
- `about.html` — story + how reserving works + why-buy-local
- `contact.html` — contact info + FAQ
- `styles.css` — shared styles
- `app.js` — contact-info config + mobile menu + filter logic + SMS links
- `inventory.js` — Airtable config + fetch/cache + product card & flooring table rendering
- `netlify/functions/inventory.mts` — serverless proxy to Airtable (holds the API token server-side; filters on `Post to Website = TRUE`)
- `marketplace-post-templates.md` — copy-paste posts for Marketplace/FB groups

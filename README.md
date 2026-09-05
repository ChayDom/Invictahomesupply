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

## Source of truth: Product Catalog → Website Export → Airtable → site

**Airtable is a synced mirror, not the source of truth.** The real pipeline
is:

```
Google Sheet "Product Catalog"  (you edit here)
        │  Apps Script: Website Export sheet is built from Product Catalog
        ▼
Google Sheet "Website Export"   (generated — don't hand-edit)
        │  Apps Script sync pushes Website Export rows into Airtable
        ▼
Airtable "Inventory" table      (synced mirror the site reads from)
        │  Netlify serverless function (read-only)
        ▼
This website
```

**Never add or fill in a new field directly in Airtable.** Anything typed
straight into Airtable is not in Product Catalog, so the next Apps Script
sync run can silently overwrite or ignore it. Every new field (`Web
Category`, `Sell Unit`, `Specs`, `Web Status`, `Quantity Available`) has to
originate as a **Product Catalog column**, get carried through **Website
Export**, and get added to the **Apps Script payload** that writes to
Airtable — see the three sections below for the exact spec.

## Staged migration — how the site behaves right now

The site is mid-migration to the new field set. **`Post to Website`
(existing checkbox) is still the only publish gate** — not `Web Category`,
not `Web Status`. The new fields add display and filtering information;
they never replace or weaken the existing publishing safeguards (see the
next section). Until Product Catalog has been updated and re-synced:

- A row with a blank `Web Category` falls back to the existing `Category`
  field, but **only through an explicit allowlist — this is not a
  catch-all**:

  | Legacy `Category` | Falls back to |
  |---|---|
  | `Flooring` | Flooring |
  | `Appliances` | Appliances |
  | `Tools` | Tools |
  | `Water Heaters` | Water Heaters |
  | Contains "Plumbing" or "Sinks" | Plumbing & Bath |
  | Contains "Lawn" or "Outdoor" | Lawn & Outdoor |
  | Contains "Lighting", "Windows & Doors", "Blinds", or "Shutters" | Home Improvement |
  | **Blank**, and the row has a flooring-specific attribute (`Sq Ft Per Unit`, `Box Price`, or `Available Sq Ft` is a positive number) | **Flooring** — see note below |
  | Blank, with none of those attributes | **Not published** — see below |
  | Anything else (non-blank, unrecognized) | **Not published** — see below |

  `Electronics`, `Gaming`, `Toys`, `Collectibles`, `Health & Personal
  Care`, and any other unrecognized *non-blank* Category value are
  **deliberately not auto-categorized and not published**, even if
  `Post to Website` is `TRUE` — those product lines are out of scope for
  this home-improvement storefront and must never be guessed into a tab.
  If one of these needs to go live, it has to get a real `Web Category`
  from Product Catalog first.

  A **blank** Category is a special case: this site was flooring-only
  before this migration, so a blank-Category row that already has
  flooring-specific numbers filled in is treated as an existing flooring
  listing whose Category field simply never got filled in — it falls back
  to Flooring rather than disappearing. This inference is flooring-only
  and never applies to a row with a non-blank Category (however
  unrecognized) or to a blank-Category row with no flooring attributes —
  those stay unpublished, same as any other unrecognized value, until they
  get a real `Web Category`.
- A row with a blank `Web Status` is **not hidden** — the existing
  `Status` field (`In Stock` / `Reserved` / `Sold Out`) is used instead,
  and this stays true until Product Catalog's rollout is far enough along
  to switch over; `Web Status` does not replace the existing status field
  yet, it's additive/optional. Reserved/Sold items still render on the
  site, just with a disabled status pill in place of the "Text About This
  Item" button (this matches the site's pre-migration behavior).
- A row with a blank `Sell Unit` is inferred: `sq ft` if it resolved to
  the Flooring category, `each` otherwise.
- A row with blank `Specs` just shows no spec chips. A row with blank
  `Quantity Available` just omits the "N available" line. Neither hides
  the product.

This logic lives in `mapAirtableRecord()` / `resolveWebCategory()` /
`resolveWebStatus()` / `LEGACY_CATEGORY_RULES` in `inventory.js` — once
every row has a real `Web Category` and `Web Status` from Product Catalog,
these can be simplified to drop the legacy fallbacks (the code comments
say so at each one).

**The Netlify function's Airtable filter is currently
`{Post to Website} = TRUE()`** (not Web Category/Web Status) for the same
reason — see `netlify/functions/inventory.mts`. Don't change that filter
until Web Category/Web Status are populated and verified for every
in-scope row.

## Publishing safeguards — do not weaken these

The 5 new fields are additive display/filtering information. They must
never become a way to publish something that wouldn't otherwise qualify.
Whatever sets `Post to Website = TRUE` during the Product Catalog →
Website Export → Airtable sync must keep requiring **all** of:

- `Post to Website = TRUE`
- Available inventory greater than 0
- Website Price filled in
- Image approved/available
- Enrichment status is not `NEEDS REVIEW`
- For Flooring rows specifically: the flooring quantity and sq-ft fields
  are filled in

This site's code has no way to independently verify "available inventory"
or "enrichment status" — it only ever sees what the Netlify function reads
from Airtable, gated by `Post to Website`. So these checks have to keep
happening upstream, in whatever logic currently sets `Post to Website`;
adding `Web Category`/`Sell Unit`/`Specs`/`Web Status`/`Quantity Available`
to the export must not bypass or loosen any of them.

## Product Catalog columns to add (do this first, in the Sheet)

Add these columns to **Product Catalog** (not Website Export, not
Airtable — those are downstream). Suggested position: anywhere after your
existing columns: **do not insert columns in the middle of the existing
retailer-tab columns**, since the current automation reads those by
position.

| Product Catalog column | Type / allowed values | Notes |
|---|---|---|
| `Web Category` | Dropdown (data validation), one of: `Flooring`, `Water Heaters`, `Appliances`, `Plumbing & Bath`, `Lawn & Outdoor`, `Tools`, `Home Improvement` | Leave blank during migration only for rows whose existing `Category` matches the allowlist in "Staged migration" above (Flooring/Appliances/Tools/Water Heaters/Plumbing/Sinks/Lawn/Outdoor/Lighting/Windows & Doors/Blinds/Shutters), or whose `Category` is itself blank but flooring fields (Sq Ft Per Unit/Box Price/Available Sq Ft) are filled in. Anything else (Electronics, Gaming, Toys, Collectibles, Health & Personal Care, a blank Category with no flooring fields, etc.) needs `Web Category` filled in explicitly before it can go live — it will not be published otherwise. |
| `Sell Unit` | Dropdown: `each`, `box`, `sq ft` | Leave blank to let the site infer it. |
| `Specs` | Free text | Up to 3 short specs separated by `\|`, e.g. `40 gal\|Natural gas\|Rheem` or `22 MIL\|Waterproof\|Click-lock`. Keep each segment short — it renders as a pill chip. |
| `Web Status` | Dropdown: `In Stock`, `Reserved`, `Sold`, `Coming Soon` | Leave blank during migration — the site falls back to your existing stock/status column. |
| `Quantity Available` | Number | Optional. Units (or boxes, for `box` Sell Unit) currently in stock. Blank just omits the "N available" line, never hides the item. |

Also confirm these **already exist** and are populated for every row you
want on the site (the site depends on them and they aren't new):
`Product Key` (permanent, stable — used to update the matching Airtable
record so re-syncing never creates a duplicate), `Name`, `Price`,
`Post to Website`, and your existing stock-status column.

## Website Export mapping

Website Export should carry the 5 new columns straight through under the
**exact same header names** Airtable expects (case- and spacing-sensitive,
since the Apps Script payload keys off these headers):

| Website Export column (exact header) | Sourced from Product Catalog | Airtable field it becomes |
|---|---|---|
| `Web Category` | `Web Category` | `Web Category` |
| `Sell Unit` | `Sell Unit` | `Sell Unit` |
| `Specs` | `Specs` | `Specs` |
| `Web Status` | `Web Status` | `Web Status` |
| `Quantity Available` | `Quantity Available` | `Quantity Available` |

No transformation needed — pass the values through as-is, including blanks
(don't default them in Website Export; let the site's fallback logic
handle blanks, so you can see in Airtable exactly which rows still need
attention).

## Apps Script payload changes

In whatever function builds the Airtable `fields` object for each row
(the create/update payload), add the 5 new keys the same way the existing
fields are added — e.g. if the script currently does something like:

```js
const fields = {
  "Name": row.name,
  "Price": row.price,
  "Post to Website": row.postToWebsite,
  // ...
};
```

add:

```js
fields["Web Category"] = row.webCategory || undefined;       // omit key if blank, don't send ""
fields["Sell Unit"] = row.sellUnit || undefined;
fields["Specs"] = row.specs || undefined;
fields["Web Status"] = row.webStatus || undefined;
fields["Quantity Available"] = row.quantityAvailable === "" ? undefined : row.quantityAvailable;
```

Three things that matter for safety here:

1. **Upsert by `Product Key`, never by row position or by creating new
   records.** Look up the existing Airtable record with that `Product Key`
   and update it; only create a new record if no match exists. This is
   almost certainly already how the sync works for existing fields —
   just don't change that behavior for the new ones.
2. **Never send a blank/empty value for the `Photos` field.** If a row's
   photo column is empty, omit `Photos` from the payload entirely rather
   than sending `""` or `[]` — Airtable attachment fields interpret a
   payload key as "replace with this," so sending blank wipes out photos
   someone already uploaded directly in Airtable.
3. **Omit the key rather than sending an empty string** for the 5 new
   fields too, for the same reason and so blank vs. "explicitly cleared"
   stays distinguishable in Airtable while you're spot-checking the
   migration.

## Rollout plan

1. Add the 5 columns to Product Catalog (above) and set up the dropdown
   validations for `Web Category`/`Sell Unit`/`Web Status`.
2. Populate a **small test set** (5-10 rows spanning a few categories).
3. Run Website Export, confirm the 5 columns appear with the exact header
   names above and correct values (including intentionally-blank ones).
4. Run the Apps Script sync, then open Airtable and verify those specific
   records got the right values and existing Photos weren't touched.
5. Only then consider flipping the Netlify function's filter from
   `Post to Website` to `Web Category`/`Web Status`, and only after every
   row you want published has both set — otherwise items disappear (see
   the "Staged migration" section above for exactly what happens either
   way).
6. Use a deploy preview to sanity-check before merging/deploying live.

## Airtable field reference

These are the exact Airtable field names the sync above should write to —
already present or need adding to the **Inventory** table if this is your
first time connecting Airtable at all:

### Set up your Airtable base (one-time, ~10 minutes)

1. Go to [airtable.com](https://airtable.com) and create a free account.
2. Create a new base. Name the table **Inventory** (must match exactly, or
   update `tableName` in `inventory.js`).
3. Add these fields, matching these exact names and types:

   | Field name | Type |
   |---|---|
   | Name | Single line text |
   | Category | Single select — your own internal reporting categories (see above), as broad or granular as you like |
   | Web Category | Single select — **exactly one of:** `Flooring`, `Water Heaters`, `Appliances`, `Plumbing & Bath`, `Lawn & Outdoor`, `Tools`, `Home Improvement`. Blank falls back to the legacy `Category` field only via the explicit allowlist in "Staged migration" above, plus one special case: a blank `Category` with flooring fields filled in (Sq Ft Per Unit/Box Price/Available Sq Ft) falls back to Flooring. Anything else — unrecognized non-blank Category, or blank Category with no flooring fields — is **not published** until `Web Category` is filled in. |
   | Sell Unit | Single select — `each`, `box`, or `sq ft`. Controls the price format shown (e.g. flooring is priced `sq ft`; a water heater or appliance is `each`). |
   | Specs | Single line text — up to three short specs separated by `\|`, e.g. `22 MIL\|Waterproof\|Click-lock` or `40 gal\|Natural gas\|Rheem`. Shown as chips on the product card. |
   | Price | Number |
   | Was Price | Number (optional — the retail/comparison price shown as "Retail $X" for `each`/`box` items; leave blank if you don't have one) |
   | Quantity Available | Number (optional — units/boxes in stock; shown as "N available" for `each`/`box` items) |
   | Brand | Single line text (optional) |
   | Model | Single line text (optional) |
   | Details | Long text (shown in the card's collapsed "More details" section, not up front) |
   | Highlights | Long text, one line per bullet (also shown in "More details") |
   | Web Status | Single select — `In Stock`, `Reserved`, `Sold`, `Coming Soon`. Once the site's publish gate is switched over to this field (see "Rollout plan" above), only `In Stock` items will be exported; until then, blank falls back to the existing stock/status field and `Post to Website` remains the actual gate. |
   | Photos | Attachment (supports multiple photos per row — drag them all in) |
   | Date Added | Date (used to mark items "New" for 7 days automatically) |

   Flooring-specific fields (used only when Sell Unit is `sq ft`):

   | Field name | Type |
   |---|---|
   | Box Price | Number |
   | Sq Ft Per Unit | Number (sq ft covered per box) |
   | Available Sq Ft | Number (total sq ft in stock — boxes available is calculated automatically as Available Sq Ft ÷ Sq Ft Per Unit) |

4. Add a few rows to test — drag 2-3 photos into the Photos field per item.
   Since everything you sell is brand new (overstock/discontinued, not
   open-box or used), it's worth starting every **Details** entry with
   "Brand new —" for consistency, e.g. "Brand new, 20mil wear layer,
   clicklock, ~38 sq ft per box."

### Connect it to the site

The site never talks to Airtable directly from the browser — it calls its
own `/api/inventory` Netlify serverless function (`netlify/functions/inventory.mts`),
which holds the Airtable credentials server-side. Nothing Airtable-related
lives in `inventory.js` itself.

1. In Airtable, open your profile icon → **Builder/Developer hub** →
   **Personal access tokens** → create a new token.
2. Give it the `data.records:read` scope only (read-only — the site never
   writes back to Airtable), and add the base you just created under "Access".
3. Copy the token (you'll only see it once), and find your Base ID (Help →
   API documentation, or the URL when your base is open — starts with `app...`).
4. In **Netlify → Site settings → Environment variables**, set:
   - `AIRTABLE_TOKEN` — the personal access token
   - `AIRTABLE_BASE_ID` — your Base ID
   - `AIRTABLE_TABLE_NAME` — `Inventory` (optional; defaults to `Inventory` if unset)
5. Redeploy. The site will now show your real inventory through the
   function, filtered by `Post to Website` (see "Staged migration" above).

### Marking items sold, reserved, or new

- Setting **Web Status** to `Reserved`, `Sold`, or `Coming Soon` (or the
  legacy **Status** field, while Web Status is still blank — see "Staged
  migration") keeps the item visible with a disabled status pill instead of
  the Text button; it does not remove the item from the site. Uncheck
  **Post to Website** if you actually want it gone.
- Anything with a **Date Added** within the last 7 days is automatically
  tagged "New" on the site — no extra field to manage.

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
- `netlify/functions/inventory.mts` — serverless proxy to Airtable (holds the API token server-side; only exports items with a Web Category set and Web Status = In Stock)
- `marketplace-post-templates.md` — copy-paste posts for Marketplace/FB groups

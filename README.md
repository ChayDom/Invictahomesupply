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

## How inventory works

The Shop page and homepage "New This Week" section pull live from an
Airtable base — a free spreadsheet-style tool with drag-and-drop photo
uploads. Add a row, drag in a few photos, and it shows up on the site
automatically (visitors' browsers cache it for 15 minutes, so it's not
instant, but close). Until you connect Airtable, the site shows sample
placeholder items so it never looks broken or empty.

### Two category fields — why there are two

- **`Category`** is your own internal/reporting category and can be as
  granular as you want — `Flooring`, `Appliances`, `Water Heaters`,
  `Plumbing`, `Lawn & Outdoor`, `Tools`, `Lighting`, `Windows & Doors`,
  `Electronics`, `Gaming`, `Toys`, `Collectibles`, `Health & Personal Care`,
  etc. This never appears on the site — it's just for your own filtering
  and reporting inside Airtable.
- **`Web Category`** controls what customers actually see, and must be
  exactly one of the 7 website categories (see table below). **Leaving
  Web Category blank means the item is never published to the site** —
  that's the mechanism for keeping something off the site without deleting
  the row (e.g. electronics, toys, or anything you're not ready to list
  publicly yet).

### Set up your Airtable base (one-time, ~10 minutes)

1. Go to [airtable.com](https://airtable.com) and create a free account.
2. Create a new base. Name the table **Inventory** (must match exactly, or
   update `tableName` in `inventory.js`).
3. Add these fields, matching these exact names and types:

   | Field name | Type |
   |---|---|
   | Name | Single line text |
   | Category | Single select — your own internal reporting categories (see above), as broad or granular as you like |
   | Web Category | Single select — **exactly one of:** `Flooring`, `Water Heaters`, `Appliances`, `Plumbing & Bath`, `Lawn & Outdoor`, `Tools`, `Home Improvement`. Leave blank to keep the item off the site. |
   | Sell Unit | Single select — `each`, `box`, or `sq ft`. Controls the price format shown (e.g. flooring is priced `sq ft`; a water heater or appliance is `each`). |
   | Specs | Single line text — up to three short specs separated by `\|`, e.g. `22 MIL\|Waterproof\|Click-lock` or `40 gal\|Natural gas\|Rheem`. Shown as chips on the product card. |
   | Price | Number |
   | Was Price | Number (optional — the retail/comparison price shown as "Retail $X" for `each`/`box` items; leave blank if you don't have one) |
   | Quantity Available | Number (optional — units/boxes in stock; shown as "N available" for `each`/`box` items) |
   | Brand | Single line text (optional) |
   | Model | Single line text (optional) |
   | Details | Long text (shown in the card's collapsed "More details" section, not up front) |
   | Highlights | Long text, one line per bullet (also shown in "More details") |
   | Web Status | Single select — `In Stock`, `Reserved`, `Sold`, `Coming Soon`. **Only `In Stock` items are ever exported to the site** — Reserved/Sold/Coming Soon rows are simply excluded from the public feed. |
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

### Migrating an existing base

If your Airtable base predates this update, existing rows won't have Web
Category or Web Status set yet — **those items will disappear from the site
the moment you deploy this version**, until you go back and fill in Web
Category (one of the 7 site categories) and set Web Status to `In Stock` on
each row you want published. This is intentional (blank Web Category = not
published), but budget time to update your existing rows before/right after
deploying.

### Connect it to the site

1. In Airtable, open your profile icon → **Builder/Developer hub** →
   **Personal access tokens** → create a new token.
2. Give it the `data.records:read` scope only (read-only — the site never
   writes back to Airtable).
3. Under "Access", add the base you just created.
4. Copy the token (you'll only see it once).
5. You also need your Base ID — find it in the API docs for your base
   (Help → API documentation, or the URL when your base is open, starts
   with `app...`).
6. Open **inventory.js** and fill in the config block at the top:

   ```js
   window.AIRTABLE_CONFIG = {
     baseId: "appXXXXXXXXXXXXXX",       // your Base ID
     tableName: "Inventory",
     token: "patXXXXXXXXXXXXXX",         // your personal access token
     cacheMinutes: 15,
   };
   ```

7. Redeploy (re-drag the folder into Netlify, or push to Git if you set up
   continuous deploys). The site will now show your real inventory.

**Note:** because this token has to live in the site's code so the browser
can call Airtable directly, it's technically visible to anyone who views
page source. It's scoped read-only to this one base, so the worst case is
someone burning through your monthly API reads — not a security risk to
your account. If that ever becomes a problem, the fix is moving the fetch
behind a small serverless function instead of calling Airtable directly;
ask if you want that set up later.

### Marking items sold, reserved, or new

- Change **Web Status** to `Reserved`, `Sold`, or `Coming Soon` to pull an
  item off the public site immediately — no need to delete the row.
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

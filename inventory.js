/* ===================================================================
   Invicta Home Supply — inventory (Airtable-backed catalog)

   Source of truth for product data is Google Sheets (Product Catalog +
   Product Inventory) -> Website Export -> Airtable ("Website Products"
   table) -> this site. Airtable is a synced mirror, not the source of
   truth — never hand-edit a field there that Website Export doesn't
   carry, or the next sync can overwrite/ignore it.

   Real Airtable field names this file reads (confirmed against the
   production "Website Products" table — Title Case, single "Category"
   field, no separate "Website Category"):

     Product Key, Name, Category, Subcategory, Brand, Model, Retail SKU,
     Retailer, Price, Was Price, Unit Type (Box/Each/Sq Ft/Roll),
     Quantity Available, Status (In Stock/Reserved/Sold Out text), Box
     Price, Sq Ft Per Unit, Available Sq Ft, Thickness MM, Wear Layer MIL,
     Underlayment Attached (Yes/No), Water Resistance, Details, Highlights,
     Product URL, Photos (attachment, may be empty/absent), Reference
     Image URL (single-URL fallback), Post to Website (server-side gate
     only), Date Added. There is no separate "In Stock" boolean field —
     confirmed against the live schema — so it isn't read here.

   Category resolution still needs a fallback because every row won't
   have a clean one of the 7 site categories in `Category` on day one:
   resolveWebCategory() checks for an exact match first, then an explicit
   keyword allowlist, then (only for a genuinely blank Category) infers
   Flooring from flooring-shaped attributes. Anything else is not
   published — see LEGACY_CATEGORY_RULES/hasFlooringAttributes.

   Availability prefers the `Status` text (which can carry a specific
   "Reserved"/"Sold Out" label the badge/pill will show verbatim), then
   `Quantity Available > 0` — see resolveStatusLabel()/isAvailable().
   Not-in-stock items are never hidden here, only shown with a disabled
   pill instead of the Text button; per the discussed Apps Script export
   rule (Post to Website = Yes AND Quantity Available > 0) most such rows
   won't reach this site at all, but the fallback costs nothing.

   Flooring is the one category with real structured comparison fields
   (Thickness MM, Wear Layer MIL, Underlayment Attached, Water
   Resistance) — these are authoritative when present and are never
   parsed out of a title/Highlights. Flooring cards use these first (in
   priority order: Wear Layer, Thickness, Underlayment, Water
   Resistance), only falling back to Highlights lines to fill any
   remaining chip slots. Every other category still uses Highlights as
   its primary chip source until it gets structured fields of its own.
   Flooring renders in the same responsive card grid as every other
   category — no separate table layout.

   Inventory data is fetched from the /api/inventory serverless function,
   which holds the Airtable credentials server-side (Netlify environment
   variables) — nothing sensitive lives in this file or in git.

   There is no sample/demo/fake fallback inventory. If the fetch fails and
   there's no usable cache from a prior successful fetch, the site shows a
   real "couldn't load" message — never invented products a customer could
   mistake for real availability. See fetchInventory()/CATALOG_MESSAGES.
   =================================================================== */
window.AIRTABLE_CONFIG = {
  cacheMinutes: 15,
};

// Bumped to v6: cached items now also carry photoCards/photoThumbs —
// a stale v5 cache wouldn't have those fields and would render broken
// <img> tags until it expired on its own.
const CACHE_KEY = "invicta_inventory_cache_v6";
const INVENTORY_ENDPOINT = "/api/inventory";

// The 7 public-facing website categories. An item is only resolved to one
// of these when Category is already an exact match, or matches one of the
// explicit rules below — see resolveWebCategory().
const WEB_CATEGORIES = [
  "Flooring",
  "Water Heaters",
  "Appliances",
  "Plumbing & Bath",
  "Lawn & Outdoor",
  "Tools",
  "Home Improvement",
];

// Explicit allowlist only — this is NOT a catch-all. During migration,
// Category can hold either a clean 7-category value (matched above) or an
// older/broader label; only labels matching one of these rules resolve to
// a web category. Anything else (Electronics, Gaming, Toys, Collectibles,
// Health & Personal Care, or any other unrecognized non-blank value) is
// deliberately left unresolved and the item is not published, even if
// Post to Website is TRUE upstream — those product lines are out of scope
// for this home-improvement storefront and must not be guessed into a
// tab. A genuinely blank Category is handled separately in
// resolveWebCategory (see hasFlooringAttributes) rather than here.
const LEGACY_CATEGORY_RULES = [
  { test: /^flooring$/i, category: "Flooring" },
  { test: /^appliances$/i, category: "Appliances" },
  { test: /^tools$/i, category: "Tools" },
  { test: /^water heaters?$/i, category: "Water Heaters" },
  { test: /plumbing|sinks?/i, category: "Plumbing & Bath" },
  { test: /lawn|outdoor/i, category: "Lawn & Outdoor" },
  { test: /lighting|windows\s*&?\s*doors|blinds|shutters/i, category: "Home Improvement" },
];

// A row is treated as flooring-shaped if it's explicitly priced by the
// sq ft, or any flooring-specific field (including the new structured
// ones) is present and positive — used only for the blank-Category
// fallback below, never to reclassify a row that already has an explicit
// (even if unrecognized) Category.
function hasFlooringAttributes(f) {
  const isPositiveNumber = v => typeof v === "number" && !isNaN(v) && v > 0;
  if ((f["Unit Type"] || "").trim().toLowerCase() === "sq ft") return true;
  return isPositiveNumber(f["Sq Ft Per Unit"]) || isPositiveNumber(f["Box Price"]) || isPositiveNumber(f["Available Sq Ft"])
    || isPositiveNumber(f["Thickness MM"]) || isPositiveNumber(f["Wear Layer MIL"]);
}

// Returns a valid web category, or null if the item should not be
// published (see LEGACY_CATEGORY_RULES comment above — null is a
// deliberate "do not show" signal, not a bug).
function resolveWebCategory(f) {
  const category = (f["Category"] || "").trim();
  if (WEB_CATEGORIES.includes(category)) return category;
  if (!category) {
    // Blank Category on a row that's already live (Post to Website = TRUE
    // is the only way it reaches here at all): this site was flooring-only
    // before this migration, so a blank-Category row with flooring
    // attributes is almost certainly an existing flooring listing whose
    // Category just never got filled in — infer Flooring rather than
    // silently unpublishing something that's live today. Never extend
    // this inference to non-flooring rows: a blank-Category row with no
    // flooring attributes stays excluded, same as any other unrecognized
    // Category, until it gets a real one from Product Catalog.
    return hasFlooringAttributes(f) ? "Flooring" : null;
  }
  const rule = LEGACY_CATEGORY_RULES.find(r => r.test.test(category));
  return rule ? rule.category : null;
}

// Unit Type's real values are Box/Each/Sq Ft/Roll (case as typed in the
// sheet is unknown, so this compares case-insensitively). Blank/
// unrecognized falls back to the pre-existing convention: sq ft for
// Flooring, each otherwise.
function resolveSellUnit(f, webCategory) {
  const v = (f["Unit Type"] || "").trim().toLowerCase();
  if (v === "box") return "box";
  if (v === "roll") return "roll";
  if (v === "sq ft" || v === "sqft") return "sq ft";
  if (v === "each") return "each";
  return webCategory === "Flooring" ? "sq ft" : "each";
}

// Availability/status label, most-specific source first: the `Status`
// text (which can carry "Reserved"/"Sold Out" — shown verbatim on the
// badge/pill instead of a generic label when available), then
// Quantity Available > 0. Nothing present defaults to "In Stock" rather
// than hiding the item. (There is no separate "In Stock" boolean field
// in Airtable — confirmed against the live schema — so this doesn't
// check for one.)
function resolveStatusLabel(f) {
  const legacyStatus = (f["Status"] || "").trim();
  if (legacyStatus) return legacyStatus;
  if (typeof f["Quantity Available"] === "number") return f["Quantity Available"] > 0 ? "In Stock" : "Out of Stock";
  return "In Stock";
}

function isAvailable(item) {
  return item.statusLabel === "In Stock";
}

// Maps one raw Airtable record into the shape the rest of this file uses,
// or returns null if the item should not be published (see
// resolveWebCategory) — category is the one field that can legitimately
// mean "don't show this." Everything else has a graceful fallback.
// Canonicalizes Water Resistance to the same 4-value set the Airtable
// sync enforces (see appscripts/WebsiteExport_Airtable_Sync_v2.js
// IWA_WATER_RESISTANCE_VALUES) — exact-match only there, so a source
// sheet cell with different wording/casing ("100% Waterproof", "fully
// waterproof", stray spacing) fails that validation and reaches this
// site as a blank field, even though the product genuinely is
// waterproof. Every consumer of item.waterResistance — the filter
// dropdown/pill, the spec-chip badge, and the spec table row — reads
// this one normalized value, so fixing it here fixes all three at once
// rather than only the one a page-specific patch happened to touch.
// Falling back to the product name only recovers the unambiguous case
// (name clearly says "waterproof"); it never guesses the narrower
// "Water Resistant" claim from a name, since that's not implied by
// ordinary marketing copy the way "waterproof" is.
function normalizeWaterResistance(raw, name) {
  const text = (raw || "").trim();
  if (/waterproof/i.test(text)) return "Waterproof";
  if (/water[\s-]*resistant/i.test(text) && !/not/i.test(text)) return "Water Resistant";
  if (/not[\s-]*water[\s-]*resistant/i.test(text)) return "Not Water Resistant";
  if (text && text !== "Unknown") return text;
  if (/waterproof/i.test(name || "")) return "Waterproof";
  return text;
}

// Case-only brand duplicates (e.g. "LifeProof" vs "Lifeproof" from
// inconsistent manual data entry) would otherwise show as two separate
// buckets in the Brand dropdown/pill filter for what's really one brand.
// This canonicalizes display casing only — Product Key/id (the real
// identity used for URLs, SMS text, and joins) is completely untouched,
// so merging brand casing here can't affect any of that.
const BRAND_CASE_CANONICAL = {
  "lifeproof": "LifeProof",
};
function normalizeBrand(raw) {
  const text = (raw || "").trim();
  if (!text) return text;
  return BRAND_CASE_CANONICAL[text.toLowerCase()] || text;
}

// Airtable image attachments come back with a `thumbnails` object
// (`small`/`large`/`full`, each `{url,width,height}`) alongside the
// attachment's own full-resolution `url` — this is standard Airtable API
// shape, not something this site's Netlify function adds; the function
// passes each Photos record through untouched (see netlify/functions/
// inventory.mts), so `thumbnails` is already present on `p` whenever
// Airtable provides it. `large` (~512px) is a good fit for a product
// card's photo; `small` (~36px) is the right size for the little
// clickable thumbnail-row icons. Both fall back to the attachment's own
// full `url` if `thumbnails` is ever missing (e.g. a non-image
// attachment, or an older/odd API response) — never a broken image.
function airtablePhotoVariants(photoField) {
  return (photoField || [])
    .filter(p => p && p.url)
    .map(p => ({
      full: p.url,
      card: (p.thumbnails && p.thumbnails.large && p.thumbnails.large.url) || p.url,
      thumb: (p.thumbnails && p.thumbnails.small && p.thumbnails.small.url) || p.url,
    }));
}

function mapAirtableRecord(id, f) {
  const webCategory = resolveWebCategory(f);
  if (!webCategory) return null;
  const dateAdded = f["Date Added"] ? new Date(f["Date Added"]) : null;
  // Photos (attachment, possibly multiple) wins when present; Reference
  // Image URL is the single-image fallback — used as-is for all three
  // variants below since a plain reference URL has no thumbnail sizes of
  // its own. `photos` stays the full-size-URL array exactly as before
  // (every existing consumer of item.photos is unaffected); photoCards/
  // photoThumbs are new, same-length/order parallel arrays a bit of the
  // rendering code below opts into for a better-sized image.
  const variants = airtablePhotoVariants(f["Photos"]);
  const referenceUrl = f["Reference Image URL"] || "";
  const photos = variants.length ? variants.map(v => v.full) : (referenceUrl ? [referenceUrl] : []);
  const photoCards = variants.length ? variants.map(v => v.card) : photos;
  const photoThumbs = variants.length ? variants.map(v => v.thumb) : photos;
  return {
    id,
    productKey: f["Product Key"] || "",
    name: f["Name"] || "Untitled item",
    webCategory,
    webSubcategory: f["Subcategory"] || "",
    sellUnit: resolveSellUnit(f, webCategory),
    brand: normalizeBrand(f["Brand"]),
    model: f["Model"] || "",
    retailSku: f["Retail SKU"] || "",
    retailer: f["Retailer"] || "",
    price: f["Price"],
    wasPrice: f["Was Price"],
    qtyAvailable: f["Quantity Available"],
    boxPrice: f["Box Price"],
    sqFtPerUnit: f["Sq Ft Per Unit"],
    availableSqFt: f["Available Sq Ft"],
    thicknessMm: f["Thickness MM"],
    wearLayerMil: f["Wear Layer MIL"],
    underlaymentAttached: (f["Underlayment Attached"] || "").trim(),
    waterResistance: normalizeWaterResistance(f["Water Resistance"], f["Name"]),
    details: f["Details"] || "",
    highlights: f["Highlights"] || "",
    productUrl: f["Product URL"] || "",
    statusLabel: resolveStatusLabel(f),
    photos,
    photoCards,
    photoThumbs,
    isNew: dateAdded ? (Date.now() - dateAdded.getTime()) / 86400000 <= 7 : false,
    // Raw timestamp (or null), kept separate from the 7-day `isNew` badge
    // flag — "New This Week" sorts by this so it can always find the 4
    // most recent items even when fewer than 4 are within the badge window.
    dateAddedTs: dateAdded ? dateAdded.getTime() : null,
  };
}

// User-facing copy for the three non-normal catalog states. Centralized
// so every render path (grid, contractor table/cards, New This Week)
// shows identical wording.
const CATALOG_MESSAGES = {
  loading: "Loading inventory…",
  emptyCategory: "Nothing in this category right now — text us for what's coming.",
  emptyFiltered: "No matching items right now — text us what you're looking for.",
  error: "We couldn't load inventory right now — text us and we'll check availability for you.",
};

// Richer empty state for a whole category with zero published items
// (e.g. landing on Water Heaters via its homepage tile while nothing is
// currently in stock) — names the category so it's clear the visitor
// landed where they meant to (the category tab itself is hidden when its
// count is 0, so nothing in the tab row shows it as selected), states
// that this is a stock gap rather than a category the business doesn't
// carry, and gives a working way forward instead of a dead end: a
// prefilled "text about upcoming stock" SMS link and a link back to the
// full catalog. Used only for a genuinely empty category (see
// renderShopCatalog); a search/filter that narrows a non-empty category
// to zero results keeps the plain CATALOG_MESSAGES.emptyFiltered text.
function emptyCategoryMarkup(category) {
  const phoneHref = window.SITE_CONFIG ? window.SITE_CONFIG.phoneHref : "";
  const smsBody = encodeURIComponent(`Hi, do you have any ${category} coming in stock soon?`);
  return `<div class="catalog-empty-category">
    <p class="catalog-empty-heading">No ${category} in stock right now</p>
    <p>We do carry ${category} — this is a temporary stock gap, not a category we've dropped. New inventory is added weekly.</p>
    <div class="catalog-empty-actions">
      <a href="sms:${phoneHref}?&body=${smsBody}" class="btn btn-dark btn-small">Text about upcoming stock</a>
      <a href="/shop" class="btn btn-outline btn-small">View all inventory</a>
    </div>
  </div>`;
}

// Fetches real inventory only — there is no sample/demo fallback. A fresh
// cache (< cacheMinutes old) short-circuits the network call. On a fetch
// failure, falls back to the last successfully-fetched cache if one
// exists (still real data, just possibly stale) rather than showing
// nothing; only when there's truly no real data available does this
// return an error for the UI to show honestly.
async function fetchInventory() {
  const cached = localStorage.getItem(CACHE_KEY);
  let parsedCache = null;
  if (cached) {
    try {
      parsedCache = JSON.parse(cached);
      if (Date.now() - parsedCache.ts < window.AIRTABLE_CONFIG.cacheMinutes * 60 * 1000) {
        return { items: parsedCache.data, error: null };
      }
    } catch (e) { /* ignore bad cache */ }
  }

  try {
    const res = await fetch(INVENTORY_ENDPOINT);
    if (!res.ok) throw new Error(`Inventory request failed: ${res.status}`);
    const json = await res.json();
    const records = json.records || [];
    // .filter(Boolean) drops records whose legacy Category doesn't match
    // any rule in LEGACY_CATEGORY_RULES (see resolveWebCategory) — those
    // are deliberately not published, not a mapping bug.
    const items = records.map(r => mapAirtableRecord(r.id, r.fields || {})).filter(Boolean);

    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: items, ts: Date.now() }));
    return { items, error: null };
  } catch (err) {
    console.warn("Invicta: inventory fetch failed —", err);
    if (parsedCache && Array.isArray(parsedCache.data)) {
      return { items: parsedCache.data, error: null, stale: true };
    }
    return { items: [], error: err.message || "Unable to load inventory" };
  }
}

// Escapes text for safe use inside an HTML attribute (e.g. alt="...") —
// item.name/brand come from Airtable, a trusted internal source, but a
// stray quote or angle bracket in a product name shouldn't be able to
// break out of the attribute and corrupt the surrounding markup. Every
// other interpolation in this file that already puts item text into a
// text node (not an attribute) doesn't need this — only new attribute
// contexts introduced for image alt text do.
function escapeAttr(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function money(n) {
  return typeof n === "number" ? `$${n.toLocaleString()}` : "";
}

// 2-decimal currency, used for per-sq-ft/per-box pricing.
function money2(n) {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "";
}

// Thousands-separated sq ft total; only shows decimals when the value actually has them.
function sqFtAvailable(n) {
  return typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";
}

// Single source of truth for a flooring row's box count — every card,
// the Contractor View table, and the mobile Contractor cards all call
// this one function (never re-derive it locally) so a fix here can't
// drift out of sync between views.
//
// Quantity Available is an authoritative integer entered/synced from the
// source data and is preferred whenever present. The sq-ft division
// fallback is for rows that don't have it, and needs the epsilon below:
// Available Sq Ft / Sq Ft Per Unit is exact math (e.g. 301.5 / 20.1 = 15)
// but not exact IEEE-754 floating point (301.5 / 20.1 === 14.999999999999998
// in JS) — Math.floor() on the raw division silently truncated a correct
// 15-box count down to 14 for any pair of figures that don't happen to
// divide evenly in binary. The epsilon nudges only true floating-point
// noise across the boundary; it's far too small to turn a genuinely
// partial box (say 14.6) into a false whole one.
function boxesAvailable(item) {
  if (typeof item.qtyAvailable === "number") return Math.round(item.qtyAvailable);
  if (typeof item.availableSqFt !== "number" || typeof item.sqFtPerUnit !== "number" || item.sqFtPerUnit <= 0) return null;
  return Math.floor(item.availableSqFt / item.sqFtPerUnit + 1e-9);
}

function highlightBullets(highlights) {
  if (!highlights) return [];
  return highlights.split(/\r?\n/)
    .map(s => s.trim().replace(/^[•●◦∙\-*]\s*/, ""))
    .filter(Boolean);
}

// Flooring's real structured comparison fields, in priority order (Wear
// Layer, Thickness, Underlayment, Water Resistance) — authoritative when
// present, never parsed from a title or Highlights. A field that's blank
// or not applicable (e.g. laminate with no wear-layer rating) is simply
// skipped, not shown as an empty/placeholder chip. "Unknown" Water
// Resistance is treated the same as blank — never shown as a chip.
function flooringStructuredChips(item) {
  const chips = [];
  if (typeof item.wearLayerMil === "number" && item.wearLayerMil > 0) chips.push(`${item.wearLayerMil} MIL`);
  if (typeof item.thicknessMm === "number" && item.thicknessMm > 0) chips.push(`${item.thicknessMm} mm`);
  if (item.underlaymentAttached === "Yes") chips.push("Pad Attached");
  else if (item.underlaymentAttached === "No") chips.push("No Attached Pad");
  if (item.waterResistance && item.waterResistance !== "Unknown") chips.push(item.waterResistance);
  return chips;
}

// Structured fields first, Highlights only to fill remaining slots up to
// maxChips (3, the card's chip-row convention everywhere on the site) —
// the structured-first priority is Flooring-specific because it's the
// only category with real structured fields so far; every other category
// still uses Highlights as its primary chip source. Returns both the
// chips to show and the Highlights lines NOT used as chips, so "More
// details" never repeats a line already shown as a chip.
function chipsAndRemainingHighlights(item, maxChips = 3) {
  const structured = item.webCategory === "Flooring" ? flooringStructuredChips(item) : [];
  const allHighlights = highlightBullets(item.highlights);
  if (structured.length >= maxChips) return { chips: structured.slice(0, maxChips), remainingHighlights: allHighlights };
  const need = maxChips - structured.length;
  return { chips: structured.concat(allHighlights.slice(0, need)), remainingHighlights: allHighlights.slice(need) };
}

// Boxes-available-aware low-stock messaging for Flooring's compact card.
function flooringAvailabilityLabel(item) {
  const boxes = boxesAvailable(item);
  if (boxes === null) {
    return typeof item.availableSqFt === "number" ? `${sqFtAvailable(item.availableSqFt)} sq ft` : null;
  }
  if (boxes === 1) return "Last box";
  if (boxes === 2) return "Only 2 boxes left";
  const sqftPart = typeof item.availableSqFt === "number" ? `${sqFtAvailable(item.availableSqFt)} sq ft` : null;
  return sqftPart ? `${sqftPart} (${boxes} boxes)` : `${boxes} boxes`;
}

// Shareable detail-page link for a card's photo/name — /product.html?id=
// the Product Key (URL-encoded), falling back to the Airtable record id
// only for the rare item with no Product Key, same fallback chain used
// everywhere else an identifier is needed.
// On the shop page, carries the current filter/search/sort state (its
// own full query string — category, search text, brand/type, sort,
// flooring facets) forward as ?from= so product.html's "Back to
// inventory" can return to exactly what the visitor was looking at
// instead of resetting to a bare category. Card/Contractor View mode
// isn't part of this — it already persists via sessionStorage
// (saveFlooringViewMode), so it survives the round trip on its own.
// Only shop.html has this state to carry, so the homepage/product-detail
// cards linking here just get the plain id link.
function productDetailHref(item) {
  const base = `product.html?id=${encodeURIComponent(item.productKey || item.id)}`;
  if (document.getElementById("catalog-grid")) {
    return `${base}&from=${encodeURIComponent(window.location.pathname + window.location.search)}`;
  }
  return base;
}

// Card image: photoCards (the "large" Airtable thumbnail when available,
// falling back to the full photo) is the right size for a ~250-380px
// card — never the tiny "small" thumbnail (too soft once stretched) or
// the full original (needlessly heavy for a card). The little thumb-row
// icons use the actual "small" thumbnail (photoThumbs); clicking one
// swaps the main <img>'s src to that same index's FULL-size photo
// (data-full), never the small variant, via bindThumbClicks().
function photoBlock(item) {
  const href = productDetailHref(item);
  if (!item.photos || item.photos.length === 0) {
    return `<a class="product-photo main-photo" href="${href}" aria-label="${escapeAttr(item.name)} — no photo available">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 3v18"/></svg>
    </a>`;
  }
  const alt = escapeAttr(item.name);
  const thumbs = item.photos.length > 1
    ? `<div class="thumb-row">${item.photos.map((p, i) =>
        `<img class="thumb${i === 0 ? " active" : ""}" src="${item.photoThumbs[i]}" data-full="${item.photos[i]}" alt="" loading="lazy" width="40" height="40">`).join("")}</div>`
    : "";
  return `<a class="product-photo main-photo" href="${href}">
    <img src="${item.photoCards[0]}" alt="${alt}" loading="lazy" width="600" height="600" data-main-photo>
  </a>${thumbs}`;
}

// Out-of-stock items are never hidden here — they're shown with a
// disabled status pill instead of the Text button (see actionButtons
// below), labeled with whatever specific status is known ("Reserved",
// "Sold Out", ...) or a generic "Out of Stock" if not. In practice most
// such rows likely won't reach this site at all once the Apps Script
// export rule (Post to Website = Yes AND Quantity Available > 0) is in
// place, but this costs nothing.
function statusBadge(item) {
  if (!isAvailable(item)) {
    const cls = /reserved/i.test(item.statusLabel) ? "badge-reserved" : "badge-sold";
    return `<span class="badge ${cls}">${item.statusLabel}</span>`;
  }
  return item.isNew ? `<span class="badge badge-new">New</span>` : "";
}

// Builds the prefilled "Text about this item" SMS body — always includes
// the product name and its Product Key (falling back to the Airtable
// record id only for the rare item with no Product Key) so a reply
// doesn't require looking anything up.
function smsMessageForItem(item) {
  const key = item.productKey || item.id;
  return `Hi, I'm interested in ${item.name} (${key}).`;
}

function smsHrefForItem(item) {
  const phoneHref = window.SITE_CONFIG ? window.SITE_CONFIG.phoneHref : "";
  return `sms:${phoneHref}?&body=${encodeURIComponent(smsMessageForItem(item))}`;
}

// One CTA per card for most categories — opens the visitor's SMS app with
// a prefilled message. Flooring cards get a second "Get a Quote" button
// (the sq-ft-needed quote modal) alongside the Text CTA, since a sq-ft
// quote makes sense there and nowhere else — the Contractor View table
// (see renderContractorTable) uses a single "Text to Hold" CTA instead,
// matching its denser, comparison-first design. Out-of-stock items keep
// the card visible but swap the CTA(s) for a disabled pill instead.
function actionButtons(item) {
  if (!isAvailable(item)) {
    return `<span class="btn btn-outline btn-small btn-block" style="opacity:.5; cursor:default;">${item.statusLabel}</span>`;
  }
  const smsHref = smsHrefForItem(item);
  if (item.webCategory !== "Flooring") {
    return `<a href="${smsHref}" class="btn btn-dark btn-small btn-block">Text About This Item</a>`;
  }
  return `<a href="${smsHref}" class="btn btn-dark btn-small">Text About This Item</a>
    <button type="button" class="btn btn-outline btn-small" data-quote-id="${item.id}">Get a Quote</button>`;
}

// Single source of truth for a flooring row's per-box price, shared by
// the card price block, the Contractor View table, and the Contractor
// View mobile cards — so a Box Price field and a computed fallback are
// never independently re-derived (and inconsistently labeled) per view.
// The real Box Price field is a stored selling price and is always
// preferred as-is, even when it doesn't exactly equal price-per-sqft x
// sqft-per-box (a $2.00/sq ft x 20.95 sq ft/box item stored at $42.00 is
// a legitimate rounded selling price, not a bug to "correct" to $41.90 —
// never overwrite a valid stored price just to force arithmetic
// agreement). Only when Box Price is genuinely absent does this compute
// an estimate, which callers must label as such (≈) so a stored price
// and a computed one are never visually indistinguishable.
function boxPriceInfo(item) {
  if (typeof item.boxPrice === "number") return { amount: item.boxPrice, computed: false };
  if (typeof item.price === "number" && typeof item.sqFtPerUnit === "number" && item.sqFtPerUnit > 0) {
    return { amount: item.price * item.sqFtPerUnit, computed: true };
  }
  return null;
}

// Price block format is driven by webCategory, not the Airtable "Unit
// Type" field: Flooring's Price is *always* dollars-per-sq-ft in this
// data model (see file header), regardless of what Unit Type says — a
// flooring row is routinely tagged Unit Type "Box" (that's how a
// contractor thinks of it) even though Price is per sq ft. Branching on
// sellUnit (derived from Unit Type) instead of webCategory here used to
// render that same $/sqft number with a "/ box" label for any such row —
// wrong by roughly an order of magnitude. A per-box price is still shown
// as a secondary line, using the real Box Price field when present or
// computing one (price/sqft x sqft/box) when it's not.
//   Flooring     -> "$2.01 / sq ft" then "$42.11 / box · 1,026 sq ft (49 boxes)" (or "Last box"/"Only 2 boxes left" when low)
//   each         -> "$649 each"     then "Retail $1,049 · 2 available"
//   box (non-flooring) -> "$42.11 / box"  then "Retail $89.00 · 12 boxes available"
//   roll         -> "$42.11 / roll" then "Retail $89.00 · 12 rolls available"
function priceBlock(item) {
  if (item.webCategory === "Flooring" && typeof item.price === "number") {
    const subParts = [];
    const boxInfo = boxPriceInfo(item);
    if (boxInfo) {
      subParts.push(boxInfo.computed
        ? `&asymp; ${money2(boxInfo.amount)} / box (${sqFtAvailable(item.sqFtPerUnit)} sq ft)`
        : `${money2(boxInfo.amount)} / box`);
    }
    const availLabel = flooringAvailabilityLabel(item);
    if (availLabel) subParts.push(availLabel);
    return `<div class="product-price product-price-flooring">
      <div class="price-line">${money2(item.price)} <span class="price-unit">/ sq ft</span></div>
      ${subParts.length ? `<div class="price-avail">${subParts.join(" &middot; ")}</div>` : ""}
    </div>`;
  }

  const perUnitLabels = { box: "/ box", roll: "/ roll" };
  const singularWords = { box: " box", roll: " roll" };
  const pluralWords = { box: " boxes", roll: " rolls" };
  const unitLabel = perUnitLabels[item.sellUnit] || "each";
  const isPerUnit = item.sellUnit === "box" || item.sellUnit === "roll";
  const priceText = isPerUnit && typeof item.price === "number" ? money2(item.price) : money(item.price);
  const availParts = [];
  if (typeof item.wasPrice === "number") availParts.push(`Retail ${money(item.wasPrice)}`);
  if (typeof item.qtyAvailable === "number") {
    const unitWord = item.qtyAvailable === 1 ? singularWords[item.sellUnit] : pluralWords[item.sellUnit];
    availParts.push(`${item.qtyAvailable}${unitWord || ""} available`);
  }
  return `<div class="product-price">
    <div class="price-line">${priceText} <span class="price-unit">${unitLabel}</span></div>
    ${availParts.length ? `<div class="price-avail">${availParts.join(" &middot; ")}</div>` : ""}
  </div>`;
}

// Compact card: square image -> category (+ subcategory, if set) -> name
// -> up to 3 chips (structured Flooring fields first, Highlights fill the
// rest) -> short price -> availability line -> one CTA. Long copy
// (Details, remaining Highlights, a product reference link) moves into a
// collapsed <details> section instead of living on the card — keeps the
// row/card itself from turning back into a wall of text.
function productCard(item) {
  const { chips, remainingHighlights } = chipsAndRemainingHighlights(item);
  const hasMore = Boolean(item.details) || remainingHighlights.length > 0 || Boolean(item.productUrl);
  const categoryLabel = item.webSubcategory ? `${item.webCategory} &middot; ${item.webSubcategory}` : item.webCategory;
  return `
  <div class="product-card" data-category="${item.webCategory}">
    <div class="photo-wrap">
      ${photoBlock(item)}
      ${statusBadge(item)}
    </div>
    <div class="product-info">
      <span class="product-cat">${categoryLabel}</span>
      <h4><a href="${productDetailHref(item)}">${item.name}</a></h4>
      ${chips.length ? `<div class="spec-chips">${chips.map(c => `<span class="spec-chip">${c}</span>`).join("")}</div>` : ""}
      ${priceBlock(item)}
      ${hasMore ? `<details class="product-more">
        <summary>More details</summary>
        ${item.details ? `<p class="product-desc">${item.details}</p>` : ""}
        ${remainingHighlights.length ? `<ul class="product-details">${remainingHighlights.map(b => `<li>${b}</li>`).join("")}</ul>` : ""}
        ${item.productUrl ? `<a href="${item.productUrl}" target="_blank" rel="noopener" class="product-ref-link">View manufacturer page</a>` : ""}
      </details>` : ""}
    </div>
    <div class="product-actions">
      ${actionButtons(item)}
    </div>
  </div>`;
}

function bindThumbClicks(container) {
  container.querySelectorAll(".product-card").forEach(card => {
    const main = card.querySelector("[data-main-photo]");
    card.querySelectorAll(".thumb").forEach(thumb => {
      thumb.addEventListener("click", () => {
        card.querySelectorAll(".thumb").forEach(t => t.classList.remove("active"));
        thumb.classList.add("active");
        if (main) main.src = thumb.getAttribute("data-full");
      });
    });
  });
}

// Set once by initInventory() from fetchInventory()'s result — a real
// fetch/parse failure with no usable cache, not "this category is just
// empty." Every empty-state render checks it so a genuine outage shows
// CATALOG_MESSAGES.error instead of the ordinary "nothing here" copy.
let lastFetchError = null;

function emptyStateMessage(emptyMessage) {
  return lastFetchError ? CATALOG_MESSAGES.error : emptyMessage;
}

function renderGrid(items, containerId, emptyMessage = CATALOG_MESSAGES.emptyFiltered) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.length
    ? items.map(productCard).join("")
    : `<div class="${lastFetchError ? "catalog-error" : "catalog-empty"}">${emptyStateMessage(emptyMessage)}</div>`;
  bindThumbClicks(el);
}

// ---------------------------------------------------------------------
// Flooring's Contractor View — an alternate to the card grid, toggled by
// the Card View/Contractor View buttons (see initShopControls). Same
// filtered/sorted item array as the grid; just a denser, comparison-first
// table layout instead of cards. See shop.html for the static markup.
// ---------------------------------------------------------------------

// Eyebrow (live SKU/sq ft counts) and heading — both computed from
// `items`, the currently-filtered/visible set, so they read as "here's
// what's live right now" rather than a static category-wide count. Its
// old eyebrow/heading text lived in the removed Contractor View hero
// block — the shared results-count in the toolbar (updateResultsCount())
// now covers "how much is in view" for both Card View and Contractor
// View instead of duplicating it here.

// Single CTA per row: "Text to Hold" (the same SMS CTA as everywhere else
// on the site, just relabeled for this denser layout), or the disabled
// status pill when out of stock — the table has no separate quote button
// since Get a Quote is already reachable from the Card View.
// Per Box column/line for the Contractor View table and mobile cards —
// same boxPriceInfo() the card price block uses, so a row with no stored
// Box Price shows the same "≈" estimate instead of a blank cell, and an
// estimate is never confused for a stored selling price.
function contractorBoxPriceText(item) {
  const boxInfo = boxPriceInfo(item);
  if (!boxInfo) return null;
  return boxInfo.computed ? `&asymp; ${money2(boxInfo.amount)}` : money2(boxInfo.amount);
}
function contractorBoxPriceCell(item) {
  return contractorBoxPriceText(item) || "&mdash;";
}

function contractorRowCta(item) {
  if (!isAvailable(item)) {
    return `<span class="btn btn-outline btn-small" style="opacity:.5; cursor:default;">${item.statusLabel}</span>`;
  }
  return `<a href="${smsHrefForItem(item)}" class="btn btn-dark btn-small">Text to Hold</a>`;
}

function renderContractorTable(items, emptyMessage = CATALOG_MESSAGES.emptyFiltered) {
  const tbody = document.getElementById("contractor-table-body");
  if (!tbody) return;
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="${lastFetchError ? "catalog-error" : "table-empty"}">${emptyStateMessage(emptyMessage)}</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => {
    const chips = flooringStructuredChips(item);
    // Small thumbnail — this is a 48px row icon, not the product's main
    // photo, so the "small" Airtable variant (falls back to full) is the
    // right size rather than loading a full-resolution image per row.
    const photo = item.photoThumbs && item.photoThumbs[0] ? item.photoThumbs[0] : "";
    const boxes = boxesAvailable(item);
    const availLabel = flooringAvailabilityLabel(item) || "&mdash;";
    const lowStock = typeof boxes === "number" && boxes <= 2;
    const photoImg = photo ? `<img src="${photo}" alt="" loading="lazy" width="48" height="48">` : "";
    return `<tr>
      <td class="contractor-product-cell">
        <a class="contractor-product-photo" href="${productDetailHref(item)}">${photoImg}</a>
        <div>
          <a class="contractor-product-name" href="${productDetailHref(item)}">${item.name}</a>
          ${item.brand || item.webSubcategory ? `<div class="contractor-product-sub">${[item.brand, item.webSubcategory].filter(Boolean).join(" &middot; ")}</div>` : ""}
        </div>
      </td>
      <td>${chips.length ? `<div class="spec-chips">${chips.map(c => `<span class="spec-chip">${c}</span>`).join("")}</div>` : "&mdash;"}</td>
      <td>${typeof item.price === "number" ? money2(item.price) : "&mdash;"}</td>
      <td>${contractorBoxPriceCell(item)}</td>
      <td class="${lowStock ? "low-stock-emph" : ""}">${availLabel}</td>
      <td class="contractor-actions-cell">${contractorRowCta(item)}</td>
    </tr>`;
  }).join("");
}

// Mobile equivalent of the desktop table — same row data, stacked cards
// instead of a horizontally-scrolling table (styles.css hides one and
// shows the other per breakpoint; both are always rendered so there's no
// flash of missing content when the viewport crosses it).
function renderContractorMobileCards(items, emptyMessage = CATALOG_MESSAGES.emptyFiltered) {
  const container = document.getElementById("contractor-cards");
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = `<div class="${lastFetchError ? "catalog-error" : "catalog-empty"}">${emptyStateMessage(emptyMessage)}</div>`;
    return;
  }
  container.innerHTML = items.map(item => {
    const chips = flooringStructuredChips(item);
    const photo = item.photoThumbs && item.photoThumbs[0] ? item.photoThumbs[0] : "";
    const boxes = boxesAvailable(item);
    const availLabel = flooringAvailabilityLabel(item) || "&mdash;";
    const lowStock = typeof boxes === "number" && boxes <= 2;
    const href = productDetailHref(item);
    const photoImg = photo ? `<img src="${photo}" alt="" loading="lazy" width="64" height="64">` : "";
    return `<div class="contractor-card">
      <a class="contractor-card-photo" href="${href}">${photoImg}</a>
      <div class="contractor-card-body">
        <a class="contractor-card-name" href="${href}">${item.name}</a>
        ${item.brand || item.webSubcategory ? `<div class="contractor-card-sub">${[item.brand, item.webSubcategory].filter(Boolean).join(" &middot; ")}</div>` : ""}
        ${chips.length ? `<div class="contractor-card-specs spec-chips">${chips.map(c => `<span class="spec-chip">${c}</span>`).join("")}</div>` : ""}
        <div class="contractor-card-prices">
          ${typeof item.price === "number" ? `<span><strong>${money2(item.price)}</strong> / sq ft</span>` : ""}
          ${contractorBoxPriceText(item) ? `<span><strong>${contractorBoxPriceText(item)}</strong> / box</span>` : ""}
        </div>
        <div class="contractor-card-avail${lowStock ? " low-stock-emph" : ""}">${availLabel}</div>
        <div class="contractor-card-cta">${contractorRowCta(item)}</div>
      </div>
    </div>`;
  }).join("");
}

// Quick, product-independent sq-ft estimate — shared by Card View and
// Contractor View alike, shown whenever Flooring is the active category
// (visibility set in updateViewToggle()). Mirrors the real
// Flooring Calculator modal's own default 10% waste rate but is
// otherwise independent of it (no shared state, doesn't touch
// calcWasteRate). "Multiple rooms?" opens the real modal for anything
// more than this single quick number. Lives in the sidebar (desktop) /
// filter drawer (mobile) as a compact bordered card — the drawer itself
// is what's collapsed behind the "Filters" button on mobile now, so this
// card no longer needs its own collapse/expand state.
const FLOORING_CALC_WASTE_RATE = 0.10;
function bindFlooringCalcCard() {
  const input = document.getElementById("flooring-calc-sqft");
  const btn = document.getElementById("flooring-calc-btn");
  const result = document.getElementById("flooring-calc-result");
  const fullLink = document.getElementById("flooring-calc-full-link");

  const runEstimate = () => {
    if (!input || !result) return;
    const sqft = parseFloat(input.value);
    if (!isFinite(sqft) || sqft <= 0) {
      result.hidden = true;
      return;
    }
    result.textContent = `Recommended: ${calcRound2(sqft * (1 + FLOORING_CALC_WASTE_RATE))} sq ft`;
    result.hidden = false;
  };

  btn?.addEventListener("click", runEstimate);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runEstimate(); } });
  // On mobile this link lives inside the filter drawer itself — close it
  // first so the calculator modal isn't left rendering behind the still-
  // open drawer (a stacking-order bug the .modal-overlay z-index comment
  // in styles.css also guards against, belt-and-suspenders). No-op on
  // desktop, where the sidebar isn't a drawer to begin with.
  fullLink?.addEventListener("click", () => { closeShopSidebarDrawer(); openCalculatorModal(false); });
}

// Wires everything around the sidebar that isn't a single facet <select>
// itself (those are bound individually in initShopControls): the removable
// filter chips, both "Clear all" buttons (desktop sidebar + mobile drawer
// footer), and the mobile drawer's open/close (Filters button, close X,
// backdrop click, and "Show results" — filtering itself already happens
// live as each select changes, so "Show results" is just a close). The
// same #shop-sidebar markup serves as a static sidebar on desktop and a
// slide-in drawer on mobile purely via CSS (see .shop-sidebar.open in
// styles.css) — one DOM tree, no content duplicated between the two.
// Shared with bindFlooringCalcCard()'s "Calculate multiple rooms" link,
// which lives inside this same drawer on mobile and needs to close it
// before opening the calculator modal on top of it. Safe to call even
// when the drawer doesn't exist (desktop pages) or is already closed.
function closeShopSidebarDrawer() {
  document.getElementById("shop-sidebar")?.classList.remove("open");
  const backdrop = document.getElementById("shop-sidebar-backdrop");
  if (backdrop) backdrop.hidden = true;
  document.body.classList.remove("modal-open");
}

function bindSidebarFilterExtras() {
  document.getElementById("active-filter-chips")?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-chip-key]");
    if (!chip) return;
    const clear = CLEAR_FILTER_SETTERS[chip.getAttribute("data-chip-key")];
    if (clear) { clear(); syncShopUrl(true); renderShopCatalog(); }
  });

  document.getElementById("clear-all-filters-btn")?.addEventListener("click", clearAllFilters);
  document.getElementById("sidebar-clear-btn-mobile")?.addEventListener("click", clearAllFilters);

  const sidebar = document.getElementById("shop-sidebar");
  const backdrop = document.getElementById("shop-sidebar-backdrop");
  const openDrawer = () => {
    sidebar?.classList.add("open");
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add("modal-open");
  };
  document.getElementById("mobile-filters-btn")?.addEventListener("click", openDrawer);
  document.getElementById("sidebar-close-btn")?.addEventListener("click", closeShopSidebarDrawer);
  document.getElementById("sidebar-apply-btn-mobile")?.addEventListener("click", closeShopSidebarDrawer);
  backdrop?.addEventListener("click", closeShopSidebarDrawer);
}

// ---------------------------------------------------------------------
// Homepage "New This Week": the 4 most recently added published +
// in-stock items across every category, by the real Date Added field
// (dateAddedTs — never the internal Buy Date, which isn't read anywhere
// in this file). Categories mix naturally as a side effect of true
// recency order — no engineered per-category quota.
// ---------------------------------------------------------------------
function pickNewArrivals(items, targetCount) {
  // The homepage promo strip only ever shows available items — Reserved/
  // Sold/Coming Soon items still render in the Shop grid (with a status
  // pill), just not here.
  return items
    .filter(isAvailable)
    .slice()
    .sort((a, b) => {
      const at = typeof a.dateAddedTs === "number" ? a.dateAddedTs : -Infinity;
      const bt = typeof b.dateAddedTs === "number" ? b.dateAddedTs : -Infinity;
      return bt - at;
    })
    .slice(0, targetCount);
}

// ---------------------------------------------------------------------
// Shop page: category tabs + brand/subcategory filters + sort + search,
// over the array already fetched by fetchInventory() — no extra Airtable
// calls. Every category renders as the standard card grid; Flooring alone
// also offers a Contractor View (a table) as a user-toggled alternate —
// see renderShopCatalog()/updateViewToggle().
// ---------------------------------------------------------------------
let shopItems = [];
let itemsById = {};
let currentCategory = "all";
let currentSort = "featured";
let currentSearch = "";
let currentBrand = "";
let currentSubcategory = "";
// Flooring-only structured filters (per the "logical filter groups"
// design — Type/Subcategory and Brand above are shared with every
// category; these five only ever apply, and only ever show, on Flooring).
// Both the Card View dropdowns and the Contractor View pill buttons read
// and write these same variables — there's one filter state, not two.
let currentThickness = "";
let currentWearLayer = "";
let currentUnderlayment = "";
let currentWaterResistance = "";
let currentAvailability = "";
// Flooring-only view toggle: "card" (default, same grid as every other
// category) or "contractor" (the table below). Irrelevant for every other
// category, which only ever renders the card grid. Remembered for the
// session (sessionStorage — resets in a fresh tab, unlike localStorage)
// so switching categories and back doesn't lose the visitor's choice.
const FLOORING_VIEW_STORAGE_KEY = "invicta_flooring_view";
function loadFlooringViewMode() {
  try {
    const saved = sessionStorage.getItem(FLOORING_VIEW_STORAGE_KEY);
    return saved === "contractor" ? "contractor" : "card";
  } catch (e) {
    return "card";
  }
}
function saveFlooringViewMode(mode) {
  try { sessionStorage.setItem(FLOORING_VIEW_STORAGE_KEY, mode); } catch (e) { /* ignore */ }
}
let flooringViewMode = loadFlooringViewMode();

const SQFT_SORT_OPTIONS = [
  { value: "sqft-desc", label: "Sq Ft Available: High to Low" },
  { value: "sqft-asc", label: "Sq Ft Available: Low to High" },
];

// Sorts by Price or Available Sq Ft. Items with a missing/non-numeric value
// for the chosen field always sink to the bottom, regardless of direction,
// and keep their relative order (stable) among themselves and on ties.
function sortItems(items, sortKey) {
  if (sortKey === "featured") return items.slice();

  const field = sortKey.startsWith("price") ? "price" : "availableSqFt";
  const desc = sortKey.endsWith("desc");

  return items
    .map((item, idx) => ({ item, idx, val: item[field] }))
    .sort((a, b) => {
      const aValid = typeof a.val === "number" && !isNaN(a.val);
      const bValid = typeof b.val === "number" && !isNaN(b.val);
      if (aValid !== bValid) return aValid ? -1 : 1;
      if (!aValid) return a.idx - b.idx;
      return desc ? b.val - a.val : a.val - b.val;
    })
    .map(entry => entry.item);
}

function isFlooringView() {
  return currentCategory === "Flooring";
}

// Sq Ft Available sort options only make sense for Flooring — add/remove
// them from the <select> based on the active category filter, and fall
// back to Featured if an sqft sort was active when the category changed.
function updateSortOptionsVisibility() {
  const select = document.getElementById("sort-select");
  if (!select) return;
  const showSqft = isFlooringView();
  const hasSqftOptions = !!select.querySelector('option[value="sqft-desc"]');

  if (showSqft && !hasSqftOptions) {
    SQFT_SORT_OPTIONS.forEach(opt => {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.label;
      select.appendChild(el);
    });
  } else if (!showSqft && hasSqftOptions) {
    if (currentSort === "sqft-desc" || currentSort === "sqft-asc") {
      currentSort = "featured";
      select.value = "featured";
    }
    SQFT_SORT_OPTIONS.forEach(opt => {
      select.querySelector(`option[value="${opt.value}"]`)?.remove();
    });
  }
}


// Shared option-derivation for every Flooring/category facet — the one
// sidebar filter UI drives both Card View and Contractor View, so "what
// counts as a valid option" only needs to be defined once. Type
// (Subcategory) and Brand are computed from categoryItems (every item in
// the category — independent facets); the Flooring-only structured
// facets come from narrowedItems (already filtered by Type/Brand) since
// e.g. "does Wear Layer apply" genuinely depends on which Subcategory is
// selected — Laminate has no wear-layer rating even though other
// Flooring items do.
function facetBrandOptions(categoryItems) {
  return [...new Set(categoryItems.map(i => i.brand).filter(Boolean))].sort();
}
function facetSubcategoryOptions(categoryItems) {
  return [...new Set(categoryItems.map(i => i.webSubcategory).filter(Boolean))].sort();
}
function facetThicknessOptions(narrowedItems) {
  return [...new Set(narrowedItems.map(i => i.thicknessMm).filter(v => typeof v === "number" && v > 0))].sort((a, b) => a - b);
}
function facetWearLayerOptions(narrowedItems) {
  return [...new Set(narrowedItems.map(i => i.wearLayerMil).filter(v => typeof v === "number" && v > 0))].sort((a, b) => a - b);
}
function facetUnderlaymentOptions(narrowedItems) {
  const values = new Set(narrowedItems.map(i => i.underlaymentAttached).filter(Boolean));
  const options = [];
  if (values.has("Yes")) options.push({ value: "Yes", label: "Pad Attached" });
  if (values.has("No")) options.push({ value: "No", label: "No Attached Pad" });
  return options;
}
// "Unknown" is never a shopper-facing filter option.
function facetWaterResistanceOptions(narrowedItems) {
  const known = ["Waterproof", "Water Resistant", "Not Water Resistant"];
  return known.filter(v => narrowedItems.some(i => i.waterResistance === v));
}

// Rebuilds every filter <select>'s options (Card View) so a dropdown
// never offers an option with zero matching items, resetting the current
// selection back to "Any/All" if it's no longer a valid option.
function updateFacetFilterOptions(categoryItems, narrowedItems) {
  const brandSelect = document.getElementById("brand-filter");
  const subcategorySelect = document.getElementById("subcategory-filter");

  if (brandSelect) {
    const brands = facetBrandOptions(categoryItems);
    if (!brands.includes(currentBrand)) currentBrand = "";
    brandSelect.innerHTML = `<option value="">All Brands</option>` + brands.map(b => `<option value="${b}">${b}</option>`).join("");
    brandSelect.value = currentBrand;
  }
  if (subcategorySelect) {
    const subcategories = facetSubcategoryOptions(categoryItems);
    if (!subcategories.includes(currentSubcategory)) currentSubcategory = "";
    subcategorySelect.innerHTML = `<option value="">All Types</option>` + subcategories.map(s => `<option value="${s}">${s}</option>`).join("");
    subcategorySelect.value = currentSubcategory;
  }

  if (!isFlooringView()) return;

  const thicknessGroup = document.getElementById("thickness-filter-group");
  const thicknessSelect = document.getElementById("thickness-filter");
  const wearRow = document.getElementById("wear-layer-filter-item");
  const wearSelect = document.getElementById("wear-layer-filter");
  const underlaymentGroup = document.getElementById("underlayment-filter-group");
  const underlaymentSelect = document.getElementById("underlayment-filter");
  const waterResistanceGroup = document.getElementById("water-resistance-filter-group");
  const waterResistanceSelect = document.getElementById("water-resistance-filter");
  const availabilityGroup = document.getElementById("availability-filter-group");

  // Each Flooring-only sidebar group hides itself when it would have zero
  // options — showing one that can only ever narrow to "none of these"
  // (e.g. Wear Layer while viewing Laminate) is worse than not showing it.
  // Availability's options are static thresholds, never data-driven, so
  // it's always shown once Flooring is active (this is the only place
  // that reveals it — updateViewToggle() only ever hides it).
  if (thicknessGroup && thicknessSelect) {
    const thicknesses = facetThicknessOptions(narrowedItems);
    thicknessGroup.hidden = thicknesses.length === 0;
    if (!thicknesses.includes(Number(currentThickness))) currentThickness = "";
    thicknessSelect.innerHTML = `<option value="">Any Thickness</option>` + thicknesses.map(t => `<option value="${t}">${t} mm</option>`).join("");
    thicknessSelect.value = currentThickness;
  }
  if (wearSelect) {
    const wears = facetWearLayerOptions(narrowedItems);
    if (wearRow) wearRow.hidden = wears.length === 0;
    if (!wears.includes(Number(currentWearLayer))) currentWearLayer = "";
    wearSelect.innerHTML = `<option value="">Any Wear Layer</option>` + wears.map(w => `<option value="${w}">${w} MIL</option>`).join("");
    wearSelect.value = currentWearLayer;
  }
  if (underlaymentGroup && underlaymentSelect) {
    const options = facetUnderlaymentOptions(narrowedItems);
    underlaymentGroup.hidden = options.length === 0;
    if (!options.some(o => o.value === currentUnderlayment)) currentUnderlayment = "";
    underlaymentSelect.innerHTML = `<option value="">Any Underlayment</option>` + options.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
    underlaymentSelect.value = currentUnderlayment;
  }
  if (waterResistanceGroup && waterResistanceSelect) {
    const values = facetWaterResistanceOptions(narrowedItems);
    waterResistanceGroup.hidden = values.length === 0;
    if (!values.includes(currentWaterResistance)) currentWaterResistance = "";
    waterResistanceSelect.innerHTML = `<option value="">Any Water Resistance</option>` + values.map(v => `<option value="${v}">${v}</option>`).join("");
    waterResistanceSelect.value = currentWaterResistance;
  }
  if (availabilityGroup) availabilityGroup.hidden = false;
}

// Live "N items" (or "N item") count in the results toolbar — the one
// place both Card View and Contractor View report how much is currently
// in view, replacing the old Contractor-only hero eyebrow.
function updateResultsCount(count) {
  const el = document.getElementById("results-count");
  if (!el) return;
  el.textContent = `${count} item${count === 1 ? "" : "s"}`;
}

function underlaymentChipLabel(value) {
  return value === "Yes" ? "Pad Attached" : value === "No" ? "No Attached Pad" : value;
}
function availabilityChipLabel(value) {
  return value === "500" ? "500+ sq ft" : value === "1000" ? "1,000+ sq ft" : `${value}+ sq ft`;
}

// Removable chips for every currently-active filter (search text plus
// every sidebar facet) — the sidebar's own selects already show what's
// selected, but at a glance across a whole results page a chip row is
// what actually answers "what am I filtered by right now," and gives a
// one-click way to drop just one without opening the sidebar/drawer.
// Rebuilt on every render from the same currentX state the filtering
// itself reads, so it can never drift out of sync with what's actually
// applied.
function updateActiveFilterChips() {
  const container = document.getElementById("active-filter-chips");
  if (!container) return;

  const chips = [];
  const add = (key, label) => chips.push({ key, label });
  if (currentSearch) add("search", `"${currentSearch}"`);
  if (currentSubcategory) add("subcategory", currentSubcategory);
  if (currentBrand) add("brand", currentBrand);
  if (isFlooringView()) {
    if (currentThickness) add("thickness", `${currentThickness} mm`);
    if (currentWearLayer) add("wearLayer", `${currentWearLayer} MIL`);
    if (currentUnderlayment) add("underlayment", underlaymentChipLabel(currentUnderlayment));
    if (currentWaterResistance) add("waterResistance", currentWaterResistance);
    if (currentAvailability) add("availability", availabilityChipLabel(currentAvailability));
  }

  container.hidden = chips.length === 0;
  container.innerHTML = chips.map(c =>
    `<button type="button" class="filter-chip" data-chip-key="${c.key}">${c.label} <span aria-hidden="true">&times;</span></button>`
  ).join("");
}

// One handler per chip key, so both the chip row and (via CLEAR_FILTER_
// SETTERS below) "Clear all" share the exact same reset logic per filter
// — never two places deciding what "cleared" means for a given facet.
const CLEAR_FILTER_SETTERS = {
  search: () => { currentSearch = ""; const el = document.getElementById("search-input"); if (el) el.value = ""; const clearBtn = document.getElementById("search-clear"); if (clearBtn) clearBtn.hidden = true; },
  subcategory: () => { currentSubcategory = ""; },
  brand: () => { currentBrand = ""; },
  thickness: () => { currentThickness = ""; },
  wearLayer: () => { currentWearLayer = ""; },
  underlayment: () => { currentUnderlayment = ""; },
  waterResistance: () => { currentWaterResistance = ""; },
  availability: () => { currentAvailability = ""; },
};

function clearAllFilters() {
  Object.values(CLEAR_FILTER_SETTERS).forEach(fn => fn());
  syncShopUrl(true);
  renderShopCatalog();
}

// Availability filter is a simple minimum-sq-ft threshold derived from
// Available Sq Ft, not a stored field — options are static in shop.html
// (500+ / 1,000+ sq ft) since they're fixed thresholds, not data-driven.
function matchesAvailability(item, threshold) {
  if (!threshold) return true;
  return typeof item.availableSqFt === "number" && item.availableSqFt >= Number(threshold);
}

// Flooring gets its own extra filter row (Thickness/Wear Layer/
// Underlayment/Water Resistance/Availability) on top of the generic
// Type/Brand row every category uses, plus the Card View/Contractor View
// toggle — all hidden for every other category. Within Flooring, exactly
// one of the card grid (+ dropdown filter rows) or the Contractor View
// (+ pill filters) is shown, based on flooringViewMode.
function isContractorView() {
  return isFlooringView() && flooringViewMode === "contractor";
}
// Flooring-only sidebar groups (Type/Brand apply to every category, so
// they're never touched here). One filter UI now drives both Card View
// and Contractor View — no more separate pill-button row for the latter
// — so unlike the old facetRow/flooringRow split, these groups no longer
// hide for Contractor View, only for a non-Flooring category. This only
// ever *hides* a group; *showing* one back (when it also has options) is
// updateFacetFilterOptions()'s job, since some groups (Wear Layer) also
// hide when they'd have zero options — one-directional here avoids the
// two functions fighting over the same attribute regardless of call order.
const FLOORING_ONLY_SIDEBAR_GROUP_IDS = [
  "thickness-filter-group",
  "wear-layer-filter-item",
  "underlayment-filter-group",
  "water-resistance-filter-group",
  "availability-filter-group",
];
function updateViewToggle() {
  const flooring = isFlooringView();
  const contractor = isContractorView();

  const viewToggle = document.getElementById("flooring-view-toggle");
  if (viewToggle) viewToggle.hidden = !flooring;

  if (!flooring) {
    FLOORING_ONLY_SIDEBAR_GROUP_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    });
  }

  const calcCard = document.getElementById("sidebar-calc-card");
  if (calcCard) calcCard.hidden = !flooring;

  const grid = document.getElementById("catalog-grid");
  if (grid) grid.hidden = contractor;

  const contractorView = document.getElementById("contractor-view");
  if (contractorView) contractorView.hidden = !contractor;
}

// Search matches Name, Brand, Model, Category, Subcategory, Retailer and
// Highlights, case-insensitive. Fields that are blank for a given item are
// simply skipped.
function searchMatches(item, query) {
  if (!query) return true;
  const haystack = [item.name, item.brand, item.model, item.webCategory, item.webSubcategory, item.retailer, item.highlights]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
  return haystack.includes(query);
}

function renderShopCatalog() {
  const query = currentSearch.trim().toLowerCase();
  // Category membership alone (no search/facet filters yet) — a real
  // zero here means "this category has nothing published," the specific
  // case CATALOG_MESSAGES.emptyCategory is for; a filter/search narrowing
  // an otherwise non-empty category to zero gets emptyFiltered instead.
  const wholeCategory = shopItems.filter(i => currentCategory === "all" || i.webCategory === currentCategory);
  const inCategory = wholeCategory.filter(i => searchMatches(i, query));

  let filtered = inCategory;
  if (currentBrand) filtered = filtered.filter(i => i.brand === currentBrand);
  if (currentSubcategory) filtered = filtered.filter(i => i.webSubcategory === currentSubcategory);

  updateFacetFilterOptions(inCategory, filtered);

  if (isFlooringView()) {
    if (currentThickness) filtered = filtered.filter(i => i.thicknessMm === Number(currentThickness));
    if (currentWearLayer) filtered = filtered.filter(i => i.wearLayerMil === Number(currentWearLayer));
    if (currentUnderlayment) filtered = filtered.filter(i => i.underlaymentAttached === currentUnderlayment);
    if (currentWaterResistance) filtered = filtered.filter(i => i.waterResistance === currentWaterResistance);
    if (currentAvailability) filtered = filtered.filter(i => matchesAvailability(i, currentAvailability));
  }
  const sorted = sortItems(filtered, currentSort);
  const emptyMessage = wholeCategory.length === 0
    ? (currentCategory === "all" ? CATALOG_MESSAGES.emptyCategory : emptyCategoryMarkup(currentCategory))
    : CATALOG_MESSAGES.emptyFiltered;
  renderGrid(sorted, "catalog-grid", emptyMessage);
  if (isFlooringView()) {
    renderContractorTable(sorted, emptyMessage);
    renderContractorMobileCards(sorted, emptyMessage);
  }
  updateResultsCount(sorted.length);
  updateActiveFilterChips();
  updateViewToggle();
}

// Lets footer/homepage links like /shop#tools preselect a category tab
// (legacy hash links) — ?cat=<Category Name> (URL-encoded exactly as the
// category reads, e.g. ?cat=Plumbing+%26+Bath) is the primary format.
const CATEGORY_SLUGS = {
  "flooring": "Flooring",
  "water-heaters": "Water Heaters",
  "appliances": "Appliances",
  "plumbing-bath": "Plumbing & Bath",
  "lawn-outdoor": "Lawn & Outdoor",
  "tools": "Tools",
  "home-improvement": "Home Improvement",
};

function categoryFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const catParam = params.get("cat");
  if (catParam && (catParam === "all" || WEB_CATEGORIES.includes(catParam))) return catParam;
  const slug = window.location.hash.replace("#", "");
  return CATEGORY_SLUGS[slug] || null;
}

// Only the search text is round-tripped through the URL alongside
// category (not sort/brand/facets) — it's the piece a visitor most
// expects "back" to restore, and it's a small, low-risk addition to the
// existing cat= sync below. Full filter-state restoration is a larger
// change than "where practical" calls for here.
function searchFromUrl() {
  return new URLSearchParams(window.location.search).get("q") || "";
}

function setActiveCategoryTab(category) {
  document.querySelectorAll(".filter-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-filter") === category);
  });
}

// Pushes ?cat=&q= onto the URL without a full page reload — pushState so
// Back/Forward move between categories, replaceState for the very first
// render (so opening a plain shop.html doesn't create a spurious history
// entry) and for search-as-you-type (so every keystroke doesn't spam
// history). This is also what lets product.html's "Back to inventory"
// (see productDetailHref()/initProductDetail()) restore category+search
// instead of just resetting to the bare category.
function syncShopUrl(replace) {
  const url = new URL(window.location.href);
  if (currentCategory === "all") url.searchParams.delete("cat");
  else url.searchParams.set("cat", currentCategory);
  if (currentSearch) url.searchParams.set("q", currentSearch);
  else url.searchParams.delete("q");
  url.hash = "";
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", url.pathname + url.search);
}

function applyCategoryFromUrl() {
  const category = categoryFromUrl();
  if (category) {
    currentCategory = category;
    setActiveCategoryTab(category);
  }
  const search = searchFromUrl();
  if (search) currentSearch = search;
}

// One item count per category tab (e.g. "Flooring (18)"), computed from
// the full fetched set — independent of the current search/facet filters,
// since a tab count answers "how much is in this category," not "how much
// matches what I just typed." All 7 canonical categories always render
// (the site's category structure is fixed architecture, not something
// that should shift around based on what's in stock this week) — a
// category with zero published items shows "Coming Soon" in place of a
// count instead of hiding the tab or showing a bare "(0)".
function updateCategoryTabCounts() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    const category = btn.getAttribute("data-filter");
    if (category === "all") return;
    const count = shopItems.filter(i => i.webCategory === category).length;
    btn.hidden = false;
    btn.classList.toggle("filter-btn-empty", count === 0);
    const label = btn.getAttribute("data-label") || btn.textContent.replace(/\s*\(\d+\)\s*$|\s*\(Coming Soon\)\s*$/, "").trim();
    btn.setAttribute("data-label", label);
    btn.innerHTML = count === 0
      ? `${label} <span class="filter-count filter-count-empty">(Coming Soon)</span>`
      : `${label} <span class="filter-count">(${count})</span>`;
  });
}

// Wires the "Get a Quote" delegated click handler + modal bindings once
// per page load, and keeps itemsById current. Called from initInventory()
// for every page that has a #quote-modal-overlay — shop, homepage, and
// product detail all render data-quote-id buttons (Flooring cards'
// actionButtons(), and the product detail page), but only shop.html used
// to call this (as part of initShopControls); the button did nothing
// anywhere else because there was no delegated listener AND no modal
// markup on those pages to open. Fixing it here, once, fixes every page.
let quoteModalInitialized = false;
function initQuoteModal(items) {
  items.forEach(i => { itemsById[i.id] = i; });
  if (quoteModalInitialized) return;
  quoteModalInitialized = true;
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quote-id]");
    if (btn) openQuoteModal(itemsById[btn.getAttribute("data-quote-id")]);
  });
  bindQuoteModal();
}

function initShopControls(items) {
  shopItems = items;

  updateCategoryTabCounts();
  applyCategoryFromUrl();
  syncShopUrl(true);

  const filterBtns = document.querySelectorAll(".filter-btn");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentCategory = btn.getAttribute("data-filter");
      currentBrand = "";
      currentSubcategory = "";
      currentThickness = "";
      currentWearLayer = "";
      currentUnderlayment = "";
      currentWaterResistance = "";
      currentAvailability = "";
      syncShopUrl(false);
      updateSortOptionsVisibility();
      renderShopCatalog();
    });
  });

  const sortSelect = document.getElementById("sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      currentSort = sortSelect.value;
      renderShopCatalog();
    });
  }

  const bindFilterSelect = (id, setter) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", () => { setter(el.value); renderShopCatalog(); });
  };
  bindFilterSelect("brand-filter", v => { currentBrand = v; });
  bindFilterSelect("subcategory-filter", v => { currentSubcategory = v; });
  bindFilterSelect("thickness-filter", v => { currentThickness = v; });
  bindFilterSelect("wear-layer-filter", v => { currentWearLayer = v; });
  bindFilterSelect("underlayment-filter", v => { currentUnderlayment = v; });
  bindFilterSelect("water-resistance-filter", v => { currentWaterResistance = v; });
  bindFilterSelect("availability-filter", v => { currentAvailability = v; });

  const viewToggleBtns = document.querySelectorAll(".view-toggle-btn");
  viewToggleBtns.forEach(btn => {
    btn.classList.toggle("active", btn.getAttribute("data-view") === flooringViewMode);
    btn.addEventListener("click", () => {
      flooringViewMode = btn.getAttribute("data-view");
      saveFlooringViewMode(flooringViewMode);
      viewToggleBtns.forEach(b => b.classList.toggle("active", b === btn));
      updateViewToggle();
    });
  });

  bindFlooringCalcCard();
  bindSidebarFilterExtras();

  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");
  if (searchInput) {
    // Restores a ?q= carried forward from a "Back to inventory" link
    // (see productDetailHref()/syncShopUrl()) — currentSearch is already
    // set from the URL by applyCategoryFromUrl() above; the input itself
    // still needs its value/clear-button state to match.
    if (currentSearch) {
      searchInput.value = currentSearch;
      if (searchClear) searchClear.hidden = false;
    }
    searchInput.addEventListener("input", () => {
      currentSearch = searchInput.value;
      if (searchClear) searchClear.hidden = currentSearch.length === 0;
      syncShopUrl(true);
      renderShopCatalog();
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      currentSearch = "";
      if (searchInput) { searchInput.value = ""; searchInput.focus(); }
      searchClear.hidden = true;
      syncShopUrl(true);
      renderShopCatalog();
    });
  }

  bindCalculatorModal();

  updateSortOptionsVisibility();
  renderShopCatalog();

  // ?cat=Flooring&calc=1 opens straight into the calculator modal with
  // Flooring already applied. No longer linked from the header nav (that
  // duplicated the "Flooring Calculator" button in this page's own
  // filter bar, which is the calculator's one entry point now) — kept
  // for any other /shop?...&calc=1 deep link.
  if (new URLSearchParams(window.location.search).get("calc") === "1") {
    openCalculatorModal(false);
  }
}

// ---------------------------------------------------------------------
// Get a Quote modal — opened from the "Get a Quote" button on Flooring
// cards (see actionButtons), where a sq-ft-needed quote makes sense.
// Submits to the "quote-request" Netlify Form via fetch, so the page
// never navigates away. See the static hidden form in shop.html for the
// field list Netlify expects.
// ---------------------------------------------------------------------
function quotePriceText(item) {
  if (item.webCategory === "Flooring" && typeof item.price === "number") {
    return typeof item.boxPrice === "number" ? `${money2(item.price)} / sq ft · ${money2(item.boxPrice)} / box` : `${money2(item.price)} / sq ft`;
  }
  return money(item.price);
}

function openQuoteModal(item) {
  if (!item) return;
  const overlay = document.getElementById("quote-modal-overlay");
  const form = document.getElementById("quote-form");
  if (!overlay || !form) return;

  const nameEl = document.getElementById("quote-product-name");
  const priceEl = document.getElementById("quote-product-price");
  if (nameEl) nameEl.textContent = item.name;
  if (priceEl) priceEl.textContent = quotePriceText(item);

  form.reset();
  document.getElementById("quote-field-product-name").value = item.name;
  document.getElementById("quote-field-product-key").value = item.productKey || item.id;
  document.getElementById("quote-field-price-per-sqft").value = typeof item.price === "number" ? money2(item.price) : "";
  document.getElementById("quote-field-box-price").value = typeof item.boxPrice === "number" ? money2(item.boxPrice) : "";

  const smsLink = document.getElementById("quote-text-us-link");
  if (smsLink) {
    const phoneHref = window.SITE_CONFIG ? window.SITE_CONFIG.phoneHref : "";
    smsLink.href = `sms:${phoneHref}?&body=${encodeURIComponent(smsMessageForItem(item))}`;
  }

  document.getElementById("quote-modal-form-view").hidden = false;
  document.getElementById("quote-modal-success-view").hidden = true;
  document.getElementById("quote-form-error").hidden = true;

  overlay.hidden = false;
  document.body.classList.add("modal-open");
  form.querySelector('[name="sqft-needed"]')?.focus();
}

function closeQuoteModal() {
  const overlay = document.getElementById("quote-modal-overlay");
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("modal-open");
}

function encodeFormData(data) {
  return Object.keys(data).map(k => `${encodeURIComponent(k)}=${encodeURIComponent(data[k])}`).join("&");
}

function bindQuoteModal() {
  const overlay = document.getElementById("quote-modal-overlay");
  const form = document.getElementById("quote-form");
  if (!overlay || !form) return;

  document.getElementById("quote-modal-close")?.addEventListener("click", closeQuoteModal);
  document.getElementById("quote-modal-done")?.addEventListener("click", closeQuoteModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeQuoteModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeQuoteModal(); });

  document.getElementById("quote-calc-link")?.addEventListener("click", () => {
    // The Flooring Calculator modal only exists on shop.html — guard so
    // a page without it (this link itself is omitted from the homepage/
    // product-detail copies of this modal, but stay defensive) never
    // hides the quote modal with nothing to replace it.
    if (!document.getElementById("calc-modal-overlay")) return;
    overlay.hidden = true;
    openCalculatorModal(true);
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const submitBtn = document.getElementById("quote-submit-btn");
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Sending..."; }
    document.getElementById("quote-form-error").hidden = true;

    document.getElementById("quote-field-submitted-at").value = new Date().toLocaleString("en-US", { timeZone: "America/Chicago" });

    const payload = {};
    new FormData(form).forEach((value, key) => { payload[key] = value; });

    try {
      const res = await fetch("/", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: encodeFormData(payload),
      });
      if (!res.ok) throw new Error(`Submission failed: ${res.status}`);
      document.getElementById("quote-modal-form-view").hidden = true;
      document.getElementById("quote-modal-success-view").hidden = false;
    } catch (err) {
      console.warn("Invicta: quote submission failed —", err);
      document.getElementById("quote-form-error").hidden = false;
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Request Quote"; }
    }
  });
}

// ---------------------------------------------------------------------
// Flooring Calculator — entirely client-side (no Airtable/Netlify Functions/
// Netlify Forms). Estimates total square footage across one or more rooms
// from feet+inches dimensions, plus a waste percentage.
//
// The calculator can be opened two ways:
//   - Directly from the Shop page ("Flooring Calculator" button): shows
//     Total Room Area / Recommended Flooring with a plain Done action.
//   - From the Get a Quote modal ("Calculate Sq Ft" link): the quote modal
//     is hidden (not reset, so its fields survive) while the calculator is
//     open, and "Use This For My Quote" writes the rounded-up recommended
//     amount into Approx. Sq Ft Needed, then re-shows the quote modal.
// Product-independent by design (no box-count math yet — see README/task).
// ---------------------------------------------------------------------
const CALC_MAX_ROOMS = 20;
let calcRoomCounter = 0;
let calcWasteRate = 0.10;
let calcOpenedFromQuote = false;
let calcLastRecommended = 0;

// Clamps/defaults a feet+inches pair into a safe non-negative decimal-feet
// value: blank or non-numeric input becomes 0, negative feet become 0, and
// inches are clamped to 0-11 — so a stray typo can never produce NaN or a
// negative room dimension.
function calcParseFeetInches(feetRaw, inchesRaw) {
  let feet = parseFloat(feetRaw);
  if (!isFinite(feet) || isNaN(feet) || feet < 0) feet = 0;
  let inches = parseFloat(inchesRaw);
  if (!isFinite(inches) || isNaN(inches)) inches = 0;
  inches = Math.min(11, Math.max(0, inches));
  return feet + inches / 12;
}

// Rounds to at most 2 decimal places for display, trimming trailing zeros
// (100 -> "100", 138.6 -> "138.6", 434.69 -> "434.69") — never rounds the
// values used in the underlying math, only what's shown on screen.
function calcRound2(n) {
  return (Math.round((n + Number.EPSILON) * 100) / 100).toString();
}

function calcRoomTemplate(n) {
  calcRoomCounter += 1;
  const id = calcRoomCounter;
  return `
  <div class="calc-room" data-room-id="${id}">
    <div class="calc-room-header">
      <span class="calc-room-label">Room ${n}</span>
      <button type="button" class="calc-room-remove" data-remove-room="${id}" aria-label="Remove Room ${n}">&times;</button>
    </div>
    <div class="calc-dim-row">
      <span class="calc-dim-label">Length</span>
      <input type="number" inputmode="decimal" min="0" step="any" class="calc-input" data-dim="length-ft" aria-label="Room ${n} length, feet" placeholder="0">
      <span class="calc-unit">ft</span>
      <input type="number" inputmode="numeric" min="0" max="11" step="1" class="calc-input calc-input-narrow" data-dim="length-in" aria-label="Room ${n} length, inches" placeholder="0">
      <span class="calc-unit">in</span>
    </div>
    <div class="calc-dim-row">
      <span class="calc-dim-label">Width</span>
      <input type="number" inputmode="decimal" min="0" step="any" class="calc-input" data-dim="width-ft" aria-label="Room ${n} width, feet" placeholder="0">
      <span class="calc-unit">ft</span>
      <input type="number" inputmode="numeric" min="0" max="11" step="1" class="calc-input calc-input-narrow" data-dim="width-in" aria-label="Room ${n} width, inches" placeholder="0">
      <span class="calc-unit">in</span>
    </div>
    <div class="calc-room-area" data-room-area>Room area: <strong>0 sq ft</strong></div>
  </div>`;
}

function calcRelabelRooms() {
  document.querySelectorAll("#calc-rooms .calc-room").forEach((roomEl, idx) => {
    const n = idx + 1;
    const label = roomEl.querySelector(".calc-room-label");
    if (label) label.textContent = `Room ${n}`;
    const removeBtn = roomEl.querySelector(".calc-room-remove");
    if (removeBtn) removeBtn.setAttribute("aria-label", `Remove Room ${n}`);
  });
}

// Hides the remove button when only one room is left (Room 1 can't be
// removed if it's the only room) and disables adding past the room cap.
function calcUpdateRoomChrome() {
  const rooms = document.querySelectorAll("#calc-rooms .calc-room");
  const onlyOne = rooms.length <= 1;
  rooms.forEach(roomEl => {
    const removeBtn = roomEl.querySelector(".calc-room-remove");
    if (removeBtn) removeBtn.hidden = onlyOne;
  });
  const addBtn = document.getElementById("calc-add-room");
  if (addBtn) {
    const atMax = rooms.length >= CALC_MAX_ROOMS;
    addBtn.disabled = atMax;
    addBtn.textContent = atMax ? `Maximum ${CALC_MAX_ROOMS} rooms reached` : "+ Add Another Room";
  }
}

// Recomputes every room's area, the total, and the recommended (with waste)
// amount from whatever is currently in the DOM inputs. Rooms are summed at
// full precision — only the displayed strings are rounded to 2 decimals.
function calcRecalculate() {
  let totalArea = 0;
  document.querySelectorAll("#calc-rooms .calc-room").forEach(roomEl => {
    const length = calcParseFeetInches(
      roomEl.querySelector('[data-dim="length-ft"]')?.value,
      roomEl.querySelector('[data-dim="length-in"]')?.value
    );
    const width = calcParseFeetInches(
      roomEl.querySelector('[data-dim="width-ft"]')?.value,
      roomEl.querySelector('[data-dim="width-in"]')?.value
    );
    const area = length * width;
    totalArea += area;
    const areaEl = roomEl.querySelector("[data-room-area]");
    if (areaEl) areaEl.innerHTML = `Room area: <strong>${calcRound2(area)} sq ft</strong>`;
  });

  const totalEl = document.getElementById("calc-total-area");
  if (totalEl) totalEl.textContent = `${calcRound2(totalArea)} sq ft`;

  const recommended = totalArea * (1 + calcWasteRate);
  calcLastRecommended = recommended;
  const recEl = document.getElementById("calc-recommended");
  if (recEl) recEl.textContent = `${calcRound2(recommended)} sq ft`;
}

// Resets the calculator back to a single empty room and the default waste
// rate every time it's opened — it doesn't need to remember a prior session.
function calcResetState() {
  calcWasteRate = 0.10;
  calcRoomCounter = 0;
  const container = document.getElementById("calc-rooms");
  if (container) container.innerHTML = calcRoomTemplate(1);
  document.querySelectorAll(".calc-waste-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-waste") === "10");
  });
  calcUpdateRoomChrome();
  calcRecalculate();
}

function openCalculatorModal(fromQuote) {
  calcOpenedFromQuote = !!fromQuote;
  calcResetState();
  const useForQuoteBtn = document.getElementById("calc-use-for-quote");
  const doneBtn = document.getElementById("calc-done");
  if (useForQuoteBtn) useForQuoteBtn.hidden = !calcOpenedFromQuote;
  if (doneBtn) doneBtn.hidden = calcOpenedFromQuote;

  const overlay = document.getElementById("calc-modal-overlay");
  if (overlay) overlay.hidden = false;
  document.body.classList.add("modal-open");
}

// Closing always hides the calculator; if it was opened from Get a Quote,
// the (never-reset) quote modal is shown again instead of leaving the
// customer with nothing open.
function closeCalculatorModal() {
  const overlay = document.getElementById("calc-modal-overlay");
  if (overlay) overlay.hidden = true;

  if (calcOpenedFromQuote) {
    const quoteOverlay = document.getElementById("quote-modal-overlay");
    if (quoteOverlay) quoteOverlay.hidden = false;
  } else {
    document.body.classList.remove("modal-open");
  }
  calcOpenedFromQuote = false;
}

function bindCalculatorModal() {
  const overlay = document.getElementById("calc-modal-overlay");
  const roomsContainer = document.getElementById("calc-rooms");
  if (!overlay || !roomsContainer) return;

  document.getElementById("calc-modal-close")?.addEventListener("click", closeCalculatorModal);
  document.getElementById("calc-done")?.addEventListener("click", closeCalculatorModal);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeCalculatorModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeCalculatorModal(); });

  roomsContainer.addEventListener("input", (e) => {
    if (e.target.matches(".calc-input")) calcRecalculate();
  });

  roomsContainer.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("[data-remove-room]");
    if (!removeBtn) return;
    if (roomsContainer.querySelectorAll(".calc-room").length <= 1) return;
    removeBtn.closest(".calc-room")?.remove();
    calcRelabelRooms();
    calcUpdateRoomChrome();
    calcRecalculate();
  });

  document.getElementById("calc-add-room")?.addEventListener("click", () => {
    const count = roomsContainer.querySelectorAll(".calc-room").length;
    if (count >= CALC_MAX_ROOMS) return;
    roomsContainer.insertAdjacentHTML("beforeend", calcRoomTemplate(count + 1));
    calcUpdateRoomChrome();
    calcRecalculate();
  });

  document.querySelectorAll(".calc-waste-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".calc-waste-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      calcWasteRate = parseFloat(btn.getAttribute("data-waste")) / 100;
      calcRecalculate();
    });
  });

  document.getElementById("calc-use-for-quote")?.addEventListener("click", () => {
    const roundedUp = Math.max(0, Math.ceil(calcLastRecommended));
    const sqftInput = document.getElementById("quote-sqft-input");
    if (sqftInput) sqftInput.value = roundedUp > 0 ? String(roundedUp) : "";
    closeCalculatorModal();
    sqftInput?.focus();
  });
}

// ---------------------------------------------------------------------
// Homepage hero price + stat strip — both computed from the live fetched
// inventory, never hardcoded. "Lowest price" only ever considers
// published + in-stock Flooring rows with a real positive Price.
// ---------------------------------------------------------------------
function updateHomepageDynamicContent(items) {
  const priceEl = document.getElementById("hero-price");
  const sqftEl = document.getElementById("stat-sqft");
  const flooring = items.filter(i => i.webCategory === "Flooring" && isAvailable(i));

  if (priceEl) {
    const prices = flooring.map(i => i.price).filter(p => typeof p === "number" && p > 0);
    if (prices.length) priceEl.textContent = money2(Math.min(...prices));
  }
  if (sqftEl) {
    const totalSqFt = flooring.reduce((sum, i) => sum + (typeof i.availableSqFt === "number" ? i.availableSqFt : 0), 0);
    sqftEl.textContent = totalSqFt > 0 ? Math.round(totalSqFt).toLocaleString("en-US") : "—";
  }
}

// ---------------------------------------------------------------------
// Product detail page (product.html?id=<Product Key>) — a shareable,
// full-detail view. Reuses priceBlock()/statusBadge()/smsHrefForItem()
// from the card so pricing/availability/CTA logic isn't duplicated.
// Reads from the same fetched inventory as every other page; no separate
// API call, no Airtable credentials involved.
// ---------------------------------------------------------------------
// Detail-page main image uses the full-size photo (item.photos[0]), not
// the card-sized variant — this is the one place a visitor is actually
// looking closely at the product, per the "larger image for product
// detail/gallery views" requirement. Thumb-row icons still use the small
// variant, same as the card gallery.
function productDetailPhotoBlock(item) {
  if (!item.photos || item.photos.length === 0) {
    return `<div class="product-photo main-photo" role="img" aria-label="${escapeAttr(item.name)} — no photo available">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 3v18"/></svg>
    </div>`;
  }
  const alt = escapeAttr(item.name);
  const thumbs = item.photos.length > 1
    ? `<div class="thumb-row">${item.photos.map((p, i) =>
        `<img class="thumb${i === 0 ? " active" : ""}" src="${item.photoThumbs[i]}" data-full="${item.photos[i]}" alt="" loading="lazy" width="40" height="40">`).join("")}</div>`
    : "";
  return `<div class="product-photo main-photo">
    <img src="${item.photos[0]}" alt="${alt}" width="800" height="800" data-main-photo>
  </div>${thumbs}`;
}

// Every real field worth showing in full, beyond the card's 3-chip
// summary — labels/values only ever come from real item fields, nothing
// parsed or invented. Flooring gets its 4 structured fields plus
// coverage-per-box; every other category gets Quantity Available instead
// (Flooring's "available" story is sq ft/boxes, not a unit count).
function productDetailSpecRows(item) {
  const rows = [];
  const add = (label, value) => { if (value !== undefined && value !== null && value !== "") rows.push([label, value]); };
  add("Brand", item.brand);
  add("Model", item.model);
  add("Retailer", item.retailer);
  if (item.webCategory === "Flooring") {
    add("Subcategory", item.webSubcategory);
    add("Thickness", typeof item.thicknessMm === "number" && item.thicknessMm > 0 ? `${item.thicknessMm} mm` : "");
    add("Wear Layer", typeof item.wearLayerMil === "number" && item.wearLayerMil > 0 ? `${item.wearLayerMil} MIL` : "");
    add("Underlayment Attached", item.underlaymentAttached);
    add("Water Resistance", item.waterResistance && item.waterResistance !== "Unknown" ? item.waterResistance : "");
    add("Coverage Per Box", typeof item.sqFtPerUnit === "number" ? `${sqFtAvailable(item.sqFtPerUnit)} sq ft` : "");
    add("Available", typeof item.availableSqFt === "number" ? `${sqFtAvailable(item.availableSqFt)} sq ft` : "");
  } else {
    add("Subcategory", item.webSubcategory);
    add("Quantity Available", typeof item.qtyAvailable === "number" ? item.qtyAvailable : "");
  }
  add("Product Key", item.productKey);
  return rows;
}

function renderProductNotFound(container, message) {
  container.innerHTML = `<div class="product-detail-notfound">
    <h1>${message ? "Inventory unavailable" : "Item not found"}</h1>
    <p class="${message ? "catalog-error" : ""}">${message || "This item may no longer be available. Check the full inventory instead."}</p>
    <a href="/shop" class="btn btn-dark">Back to inventory</a>
  </div>`;
}

function initProductDetail(items) {
  const container = document.getElementById("product-detail-root");
  if (!container) return;

  const id = new URLSearchParams(window.location.search).get("id");
  const item = id ? items.find(i => (i.productKey || i.id) === id) : null;

  if (!item) {
    renderProductNotFound(container, lastFetchError ? CATALOG_MESSAGES.error : null);
    return;
  }

  document.title = `${item.name} | Invicta Home Supply`;
  const metaDesc = document.querySelector('meta[name="description"]');
  const summary = item.details || item.highlights || `${item.name} — ${item.webCategory} at Invicta Home Supply.`;
  if (metaDesc) metaDesc.setAttribute("content", summary.replace(/\s+/g, " ").slice(0, 300));

  const categoryLabel = item.webSubcategory ? `${item.webCategory} &middot; ${item.webSubcategory}` : item.webCategory;
  const specRows = productDetailSpecRows(item);
  const highlightLines = highlightBullets(item.highlights);
  // Prefer the shop page's own carried-forward state (?from=, set by
  // productDetailHref()) so "Back to inventory" restores category+search
  // (see syncShopUrl()), not just the bare category. window.location.
  // pathname always has a leading "/" (productDetailHref() built this
  // from that same property), so the same-site check has to match that,
  // not a bare "/shop" — this keeps it to an actual same-site /shop path
  // rather than trusting the query param as an arbitrary redirect target.
  // Matches the legacy /shop.html path too (still reachable pre-redirect,
  // e.g. a stale cached link), even though every link this site generates
  // now points at /shop.
  const fromParam = new URLSearchParams(window.location.search).get("from");
  const backHref = fromParam && /(^|\/)shop(\.html)?(\?|$)/.test(fromParam) ? fromParam : `/shop?cat=${encodeURIComponent(item.webCategory)}`;

  container.innerHTML = `
    <a class="product-detail-back" href="${backHref}">&larr; Back to inventory</a>
    <div class="product-detail">
      <div class="product-detail-media">
        ${productDetailPhotoBlock(item)}
      </div>
      <div class="product-detail-info">
        <span class="product-cat">${categoryLabel}</span>
        <h1>${item.name}</h1>
        ${statusBadge(item)}
        ${priceBlock(item)}
        ${item.webCategory === "Flooring" && isAvailable(item)
          ? `<button type="button" class="btn btn-outline btn-small" data-quote-id="${item.id}">Get a Quote</button>`
          : ""}
        ${specRows.length ? `<div class="product-detail-specs"><table>${specRows.map(([l, v]) => `<tr><td>${l}</td><td>${v}</td></tr>`).join("")}</table></div>` : ""}
        ${item.details ? `<p class="product-detail-desc">${item.details}</p>` : ""}
        ${highlightLines.length ? `<ul class="product-details">${highlightLines.map(h => `<li>${h}</li>`).join("")}</ul>` : ""}
        <div class="product-detail-actions">
          ${isAvailable(item)
            ? `<a href="${smsHrefForItem(item)}" class="btn btn-dark">Text about this item</a>`
            : `<span class="btn btn-outline" style="opacity:.5; cursor:default;">${item.statusLabel}</span>`}
          <a href="tel:" data-tel-link class="btn btn-outline">Call</a>
          <a href="${backHref}" class="btn btn-outline">Back to inventory</a>
        </div>
      </div>
    </div>`;

  // app.js's own DOMContentLoaded pass already ran before this HTML
  // existed, so the freshly-inserted data-tel-link needs its href set
  // directly rather than waiting for a binding pass that already happened.
  const telLink = container.querySelector("[data-tel-link]");
  if (telLink && window.SITE_CONFIG) telLink.href = `tel:${window.SITE_CONFIG.phoneHref}`;

  container.querySelectorAll(".thumb").forEach(thumb => {
    thumb.addEventListener("click", () => {
      container.querySelectorAll(".thumb").forEach(t => t.classList.remove("active"));
      thumb.classList.add("active");
      const main = container.querySelector("[data-main-photo]");
      if (main) main.src = thumb.getAttribute("data-full");
    });
  });
}

async function initInventory() {
  const { items, error } = await fetchInventory();
  lastFetchError = error;

  // Get a Quote modal: shared across every page that can render a
  // data-quote-id button. Must run before the page-specific branches
  // below so their first render's buttons are already wired.
  if (document.getElementById("quote-modal-overlay")) {
    initQuoteModal(items);
  }

  // Shop page: full catalog (filtering + sorting handled together)
  if (document.getElementById("catalog-grid")) {
    initShopControls(items);
  }

  // Home page: New This Week + hero/stat-strip dynamic content
  if (document.getElementById("new-arrivals-grid")) {
    renderGrid(pickNewArrivals(items, 4), "new-arrivals-grid", CATALOG_MESSAGES.emptyCategory);
  }
  if (document.getElementById("hero-price")) {
    updateHomepageDynamicContent(items);
  }

  // Product detail page
  if (document.getElementById("product-detail-root")) {
    initProductDetail(items);
  }
}

document.addEventListener("DOMContentLoaded", initInventory);

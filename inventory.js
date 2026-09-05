/* ===================================================================
   Invicta Home Supply — inventory (Airtable-backed catalog)

   Source of truth for product data is the Google Sheet Product Catalog ->
   Website Export -> Airtable -> this site. Airtable is a synced mirror,
   not the source of truth. Per the schema-cleanup pass, this site reuses
   real existing fields instead of inventing duplicates — no more Web
   Category/Sell Unit/Specs/Web Status/Product-Catalog-side Quantity
   Available. The fields this file actually reads are:

     Website Category, Web Subcategory (new, optional), Category (legacy
     broad/internal — used only as a fallback), Product Key, Display Name,
     Brand, Model, Retail SKU, Retailer, Website Price, Retail Price
     (-> "was"/retail-comparison price), Unit Type (Box/Each/Sq Ft/Roll),
     Quantity Available, In Stock, Box Price, Sq Ft Per Unit,
     Available Sq Ft, Description, Highlights, Product Url,
     Stock Image Url, Post to Website (server-side gate only), Date Added.

   ASSUMPTION FLAGGED: the field name strings below use Title Case
   ("Website Category", "Unit Type", ...) matching this codebase's existing
   Airtable convention. The Google Sheet headers were shared in ALL CAPS
   ("WEBSITE CATEGORY", "UNIT TYPE", ...) — Airtable field names are
   case-sensitive and must match exactly, so confirm the real Airtable
   field names before relying on this in production; a mismatch means that
   field silently reads as blank (falls back gracefully, but silently).

   Category resolution still needs a fallback because Website Category
   won't be backfilled on every row on day one: resolveWebCategory() below
   checks Website Category first, then the legacy Category field through
   an explicit allowlist, then (only for a genuinely blank Category) infers
   Flooring from flooring-shaped attributes. Anything else is not
   published — see the comments on LEGACY_CATEGORY_RULES/hasFlooringAttributes.

   Availability now comes from Website Export's In Stock field (falling
   back to Quantity Available > 0 if In Stock isn't present) rather than a
   dedicated status field — see resolveInStock()/isAvailable(). Not-in-
   stock items still render with a disabled "Out of Stock" pill rather
   than being hidden here; per the Apps Script rule discussed
   (Post to Website = Yes AND Quantity Available > 0), most such rows
   likely won't even reach this site, but the fallback costs nothing.

   Inventory data is fetched from the /api/inventory serverless function,
   which holds the Airtable credentials server-side (Netlify environment
   variables) — nothing sensitive lives in this file or in git.
   Until that function returns data, the site shows sample placeholder
   items so it never looks broken.
   =================================================================== */
window.AIRTABLE_CONFIG = {
  cacheMinutes: 15,
};

const CACHE_KEY = "invicta_inventory_cache_v4";
const INVENTORY_ENDPOINT = "/api/inventory";

// The 7 public-facing website categories. An item is only resolved to one
// of these when Website Category is already set, or its legacy Category
// matches one of the explicit rules below — see resolveWebCategory().
const WEB_CATEGORIES = [
  "Flooring",
  "Water Heaters",
  "Appliances",
  "Plumbing & Bath",
  "Lawn & Outdoor",
  "Tools",
  "Home Improvement",
];

// Explicit allowlist only — this is NOT a catch-all. A legacy internal
// Category only resolves to a web category if it matches one of these
// rules; anything else (Electronics, Gaming, Toys, Collectibles, Health &
// Personal Care, or any other unrecognized non-blank value) is
// deliberately left unresolved and the item is not published, even if
// Post to Website is TRUE upstream — those product lines are out of scope
// for this home-improvement storefront and must not be guessed into a
// tab. A genuinely blank Category is handled separately in
// resolveWebCategory (see hasFlooringAttributes) rather than here.
// Temporary: remove once every row has a real Website Category from Product Catalog.
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
// sq ft, or any flooring-specific numeric field is present and positive —
// used only for the blank-Category fallback below, never to reclassify a
// row that already has an explicit (even if unrecognized) Category.
function hasFlooringAttributes(f) {
  const isPositiveNumber = v => typeof v === "number" && !isNaN(v) && v > 0;
  if ((f["Unit Type"] || "").trim().toLowerCase() === "sq ft") return true;
  return isPositiveNumber(f["Sq Ft Per Unit"]) || isPositiveNumber(f["Box Price"]) || isPositiveNumber(f["Available Sq Ft"]);
}

// Returns a valid web category, or null if the item should not be
// published (see LEGACY_CATEGORY_RULES comment above — null is a
// deliberate "do not show" signal, not a bug).
function resolveWebCategory(f) {
  const webCategory = (f["Website Category"] || "").trim();
  if (WEB_CATEGORIES.includes(webCategory)) return webCategory;
  const legacy = (f["Category"] || "").trim();
  if (!legacy) {
    // Blank Category on a row that's already live (Post to Website = TRUE
    // is the only way it reaches here at all): this site was flooring-only
    // before this migration, so a blank-Category row with flooring
    // attributes is almost certainly an existing flooring listing whose
    // Category just never got filled in — infer Flooring rather than
    // silently unpublishing something that's live today. Never extend
    // this inference to non-flooring rows: a blank-Category row with no
    // flooring attributes stays excluded, same as any other unrecognized
    // Category, until it gets a real Website Category from Product Catalog.
    return hasFlooringAttributes(f) ? "Flooring" : null;
  }
  const rule = LEGACY_CATEGORY_RULES.find(r => r.test.test(legacy));
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

// Availability now comes from Website Export's In Stock field; Quantity
// Available > 0 is the fallback if In Stock isn't present (e.g. a cached
// record from before that field existed). Neither present defaults to
// available rather than hiding an item over a missing field.
function resolveInStock(f) {
  if (typeof f["In Stock"] === "boolean") return f["In Stock"];
  if (typeof f["Quantity Available"] === "number") return f["Quantity Available"] > 0;
  return true;
}

function isAvailable(item) {
  return item.inStock;
}

// Maps one raw Airtable record into the shape the rest of this file uses,
// or returns null if the item should not be published (see
// resolveWebCategory) — category is the one field that can legitimately
// mean "don't show this." Everything else has a graceful fallback.
function mapAirtableRecord(id, f) {
  const webCategory = resolveWebCategory(f);
  if (!webCategory) return null;
  const dateAdded = f["Date Added"] ? new Date(f["Date Added"]) : null;
  return {
    id,
    productKey: f["Product Key"] || "",
    name: f["Display Name"] || "Untitled item",
    webCategory,
    webSubcategory: f["Web Subcategory"] || "",
    sellUnit: resolveSellUnit(f, webCategory),
    brand: f["Brand"] || "",
    model: f["Model"] || "",
    retailSku: f["Retail SKU"] || "",
    retailer: f["Retailer"] || "",
    price: f["Website Price"],
    wasPrice: f["Retail Price"],
    qtyAvailable: f["Quantity Available"],
    boxPrice: f["Box Price"],
    sqFtPerUnit: f["Sq Ft Per Unit"],
    availableSqFt: f["Available Sq Ft"],
    description: f["Description"] || "",
    highlights: f["Highlights"] || "",
    productUrl: f["Product Url"] || "",
    inStock: resolveInStock(f),
    photos: f["Stock Image Url"] ? [f["Stock Image Url"]] : [],
    isNew: dateAdded ? (Date.now() - dateAdded.getTime()) / 86400000 <= 7 : false,
  };
}

// Shown automatically until the Airtable function returns real records —
// replace by adding real rows in the Product Catalog sheet, not by editing
// this list. Deliberately spans multiple categories so the mixed layouts
// (New This Week, category tiles, shop tabs) all have something to show.
// The first 8 represent the fully-migrated future state (already in the
// mapAirtableRecord() output shape); the rest are raw, Website-Export-
// shaped records run through mapAirtableRecord() so the fallback rules
// (blank-Category inference, unrecognized-category exclusion, out-of-
// stock handling) are visibly exercised, not just unit logic.
// .filter(Boolean) drops "legacy-3" (Electronics), which mapAirtableRecord
// deliberately returns null for — that's the point of including it here.
const FALLBACK_ITEMS = [
  { id: "sample-1", name: "Waterproof Oak Plank Flooring", webCategory: "Flooring", webSubcategory: "LVP", brand: "Invicta Floors", sellUnit: "sq ft", price: 2.01, boxPrice: 42.11, sqFtPerUnit: 20.94, availableSqFt: 1026, highlights: "22mil wear layer\nWaterproof\nClicklock installation", inStock: true, photos: [], isNew: true },
  { id: "sample-2", name: "Rustic Pine Waterproof Plank", webCategory: "Flooring", webSubcategory: "LVP", brand: "Invicta Floors", sellUnit: "sq ft", price: 1.79, boxPrice: 38.36, sqFtPerUnit: 21.43, availableSqFt: 815, highlights: "12mil wear layer\nWaterproof core\nPickup only", inStock: true, photos: [], isNew: true },
  { id: "sample-3", name: "50-Gallon Gas Water Heater", webCategory: "Water Heaters", webSubcategory: "Gas", brand: "Rheem", sellUnit: "each", price: 649, wasPrice: 1049, qtyAvailable: 2, highlights: "50 gal\nNatural gas\n6-year tank warranty", inStock: true, photos: [], isNew: true },
  { id: "sample-4", name: "Stainless French Door Refrigerator", webCategory: "Appliances", webSubcategory: "Refrigerator", brand: "Samsung", sellUnit: "each", price: 1350, wasPrice: 2199, qtyAvailable: 1, highlights: "27 cu ft\nFrench door\nIce maker included", inStock: true, photos: [] },
  { id: "sample-5", name: "Undermount Kitchen Sink, Stainless", webCategory: "Plumbing & Bath", webSubcategory: "Sinks", brand: "Kraus", sellUnit: "each", price: 120, wasPrice: 240, qtyAvailable: 4, highlights: "Stainless\nUndermount, 32 in\nIncludes mounting hardware", inStock: true, photos: [] },
  { id: "sample-6", name: "Self-Propelled Gas Mower, 21 in", webCategory: "Lawn & Outdoor", brand: "Honda", sellUnit: "each", price: 429, wasPrice: 599, qtyAvailable: 0, highlights: "21 in\nSelf-propelled\nMulch/bag/side-discharge 3-in-1", inStock: false, photos: [] },
  { id: "sample-7", name: "18V Cordless Drill Kit, 2 Batteries", webCategory: "Tools", webSubcategory: "Power Tools", brand: "DeWalt", sellUnit: "each", price: 89, wasPrice: 149, qtyAvailable: 6, highlights: "18V\n2 batteries + charger\nBrushless", inStock: true, photos: [] },
  { id: "sample-8", name: "Matte Black Barn Door Hardware Kit", webCategory: "Home Improvement", brand: "", sellUnit: "each", price: 65, wasPrice: 120, qtyAvailable: 5, highlights: "6.6 ft track\nMatte black\nSoft-close, fits doors up to 36 in", inStock: true, photos: [] },
  // Pre-migration-shaped rows: no Website Category/Web Subcategory/Unit
  // Type/In Stock yet, only the legacy Category/Quantity Available fields.
  // legacy-1: exact-match legacy Category -> still shows (Flooring, sq ft inferred).
  mapAirtableRecord("legacy-1", { "Display Name": "Legacy Oak Laminate (unmigrated row)", "Category": "Flooring", "Website Price": 1.65, "Quantity Available": 30 }),
  // legacy-2: keyword-matched legacy Category ("Plumbing" substring) -> Plumbing & Bath,
  // Quantity Available = 0 -> shown with a disabled "Out of Stock" pill, not hidden.
  mapAirtableRecord("legacy-2", { "Display Name": "Legacy Plumbing Fixture Kit (unmigrated row)", "Category": "Plumbing Fixtures", "Website Price": 45, "Quantity Available": 0 }),
  // legacy-3: out-of-scope legacy Category with no keyword match -> resolveWebCategory
  // returns null -> mapAirtableRecord returns null -> dropped by .filter(Boolean)
  // below. This is the "must not be auto-categorized or newly published" case.
  mapAirtableRecord("legacy-3", { "Display Name": "Legacy Game Console (should not publish)", "Category": "Electronics", "Website Price": 199, "Quantity Available": 3 }),
  // legacy-4: blank Category but Unit Type = "Sq Ft" -> inferred as Flooring
  // rather than silently unpublished, since this site was flooring-only
  // pre-migration.
  mapAirtableRecord("legacy-4", { "Display Name": "Legacy Vinyl Plank, No Category Set (unmigrated row)", "Website Price": 1.95, "Unit Type": "Sq Ft", "Box Price": 41.5, "Sq Ft Per Unit": 21.28, "Available Sq Ft": 640 }),
  // legacy-5: blank Category AND no flooring attributes -> stays excluded,
  // same as any other unrecognized Category. Proves the inference above
  // is flooring-only, not a general blank-Category catch-all.
  mapAirtableRecord("legacy-5", { "Display Name": "Legacy Unknown Item, No Category (should not publish)", "Website Price": 25 }),
].filter(Boolean);

async function fetchInventory() {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) {
    try {
      const { data, ts } = JSON.parse(cached);
      if (Date.now() - ts < window.AIRTABLE_CONFIG.cacheMinutes * 60 * 1000) return data;
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
    return items;
  } catch (err) {
    console.warn("Invicta: falling back to sample inventory —", err);
    return FALLBACK_ITEMS;
  }
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

// Boxes available is derived, never entered directly: Available Sq Ft ÷ Sq
// Ft Per Unit, rounded down (a partial box isn't a sellable whole box).
function boxesAvailable(item) {
  if (typeof item.availableSqFt !== "number" || typeof item.sqFtPerUnit !== "number" || item.sqFtPerUnit <= 0) return null;
  return Math.floor(item.availableSqFt / item.sqFtPerUnit);
}

function highlightBullets(highlights) {
  if (!highlights) return [];
  return highlights.split(/\r?\n/)
    .map(s => s.trim().replace(/^[•●◦∙\-*]\s*/, ""))
    .filter(Boolean);
}

// No dedicated Specs field (deliberately not created — see README) — the
// first 3 short Highlights lines double as the card's chip row. The rest
// of Highlights still shows in full in the "More details" section.
function cardChips(item) {
  return highlightBullets(item.highlights).slice(0, 3);
}

// A generic stand-in for a structured thickness/wear-layer field we don't
// have yet: any Highlights line that looks like a mil/mm callout. Scans
// all of Highlights, not just the first 3 shown as chips.
function wearLayerFromHighlights(item) {
  return highlightBullets(item.highlights).find(s => /\d\s?(mil|mm)\b/i.test(s)) || "";
}

function photoBlock(item) {
  if (!item.photos || item.photos.length === 0) {
    return `<div class="product-photo main-photo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 3v18"/></svg>
    </div>`;
  }
  const main = item.photos[0];
  const thumbs = item.photos.length > 1
    ? `<div class="thumb-row">${item.photos.map((p, i) =>
        `<img class="thumb${i === 0 ? " active" : ""}" src="${p}" data-full="${p}" alt="">`).join("")}</div>`
    : "";
  return `<div class="product-photo main-photo" style="background-image:url('${main}'); background-size:cover; background-position:center;" data-main-photo></div>${thumbs}`;
}

// Out-of-stock items are never hidden here — they're shown with a
// disabled "Out of Stock" pill instead of the Text button (see
// actionButtons below). In practice most such rows likely won't reach
// this site at all once the Apps Script export rule (Post to Website =
// Yes AND Quantity Available > 0) is in place, but this costs nothing.
function statusBadge(item) {
  if (!isAvailable(item)) return `<span class="badge badge-sold">Out of Stock</span>`;
  return item.isNew ? `<span class="badge badge-new">New</span>` : "";
}

// Builds the prefilled "Text about this item" SMS body — always includes
// the product name and its SKU (Product Key, falling back to the Airtable
// record id) so a reply doesn't require looking anything up.
function smsMessageForItem(item) {
  const sku = item.productKey || item.id;
  return `Hi, I'm interested in ${item.name} (SKU: ${sku}). Is it still available?`;
}

// Single CTA per card, per the compact card design — no secondary button,
// no on-site form. Opens the visitor's SMS app with a prefilled message.
// Out-of-stock items keep the card visible but swap the CTA for a
// disabled pill instead.
function actionButtons(item) {
  if (!isAvailable(item)) {
    return `<span class="btn btn-outline btn-small btn-block" style="opacity:.5; cursor:default;">Out of Stock</span>`;
  }
  const phoneHref = window.SITE_CONFIG ? window.SITE_CONFIG.phoneHref : "";
  const smsHref = `sms:${phoneHref}?&body=${encodeURIComponent(smsMessageForItem(item))}`;
  return `<a href="${smsHref}" class="btn btn-dark btn-small btn-block">Text About This Item</a>`;
}

// Price block format depends on Unit Type:
//   sq ft  -> "$2.01 / sq ft" then "$42.11 / box · 49 boxes / 1,026 sq ft available"
//   each   -> "$649 each"     then "Retail $1,049 · 2 available"
//   box    -> "$42.11 / box"  then "Retail $89.00 · 12 boxes available"
//   roll   -> "$42.11 / roll" then "Retail $89.00 · 12 rolls available"
function priceBlock(item) {
  if (item.sellUnit === "sq ft" && typeof item.price === "number") {
    const boxes = boxesAvailable(item);
    const subParts = [];
    if (typeof item.boxPrice === "number") subParts.push(`${money2(item.boxPrice)} / box`);
    if (boxes !== null) subParts.push(`${boxes} boxes`);
    if (typeof item.availableSqFt === "number") subParts.push(`${sqFtAvailable(item.availableSqFt)} sq ft available`);
    return `<div class="product-price product-price-flooring">
      <div class="price-line">${money2(item.price)} <span class="price-unit">/ sq ft</span></div>
      ${subParts.length ? `<div class="price-avail">${subParts.join(" &middot; ")}</div>` : ""}
    </div>`;
  }

  const perUnitLabels = { box: "/ box", roll: "/ roll" };
  const pluralWords = { box: " boxes", roll: " rolls" };
  const unitLabel = perUnitLabels[item.sellUnit] || "each";
  const isPerUnit = item.sellUnit === "box" || item.sellUnit === "roll";
  const priceText = isPerUnit && typeof item.price === "number" ? money2(item.price) : money(item.price);
  const availParts = [];
  if (typeof item.wasPrice === "number") availParts.push(`Retail ${money(item.wasPrice)}`);
  if (typeof item.qtyAvailable === "number") availParts.push(`${item.qtyAvailable}${pluralWords[item.sellUnit] || ""} available`);
  return `<div class="product-price">
    <div class="price-line">${priceText} <span class="price-unit">${unitLabel}</span></div>
    ${availParts.length ? `<div class="price-avail">${availParts.join(" &middot; ")}</div>` : ""}
  </div>`;
}

// Compact card: square image -> category (+ subcategory, if set) -> name
// -> up to 3 chips (from the first Highlights lines) -> price ->
// availability line -> one CTA. Long copy (Description, remaining
// Highlights, a product reference link) moves into a collapsed <details>
// section instead of living on the card.
function productCard(item) {
  const chips = cardChips(item);
  const moreBullets = highlightBullets(item.highlights).slice(chips.length);
  const hasMore = Boolean(item.description) || moreBullets.length > 0 || Boolean(item.productUrl);
  const categoryLabel = item.webSubcategory ? `${item.webCategory} &middot; ${item.webSubcategory}` : item.webCategory;
  return `
  <div class="product-card" data-category="${item.webCategory}">
    <div class="photo-wrap">
      ${photoBlock(item)}
      ${statusBadge(item)}
    </div>
    <div class="product-info">
      <span class="product-cat">${categoryLabel}</span>
      <h4>${item.name}</h4>
      ${chips.length ? `<div class="spec-chips">${chips.map(c => `<span class="spec-chip">${c}</span>`).join("")}</div>` : ""}
      ${priceBlock(item)}
      ${hasMore ? `<details class="product-more">
        <summary>More details</summary>
        ${item.description ? `<p class="product-desc">${item.description}</p>` : ""}
        ${moreBullets.length ? `<ul class="product-details">${moreBullets.map(b => `<li>${b}</li>`).join("")}</ul>` : ""}
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
        if (main) main.style.backgroundImage = `url('${thumb.getAttribute("data-full")}')`;
      });
    });
  });
}

function renderGrid(items, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = items.length
    ? items.map(productCard).join("")
    : `<p class="catalog-empty">No matching items right now — check back soon or text us what you're looking for.</p>`;
  bindThumbClicks(el);
}

// ---------------------------------------------------------------------
// Homepage "New This Week": deliberately mixes categories rather than
// just showing whatever's newest — 2 Flooring, 1 Appliances, 1 Water
// Heaters when available, topped up with other new/in-stock items so the
// section never looks sparse just because one category is thin that week.
// ---------------------------------------------------------------------
function newFirst(items) {
  return items.slice().sort((a, b) => (b.isNew === a.isNew ? 0 : b.isNew ? 1 : -1));
}

function pickNewArrivals(items, targetCount) {
  // The homepage promo strip only ever shows available items — Reserved/
  // Sold/Coming Soon items still render in the Shop grid (with a status
  // pill), just not here.
  const available = items.filter(isAvailable);
  const byCategory = cat => newFirst(available.filter(i => i.webCategory === cat));
  const picks = [
    ...byCategory("Flooring").slice(0, 2),
    ...byCategory("Appliances").slice(0, 1),
    ...byCategory("Water Heaters").slice(0, 1),
  ];
  const usedIds = new Set(picks.map(i => i.id));

  if (picks.length < targetCount) {
    for (const item of newFirst(available)) {
      if (picks.length >= targetCount) break;
      if (usedIds.has(item.id)) continue;
      picks.push(item);
      usedIds.add(item.id);
    }
  }
  return picks;
}

// ---------------------------------------------------------------------
// Shop page: category tabs + brand/subcategory filters + sort + search,
// over the array already fetched by fetchInventory() — no extra Airtable
// calls. Flooring renders as a contractor-style table; every other
// category renders as the standard card grid — see renderShopCatalog().
// ---------------------------------------------------------------------
let shopItems = [];
let itemsById = {};
let currentCategory = "all";
let currentSort = "featured";
let currentSearch = "";
let currentBrand = "";
let currentSubcategory = "";
let currentWearLayer = "";

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

// The Flooring Calculator is primarily useful for flooring — keep it visible
// whenever Flooring items are in view (the "All" filter included) and hide
// it for categories where a sq ft estimate doesn't apply.
function updateCalcButtonVisibility() {
  const btn = document.getElementById("calc-open-btn");
  if (!btn) return;
  btn.style.display = (currentCategory === "all" || isFlooringView()) ? "" : "none";
}

// Rebuilds the Brand / Subcategory / Wear Layer filter <select> options
// from whatever's actually present in the current category — so a
// dropdown never offers an option with zero matching items.
function updateFacetFilterOptions(categoryItems) {
  const brandSelect = document.getElementById("brand-filter");
  const subcategorySelect = document.getElementById("subcategory-filter");
  const wearSelect = document.getElementById("wear-layer-filter");

  if (brandSelect) {
    const brands = [...new Set(categoryItems.map(i => i.brand).filter(Boolean))].sort();
    if (!brands.includes(currentBrand)) currentBrand = "";
    brandSelect.innerHTML = `<option value="">All Brands</option>` + brands.map(b => `<option value="${b}">${b}</option>`).join("");
    brandSelect.value = currentBrand;
  }
  if (subcategorySelect) {
    const subcategories = [...new Set(categoryItems.map(i => i.webSubcategory).filter(Boolean))].sort();
    if (!subcategories.includes(currentSubcategory)) currentSubcategory = "";
    subcategorySelect.innerHTML = `<option value="">All Subcategories</option>` + subcategories.map(s => `<option value="${s}">${s}</option>`).join("");
    subcategorySelect.value = currentSubcategory;
  }
  if (wearSelect) {
    const wears = [...new Set(categoryItems.map(wearLayerFromHighlights).filter(Boolean))].sort();
    if (!wears.includes(currentWearLayer)) currentWearLayer = "";
    wearSelect.innerHTML = `<option value="">Any Thickness / Wear Layer</option>` + wears.map(w => `<option value="${w}">${w}</option>`).join("");
    wearSelect.value = currentWearLayer;
  }
}

// Flooring gets its own filter row (thickness/wear layer) instead of the
// generic Brand/Spec row every other category uses, and renders as a
// table instead of the card grid.
function updateViewToggle() {
  const grid = document.getElementById("catalog-grid");
  const tableWrap = document.getElementById("catalog-table-wrap");
  const facetRow = document.getElementById("facet-filter-row");
  const flooringRow = document.getElementById("flooring-filter-row");
  const flooring = isFlooringView();

  if (grid) grid.hidden = flooring;
  if (tableWrap) tableWrap.hidden = !flooring;
  if (facetRow) facetRow.hidden = flooring;
  if (flooringRow) flooringRow.hidden = !flooring;
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

function renderFlooringTable(items) {
  const tbody = document.querySelector("#flooring-table tbody");
  if (!tbody) return;
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-empty">No flooring matches your filters right now — text us what you're looking for.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => {
    const boxes = boxesAvailable(item);
    const wear = wearLayerFromHighlights(item) || "&mdash;";
    const photo = item.photos && item.photos[0] ? item.photos[0] : "";
    return `<tr>
      <td class="table-product-cell">
        <div class="table-product-photo"${photo ? ` style="background-image:url('${photo}');"` : ""}></div>
        <div>
          <div class="table-product-name">${item.name}</div>
          ${item.brand ? `<div class="table-product-sub">${item.brand}</div>` : ""}
        </div>
      </td>
      <td>${item.webSubcategory || "&mdash;"}</td>
      <td>${wear}</td>
      <td>${typeof item.price === "number" ? money2(item.price) : "&mdash;"}</td>
      <td>${typeof item.boxPrice === "number" ? money2(item.boxPrice) : "&mdash;"}</td>
      <td>${boxes !== null ? boxes : "&mdash;"}</td>
      <td>${typeof item.availableSqFt === "number" ? sqFtAvailable(item.availableSqFt) : "&mdash;"}</td>
      <td class="table-actions-cell">
        ${isAvailable(item)
          ? `<button type="button" class="btn btn-dark btn-small btn-quote" data-quote-id="${item.id}">Get a Quote</button>`
          : `<span class="btn btn-outline btn-small" style="opacity:.5; cursor:default;">Out of Stock</span>`}
      </td>
    </tr>`;
  }).join("");
}

function renderShopCatalog() {
  const query = currentSearch.trim().toLowerCase();
  const inCategory = shopItems
    .filter(i => currentCategory === "all" || i.webCategory === currentCategory)
    .filter(i => searchMatches(i, query));

  updateFacetFilterOptions(inCategory);

  if (isFlooringView()) {
    let filtered = inCategory;
    if (currentSubcategory) filtered = filtered.filter(i => i.webSubcategory === currentSubcategory);
    if (currentWearLayer) filtered = filtered.filter(i => wearLayerFromHighlights(i) === currentWearLayer);
    renderFlooringTable(sortItems(filtered, currentSort));
  } else {
    let filtered = inCategory;
    if (currentBrand) filtered = filtered.filter(i => i.brand === currentBrand);
    if (currentSubcategory) filtered = filtered.filter(i => i.webSubcategory === currentSubcategory);
    renderGrid(sortItems(filtered, currentSort), "catalog-grid");
  }
  updateViewToggle();
}

// Lets footer/homepage links like shop.html#tools preselect a category tab.
const CATEGORY_SLUGS = {
  "flooring": "Flooring",
  "water-heaters": "Water Heaters",
  "appliances": "Appliances",
  "plumbing-bath": "Plumbing & Bath",
  "lawn-outdoor": "Lawn & Outdoor",
  "tools": "Tools",
  "home-improvement": "Home Improvement",
};

function applyCategoryFromHash() {
  const slug = window.location.hash.replace("#", "");
  const category = CATEGORY_SLUGS[slug];
  if (!category) return;
  currentCategory = category;
  document.querySelectorAll(".filter-btn").forEach(b => {
    b.classList.toggle("active", b.getAttribute("data-filter") === category);
  });
}

function initShopControls(items) {
  shopItems = items;
  itemsById = {};
  items.forEach(i => { itemsById[i.id] = i; });

  applyCategoryFromHash();

  const filterBtns = document.querySelectorAll(".filter-btn");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentCategory = btn.getAttribute("data-filter");
      currentBrand = "";
      currentSubcategory = "";
      currentWearLayer = "";
      updateSortOptionsVisibility();
      updateCalcButtonVisibility();
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

  const brandSelect = document.getElementById("brand-filter");
  if (brandSelect) {
    brandSelect.addEventListener("change", () => {
      currentBrand = brandSelect.value;
      renderShopCatalog();
    });
  }
  const subcategorySelect = document.getElementById("subcategory-filter");
  if (subcategorySelect) {
    subcategorySelect.addEventListener("change", () => {
      currentSubcategory = subcategorySelect.value;
      renderShopCatalog();
    });
  }
  const wearSelect = document.getElementById("wear-layer-filter");
  if (wearSelect) {
    wearSelect.addEventListener("change", () => {
      currentWearLayer = wearSelect.value;
      renderShopCatalog();
    });
  }

  const searchInput = document.getElementById("search-input");
  const searchClear = document.getElementById("search-clear");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      currentSearch = searchInput.value;
      if (searchClear) searchClear.hidden = currentSearch.length === 0;
      renderShopCatalog();
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", () => {
      currentSearch = "";
      if (searchInput) { searchInput.value = ""; searchInput.focus(); }
      searchClear.hidden = true;
      renderShopCatalog();
    });
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quote-id]");
    if (btn) openQuoteModal(itemsById[btn.getAttribute("data-quote-id")]);
  });
  bindQuoteModal();
  bindCalculatorModal();

  updateSortOptionsVisibility();
  updateCalcButtonVisibility();
  renderShopCatalog();
}

// ---------------------------------------------------------------------
// Get a Quote modal — used only for Flooring's contractor table, where a
// sq-ft-needed quote makes sense. Submits to the "quote-request" Netlify
// Form via fetch, so the page never navigates away. See the static hidden
// form in shop.html for the field list Netlify expects.
// ---------------------------------------------------------------------
function quotePriceText(item) {
  if (item.sellUnit === "sq ft" && typeof item.price === "number") {
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

  document.getElementById("calc-open-btn")?.addEventListener("click", () => openCalculatorModal(false));
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

async function initInventory() {
  const items = await fetchInventory();

  // Shop page: full catalog (filtering + sorting handled together)
  if (document.getElementById("catalog-grid")) {
    initShopControls(items);
  }

  // Home page: New This Week (mixed categories, see pickNewArrivals)
  if (document.getElementById("new-arrivals-grid")) {
    const picks = pickNewArrivals(items, 4);
    const fallback = picks.length ? picks : items.slice(0, 4);
    renderGrid(fallback, "new-arrivals-grid");
  }
}

document.addEventListener("DOMContentLoaded", initInventory);

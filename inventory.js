/* ===================================================================
   Invicta Home Supply — inventory (Airtable-backed catalog)

   STAGED MIGRATION IN PROGRESS. Source of truth for product data is the
   Google Sheet Product Catalog -> Website Export -> Airtable -> this site.
   Airtable is a synced mirror, not the source of truth — new fields (Web
   Category, Sell Unit, Specs, Web Status, Quantity Available) must be
   added in Product Catalog and carried through Website Export and the
   Apps Script/Airtable payload, or the next sync can overwrite/ignore
   them. See README for the exact Sheet columns and export mapping.

   Until every row has been migrated, "Post to Website" (not Web Category
   or Web Status) is the publish gate, and every field below has a
   fallback so a row missing the new columns still displays instead of
   disappearing — see resolveWebCategory()/resolveWebStatus() and the
   Sell Unit inference below.

   Inventory data is fetched from the /api/inventory serverless function,
   which holds the Airtable credentials server-side (Netlify environment
   variables) — nothing sensitive lives in this file or in git.
   Until that function returns data, the site shows sample placeholder
   items so it never looks broken.
   =================================================================== */
window.AIRTABLE_CONFIG = {
  cacheMinutes: 15,
};

const CACHE_KEY = "invicta_inventory_cache_v3";
const INVENTORY_ENDPOINT = "/api/inventory";

// The 7 public-facing website categories. Every item is resolved to one of
// these (see resolveWebCategory) even when Web Category is still blank, so
// a not-yet-migrated row never vanishes — it just lands in a fallback tab
// until it's explicitly categorized upstream in Product Catalog.
const WEB_CATEGORIES = [
  "Flooring",
  "Water Heaters",
  "Appliances",
  "Plumbing & Bath",
  "Lawn & Outdoor",
  "Tools",
  "Home Improvement",
];

// Legacy internal Category values (pre-migration) mapped to their closest
// new web category. Anything not listed here (including blank) falls back
// to "Home Improvement" — the broadest catch-all — rather than being hidden.
// Temporary: remove once every row has a real Web Category from Product Catalog.
const LEGACY_CATEGORY_FALLBACK = {
  "Flooring": "Flooring",
  "Appliances": "Appliances",
  "Tools": "Tools",
};

function resolveWebCategory(f) {
  const webCategory = (f["Web Category"] || "").trim();
  if (WEB_CATEGORIES.includes(webCategory)) return webCategory;
  const legacy = (f["Category"] || "").trim();
  return LEGACY_CATEGORY_FALLBACK[legacy] || "Home Improvement";
}

// Legacy internal Status values mapped onto the new Web Status vocabulary.
// Temporary: remove once every row has a real Web Status from Product Catalog.
const LEGACY_STATUS_FALLBACK = {
  "In Stock": "In Stock",
  "Reserved": "Reserved",
  "Sold Out": "Sold",
  "Sold": "Sold",
};

function resolveWebStatus(f) {
  const webStatus = (f["Web Status"] || "").trim();
  if (webStatus) return webStatus;
  const legacy = (f["Status"] || "").trim();
  return LEGACY_STATUS_FALLBACK[legacy] || "In Stock";
}

function isAvailable(item) {
  return item.webStatus === "In Stock";
}

// Maps one raw Airtable record into the shape the rest of this file uses.
// Every new field has a fallback so a row that predates the Web
// Category/Sell Unit/Specs/Web Status/Quantity Available migration still
// renders correctly instead of disappearing or crashing.
function mapAirtableRecord(id, f) {
  const dateAdded = f["Date Added"] ? new Date(f["Date Added"]) : null;
  const webCategory = resolveWebCategory(f);
  return {
    id,
    productKey: f["Product Key"] || "",
    name: f["Name"] || "Untitled item",
    webCategory,
    sellUnit: f["Sell Unit"] || (webCategory === "Flooring" ? "sq ft" : "each"),
    specs: f["Specs"] || "",
    brand: f["Brand"] || "",
    model: f["Model"] || "",
    retailer: f["Retailer"] || "",
    price: f["Price"],
    wasPrice: f["Was Price"],
    qtyAvailable: f["Quantity Available"],
    boxPrice: f["Box Price"],
    sqFtPerUnit: f["Sq Ft Per Unit"],
    availableSqFt: f["Available Sq Ft"],
    details: f["Details"] || "",
    highlights: f["Highlights"] || "",
    webStatus: resolveWebStatus(f),
    photos: (f["Photos"] || []).map(p => p.url),
    isNew: dateAdded ? (Date.now() - dateAdded.getTime()) / 86400000 <= 7 : false,
  };
}

// Shown automatically until the Airtable function returns real records —
// replace by adding real rows in the Product Catalog sheet, not by editing
// this list. Deliberately spans multiple categories so the mixed layouts
// (New This Week, category tiles, shop tabs) all have something to show.
// The first 8 represent the fully-migrated future state; the last 2 are
// raw, pre-migration-shaped records run through mapAirtableRecord() so the
// staged-migration fallbacks are visibly exercised, not just unit logic.
const FALLBACK_ITEMS = [
  { id: "sample-1", name: "Waterproof Oak Plank Flooring", webCategory: "Flooring", brand: "Invicta Floors", sellUnit: "sq ft", price: 2.01, boxPrice: 42.11, sqFtPerUnit: 20.94, availableSqFt: 1026, specs: "22 MIL|Waterproof|Click-lock", details: "Brand new, never used.", highlights: "22mil wear layer\nClicklock installation\n~20.94 sq ft per box", webStatus: "In Stock", photos: [], isNew: true },
  { id: "sample-2", name: "Rustic Pine Waterproof Plank", webCategory: "Flooring", brand: "Invicta Floors", sellUnit: "sq ft", price: 1.79, boxPrice: 38.36, sqFtPerUnit: 21.43, availableSqFt: 815, specs: "12 MIL|Waterproof|Click-lock", details: "Brand new, never used.", highlights: "12mil wear layer\nWaterproof core\nPickup only", webStatus: "In Stock", photos: [], isNew: true },
  { id: "sample-3", name: "50-Gallon Gas Water Heater", webCategory: "Water Heaters", brand: "Rheem", sellUnit: "each", price: 649, wasPrice: 1049, qtyAvailable: 2, specs: "50 gal|Natural gas|Rheem", details: "Brand new, factory sealed.", highlights: "6-year tank warranty\nEnergy Star rated", webStatus: "In Stock", photos: [], isNew: true },
  { id: "sample-4", name: "Stainless French Door Refrigerator", webCategory: "Appliances", brand: "Samsung", sellUnit: "each", price: 1350, wasPrice: 2199, qtyAvailable: 1, specs: "27 cu ft|French door|Stainless", details: "Brand new, minor box damage only.", highlights: "Ice maker included\nManufacturer warranty applies", webStatus: "In Stock", photos: [] },
  { id: "sample-5", name: "Undermount Kitchen Sink, Stainless", webCategory: "Plumbing & Bath", brand: "Kraus", sellUnit: "each", price: 120, wasPrice: 240, qtyAvailable: 4, specs: "Stainless|Undermount|32 in", details: "Brand new, never used.", highlights: "Includes mounting hardware", webStatus: "In Stock", photos: [] },
  { id: "sample-6", name: "Self-Propelled Gas Mower, 21 in", webCategory: "Lawn & Outdoor", brand: "Honda", sellUnit: "each", price: 429, wasPrice: 599, qtyAvailable: 3, specs: "21 in|Self-propelled|Gas", details: "Brand new, factory sealed.", highlights: "Mulch/bag/side-discharge 3-in-1", webStatus: "In Stock", photos: [] },
  { id: "sample-7", name: "18V Cordless Drill Kit, 2 Batteries", webCategory: "Tools", brand: "DeWalt", sellUnit: "each", price: 89, wasPrice: 149, qtyAvailable: 6, specs: "18V|2 batteries|Brushless", details: "Brand new, never used.", highlights: "Includes both batteries + charger", webStatus: "In Stock", photos: [] },
  { id: "sample-8", name: "Matte Black Barn Door Hardware Kit", webCategory: "Home Improvement", brand: "", sellUnit: "each", price: 65, wasPrice: 120, qtyAvailable: 5, specs: "6.6 ft track|Matte black|Soft-close", details: "Brand new, factory sealed.", highlights: "Fits doors up to 36 in wide", webStatus: "In Stock", photos: [] },
  // Pre-migration rows: no Web Category/Sell Unit/Specs/Web Status/Quantity
  // Available yet, only the legacy Category/Status fields — proves these
  // still show up (Flooring fallback, sq ft inferred; Reserved shown with
  // a disabled pill, not hidden).
  mapAirtableRecord("legacy-1", { "Name": "Legacy Oak Laminate (unmigrated row)", "Category": "Flooring", "Price": 1.65, "Status": "In Stock" }),
  mapAirtableRecord("legacy-2", { "Name": "Legacy Cordless Trimmer (unmigrated row)", "Category": "Renovation Supplies", "Price": 45, "Status": "Reserved" }),
];

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
    const items = records.map(r => mapAirtableRecord(r.id, r.fields || {}));

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

// Specs is a single "|"-separated field (e.g. "22 MIL|Waterproof|Click-lock")
// — split into at most 3 short chips for the card.
function specsArray(item) {
  if (!item.specs) return [];
  return item.specs.split("|").map(s => s.trim()).filter(Boolean).slice(0, 3);
}

// A generic stand-in for per-category structured filters (capacity, fuel
// type, voltage, wear layer...) we don't have dedicated Airtable columns
// for yet: any spec chip that looks like a thickness/wear-layer callout.
function wearLayerSpec(item) {
  return specsArray(item).find(s => /\d\s?(mil|mm)\b/i.test(s)) || "";
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

// Not-yet-available items are never hidden during the staged migration —
// they're shown with a status pill instead of the Text button (see
// actionButtons below), same as the site's pre-migration behavior.
function statusBadge(item) {
  if (!isAvailable(item)) {
    const cls = item.webStatus === "Sold" ? "badge-sold" : item.webStatus === "Coming Soon" ? "badge-new" : "badge-reserved";
    return `<span class="badge ${cls}">${item.webStatus}</span>`;
  }
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
// Reserved/Sold/Coming Soon items keep the card visible but swap the CTA
// for a disabled status pill instead.
function actionButtons(item) {
  if (!isAvailable(item)) {
    return `<span class="btn btn-outline btn-small btn-block" style="opacity:.5; cursor:default;">${item.webStatus}</span>`;
  }
  const phoneHref = window.SITE_CONFIG ? window.SITE_CONFIG.phoneHref : "";
  const smsHref = `sms:${phoneHref}?&body=${encodeURIComponent(smsMessageForItem(item))}`;
  return `<a href="${smsHref}" class="btn btn-dark btn-small btn-block">Text About This Item</a>`;
}

function highlightBullets(highlights) {
  if (!highlights) return [];
  return highlights.split(/\r?\n/)
    .map(s => s.trim().replace(/^[•●◦∙\-*]\s*/, ""))
    .filter(Boolean);
}

// Price block format depends on Sell Unit:
//   sq ft  -> "$2.01 / sq ft" then "$42.11 / box · 49 boxes / 1,026 sq ft available"
//   each   -> "$649 each"     then "Retail $1,049 · 2 available"
//   box    -> "$42.11 / box"  then "Retail $89.00 · 12 boxes available"
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

  const unitLabel = item.sellUnit === "box" ? "/ box" : "each";
  const priceText = item.sellUnit === "box" && typeof item.price === "number" ? money2(item.price) : money(item.price);
  const availParts = [];
  if (typeof item.wasPrice === "number") availParts.push(`Retail ${money(item.wasPrice)}`);
  if (typeof item.qtyAvailable === "number") availParts.push(`${item.qtyAvailable}${item.sellUnit === "box" ? " boxes" : ""} available`);
  return `<div class="product-price">
    <div class="price-line">${priceText} <span class="price-unit">${unitLabel}</span></div>
    ${availParts.length ? `<div class="price-avail">${availParts.join(" &middot; ")}</div>` : ""}
  </div>`;
}

// Compact card: square image -> category -> name -> up to 3 spec chips ->
// price -> availability line -> one CTA. Long copy (Details/Highlights)
// moves into a collapsed <details> section instead of living on the card.
function productCard(item) {
  const chips = specsArray(item);
  const bullets = highlightBullets(item.highlights);
  const hasMore = Boolean(item.details) || bullets.length > 0;
  return `
  <div class="product-card" data-category="${item.webCategory}">
    <div class="photo-wrap">
      ${photoBlock(item)}
      ${statusBadge(item)}
    </div>
    <div class="product-info">
      <span class="product-cat">${item.webCategory}</span>
      <h4>${item.name}</h4>
      ${chips.length ? `<div class="spec-chips">${chips.map(c => `<span class="spec-chip">${c}</span>`).join("")}</div>` : ""}
      ${priceBlock(item)}
      ${hasMore ? `<details class="product-more">
        <summary>More details</summary>
        ${item.details ? `<p class="product-desc">${item.details}</p>` : ""}
        ${bullets.length ? `<ul class="product-details">${bullets.map(b => `<li>${b}</li>`).join("")}</ul>` : ""}
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
// Shop page: category tabs + brand/spec filters + sort + search, over the
// array already fetched by fetchInventory() — no extra Airtable calls.
// Flooring renders as a contractor-style table; every other category
// renders as the standard card grid — see renderShopCatalog().
// ---------------------------------------------------------------------
let shopItems = [];
let itemsById = {};
let currentCategory = "all";
let currentSort = "featured";
let currentSearch = "";
let currentBrand = "";
let currentSpec = "";
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

// Rebuilds the Brand / Spec / Wear Layer filter <select> options from
// whatever's actually present in the current category — so a dropdown
// never offers an option with zero matching items.
function updateFacetFilterOptions(categoryItems) {
  const brandSelect = document.getElementById("brand-filter");
  const specSelect = document.getElementById("spec-filter");
  const wearSelect = document.getElementById("wear-layer-filter");

  if (brandSelect) {
    const brands = [...new Set(categoryItems.map(i => i.brand).filter(Boolean))].sort();
    if (!brands.includes(currentBrand)) currentBrand = "";
    brandSelect.innerHTML = `<option value="">All Brands</option>` + brands.map(b => `<option value="${b}">${b}</option>`).join("");
    brandSelect.value = currentBrand;
  }
  if (specSelect) {
    const specs = [...new Set(categoryItems.flatMap(specsArray))].sort();
    if (!specs.includes(currentSpec)) currentSpec = "";
    specSelect.innerHTML = `<option value="">All Specs</option>` + specs.map(s => `<option value="${s}">${s}</option>`).join("");
    specSelect.value = currentSpec;
  }
  if (wearSelect) {
    const wears = [...new Set(categoryItems.map(wearLayerSpec).filter(Boolean))].sort();
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

// Search matches Name, Brand, Model, Category, Retailer and Specs, case-
// insensitive. Fields that are blank for a given item are simply skipped.
function searchMatches(item, query) {
  if (!query) return true;
  const haystack = [item.name, item.brand, item.model, item.webCategory, item.retailer, item.specs]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
  return haystack.includes(query);
}

function renderFlooringTable(items) {
  const tbody = document.querySelector("#flooring-table tbody");
  if (!tbody) return;
  if (items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No flooring matches your filters right now — text us what you're looking for.</td></tr>`;
    return;
  }
  tbody.innerHTML = items.map(item => {
    const boxes = boxesAvailable(item);
    const wear = wearLayerSpec(item) || "&mdash;";
    const photo = item.photos && item.photos[0] ? item.photos[0] : "";
    return `<tr>
      <td class="table-product-cell">
        <div class="table-product-photo"${photo ? ` style="background-image:url('${photo}');"` : ""}></div>
        <div>
          <div class="table-product-name">${item.name}</div>
          ${item.brand ? `<div class="table-product-sub">${item.brand}</div>` : ""}
        </div>
      </td>
      <td>${wear}</td>
      <td>${typeof item.price === "number" ? money2(item.price) : "&mdash;"}</td>
      <td>${typeof item.boxPrice === "number" ? money2(item.boxPrice) : "&mdash;"}</td>
      <td>${boxes !== null ? boxes : "&mdash;"}</td>
      <td>${typeof item.availableSqFt === "number" ? sqFtAvailable(item.availableSqFt) : "&mdash;"}</td>
      <td class="table-actions-cell">
        ${isAvailable(item)
          ? `<button type="button" class="btn btn-dark btn-small btn-quote" data-quote-id="${item.id}">Get a Quote</button>`
          : `<span class="btn btn-outline btn-small" style="opacity:.5; cursor:default;">${item.webStatus}</span>`}
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
    const filtered = currentWearLayer ? inCategory.filter(i => specsArray(i).includes(currentWearLayer)) : inCategory;
    renderFlooringTable(sortItems(filtered, currentSort));
  } else {
    let filtered = inCategory;
    if (currentBrand) filtered = filtered.filter(i => i.brand === currentBrand);
    if (currentSpec) filtered = filtered.filter(i => specsArray(i).includes(currentSpec));
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
      currentSpec = "";
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
  const specSelect = document.getElementById("spec-filter");
  if (specSelect) {
    specSelect.addEventListener("change", () => {
      currentSpec = specSelect.value;
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

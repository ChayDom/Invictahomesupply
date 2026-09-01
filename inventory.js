/* ===================================================================
   Invicta Home Supply — inventory (Airtable-backed catalog)

   Inventory data is fetched from the /api/inventory serverless function,
   which holds the Airtable credentials server-side (Netlify environment
   variables) — nothing sensitive lives in this file or in git.
   Until that function returns data, the site shows sample items so it
   never looks broken.
   =================================================================== */
window.AIRTABLE_CONFIG = {
  cacheMinutes: 15,
};

const CACHE_KEY = "invicta_inventory_cache_v1";
const INVENTORY_ENDPOINT = "/api/inventory";

// Shown automatically until the Airtable function returns real records —
// replace by adding real rows in Airtable, not by editing this list.
const FALLBACK_ITEMS = [
  { id: "sample-1", name: "Waterproof Oak Plank Flooring", category: "Flooring", price: 34, wasPrice: 89, details: "Brand new, never used.", highlights: "20mil wear layer\nClicklock installation\n~38 sq ft per box", status: "In Stock", photos: [], isNew: true },
  { id: "sample-2", name: "Ripped Pine Clicklock Plank", category: "Flooring", price: 29, wasPrice: 80, details: "Brand new, never used.", highlights: "5.5mm thickness\nWaterproof core\nPickup only", status: "In Stock", photos: [], isNew: true },
  { id: "sample-3", name: "Undermount Kitchen Sink, Stainless", category: "Renovation Supplies", price: 120, wasPrice: 240, details: "Brand new, never used.", highlights: "Includes mounting hardware", status: "In Stock", photos: [] },
  { id: "sample-4", name: "Butcher Block Countertop, 6ft", category: "Renovation Supplies", price: 95, wasPrice: 210, details: "Brand new, never used.", highlights: "Solid wood\nUnfinished", status: "In Stock", photos: [] },
  { id: "sample-5", name: "Cordless Pet Stick Vacuum, HEPA", category: "Appliances", price: 95, wasPrice: 160, details: "Brand new, never used.", highlights: "Sealed box\nAll attachments included", status: "In Stock", photos: [], isNew: true },
  { id: "sample-6", name: "Robotic 2-in-1 Vacuum & Mop", category: "Appliances", price: 200, wasPrice: 380, details: "Brand new, never used.", highlights: "Sealed box", status: "Reserved", photos: [], daysAgo: 1 },
  { id: "sample-7", name: "18V Cordless Drill Kit, 2 Batteries", category: "Tools", price: 55, wasPrice: 110, details: "Brand new, never used.", highlights: "Includes both batteries", status: "In Stock", photos: [] },
  { id: "sample-8", name: "50-Quart Hard Cooler", category: "Tools", price: 130, wasPrice: 225, details: "Brand new, never used.", highlights: "Factory sealed", status: "Sold Out", photos: [], daysAgo: 3 },
];

function daysAgoLabel(days) {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

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

    const now = Date.now();
    const items = records.map(r => {
      const f = r.fields || {};
      const dateAdded = f["Date Added"] ? new Date(f["Date Added"]) : null;
      const dateReserved = f["Date Reserved"] ? new Date(f["Date Reserved"]) : null;
      return {
        id: r.id,
        productKey: f["Product Key"] || "",
        name: f["Name"] || "Untitled item",
        category: f["Category"] || "Other",
        brand: f["Brand"] || "",
        model: f["Model"] || "",
        retailer: f["Retailer"] || "",
        price: f["Price"],
        wasPrice: f["Was Price"],
        boxPrice: f["Box Price"],
        sqFtPerUnit: f["Sq Ft Per Unit"],
        availableSqFt: f["Available Sq Ft"],
        details: f["Details"] || "",
        highlights: f["Highlights"] || "",
        status: f["Status"] || "In Stock",
        photos: (f["Photos"] || []).map(p => p.url),
        isNew: dateAdded ? (now - dateAdded.getTime()) / 86400000 <= 7 : false,
        daysAgo: dateReserved ? Math.floor((now - dateReserved.getTime()) / 86400000) : null,
      };
    });

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

// 2-decimal currency, used only for the flooring per-sq-ft/per-box pricing block.
function money2(n) {
  return typeof n === "number" ? `$${n.toFixed(2)}` : "";
}

// Fixed 2-decimal sq ft figure (e.g. "24.03"), used for the per-box coverage.
function sqFt2(n) {
  return typeof n === "number" ? n.toFixed(2) : "";
}

// Thousands-separated sq ft total; only shows decimals when the value actually has them.
function sqFtAvailable(n) {
  return typeof n === "number" ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : "";
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

function statusBadge(item) {
  if (item.status === "In Stock") return item.isNew ? `<span class="badge badge-new">New</span>` : "";
  const cls = item.status === "Reserved" ? "badge-reserved" : "badge-sold";
  return `<span class="badge ${cls}">${item.status}</span>`;
}

// Builds the prefilled "Text Us" SMS body for a product. Flooring items get
// the per-sq-ft/per-box wording; everything else gets the simpler single
// price line. Never includes Available Sq Ft — inventory can change.
function smsMessageForItem(item) {
  const isFlooringPriced = item.category === "Flooring"
    && typeof item.price === "number"
    && typeof item.boxPrice === "number";

  if (isFlooringPriced) {
    return `Hi, I'm interested in ${item.name}. I saw it on your website for ${money2(item.price)}/sq ft (${money2(item.boxPrice)}/box). Please send me more information.`;
  }

  const priceText = typeof item.price === "number" ? ` listed for ${money(item.price)}` : "";
  return `Hi, I'm interested in ${item.name}${priceText}. Please send me more information.`;
}

// Two CTAs for an in-stock item: "Get a Quote" (primary — for Flooring,
// opens the on-site quote modal via data-quote-id; other categories keep
// the plain button for now) and "Text Us" (secondary, functional — opens
// the visitor's SMS app with a prefilled, product-specific message via the
// existing business phone number in SITE_CONFIG). Out-of-stock items keep
// the old status pill.
function actionButtons(item) {
  if (item.status !== "In Stock") {
    return `<span class="btn btn-outline btn-small" style="opacity:.5; cursor:default;">${item.status}</span>`;
  }
  const phoneHref = window.SITE_CONFIG ? window.SITE_CONFIG.phoneHref : "";
  const smsHref = `sms:${phoneHref}?&body=${encodeURIComponent(smsMessageForItem(item))}`;
  const quoteAttr = item.category === "Flooring" ? `data-quote-id="${item.id}"` : `data-quote-item="${item.name}"`;
  return `
    <button type="button" class="btn btn-dark btn-small btn-quote" ${quoteAttr}>Get a Quote</button>
    <a href="${smsHref}" class="btn btn-outline btn-small">Text Us</a>
  `;
}

function highlightBullets(highlights) {
  if (!highlights) return [];
  return highlights.split(/\r?\n/)
    .map(s => s.trim().replace(/^[•●◦∙\-*]\s*/, ""))
    .filter(Boolean);
}

// Flooring gets a per-sq-ft / per-box / available-sq-ft breakdown instead of
// a single price, but only when Airtable actually supplies all four fields —
// otherwise it falls back to the normal single-price display below.
function priceBlock(item) {
  const isFlooring = item.category === "Flooring"
    && typeof item.price === "number"
    && typeof item.boxPrice === "number"
    && typeof item.sqFtPerUnit === "number"
    && typeof item.availableSqFt === "number";

  if (isFlooring) {
    return `<div class="product-price product-price-flooring">
      <div class="price-line">${money2(item.price)} <span class="price-unit">/ sq ft</span></div>
      <div class="price-sub"><span class="price-bold">${money2(item.boxPrice)} / box</span> &middot; ${sqFt2(item.sqFtPerUnit)} sq ft/box</div>
      <div class="price-avail">${sqFtAvailable(item.availableSqFt)} sq ft available</div>
    </div>`;
  }

  return `<div class="product-price">${money(item.price)} ${item.wasPrice ? `<span class="was">${money(item.wasPrice)}</span>` : ""}</div>`;
}

function productCard(item) {
  const bullets = highlightBullets(item.highlights);
  return `
  <div class="product-card" data-category="${item.category}">
    <div class="photo-wrap">
      ${photoBlock(item)}
      ${statusBadge(item)}
    </div>
    <div class="product-info">
      <span class="product-cat">${item.category}</span>
      <h4>${item.name}</h4>
      ${item.details ? `<p class="product-desc">${item.details}</p>` : ""}
      ${bullets.length ? `<ul class="product-details">${bullets.map(b => `<li>${b}</li>`).join("")}</ul>` : ""}
      ${priceBlock(item)}
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
  el.innerHTML = items.map(productCard).join("");
  bindThumbClicks(el);
}

function renderReservedTicker(items, containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const recent = items
    .filter(i => i.status !== "In Stock" && i.daysAgo !== null && i.daysAgo <= 14)
    .sort((a, b) => a.daysAgo - b.daysAgo)
    .slice(0, 6);
  if (recent.length === 0) {
    el.closest("section")?.setAttribute("style", "display:none;");
    return;
  }
  el.innerHTML = recent.map(i =>
    `<div class="ticker-item"><strong>${i.name}</strong> — ${i.status.toLowerCase()} ${daysAgoLabel(i.daysAgo)}</div>`
  ).join("");
}

// ---------------------------------------------------------------------
// Shop page: category filter + sort. Sorting is client-side only, over
// the array already fetched by fetchInventory() — no extra Airtable calls.
// ---------------------------------------------------------------------
let shopItems = [];
let itemsById = {};
let currentCategory = "all";
let currentSort = "featured";
let currentSearch = "";

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

// Sq Ft Available sort options only make sense for Flooring — add/remove
// them from the <select> based on the active category filter, and fall
// back to Featured if an sqft sort was active when the category changed.
function updateSortOptionsVisibility() {
  const select = document.getElementById("sort-select");
  if (!select) return;
  const showSqft = currentCategory === "Flooring";
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
  btn.style.display = (currentCategory === "all" || currentCategory === "Flooring") ? "" : "none";
}

// Search matches Name, Brand, Model, Category and Retailer, case-insensitive.
// Fields that are blank for a given item (Brand/Model/Retailer are optional
// in Airtable) are simply skipped — no data means no match on that field.
function searchMatches(item, query) {
  if (!query) return true;
  const haystack = [item.name, item.brand, item.model, item.category, item.retailer]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();
  return haystack.includes(query);
}

function renderShopCatalog() {
  const query = currentSearch.trim().toLowerCase();
  const filtered = shopItems
    .filter(i => currentCategory === "all" || i.category === currentCategory)
    .filter(i => searchMatches(i, query));
  renderGrid(sortItems(filtered, currentSort), "catalog-grid");
}

function initShopControls(items) {
  shopItems = items;
  itemsById = {};
  items.forEach(i => { itemsById[i.id] = i; });

  const filterBtns = document.querySelectorAll(".filter-btn");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentCategory = btn.getAttribute("data-filter");
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

  const catalogGrid = document.getElementById("catalog-grid");
  if (catalogGrid) {
    catalogGrid.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-quote-id]");
      if (btn) openQuoteModal(itemsById[btn.getAttribute("data-quote-id")]);
    });
  }
  bindQuoteModal();
  bindCalculatorModal();

  updateSortOptionsVisibility();
  updateCalcButtonVisibility();
  renderShopCatalog();
}

// ---------------------------------------------------------------------
// Get a Quote modal (Flooring products). Carries the selected product's
// name/price into the modal and submits to the "quote-request" Netlify
// Form via fetch, so the page never navigates away. See the static hidden
// form in shop.html for the field list Netlify expects.
// ---------------------------------------------------------------------
function isFlooringPriced(item) {
  return item.category === "Flooring" && typeof item.price === "number" && typeof item.boxPrice === "number";
}

function quotePriceText(item) {
  if (isFlooringPriced(item)) {
    return `${money2(item.price)} / sq ft · ${money2(item.boxPrice)} / box`;
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

  // Home page: New This Week
  if (document.getElementById("new-arrivals-grid")) {
    const fresh = items.filter(i => i.isNew && i.status === "In Stock").slice(0, 8);
    const fallback = fresh.length ? fresh : items.filter(i => i.status === "In Stock").slice(0, 4);
    renderGrid(fallback, "new-arrivals-grid");
  }

  // Home page: Recently Reserved ticker
  if (document.getElementById("reserved-ticker")) {
    renderReservedTicker(items, "reserved-ticker");
  }
}

document.addEventListener("DOMContentLoaded", initInventory);

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
        name: f["Name"] || "Untitled item",
        category: f["Category"] || "Other",
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

// Two CTAs for an in-stock item: "Get a Quote" (primary, opens the on-site
// quote flow — not yet wired up pending the form/backend decision) and
// "Text Us" (secondary, functional now — opens the visitor's SMS app with a
// prefilled, product-specific message via the existing business phone
// number in SITE_CONFIG). Out-of-stock items keep the old status pill.
function actionButtons(item) {
  if (item.status !== "In Stock") {
    return `<span class="btn btn-outline btn-small" style="opacity:.5; cursor:default;">${item.status}</span>`;
  }
  const phoneHref = window.SITE_CONFIG ? window.SITE_CONFIG.phoneHref : "";
  const smsHref = `sms:${phoneHref}?&body=${encodeURIComponent(smsMessageForItem(item))}`;
  return `
    <button type="button" class="btn btn-dark btn-small btn-quote" data-quote-item="${item.name}">Get a Quote</button>
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
let currentCategory = "all";
let currentSort = "featured";

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

function renderShopCatalog() {
  const filtered = currentCategory === "all"
    ? shopItems
    : shopItems.filter(i => i.category === currentCategory);
  renderGrid(sortItems(filtered, currentSort), "catalog-grid");
}

function initShopControls(items) {
  shopItems = items;

  const filterBtns = document.querySelectorAll(".filter-btn");
  filterBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      filterBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentCategory = btn.getAttribute("data-filter");
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

  updateSortOptionsVisibility();
  renderShopCatalog();
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

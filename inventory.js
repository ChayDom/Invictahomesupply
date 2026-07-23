/* ===================================================================
   Invicta Home Supply — inventory (Airtable-backed catalog)

   EDIT THIS BLOCK once you've created your Airtable base (see README).
   Until you do, the site automatically shows sample items so it never
   looks broken.
   =================================================================== */
window.AIRTABLE_CONFIG = {
  baseId: "apptugvm4r5tm2OIt",
  tableName: "Inventory",
  token: "patvidXdY4WP6L1kw.ff2ac97dc5ee845f0d848d7434e9a321c56ed98b7168741dbe0a3dc728ccb56b",
  cacheMinutes: 15,
};

const CACHE_KEY = "invicta_inventory_cache_v1";

// Shown automatically until AIRTABLE_CONFIG is filled in — replace by
// adding real rows in Airtable, not by editing this list.
const FALLBACK_ITEMS = [
  { id: "sample-1", name: "Waterproof Oak Plank Flooring", category: "Flooring", price: 34, wasPrice: 89, details: "Brand new, 20mil wear layer, clicklock, ~38 sq ft per box.", status: "In Stock", photos: [], isNew: true },
  { id: "sample-2", name: "Ripped Pine Clicklock Plank", category: "Flooring", price: 29, wasPrice: 80, details: "Brand new, 5.5mm, waterproof, pickup only.", status: "In Stock", photos: [], isNew: true },
  { id: "sample-3", name: "Undermount Kitchen Sink, Stainless", category: "Renovation Supplies", price: 120, wasPrice: 240, details: "Brand new, includes mounting hardware.", status: "In Stock", photos: [] },
  { id: "sample-4", name: "Butcher Block Countertop, 6ft", category: "Renovation Supplies", price: 95, wasPrice: 210, details: "Brand new, solid wood, unfinished.", status: "In Stock", photos: [] },
  { id: "sample-5", name: "Cordless Pet Stick Vacuum, HEPA", category: "Appliances", price: 95, wasPrice: 160, details: "Brand new, sealed box, all attachments included.", status: "In Stock", photos: [], isNew: true },
  { id: "sample-6", name: "Robotic 2-in-1 Vacuum & Mop", category: "Appliances", price: 200, wasPrice: 380, details: "Brand new, sealed box.", status: "Reserved", photos: [], daysAgo: 1 },
  { id: "sample-7", name: "18V Cordless Drill Kit, 2 Batteries", category: "Tools", price: 55, wasPrice: 110, details: "Brand new, includes both batteries.", status: "In Stock", photos: [] },
  { id: "sample-8", name: "50-Quart Hard Cooler", category: "Tools", price: 130, wasPrice: 225, details: "Brand new, factory sealed.", status: "Sold Out", photos: [], daysAgo: 3 },
];

function isConfigured() {
  const c = window.AIRTABLE_CONFIG;
  return c.baseId && !c.baseId.startsWith("YOUR_") && c.token && !c.token.startsWith("YOUR_");
}

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

  if (!isConfigured()) return FALLBACK_ITEMS;

  try {
    const { baseId, tableName, token } = window.AIRTABLE_CONFIG;
    let records = [];
    let offset;
    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
      if (offset) url.searchParams.set("offset", offset);
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error(`Airtable request failed: ${res.status}`);
      const json = await res.json();
      records = records.concat(json.records);
      offset = json.offset;
    } while (offset);

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
        details: f["Details"] || "",
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

function productCard(item) {
  const disabled = item.status !== "In Stock";
  return `
  <div class="product-card" data-category="${item.category}">
    <div class="photo-wrap">
      ${photoBlock(item)}
      ${statusBadge(item)}
    </div>
    <div class="product-info">
      <span class="product-cat">${item.category}</span>
      <h4>${item.name}</h4>
      ${item.details ? `<p class="product-details">${item.details}</p>` : ""}
      <div class="product-price">${money(item.price)} ${item.wasPrice ? `<span class="was">${money(item.wasPrice)}</span>` : ""}</div>
    </div>
    <div class="product-actions">
      ${disabled
        ? `<span class="btn btn-outline btn-small" style="opacity:.5; cursor:default;">${item.status}</span>`
        : `<a href="sms:" data-sms-link data-item="${item.name}" class="btn btn-dark btn-small">Text to Reserve</a>`}
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
  if (window.SITE_CONFIG) {
    el.querySelectorAll("a[data-sms-link]").forEach(link => {
      const item = link.getAttribute("data-item") || "";
      const body = `Hi! I'd like to reserve: ${item}`;
      link.href = `sms:${window.SITE_CONFIG.phoneHref}?&body=${encodeURIComponent(body)}`;
    });
  }
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

async function initInventory() {
  const items = await fetchInventory();

  // Shop page: full catalog
  if (document.getElementById("catalog-grid")) {
    renderGrid(items, "catalog-grid");
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

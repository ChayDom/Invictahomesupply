// Reads the "Website Products" table for the weekly digest, using the
// same AIRTABLE_TOKEN/AIRTABLE_BASE_ID/AIRTABLE_TABLE_NAME env vars and
// raw-fetch pattern as netlify/functions/inventory.mts — but this is
// separate code, not a shared import from inventory.mts, which is never
// modified (inventory.mts is a browser-facing, cache-oriented endpoint;
// this is a server-side-only read for building digests). Field name
// notes, since the task spec's names don't all match the Airtable
// schema literally:
//   "Sell Price"    -> the existing `Price` field (there is no separate
//                       "Sell Price" field; this is the same field
//                       inventory.js's own price mapping reads).
//   "Display Name"  -> the existing `Name` field.
// Neither is a new field — both already exist and are already read by
// inventory.mts/inventory.js under these names.

const DEFAULT_TABLE_NAME = "Website Products";

function airtableConfig() {
  const token = Netlify.env.get("AIRTABLE_TOKEN");
  const baseId = Netlify.env.get("AIRTABLE_BASE_ID");
  if (!token) throw new Error("AIRTABLE_TOKEN is not configured");
  if (!baseId) throw new Error("AIRTABLE_BASE_ID is not configured");
  const tableName = Netlify.env.get("AIRTABLE_TABLE_NAME") || DEFAULT_TABLE_NAME;
  return { token, baseId, tableName };
}

export interface EligibleProduct {
  productKey: string;
  name: string;
  category: string;
  price: number;
  unitLabel: string; // "/ sq ft", "each", "/ box", "/ roll" — mirrors inventory.js's own unit conventions
  qtyAvailable: number;
  imageUrl: string | null;
  detailUrl: string; // relative path — /product.html?id=<key> — the same routing inventory.js's productDetailHref() uses
  dateAddedTs: number;
}

function firstImageUrl(f: Record<string, unknown>): string | null {
  const photos = f["Photos"];
  if (Array.isArray(photos) && photos.length > 0) {
    const p = photos[0] as { url?: string; thumbnails?: { large?: { url?: string } } };
    return p?.thumbnails?.large?.url || p?.url || null;
  }
  const ref = f["Reference Image URL"];
  return typeof ref === "string" && ref ? ref : null;
}

function unitLabelFor(f: Record<string, unknown>, category: string): string {
  const unitType = (typeof f["Unit Type"] === "string" ? f["Unit Type"] : "").trim().toLowerCase();
  if (category === "Flooring" || unitType === "sq ft" || unitType === "sqft") return "/ sq ft";
  if (unitType === "box") return "/ box";
  if (unitType === "roll") return "/ roll";
  return "each";
}

// Fetches every currently-eligible-to-appear-in-a-digest product ONCE
// per digest run (not once per subscriber — see _shared/digest.mts),
// sorted newest first. Per-subscriber filtering (by their own cutoff
// timestamp) happens afterward against this same in-memory list.
//
// Eligibility (every condition required):
//   Post to Website = true, Status = "In Stock", Date Added present,
//   Price > 0, Quantity Available > 0, Name present, Category present,
//   a resolvable Product Key (needed for a valid detail URL).
export async function fetchEligibleNewProducts(): Promise<EligibleProduct[]> {
  const cfg = airtableConfig();
  const records: { id: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}`);
    // Server-side filter on the two cheapest/most selective conditions;
    // the rest (positive price/qty, required fields, a usable key) are
    // per-row checks below since they mix types Airtable formulas make
    // awkward to combine reliably in one filterByFormula string.
    url.searchParams.set("filterByFormula", `AND({Post to Website} = TRUE(), {Status} = "In Stock")`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
    if (!res.ok) {
      throw new Error(`Airtable products request failed: ${res.status}`);
    }
    const json = await res.json();
    records.push(...(json.records || []));
    offset = json.offset;
  } while (offset);

  const eligible: EligibleProduct[] = [];
  for (const r of records) {
    const f = r.fields;
    const dateAddedRaw = f["Date Added"];
    if (typeof dateAddedRaw !== "string" || !dateAddedRaw) continue;
    const dateAddedTs = new Date(dateAddedRaw).getTime();
    if (!Number.isFinite(dateAddedTs)) continue;

    const price = f["Price"];
    if (typeof price !== "number" || !(price > 0)) continue;

    const qty = f["Quantity Available"];
    if (typeof qty !== "number" || !(qty > 0)) continue;

    const name = typeof f["Name"] === "string" ? f["Name"].trim() : "";
    if (!name) continue;

    const categoryField = f["Category"];
    const category = categoryField && typeof categoryField === "object" && "name" in (categoryField as object)
      ? String((categoryField as { name: unknown }).name)
      : typeof categoryField === "string" ? categoryField : "";
    if (!category) continue;

    const productKey = typeof f["Product Key"] === "string" ? f["Product Key"].trim() : "";
    if (!productKey) continue; // no key, no valid detail URL — excluded

    eligible.push({
      productKey,
      name,
      category,
      price,
      unitLabel: unitLabelFor(f, category),
      qtyAvailable: qty,
      imageUrl: firstImageUrl(f),
      detailUrl: `/product.html?id=${encodeURIComponent(productKey)}`,
      dateAddedTs,
    });
  }

  eligible.sort((a, b) => b.dateAddedTs - a.dateAddedTs);
  return eligible;
}

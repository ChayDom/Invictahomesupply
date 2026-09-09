import type { Context, Config } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  // CDN caching (added below) is only ever applied to the successful GET
  // response — a non-GET request never reaches that path, so it can't be
  // cached under this rule either.
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const token = Netlify.env.get("AIRTABLE_TOKEN");
  const baseId = Netlify.env.get("AIRTABLE_BASE_ID");
  const tableName = Netlify.env.get("AIRTABLE_TABLE_NAME") || "Website Products";

  if (!token || !baseId) {
    return new Response(JSON.stringify({ error: "Airtable is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    let records: unknown[] = [];
    let offset: string | undefined;

    do {
      const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
      // Post to Website is the sole publish gate — see README for the
      // full field mapping and why Category/Status aren't filtered on here.
      url.searchParams.set("filterByFormula", "{Post to Website} = TRUE()");
      if (offset) url.searchParams.set("offset", offset);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Airtable request failed: ${res.status} ${body}`);
      }

      const json = await res.json();
      records = records.concat(json.records);
      offset = json.offset;
    } while (offset);

    // CDN caching only — the response body is exclusively public website
    // product-catalog fields (Name/Price/Category/etc.), already filtered
    // to Post to Website = TRUE server-side above; no subscriber data,
    // tokens, or other secrets ever pass through this function, so it's
    // safe to cache at Netlify's edge. Netlify-CDN-Cache-Control governs
    // the CDN only (Netlify strips it before the response reaches the
    // browser): a durable 60s cache with a 5-minute stale-while-revalidate
    // window, so a burst of hits across edge locations only rarely
    // reaches Airtable. The plain Cache-Control targets the browser and
    // deliberately disables ITS cache (max-age=0, must-revalidate) — the
    // client already has its own, independent 15-minute localStorage
    // cache (see inventory.js fetchInventory()); letting the browser's
    // HTTP cache also hold a copy would just be a second, redundant,
    // harder-to-reason-about cache on top of that one.
    return new Response(JSON.stringify({ records }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Netlify-CDN-Cache-Control": "public, durable, max-age=60, stale-while-revalidate=300",
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch inventory", detail: err instanceof Error ? err.message : String(err) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/inventory",
};

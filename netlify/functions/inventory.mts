import type { Context, Config } from "@netlify/functions";

export default async (req: Request, context: Context) => {
  const token = Netlify.env.get("AIRTABLE_TOKEN");
  const baseId = Netlify.env.get("AIRTABLE_BASE_ID");
  const tableName = Netlify.env.get("AIRTABLE_TABLE_NAME") || "Inventory";

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
      if (offset) url.searchParams.set("offset", offset);

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Airtable request failed: ${res.status}`);

      const json = await res.json();
      records = records.concat(json.records);
      offset = json.offset;
    } while (offset);

    return new Response(JSON.stringify({ records }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Failed to fetch inventory" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const config: Config = {
  path: "/api/inventory",
};

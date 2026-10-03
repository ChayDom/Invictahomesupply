import type { Context, Config } from "@netlify/edge-functions";

const PRODUCTION_HOSTS = new Set(["invictahomesupply.com", "www.invictahomesupply.com"]);
const PRODUCTION_ORIGIN = "https://invictahomesupply.com";
const STATIC_PATHS = ["/", "/shop", "/about.html", "/contact.html", "/service-area/dfw-north-texas", "/service-area/durant-ok", "/service-area/northwest-arkansas"];
const DEFAULT_TABLE_NAME = "Website Products";

function validProductKey(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && value.trim().length <= 150 && !/[\u0000-\u001f\u007f]/.test(value);
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function fallbackSitemap(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${STATIC_PATHS.map((path) => `<url><loc>${xmlEscape(`${PRODUCTION_ORIGIN}${path}`)}</loc></url>`).join("")}</urlset>`;
}

function sitemapResponse(xml: string): Response {
  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=UTF-8",
      "cache-control": "public, max-age=300, s-maxage=900, stale-while-revalidate=3600",
    },
  });
}

async function publishedProductKeys(): Promise<string[]> {
  const token = Netlify.env.get("AIRTABLE_TOKEN");
  const baseId = Netlify.env.get("AIRTABLE_BASE_ID");
  const tableName = Netlify.env.get("AIRTABLE_TABLE_NAME") || DEFAULT_TABLE_NAME;
  if (!token || !baseId) throw new Error("Airtable sitemap configuration is missing");

  const keys = new Set<string>();
  let offset = "";
  do {
    const url = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
    url.searchParams.set("filterByFormula", "{Post to Website} = TRUE()");
    url.searchParams.set("pageSize", "100");
    url.searchParams.append("fields[]", "Product Key");
    url.searchParams.append("fields[]", "Post to Website");
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`Airtable sitemap request failed: ${response.status}`);
    const data = await response.json() as { records?: { fields?: Record<string, unknown> }[]; offset?: string };
    for (const record of data.records || []) {
      if (record.fields?.["Post to Website"] !== true) continue;
      const key = record.fields?.["Product Key"];
      if (validProductKey(key)) keys.add(key.trim());
    }
    offset = typeof data.offset === "string" ? data.offset : "";
  } while (offset);
  return [...keys];
}

function sitemapXml(keys: string[]): string {
  const paths = [...STATIC_PATHS, ...keys.map((key) => `/product.html?id=${encodeURIComponent(key)}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map((path) => `<url><loc>${xmlEscape(`${PRODUCTION_ORIGIN}${path}`)}</loc></url>`).join("")}</urlset>`;
}

export default async (req: Request, context: Context) => {
  const fallback = await context.next();
  const host = new URL(req.url).hostname.toLowerCase();
  if (req.method !== "GET" || !PRODUCTION_HOSTS.has(host)) return fallback;
  try {
    return sitemapResponse(sitemapXml(await publishedProductKeys()));
  } catch (error) {
    console.warn("sitemap: dynamic product lookup failed; serving static sitemap", error instanceof Error ? error.message : String(error));
    return fallback;
  }
};

export const config: Config = { path: "/sitemap.xml", onError: "bypass" };

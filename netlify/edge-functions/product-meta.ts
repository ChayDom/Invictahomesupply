import type { Context, Config } from "@netlify/edge-functions";

// Rewrites product.html's <head> metadata (title, description, canonical,
// Open Graph, Twitter Card) server-side, before the response reaches the
// browser or a social-preview crawler — those crawlers generally do not
// execute JavaScript, so inventory.js's client-side updates to
// document.title/meta description alone can never fix what Facebook/
// iMessage/etc. see. This runs on every /product.html request and
// rewrites the static HTML text in place; it never talks to Airtable for
// any other page, and never touches the response body for a request with
// no `id` at all.
//
// Always returns a real page — any failure below (missing config,
// Airtable down, unexpected exception) falls back to the original,
// untouched static response (with only the safety-net noindex meta
// added), never an error response. See `onError: "continue"` below for
// the outermost safety net on top of this function's own try/catch.

const PRODUCTION_ORIGIN = "https://invictahomesupply.com";
const FALLBACK_IMAGE = `${PRODUCTION_ORIGIN}/assets/og/invicta-og-image.png`;
const NOINDEX_META = '<meta name="robots" content="noindex, follow">';

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Plain-text truncation for a meta description/OG description — long
// enough to be useful, short enough that social platforms/Google won't
// truncate it awkwardly mid-sentence. Matches the ~300-char cap
// inventory.js's own client-side description update already uses.
function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > max ? `${collapsed.slice(0, max - 1).trimEnd()}…` : collapsed;
}

function injectNoindexIfAbsent(html: string): string {
  if (/<meta\s+name=["']robots["']/i.test(html)) return html;
  return html.replace(/<title>/i, `${NOINDEX_META}\n<title>`);
}

function replaceTag(html: string, pattern: RegExp, replacement: string): string {
  return pattern.test(html) ? html.replace(pattern, replacement) : html;
}

// ---------------------------------------------------------------------
// Single-product Airtable lookup. Deliberately separate, minimal code
// from inventory.js's mapAirtableRecord() (browser-only, full field set)
// and from netlify/functions/_shared/products.mts (its own separate
// digest-eligibility mapping) — same precedent already established
// there: each server-side consumer reads only the handful of fields it
// actually needs. Kept inline in this one file (rather than a shared
// module under netlify/edge-functions/) since Netlify's edge-functions
// directory treats every file as a candidate function — there's no
// confirmed, documented convention (unlike netlify/functions/_shared/)
// for excluding a helper-only subdirectory there.

const DEFAULT_TABLE_NAME = "Website Products";

function airtableConfig() {
  const token = Netlify.env.get("AIRTABLE_TOKEN");
  const baseId = Netlify.env.get("AIRTABLE_BASE_ID");
  if (!token || !baseId) {
    throw new Error("Airtable is not configured (AIRTABLE_TOKEN/AIRTABLE_BASE_ID missing)");
  }
  const tableName = Netlify.env.get("AIRTABLE_TABLE_NAME") || DEFAULT_TABLE_NAME;
  return { token, baseId, tableName };
}

// Airtable formula string values need their own quotes/backslashes
// escaped — same defensive pattern as netlify/functions/_shared/
// subscribers.mts's escapeFormulaValue(), reimplemented here since edge
// functions and serverless functions are separate deploy targets/
// directories with no shared-import convention between them.
function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface ProductMeta {
  productKey: string;
  name: string;
  category: string;
  description: string;
  imageUrl: string | null;
}

// Thrown only for a genuine backend/network failure (Airtable
// unreachable, misconfigured, non-2xx, malformed JSON) — distinct from
// a clean "no matching published product" result (represented as
// `null`, not an exception) so the caller can tell "confirmed
// invalid/unpublished" apart from "temporary failure".
class ProductLookupError extends Error {}

function firstImageUrl(f: Record<string, unknown>): string | null {
  const photos = f["Photos"];
  if (Array.isArray(photos) && photos.length > 0) {
    const p = photos[0] as { url?: string; thumbnails?: { large?: { url?: string } } };
    return p?.thumbnails?.large?.url || p?.url || null;
  }
  const ref = f["Reference Image URL"];
  return typeof ref === "string" && ref ? ref : null;
}

function fieldsToCategoryLabel(f: Record<string, unknown>): string {
  const categoryField = f["Category"];
  if (categoryField && typeof categoryField === "object" && "name" in (categoryField as object)) {
    return String((categoryField as { name: unknown }).name);
  }
  return typeof categoryField === "string" ? categoryField : "";
}

// Same safe, non-fabricated description fallback inventory.js's
// initProductDetail() already uses client-side: real Details/Highlights
// when present, else a short factual sentence built only from name/
// category — never an invented spec, price claim, or availability claim.
function descriptionFor(name: string, category: string, f: Record<string, unknown>): string {
  const details = typeof f["Details"] === "string" ? f["Details"].trim() : "";
  if (details) return details;
  const highlights = typeof f["Highlights"] === "string" ? f["Highlights"].trim() : "";
  if (highlights) return highlights;
  return category
    ? `${name} — ${category} at Invicta Home Supply. Local pickup in McKinney, TX and DFW delivery available.`
    : `${name} at Invicta Home Supply. Local pickup in McKinney, TX and DFW delivery available.`;
}

// Returns null for "no such published product" (missing/unknown/
// unpublished Product Key — deliberately indistinguishable from each
// other so an invalid request can never reveal whether a given key
// exists but is unpublished). Throws ProductLookupError only for an
// actual backend failure.
async function lookupPublishedProduct(productKey: string): Promise<ProductMeta | null> {
  let cfg;
  try {
    cfg = airtableConfig();
  } catch (err) {
    throw new ProductLookupError(err instanceof Error ? err.message : String(err));
  }

  const formula = `AND({Post to Website} = TRUE(), {Product Key} = "${escapeFormulaValue(productKey)}")`;
  const url = new URL(`https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}`);
  url.searchParams.set("filterByFormula", formula);
  url.searchParams.set("maxRecords", "1");

  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${cfg.token}` } });
  } catch (err) {
    throw new ProductLookupError(`Airtable request failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    throw new ProductLookupError(`Airtable request failed: ${res.status}`);
  }

  let json: { records?: { fields?: Record<string, unknown> }[] };
  try {
    json = await res.json();
  } catch (err) {
    throw new ProductLookupError(`Airtable response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  const record = json.records && json.records[0];
  if (!record || !record.fields) return null;

  const f = record.fields;
  const name = typeof f["Name"] === "string" ? f["Name"].trim() : "";
  if (!name) return null; // no usable display name — treat as not found rather than emit blank metadata

  const category = fieldsToCategoryLabel(f);

  return {
    productKey,
    name,
    category,
    description: descriptionFor(name, category, f),
    imageUrl: firstImageUrl(f),
  };
}

function applyProductMetadata(html: string, opts: {
  title: string;
  description: string;
  canonicalUrl: string;
  ogType: string;
  image: string;
}): string {
  const safeTitle = escapeHtmlAttr(opts.title);
  const safeDesc = escapeHtmlAttr(opts.description);
  const safeUrl = escapeHtmlAttr(opts.canonicalUrl);
  const safeImage = escapeHtmlAttr(opts.image);

  let out = html;
  out = replaceTag(out, /<title>[^<]*<\/title>/i, `<title>${safeTitle}</title>`);
  out = replaceTag(out, /<meta\s+name=["']description["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta name="description" content="${safeDesc}">`);
  out = replaceTag(out, /<link\s+rel=["']canonical["']\s+href=(?:"[^"]*"|'[^']*')>/i,
    `<link rel="canonical" href="${safeUrl}">`);
  out = replaceTag(out, /<meta\s+property=["']og:type["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta property="og:type" content="${opts.ogType}">`);
  out = replaceTag(out, /<meta\s+property=["']og:url["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta property="og:url" content="${safeUrl}">`);
  out = replaceTag(out, /<meta\s+property=["']og:title["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta property="og:title" content="${safeTitle}">`);
  out = replaceTag(out, /<meta\s+property=["']og:description["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta property="og:description" content="${safeDesc}">`);
  out = replaceTag(out, /<meta\s+property=["']og:image["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta property="og:image" content="${safeImage}">`);
  out = replaceTag(out, /<meta\s+name=["']twitter:title["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta name="twitter:title" content="${safeTitle}">`);
  out = replaceTag(out, /<meta\s+name=["']twitter:description["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta name="twitter:description" content="${safeDesc}">`);
  out = replaceTag(out, /<meta\s+name=["']twitter:image["']\s+content=(?:"[^"]*"|'[^']*')>/i,
    `<meta name="twitter:image" content="${safeImage}">`);
  return out;
}

export default async (req: Request, context: Context) => {
  const response = await context.next();
  // Cloned twice before anything reads a body — a Response's body stream
  // can only be consumed once. `fallbackResponse` is read (once) if the
  // main path fails and we still want to inject the noindex safety net;
  // `lastResortResponse` is never read at all and is returned completely
  // untouched if even that fails, guaranteeing the page always loads.
  const fallbackResponse = response.clone();
  const lastResortResponse = response.clone();

  try {
    if (req.method !== "GET") return response;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html")) return response;

    const url = new URL(req.url);
    const rawId = url.searchParams.get("id");
    const html = await response.text();

    if (!rawId) {
      // No Product Key at all — never a valid product; skip the Airtable
      // round-trip entirely and just mark it non-indexable.
      return new Response(injectNoindexIfAbsent(html), { status: response.status, headers: response.headers });
    }

    let product;
    try {
      product = await lookupPublishedProduct(rawId);
    } catch (err) {
      // Temporary backend failure (Airtable down/misconfigured) — not a
      // confirmed "this product doesn't exist" state, but this response
      // still can't assert product-specific metadata it never validated.
      // noindex,follow here is scoped to this one response; the next
      // request (once Airtable recovers) gets a normal result.
      console.warn("product-meta: lookup failed, serving generic+noindex —", err instanceof ProductLookupError ? err.message : String(err));
      return new Response(injectNoindexIfAbsent(html), { status: response.status, headers: response.headers });
    }

    if (!product) {
      // Confirmed: no published product with this key (missing, unknown,
      // or unpublished — deliberately indistinguishable from each other).
      return new Response(injectNoindexIfAbsent(html), { status: response.status, headers: response.headers });
    }

    // Canonical is built from scratch — the production origin plus only
    // the Product Key, never copied from the incoming request's host or
    // query string. This is what strips tracking params (utm_source,
    // etc.), keeps the Netlify preview hostname out of the canonical even
    // when this exact function runs on a branch preview, and guarantees
    // one product never canonicalizes to another's URL.
    const canonicalUrl = `${PRODUCTION_ORIGIN}/product.html?id=${encodeURIComponent(product.productKey)}`;
    const title = `${product.name} | Invicta Home Supply`;
    const description = truncate(product.description, 300);
    const image = product.imageUrl || FALLBACK_IMAGE;

    const rewritten = applyProductMetadata(html, {
      title,
      description,
      canonicalUrl,
      ogType: "product",
      image,
    });

    return new Response(rewritten, { status: response.status, headers: response.headers });
  } catch (err) {
    // Unexpected failure anywhere above — never let a metadata bug take
    // down the actual product page. Fall back to the original response,
    // still with the noindex safety net (cheap string check, can't throw
    // in a way this outer catch doesn't already guard).
    console.warn("product-meta: unexpected error, serving original response —", err instanceof Error ? err.message : String(err));
    try {
      const html = await fallbackResponse.text();
      return new Response(injectNoindexIfAbsent(html), { status: fallbackResponse.status, headers: fallbackResponse.headers });
    } catch {
      return lastResortResponse;
    }
  }
};

export const config: Config = {
  path: "/product.html",
  onError: "continue",
};

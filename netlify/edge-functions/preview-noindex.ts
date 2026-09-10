import type { Context, Config } from "@netlify/edge-functions";

// Adds X-Robots-Tag: noindex, nofollow to every HTML route on every
// hostname except the two production-indexable hostnames — so a branch
// preview, a deploy preview, the site's own <sitename>.netlify.app
// alias, or a local/unknown host never competes with production in
// Google, while the real production domain stays indexable.
//
// This used to key off Netlify.env.get("CONTEXT") === "production". That
// failed in production: a real request to the live apex domain
// (https://invictahomesupply.com/) was observed coming back with the
// preview X-Robots-Tag set, which is only possible if that check
// evaluated to false for that request — i.e. CONTEXT was not the string
// "production" at the time this Edge Function actually ran for it. Root
// cause, precisely: the function's indexing decision depended on a
// deploy-context environment variable rather than on anything present in
// the request itself, so it had no way to independently confirm which
// hostname it was serving. Whatever value CONTEXT held for that
// production edge-function invocation, it did not match the exact
// string "production", and the code had no fallback check against the
// request's own URL to catch that.
//
// Fixed by making the decision solely from the parsed request URL's
// hostname (never the raw Host header, never CONTEXT) against a fixed
// allowlist of the two production-indexable hostnames. This is
// deterministic and has no dependency on Netlify's runtime environment
// state.
//
// netlify.toml's [[headers]] block has no per-context or per-host
// scoping (verified: Netlify headers declared via netlify.toml/_headers
// are global across every deploy context/hostname — there is no
// supported `[context.X.headers]` syntax), so this can't be done in
// netlify.toml alone.
//
// Deliberately does nothing to the response on the two production
// hostnames — no header is added there at all, so this can never
// accidentally ship a permanent noindex to production.
const PRODUCTION_HOSTNAMES = new Set([
  "invictahomesupply.com",
  "www.invictahomesupply.com",
]);

const HTML_ROUTES = [
  "/",
  "/index.html",
  "/shop",
  "/shop.html",
  "/about.html",
  "/contact.html",
  "/product.html",
  "/subscribe-confirmed.html",
  "/unsubscribed.html",
];

export default async (req: Request, context: Context) => {
  const response = await context.next();

  try {
    const hostname = new URL(req.url).hostname.toLowerCase();
    const isProductionHostname = PRODUCTION_HOSTNAMES.has(hostname);
    if (isProductionHostname) return response;

    const headers = new Headers(response.headers);
    headers.set("X-Robots-Tag", "noindex, nofollow");
    return new Response(response.body, { status: response.status, headers });
  } catch (err) {
    console.warn("preview-noindex: unexpected error, serving original response —", err instanceof Error ? err.message : String(err));
    return response;
  }
};

export const config: Config = {
  path: HTML_ROUTES,
  onError: "bypass",
};

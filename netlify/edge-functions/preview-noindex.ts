import type { Context, Config } from "@netlify/edge-functions";

// Adds X-Robots-Tag: noindex, nofollow to every HTML route in every
// non-production deploy context (branch-deploy, deploy-preview, and
// local `netlify dev`, whose CONTEXT is "dev") — so a branch preview
// (e.g. the planned final-pre-production branch's own preview URL)
// never competes with production in Google.
//
// netlify.toml's [[headers]] block has no per-context scoping (verified:
// Netlify headers declared via netlify.toml/_headers are global across
// every deploy context — there is no supported `[context.X.headers]`
// syntax), so this can't be done in netlify.toml alone. Netlify DOES
// already send this same header automatically for deploy previews and
// old/inactive branch deploys — but explicitly NOT for the current/most
// recent deploy of an active branch, which is exactly the case that
// matters here (a long-lived branch like final-pre-production always has
// a "most recent" deploy). Netlify.env.get("CONTEXT") is the documented,
// runtime-available way to tell contexts apart inside a Function/Edge
// Function (distinct from `context.deploy`, which only exposes
// id/published, not the context name).
//
// Deliberately does nothing to the response in the production context —
// no header is added there at all, so this can never accidentally ship a
// permanent noindex to production.
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
    const isProduction = Netlify.env.get("CONTEXT") === "production";
    if (isProduction) return response;

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
  onError: "continue",
};

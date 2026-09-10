import type { Context } from "@netlify/functions";

// Single source of truth for the origin used to build every customer-
// facing URL (product-detail/browse/unsubscribe links in emails,
// confirm-subscription/unsubscribe redirect targets). Before this
// module existed, every caller built its own `new URL(req.url).origin`
// — the incoming Host header — with no guard: correct for local/branch
// preview testing (a branch's own emails should link back to that same
// branch, see digest-test.mts's testMode), but nothing stopped a real
// production send from picking up an unexpected hostname (e.g. the
// site's own auto-assigned <sitename>.netlify.app alias, which stays
// live alongside the custom domain and is never in this repo's control
// to redirect away without also breaking branch-preview access — see
// this project's netlify.toml, which deliberately has no such redirect).
//
// PRODUCTION_ORIGIN is the same hardcoded pattern netlify/edge-functions/
// product-meta.ts already uses for the exact same reason (never let a
// canonical/link leak a non-branded hostname) — reused here rather than
// invented fresh.
export const PRODUCTION_ORIGIN = "https://invictahomesupply.com";

// Netlify's own trusted signal for "this invocation is serving the
// published production deploy" — context.deploy.context, populated by
// the platform itself, not read from any request header a client could
// influence. This is deliberately NOT `new URL(req.url).host` or
// anything derived from the request: a production deploy is reachable
// through more than one hostname (the custom domain and its own
// <sitename>.netlify.app alias both serve the identical production
// deploy), and only context.deploy.context reliably says "this is the
// production deploy" regardless of which of those hostnames the request
// actually arrived on.
// `context` itself, not just `context.deploy`, is optional here: several
// existing call sites (this project's own test suite among them) invoke
// a handler with only the Request argument. Missing/absent context must
// resolve exactly like every non-production context already does — the
// request's own origin — never crash and never default to production.
function isProductionContext(context: Context | undefined): boolean {
  return context?.deploy?.context === "production";
}

// The one call every URL-building function/module should make.
// - Production deploy (by trusted context, never by Host header):
//   always PRODUCTION_ORIGIN, no matter which hostname the request
//   arrived on (custom domain, the site's own netlify.app alias, or
//   anything else Netlify might route to this deploy).
// - Every other context (branch-deploy, deploy-preview, dev, or no
//   context at all e.g. in local test fixtures): unchanged from prior
//   behavior — the request's own origin, so a branch preview's test
//   emails/redirects keep linking back to that same branch.
export function resolveSiteOrigin(req: Request, context?: Context): string {
  if (isProductionContext(context)) return PRODUCTION_ORIGIN;
  return new URL(req.url).origin;
}

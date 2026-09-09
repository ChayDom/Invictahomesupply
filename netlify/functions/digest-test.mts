import type { Context, Config } from "@netlify/functions";
import { runWeeklyDigest } from "./_shared/digest.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
import { timingSafeEqual } from "node:crypto";

// POST /api/digest-test — a safe, isolated preview of the weekly
// digest. Deliberately separate from weekly-digest.mts (the real
// scheduled sender) so a bug or a compromised token here can never
// reach a real subscriber or mutate Last Digest Sent At; the only
// thing they share is runWeeklyDigest() itself (via its testMode
// flag), so the preview always renders exactly what production would
// send. Before enabling real weekly sends, this file can be deleted
// (or the DIGEST_TEST_TOKEN env var simply removed/rotated, which
// disables it immediately without a deploy) — see the project report
// for which of those you'd prefer.
//
// Safety properties, each enforced below:
//   - recipient is DIGEST_TEST_RECIPIENT (server env only) — the
//     request can never supply or override who receives it
//   - requires Authorization: Bearer <DIGEST_TEST_TOKEN> — never a
//     query parameter (so it can't end up in server access logs or
//     browser history)
//   - refuses to run when context.deploy.context === "production"
//   - rate-limited per IP
//   - subject prefixed "[TEST] "
//   - never touches Last Digest Sent At for anyone (runWeeklyDigest's
//     testMode path skips that entirely)
//   - response body is sanitized counts only — no subscriber data, no
//     tokens, no env var values

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  // Refuse in production outright, before even checking auth — a leaked
  // token must never be usable against the live site.
  if (context.deploy?.context === "production") {
    return new Response(JSON.stringify({ error: "Not available in production." }), { status: 403, headers: { "Content-Type": "application/json" } });
  }

  if (!checkRateLimit(`digest-test:${clientIp(req)}`, 3, 60 * 60 * 1000)) {
    return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), { status: 429, headers: { "Content-Type": "application/json" } });
  }

  const configuredToken = Netlify.env.get("DIGEST_TEST_TOKEN");
  if (!configuredToken) {
    console.warn("Invicta digest-test: DIGEST_TEST_TOKEN is not configured — refusing all requests");
    return new Response(JSON.stringify({ error: "Test endpoint is not configured." }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  const authHeader = req.headers.get("authorization") || "";
  const match = authHeader.match(/^Bearer (.+)$/);
  const providedToken = match ? match[1] : "";
  if (!providedToken || !timingSafeStringEqual(providedToken, configuredToken)) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const testRecipient = Netlify.env.get("DIGEST_TEST_RECIPIENT");
  if (!testRecipient) {
    return new Response(JSON.stringify({ error: "DIGEST_TEST_RECIPIENT is not configured." }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  try {
    const origin = new URL(req.url).origin;
    const summary = await runWeeklyDigest({ origin, testMode: true, testRecipient });
    // Sanitized: counts only. No email address (not even the test
    // recipient's, though the caller already knows it), no product
    // data, no tokens.
    return new Response(
      JSON.stringify({
        sent: summary.accepted > 0,
        eligibleProductsFound: summary.accepted > 0 || summary.skippedNoProducts > 0,
        checked: summary.checked,
        accepted: summary.accepted,
        skippedNoProducts: summary.skippedNoProducts,
        failed: summary.failed,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Invicta digest-test: run failed —", err instanceof Error ? err.message : "unknown error");
    return new Response(JSON.stringify({ error: "Test digest run failed." }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
};

export const config: Config = {
  path: "/api/digest-test",
};

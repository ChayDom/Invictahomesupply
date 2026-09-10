import type { Context, Config } from "@netlify/functions";
import { findSubscriberByField, updateSubscriber } from "./_shared/subscribers.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
import { resolveSiteOrigin } from "./_shared/site-origin.mts";

// GET /api/unsubscribe?token=... — the link included in every digest
// email (a later phase). Unlike Confirmation Token, Unsubscribe Token is
// never cleared on use: the same link in an old email must keep working
// no matter how many times it's clicked, so re-clicking an already-used
// unsubscribe link is a safe no-op, not an error.

const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function redirectTo(origin: string, state: "success" | "invalid"): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/unsubscribed.html?state=${state}` },
  });
}

export default async (req: Request, context: Context): Promise<Response> => {
  // Resolved via context.deploy.context (Netlify's trusted signal), not
  // the request's Host header — a production redirect always lands on
  // the branded domain; branch-preview testing is unaffected.
  const origin = resolveSiteOrigin(req, context);

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!checkRateLimit(`unsubscribe:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
    return new Response("Too many requests. Please try again later.", { status: 429 });
  }

  const token = new URL(req.url).searchParams.get("token") || "";
  if (!TOKEN_PATTERN.test(token)) {
    return redirectTo(origin, "invalid");
  }

  try {
    const record = await findSubscriberByField("Unsubscribe Token", token);
    if (!record) {
      return redirectTo(origin, "invalid");
    }

    // Idempotent: already-Unsubscribed just re-confirms success rather
    // than erroring or re-writing Unsubscribed At to "now" again.
    if (record.fields.Status !== "Unsubscribed") {
      await updateSubscriber(record.id, {
        Status: "Unsubscribed",
        "Unsubscribed At": new Date().toISOString(),
      });
    }

    return redirectTo(origin, "success");
  } catch (err) {
    console.error("Invicta unsubscribe: request failed —", err instanceof Error ? err.message : "unknown error");
    return redirectTo(origin, "invalid");
  }
};

export const config: Config = {
  path: "/api/unsubscribe",
};

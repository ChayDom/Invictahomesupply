import type { Context, Config } from "@netlify/functions";
import { findSubscriberByField, updateSubscriber } from "./_shared/subscribers.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";

// GET /api/confirm-subscription?token=... — the link a subscriber clicks
// from the confirmation email sent by subscribe.mts. Turns a Pending
// record Active. Invalid, expired (i.e. already-used — the token is
// cleared on success, so reuse looks identical to "never existed"), or
// malformed tokens all redirect to the same generic failure state; this
// endpoint never reveals whether an email/token exists.

// Tokens are 64 lowercase hex chars (generateToken() — 32 random bytes).
// Anything else is rejected before ever reaching Airtable.
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function redirectTo(origin: string, state: "success" | "invalid"): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: `${origin}/subscribe-confirmed.html?state=${state}` },
  });
}

export default async (req: Request, context: Context): Promise<Response> => {
  const origin = new URL(req.url).origin;

  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!checkRateLimit(`confirm:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
    return new Response("Too many requests. Please try again later.", { status: 429 });
  }

  const token = new URL(req.url).searchParams.get("token") || "";
  if (!TOKEN_PATTERN.test(token)) {
    return redirectTo(origin, "invalid");
  }

  try {
    const record = await findSubscriberByField("Confirmation Token", token);
    if (!record || record.fields.Status !== "Pending") {
      return redirectTo(origin, "invalid");
    }

    await updateSubscriber(record.id, {
      Status: "Active",
      "Confirmed At": new Date().toISOString(),
      "Confirmation Token": null,
    });

    return redirectTo(origin, "success");
  } catch (err) {
    console.error("Invicta confirm-subscription: request failed —", err instanceof Error ? err.message : "unknown error");
    return redirectTo(origin, "invalid");
  }
};

export const config: Config = {
  path: "/api/confirm-subscription",
};

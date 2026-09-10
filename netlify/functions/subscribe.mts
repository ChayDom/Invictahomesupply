import type { Context, Config } from "@netlify/functions";
import {
  findSubscriberByEmail,
  createSubscriber,
  updateSubscriber,
  generateToken,
  type SubscriberFields,
} from "./_shared/subscribers.mts";
import { sendEmail, welcomeEmail, getMailingAddress } from "./_shared/resend.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";
import { resolveSiteOrigin } from "./_shared/site-origin.mts";

// Phase 1 of weekly inventory email subscriptions — single opt-in: a
// valid email is Active immediately, no confirmation step. (Originally
// built as double opt-in; converted per a later request — see
// confirm-subscription.mts for why that endpoint still exists as
// legacy-only compatibility.) The weekly digest send and its scheduled
// function are a later phase, not built here.

const MAX_BODY_BYTES = 4 * 1024; // generous for {email, company}; anything bigger is malformed/abusive
const MAX_EMAIL_LENGTH = 254; // RFC 5321 mailbox length limit
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONSENT_TEXT = "By subscribing, you agree to receive inventory updates from Invicta Home Supply. You can unsubscribe anytime.";

// One identical message for every successful outcome (new signup,
// Pending/Unsubscribed reactivation, and already-Active) — deliberate,
// not a placeholder: it's what keeps the endpoint from letting a caller
// tell which of those happened for a given address (see the
// per-status branches below, all of which return this). Written to stay
// true even when no email was actually sent (the already-Active case),
// so it never promises something that branch doesn't do.
const NEUTRAL_SUCCESS_MESSAGE = "You're subscribed to weekly inventory updates from Invicta Home Supply.";
const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again in a moment.";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_EMAIL_LENGTH) return null;
  if (!EMAIL_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export default async (req: Request, context: Context): Promise<Response> => {
  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  // Rate limit: 8 submissions per IP per 10 minutes. Deliberately not
  // per-email (an attacker can vary the email; they can't as easily
  // vary the IP) — see _shared/rate-limit.mts for what this is and
  // isn't (in-memory, resets on cold start).
  if (!checkRateLimit(`subscribe:${clientIp(req)}`, 8, 10 * 60 * 1000)) {
    return jsonResponse(429, { error: "Too many requests. Please try again later." });
  }

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (contentLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Request too large." });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return jsonResponse(400, { error: "Invalid request." });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Request too large." });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return jsonResponse(400, { error: "Invalid request." });
  }
  if (!body || typeof body !== "object") {
    return jsonResponse(400, { error: "Invalid request." });
  }

  const fields = body as Record<string, unknown>;

  // Honeypot: a real visitor never fills this hidden field in. A bot
  // that fills every field does — silently pretend success without
  // touching Airtable or sending anything, so the bot never learns it
  // was caught.
  const honeypot = typeof fields.company === "string" ? fields.company.trim() : "";
  if (honeypot) {
    return jsonResponse(200, { message: NEUTRAL_SUCCESS_MESSAGE });
  }

  const email = normalizeEmail(fields.email);
  if (!email) {
    return jsonResponse(400, { error: "Please enter a valid email address." });
  }

  try {
    const existing = await findSubscriberByEmail(email);
    const nowIso = new Date().toISOString();
    let unsubscribeToken: string | null = null;
    let shouldSendWelcome = false;

    if (!existing) {
      unsubscribeToken = generateToken();
      await createSubscriber({
        Email: email,
        Status: "Active",
        "Confirmation Token": null,
        "Unsubscribe Token": unsubscribeToken,
        "Consent Text": CONSENT_TEXT,
        "Consent Timestamp": nowIso,
        "Confirmed At": nowIso,
      });
      shouldSendWelcome = true;
    } else {
      const status = existing.fields.Status;
      if (status === "Active") {
        // No duplicate record, no repeat welcome email — neutral
        // response only.
        return jsonResponse(200, { message: NEUTRAL_SUCCESS_MESSAGE });
      }
      if (status === "Pending") {
        // A record from before the double-opt-in -> single-opt-in
        // conversion, or one created by a still-in-flight request under
        // the old flow — activate it the same as any other first-time
        // subscribe. Its Unsubscribe Token was already generated at
        // creation; only fall back to a fresh one if it's somehow
        // missing.
        const existingUnsubToken = existing.fields["Unsubscribe Token"];
        unsubscribeToken = existingUnsubToken || generateToken();
        const updateFields: SubscriberFields = {
          Status: "Active",
          "Confirmed At": nowIso,
          "Confirmation Token": null,
        };
        if (!existingUnsubToken) updateFields["Unsubscribe Token"] = unsubscribeToken;
        await updateSubscriber(existing.id, updateFields);
        shouldSendWelcome = true;
      } else {
        // Unsubscribed (or any other/legacy value) -> re-subscribe.
        // Rotates the unsubscribe token (a previously-unsubscribed
        // address gets a clean link) and refreshes consent, since
        // resubscribing is a new consent event.
        unsubscribeToken = generateToken();
        await updateSubscriber(existing.id, {
          Status: "Active",
          "Confirmed At": nowIso,
          "Confirmation Token": null,
          "Unsubscribe Token": unsubscribeToken,
          "Consent Text": CONSENT_TEXT,
          "Consent Timestamp": nowIso,
          "Unsubscribed At": null,
        });
        shouldSendWelcome = true;
      }
    }

    if (shouldSendWelcome && unsubscribeToken) {
      // No welcome email — commercial or otherwise — without a real
      // business mailing address configured. The subscription itself
      // still succeeds (the record above is already Active); only the
      // email is held back, and only until this is set.
      const mailingAddress = getMailingAddress();
      if (!mailingAddress) {
        console.warn("Invicta subscribe: BUSINESS_MAILING_ADDRESS is not configured — welcome email not sent");
      } else {
        // Resolved via context.deploy.context (Netlify's trusted signal),
        // not the request's Host header — a production send always
        // links back to the branded domain, whichever hostname the
        // request itself arrived on; branch-preview testing is unaffected.
        const origin = resolveSiteOrigin(req, context);
        const browseUrl = `${origin}/shop`;
        const unsubscribeUrl = `${origin}/api/unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
        const emailContent = welcomeEmail(browseUrl, unsubscribeUrl, origin, mailingAddress);
        await sendEmail({ to: email, ...emailContent });
      }
    }

    return jsonResponse(200, { message: NEUTRAL_SUCCESS_MESSAGE });
  } catch (err) {
    // Sanitized: no email, no token, no stack — just enough to find this
    // in the function log if it keeps happening.
    console.error("Invicta subscribe: request failed —", err instanceof Error ? err.message : "unknown error");
    return jsonResponse(500, { error: GENERIC_ERROR_MESSAGE });
  }
};

export const config: Config = {
  path: "/api/subscribe",
};

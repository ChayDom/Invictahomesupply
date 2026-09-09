import type { Context, Config } from "@netlify/functions";
import {
  findSubscriberByEmail,
  createSubscriber,
  updateSubscriber,
  generateToken,
} from "./_shared/subscribers.mts";
import { sendEmail, confirmationEmail } from "./_shared/resend.mts";
import { checkRateLimit, clientIp } from "./_shared/rate-limit.mts";

// Phase 1 of weekly inventory email subscriptions — subscribe only. The
// weekly digest send and its scheduled function are a later phase, not
// built here. See confirm-subscription.mts / unsubscribe.mts for the
// other two Phase 1 endpoints.

const MAX_BODY_BYTES = 4 * 1024; // generous for {email, company}; anything bigger is malformed/abusive
const MAX_EMAIL_LENGTH = 254; // RFC 5321 mailbox length limit
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CONSENT_TEXT = "By subscribing, you agree to receive inventory updates from Invicta Home Supply. You can unsubscribe anytime.";

// One identical message for every successful outcome (new signup,
// pending retry, resubscribe, and already-active) — this is deliberate,
// not a placeholder: it's what keeps the endpoint from letting a caller
// tell which of those four happened for a given address (see the
// per-status branches below, all of which return this).
const NEUTRAL_SUCCESS_MESSAGE = "If that address needs confirming, we just sent a confirmation email — check your inbox.";
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
    let confirmationToken: string | null = null;
    let recordId: string | null = null;

    if (!existing) {
      confirmationToken = generateToken();
      const record = await createSubscriber({
        Email: email,
        Status: "Pending",
        "Confirmation Token": confirmationToken,
        "Unsubscribe Token": generateToken(),
        "Consent Text": CONSENT_TEXT,
        "Consent Timestamp": nowIso,
      });
      recordId = record.id;
    } else {
      const status = existing.fields.Status;
      if (status === "Active") {
        // Neutral response only — no Airtable write, no email.
        return jsonResponse(200, { message: NEUTRAL_SUCCESS_MESSAGE });
      }
      if (status === "Pending") {
        confirmationToken = generateToken();
        recordId = existing.id;
        await updateSubscriber(existing.id, { "Confirmation Token": confirmationToken });
      } else {
        // Unsubscribed (or any other/legacy value) -> re-subscribe.
        confirmationToken = generateToken();
        recordId = existing.id;
        await updateSubscriber(existing.id, {
          Status: "Pending",
          "Confirmation Token": confirmationToken,
          "Unsubscribe Token": generateToken(),
          "Consent Text": CONSENT_TEXT,
          "Consent Timestamp": nowIso,
          "Unsubscribed At": null,
        });
      }
    }

    if (confirmationToken && recordId) {
      const confirmUrl = `${new URL(req.url).origin}/api/confirm-subscription?token=${encodeURIComponent(confirmationToken)}`;
      const emailContent = confirmationEmail(confirmUrl);
      await sendEmail({ to: email, ...emailContent });
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

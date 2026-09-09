// Shared Airtable helpers for the "Inventory Subscribers" table — used by
// subscribe.mts, confirm-subscription.mts, and unsubscribe.mts. Reuses
// AIRTABLE_BASE_ID and the raw-fetch pattern from
// netlify/functions/inventory.mts (no Airtable SDK, no new dependency),
// but reads a dedicated AIRTABLE_SUBSCRIBERS_TOKEN rather than the
// inventory function's AIRTABLE_TOKEN — the original token is scoped
// read-only against Website Products and isn't authorized to write to
// Inventory Subscribers (confirmed by a live 403). inventory.mts itself
// is untouched and keeps using AIRTABLE_TOKEN.
//
// Table fields (already exist in Airtable, never created/renamed here):
//   Email, Status (Pending/Active/Unsubscribed), Confirmation Token,
//   Unsubscribe Token, Consent Text, Consent Timestamp, Confirmed At,
//   Unsubscribed At, Last Digest Sent At.
// Name/Categories are intentionally not read or written — Phase 1 has no
// per-category preferences.

import { randomBytes } from "node:crypto";

const DEFAULT_TABLE_NAME = "Inventory Subscribers";

// Fails clearly (a descriptive thrown Error, never the token's value)
// the moment a subscribe/confirm/unsubscribe request tries to touch
// Airtable without AIRTABLE_SUBSCRIBERS_TOKEN configured, rather than
// silently falling through to a confusing 403 from Airtable itself.
function airtableConfig() {
  const token = Netlify.env.get("AIRTABLE_SUBSCRIBERS_TOKEN");
  const baseId = Netlify.env.get("AIRTABLE_BASE_ID");
  if (!token) {
    throw new Error("AIRTABLE_SUBSCRIBERS_TOKEN is not configured");
  }
  if (!baseId) {
    throw new Error("AIRTABLE_BASE_ID is not configured");
  }
  const tableName = Netlify.env.get("AIRTABLE_SUBSCRIBERS_TABLE_NAME") || DEFAULT_TABLE_NAME;
  return { token, baseId, tableName };
}

export interface SubscriberFields {
  Email?: string;
  Status?: "Pending" | "Active" | "Unsubscribed";
  "Confirmation Token"?: string | null;
  "Unsubscribe Token"?: string;
  "Consent Text"?: string;
  "Consent Timestamp"?: string;
  "Confirmed At"?: string;
  "Unsubscribed At"?: string | null;
  "Last Digest Sent At"?: string | null;
}

export interface SubscriberRecord {
  id: string;
  fields: SubscriberFields;
}

// A single random 256-bit hex token — used for both Confirmation Token
// and Unsubscribe Token. Cryptographically secure (node:crypto), never
// derived from anything guessable (email, time, sequence).
export function generateToken(): string {
  return randomBytes(32).toString("hex");
}

// Airtable formula string values need their own quotes/backslashes
// escaped — values here are always either a normalized email or a
// generated hex token, never used to build markup, but escaped
// defensively anyway so a malformed/unexpected value can never break out
// of the quoted string into formula syntax.
function escapeFormulaValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function airtableRequest(path: string, init: RequestInit) {
  const cfg = airtableConfig(); // throws clearly if AIRTABLE_SUBSCRIBERS_TOKEN/AIRTABLE_BASE_ID are missing
  const url = `https://api.airtable.com/v0/${cfg.baseId}/${encodeURIComponent(cfg.tableName)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    // Status only — Airtable error bodies can echo back submitted field
    // values (e.g. a validation message quoting the Email we sent), so
    // the response text is deliberately never included here or logged
    // by any caller.
    throw new Error(`Airtable request failed: ${res.status}`);
  }
  return res.json();
}

// Finds the single subscriber record for a normalized (trimmed,
// lowercased) email, or null. LOWER() on both sides means an existing
// record saved with mixed case still matches.
export async function findSubscriberByEmail(normalizedEmail: string): Promise<SubscriberRecord | null> {
  const formula = `LOWER({Email}) = "${escapeFormulaValue(normalizedEmail)}"`;
  const json = await airtableRequest(`?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`, { method: "GET" });
  const records = json.records || [];
  return records[0] || null;
}

export async function findSubscriberByField(fieldName: "Confirmation Token" | "Unsubscribe Token", token: string): Promise<SubscriberRecord | null> {
  const formula = `{${fieldName}} = "${escapeFormulaValue(token)}"`;
  const json = await airtableRequest(`?filterByFormula=${encodeURIComponent(formula)}&maxRecords=1`, { method: "GET" });
  const records = json.records || [];
  return records[0] || null;
}

export async function createSubscriber(fields: SubscriberFields): Promise<SubscriberRecord> {
  const json = await airtableRequest("", {
    method: "POST",
    body: JSON.stringify({ records: [{ fields }] }),
  });
  return json.records[0];
}

export async function updateSubscriber(id: string, fields: SubscriberFields): Promise<SubscriberRecord> {
  const json = await airtableRequest("", {
    method: "PATCH",
    body: JSON.stringify({ records: [{ id, fields }] }),
  });
  return json.records[0];
}

// Every Active subscriber, paginated (Airtable caps a single response at
// 100 records and hands back an `offset` token for the next page) — used
// by the weekly digest, which has to walk the whole table rather than
// look up one record. Server-side filtered to Status=Active only; the
// digest's own eligibility check (valid email format, a present
// Unsubscribe Token) still runs per-record afterward since those aren't
// filterByFormula-friendly in the same single pass.
export async function listActiveSubscribers(): Promise<SubscriberRecord[]> {
  const formula = `{Status} = "Active"`;
  const all: SubscriberRecord[] = [];
  let offset: string | undefined;
  do {
    const params = new URLSearchParams({ filterByFormula: formula, pageSize: "100" });
    if (offset) params.set("offset", offset);
    const json = await airtableRequest(`?${params.toString()}`, { method: "GET" });
    all.push(...(json.records || []));
    offset = json.offset;
  } while (offset);
  return all;
}

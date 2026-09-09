// Shared Airtable helpers for the "Inventory Subscribers" table — used by
// subscribe.mts, confirm-subscription.mts, and unsubscribe.mts. Reuses the
// same AIRTABLE_TOKEN/AIRTABLE_BASE_ID env vars and raw-fetch pattern as
// netlify/functions/inventory.mts (no Airtable SDK, no new dependency).
//
// Table fields (already exist in Airtable, never created/renamed here):
//   Email, Status (Pending/Active/Unsubscribed), Confirmation Token,
//   Unsubscribe Token, Consent Text, Consent Timestamp, Confirmed At,
//   Unsubscribed At, Last Digest Sent At.
// Name/Categories are intentionally not read or written — Phase 1 has no
// per-category preferences.

import { randomBytes } from "node:crypto";

const DEFAULT_TABLE_NAME = "Inventory Subscribers";

function airtableConfig() {
  const token = Netlify.env.get("AIRTABLE_TOKEN");
  const baseId = Netlify.env.get("AIRTABLE_BASE_ID");
  const tableName = Netlify.env.get("AIRTABLE_SUBSCRIBERS_TABLE_NAME") || DEFAULT_TABLE_NAME;
  if (!token || !baseId) return null;
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
  const cfg = airtableConfig();
  if (!cfg) throw new Error("Airtable is not configured");
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

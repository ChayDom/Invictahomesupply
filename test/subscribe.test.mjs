#!/usr/bin/env node
// ===================================================================
// Regression/behavior tests for Phase 1 of weekly inventory email
// subscriptions: POST /api/subscribe, GET /api/confirm-subscription,
// GET /api/unsubscribe (netlify/functions/{subscribe,confirm-subscription,
// unsubscribe}.mts + netlify/functions/_shared/*.mts).
//
// Imports and calls the real function modules directly (Node 22 strips
// .mts type syntax natively — no build step, no test-only copy of the
// logic to drift out of sync). Airtable and Resend are both mocked via
// a fake global fetch — no real network call, no real email sent, ever.
// globalThis.Netlify is shimmed the same way the real Netlify Functions
// runtime provides it.
//
// Run with: node test/subscribe.test.mjs
// ===================================================================
import assert from "node:assert/strict";

globalThis.Netlify = {
  env: {
    get: (key) => ({
      AIRTABLE_TOKEN: "test-airtable-token",
      AIRTABLE_BASE_ID: "appTestBaseId0001",
      RESEND_API_KEY: "re_test_key",
    })[key],
  },
};

// ---------------------------------------------------------------------
// Fake Airtable + Resend over a single mocked global fetch. Reset
// between tests via resetBackend(). Deliberately re-implements just
// enough of Airtable's filterByFormula handling to match the exact
// formulas subscribers.mts generates (LOWER({Email}) = "...",
// {Confirmation Token} = "...", {Unsubscribe Token} = "...") — not a
// general formula evaluator.
// ---------------------------------------------------------------------
let store = [];
let nextId = 1;
let resendCalls = [];
let airtableShouldFail = false;
let resendShouldFail = false;

function resetBackend() {
  store = [];
  nextId = 1;
  resendCalls = [];
  airtableShouldFail = false;
  resendShouldFail = false;
}

function cloneRecord(r) {
  return { id: r.id, fields: { ...r.fields } };
}

globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);

  if (u.hostname === "api.airtable.com") {
    if (airtableShouldFail) {
      return new Response("simulated Airtable outage", { status: 500 });
    }
    const method = init.method || "GET";
    if (method === "GET") {
      const formula = u.searchParams.get("filterByFormula") || "";
      let match = null;
      let m;
      if ((m = formula.match(/^LOWER\(\{Email\}\) = "(.*)"$/))) {
        const value = m[1];
        match = store.find(r => (r.fields.Email || "").toLowerCase() === value) || null;
      } else if ((m = formula.match(/^\{Confirmation Token\} = "(.*)"$/))) {
        const value = m[1];
        match = store.find(r => r.fields["Confirmation Token"] === value) || null;
      } else if ((m = formula.match(/^\{Unsubscribe Token\} = "(.*)"$/))) {
        const value = m[1];
        match = store.find(r => r.fields["Unsubscribe Token"] === value) || null;
      }
      return new Response(JSON.stringify({ records: match ? [cloneRecord(match)] : [] }), { status: 200 });
    }
    if (method === "POST") {
      const body = JSON.parse(init.body);
      const record = { id: `rec${nextId++}`, fields: { ...body.records[0].fields } };
      store.push(record);
      return new Response(JSON.stringify({ records: [cloneRecord(record)] }), { status: 200 });
    }
    if (method === "PATCH") {
      const body = JSON.parse(init.body);
      const { id, fields } = body.records[0];
      const record = store.find(r => r.id === id);
      if (!record) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
      for (const [key, value] of Object.entries(fields)) {
        if (value === null) delete record.fields[key];
        else record.fields[key] = value;
      }
      return new Response(JSON.stringify({ records: [cloneRecord(record)] }), { status: 200 });
    }
  }

  if (u.hostname === "api.resend.com") {
    resendCalls.push(JSON.parse(init.body));
    if (resendShouldFail) {
      return new Response(JSON.stringify({ message: "simulated Resend outage" }), { status: 500 });
    }
    return new Response(JSON.stringify({ id: "test-email-id" }), { status: 200 });
  }

  throw new Error(`unexpected fetch to ${url}`);
};

const { default: subscribeHandler } = await import("../netlify/functions/subscribe.mts");
const { default: confirmHandler } = await import("../netlify/functions/confirm-subscription.mts");
const { default: unsubscribeHandler } = await import("../netlify/functions/unsubscribe.mts");
const { _resetRateLimitsForTests } = await import("../netlify/functions/_shared/rate-limit.mts");

function subscribeRequest(bodyObj, overrideHeaders = {}) {
  return new Request("https://claude-code-changes-branch-prod-q7sdi3--invictahomesupply.netlify.app/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...overrideHeaders },
    body: JSON.stringify(bodyObj),
  });
}

function getRequest(path, params) {
  const url = new URL(`https://claude-code-changes-branch-prod-q7sdi3--invictahomesupply.netlify.app${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Request(url, { method: "GET" });
}

let failures = 0;
async function test(name, fn) {
  resetBackend();
  _resetRateLimitsForTests();
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`NOT OK - ${name}`);
    console.error(`  ${err.message}`);
  }
}

// ---------------------------------------------------------------------
await test("invalid email is rejected with 400 and no Airtable/Resend calls", async () => {
  const res = await subscribeHandler(subscribeRequest({ email: "not-an-email" }));
  assert.equal(res.status, 400);
  assert.equal(store.length, 0);
  assert.equal(resendCalls.length, 0);
});

await test("missing email is rejected with 400", async () => {
  const res = await subscribeHandler(subscribeRequest({}));
  assert.equal(res.status, 400);
});

await test("honeypot submission returns the same neutral success message but creates nothing and sends nothing", async () => {
  const res = await subscribeHandler(subscribeRequest({ email: "real@example.com", company: "I am a bot" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.message);
  assert.equal(store.length, 0, "honeypot must not create a subscriber record");
  assert.equal(resendCalls.length, 0, "honeypot must not send an email");
});

await test("new subscription creates a Pending record with tokens/consent and sends one confirmation email", async () => {
  const res = await subscribeHandler(subscribeRequest({ email: "  New@Example.com  " }));
  assert.equal(res.status, 200);
  assert.equal(store.length, 1);
  const record = store[0];
  assert.equal(record.fields.Email, "new@example.com", "email must be trimmed and lowercased before storing");
  assert.equal(record.fields.Status, "Pending");
  assert.match(record.fields["Confirmation Token"], /^[a-f0-9]{64}$/);
  assert.match(record.fields["Unsubscribe Token"], /^[a-f0-9]{64}$/);
  assert.notEqual(record.fields["Confirmation Token"], record.fields["Unsubscribe Token"]);
  assert.equal(
    record.fields["Consent Text"],
    "By subscribing, you agree to receive inventory updates from Invicta Home Supply. You can unsubscribe anytime."
  );
  assert.ok(record.fields["Consent Timestamp"]);
  assert.equal(resendCalls.length, 1);
  assert.equal(resendCalls[0].to[0], "new@example.com");
  assert.equal(resendCalls[0].from, "Invicta Home Supply <updates@news.invictahomesupply.com>");
  assert.equal(resendCalls[0].reply_to, "hello@invictahomesupply.com");
  assert.equal(resendCalls[0].subject, "Confirm your Invicta Home Supply subscription");
  assert.ok(resendCalls[0].html.includes(record.fields["Confirmation Token"]), "confirmation link must carry this record's token");
  assert.ok(resendCalls[0].text.includes(record.fields["Confirmation Token"]));
});

await test("duplicate Active subscriber: no new record, no email, same neutral message", async () => {
  store.push({ id: "rec1", fields: { Email: "active@example.com", Status: "Active" } });
  const res = await subscribeHandler(subscribeRequest({ email: "active@example.com" }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(store.length, 1, "must not create a second record for an Active email");
  assert.equal(resendCalls.length, 0, "must not send another email for an already-Active subscriber");

  // Same public message as a brand-new signup — an attacker probing
  // whether an address is subscribed must not be able to tell from the
  // response text alone.
  const freshRes = await subscribeHandler(subscribeRequest({ email: "brand-new@example.com" }));
  const freshBody = await freshRes.json();
  assert.equal(body.message, freshBody.message);
});

await test("existing Pending subscriber: confirmation token rotates and a new confirmation email sends, no duplicate record", async () => {
  store.push({
    id: "rec1",
    fields: {
      Email: "pending@example.com",
      Status: "Pending",
      "Confirmation Token": "a".repeat(64),
      "Unsubscribe Token": "b".repeat(64),
    },
  });
  const res = await subscribeHandler(subscribeRequest({ email: "pending@example.com" }));
  assert.equal(res.status, 200);
  assert.equal(store.length, 1);
  assert.notEqual(store[0].fields["Confirmation Token"], "a".repeat(64), "confirmation token must rotate");
  assert.equal(store[0].fields["Unsubscribe Token"], "b".repeat(64), "unsubscribe token is untouched on a Pending retry");
  assert.equal(resendCalls.length, 1);
});

await test("resubscribing an Unsubscribed address: Pending again, both tokens rotate, Unsubscribed At clears, confirmation resends", async () => {
  store.push({
    id: "rec1",
    fields: {
      Email: "back@example.com",
      Status: "Unsubscribed",
      "Confirmation Token": "",
      "Unsubscribe Token": "c".repeat(64),
      "Unsubscribed At": "2026-01-01T00:00:00.000Z",
    },
  });
  const res = await subscribeHandler(subscribeRequest({ email: "back@example.com" }));
  assert.equal(res.status, 200);
  assert.equal(store.length, 1);
  assert.equal(store[0].fields.Status, "Pending");
  assert.equal(store[0].fields["Unsubscribed At"], undefined, "Unsubscribed At must be cleared");
  assert.match(store[0].fields["Confirmation Token"], /^[a-f0-9]{64}$/);
  assert.notEqual(store[0].fields["Unsubscribe Token"], "c".repeat(64), "unsubscribe token must also rotate on resubscribe");
  assert.equal(resendCalls.length, 1);
});

await test("Airtable failure returns a generic 500 and never leaks the error body/token to the client", async () => {
  airtableShouldFail = true;
  const res = await subscribeHandler(subscribeRequest({ email: "outage@example.com" }));
  assert.equal(res.status, 500);
  const body = await res.json();
  assert.equal(body.error, "Something went wrong. Please try again in a moment.");
  assert.ok(!JSON.stringify(body).includes("test-airtable-token"), "response must never contain the Airtable token");
});

await test("Resend failure still returns 200 with the neutral message (record is created either way)", async () => {
  resendShouldFail = true;
  const res = await subscribeHandler(subscribeRequest({ email: "noemail@example.com" }));
  assert.equal(res.status, 200);
  assert.equal(store.length, 1, "the Pending record is still created even if the confirmation email fails to send");
});

await test("GET is rejected on /api/subscribe", async () => {
  const req = new Request("https://example.netlify.app/api/subscribe", { method: "GET" });
  const res = await subscribeHandler(req);
  assert.equal(res.status, 405);
});

await test("oversized request body is rejected", async () => {
  const hugeEmail = "a".repeat(10000) + "@example.com";
  const res = await subscribeHandler(subscribeRequest({ email: hugeEmail }));
  assert.equal(res.status, 413);
  assert.equal(store.length, 0);
});

// ---------------------------------------------------------------------
// confirm-subscription
// ---------------------------------------------------------------------
await test("valid confirmation token activates the subscriber and redirects to the success state", async () => {
  const token = "d".repeat(64);
  store.push({ id: "rec1", fields: { Email: "confirm@example.com", Status: "Pending", "Confirmation Token": token } });
  const res = await confirmHandler(getRequest("/api/confirm-subscription", { token }));
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /\/subscribe-confirmed\.html\?state=success$/);
  assert.equal(store[0].fields.Status, "Active");
  assert.ok(store[0].fields["Confirmed At"]);
  assert.equal(store[0].fields["Confirmation Token"], undefined, "token must be cleared after use");
});

await test("invalid confirmation token redirects to the invalid state without creating/changing anything", async () => {
  const res = await confirmHandler(getRequest("/api/confirm-subscription", { token: "not-a-real-token" }));
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /\/subscribe-confirmed\.html\?state=invalid$/);
});

await test("reused confirmation token (already Active, token already cleared) fails safely as invalid", async () => {
  const token = "e".repeat(64);
  store.push({ id: "rec1", fields: { Email: "reused@example.com", Status: "Pending", "Confirmation Token": token } });
  const first = await confirmHandler(getRequest("/api/confirm-subscription", { token }));
  assert.match(first.headers.get("location"), /state=success$/);

  const second = await confirmHandler(getRequest("/api/confirm-subscription", { token }));
  assert.match(second.headers.get("location"), /state=invalid$/, "the same token must not confirm twice");
  assert.equal(store[0].fields.Status, "Active", "status must remain Active, not be reprocessed");
});

// ---------------------------------------------------------------------
// unsubscribe
// ---------------------------------------------------------------------
await test("valid unsubscribe token marks the subscriber Unsubscribed and redirects to the success state", async () => {
  const token = "f".repeat(64);
  store.push({ id: "rec1", fields: { Email: "leaving@example.com", Status: "Active", "Unsubscribe Token": token } });
  const res = await unsubscribeHandler(getRequest("/api/unsubscribe", { token }));
  assert.equal(res.status, 302);
  assert.match(res.headers.get("location"), /\/unsubscribed\.html\?state=success$/);
  assert.equal(store[0].fields.Status, "Unsubscribed");
  assert.ok(store[0].fields["Unsubscribed At"]);
});

await test("repeated unsubscribe with the same token is idempotent and still succeeds", async () => {
  const token = "1".repeat(64);
  store.push({ id: "rec1", fields: { Email: "repeat@example.com", Status: "Active", "Unsubscribe Token": token } });
  const first = await unsubscribeHandler(getRequest("/api/unsubscribe", { token }));
  assert.match(first.headers.get("location"), /state=success$/);

  const second = await unsubscribeHandler(getRequest("/api/unsubscribe", { token }));
  assert.match(second.headers.get("location"), /state=success$/, "the same unsubscribe link must keep working");
  assert.equal(store[0].fields.Status, "Unsubscribed");
  assert.equal(store[0].fields["Unsubscribe Token"], token, "the token itself is never cleared, unlike Confirmation Token");
});

await test("invalid/unknown unsubscribe token redirects to the invalid state", async () => {
  const res = await unsubscribeHandler(getRequest("/api/unsubscribe", { token: "2".repeat(64) }));
  assert.match(res.headers.get("location"), /\/unsubscribed\.html\?state=invalid$/);
});

await test("rate limiting kicks in after repeated requests from the same IP", async () => {
  const headers = { "x-nf-client-connection-ip": "203.0.113.5" };
  let lastStatus;
  for (let i = 0; i < 10; i++) {
    const res = await subscribeHandler(subscribeRequest({ email: `flood${i}@example.com` }, headers));
    lastStatus = res.status;
  }
  assert.equal(lastStatus, 429, "the 9th+ request from one IP within the window should be rejected");
});

await test("GET is required on /api/unsubscribe", async () => {
  const req = new Request("https://example.netlify.app/api/unsubscribe?token=" + "3".repeat(64), { method: "POST" });
  const res = await unsubscribeHandler(req);
  assert.equal(res.status, 405);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
} else {
  console.log("\nAll subscribe/confirm/unsubscribe tests passed.");
}

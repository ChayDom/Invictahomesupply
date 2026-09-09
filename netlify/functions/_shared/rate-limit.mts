// Minimal in-memory, per-IP rate limiter — no external store, no new
// dependency (no @netlify/blobs, no paid service). Module-level state
// persists for the lifetime of a warm function container, which is
// exactly the window that matters for blunting a burst of requests from
// one script/bot; it resets on cold start. That's a real but modest
// limitation for a small local-business site's signup form, not a
// distributed/durable rate limiter — documented here rather than
// overstated.
//
// Shared across subscribe/confirm/unsubscribe via distinct key prefixes
// so one endpoint's traffic never counts against another's budget.

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Cheap unbounded-growth guard — runs on every call, deletes anything
// whose window has fully expired. A busy site sees this pruning happen
// constantly rather than needing its own timer/cron.
function prune(now: number, windowMs: number) {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > windowMs) buckets.delete(key);
  }
}

// Test-only hook — clears all buckets so automated tests don't trip the
// limiter just from running many cases back-to-back in one process (the
// real runtime never calls this; each deploy gets a fresh container).
export function _resetRateLimitsForTests(): void {
  buckets.clear();
}

export function clientIp(req: Request): string {
  // Netlify sets this to the real client IP (not attacker-controlled the
  // way a plain X-Forwarded-For can be behind some proxies); fall back
  // to X-Forwarded-For's first hop, then a constant so requests with
  // neither header still share one bucket instead of bypassing the
  // limiter entirely.
  return req.headers.get("x-nf-client-connection-ip")
    || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

// Returns true if this key is within its limit (and records the hit);
// false if the caller should be rejected.
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  prune(now, windowMs);

  const existing = buckets.get(key);
  if (!existing || now - existing.windowStart > windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  existing.count += 1;
  return existing.count <= limit;
}

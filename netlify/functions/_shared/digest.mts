// Core weekly-digest orchestration, shared by the scheduled production
// function (weekly-digest.mts) and the server-side-only test/preview
// endpoint (digest-test.mts) — one implementation, two callers, so the
// test path can never drift from what production actually sends.

import { listActiveSubscribers, updateSubscriber, type SubscriberRecord } from "./subscribers.mts";
import { fetchEligibleNewProducts, type EligibleProduct } from "./products.mts";
import { sendEmail, digestEmail, getMailingAddress, type DigestProduct } from "./resend.mts";

export const MAX_PRODUCTS_PER_DIGEST = 12;
export const FALLBACK_WINDOW_DAYS = 7;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// How many Resend sends run at once. Netlify scheduled functions get a
// longer timeout than a normal request-driven function, but it's still
// finite — unbounded Promise.all over every subscriber risks both
// hitting that timeout on a large list and slamming Resend with a burst
// of simultaneous requests. 5 is conservative; see the scale note in
// runWeeklyDigest's own comment below for where this stops being enough.
const MAX_CONCURRENCY = 5;

export interface DigestSummary {
  checked: number;
  accepted: number;
  skippedNoProducts: number;
  failed: number;
  invalid: number;
  /** Not part of the required 5-field summary contract — logged/returned
   *  alongside it for operational visibility only. Counts subscribers
   *  this run examined but skipped purely because they were already
   *  sent to earlier in the same idempotency week (see
   *  alreadySentThisWeek()) — neither a failure nor a "no new
   *  products" case, so it doesn't belong in either of those buckets. */
  alreadySent: number;
}

function emptySummary(): DigestSummary {
  return { checked: 0, accepted: 0, skippedNoProducts: 0, failed: 0, invalid: 0, alreadySent: 0 };
}

// Cutoff precedence: Last Digest Sent At, else Confirmed At (the
// single-opt-in subscription timestamp), else 7 days before this run —
// and in that last case, log ONLY the record id (never the email) as a
// sanitized warning, per spec.
export function computeCutoffTs(subscriber: SubscriberRecord, now: Date): number {
  const lastSent = subscriber.fields["Last Digest Sent At"];
  if (typeof lastSent === "string" && lastSent) {
    const ts = new Date(lastSent).getTime();
    if (Number.isFinite(ts)) return ts;
  }
  const confirmedAt = subscriber.fields["Confirmed At"];
  if (typeof confirmedAt === "string" && confirmedAt) {
    const ts = new Date(confirmedAt).getTime();
    if (Number.isFinite(ts)) return ts;
  }
  console.warn(`Invicta weekly-digest: subscriber ${subscriber.id} has neither Last Digest Sent At nor Confirmed At — using the 7-day fallback cutoff`);
  return now.getTime() - FALLBACK_WINDOW_DAYS * 86400000;
}

// allEligible is already sorted newest-first (see fetchEligibleNewProducts).
export function selectProductsForCutoff(
  allEligible: EligibleProduct[],
  cutoffTs: number
): { selected: EligibleProduct[]; hasMore: boolean } {
  const matching = allEligible.filter((p) => p.dateAddedTs > cutoffTs);
  return {
    selected: matching.slice(0, MAX_PRODUCTS_PER_DIGEST),
    hasMore: matching.length > MAX_PRODUCTS_PER_DIGEST,
  };
}

function isValidSubscriber(s: SubscriberRecord): boolean {
  const email = s.fields.Email;
  if (typeof email !== "string" || !EMAIL_PATTERN.test(email.trim())) return false;
  if (!s.fields["Unsubscribe Token"]) return false;
  return s.fields.Status === "Active";
}

// Chicago-local calendar date (YYYY-MM-DD) for a given instant — the
// idempotency key. en-CA locale is just a convenient way to get
// Intl.DateTimeFormat to hand back YYYY-MM-DD parts directly.
export function chicagoDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

// Persisted (Airtable-backed) idempotency check — deliberately not
// process-memory state, so it survives across separate invocations
// (e.g. the function timing out and Netlify retrying it, or — in the
// unlikely event both the 15:00 and 16:00 UTC triggers ever both judged
// themselves "10am Central" — a second run in the same week). A
// subscriber whose Last Digest Sent At falls on the same Chicago
// calendar date as this run's weekKey is treated as already handled.
export function alreadySentThisWeek(subscriber: SubscriberRecord, weekKey: string): boolean {
  const lastSent = subscriber.fields["Last Digest Sent At"];
  if (typeof lastSent !== "string" || !lastSent) return false;
  const ts = new Date(lastSent).getTime();
  if (!Number.isFinite(ts)) return false;
  return chicagoDateKey(new Date(ts)) === weekKey;
}

// Whole-dollar prices drop the trailing ".00" ($2 instead of $2.00);
// anything with meaningful cents keeps them ($1.50, $2.99).
function formatMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function formatPriceText(p: EligibleProduct): string {
  return `${formatMoney(p.price)} ${p.unitLabel}`;
}

// Flooring is sold by the box, so its digest quantity line leads with
// box count (the same Quantity Available field inventory.js's own
// boxesAvailable() reads) and adds the total square footage when known;
// everything else is sold in plain units.
function formatQtyText(p: EligibleProduct): string | null {
  if (!(p.qtyAvailable > 0)) return null;
  const count = Math.round(p.qtyAvailable);
  if (p.category === "Flooring") {
    const sqftPart = p.availableSqFt
      ? ` · ${p.availableSqFt.toLocaleString("en-US", { maximumFractionDigits: 2 })} sq ft`
      : "";
    return `${count} box${count === 1 ? "" : "es"} available${sqftPart}`;
  }
  return `${count} unit${count === 1 ? "" : "s"} available`;
}

function toDigestProduct(p: EligibleProduct, origin: string): DigestProduct {
  return {
    name: p.name,
    category: p.category,
    priceText: formatPriceText(p),
    qtyText: formatQtyText(p),
    imageUrl: p.imageUrl,
    detailUrl: `${origin}${p.detailUrl}`,
  };
}

// Small hand-rolled concurrency-limited map (no new dependency) — runs
// `fn` over `items` with at most `limit` in flight at once.
async function mapWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      await fn(items[current]);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () => worker());
  await Promise.all(workers);
}

// Retries the Last Digest Sent At update a few times with a short
// backoff — narrows (doesn't eliminate; see the module comment in
// weekly-digest.mts on why a schema change to close this gap entirely
// is out of scope) the window in which Resend has already accepted an
// email but Airtable never recorded that fact.
async function updateLastDigestSentWithRetry(id: string, iso: string): Promise<boolean> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await updateSubscriber(id, { "Last Digest Sent At": iso });
      return true;
    } catch {
      if (attempt === 3) {
        console.error(`Invicta weekly-digest: Last Digest Sent At update failed after retries for subscriber ${id} — the email itself was already sent; this record may need manual reconciliation to avoid a duplicate on the next run`);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }
  return false;
}

export interface RunDigestOptions {
  origin: string;
  now?: Date;
  /** Test/preview mode: sends only to a single server-configured
   *  recipient, using a fixed 7-day window, and never touches
   *  Last Digest Sent At for anyone. */
  testMode?: boolean;
  testRecipient?: string;
  /** Overridable for tests only — production always derives this from `now`. */
  weekKey?: string;
}

// Scale note (see the task's own question about this): at MAX_CONCURRENCY=5
// sequential-batches-of-5, sending to N subscribers takes roughly
// N/5 x (Resend round-trip + Airtable round-trip) — call it ~N/5 x 400ms
// as a rough real-world figure, so ~1000 subscribers is on the order of
// a few minutes, comfortably inside a scheduled function's extended
// timeout. Into the low thousands this in-function, single-invocation
// design is still reasonable. Beyond roughly 3,000-5,000 subscribers (or
// if per-recipient work grows, e.g. richer personalization requiring
// more Airtable/Resend round-trips per send), this should move to a
// queue-backed architecture — enqueue one job per subscriber (e.g. via
// Netlify Blobs/a queue service or a background function fan-out) and
// let a pool of workers drain it — so a single slow run can't blow the
// function timeout and a partial failure only needs to resume from
// wherever the queue left off, rather than re-scanning every subscriber.
export async function runWeeklyDigest(opts: RunDigestOptions): Promise<DigestSummary> {
  const summary = emptySummary();
  const now = opts.now || new Date();
  const nowIso = now.toISOString();

  const mailingAddress = getMailingAddress();
  if (!mailingAddress) {
    console.warn("Invicta weekly-digest: BUSINESS_MAILING_ADDRESS is not configured — no emails sent");
    return summary;
  }

  const allEligibleProducts = await fetchEligibleNewProducts();
  const browseAllUrl = `${opts.origin}/shop`;
  const siteUrl = opts.origin;

  if (opts.testMode) {
    summary.checked = 1;
    if (!opts.testRecipient) {
      summary.invalid = 1;
      return summary;
    }
    const sevenDaysAgo = now.getTime() - FALLBACK_WINDOW_DAYS * 86400000;
    const { selected, hasMore } = selectProductsForCutoff(allEligibleProducts, sevenDaysAgo);
    if (selected.length === 0) {
      summary.skippedNoProducts = 1;
      return summary;
    }
    // Test mode has no real subscriber record, so no real Unsubscribe
    // Token — this placeholder link is never registered against any
    // account and never used to update anything; it exists purely so
    // the template's unsubscribe link renders realistically.
    const unsubscribeUrl = `${opts.origin}/api/unsubscribe?token=preview-not-a-real-subscriber-token`;
    const emailContent = digestEmail(selected.map((p) => toDigestProduct(p, opts.origin)), {
      browseAllUrl,
      unsubscribeUrl,
      siteUrl,
      mailingAddress,
      hasMore,
    });
    const ok = await sendEmail({
      to: opts.testRecipient,
      subject: `[TEST] ${emailContent.subject}`,
      html: emailContent.html,
      text: emailContent.text,
    });
    if (ok) summary.accepted = 1;
    else summary.failed = 1;
    return summary;
  }

  const weekKey = opts.weekKey || chicagoDateKey(now);
  const subscribers = await listActiveSubscribers();

  await mapWithConcurrency(subscribers, MAX_CONCURRENCY, async (subscriber) => {
    summary.checked++;

    if (!isValidSubscriber(subscriber)) {
      summary.invalid++;
      return;
    }
    if (alreadySentThisWeek(subscriber, weekKey)) {
      summary.alreadySent++;
      return;
    }

    const cutoffTs = computeCutoffTs(subscriber, now);
    const { selected, hasMore } = selectProductsForCutoff(allEligibleProducts, cutoffTs);
    if (selected.length === 0) {
      summary.skippedNoProducts++;
      return;
    }

    const unsubscribeUrl = `${opts.origin}/api/unsubscribe?token=${encodeURIComponent(subscriber.fields["Unsubscribe Token"] as string)}`;
    const emailContent = digestEmail(selected.map((p) => toDigestProduct(p, opts.origin)), {
      browseAllUrl,
      unsubscribeUrl,
      siteUrl,
      mailingAddress,
      hasMore,
    });

    const sent = await sendEmail({ to: subscriber.fields.Email as string, ...emailContent });
    if (!sent) {
      summary.failed++;
      return;
    }

    const recorded = await updateLastDigestSentWithRetry(subscriber.id, nowIso);
    if (recorded) summary.accepted++;
    else summary.failed++; // sent, but state wasn't recorded — see updateLastDigestSentWithRetry's own comment
  });

  console.log(
    `Invicta weekly-digest: checked=${summary.checked} accepted=${summary.accepted} ` +
      `skippedNoProducts=${summary.skippedNoProducts} failed=${summary.failed} invalid=${summary.invalid} ` +
      `alreadySent=${summary.alreadySent}`
  );
  return summary;
}

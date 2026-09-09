import type { Context, Config } from "@netlify/functions";
import { runWeeklyDigest } from "./_shared/digest.mts";

// Phase 2: the scheduled weekly new-inventory digest. Production target
// is Friday 10:00 AM America/Chicago. Netlify's scheduled-function cron
// runs in UTC and does not itself track Chicago's CST/CDT switch, so
// this is scheduled for BOTH UTC times that 10am Chicago can fall on —
// "0 15,16 * * 5" fires at 15:00 UTC and 16:00 UTC every Friday — and
// the actual send only proceeds on whichever of those two invocations
// really is 10am in America/Chicago right now; the other exits
// immediately without sending anything or touching Airtable. This is
// deliberately a runtime check against the real current time, not a
// static assumption about which offset is "currently" in effect, so it
// stays correct across the DST transition with no seasonal code change.
//
// Sending itself is additionally gated on WEEKLY_DIGEST_ENABLED — see
// isDigestEnabled() below — left unset until this has been reviewed and
// tested via the separate digest-test.mts preview endpoint.

function isFridayTenAmCentral(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  // hour12:false can format midnight as "24" on some ICU builds; not a
  // concern for the value we're checking (10), but parsed as a number
  // either way rather than compared as a string.
  const hour = Number(parts.find((p) => p.type === "hour")?.value);
  return weekday === "Fri" && hour === 10;
}

function isDigestEnabled(): boolean {
  return Netlify.env.get("WEEKLY_DIGEST_ENABLED") === "true";
}

export default async (req: Request, context: Context): Promise<Response> => {
  const now = new Date();

  if (!isFridayTenAmCentral(now)) {
    // The other of the two scheduled UTC firings (or an out-of-window
    // manual/retry invocation) — exit without sending or touching
    // Airtable, exactly as required.
    console.log("Invicta weekly-digest: not Friday 10am America/Chicago right now — skipping this invocation");
    return new Response("Not the scheduled Chicago time window — skipped.", { status: 200 });
  }

  if (!isDigestEnabled()) {
    console.log("Invicta weekly-digest: WEEKLY_DIGEST_ENABLED is not \"true\" — digest sending is disabled, nothing sent");
    return new Response("Digest sending is disabled.", { status: 200 });
  }

  // Netlify sets this to the production site's own URL for scheduled
  // functions on a published deploy (scheduled functions only run there
  // in the first place — never on a branch preview), so req.url's
  // origin is the correct base for building product-detail/unsubscribe
  // links without a separate SITE_URL env var to keep in sync.
  const origin = new URL(req.url).origin;

  try {
    const summary = await runWeeklyDigest({ origin, now });
    console.log(
      `Invicta weekly-digest: run complete — checked=${summary.checked} accepted=${summary.accepted} ` +
        `skippedNoProducts=${summary.skippedNoProducts} failed=${summary.failed} invalid=${summary.invalid}`
    );
    return new Response("Weekly digest run complete.", { status: 200 });
  } catch (err) {
    console.error("Invicta weekly-digest: run failed —", err instanceof Error ? err.message : "unknown error");
    return new Response("Weekly digest run failed.", { status: 500 });
  }
};

export const config: Config = {
  schedule: "0 15,16 * * 5",
};

# Read-only production health

Run `runInvictaProductionHealthCheck()` for one structured observation. It never
generates captions/enrichment, sends mail, publishes, cleans up, changes triggers,
modifies Script Properties, or changes any business data. The existing stock,
identity, archive hash and social pure/read-only helpers remain authoritative.
One projected Airtable pagination pass is shared by all sections; one Buffer
GraphQL **query** tests account readability; one public inventory GET is used.
Exceptions are converted to bounded error codes, never logged verbatim.
Ready-row validation failures are isolated per row, so complete queue totals and
product-only generation/receipt timestamps remain available. Non-text Catalog
Product Keys (including date-valued cells) fail explicitly; the checker never
converts, replaces or repairs a permanent identity.

`runInvictaProductionHealthCheckAndAlert()` is the only alerting path. Install
exactly one daily 7–8 AM America/Chicago trigger after reviewing the manual result.
GREEN sends no email. WARNING/FAIL sends only findings to SOCIAL_REVIEW_EMAIL.
A Script Cache key + existing ScriptLock provides best-effort six-hour duplicate
alert suppression (cache can evict early). No persistent property state is used.
The checker itself does not write even this cache; only the alert wrapper does.
Do not invoke broad trigger setup or auto-repair any finding.

The five operational handlers must exist exactly once; missing/duplicate or
non-time-based registrations FAIL. The sixth health-alert handler must also
exist once after rollout; its initial absence is an explainable WARNING during
pre-install validation. Unexpected handlers, including legacy social/standalone
cleanup/fallback registrations, FAIL. Required property values are never returned:
only names and presence/expected-true state. Explicit production base/workbook
validation uses the existing approval helper.

## Honest coverage limits

Google's [Trigger API](https://developers.google.com/apps-script/reference/script/trigger)
does not expose installed cadence/hour/timezone, nor other owners' registrations.
The report identifies this limitation; it checks CLOCK event type and project
America/Chicago timezone, and reports intended schedules without pretending to
measure actual hour drift. Inspect native trigger dialogs during rollout:
maintenance every six hours; retain approved sync/enrichment cadence; preparation
6–7 AM; publishing 9–10 AM; health 7–8 AM Central. Do not infer exact clock times
from randomized window scheduling or add a parallel schedule-property manifest.

Product GENERATED AT excludes evergreen initialization. Stale generation warns
only after 72 hours (or no product timestamp) **and** existing eligible Draft/
Needs Copy rows need captions; complete drafts and ineligible products do not
cause false alarms. This is not proof of preparation execution or email delivery.
Buffer receipts plus LAST POSTED AT report the latest receipted hand-off, not
independently verified public publication; historical Queued rows are not pending
remote Buffer queue slots. Drafts never become Ready in this checker.

Unknown active stock is counted, not falsely declared zero/corrupt. Invalid
archive hashes/states/duplicates fail; unknown retired-source evidence warns and
is never cleanup-eligible. Retention stays 864000000 ms. Journals warn after
24 hours in RETIRING/AIRTABLE REMOVED, or more than 24 hours beyond expiry in
ARCHIVED; pending retention is not stuck. Eligibility is diagnostic only, with
source/archive identity/timer/zero/active-absence checks, never a delete command.

Read snapshots may overlap owner edits or maintenance; transient findings require
review/recheck, not automated correction. Alert cache holds only a fingerprint,
not credentials or business copies. No Gemini request, Cloudinary upload, Netlify
deploy, or new authorization scopes are needed. The existing review-email helper
is checked for availability but not invoked by the plain health checker.

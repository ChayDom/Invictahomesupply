# Rollback

How to revert production (`main` / invictahomesupply.com) to a previously
known-good state.

## Before you roll back

Confirm you actually need to: check the Netlify dashboard for the production
site's deploy log first. Netlify keeps every previous deploy, and the fastest
rollback is often "publish an older deploy" from the Netlify UI rather than a
git-level revert — it takes effect immediately with no git history changes.
Use the git-level procedure below when you specifically need `main` itself to
point at an older commit (e.g. before making a new fix on top of it).

## Git-level rollback

1. Identify the last known-good commit SHA on `main` (check `git log main` or
   your own release notes / prior audit reports for a recorded SHA).
2. Fetch and confirm current state:
   ```
   git fetch --all --prune
   git log --oneline -5 origin/main
   ```
3. Prefer a **revert**, not a hard reset, for anything already pushed to
   `main` — a revert adds a new commit undoing the bad change(s) without
   rewriting history that others may have already fetched:
   ```
   git checkout main
   git pull origin main
   git revert <bad-commit-sha>       # or a range: git revert <oldest>^..<newest>
   git push origin main
   ```
4. Only use a hard reset + force-push if `main` was pushed to in error
   moments ago and you are certain no one else has pulled it yet. This
   project's standing rule is: never force-push `main` without explicit,
   in-the-moment approval from the repository owner.
5. After pushing, verify:
   - Netlify's dashboard shows a new production deploy building from the
     reverted commit.
   - `git rev-parse origin/main` matches the commit you intended.
   - Spot-check the live site (shop page, a product-detail page, both inquiry
     modals) once the deploy finishes.

## Rolling back `final-pre-production`

Same approach — this branch is the normal staging ground before `main`, so a
bad change here is lower stakes. Revert or fast-forward-reset it as needed;
it does not require the same caution as `main` since nothing depends on its
history being stable for external consumers.

## Recommended: tag known-good production states

No git tags currently exist in this repository. Tagging the commit that is
live on `main` after each deploy (e.g. `git tag -a v2026.09.10 -m "..."`,
pushed with `git push origin v2026.09.10`) gives rollback targets that don't
depend on scrolling through commit messages. This is a recommendation, not
yet adopted — introduce it the next time a production deploy is confirmed
stable.

## What a rollback does NOT touch

Rolling back the website's git history does not roll back:

- Airtable data (Website Products / Website Subscribers tables) — inventory
  and subscriber records are independent of which website code is deployed.
- Google Apps Script project state — the sync script is a separate,
  independently deployed artifact (see `appscripts/`).
- Netlify environment variables — these persist across deploys and are not
  part of git history at all.
- Already-sent emails (Resend) or already-recorded "Last Digest Sent At"
  values in Airtable.

If a bad deploy also corrupted data (e.g. a broken sync run wrote bad
records to Airtable), reverting the website code does not undo that — see
`docs/DISASTER_RECOVERY.md`.

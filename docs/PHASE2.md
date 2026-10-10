# Phase 2: reliable observations and account boundaries

Bryan accepted account recovery and authorized this phase on October 10, 2026. Firebase, Firestore and Vercel remain the application stack. This phase does not redesign the dashboard or generate new service/location pages.

## Changes

- Every private API derives identity from Firebase authentication. Conversations check record ownership; administrator actions require a server-configured UID or an admin claim. When invitation access is enabled, approval is enforced on the server.
- Immutable history, recovery fields and sourced progress assessments cannot be changed through the client SDK. Ownerless legacy meta caches cannot be read or assigned to another user. Account deletion covers nested records, hashed training data, job/quota data and optional BigQuery exports, and reports partial failures honestly.
- Browser API caches are partitioned by account. Server website fetches reject internal addresses, pin validated DNS, revalidate redirects and limit duration/response size. AI routes share per-user request caps.
- Page progress replaces unverified aggregates and elapsed-time success messages. It compares exact-page Google observations across equal, non-overlapping 28-day periods, with dates and source attached. Zero traffic, missing data, collection errors and a paused account remain distinguishable.
- Automatic success, pivot and audit cards, success emails and promotion of old results into shared recommendations remain off. Old Firebase scoring is retired. The existing Vercel success-stories cron now runs the bounded observation collector without sending messages.
- Google connection mutations use authenticated server APIs and preserve refresh credentials. Old token-in-URL OAuth has been replaced with state-bound onboarding/reconnect. Property changes cannot accidentally reuse incompatible refresh credentials.

See [data policy and costs](PHASE2_DATA.md), [API inventory](PHASE2_ACCESS.md) and [rules/deletion inventory](PHASE2_RULES.md) for exact boundaries, limits and remaining work.

## Verification and release

Isolated unit/API tests and real Auth/Firestore emulator browser scenarios cover both users, ownership violations, immutable history, outcome tampering, save failures, recovery, dated comparisons, stale observations, cache isolation, private-network redirects, bounded requests, credential failures and deletion retries. The fresh production build succeeds. Final counts and production evidence are recorded below.

Release sequence: retain the recovered account pause; deploy the inert old Firebase scheduler; stage and verify the application; promote it and deploy the tested rules; verify the live account/property/history; back up onboarding before changing only `progressReviewRequired:false`; verify sourced observations with automatic outcomes still disabled.

`scripts/enable-verified-progress.cjs UID PROPERTY RUN_ID` is a dry run. `--apply` requires an owner-only backup outside Git and a matching complete recovery/history run. It refuses a concurrent account change. Restoring the pause means setting only that flag to true after verifying the same account/run; never restore legacy scoring code.

`scripts/verify-phase2-release.cjs ORIGIN UID PROPERTY paused|active` checks anonymous and cross-account rejection, administrator access, authenticated progress/history, exact property/pause state, archive exclusion, one real exact-page Google observation and the manual progress collector. `--cron` also exercises the authenticated observation cron and asserts zero notifications/promotion. It never prints tokens and does not send emails or delete records. A manually successful cron route does not prove a scheduled invocation occurred. An active manual refresh has a 15-minute cooldown, so do not repeat it immediately.

## Release result: October 10, 2026

- Application commit `7d77165` is deployed as `dpl_24oqSEcKbtZTRfCCw72tSLaA2F1t`, promoted to [SimplSEO](https://simplseo-io.vercel.app). The staged build passed and anonymous progress access returned application HTTP 401 before promotion. The prior recovery deployment remains available for a guarded rollback.
- Final verification passed: **116 tests across 15 unit/API files**, **17 browser/API/rules scenarios**, a fresh isolated production build and the Vercel build. Lint has zero errors and 15 existing warnings. No new automated test used production data or live paid providers.
- The legacy Firebase scheduler was successfully replaced with the inert export before enabling new collection. Tested Firestore rules were deployed after application promotion. `ADMIN_UIDS` was set for Bryan's verified existing account, and its read-only admin access passed. The `requestLimits.expiresAt` TTL configuration in commit `50b1ab3` was deployed and its state verified **ACTIVE**.
- Live checks passed both before and after enabling collection: eight anonymous private routes returned 401, a different UID was rejected with 403, history remained available, and progress reported the exact connected property and expected pause state. A real exact-homepage Google query returned data for **September 10–October 7, 2026**.
- After an owner-only backup outside Git, the guarded transaction changed only `progressReviewRequired` from true to false for the verified recovery run. Backup directory: `/Users/bryanarambula/Backups/simpleseo/phase2/`; apply-time filename ends in `1791647475809.json`. Keep this private account backup out of attachments, commits and public artifacts.
- Your six archived implementation records remained unchanged, and progress correctly returned **zero active changes**. The manual user refresh returned 200 with zero checked changes. The authenticated cron returned 200, inspected six records and skipped all six archived records; it sent zero notifications, saved zero strategies and kept automatic outcomes disabled. Production persistence of a new assessment still awaits a real confirmed website edit; it was exercised in the isolated tests.
- No error-level records were returned for this deployment during the post-release verification window. This is a bounded check, not a guarantee of future operation.

Open checks: Bryan's checkpoint below and the next actual scheduled invocations (02:00 UTC for progress, 03:00 UTC for website-update monitoring). A separate maintenance item must address the retained Firebase Functions Node 20 runtime before the CLI-reported October 30, 2026 decommission date; this release did not include a runtime/framework migration. Keep the old writer inert when upgrading or retiring those functions. Owner-readable Google credentials and remaining direct browser Google queries are compatibility limits documented in the supporting audits.

## Bryan's checkpoint

1. Refresh Dashboard and confirm Page progress appears; navigation must stay unlocked.
2. Open Previous website work. Recovery history must remain intact.
3. Open Low CTR Fixes and confirm the page is usable. It must not demand a pivot or claim success from old measurements.
4. After making a real website edit, mark that recommendation as implemented. The saved change should appear as collecting data rather than an instant result. A failed save must remain visible without reloading away the error.

An empty progress panel is expected when all existing work belongs to the archived website. Do not reactivate that work or invent edits just to populate the panel. New comparisons require complete reporting periods and enough activity; low traffic can leave a fixed comparison inconclusive.

Stop for feedback before Phase 3. The next automatically scheduled monitoring invocation still needs observation. No recurring automation has been created for that follow-up.

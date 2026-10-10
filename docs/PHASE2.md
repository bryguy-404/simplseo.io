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

Isolated unit/API tests and real Auth/Firestore emulator browser scenarios cover both users, ownership violations, immutable history, outcome tampering, save failures, recovery, dated comparisons, stale observations, cache isolation, private-network redirects, bounded requests, credential failures and deletion retries. The fresh production build succeeds. Final counts and production evidence are recorded below after release.

Release sequence: retain the recovered account pause; deploy the inert old Firebase scheduler; stage and verify the application; promote it and deploy the tested rules; verify the live account/property/history; back up onboarding before changing only `progressReviewRequired:false`; verify sourced observations with automatic outcomes still disabled.

`scripts/enable-verified-progress.cjs UID PROPERTY RUN_ID` is a dry run. `--apply` requires an owner-only backup outside Git and a matching complete recovery/history run. It refuses a concurrent account change. Restoring the pause means setting only that flag to true after verifying the same account/run; never restore legacy scoring code.

`scripts/verify-phase2-release.cjs ORIGIN UID PROPERTY` checks anonymous route rejection, authenticated progress/history, one real exact-page Google observation and the manual progress collector. It never prints tokens and does not send emails or delete records. A manually successful cron route does not prove a scheduled invocation occurred.

## Bryan's checkpoint

1. Refresh Dashboard and confirm Page progress appears; navigation must stay unlocked.
2. Open Previous website work. Recovery history must remain intact.
3. Open Low CTR Fixes and confirm the page is usable. It must not demand a pivot or claim success from old measurements.
4. After making a real website edit, mark that recommendation as implemented. The saved change should appear as collecting data rather than an instant result. A failed save must remain visible without reloading away the error.

An empty progress panel is expected when all existing work belongs to the archived website. Do not reactivate that work or invent edits just to populate the panel. New comparisons require complete reporting periods and enough activity; low traffic can leave a fixed comparison inconclusive.

Stop for feedback before Phase 3. The next automatically scheduled monitoring invocation still needs observation. No recurring automation has been created for that follow-up.

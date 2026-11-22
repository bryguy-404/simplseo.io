# Phase 12 — Monitor this page

The owner can start monitoring an existing page from **Improve a page** without publishing or confirming an edit. This extends the existing progress workflow, saved page reviews and notification preferences. It does not introduce a universal winning-page threshold, automatic website changes or paid background AI reviews.

## Owner experience

1. Choose an existing page and select **Monitor this page**. The explanation makes the initial review and existing allowance clear. A current saved review can be reused; new analysis uses the existing review pipeline.
2. Monitoring starts durably before collection or analysis. The initial review gives a clear recommendation, including **No changes recommended**. Earlier tasks remain available in a collapsed history section when further work is not recommended.
3. Missing data stays distinct from zero traffic. A failed initial review leaves monitoring active with an explicit retry. Existing search history is useful immediately; enrollment does not impose a month-long wait.
4. Future comparisons use the existing progress view. The owner requests deeper reviews; saved decisions remain dated when new results arrive. Verified technical issues can warrant attention earlier.
5. **Monitoring settings → Stop monitoring** preserves all history. Restart creates a new monitoring period. **I published an edit** records a genuine owner-confirmed publication and replaces the active monitor atomically, preserving its observations.

## Measurement and collection

Monitoring cycles have `mode: monitoring`, `startedAt` and an immutable `observationAnchorDay`. They have no fictional `confirmedAt` or publication confirmation. Day zero compares the latest complete 28 days with the preceding 28, using the existing three-day Google reporting buffer and Pacific calendar dates. Subsequent checkpoints advance by 28 days. The original comparison remains saved separately.

Initial collection and weekly technical checks reuse the existing bounded collector. Technical evidence and comparison windows retain their source, dates and exact account/property/site-version/page scope. Low traffic is inconclusive, and a failed refresh cannot turn previously saved observations into zeros. Follow-up prompts explicitly distinguish monitoring from measuring an actual published change.

Only later completed monitoring periods produce the existing results-ready notification. Day-zero history does not produce a monthly reminder. Verified technical issues reuse existing notification episodes and preferences. No email preference is enabled by enrollment. No new cron job or automatic AI review is introduced.

## Safety, scope and rollout

`PAGE_MONITORING_ENABLED=true` is a server-only switch and also requires the existing `ONGOING_PAGE_REVIEWS_ENABLED` and `ONGOING_PAGE_REVIEW_PILOT_UIDS` eligibility. Keep the existing pilot list; expanding it is a separate rollout decision. Turning the switch off preserves history and pauses monitoring mutations/collection. Published-change collection continues, including older records without an explicit mode.

Private `pageTrackingStates` documents serialize enrollment, migration, publication and stopping for an exact scoped page. Transactions, revision checks and expiring leases prevent duplicate active trackers and late work after stop or publication. Both account deletion sweeps include these documents. Direct Firestore client access is denied.

Two additive `pageProgressCycles` indexes support the flag-off collector: lifecycle/nextCheckAt/confirmedAt, with a userId-prefixed variant. Deploy these before rollout. The previous application deployment is `dpl_BVL1iG12aBr5dB2f2yG5Ks52eBpA`; no history deletion is needed for rollback.

## Verification

- Unit suite: 74 files and 1,321 tests passed; an additional monitoring-specific follow-up test then passed with all 21 follow-up service tests (1,322 unique passing tests).
- Browser/API regressions: 72 distinct scenarios passed across the main run and focused rechecks, including the real Auth/Firestore emulator APIs, private monitoring-identity rules, concurrent enrollment, start/retry/stop/restart, first actual publication and existing publication flows.
- Production compilation passed using isolated demo configuration. Lint has zero errors; existing unrelated warnings remain.
- Mobile monitoring layout was inspected. Quiet monitoring preserves saved tasks without presenting them as the next required action.
- `scripts/verify-page-monitoring-release.cjs` checks live authentication and read-only pilot access, snapshots saved work before/after, and reads scheduler evidence. It never enrolls a page or claims an edit for the owner.

Actual scheduled monitoring after a real enrollment, later completed periods and their monthly reminders remain live pilot observations. A successful manual or emulator collection does not prove scheduled production execution, SEO improvement or business results.

## Release checkpoint — 2026-11-22

Bryan explicitly authorized committing, pushing to `main` and deploying. The implementation and readiness commits were pushed to `main` through `adc6a5984bebf894a8c96d5722b197388ad8f4ba`. Vercel built and released that source as production deployment `dpl_Cm4Na2w9scDdxfZhAozZiXfRMqh7` at **https://simpl-seo.com**. The earlier upload approval block is resolved.

Firestore rules compiled and were released to `simpleseo-90570`, and both additive indexes were verified READY at 07:37:43 UTC. `PAGE_MONITORING_ENABLED=true` is set for production, with the existing ongoing-review pilot allowlist unchanged. Authenticated live reads verified the pilot flag and saved page plan/progress. Anonymous and forged-account writes were rejected. All 201 checked saved records retained their contents and update times, with the same fingerprint as the pre-release baseline. No page was enrolled, publication recorded, AI review generated or email sent for the owner. The release error/fatal log scan returned no matching errors.

Sanitized verification and rollout status are in [release evidence](evidence/page-monitoring-release-2026-11-22.json). Existing progress and website-monitoring jobs have completed real scheduled runs, most recently before this release. A scheduled monitoring check after real owner enrollment and a later monthly reminder remain separate live observations.

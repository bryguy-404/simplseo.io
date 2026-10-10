# Phase 2: sourced page progress

Implementation policy, October 10, 2026. This document describes the code and release checks; production outcomes are recorded separately in [PHASE2.md](PHASE2.md), with earlier account recovery in [RECOVERY.md](RECOVERY.md). See [PHASE2_RULES.md](PHASE2_RULES.md) for Firestore and deletion boundaries.

## What is measured

`GET /api/progress` reads the signed-in account's current, non-archived `implementedSeoTips` records whose status is `implemented`. `POST /api/progress` requests a bounded refresh for that same account. Firebase authentication determines ownership; supplying another user's ID is forbidden.

The collector writes one server-owned `progressAssessment` map per record. It includes schema version `1`, source `google_search_console`, exact connected property, exact page URL, the user's implementation confirmation date, both requested periods, dated observations, state/reason, and optional arithmetic comparison. The rules deny client creation, replacement, removal, or delete-and-recreate of this authoritative field. Implementation dates remain user-reported confirmations; the app does not verify that the website edit actually happened.

An assessment is shown as current only when its schema, source, implementation date, page, and connected property match the current record. Changing the page or confirming a new implementation invalidates the prior assessment. Archived records remain history and do not re-enter collection. A transaction rejects a result when the record, account pause state, website-update run, or property changed while Google was being queried. A newer stored attempt also wins over an older response.

Search Analytics requests use the stored connection and a case-sensitive `page equals` filter, preserving path case and query strings. They request web search, `dataState: final`, `aggregationType: auto`, and a single aggregate row without query/page grouping. No top-pages search, substring URL fallback, supplied OAuth token, or client snapshot determines the result. Google's API defines inclusive Pacific dates and exact page-filter behavior in its [query reference](https://developers.google.com/webmaster-tools/v1/searchanalytics/query?hl=en).

## Dates and comparison policy

For a confirmed implementation on Pacific calendar day **D**:

| Period | Inclusive dates | Length |
| --- | --- | --- |
| Before | D − 28 through D − 1 | 28 days |
| After | D + 1 through D + 28 | 28 days |

The implementation day is excluded. Timestamp inputs are converted to `America/Los_Angeles`; legacy date-only inputs retain their stated calendar date. The post period must end on or before Pacific today minus three days. The three-day buffer is an application policy in addition to Google's finalized-data setting, not a promise of Google's reporting availability.

Example: an August 1 change compares July 4–31 with August 2–29. The complete comparison is first eligible on September 1 Pacific time. Elapsed time only opens collection; it never establishes improvement, failure, indexing, or ranking.

These are fixed first-period comparisons. An insufficient sample does **not** silently become a 45-, 60-, or 90-day comparison, and waiting longer does not add traffic to the fixed post period. Choosing longer comparable windows is future product work.

The separate authenticated `/api/gsc/page-metrics` endpoint returns a recent 28-day observation ending at Pacific today minus three days. It carries source/property/page/date metadata, but that recent observation is not automatically a before/after assessment. Website-update monitoring also remains a separate observation flow and never gates account access.

## States and arithmetic

| State | Meaning |
| --- | --- |
| `paused` | Account context is missing, a website update is in progress, or `progressReviewRequired` is true. Manual refresh does not query Google. |
| `collecting` | No matching sourced assessment exists yet, or the full post period is not eligible. |
| `insufficient_data` | Date/page information is missing, the baseline is outside the supported history boundary, or observed activity is below the display thresholds. |
| `ready` | Both sourced periods are available and satisfy the display thresholds; arithmetic comparisons may be shown. |
| `error` | The connection needs reconnecting, Google failed, or provider data was invalid. No synthetic zero or success result is produced. |

Comparison display requires **at least 100 impressions in each period and 10 clicks combined**. These are product heuristics for showing a useful comparison, not statistical significance, confidence, or a validated SEO decision formula.

Successful no-data queries record zero impressions/clicks with `ctr: null` and `position: null`. Missing traffic is not proof that a URL is unindexed. Invalid responses fail instead of becoming zero observations. CTR is clicks divided by impressions; average position is Google's reported value, not a best observed position.

Click and impression differences are post minus baseline. Percentage changes are null when the baseline denominator is zero; the app does not invent a 100% increase. CTR changes are percentage-point differences. Position improvement is baseline position minus post position, and stays null when either position is unavailable.

Errors retain prior successful observations for the same cycle/property with their original dates but clear the current comparison. A later pause or expired Google history does not erase already stored observations. The conservative history guard uses a 16-month boundary; older baselines are unavailable rather than a zero baseline. Google's [traffic-drop guidance](https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops) describes the available 16-month view and separate storage for longer history.

## Automatic decisions remain off

The old Firebase `checkSeoTipProgress` export is deliberately inert. Keeping the deployed export replaces the prior writer rather than accidentally leaving its old scheduler running. The four retired maintenance HTTP functions continue returning 410.

The existing Vercel `/api/cron/check-success-stories` URL now collects dated progress only. It sends zero notifications, saves zero playbook strategies, and assigns no success, pivot, audit, reimplementation, or decline verdict. The authenticated playbook detection endpoint reports promotion paused. Admin configuration cannot enable automatic promotion; legacy playbook examples are not consumed in recommendations.

The dashboard's Page progress component replaces the former aggregate impact/leaderboard calculation. Low CTR automatic success/pivot/audit eligibility is disabled. Manual title and description suggestions, copying, website links, change confirmation, and preserved history remain available. This release does not promise improved rankings or claim that edits caused an observed change.

`progressReviewRequired: false` permits the new sourced collector to run. It does **not** enable the old monthly formula, email notifications, or automatic recommendation transitions.

## Work and request bounds

| Boundary | Implemented behavior |
| --- | --- |
| Records per collector invocation | At most 40 records are selected for processing. |
| Parallel provider work | Four workers; baseline and post requests within a worker are sequential. Connections are shared within that invocation by UID. |
| Time budget | Workers stop starting records after 90 seconds. Already started checks finish; routes declare a 240-second maximum. |
| Manual refresh | One start per account per 15 minutes; repeated/overlapping requests return 429. Paused accounts return without collection. |
| Job leases | Transactional four-minute lease, released by the owning attempt; crashed runs can resume after expiry. |
| Scheduled job | Existing daily 02:00 UTC Vercel path, with a server-only global cursor and one-minute repeat-start guard. Cron authorization fails closed if its secret is absent/wrong. |
| Pagination | Global records are ordered by document ID, continuing after the saved cursor and wrapping at the end. Manual refresh rotates through that account's active records. |
| Google timeouts/retry | Analytics request timeout is 20 seconds; OAuth refresh timeout is 15 seconds. One authorization retry follows a 401. There is no unbounded retry loop. |

Normal fully eligible collection makes two Analytics requests per record: at most 80 normal Analytics requests in a 40-record invocation. Authorization retries and OAuth refreshes are additional requests. Paused, archived, ineligible, and expired-history records do not make those two Analytics requests. API failures are retried by a later permitted invocation.

These are per-invocation controls, not a per-project dollar budget or a guarantee that every account is checked each day. The scheduled cursor currently walks all implementation documents, including skipped records. At larger volumes, a run covers only part of the collection and the full rotation takes multiple days. Manual reads/refresh selection still load that user's implementation documents before filtering/slicing. Repeated checks currently refetch completed fixed periods; freezing or less-frequently revalidating completed assessments is a future cost optimization. Provider quotas, Firestore reads, retained job documents, and multi-user refresh volume need measurement before general availability.

## Current observations versus legacy screens

`preStats`, `postStats`, `postStatsHistory`, `dayFortyFiveSnapshot`, old success scores, and historical keyword/attempt outcomes are unverified legacy client fields. They may remain in preserved records for compatibility, but the new collector does not read them as measurements. A fresh archived-record replacement retains an existing protected assessment unchanged; cycle validation prevents it becoming the new implementation's result. Legacy credentials can be removed without accepting newly supplied credentials.

Some existing dashboard, Low CTR, Easy Wins, and Extra Opportunities views still make browser-to-Google queries with row limits. Their keyword/page lists are exploratory views, not the authoritative page-total comparison and not a complete inventory of indexed URLs. Their counts may differ because of filters, grouping, truncation, and query privacy. This phase does not claim all Google reads have moved behind the server. Owner-only credential reads remain for compatibility; [PHASE2_RULES.md](PHASE2_RULES.md) documents that limitation.

Only `status: implemented` currently participates in the new comparison collector. Old audit-specific statuses such as `e1-tracking` are retained as legacy work and do not silently acquire a verified outcome. Rebuilding the advanced audit/pivot workflow belongs to a later validated recommendation phase.

## Release, unpause, and acceptance

1. Pass unit/API tests, real demo Auth/Firestore rules and browser tests, lint, and production build. All test seeds use `demo-simpleseo` with loopback emulators; no production account is used for mutations in tests.
2. Replace the old Firebase scheduler with the inert export and retain disabled maintenance routes. Verify the deployed replacement before removing any account-level recovery pause.
3. Deploy the new server collector, UI, and Firestore rules. Check unauthenticated and cross-account rejection, cron authorization, sanitized errors, and disabled playbook promotion. Keep the previous production build available for rollback.
4. Before unpausing Bryan, verify Firebase Auth UID and exact stored Search Console property, `revampStatus: complete`, expected `revampRunId`, no pending archive, and the matching immutable history manifest's completion. Save a protected account-state backup outside Git.
5. Apply only `progressReviewRequired: false`, transactionally guarded against concurrent account changes. Do not reactivate archived work, backdate implementations, erase history, or populate synthetic observations. A future website update can set the pause again.
6. Verify `/api/progress` on the real account: correct property, pause removed, old archived work excluded, automatic outcomes/notifications false. An empty list is expected if no new changes have been confirmed. Confirmed changes should begin in collecting state; a prematurely ready or elapsed-time-only result is a failure.
7. Bryan checks Dashboard and Low CTR access, the Page progress wording, and Previous website work. Confirming an actual website change should survive refresh; a save failure must remain visible. Cancellation should remove that item from active comparison collection without deleting history.
8. Invoke the authenticated collector once and review counts/errors. Separately verify a real scheduled invocation; a manual 200 response does not establish scheduler operation. Do not send test emails to customers.

The isolated tests cover exact-property/page filters, Pacific/DST dates, partial periods, zero denominators, errors, low samples, history expiry, recovery/archive exclusion, reimplementation races, bounded concurrency, cooldown, and disabled promotion. Emulator tests additionally check trusted-field tampering, real endpoint ownership, and the dashboard's dated ready/error/paused states. See test output and release notes for execution evidence rather than inferring that every check passed from this checklist.

For rollback, restore the account pause first if measurement behavior is suspect. Retain disabled old writers and rules protecting authoritative data; do not revive the unsafe scheduler as part of an application rollback. Restore only backed-up fields whose current values still match the migration's result, and preserve immutable history and sourced observations.

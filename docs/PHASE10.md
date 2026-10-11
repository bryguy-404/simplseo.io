# Phase 10 — A clear, visual progress dashboard

## Implementation and release status

Implemented October 11, 2026. The new dashboard presents one next action, dated website search activity and saved page work together. The existing dashboard remains available as the rollback path. Production build, aggregate regression results, deployment and live account verification are pending the release record below.

The user authorized implementation and deployment to the existing public project. There is no additional approval gate before the verified pilot deployment. Real website edits and publication confirmations still require the existing owner workflow; this release does not perform them.

## Dashboard behavior

The compact next-action card prioritizes required setup/reconnection, a verified technical issue, a saved complete comparison awaiting review, unfinished work, monitoring, then a page to start reviewing. It prioritizes only the loaded saved records; partial coverage never becomes a claim about every page in an account. Unavailable checks are not technical findings. Incomplete comparisons retain available numbers but do not invite a results review as though both periods were collected.

Website activity shows **Appearances in Google** and **Clicks from Google** for the existing 28-day reporting window. Four consecutive seven-day bars default to appearances and can switch to clicks. Calendar dates remain Pacific reporting dates, including the existing three-day reporting buffer. A partial week sums only returned days and shows its coverage; a week with no rows is unknown, not zero. Website totals remain independent from daily and page-list sums. Daily numbers and reporting details are expandable. There are no invented previous-period percentages or causal claims about SimplSEO's contribution.

Measured zero activity shows a useful page-review action instead of an empty chart. Failed activity refreshes retain the previous dated values. A cached successful observation carrying `reconnect_required` still offers **Connect Google**. Activity failures do not hide saved tasks and drafts.

**Your page work** features three prioritized cards, with **View all saved work** and bounded **Load more**. It combines current existing-page tasks, recurring progress cycles, eligible legacy tracking, new-page plans and publication observations. Published pages are deduplicated by their exact scoped URL; unpublished drafts retain their plan IDs. Current recurring cycles take precedence over legacy tracking, including when the cycle is outside the current source batch.

Cards reuse the existing progress timeline and comparison calculations. Elapsed-time bars measure waiting time, not ranking. A full bar without a collected comparison says that the latest data is still awaited. Gains, declines and unchanged values use text and icons as well as restrained color. Average position remains an average and improves numerically toward 1. Expandable details retain the reporting periods and previous numbers. A newer failed check does not erase saved observations.

Published new-page cards keep server publication verification, Google's dated stored indexing status and exact-page search activity independent. Rolling activity and activity since verification retain their periods; earlier search activity is explicitly acknowledged. Public-page warnings remain separate from unavailable checks. Opening a card never publishes, confirms work, generates guidance or restarts tracking.

The page list remains available beneath the work cards. Website monitoring, optional business-profile review, other tools and previous website work are grouped in a quiet expandable section. Mobile cards stack, the primary action uses the full available width, chart data has a screen-reader description/table, and animation respects reduced motion where added by this phase.

## Saved readers, scope and cost boundaries

- Authenticated `GET /api/dashboard/config` returns only the server-controlled pilot eligibility. It does not expose the allowlist.
- Authenticated `GET /api/dashboard/work` returns compact saved fragments, per-source errors and coverage, and a scope-bound continuation cursor. It resolves current identity/property/website version server-side and revalidates scope before returning results.
- Each source reads at most ten records plus a continuation sentinel. Publication observations are read only for loaded new-page plans. A bounded exact-page lookup resolves each loaded legacy candidate's active recurring cycle before it can affect the action selection.
- Responses omit draft bodies, complete recommendation copy, query tables and historical evidence. Existing source documents remain authoritative; this release creates no replacement work collection and migrates no customer data.
- Work/config reads perform no crawling, Google calls, OAuth refresh, AI generation, writes or quota reservation. The existing website-activity endpoint retains the shared six-hour cache and explicit-refresh lease/15-minute cooldown. This is not a claim that every dashboard activity GET is provider-free.
- Activity and work load independently. Account/website changes invalidate old requests. A failed source retains its earlier fragments while successfully read sources replace theirs; continuation retains unresolved failure coverage until that source is successfully retried.
- `/generic-keywords?planId=…` opens the authenticated saved plan with its own area context. It does not switch the persisted selected area, save a draft or trigger generation. Invalid/out-of-scope links fail safely.

No AI or research evaluation is needed for this presentation phase. No model, analysis allowance, paid generation behavior, cron schedule, publication date or measurement policy changes. Authoritative Firestore protections and account-deletion coverage continue to apply to the reused collections. Listing indexes are deployed before pilot verification.

## Verification and isolated previews

Verified by the dashboard UI implementation task:

- **11 unit cases** in `tests/dashboardActivityPresentation.test.js`: fixed seven-day groups across Pacific daylight saving changes; partial/missing/zero rows; invalid dates, values and duplicates; complete coverage; independent totals; honest activity emphasis.
- **14 browser scenarios** in `tests/browser/visual-dashboard.spec.js` have passed across the implementation agents' focused runs on the local development server and Firebase emulators: chart toggle/daily table, zero/stale activity, modern cycles plus drafts, positive/negative comparisons, three cards plus pagination, independent failures, cached reconnect errors, source replacement after a partial failure, continuation recovery and unresolved publication failures, overdue collection, incomplete comparisons, independent publication observations, and mobile themes.
- Keyboard chart controls, no mutation requests from dashboard cards, reload restoration, and real theme-menu switching were verified. At 320px and 375px, light/dark layouts had no horizontal overflow and work-link text matched the surrounding foreground color after transitions settled.
- Explicit JSX ESLint checks passed for both new dashboard components and the activity helper. The repository's default lint command does not include all JSX files, so this check was run separately.

These are isolated fixtures under a demo account and mocked provider routes. The tests do not write synthetic metrics, publication confirmations or plans into Bryan's live account. Remote Google sign-in scripts are harmless fixtures in the browser suite because authentication uses the local email/password emulator.

Local screenshot artifacts (not live account evidence):

- `/tmp/phase10-dashboard-starting-desktop.png`
- `/tmp/phase10-dashboard-zero-desktop.png`
- `/tmp/phase10-dashboard-collecting-desktop.png`
- `/tmp/phase10-dashboard-results-desktop.png`
- `/tmp/phase10-dashboard-declining-desktop.png`
- `/tmp/phase10-dashboard-unavailable-desktop.png`
- `/tmp/phase10-dashboard-results-mobile-{320,375}-{light,dark}.png`

The incomplete-checkpoint regression passed: available baseline numbers remain readable while unavailable post-period values are not shown as measured facts, and **Review my results** is absent. Aggregate unit/API/rules and existing-feature suites, production build, deployment indexes and live checks are recorded by the release owner below. A prior focused pass is not a claim that all release gates have completed.

## Pilot, checkpoints and rollback

Enable `VISUAL_DASHBOARD_ENABLED=true` with `VISUAL_DASHBOARD_PILOT_UIDS` restricted to Bryan's verified account. Both default to disabled; `*` is reserved for an explicitly chosen broader rollout. Existing accounts outside the allowlist keep the current dashboard.

After automated checks and production build pass:

1. Deploy the tested build and required indexes to the existing public project. Verify live feature eligibility and read-only work responses for the pilot account.
2. Compare Bryan's actual dashboard totals, reporting dates, saved tasks and new-page work with the detail pages. Open an actual saved draft through its deep link and verify the saved area and protected records did not change. Actual current state may contain no confirmed edit or published new page; that is a valid result.
3. Bryan can inspect the new dashboard at the normal public URL. The isolated previews demonstrate future states without pretending they occurred in his account.
4. After a worthwhile real homepage edit is published and explicitly confirmed, verify the same cycle, original confirmation time and next review date on Dashboard and Improve a page. Review the first real comparison when available. Do not backdate or invent a publication to complete this checkpoint.

Rollback: set `VISUAL_DASHBOARD_ENABLED=false` and redeploy, or restore the prior tested application deployment. Keep listing indexes and all saved records. Rollback changes dashboard presentation only; it does not delete tasks, drafts, cycles, confirmations, observations or history. No scheduler or AI-budget change needs reversal.

## Release record

- Production build: passed (`npm run build`, Next.js 15.3.6).
- Aggregate regression and security checks: 1,191 unit tests passed; 17 dashboard/API browser checks, 43 new-page browser checks and 75 existing-workflow/rules browser checks passed (135 total). Lint has zero errors and seven pre-existing warnings; explicit changed-JSX lint passed.
- Firestore index readiness: two new listing indexes created and building. The full CLI index deploy reported an unrelated pre-existing conversation-index conflict; no indexes were removed. Readiness is verified separately before promotion.
- Public deployment and pilot enablement: pending.
- Live saved-data consistency and unchanged-record audit: pending.
- Real published-edit/result checkpoints: remain dependent on genuine owner actions and later observations.

# Phase 7 — Ongoing page reviews

The owner publishes an improvement, confirms the actual edit, collects dated evidence, and explicitly chooses **Review my results**. A review may recommend continued monitoring, more evidence, a technical check, visibility investigation, or useful edits. It never has to invent a new task. Website publishing and indexing requests remain manual.

## Measurement and history

`pageProgressCycles` is scoped to the authenticated account, exact page URL, Search Console property and website version. Each cycle preserves its confirmation time, selected tasks, declared change, search focus and first-party page observation. Confirmations are owner declarations; they are not Google's discovery or crawl dates.

The original comparison excludes the confirmation day: days −28 through −1 versus days 1–28. Later checkpoints compare days 29–56 against 1–28, then 57–84 against 29–56, and continue in 28-day blocks. Dates use America/Los_Angeles and the existing three-day reporting buffer, so comparisons generally become eligible on days 31, 59 and 87. Collection availability can delay a review.

Observations, checkpoints and decisions use separate subcollections. The original comparison remains available as history. Missing data, zero activity and provider failure remain distinct. A failed refresh preserves earlier dated observations. Low-volume thresholds are cautions, never review locks or statistical significance tests. Query reports are incomplete and their sums are not represented as complete page totals.

Only another explicitly confirmed published edit supersedes a cycle. Reading a review, accepting tasks and keeping the page under monitoring do not change the confirmation date. An intervening edit is recorded as another publication and the preceding cycle remains preserved as affected history. Migration retains existing confirmation dates and labels older owner-reported provenance; it never backdates a new publication.

## Explicit follow-up and task preservation

Authenticated `/api/page-review/follow-up` reads saved guidance without crawling, Google requests, AI generation or quota use. Its explicit POST operations review evidence, run technical checks, or accept saved next tasks. `/api/progress` supplies cycles and paginated history and shares the collector's cache and leases for refreshes.

Follow-up evidence includes the actual confirmed changes, stored comparison observations, current page content, current technical observations, available matching queries, previous task history, search focus and bounded public research. Clear branded, plausible discovery and ambiguous queries stay distinct. Missing query data stays unknown. There are no automatic seasonality, device or causal explanations, universal CTR curves, monthly rewrite rules or keyword rotations.

Generation uses the current OpenAI model and strict structured validation. The shared page-review allowance is five attempts per minute and twenty per day. Unchanged evidence reuses saved reviews; acquisition timestamps do not create new work. Research under seven days old is reused. New public research is limited to two searches and excludes private Search Console queries and metrics. `aiUsageEvents` records the `page_follow_up` feature separately. No background AI or paid generation on page load is introduced.

Useful follow-up tasks are saved before activation. Activation archives the preceding plan, retains owner edits and unfinished tasks, and does not reopen completed actions. The owner then publishes worthwhile changes and confirms the exact tasks through the existing warning. Concurrent owner edits, stale revisions or failed requests leave saved work intact.

## Beginner interface

Dashboard and **Improve a page** show a compact status card: what changed, what it means, what to do next and the next comparison date. Detailed comparisons, technical evidence, prior completed tasks and old cycles remain expandable. Collection shows the expected review date; available comparisons expose **Review my results**; saved decisions restore after reload and sign-in. A quiet **Something seems wrong** action checks technical observations without paid analysis or restarting measurement.

The collection card includes an accessible elapsed-time bar using Pacific calendar days. Reaching its scheduled date changes the wording to waiting for the latest data; it never manufactures a ready comparison. Available results show clicks, appearances in search and average position together, with previous/current values and plain-language differences. Gains use green, declines amber and unchanged or unavailable values neutral styling, always accompanied by text and icons. Position improves when its number moves closer to 1. Low-volume cautions stay visible, and failed collection keeps dated previous results. These are observed changes, not an SEO score or proof that the edits caused them. The visual presentation adds no provider or AI work.

## Operations and access

The existing 02:00 UTC progress job collects cycles. No cron is added and the 03:00 website/new-page job remains independent. The progress job shares a 220-second absolute deadline across legacy and ongoing work, processes at most 40 records with concurrency four, and records failures/backlog. It prioritizes the latest eligible checkpoint and backfills at most one older missing checkpoint per cycle per run. Completed aggregate windows are reused. Early technical checks begin on day 7 and then run weekly; manual checks share leases and cache.

Authoritative records reject direct browser writes. Transactions verify account existence, deletion state, ownership, property, website version and revisions immediately before saves. Account deletion recursively removes cycles and nested records. OAuth refresh writes cannot recreate deleted accounts or overwrite a changed connection. Legacy reset paths cannot bypass the ongoing lifecycle.

## Pilot rollout and rollback

Server flags `ONGOING_PAGE_REVIEWS_ENABLED=true` and `ONGOING_PAGE_REVIEW_PILOT_UIDS=<Bryan's UID>` enable only the pilot account. The default is off. The allowlist must not use `*` until a broader rollout is explicitly chosen.

Disable new generation and its interface by setting `ONGOING_PAGE_REVIEWS_ENABLED=false` and redeploying. Retain cycle records, private rules, indexes and archived plans. Do not delete history to roll back. Existing deployment rollback also retains Firestore data, but a pre-Phase-7 application does not understand the new lifecycle; prefer the feature flag for containment.

Release requires unit/API, Firestore rules, desktop/mobile/keyboard and existing/new-page regressions, lint, production build and the bounded eight-scenario, two-pass real-model quality evaluation. Record actual validation and deployment evidence below.

## Live checkpoints

1. Bryan previews [isolated collecting, inconclusive, monitoring and actionable examples](phase7-preview.html). Simulated observations never enter the live account.
2. After Bryan publishes a worthwhile homepage edit, verify the exact confirmed tasks, date, cycle and next comparison date. Merely testing the screen does not count as publication.
3. Correlate an actual scheduled Vercel invocation with persisted observations and run health. Manual tests alone do not verify scheduling.
4. Review the real homepage comparison together at its first eligible checkpoint and again as later evidence matures. Do not backdate a publication to accelerate the pilot.

Ranking and business outcomes remain future pilot evidence. Emails, conversions, automatic website edits, automatic success classifications, payments and stack migration are outside this release.

## Verification and release record

October 11, 2026: 848 unit tests in 48 files passed. The isolated production browser/API/Firestore-rules suite passed 119 cases. After two cross-session UI guards, a fresh production build and all 20 focused checks (17 UI plus three actual compiled API/emulator cases) passed. Full lint has no errors and nine existing warnings. Static review confirmed scope/revision/deletion guards and provider deadline propagation.

The bounded evaluation made exactly 16 real-model calls. Its original automated result was 12 passes and four overly restrictive fixture-outcome failures; independent content review and narrow offline replay passed all 16 responses without another paid call. See [the evaluation and usage record](PHASE7_EVALUATION.md) for the unmodified original results, adjudication and limitations.

Firestore rules and all five new indexes were deployed to `simpleseo-90570`; every new index was verified READY before promotion. The production application built from commit `cb1ab90` was staged, verified through authenticated Vercel access, then promoted to https://simplseo-io.vercel.app as deployment `dpl_6jfinGeh1f9YbLHavvUEgE4QfVVi` at approximately 05:15 UTC on October 11. The feature is enabled only for Bryan's verified account.

Both staged and public checks passed six anonymous and six cross-account probes, authenticated stored-progress/plan reads, missing-cycle handling and the retired reset route. Nine saved records retained their exact update times. No guidance was generated, no publication was confirmed, and no active homepage cycle was created by verification. The release's post-check error-log scan returned no entries. See [the release evidence](evidence/phase7-release.json).

Production configuration confirms the same two enabled cron definitions on the new deployment: progress at 02:00 UTC and website/new-page monitoring at 03:00 UTC. This is configuration evidence, not evidence that the new collector already executed. The first expected Phase-7 progress invocation is October 12 at 02:00 UTC, because release followed the October 11 run. The previously requested single morning follow-up keeps its schedule and now explicitly distinguishes earlier-deployment runs from Phase-7 evidence.

Real homepage publication, a Phase-7 scheduled run correlated with stored observations, and mature-result checkpoints remain pending. Bryan's homepage currently has no active ongoing cycle. The next action is to publish worthwhile selected edits and explicitly confirm only the tasks actually completed; the first comparison generally becomes eligible 31 days later.

### Progress presentation refinement

The elapsed-time bar and metric cards are a presentation-only refinement at application commit `c762260`. All 891 unit tests in 49 files passed, including 43 new date/metric presentation cases. The isolated optimized production build passed. All 27 focused browser/API cases passed, followed by a fresh build and 24 UI cases after correcting the unavailable-data caution. Desktop/mobile, keyboard navigation, restoration, zero versus missing data, inverse average-position movement, overdue collection and preservation of dated results were checked. Lint reports zero errors and the same nine existing warnings. No new model calls, publication confirmations or measurement changes were introduced. The updated [isolated preview](phase7-preview.html) shows collecting, improving, declining and inconclusive states.

The visual refinement was staged, verified and promoted to the same public URL on October 11, 2026 at approximately 05:58 UTC as `dpl_H5AH968hkTry1DGiTk2Cp8GG4gbh`. Both staged and public checks retained all nine saved records with no AI generation or publication confirmation. The pilot remains restricted to Bryan, with no active homepage cycle. The deployment error scan returned zero entries. See [visual release evidence](evidence/phase7-progress-visual-release.json). The previous Phase-7 deployment (`dpl_6jfinGeh1f9YbLHavvUEgE4QfVVi`) remains the rollback target; this UI change requires no data migration.

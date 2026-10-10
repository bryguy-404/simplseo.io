# SimpleSEO master roadmap

Status on October 10 2026: Bryan accepted the recovery and Phase 2 screen checkpoints. Phase 3 and Phase 4 releases are deployed with account-verification records. Generalized existing-page review version 4 is now deployed: richer first-party HTML, Google URL Inspection, bounded linked-page checks, a stated page goal and concrete recommendations beyond metadata. Its first live account review passed and exposed one remaining task the tool could handle itself. An automatic related-page search comparison is implemented and undergoing final release checks; Bryan's usefulness checkpoint remains open. Automatic outcome decisions and notifications remain disabled, and observation of the next scheduled collector invocations remains open. See [recovery operations](RECOVERY.md), [Phase 2 release](PHASE2.md), [Phase 3 release](PHASE3.md) and [Phase 4 scope and release](PHASE4.md).

The first release restores Bryan's existing account without requiring every page to appear in Google. Keep Firebase, Firestore and Vercel. Users continue making website changes themselves. The existing public URL and access remain unchanged. Bryan wants to use the tool on the current website, judge its practical value, fix inconsistencies during use, and later share it with friends and family. Old work stays archived and does not drive current recommendations; no history deletion or artificial data reset is needed. Phase 5 and broader new-content recommendations remain roadmap items.

Version 1 is for owners who may not know what SEO means. Lead with the current wording, suggested wording and next action; use plain labels, readable visual grouping and optional explanations. Color reinforces written labels rather than replacing them. More detailed controls for experienced users can come later.

## Phase 0 Preparation and safeguards

1. Preserve existing work on `codex/account-recovery`, including the reconnect fixes. Keep conversation reference files outside the release. The original patch is held locally outside the repository.
2. Verify the deployed Vercel project and source revision, Firebase project and function inventory, and the authenticated account's exact UID and Search Console property. Never infer identity from a domain string alone.
3. Establish tests with two fake users on `demo-simpleseo`, local Auth and Firestore emulators, mocked Google responses and blocked unexpected network calls. Test code must reject production Firebase configuration.
4. Record baseline lint/build results. Fix newly introduced issues without a general dependency or architecture migration.
5. Retire public legacy metric update/debug endpoints and random performance fallbacks. Keep the deployed Firebase function names as disabled handlers so older public URLs cannot continue running stale code.
6. Verify Firebase identity and ownership for recovery, crawl persistence, focus keyword persistence, Google connection writes and account deletion. Scheduled requests require a configured secret. This is a scoped safeguard, not completion of the full application's authorization audit.
7. Pause recovery-account progress decisions, outcome emails and playbook promotion. Retain raw Search Console observations. Label historical metrics unverified.
8. Before live writes, take a protected, local backup of affected account records and subcollections, retaining timestamps needed to detect concurrent changes. Do not commit backups, credentials or browser sessions.

Exit criteria: the test environment cannot target production; relevant ownership tests pass; production targets and backups are verified; unsafe legacy endpoints are disabled in both source and deployed functions.

## Phase 1 Account recovery

### Access and setup

- Remove revamp redirects and navigation locks for accounts that completed initial onboarding. Wait for authentication and onboarding state before routing.
- Make `/revamp` an optional website update screen linked from the dashboard. Zero pages, zero impressions, missing tokens and no available keywords never prevent dashboard access.
- Persist completion and optional keyword selections atomically. Skipping preserves saved keywords and never reactivates archived selections. Failed saves remain visible and do not advance the UI.
- Onboarding changes write only the intended fields and return an awaitable promise. Google monitoring owns observation fields.

### Historical records and repeat updates

- Create a user-scoped immutable snapshot of existing implementations, audits, suggestions and focus keywords before replacement. Strip credential fields. Interrupted snapshots resume without overwriting saved records; incomplete snapshots cannot be shown as complete history.
- Preserve existing archive flags on old work. Historical metrics remain unverified. Do not fabricate records already lost before recovery.
- Every subsequent website update receives a new run identifier. Delayed old-run checks cannot replace a new run's pages.
- Scans start only through an explicit user action and stage a review. A bounded or failed scan cannot prove a missing page was retired and cannot clear caches or saved preferences.

### Google connection and monitoring

- Use `users` as the primary connection record and the legacy token collection only for a compatible incomplete connection. Property mismatches require reconnecting.
- Refresh expired access tokens, retry an authorization failure once, retain refresh credentials on temporary errors, and preserve existing credentials if Google omits a new refresh token.
- Reconnect uses a one-time state bound to the signed-in user, verified popup source/origin and a matching callback. Cancelled or blocked popups report an actionable error without disconnecting the old account.
- Monitor each page with an exact page filter, preserving URL case and query strings. Search visibility is not indexing verification.
- Use a 28-day inclusive observation window ending three days before the current Pacific date, clamped to the website launch date. A launch with no eligible dates remains unchecked.
- Distinguish `not_checked`, `no_data` and `has_data`. Store attempts, successful observation dates, windows and errors separately. Preserve previous observations when Google fails.
- Continue daily monitoring after setup completion. Limit concurrent requests to four and isolate individual page failures. Defer revamp notification emails until data behavior is verified.

### Acceptance tests

- Existing stuck account: no search data, mixed pages, one/nine impressions, no keywords, no tokens; dashboard always available.
- Save failure, repeat completion, refresh, sign-out/sign-in, concurrent monitoring and new-run stale responses.
- Expired, missing, revoked and temporarily unavailable Google credentials; property mismatch; cancelled/blocked reconnect.
- Snapshot retry, partial scan, repeat revamp, historical read-only records, current work and keyword skips.
- Two-user ownership boundary, missing/invalid authentication, missing/wrong cron secret and disabled public maintenance routes.
- Ordinary login, onboarding, dashboard, settings and keyword flows remain usable. Production build and lint must finish.

### Release and Bryan's checkpoint

Release safeguards first. Verify the exact account and property, back up affected records, then apply the smallest idempotent migration. Run an authenticated manual check and confirm the next daily scheduled check. On rollback, retain safeguards and restore only recovery-owned fields whose values have not changed since migration.

Bryan verifies the live account:

1. Sign in and reach the dashboard without waiting for Google.
2. Open Settings and website update monitoring; pending pages do not lock navigation.
3. Continue with no keyword selections. Refresh, sign out and sign back in; access remains available.
4. View previous website work and confirm old work is retained without becoming active again.
5. Reconnect Google if requested. Cancellation leaves the dashboard available.
6. Confirm observed page results, dates and unavailable/no-data wording are understandable.

Stop here for feedback. Do not start Phase 2 until this checkpoint is accepted. An unverified deployment or live account is an open release gate, not a completed recovery.

## Phase 2 Reliable data and backend behavior

Audit the remaining authorization surface, Firestore rules and account deletion coverage. Replace ambiguous metrics with sourced observations, comparable before/after periods and explicit insufficient-data states. Review the monthly decision formula, pivot/audit/success transitions, retries and costs. Resume automated outcome processing only after reliable evidence and tests support it.

Implemented scope and release evidence are in [Phase 2](PHASE2.md), with supporting [data policy](PHASE2_DATA.md), [API access inventory](PHASE2_ACCESS.md), and [Firestore/deletion audit](PHASE2_RULES.md). The new collector can show observations and comparisons; automatic success/pivot/audit decisions, outcome emails and playbook promotion remain disabled. A count threshold is not proof that an SEO edit caused a result.

Bryan accepted the screen/navigation checkpoint: Dashboard, Low CTR Fixes and history load without errors. A new real implementation remains the next usage checkpoint, now supported by Phase 3's current-page task flow. Do not create fake implementations to populate the chart.

Operational follow-up: upgrade or retire the retained Firebase Functions Node 20 runtime before its CLI-reported October 30, 2026 decommission date, preserving the disabled legacy writer. Observe scheduled collection separately from successful manual route checks.

## Phase 3 A clearer dashboard and task flow

Prioritize page progress, the next useful action, change confirmation and understandable history. Reduce distracting metrics. Provide rebuild guidance with current URLs and intentional redirect planning; keep platform-specific website editing manual.

Implemented scope: a current-site dashboard with one dated Search Console window and direct page totals; explicit page selection and current HTML review; on-demand title/description drafts without requiring an old saved keyword; guarded confirmation of a real manual edit; redirect destination handling; less prominent history; an exportable URL plan for rebuilds. Search data is not an indexing report and Google does not supply the page's HTML title/description through this performance API. The verified live overview returned five pages for September 10–October 7, 2026; the earlier tracked-page monitoring counts use their own dates and are not an indexing verdict.

Bryan's Phase 3 checkpoint: choose one current page, inspect the fetched website wording, generate a draft, and decide whether the proposed change is useful. Only after publishing a real edit should he confirm it. Check that the saved change remains after refresh and appears in Page progress. Allow enough finalized search activity for comparison; progress is an observation, not proof that the tool caused an improvement. Continue with feedback before broadening recommendation features.

## Phase 4 Better recommendations and new content

Current authorized scope is a generalized review of an existing page, not a compulsory title rewrite. Version 4 combines fresh first-party content and structure, six dated Search Console history windows, up to 1,000 current/previous query rows sorted by impressions (top 40 supplied per period to the model), Google inspection for the selected URL, and at most two source-linked pages with a maximum of three inspections. It interprets the page's purpose and an optional 180-character owner goal before recommending an appropriate heading, content, link, technical, metadata or diagnostic task. Source markup is not rendered visual evidence; Google's stored index view is not a live test. No additional SEO-data provider is included.

The review uses the existing OpenAI account with `gpt-6.1-sol`, medium reasoning and a 6,500-token assessment cap. Automatic public research stays bounded and separate from private Search Console data. At most three ranked recommendations include evidence and concrete instructions; proposed business wording must be supported by the selected page's own content. Metadata can remain unchanged while another useful action is proposed. The interface shows actual searches/positions and available diagnostics instead of asking the owner to repeat checks already completed. Detailed architecture, limits and release gates are in [Phase 4](PHASE4.md).

Owners still publish every change themselves. Only a real published metadata or page-content edit should be confirmed and tracked. Content confirmations require the owner's published declaration and short change summary; a diagnostic check is not a published edit. The existing ownership, current website-run, duplicate-change and archived-history guards remain in place. Review checkpoints suggest recrawl inspection after 1–2 weeks, early signals around 4 weeks, and a fuller review around 8–12 weeks, with longer for sparse data. These are estimates, not promised improvements or waiting-room gates.

The first version 4 release passed 375 unit/API tests, 39 browser scenarios, a production compilation and focused model checks. Four of six initial model cases passed; two valid first-party observation quotations exposed validator gaps, and both focused reruns passed after correction. Production `0018464` was promoted and live account verification passed without changing the website or archives. Its review still delegated a related-page comparison to the owner, so a refinement now fetches up to three exact phrases across two related URLs and two periods, preserving missing observations. That refinement passes 398 unit/API tests; its final browser/model/release checks remain pending. Full lint retains 11 baseline warnings. These checks establish behavior, not ranking benefits.

Checkpoint after release: Bryan analyzes his homepage and a service page, reviews the specific task, rationale and sources, and decides whether the recommendation is useful. If he publishes a worthwhile edit, confirm it once, refresh and check Page progress. Interface acceptance alone does not require an edit. No result, recommendation or observed search change guarantees or proves a ranking benefit. Keep the existing public URL and Firebase/Firestore/Vercel stack; advance only after the workflow proves useful in Bryan's own use.

Later scope: recommend new service/location pages based on real differences and customer value. Avoid mass-produced duplicates and promises of indexing or ranking. This remains at roadmap level until the existing-page pilot establishes useful recommendations.

## Phase 5 Pilot and product economics

**Deferred.** Finish the version 4 release and Bryan's usefulness checkpoint first. Use Bryan's website as a pilot, then a small group of owners. Measure completed tasks, useful recommendations, support time, API costs and retention. Validate the approximately $50 monthly price without promising agency-equivalent results. Consider Supabase/Railway migration separately after the current product works reliably.

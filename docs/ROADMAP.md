# SimpleSEO master roadmap

Status on October 10 2026: Bryan accepted the account recovery checkpoint after checking history, refreshing, and signing out and back in. Phase 2 implementation and isolated verification are complete; production release verification is in progress. The next automatic scheduled invocation remains unobserved. See [recovery operations](RECOVERY.md) and [Phase 2 release](PHASE2.md).

The first release restores Bryan's existing account without requiring every page to appear in Google. Keep Firebase, Firestore and Vercel. Users continue making website changes themselves. Bryan authorized Phase 2 after accepting recovery; Phases 3–5 remain roadmap items.

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

Bryan's next checkpoint: reload Dashboard and Low CTR Fixes, confirm Page progress and preserved history are understandable, and confirm a real website edit only after making it. Do not create fake implementations to populate the chart. Stop for this feedback before the Phase 3 dashboard redesign.

## Phase 3 A clearer dashboard and task flow

Prioritize page progress, the next useful action, change confirmation and understandable history. Reduce distracting metrics. Provide rebuild guidance with current URLs and intentional redirect planning; keep platform-specific website editing manual.

## Phase 4 Better recommendations and new content

Distinguish observed search queries, inferred ideas and verified competitor research. Evaluate affordable research sources before committing to provider costs. Recommend useful service/location pages based on real differences and customer value; avoid mass-produced duplicates and promises of indexing or ranking.

## Phase 5 Pilot and product economics

Use Bryan's website as a pilot, then a small group of owners. Measure completed tasks, useful recommendations, support time, API costs and retention. Validate the approximately $50 monthly price without promising agency-equivalent results. Consider Supabase/Railway migration separately after the current product works reliably.

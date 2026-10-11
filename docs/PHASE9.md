# Phase 9 — Personalized SEO Mentor

## Implementation and release status

Implemented in the shared workspace on October 11, 2026. The public deployment has **not** been updated. The real-model quality gate is blocked by two documentation-grounding failures; a bounded repair evaluation is awaiting Bryan's approval because the initial 32-answer limit has been reached. No additional generation is permitted by the evaluation runner without an explicit operator action.

The widget and `/chatbot` now share one conversation service, account-evidence reader, policy, model configuration and renderer. The mentor explains SEO, interprets saved account records and offers explicit observation checks. It cannot edit a profile or plan, publish, request indexing, confirm a task, change a publication date or reset a progress cycle. New attachments are hidden; historical attachments remain readable.

## Evidence and documentation

`mentorAccountScope` resolves account, property, website version and profile revision without refreshing OAuth. `mentorEvidence` supplies bounded saved business facts, partial inventory, exact-page activity, task plans, original/subsequent comparisons, follow-up decisions and new-page plans/publication observations. Relevant substantive revisions are checked before returning an answer and again in its save transaction. External content and previous AI answers remain evidence, never instructions.

`mentorActivitySnapshots` is the common collector/cache for dashboard, page activity and mentor. Cache keys include scope and reporting windows; ordinary data is reused for six hours. Explicit activity checks share leases and a 15-minute cooldown. Failed refreshes retain the previous successful observation and its original dates, including across rolling-period boundaries. Missing observations, no reported rows and measured zero values remain distinct. Query totals are incomplete; average position is not a fixed Google results page. Pacific reporting dates and the three-day reporting buffer remain unchanged.

`mentorChecks` checks one selected page or progress cycle with a 60-second deadline and 20-per-account daily limit. Technical checks store live HTML findings separately from Google's stored indexing observation. They do not generate AI suggestions or modify task/progress confirmations. Saved mentor reads perform no provider requests.

The documentation registry uses approved Google Search Central, Search Console Help and Business Profile Help URLs. Native extraction caches dated article passages for seven days. Failed retrieval retains dated references with a stale notice. Titles and descriptions retrieve separate title-link, snippet and meta-description ranking guidance. Topic-specific passages avoid losing substantive guidance behind a long introduction.

Optional public research is a separate Responses request containing only fixed generic SEO topics, with Google-domain filtering and validated documentation paths. Account data and conversations never enter that search request. Retrieved source IDs, metric IDs and action IDs must match server evidence before an answer can be saved. The final renderer creates source links and SimplSEO actions from those validated records.

## Conversations and UI

`/api/mentor` exposes saved workspace/conversation/turn reads and explicit create, send, activate, rename, delete and check operations. Authenticated identity is injected server-side. Existing conversation endpoints delegate to guarded persistence; whole-message-array writes and both legacy generation routes are retired. Firestore denies direct client access to authoritative mentor/conversation records.

Messages are append-only, with a saved user turn before generation, revision checks, idempotent turn IDs and one generation lease per account. Completed retries read the same answer. Failed or interrupted turns retain the question and previous replies, and offer an explicit paid retry rather than silently issuing another request. Account/website changes and deletion are revalidated before saving. Usage IDs include account and conversation identity to prevent collisions between client request IDs.

Both interfaces restore the server's active conversation. Existing IDs, titles, dates and messages remain; legacy or old-website conversations are labeled read-only history. Continuing them starts a current scoped conversation without treating old metrics as current facts. Titles derive from the first question without a paid call. Scoped unsent drafts clear on logout/account changes. No new mentor content is duplicated into training logs.

The interface includes consistent Markdown, post-save typing animation, Show full answer, reduced-motion support, copy, retry, history search/rename/delete, dated metric cards and collapsed sources. Existing scroll position is retained while reading older messages. Explicit page/data checks render independent availability and failure states. The privacy page now describes context-based personalization and saved conversations instead of automatic per-business training.

## Costs and operating limits

| Control | Limit |
| --- | --- |
| Model | `gpt-6.1-sol`, Responses, low reasoning, Standard tier |
| Account turns | 5/minute, 50/day; 1 concurrent generation |
| Main answer calls | 3: up to 2 evidence-tool rounds, then final answer |
| Evidence | 6 reads, at most 3 distinct pages |
| Public research | 1 request, at most 2 searches/turn and 10/day/account |
| Controlled input/output | 24,000 cumulative input tokens; 6,000 cumulative output tokens including reasoning/research |
| Deadline | 120 seconds including validation and persistence |
| Pilot budget | $25/month across mentor accounts, including $10 evaluation subset |
| Initial evaluation | 32 completed answers; 128 maximum provider attempts |

Atomic reservations use a versioned official pricing configuration covering input, cached input, cache writes, output and search. Hosted search-content usage has a separate conservative allowance. Preflight input uses a conservative byte bound, then charges reported input tokens rather than repeatedly treating bytes as tokens. Unknown provider usage retains its reservation. This is an estimated spending control, not a guaranteed invoice cap. SDK automatic retries and paid title/summary generation are disabled. Private usage records contain accounting fields, never conversation text.

Initial real evaluation used 71 provider attempts, including one stopped by the conservative input-allowance check; 32 completed answers were reviewed. The aggregate ledger estimates **$0.267201**, with no outstanding reservation, as of October 11. No public web-search model calls were used in that initial evaluation. An actual live research request remains a release checkpoint.

## Verification and remaining checkpoints

- Full unit/security regression suite: 1,114 tests passed across 62 files, including documentation and input-accounting repair tests.
- 12 distinct mentor browser scenarios passed on desktop/mobile, including continuity, reduced motion, retry restoration, scoped drafts, legacy history, explicit checks and paused generation. Two development-server authentication-start interruptions passed on isolated rerun.
- 98 onboarding/new-page/progress/actual Firestore-rules browser regressions passed.
- Production build passed. Lint has no errors and seven existing warnings outside the new mentor components.
- Independent real-model review: 30/32 pass (93.75%). No fabricated account facts, unsupported penalty claims, cross-account disclosure or unauthorized changes. Two accurate meta-description answers did not retrieve supporting snippet/ranking documentation, which blocks release despite the overall percentage. See `phase9-quality-review.json`.
- The retrieval fix has mechanical tests and was checked against the actual official documents without an AI call. The corrected real-model answers still require the authorized bounded recheck.

No synthetic observations, published edits or conversations were added to Bryan's account. Only explicit evaluation accounting and shared public-document caches were written. All scenario data lives in the isolated evaluator.

After the quality gate passes:

1. Deploy private rules/indexes and shared APIs, then stage a production build without assigning the public domain.
2. Run `scripts/verify-mentor-release.cjs <privateIdentityFile> <stagedOrigin>` using protected-deployment access. Saved reads must preserve account records, dates and usage counts.
3. Enable Bryan's server-side allowlist first. Compare a real homepage answer against saved numbers/tasks and ask the indexing-misconception question with actual evidence. No fake metrics or publication confirmations.
4. Bryan reviews the educational/personalized/collecting/unavailable/off-topic experience and widget/full-page continuity, including refresh and sign-in restoration.
5. Run one requested `--investigate=activity` or `--investigate=technical` check and verify dated observations, usage and unchanged task/publication/progress records. Verify live documentation research separately within the same pilot budget.
6. Inspect runtime errors and actual spend before broadening enrollment.

## Rollout and rollback

Server switches are independent: `MENTOR_ENABLED`, `MENTOR_PILOT_UIDS`, `MENTOR_GENERATION_ENABLED`, `MENTOR_RESEARCH_ENABLED`. All default to disabled. Restrict the pilot allowlist to Bryan until live checkpoints pass; never expose it to the browser. Disabling generation keeps saved conversations and sources readable. Disabling research does not remove cached official documentation or general SEO help.

Rollback pauses generation/research and new enrollment while preserving conversations, sources, account work and read-only history. Do not restore legacy browser message writes or old unbounded generation endpoints. Tests cover paused generation and readable history. No new cron, background AI, email, automatic publishing, indexing requests, fine-tuning, screenshot analysis or Firecrawl dependency is introduced.

Provider references: [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling), [filtered web search](https://developers.openai.com/api/docs/guides/tools-web-search), [official pricing](https://developers.openai.com/api/docs/pricing).

# Phase 9 — Personalized SEO Mentor

## Implementation and release status

Implemented on October 11, 2026 and enabled for Bryan's pilot account. The initial two documentation-grounding failures passed the explicitly authorized supplemental citation rechecks. Original failed results remain in the quality report. Live verification corrected an empty-search compatibility bug and an oversized real-account evidence payload. Both real pilot answers now pass independent evidence review. Live research testing corrected a conservative token estimate and excessive search-context use before final pilot acceptance. The current public build is `a7e40cc` / `dpl_9miGBiGASRQuMqG39Hhh84QQD1RK`, production READY. Supplemental evaluation never runs automatically.

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

Model context uses compact projections of saved tasks and observations. Repeated task evidence and duplicate recommendation bodies are omitted; owner-copy excerpts and omitted fields are labeled. Complete owner edits, task statuses, confirmation dates, mixed-version cautions, technical errors and comparison history remain saved unchanged. Metric totals and reporting dates are not truncated. The real homepage context fell from 35,921 to 9,608 bytes. Requests still fail safely if their combined evidence exceeds the unchanged input allowance. Private turn diagnostics retain only an allowlisted failure category and numeric bounds, never prompts, answers or raw provider errors.

Compact progress evidence retains the saved decision's original review date, checkpoint ID/revision, acceptance date and source plan revision. A checkpoint-match indicator distinguishes earlier advice from a newer available comparison.

## Costs and operating limits

| Control | Limit |
| --- | --- |
| Model | `gpt-6.1-sol`, Responses, low reasoning, Standard tier |
| Account turns | 5/minute, 50/day; 1 concurrent generation |
| Main answer calls | 3: up to 2 evidence-tool rounds, then final answer |
| Evidence | 6 reads, at most 3 distinct pages |
| Public research | 1 request, 1 search/turn (within the agreed two-search ceiling), 10/day/account |
| Controlled input/output | 24,000 cumulative input tokens; 6,000 cumulative output tokens including reasoning/research |
| Deadline | 120 seconds including validation and persistence |
| Pilot budget | $25/month across mentor accounts, including $10 evaluation subset |
| Initial evaluation | 32 completed answers; 128 maximum provider attempts |

Atomic reservations use a versioned official pricing configuration covering input, cached input, cache writes, output and search. Hosted search-content usage has a separate conservative allowance. Preflight input uses a conservative byte bound; if that would reject a request, the same authorized OpenAI account counts the exact controlled input through `/responses/input_tokens` before generation. Counts have an eight-second timeout, no retries, and at most one check per controlled request (four per turn, including research). An unavailable/invalid count fails closed. Actual reported input is charged cumulatively against the unchanged 24,000-token cap. Unknown provider usage retains its reservation. This is an estimated spending control, not a guaranteed invoice cap. SDK automatic retries and paid title/summary generation are disabled. Private usage records contain accounting fields, never conversation text.

Initial real evaluation used 71 provider attempts, including one stopped by the conservative input-allowance check; 32 completed answers were reviewed. The aggregate ledger estimates **$0.267201**, with no outstanding reservation, as of October 11. No public web-search model calls were used in that initial evaluation. Live research requests subsequently ran during the pilot; their failed answer turns are recorded below.

## Verification and remaining checkpoints

- Full unit/security regression suite: 1,117 tests passed across 62 files, including documentation and input-accounting repair tests.
- 12 distinct mentor browser scenarios passed on desktop/mobile, including continuity, reduced motion, retry restoration, scoped drafts, legacy history, explicit checks and paused generation. Two development-server authentication-start interruptions passed on isolated rerun.
- 98 onboarding/new-page/progress/actual Firestore-rules browser regressions passed.
- Production build passed. Lint has no errors and seven existing warnings outside the new mentor components.
- After the live context fix, the full suite passed 1,127 tests across 63 files. A subsequent focused run passed 71 tests, including two added realistic evidence-size/preservation cases. The separate read-only pilot verifier has three passing tests.
- Independent real-model review: 30/32 pass (93.75%). No fabricated account facts, unsupported penalty claims, cross-account disclosure or unauthorized changes. Two accurate meta-description answers did not retrieve supporting snippet/ranking documentation, which blocks release despite the overall percentage. See `phase9-quality-review.json`.
- The retrieval fix has mechanical tests and was checked against the actual official documents without an AI call. Both corrected real-model answers passed independent review under policy `mentor-9.2`, citing the actual supporting Google documents.

Supplemental checks added two completed answers and one interrupted failed attempt, for 77 provider attempts in total. The current ledger estimate is **$0.288345 spent plus $0.78 held** for an unknown provider outcome. The held amount is not counted as free. The initial 30/32 result and both original failures remain unchanged in the report; all 32 latest reviewed scenario results pass after the targeted fixes. The complete send path now has a 120-second deadline, including slow database operations, with generation stopped earlier to allow persistence.

No synthetic observations, fictional published edits or simulated conversations were added to Bryan's account. Evaluation wrote only private accounting and shared public-document caches; all scenario data lives in the isolated evaluator. The live pilot separately created a real homepage question and refreshed its actual Search Console observation. Its first reply failed before a second model call because repeated task evidence exceeded the input bound. That attempt cost $0.004096 and left the question saved without an assistant reply. This failure remains in history rather than being disguised as a successful test.

The real homepage retry passed independent source/metric/task review in 16 seconds. The general indexing question first failed the byte preflight after a completed documentation search, and a later retry correctly hit the real cumulative input limit: two hosted searches used 17,021 input tokens, leaving 5,218 against an exact 6,029-token next request. These failures prompted single-search research and an early final-answer path that reserves room for the explanation. No successful answer is claimed for those failed turns; their questions and earlier replies remain saved. The final correction caps research at one hosted search and forces the next main call to answer from available evidence. Under input pressure, only documentation excerpts are shortened at complete-sentence boundaries with explicit truncation and citation filtering. Cached documents and account facts remain unchanged. All 142 Mentor tests, focused lint and independent review pass for commit `a7e40cc`.

Release and live checkpoints:

1. Firebase rules/indexes were deployed. The staged production build passed 28 authenticated/anonymous/cross-account/legacy-endpoint checks. All 233 captured saved records and usage records stayed unchanged; retired writes returned 410. The exact tested build was promoted to the existing public URL, restricted to Bryan's pilot account.
2. The real homepage answer matched saved figures, dates and the three unfinished tasks. The researched indexing answer completed in 25.8 seconds with 18,383 input tokens, 817 output tokens, three provider calls and one search. Independent review confirmed source relevance, uncertainty about penalties and disclosure of unavailable indexing guidance. No service-page indexing finding was invented.
3. The read-only before/after audit confirmed both saved answers' source identities, metric cards and permitted actions, plus unchanged scope/profile and 12 protected account/plan/publication/cycle documents. One actual requested homepage activity refresh succeeded at 15:44:13 UTC; no tasks or publication dates changed.
4. Live widget → full Mentor, page switching and full refresh restored the same conversation. Bryan's real logout/sign-in and usefulness review remain owner checkpoints; isolated continuity tests passed. The [five-state preview](phase9-preview.html) remains available for review. Synthetic preview data never entered his account.
5. The final deployment error-log scan returned no error entries in the retained window. Earlier failed turns remain saved and accounted for. The monthly ledger now estimates **$2.370364 spent plus $0.78 held**; the evaluation subset is **$0.288345 spent plus $0.78 held**, both within their $25/$10 limits. These conservative estimates are not provider invoices.
6. Broader enrollment remains off pending Bryan's feedback. No extra cron or background generation was added. See [sanitized release evidence](evidence/phase9-pilot-release-2026-10-11.json).

The single overnight follow-up is separately recorded in [the October 11 tracking audit](evidence/overnight-tracking-2026-10-11.json). Both persisted scheduled runs completed without errors/backlog, but predated Phase 7. Its first expected progress run is October 12 at 02:00 UTC. Historical provider log correlation was unavailable, and zero active cycles/new-page publications does not exercise real-page collection.

## Rollout and rollback

Server switches are independent: `MENTOR_ENABLED`, `MENTOR_PILOT_UIDS`, `MENTOR_GENERATION_ENABLED`, `MENTOR_RESEARCH_ENABLED`. All default to disabled. Restrict the pilot allowlist to Bryan until live checkpoints pass; never expose it to the browser. Disabling generation keeps saved conversations and sources readable. Disabling research does not remove cached official documentation or general SEO help.

Rollback pauses generation/research and new enrollment while preserving conversations, sources, account work and read-only history. Do not restore legacy browser message writes or old unbounded generation endpoints. Tests cover paused generation and readable history. No new cron, background AI, email, automatic publishing, indexing requests, fine-tuning, screenshot analysis or Firecrawl dependency is introduced.

Provider references: [Responses function calling](https://developers.openai.com/api/docs/guides/function-calling), [filtered web search](https://developers.openai.com/api/docs/guides/tools-web-search), [official pricing](https://developers.openai.com/api/docs/pricing).

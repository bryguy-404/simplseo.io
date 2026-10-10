# Phase 4: evidence before recommendations

Bryan authorized implementation on October 10, 2026 after reviewing the first live draft. The draft was a weak paraphrase, not a justified improvement. No website edit is required to complete that review checkpoint. Keep the public URL, Firebase/Firestore, Vercel, manual publishing, immutable history and disabled automatic outcome decisions.

## Scope and sequence

1. Read fresh exact-page HTML and collect server-owned Search Console evidence for the latest finalized 28 days and the preceding 28 days. Keep property, URL and dates explicit; preserve no-data, limited-data and failed-query states. Page totals are separate from partial query rows. Include relevant alternative pages only when Google actually returned their URLs for the selected phrase.
2. Replace unconditional rewriting with a structured assessment: revise metadata, keep current wording, improve page content, review another observed page, or collect more evidence. Require a specific reason, a next step and references to supplied evidence. A revision must address a supported mismatch; an unchanged or merely cosmetic rewrite must not become a tracking task.
3. Upgrade this page-review workload through the existing OpenAI API account. Start with GPT-6.1 Sol and compare it with Astra on representative cases if both are accessible. Use bounded Responses requests, strict output shape, no automatic retries, conservative factual checks and an explicit failure if the chosen model is unavailable. Other AI features are outside this model migration.
4. Offer optional web research through OpenAI only. Send public page context, not account identifiers, credentials or private performance data, into search. Return actual cited source URLs; do not describe search ordering as exact Google rankings or infer competitor traffic/volume. Failed research is visible and does not fabricate evidence. Cap calls and per-account research usage.
5. Keep the beginner interface: Analyze this page, a short recommendation and explanation, supporting evidence behind a disclosure, and blue current/violet proposed wording. Only a metadata-revision decision enables the existing publishing/confirmation flow. A no-change decision is a valid useful result.
6. Test in isolated demo services, evaluate model output on real/public and controlled examples, stage a production build, verify access boundaries, then promote to the existing URL. Check Bryan's live evidence without publishing or confirming a fictitious change.

## Acceptance and testing

- Exact URL/property, authenticated ownership, redirects and website-run changes remain guarded before spending and after analysis.
- Evidence tests cover both date windows, totals vs query rows, malformed metrics, missing rows, partial failures, keyword provenance and alternative-page scope.
- Policy/provider tests cover justified edits, keep-current decisions, content-only actions, insufficient evidence, invalid source IDs, unsupported claims, cosmetic/identical drafts, unsafe research URLs, incomplete/refused/provider failures, bounded calls/tokens and request quotas.
- Browser tests cover the simple assessment, expandable sources, research unavailable, no-change without an enabled publishing action, useful drafts, existing confirmation errors/reload and stale-response resets. Inspect desktop/mobile and light/dark layouts.
- Live evaluation assesses factual grounding, specific justification, willingness to retain good wording and cost/latency. Passing software tests is not evidence of ranking improvement.
- Run the existing unit/API suite and relevant browser/rules scenarios, scoped lint and production build. Record actual evidence below; never claim unchecked gates passed.

## Limits and next checkpoint

This release concerns existing-page decisions and title/description recommendations. Broad new service/location pages, automatic website edits, paid third-party SEO providers and automatic success/pivot decisions are excluded. Web research supplies context, not a rank-tracking database. Source references and output validation reduce errors but cannot prove every interpretation. Measured search changes remain observational.

Bryan will analyze the homepage and one service page, check the recommended action and its explanation, and decide whether any draft deserves publication. Keep-current is acceptable. Only a real published edit should be confirmed and tracked; the live confirmation checkpoint remains open until then.

## Release and rollback

Phase 4's existing-page review is deployed and verified; Bryan's recommendation-review checkpoint is next. The immediate application rollback target is `dpl_GoVGseABraevriGst99NibCh8XJk` (source `6ef2239`). This release includes no Firebase rules/function deployment or recovery-data migration. Rollback must preserve current account data, history, confirmed edits and Phase 2 safeguards. Existing scheduled-collector observation and Firebase runtime maintenance remain separate operational items.

## Implementation and evaluation evidence

- Page review now uses `gpt-6.1-sol` with the Responses API, strict structured output, low reasoning effort, a 3,500 output-token cap and no provider retry. Other existing AI features retain their previous configuration.
- Fresh evidence includes separate exact-page totals and up to 20 query rows for each of two adjacent finalized 28-day windows. The optional related-page lookup returns at most five pages for the first selected phrase. The newest three days are excluded; these review windows are not a test of an edit.
- Reviews have per-account transactional limits of five attempts per minute and 20 per UTC day; at most five per day may include research. Failed attempts count. These operate inside the existing shared AI limits, and are usage controls rather than billing entitlements. Research uses at most two tool calls and 1,800 output tokens. Only public page context enters search.
- A bounded six-request live evaluation compared Sol and Astra on the public Bryan Develops homepage, a clear service page with sparse synthetic search observations, and a generic title with a missing description. Both returned all three expected actions and passed output validation. Both retained the homepage and clear service wording, and revised the missing metadata. Responses took roughly 3.7–5.8 seconds. This small check supports the initial model choice; it does not demonstrate ranking benefits or general superiority over Astra.
- One separate live research request returned three actual cited public sources in about 11.5 seconds. It used 13,141 input tokens and 381 output tokens. It supplied content comparisons and customer questions, without claiming exact Google rankings. Actual spend depends on provider prices and future usage; Phase 5 economics remain open.
- Software checks include 278 passing unit/API tests across 21 files and all 31 browser/API/rules scenarios passing against the isolated production build with demo services. The first broad development-server run lacked the recovery fixtures; a subsequent development run encountered a reload during login. Seeding the demo accounts and using the stable compiled build produced the complete passing suite. Full lint has zero errors and the same 11 pre-existing warnings; changed backend files and explicit `.js`/`.jsx` UI lint pass without warnings. Desktop dark/light, mobile, keep-current, expanded evidence and research-citation screens were visually checked.
- An independent backend review found no outstanding blocker. Source IDs, exact page quotations and conservative claim checks reduce unsupported output but cannot prove every semantic interpretation. Quota tests exercise boundaries and isolation; concurrent Firestore transaction contention was not simulated by the unit-test double.

## Production verification

- Application source: `1602616`. **Production READY:** `dpl_ANt5Qjqu51GsfTNe7u9hDYC46uGs`, [deployment](https://simplseo-jcbv0fhmu-bryan-arambulas-projects.vercel.app), serving the unchanged [SimplSEO URL](https://simplseo-io.vercel.app). Project `simplseo-io` and its existing team were verified before staging. The protected staged review route returned the application's HTTP 401, then this same build was promoted. Public-URL inspection confirmed the exact deployment. Vercel reported a 7m 18s build; post-build duration was unavailable. Framework remains Next.js 15.3.6; public access settings were not changed.
- Authenticated live verification on Bryan's exact account/property passed after promotion: four anonymous and four cross-account route checks were blocked. The current overview returned five pages and 27 daily observations for September 10–October 7, with seven clicks and 169 impressions. These are search observations, not an indexing report.
- One explicit researched review of the live homepage returned `keep_current` using `gpt-6.1-sol`, available Google evidence with 25 source facts, and three actual cited web sources. Returned HTML, content fingerprint, exact URL/property/run, dates and source IDs passed validation. This was an analysis, not a published or confirmed website edit.
- Active changes remained zero; active implementation IDs and all 18 archive snapshots remained unchanged. No authorized confirmation was sent. Automatic outcomes and notifications remain disabled.
- The existing verifier now supports Phase 4: `node scripts/verify-phase3-release.cjs UID EXACT_PROPERTY --draft [--research]`. The retained `--draft` name means one explicit assessment request; non-revision actions are valid. Research requires explicit opt-in. It never publishes or confirms an edit.
- A deployment-scoped error-level log query covering the 20-minute release/verification window returned zero records. This bounded check does not establish future scheduled-collector health.
- Temporary local test servers were shut down after testing. Bryan's next checkpoint is the homepage/service-page review above; a real edit and its future observation period remain intentionally open.

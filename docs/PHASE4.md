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

Pending implementation verification. The prior production application is `dpl_GoVGseABraevriGst99NibCh8XJk` (source `6ef2239`). Rollback must preserve current account data, history, confirmed edits and Phase 2 safeguards. Existing scheduled-collector observation and Firebase runtime maintenance remain separate operational items.

## Implementation and evaluation evidence

- Page review now uses `gpt-6.1-sol` with the Responses API, strict structured output, low reasoning effort, a 3,500 output-token cap and no provider retry. Other existing AI features retain their previous configuration.
- Fresh evidence includes separate exact-page totals and up to 20 query rows for each of two adjacent finalized 28-day windows. The optional related-page lookup returns at most five pages for the first selected phrase. The newest three days are excluded; these review windows are not a test of an edit.
- Reviews have per-account transactional limits of five attempts per minute and 20 per UTC day; at most five per day may include research. Failed attempts count. These operate inside the existing shared AI limits, and are usage controls rather than billing entitlements. Research uses at most two tool calls and 1,800 output tokens. Only public page context enters search.
- A bounded six-request live evaluation compared Sol and Astra on the public Bryan Develops homepage, a clear service page with sparse synthetic search observations, and a generic title with a missing description. Both returned all three expected actions and passed output validation. Both retained the homepage and clear service wording, and revised the missing metadata. Responses took roughly 3.7–5.8 seconds. This small check supports the initial model choice; it does not demonstrate ranking benefits or general superiority over Astra.
- One separate live research request returned three actual cited public sources in about 11.5 seconds. It used 13,141 input tokens and 381 output tokens. It supplied content comparisons and customer questions, without claiming exact Google rankings. Actual spend depends on provider prices and future usage; Phase 5 economics remain open.
- Software checks include 278 passing unit/API tests across 21 files and all 31 browser/API/rules scenarios passing against the isolated production build with demo services. The first broad development-server run lacked the recovery fixtures; a subsequent development run encountered a reload during login. Seeding the demo accounts and using the stable compiled build produced the complete passing suite. Full lint has zero errors and the same 11 pre-existing warnings; changed backend files pass scoped lint. Desktop dark/light, mobile, keep-current, expanded evidence and research-citation screens were visually checked. Release and live account evidence will be recorded below after their gates complete.
- An independent backend review found no outstanding blocker. Source IDs, exact page quotations and conservative claim checks reduce unsupported output but cannot prove every semantic interpretation. Quota tests exercise boundaries and isolation; concurrent Firestore transaction contention was not simulated by the unit-test double.

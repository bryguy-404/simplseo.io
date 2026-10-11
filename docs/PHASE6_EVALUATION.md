# Phase 6 recommendation-quality evaluation

Evaluated October 10, 2026 using the configured `gpt-6.1-sol` model. This is a bounded synthetic quality check, not evidence of ranking improvement or business outcomes.

## Reviewed cases and outcomes

The offline fixtures cover roofing, plumbing, landscaping and web services. Each has a supported, separately offered service gap and a matched website where that service is already covered. The same eight assessments were requested twice to check consistency.

| Case | Expected and observed result |
| --- | --- |
| Roofing: separately booked inspection versus replacement | Recommend the inspection page only when its detail page is missing |
| Plumbing: camera inspection versus drain clearing | Recommend the camera page only when its detail page is missing |
| Landscaping: drainage assessment versus garden maintenance | Recommend the assessment page only when its detail page is missing |
| Web services: content review versus website design | Recommend the review page only when its detail page is missing |
| Roofing and plumbing with synonymous existing titles/URLs | Recognize existing intent coverage; no new page |
| Explicitly unserved target location | Decline a location page and explain the service-area conflict |
| Neighboring city already covered by the same service page | No redundant city page |

All final decision checks passed. The first batch exposed two overly strict validator rejections of correct recommendations that said an observed query did **not** establish search volume. The validator now permits narrowly worded negative evidence limitations while rejecting positive/numeric demand claims. Both affected fixtures were rerun twice and passed; all 16 original assessments also passed offline revalidation under the corrected policy.

The unserved-location fixture initially required a `needs_information` outcome. The model instead correctly returned `no_opportunity` because the owner explicitly said the location was not served. The reviewed rubric now permits either declining or asking for clarification, while requiring no new page. This was an evaluator correction, not permission to recommend unsupported locations.

## Draft and human review

Two selected gap cases produced complete drafts, each checked by the production evidence validator and a separate model audit. Both passed. Manual review checked all assessment outputs and both drafts against the supplied facts:

- Service and area claims came from the synthetic first-party/owner evidence.
- Drafts explained a distinct customer decision, deliverables and service limits; they did not create city-name variants.
- Prices, turnaround time and other unavailable details appeared as optional owner questions, not invented finished copy.
- Suggested links pointed to supplied existing pages; slugs did not duplicate them.
- Hostile third-party instructions in the web-services fixture were not followed.
- No unsupported demand, Google indexing result or ranking improvement appeared in accepted copy.

Several early summaries approached the schema character limit and ended awkwardly. The prompt now asks for short complete sentences with room below the hard limits. One covered case and one gap case were rerun after this adjustment; both returned concise, complete explanations and the correct decision.

## Usage and reproducibility

The run made **30 paid model requests**: 16 initial assessments, two drafts, two audits, four targeted regression assessments, four additional risk assessments, and two final explanation checks. All provider responses reported usage. Aggregate tokens: **61,332 input, 9,488 output, 70,820 total**. Token totals are not a dollar invoice; provider cache accounting affects cost.

No public research calls, Google reads, customer records, database writes, website edits, or publication confirmations were made. Private generated-output artifacts are under `/private/tmp/simpleseo-phase6-new-pages-*.jsonl`; this document intentionally excludes full generated copy and account credentials.

Run the offline fixture review with:

```sh
node scripts/evaluate-new-page-planning.cjs --list
node scripts/evaluate-new-page-planning.cjs --list --risk-checks
```

`--live` makes paid requests using the configured account. `--case EXACT_NAME`, `--assessments-only`, and `--single-pass` permit bounded targeted regressions. Default live mode is capped at 20 requests; risk-check mode uses four. Automatic provider retries are disabled.

## Limits and release use

These fixtures deliberately provide clear confirmed service facts and complete synthetic inventories. They do not demonstrate complete crawling of real websites, reliable competitor rankings, keyword demand estimation, actual Google indexing or SEO gains. Unit/API tests separately cover unreadable and unreviewed pages, JavaScript-only shells, incomplete inventory, authorization, saved work and rejected unsupported output. Real-account inventory/area review, an appropriate live draft, manual publication and overnight tracking remain separate checkpoints. A passing synthetic evaluation does not replace them.

# Phase 8 extraction evaluation

## Scope and results

The structured business extractor was evaluated with the existing `gpt-6.1-sol` configuration against eight reviewed synthetic fixtures, each requested twice. Fixtures span roofing, plumbing, landscaping and web services, plus prompt injection, absent facts, retired services, FAQ evidence and a client's location that must not become the business's service area. They do not establish Firecrawl rendering quality or general production accuracy.

The initial 16 calls produced ten rubric passes and six failures. Four failures were supported wording variants that the original exact-match rubric rejected (for example, a city with its stated region). Reviewed allowlists were widened only for those supported equivalents. Offline replay then passed 14/16 without provider calls.

The remaining two were a real defect: a portfolio client's Tokyo location was proposed as business coverage. The extraction instructions and validation were tightened to exclude third-party and explicitly negated locations. Exactly two paid repair checks were made for that case; both passed. Original reports retain their original failures. This focused repair is not a second full independent benchmark.

Total: **18 model requests, 11,788 input tokens, 3,562 output tokens, 15,350 total tokens**. No automatic retries, production account writes or Firecrawl requests. Owner confirmation remains required even when extraction passes validation.

- [Original 16-call report](evidence/phase8-extraction-original.json)
- [Two-call repair report](evidence/phase8-extraction-repair.json)
- [Original report under the reviewed rubric](evidence/phase8-extraction-replay.json)

The offline original replay deliberately retains the two client-location failures. The final validator rejects those original payloads; the corrected model outputs pass. Do not change historical report flags to claim a clean original run.

## Firecrawl gate remains closed

No Firecrawl credential was available. The approved comparison on eight real websites across WordPress, Wix, Squarespace, Shopify and custom sites was not run. Before enabling fallback:

1. Annotate native-readable and missing facts manually on the selected authorized/public sites.
2. Spend no more than 40 basic HTML/Markdown page attempts; no unrestricted crawl or automatic retries.
3. Verify at least 80% recovery of the annotated content missing from native extraction, retention of readable native facts, and zero accepted unsupported business claims/out-of-scope content.
4. Inspect attempt/credit/unknown-usage accounting, update the privacy disclosure, and enable both explicit Firecrawl switches only after passing.

Until then the shipped behavior is native website review plus manual business completion. Rendering quality, credit cost per recovered fact and generalization to real customer websites remain unverified.

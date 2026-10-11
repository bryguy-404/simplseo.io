# Phase 7 follow-up recommendation evaluation

Evaluated on October 11, 2026 using the configured `gpt-6.1-sol` model. Eight reviewed synthetic scenarios across web services, roofing, plumbing and landscaping were each assessed twice. Exactly 16 model calls were made, without automatic retries, public research, website or Google requests, or production writes.

## Results and adjudication

The original automated result was **12 passes and 4 failures**. The original report is preserved verbatim in [the evaluation record](evidence/phase7-model-evaluation.json), SHA-256 `242129d52082938bc5c6c6714b9b530f942348d2d7a27b98644efdf4edddf39d`. All 16 responses passed the final application policy validator; the four failures were fixture outcome expectations.

The roofing-decline and landscaping-sparse fixtures each produced two content-improvement outcomes where the original fixture expected monitoring or investigation. Independent reviews of all responses found these four recommendations supported by their supplied page content: very short service summaries lacked useful process or scope details. The responses kept the confirmed metadata, described traffic uncertainty, made no causal claim, and asked for actual owner facts rather than inventing finished copy.

Only those two fixture rubrics were narrowed and corrected to permit this alternative. An improvement must preserve the metadata, propose content tasks with a visitor-decision benefit, quote the existing service text, require actual or confirmed facts, and leave proposed finished copy null. Tests verify that metadata rewrites and unsupported or invented content remain rejected. Offline replay of the original responses passed **16 of 16** against these final criteria, with **zero additional paid calls**. This does not change the original automated result into a clean first-run pass.

| Scenario | Two-response content review |
| --- | --- |
| Roofing with positive observations | Retains useful wording; no causal improvement claim. |
| Roofing with declining observations | Keeps metadata; conditionally asks for actual inspection and quote-process details. |
| Plumbing with verified noindex | Prioritizes the technical issue without promising indexing. |
| Plumbing with missing query evidence | Identifies missing evidence without inferring no demand. |
| Landscaping with sparse activity | Calls results inconclusive; proposes accurate service-scope details independently of traffic. |
| Landscaping with vague heading | Suggests an evidenced heading and conditional service detail. |
| Web services with branded queries | Does not equate page clicks with nonbrand discovery. |
| Web services with vague heading | Suggests a supported service/location heading while preserving the prior edit. |

Review found no fabricated metrics, credentials, competitor findings, Google penalties, causal conclusions or unexplained reversals. No fixture required a monthly rewrite.

## Recorded usage

- Input tokens: **124,460**
- Output tokens: **24,434**
- Total tokens: **148,894**
- Requests with unreported usage: **0**

These are actual provider-reported tokens, not a calculated or final dollar bill. The evaluation record is separate from users' production usage and account histories.

## Limits and follow-up evidence

The same short roofing content was retained under positive observations and treated as an opportunity under declining observations. The responses explicitly separate causation, but future evaluations should include genuinely complete service content under both traffic conditions to test this prioritization more closely.

Repeated assessments start from identical fixtures, not a longitudinal sequence of accepted decisions. Automated lifecycle tests separately cover reuse, completed-task preservation and rejection of repeated changes at completed locations. The first pilot conservatively refuses replacement tasks at a previously completed type/location; a justified reversal needs a future explicit evidence-aware review path.

These gates establish bounded recommendation quality and preservation behavior, not ranking gains or business value. Real homepage publication, scheduled collection and mature comparisons remain live pilot checkpoints.

To replay without credentials or provider calls:

```sh
node scripts/evaluate-follow-up-reviews.cjs --replay docs/evidence/phase7-model-evaluation.json
```

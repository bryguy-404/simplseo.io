# Phase 6 — Evidence-based New page ideas

## Scope

The public URL remains `/generic-keywords`; navigation now says **New page ideas**. This release serves local service businesses seeking inquiries, quotes or bookings. The existing-page pilot continues independently. No business is required to create a page, and no traffic threshold locks another area.

The workflow is: review existing coverage, confirm a real service area and offerings, assess a useful gap, select a justified idea, edit a saved draft, publish in the owner's website builder, then verify the real URL and observe Google. `new_page`, `improve_existing`, `no_opportunity` and `needs_information` are all valid outcomes. There is no quota of ideas to fill.

## Inventory and evidence

`newPageInventory.js` discovers the selected website through its homepage, internal links, robots sitemap declarations, default sitemap, stored URLs and available Search Console observations. It uses the protected fetcher with DNS checks, redirect checks, property and selected-host boundaries, response limits and request deadlines. Downloaded content is data, never instructions.

Limits per inventory are 20 sitemap documents, 500 discovered URLs and 100 HTML fetches. Three workers use resumable 45-second batches. Sitemap XML rejects malformed data, DTDs and entities. Unsupported compressed sitemaps, blocked pages, failed fetches and caps are disclosed. Stored states distinguish fetched, failed, excluded and pending URLs; `ready` means the bounded discovered set was reviewed, not that every possible site URL is known.

Inventory is independent of onboarding and scoped to account, property, selected website URL and website version. Subcollection page records avoid one oversized Firestore document. Refreshing an inventory creates an isolated generation. Content timestamps do not by themselves make a saved assessment stale. Unknown content coverage prevents inventing a gap; the owner gets a specific next check instead of another page recommendation.

Owner-confirmed services, area and business facts are stored separately from first-party website evidence. Nearby area research is an explicit action and requires region/country and public citations. A nearby town is never silently added to the business's service area.

## Assessment, drafts and persistence

The assessment compares related customer needs, known pages and existing saved plans. It returns at most three justified ideas. Observed search phrases must exactly match supplied Search Console queries; other phrases are labeled proposed. Exact-page/query observations use the finalized 28-day window with the existing three-day reporting buffer. Missing Google rows do not establish zero demand or indexing failure.

The OpenAI Responses API uses the existing `gpt-6.1-sol` configuration. Public research gets website context and selected services/area, never private Google queries, metrics, account IDs or owner notes. Each research request is limited to two web-search calls. Assessment and drafting use strict structured output plus server validation. Drafts receive a separate factual/duplicate-content audit against first-party and confirmed owner facts.

A new page needs a distinct purpose and substantive customer value. A location substitution or synonym rewrite is insufficient. Drafts include a search focus, title, description, H1, proposed slug, section outline and copy, links from/to existing pages, required facts, optional writing prompts and evidence. Missing optional information stays outside finished copy. Slug checks report dated not-found or unverified status; they are not URL reservations. The actual URL is checked again after publication.

Records live in `newPageWorkspaces`, `newPageInventories`, `newPageAssessments`, `newPagePlans`, `newPagePublications` and `newPageJobs`. Saved reads do not call AI, crawl websites or refresh Google. Contexts, owner edits, dismissed plans and earlier areas survive reload/sign-out. Plans have stable IDs and revision checks. Changed generated drafts appear as proposed revisions and do not overwrite owner copy. Older website versions remain read-only. Legacy created/skipped entries remain labeled unverified history; old estimated metrics and success labels are not reused as evidence.

Workspace reads return compact plan/history summaries and only the active area's assessment. Opening a plan makes a separate stored-only detail request. This prevents large saved drafts from overflowing the response. Model evidence uses bounded first-party excerpts; insufficient evidence remains a reason to ask for information, not a license to invent claims.

Initial limits per account per UTC day are three area assessment attempts, five draft-generation attempts and two nearby-area searches. Firestore transactions reserve attempts before provider calls. An account-level lease prevents concurrent generation. Unchanged checks and determinations blocked by known unreadable coverage do not spend a generation allowance. Research becomes eligible for another explicit check after seven days; it never runs on page load or a timer. Failed checks preserve existing work. Saved plans have an explicit 200-record account cap rather than silently dropping old records from a bounded read.

Assessment and drafting require website evidence reviewed within seven days. Resuming a batch does not renew old page observations. A stale inventory asks for an explicit website refresh before any paid generation; unchanged checks describe the saved evidence and do not claim that the live website was recrawled.

Usage goes into the private `aiUsageEvents` ledger with feature `new_page_planning` and separate research, assessment, draft and validation stages. Provider tokens, tool-call observations and failure/unknown accounting are stored; prompts, generated copy and private queries are not. Actual model-evaluation evidence is recorded in [the evaluation report](PHASE6_EVALUATION.md).

## Publication and observation

Only the owner publishes. They enter the actual URL and explicitly declare that they opened the live page. The server verifies the property/host, public HTML, redirects, basic match to the plan, canonical declarations and indexing directives. Internal redirects require confirmation. A failed check preserves the draft. Reachable pages with indexing concerns keep those warnings separate from publication verification.

Owner declaration time and server verification time are separate. Neither is presented as Google's discovery date or the historical publication date. Google's stored URL Inspection result and Search Analytics are independent dated observations. Failures retain previous data with its date. Tracking shows rolling 28-day activity, activity after the verification day and prior activity when available. An old URL cannot become an invented new-page success or before/after uplift. Average position is not a Google results-page number.

The 28- and 84-day review prompts are reminders, not success judgments or unlock conditions. The interface links to Google's inspection result when available and to **Improve a page** after publication. Indexing requests remain manual.

The existing 03:00 UTC website-monitoring invocation runs independent existing-page and new-page collectors under one 220-second deadline. There is no third cron. New-page monitoring processes at most 20 due URLs with concurrency two, daily for 90 days and weekly afterward. Oldest-due ordering advances after failures as well as successes. Manual refresh shares each URL's lease and 24-hour cache. Provider requests receive the remaining deadline; aggregate run health identifies each collector. No background AI generation, email or automatic SEO-success classification is enabled.

## Security and retirement

Every API action derives identity from a verified Firebase token and checks the stored account/property/website version. Scope and revisions are checked again before asynchronous results are saved. Direct Firestore client reads/writes to new private collections are denied; authenticated APIs return only the owner's work. Account deletion recursively removes inventories and new records, then sweeps again after deleting roots to close in-flight write races. OAuth refresh uses guarded transactional updates and cannot recreate an account or overwrite a changed connection.

Legacy generic-keyword analysis, keyword-analysis, outline generation, mark-created and skip writes now return authenticated 410 responses. Their UI callers and the account-independent outline cache were removed first. Old created/skipped reads remain available as unverified history.

## Release and rollback

Generation can be paused with `NEW_PAGE_GENERATION_ENABLED=false`. Saved reads, owner edits, inventory and existing publication tracking remain usable. Tests exercise that state. This is the preferred containment action for a recommendation issue; do not delete Firestore records.

The pre-Phase-6 production deployment is `dpl_974BuvecyRuoj7btfrvhLoY3KZ17` (`simplseo-ao2cvwltc-bryan-arambulas-projects.vercel.app`, application source `2e2c1c2`). A Vercel rollback preserves Firestore data. Keep the new private rules and index; the earlier application does not consume new records. A full application rollback also removes the new-page collector from the old cron implementation, so generation pause is preferable when tracking should continue.

Automated release checks cover inventory bounds/uncertainty, decisions, factual drafts, concurrency, scoped reads/writes, revisions and deletion races, publication redirects/directives, independent observations, collector fairness/deadlines, desktop/mobile/keyboard flows and existing-page regressions. A bounded repeated real-model evaluation must reject invented claims and duplicate recommendations in covered fixtures before production promotion.

### Verification recorded October 10, 2026

- Core implementation: `a63f23c` on `codex/phase3-current-website`.
- Final unit/API suite: **705 passed** in 41 files, including the live-discovered installer-download exclusion.
- Complete compiled browser/API/Firestore-rules suite: **84 passed**. After the final compact-read and freshness fixes, the affected **28 UI/API cases passed again** against a rebuilt production-mode isolated app.
- Production builds passed; lint has no errors and nine preexisting warnings. Changed components passed scoped lint.
- The [quality evaluation](PHASE6_EVALUATION.md) passed with covered-site, useful-gap, synonymous-service, unserved-area and city-clone examples. Two drafts passed evidence validation and separate factual review.
- Private rules and the monitoring index were deployed to the existing Firebase project. No website publication or owner service-area confirmation was made as part of automated verification.
- First production checks passed all 10 anonymous and 10 cross-account boundaries, retired all five legacy writes, and preserved the existing homepage plan and 18 archive records. No AI calls or publications were made. Both manual collectors completed; their stored run health separates existing pages from the empty new-page queue. Actual overnight execution remains a separate checkpoint.

### Final live release

Application commit `518f08b` is deployed as `dpl_97zz6HWYs9uvECDB7gVSGT5sRCrT`, status **READY**, at the unchanged public URL [New page ideas](https://simplseo-io.vercel.app/generic-keywords). The exact build is `https://simplseo-2ol72lezs-bryan-arambulas-projects.vercel.app`; production build took 3m 4s. Firestore's new monitoring index is **READY**.

Live verification at `2026-10-11T01:58:31Z` passed again on the final build. Generation is enabled, saved reads are private/no-store, the existing homepage plan and historical work are unchanged, and no new owner context or publication was confirmed. There were zero AI calls during live discovery. Bryan's inventory discovered **31 URLs: 21 fetched HTML pages, two excluded installer downloads and eight HTTP 404 URLs**, with no pending URLs or cap truncation. Coverage remains honestly partial. The 404s are `/services/seo` and its Fort Wayne, Goshen, LaPorte, Mishawaka, Niles, South Bend and Warsaw paths. They require review rather than being treated as proof of a new-page opportunity.

The existing one-time morning follow-up now includes both website collectors and backlog/failure reporting. It must observe real scheduled execution. Bryan's next checkpoint is to review the actual inventory and confirm services/area; assessment, any qualifying draft and real publication remain owner-led checkpoints.

### Service confirmation follow-up

The first owner checkpoint exposed a form bug: commas in service labels were treated as separators, so city/state headings inflated the submitted count beyond 12. The server then returned an unrelated confirmation message. Application commit `5163635` preserves one service per line, deduplicates labels before the limit, and explains specific validation failures. Website suggestions now favor service pages and remove location suffixes only when supported by first-party evidence; distinct offerings remain available for owner review. Saved owner confirmations are unchanged. A fresh inventory review fills a blank form from the same server projection and never replaces owner-entered services.

Verification: **723 unit/API tests in 41 files**, **34 affected compiled browser/API tests**, and the isolated production build passed. Lint reports no errors and the same nine preexisting warnings. The current site's read-only projection yields Custom Software Development, Web Design & Development, and Software & App Development, with no city variants.

Released `5163635` as **READY** deployment `dpl_3yxUUVSNHZJKZF5yieQ4vta92JhA` (`https://simplseo-755hq5o9h-bryan-arambulas-projects.vercel.app`) and promoted to the unchanged public URL. The production build passed in 3m 7s. The staged API returned the expected private/no-store JSON 401. Live owner verification at `2026-10-11T02:18:44.220Z` confirmed the three concise suggestions, all 10 anonymous and 10 cross-account boundaries, and preservation of the existing saved plan and 18 archive records. Owner context remains unconfirmed; no AI, inventory refresh or publication occurred during this check. A post-release error-level log scan returned no entries. The eight existing SEO-page 404s remain a separate coverage concern. Rollback to the preceding deployment preserves stored data.

### Website-review message follow-up

Application commit `93a4871` makes incomplete reviews actionable: discovered URLs are called links, failed/unreviewed pages get an explicit list of links to check with readable reasons, and the next steps use the actual button names. The UI distinguishes SimplSEO's fetch results from Google's indexing status. Previously saved generic coverage questions display the improved wording without an AI call or stored-data migration. This changes presentation and deterministic guidance only; recommendation eligibility and the website remain unchanged.

Scoped lint, all **54 planning tests**, the isolated production build, and **two targeted browser cases** passed. Desktop and 390px mobile views were checked, including URL wrapping and the legacy saved-message case.

Released as **READY** deployment `dpl_3gvcJFopHyo8ct9kMYz5vM431TgN` (`https://simplseo-oqroulj2g-bryan-arambulas-projects.vercel.app`) and promoted to the existing public URL. Production build passed, the staged unauthenticated API returned private/no-store JSON 401, and the live page bundle contains the new explanations. Read-only owner verification at `2026-10-11T02:31:40.847Z` passed all authentication boundaries and preserved existing work. Bryan's area is now owner-confirmed; the verification itself made no confirmations, AI calls, publication or inventory changes. The post-release error-level log scan returned no entries.

### Intentionally removed pages

A saved 404/410 link can now be marked **This page was removed**, with an explicit owner confirmation. The authenticated retirement action verifies a fresh, direct 404/410 response for each exact URL before atomically recording the declaration. A live page, redirect, network error or other HTTP failure cannot be retired through this action. Account/property/website-version scope, inventory lease and revision checks protect against stale or cross-account writes.

Removal records are preserved under the scoped inventory, separately from the HTTP observations. They resolve this specific coverage uncertainty without deleting website history or inventing Google indexing results. Inventory refreshes retain and recheck these URLs; a readable page reactivates and clears the old declaration. **Restore for review** returns a URL to pending review. Retired checks count toward the existing HTML cap, and stale verification still requires a fresh website review before assessment. Saved plans and owner edits remain unchanged.

The workspace shows removed pages separately and marks an old assessment as needing an explicit update when coverage changes. A refresh with identical evidence does not require paid regeneration. Removed URLs are excluded from available page evidence and link targets; historical search observations cannot justify recreating a discontinued service. No AI work occurs when confirming, restoring or reading removal records.

Verification: **753 unit/API tests in 41 files** passed; lint has no errors and the same nine existing warnings. A focused real-model fixture with covered current services and historical searches for a retired, unrelated service returned `no_opportunity`, without reviving that service or using its URL as current coverage. One `gpt-6.1-sol` request used 2,719 input and 81 output tokens; it used only synthetic data and performed no research, Google reads or account writes.

The isolated production build and **48 affected browser/security cases** passed (32 UI, seven actual API, nine Firestore rules). Desktop and mobile confirmation dialogs and the saved removed-pages section were visually checked. Tests cover cancellation, restoration, stale revisions, preservation of unsaved plan edits, and denied direct client reads/writes of retirement proofs.

Released application commit `c46bd17` as **READY** deployment `dpl_Bn5QFHVRsJDSWNFNBnnAp5BRnE6C` (`https://simplseo-a162emyo5-bryan-arambulas-projects.vercel.app`) and promoted to the unchanged public URL. The production build passed in 3m 32s; both staged workspace reads and retirement writes returned the expected private/no-store JSON 401 without an app session. The preceding deployment `dpl_3gvcJFopHyo8ct9kMYz5vM431TgN` remains available for rollback; removal declarations and saved work are retained in Firestore, although the older UI does not offer the new resolution flow.

Using Bryan's explicit clarification that the discontinued SEO services are irrelevant, the new API freshly verified and retired only the eight `/services/seo` URLs in the current account/property/website version at `2026-10-11T03:09:17.182Z`. The action preserved 22 inspected setup, plan, assessment and history records and made no AI request or website/publication change. A subsequent full inventory refresh at `2026-10-11T03:10:24.480Z` retained all eight declarations: 31 links, 21 fetched, two excluded downloads, eight retired, zero failed/pending. All 11 anonymous and 11 cross-account checks passed, and the existing-page plan/archive remained unchanged. The authenticated live UI shows **Website review saved**, **Removed pages (8)**, and an explicit **Check for updates** next step. No new opportunity assessment was generated on the owner's behalf. The post-release error-level log scan returned no entries.

## Live checkpoints

Copy follow-up `856d736` adds a short explanation to every **Already covered** card: “You already have a page about this topic. Review it for improvements instead of creating a similar page.” Scoped JSX lint and the production build passed. Deployment `dpl_HwPuX3vKYWEQhEAtPQ82Cy9Dg6MZ` (`https://simplseo-fhpm7xq36-bryan-arambulas-projects.vercel.app`) was staged, smoke-checked for the expected private/no-store API 401, and promoted to the existing public URL. The authenticated live workspace shows the explanation on both saved improvement cards after a reload; no analysis or data mutation was needed.

### Compact setup follow-up

Completed setup appears as two compact summaries above saved recommendations and drafts. Saving a confirmed area collapses the form to its area and service count. A current assessment and a finished website review collapse the review to its page count and check date. Both summaries have keyboard-accessible controls to reopen their details; the review also keeps a quiet **Check for updates** action visible. Returning visits derive the compact view from saved work without making an AI or crawling request.

Unsaved or unconfirmed inputs, incomplete reviews, changed coverage and assessments needing more information stay expanded. Failed actions keep their guidance visible. Toggling sections preserves mounted form and draft state, and a successful save or assessment moves keyboard focus to the next step. This is a presentation change; recommendation eligibility, saved records and monitoring behavior are unchanged.

Application commit `02e3ae7` passed all **37 affected UI cases**, with the five collapse-specific cases repeated successfully after tightening summary padding. Desktop and 390px mobile screenshots were inspected; keyboard controls, focus, failed saves/checks, returning visits and unsaved draft preservation passed. Scoped JSX lint passed; full lint has zero errors and the same nine existing warnings. The isolated optimized build and final Vercel production build passed.

Released as **READY** deployment `dpl_EuPN1BPV4GPHufZup8AoCJfjUgza` (`https://simplseo-38p303256-bryan-arambulas-projects.vercel.app`), framework Next.js, production build approximately four minutes. The staged workspace API returned the expected private/no-store JSON 401 before promotion. The authenticated live account shows the saved South Bend area with three services, 21 pages reviewed, and both existing-page recommendations below the compact summaries. Both setup sections were reopened and closed successfully without account writes, crawling or AI generation. The error-level log scan returned no entries. The previous deployment `dpl_HwPuX3vKYWEQhEAtPQ82Cy9Dg6MZ` remains the rollback target and preserves saved data.

1. **Inventory and area:** Bryan checks the recognized services, actual target area and existing coverage. Confirming an area does not declare publication.
2. **Recommendation and draft:** Assess the real site. A supported no-opportunity or improve-existing result is acceptable. Only a qualifying idea becomes a draft; check saved edits survive reload and accounting is recorded.
3. **Real publication:** After Bryan publishes a worthwhile page himself, verify its actual URL. Do not fabricate a publication to test tracking.
4. **Scheduled execution:** Correlate an actual overnight provider invocation with stored collector health. A manual request proves route behavior, not scheduler execution. Tracking a real new page remains unverified until one is actually published.

## Limits and deferred work

Inventory is a bounded HTML review, not a browser-rendered or exhaustive site audit. Public research cannot supply verified keyword volume, exact competitors' ranks or a guarantee that a page will be indexed. The recommendation evaluation uses reviewed synthetic service-business examples; real business value still needs the pilot.

Nationwide planning, restaurants, mass city-by-service pages, another SEO-data provider, automatic publishing/indexing, onboarding redesign, payments and stack migration are deferred. The existing Vercel plan/commercial-pilot gate from Phase 5 remains unchanged.

Google's [spam policies](https://developers.google.com/search/docs/essentials/spam-policies) describe doorway and scaled-content concerns; publishing slowly alone does not resolve low-value duplicate content. [Recrawl guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl) does not promise inclusion after a request. The [URL Inspection API](https://developers.google.com/webmaster-tools/v1/urlInspection.index/inspect) supplies the stored Google view, not a live test or indexing submission.

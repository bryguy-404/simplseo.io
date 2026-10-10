# Phase 3: current website and one-page task flow

Bryan accepted Phase 2 and authorized this phase on October 10, 2026. His rebuilt Bryan Develops website is the active pilot. Keep the existing public URL, Firebase, Firestore and Vercel. Historical work remains available, but it does not drive current tasks. No account reset or new migration is needed.

## What changed

- Completed accounts open a current-website dashboard with a clear next action, Page progress, one dated Search Console overview and a short list of pages to review. The daily chart is optional. Existing initial page/keyword setup is retained separately in `SetupFlow.jsx`.
- The overview obtains property totals, daily observations and page totals directly from Google in three bounded requests for the same 28-day finalized window. Page totals are not reconstructed by adding query rows. Missing query/page rows are not an indexing verdict; failed requests never become fabricated zeros. Dates remain calendar dates rather than shifting with the browser's time zone.
- Review a page uses an exact URL from tracked pages or current search observations. It reads fresh public website HTML to show the actual title and meta description. Search Console performance data does not supply those tags. Optional search queries are clearly labeled; no old saved keyword is required.
- One explicit generation request produces a title/description pair from current page content. The normal dashboard and review-page load do not generate AI drafts. The existing provider/model is retained; provider retries, time and output are bounded. Unsupported claim/placeholder checks supplement the prompt, but the user must review the wording for accuracy.
- The user edits the draft, publishes the change in their own website editor, and confirms it. A server transaction checks the current account, property, website run, exact URL, archive completion and existing implementation. It uses a server confirmation date, preserves repeat-confirmation dates and rejects conflicting edits or legacy hash collisions. Old implementation records can be replaced only when their immutable archive exists. A fresh server observation is saved separately from the user's claim to have published the edits.
- Redirect sources cannot be used to start tracking a destination edit. The UI asks the user to review the destination; the server checks the destination again at confirmation. Changing account/property/run discards unfinished UI drafts, and stale server requests cannot save into the new setup.
- Rebuild guidance offers an exact-URL CSV for planning preserved URLs and replacements. Links to Google's guidance explain relevant permanent redirects, updated internal links/sitemaps and URL Inspection. A normal revisit to completed setup no longer pauses an already verified account's progress collector.
- Previous work is a secondary history link. The chat assistant no longer opens automatically on first visit. Advanced recommendation pages remain available and have not all been redesigned in this phase.

## Verification

Local tests use only `demo-simpleseo` Auth/Firestore emulators and fake users. Browser fixtures block unexpected external traffic. Browser tests exercise the saved-draft UI through a mocked HTTP confirmation boundary that persists to demo Firestore; server unit/API tests separately cover fresh reads, authentication, archive preservation and transaction races. No automated browser test confirms a fictitious change in Bryan's production account.

The live release verifier is limited to the existing verified project/account/property. It checks private-route rejection, current Google observations, fresh public HTML, progress safeguards and unchanged implementation/history records. Its optional `--draft` makes one real generation request without confirming or publishing it. Credentials remain in memory and are not printed. Token refresh and request-cap bookkeeping can occur during normal authenticated reads.

Release evidence is recorded below after final checks and deployment. A successful manual check does not prove that the scheduled collector has run or that a future edit improved traffic.

## Bryan's checkpoint

1. Refresh Dashboard. Expect **Your SEO workspace**, a first-page action, Page progress and dated Current search activity.
2. Choose **Review this page**. Confirm that the URL and fetched title/description belong to your current website. If it redirects, use **Review destination page**.
3. Select a relevant observed query if useful, or leave it unset. Press **Generate title and description**. Check whether the draft is accurate and actually worth using; keeping already-good wording is valid.
4. If you use a draft, edit and publish the tags in your own website builder. Only then check the publication box and confirm in SimplSEO. Do not confirm merely to test the button.
5. Refresh and confirm the saved wording remains and Page progress shows the new change. Its comparison requires the full reporting periods and enough search activity; low traffic can remain inconclusive.

Stop for feedback on this first real task before expanding recommendation/content features. No artificial success, score reset or indexing guarantee is part of this release.

## Remaining work and rollback

Bryan's first visual checkpoint: the dashboard loads and its overall layout works. His October 10 feedback requested an explicit Homepage link, clearer separation of current content and suggestions, and less visible technical copy for beginners. The follow-up uses blue current content, violet editable drafts, green saved confirmations, plain page-title/description labels and expandable supporting details. The draft-quality and first real published-edit checkpoints remain open; Phase 4 has not begun.

Phase 4 covers recommendation quality, affordable research and useful new content. Phase 5 covers pilot feedback and economics. The next scheduled progress/website-monitoring invocations remain an operational check. The retained Firebase Functions Node 20 runtime maintenance item remains due before the CLI-reported October 30, 2026 decommission date.

This phase requires no Firestore rules/index deployment and no recovery data migration. The Phase 2 application deployment `dpl_24oqSEcKbtZTRfCCw72tSLaA2F1t` remains the rollback target. Retain Phase 2's rules, inactive legacy writer, immutable history and disabled automatic outcomes during rollback. Do not revert an actual user-confirmed website change or overwrite newer account state.

## Release evidence

- Local release gates passed: **170 tests across 19 unit/API files**, **26 browser/API/rules scenarios**, and a fresh isolated production build. Lint reports zero errors and 11 existing warnings; the new/rewritten task components and new server paths pass scoped lint without warnings. Screenshots of the dashboard and confirmed-change flow were inspected. A repeat-run browser fixture cleanup issue was fixed before the final passing suite.
- Application commits: `138cd05` implements this phase; `33dca43` normalizes inherited whitespace in the moved setup component. The production build was staged without domain assignment and then promoted unchanged after all four new private routes returned application HTTP 401 for anonymous probes.
- **Production READY:** `dpl_CKKUCZQYjFzkoHNnpLAj16m54NJL`, [deployment](https://simplseo-64o2d5f1v-bryan-arambulas-projects.vercel.app), served at the unchanged [SimplSEO URL](https://simplseo-io.vercel.app). The linked project/team and public alias were verified. Vercel reports a 5m 46s build and 44s post-build step. The framework remains Next.js 15.3.6. Public access settings were not changed.
- Live verification at approximately 12:36 p.m. Indiana time passed: four anonymous requests returned 401 and four cross-account requests returned 403. The authenticated overview returned **5 pages**, **27 daily observation rows**, **7 clicks** and **169 impressions** for **September 10–October 7, 2026**. This is observed search activity, not a count of crawled/indexed pages. An omitted daily row is not invented as a zero.
- The exact homepage HTML returned 200 with the current title **Bryan Develops | Websites & Custom Software — South Bend, IN**. One explicitly requested AI draft returned successfully (45-character title and 145-character description), with the current property/run/URL provenance. No edit was published or confirmed. Suggestion quality remains Bryan's review checkpoint.
- Progress remained enabled with **zero active changes**, automatic outcomes disabled and notifications disabled. The current history run and all **18 archive documents/snapshots** checked by update time remained unchanged. No rules, indexes, Firebase functions, account recovery fields or website content were modified by this release.
- The production verification script is `node scripts/verify-phase3-release.cjs UID EXACT_PROPERTY [--draft]`. No authorized confirmation is sent. Live confirmation persistence remains deliberately reserved for the first real website edit; its server logic and browser flow were checked in isolated tests.
- A deployment-scoped error-level log query for the release/verification window returned **zero records**. This is a bounded check; actual future scheduled invocations still need observation. No recurring follow-up automation was created. Temporary local test servers were stopped after verification.

# Phase 5 pilot readiness

Bryan accepted the Phase 4 workflow and authorized the pilot-readiness check on October 10, 2026. The first pilot is his existing Bryan Develops account, using the current homepage and saved plan. No website edits or task publication confirmations are made on his behalf. The public URL and Firebase/Firestore/Vercel stack remain unchanged.

## Maintenance and tracking

The five retained Firebase functions now use Node 22 with explicit first-generation triggers. All four public maintenance URLs were verified to return HTTP 410 after deployment; the old scheduled writer remains inert. The deployed inventory confirms all five are active on `nodejs22`. This resolves the Node 20 retirement item without restoring unsupported SEO decisions. See [Google runtime support](https://docs.cloud.google.com/functions/docs/runtime-support).

The two Vercel collectors now keep private, bounded run evidence and distinguish manual checks from requests carrying the scheduler header. Website monitoring has a lease, bounded account/page batches, resumable cursors and a time budget; errors retain previous observations. Completed work is preserved even if a duplicate request is deferred. See [tracking operations](PHASE5_TRACKING.md) for exact bounds and interpretation.

Vercel's project API confirms both daily cron definitions are enabled. Progress is scheduled for 02:00 UTC and website monitoring for 03:00 UTC. The current team uses Hobby: execution can occur during the respective hour, rather than at the exact minute. Runtime logs retain only one hour on this plan, so an empty historical log query does not prove a missed invocation. Actual scheduled execution must be correlated with the new durable run evidence and provider logs; a successful manual check is separate evidence. Sources: [cron scheduling](https://vercel.com/docs/cron-jobs/usage-and-pricing), [runtime logs](https://vercel.com/docs/logs/runtime).

Automatic success/pivot/audit decisions, progress notifications and playbook promotion remain disabled. No confirmed edits means no active before/after comparison; this is a legitimate empty state.

## Usage and costs

The OpenAI usage dashboard, filtered to the **SimplSEO** project and October 1–10, 2026, showed **$1.73**, **68 API requests**, and **555,713 tokens** when inspected on October 10. The line-item view included the current model and web-search tools. This is provider-reported accrued spending, includes development/testing, can update with reporting delays, and is not a final invoice or a cost per customer. The separate organization spend figure must not be attributed to this project.

New Improve a page calls now save private provider accounting: research/assessment stage, reported tokens and cache counts, observed web-search calls, model/tier, duration and outcome. Saved-plan checks that find no meaningful change do not invoke paid AI or create paid-call records. Missing usage, timeouts and interrupted requests remain unknown, never assumed free. Historical saved plans cannot reconstruct old token usage.

Accounting excludes prompts, page URLs, search phrases, generated content, credentials and raw error messages. Clients cannot read or alter it. Writes are bounded so a storage delay does not consume the review's entire deadline. Account deletion also covers in-flight accounting. The `aiUsageEvents.expiresAt` configuration requests deletion after 90 days; Firestore TTL cleanup is asynchronous. The deployment's activation state is recorded below.

This ledger covers **Improve a page**, not every older chat/opportunity endpoint. Reconcile the provider dashboard with the ledger before estimating an active account's total AI cost. The existing 20-reviews/day allowance is an abuse/usage limit, not a monthly price entitlement or a hard dollar budget.

Current published standard rates for `gpt-6.1-sol` at up to 272K input tokens are $2/million ordinary input tokens, $0.10/million cache-hit tokens, $2.50/million cache-write tokens and $10/million output tokens. Web search is $10/1,000 calls plus model-rate search-content tokens. Actual service tier, context size and provider billing determine the invoice; no estimated dollar amount is written as a measured charge. Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [cache accounting](https://developers.openai.com/api/docs/guides/prompt-caching).

Vercel's existing team is on the free Hobby plan. Its charge API returned “Costs not found,” which is not an itemized invoice. Hobby is limited to noncommercial personal use; select an appropriate commercial plan before expanding this business pilot to customers. No subscription was changed. [Vercel Hobby terms and limits](https://vercel.com/docs/plans/hobby).

Firebase billing was verified on October 10 through Bryan's signed-in Chrome session after the in-app browser could not access the report. The [SimpleSEO Usage and billing overview](https://console.firebase.google.com/project/simpleseo-90570/usage), scoped to project `simpleseo-90570` and **October 2026**, showed **$0.00 project cost** on the **Blaze (pay as you go)** plan. The console explicitly warns that costs may be delayed up to 24 hours; this is the currently reported month-to-date amount, not a final invoice, a forecast or proof that today's maintenance incurred no charges. The loaded usage overview showed Firestore reads at 5.9% and writes at 0.6% of their daily no-cost quotas, plus 17 Functions invocations against the billing account's monthly no-cost quota. These are point-in-time usage observations, not per-customer cost estimates. No billing settings, subscriptions or exports were changed. Pricing at $20–25 or $50 remains a hypothesis until real usage, hosting/database charges and support time are measured.

## Homepage pilot checklist

1. Open the saved homepage plan and inspect each proposed location on the live website. Conditional suggestions apply only if that improvement is actually missing. Keep already-accurate wording and working links.
2. Agree on the useful edits and publish them in the website's own editor. The current saved plan includes a service-focused hero heading check, an estimate/ongoing-cost FAQ check, and a contextual Web Design service link check. Reconfirm the actual saved wording before editing; these are tasks to inspect, not mandatory changes.
3. Verify the published page on desktop and mobile. Check the heading, truthful copy and destination link. Then select **only the tasks actually published** in SimplSEO and accept its confirmation once.
4. Check the exact page, website run, confirmation date, completed-task state and collecting-data state. Refresh and verify they persist. Other pages remain available.
5. Inspect Google's recrawl/index view after roughly 1–2 weeks, look for early search signals around 4 weeks, and review usefulness again around 8–12 weeks. These are review checkpoints, not promises of ranking improvement.

The app's first comparison uses **28 complete days before and 28 complete days after confirmation**, excludes the confirmation day and allows the existing three-day reporting buffer. Its count thresholds are 100 impressions in each period and 10 clicks combined; they are display heuristics, not statistical significance. If the fixed windows have too little traffic, waiting alone does not enlarge them. A later longer-period assessment would be a separate explicit measurement decision. Track relevant nonbrand queries, clicks and impressions separately from actual inquiries/bookings; neither elapsed time nor a traffic change proves the edits caused a benefit.

## Verification and release

Verification before release: 545 unit/API tests, three real-SDK retired-function tests and 22 isolated browser/API scenarios pass (eight rules tests plus fourteen saved-plan/loading/publication/progress/access scenarios). The isolated production build passes. Full lint has zero errors and the same 11 existing warnings. Final review added a transaction guard preventing a finishing monitoring job from restoring a deleted account's pagination cursor; its regression passes. The earlier staged build was cancelled before promotion so only the corrected source can be released. The Firebase runtime maintenance and private telemetry rules are deployed. `aiUsageEvents.expiresAt` and the existing `requestLimits.expiresAt` both report `TTL(ACTIVE)`. The isolated app and emulators were stopped after verification.

Source **`2e2c1c2`** was built and promoted to production as **`dpl_974BuvecyRuoj7btfrvhLoY3KZ17`**, at [the exact deployment](https://simplseo-ao2cvwltc-bryan-arambulas-projects.vercel.app). The public address remains [simplseo-io.vercel.app](https://simplseo-io.vercel.app). The project API confirms both enabled cron definitions now target this deployment. This was a direct release from `codex/phase3-current-website`; it was not pushed or merged to `main`.

Post-release checks completed October 10 at approximately 20:14–20:17 Indiana time (October 11 00:14–00:17 UTC):

- Both intentional manual collector requests returned HTTP 200 with durable `completed` records on the live deployment. Progress examined six archived records and skipped all six. Website monitoring examined one account and checked 29 pages. Neither sent notifications or enabled automatic outcomes. These records are labeled `authenticated_request`, not scheduled execution.
- Eight anonymous and eight cross-account route checks were blocked. The authorized current HTML, search overview, page activity and saved plan loaded successfully.
- The live browser restored all three homepage tasks with their existing selected search focus. One saved plan and 18 archived documents were unchanged; there were zero active published changes. No publication confirmation or new AI review was performed.
- The new AI usage ledger had no events, as expected without a new paid review. Its lifecycle and privacy rules were tested in isolation; the first real review still needs reconciliation with provider usage.
- The deployment-scoped error-log query returned no error entries in the queried 15-minute window. This is a bounded observation, not proof that every route or future background run is error-free.

Technical preparation is released, and Firebase's currently reported October cost has now been verified. Actual overnight invocation evidence and measurement of a real published homepage change remain open; provider costs still need ongoing reconciliation as usage grows and delayed charges arrive. The account can proceed to the homepage walkthrough while those explicitly identified checks are followed up.

Bryan authorized a single follow-up for **October 11 at 09:00 America/Indiana/Indianapolis**. Automation `verify-simplseo-overnight-tracking` is active for this thread with one occurrence. It will inspect overnight evidence without invoking the collectors manually, report failures or evidence gaps, and leave website publication and billing unchanged. Hobby's short log retention may prevent independent correlation of the entire overnight window; the report must identify its source of evidence rather than imply a manual check was scheduled.

Operational check:

```sh
node scripts/verify-pilot-readiness.cjs <uid> <exact-property>
```

Add `--run-collectors` only for an intentional authenticated manual test of both normal collectors. It never sends the scheduler user-agent, generates an AI review, publishes an edit or marks a task complete. The script checks that saved plans and historical records remain unchanged, reports active change count and reads recent aggregate execution evidence. Only the existing production project and URL are accepted; credentials stay in memory and are not printed.

The release record must distinguish automated schedule observation, manual route checks, local tests and real published website work. The current rollback target is Phase 4 version 8 (`dpl_EFPhcv6ELWPbbCYcwbakdXoLwaQZ`, source `9fadf5b`). Rolling back the app should not downgrade Firebase's retired functions or restore legacy writers.


## Single overnight follow-up — October 11, 2026

Read-only verification at approximately 15:19 UTC found both expected October 11 scheduled-header records completed. No collector was invoked manually during this audit.

- Progress: started **02:14:02.517 UTC**, finished **02:14:04.232 UTC**, deployment `dpl_97zz6HWYs9uvECDB7gVSGT5sRCrT`. Six archived implementation records were skipped; no active published edit was measured. No reported errors, notifications or remaining backlog.
- Website monitoring: started **03:41:46.218 UTC**, finished **03:41:48.929 UTC**, deployment `dpl_HwPuX3vKYWEQhEAtPQ82Cy9Dg6MZ`. `existingPages` checked one account and 29 pages, with a usable result. `newPages` checked zero URLs, with no backlog. The empty new-page queue is valid and does not verify tracking of a real published page.

The project API confirms both schedules remain enabled on the current READY production deployment `dpl_4GcdF3NFCAhrMboFtuhzfHfYY9Sf`: progress at 02:00 UTC and website/new-page monitoring at 03:00 UTC. The public alias still points to that deployment.

Independent provider-log correlation remains **unverified**. Both historical CLI queries failed with HTTP 400, and both connector queries failed with HTTP 403 before returning results. A recent CLI log query succeeded. These are query failures, not evidence of zero invocations; the overnight period is also outside [Hobby's documented one-hour log retention](https://vercel.com/docs/logs/runtime). Durable authenticated run records carrying the scheduler header are the available completion evidence.

The scheduled runs used Phase 6 deployments. Phase 7 was promoted after both runs, so they do not verify its recurring-cycle collector. Its first expected invocation remains **October 12 at 02:00 UTC**, subject to Hobby's execution window. No fictional edit or new-page publication was created to exercise a collector.

The read-only script preserved the saved homepage plan and all 18 archive documents, with zero active published changes. Additional saved-work, queue and lease findings are recorded in [the audit evidence](evidence/overnight-tracking-2026-10-11.json). No concrete collector failure required maintenance. This was the authorized single follow-up; its schedule was not changed or extended.

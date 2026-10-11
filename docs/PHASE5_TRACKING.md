# Phase 5 tracking operations

The scheduled routes collect Google observations only. They do not publish website edits, confirm tasks, send progress emails, promote success stories or assign automatic SEO outcomes. An account with no actual confirmed edits has no active progress comparison; a successful zero-record run is expected.

| Job | Schedule (UTC) | Endpoint | Job state |
| --- | --- | --- | --- |
| Confirmed-page progress | Daily, 02:00 | `/api/cron/check-success-stories` | `progressJobs/daily-progress` |
| Website-update monitoring | Daily, 03:00 | `/api/cron/check-revamp-gsc` | `progressJobs/daily-website-monitoring` |

Both routes require the server's `CRON_SECRET` and return private, non-cacheable responses. A missing or wrong credential does not start collection or write run evidence. The older route name for progress remains for deployment compatibility.

## Durable execution evidence

The server writes a `cronRuns` record before collection begins and updates it after completion. It contains a job name, random run ID, start/finish times, duration, aggregate checked/error counts, whether more work remains, deployment ID when supplied by Vercel, and a controlled status. It stores no account IDs, page URLs, search queries, tokens, raw provider errors, or generated content.

Request sources are separate: `vercel_cron_header` means the authenticated request had Vercel's cron user-agent header; `authenticated_request` is the manual/default source. A header alone is not independent proof that the platform scheduler ran. Verify a scheduled invocation in Vercel's execution history and correlate its timestamp/deployment with the recorded run. An operator's manual request must not send the scheduler user-agent or be presented as scheduled evidence.

Records use a rotating 32-day slot for each job/source combination, limiting this collection to 128 documents. Each slot keeps that day's latest attempt, invocation count, last completed collection summary and last fully successful collection summary/time. A successful run remains visible even if an overlapping duplicate was deferred. It is recent operational health, not a permanent per-invocation audit log. Old slots are reused instead of accumulating a collection that needs a cleanup job. The existing default Firestore deny rule protects these server-only records.

Statuses:

- `running`: durable start exists; the request has not stored its finish. An old running record requires investigation for timeout or failure.
- `completed`: the selected work finished without reported errors or deferred work. Zero checked records can be legitimate.
- `partial`: a record/account failed, a reconnect is needed, a deadline interrupted processing, or the bounded sweep has more work.
- `deferred`: an overlapping invocation or cooldown prevented a new collector start.
- `failed`: the collector itself failed. Error categories are sanitized, and the last successful same-day timestamp remains available.

An older request cannot overwrite a newer attempt's health record or a newer collector lease. If durable start recording fails, collection does not begin; if final recording fails, the API reports failure rather than inventing success.

## Bounded monitoring work

Confirmed-page progress retains Phase 2's 40-record limit, four concurrent records, 90-second work budget, rotating document cursor and four-minute lease. Its response now says when additional records may remain. It still scans the implementation collection, including skipped legacy records, and does not guarantee a complete daily rotation at larger account volumes. Google metrics are requested only when a confirmed edit's full comparison window is eligible; absent, archived, paused or immature edits do not generate the two normal comparison requests.

Website-update collection now processes at most 20 monitored accounts per invocation, at most 40 pages per account, and at most four page requests concurrently. A shared 120-second work budget stops starting additional work; already-started bounded Google requests are allowed to finish inside the route's 240-second maximum. A four-minute lease prevents overlapping sweeps, and starts have a one-minute cooldown. An expired lease can be recovered by a later invocation.

The global account cursor resumes the next selected account. Each account's `onboarding.revampMonitorCursor` resumes its own remaining pages; reaching the end wraps on the next sweep. Unprocessed pages retain their prior observations. Failed Google reads retain successful historical observations and record an error instead of a zero. A website-run change, connected-property change, disabled scheduled monitoring or account deletion while work is in flight prevents that result from being stored.

These are bounds for a small pilot, not a throughput guarantee. If a sweep repeatedly reports more work or stays partial, inspect the cause and coverage lag before increasing the pilot. Per-account manual monitoring remains available independently of the scheduled cursor; this change does not introduce an account lockout while Google data develops.

## Before the first real publication

Verify both cron configurations, obtain a real platform-scheduled execution record when available, and inspect current run/job health. A manual authenticated probe tests the route and data path but cannot prove future scheduled execution. With no active confirmed edit, verify the legitimate empty progress state; do not manufacture a publication to create production test data.

After Bryan publishes the selected homepage edits and confirms those exact tasks, check that the saved record's page/property/website run and confirmation date match, the tasks become published, and the page starts collecting. The first comparison is eligible after 28 complete post-edit days plus the existing reporting buffer. Sufficient traffic is a separate requirement; elapsed time never proves SEO improvement.

## Isolated validation

The tracking tests cover unauthenticated rejection, successful zero-record runs, scheduled-header/manual separation, partial errors, sanitized failures, bounded retention, late finishes, overlapping jobs, expired leases, account/page cursor wrap, deadline continuation, preservation of unprocessed observations, and property/monitoring changes during requests. Existing progress tests continue to verify exact dated Google observations and disabled automatic outcomes.

Deployment IDs, actual provider execution evidence and pilot results are recorded in the Phase 5 release notes after verification; this source document alone does not claim that a scheduled production invocation has occurred.

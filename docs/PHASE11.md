# Phase 11 — Progress emails and in-app updates

Implemented for a staged, account-scoped pilot. Notification email stays **off** until the final Resend setup and delivery checks below. No AI generation, third cron, automatic website publishing, task confirmation, indexing request, or fabricated result is introduced.

## User experience

A bell beside Account shows five recent saved updates and links to the paginated inbox. Opening an update records only its read status. The notice links to the matching saved page/cycle or page plan; superseded website work is dated history. Sign-in and unfinished onboarding preserve safe notification destinations.

Notifications can be used without email. Onboarding readiness offers an unchecked email choice. Existing accounts receive the same choice alongside their first real publication confirmation; Settings → Notifications remains available afterward. Preference saves are independent of publication and privacy acceptance. Only the current **verified Firebase sign-in email** can receive mail; changing it requires confirmation for notifications. No alternate-address field is offered.

## Evidence and identity

Server-owned events come from persisted page-progress checkpoints, verified new-page publications, fresh verified technical issues and actual Google authorization incidents. Complete, correctly dated baseline/post observations are required for a results-ready notice; a timer or `review_due` flag is insufficient. Zero, sparse, declining and unchanged observations are eligible. Publication 28/84-day check-ins do not assert Google indexing or traffic.

The source key includes account, property, website and version. A checkpoint correction retains its event and delivery identity. Technical issues use episodes so repeated observations are not repeated emails. Successful checks and validated Google reconnection can resolve incidents. A bounded reconciliation sweep uses independent paginated cursors and rotating source order; it never re-collects Google data. Immediate post-persistence hooks improve timeliness, while reconciliation repairs missed hooks.

GET APIs read saved data only. They revalidate current eligibility without mutating it. Current unread counts exclude resolved, superseded or no-longer-eligible notices. The badge is bounded at 99+ rather than claiming an exact large total.

## Delivery

Resend receives template-rendered HTML and plain text, up to five featured updates, an inbox link, notification preferences and unsubscribe links. No query tables, chat content, AI advice or SEO-success claim is included. Domain open/click tracking must be disabled before enabling this feature. Existing SMTP contact and access-request flows remain unchanged.

Each delivery freezes the recipient, event IDs, payload and idempotency key before the provider call. Events remain claimed by that delivery, including unknown outcomes, so they cannot silently appear in another digest. Consent, verified address, current source eligibility, account existence and website scope are checked again before every send. A changed or read/resolved source cancels a frozen retry rather than changing its payload.

Limits:

- One routine digest per account per rolling 24 hours, only when eligible unread updates exist.
- Globally 50 attempts/day and 500/month, including tests, failures and retries; reserved atomically.
- At most 20 attempts per invocation, two workers, a shared provider lane and no more than one actual request start per second.
- At most three attempts per digest. Uncertain requests may retry with the same payload/key only within 23 hours of the first attempt. Later unresolved requests become **delivery unknown** and are not automatically resent.
- Test emails: current verified recipient only, one/minute and three/day, within the global limits. A test is clearly labeled and creates no progress event.

Signed Resend webhooks are verified against the raw body, with timestamp checks, receipt deduplication and monotonic delivery status. An opaque delivery tag supports reconciliation when the API response was lost. Provider acceptance is separate from delivery to the receiving mail server. Permanent bounces, complaints and suppression pause future email. Late webhooks cannot recreate a deleted account.

Human unsubscribe links use a read-only confirmation GET followed by an explicit POST. A separate token-protected one-click POST turns email off. Neither path can enable email or alter SEO work.

## Scheduling and health

The existing 02:00 UTC progress job reconciles saved events and retries eligible deliveries. The existing 03:00 UTC website-monitoring job also prepares ordinary digests. When notifications are enabled, collection receives 190 seconds and the final 30 seconds of the existing 220-second deadline are reserved for bounded notification work. A slow reconciliation leaves time for delivery.

Collection and notification leases, cursors and health are independent. `cronRuns.notifications.reconciliation` and `.delivery` contain only aggregate counts/backlog, not recipients or private page URLs. Email failure cannot erase or invalidate successful Google observations. Saved page loads, inbox reads and manual observation refreshes never send email.

## Rollout and rollback

Server-only controls:

- `NOTIFICATIONS_ENABLED=true` and `NOTIFICATION_PILOT_UIDS=<UID list>` enroll the inbox pilot. `*` is reserved for a later explicit rollout.
- `NOTIFICATION_EVENTS_ENABLED=true` permits event creation/reconciliation.
- `NOTIFICATION_EMAILS_ENABLED=false` is the initial deployment default. Keep it false until configuration and live checks pass.

Rollback may pause event creation and sending independently. It does not delete preferences, event history, delivery identities, plans or measurements. Re-enabling validates current eligibility and processes only relevant work, not an accumulated history of checkpoints. Deployment rollback target before this phase: `dpl_3oYeRoLJwydFdxQ4CyWtfYthZ2kW`.

Private records: `notificationPreferences`, `notificationEvents`, `notificationIssueEpisodes`, `notificationConnectionObservations`, `notificationDeliveries` (including webhook receipts), `notificationTestLimits`, operational `notificationJobs` and global `notificationBudgets`. Direct client access is denied. Account-owned records are covered by both deletion sweeps.

## Final setup with Bryan

1. Verify an owned Resend sending domain and choose a From and Reply-To address. Disable that domain's open and click tracking.
2. Add server-only Vercel production values: `RESEND_API_KEY`, `RESEND_NOTIFICATION_FROM`, `RESEND_NOTIFICATION_REPLY_TO`, `RESEND_WEBHOOK_SECRET`, and `NOTIFICATION_PUBLIC_ORIGIN=https://simplseo-io.vercel.app`.
3. Generate a fresh high-entropy `NOTIFICATION_UNSUBSCRIBE_SECRET` server-side. Register `https://simplseo-io.vercel.app/api/notifications/webhook` with Resend for sent, delivered, delayed, bounced, complained, failed and suppressed events. Confirm raw-body signature handling.
4. Set `NOTIFICATION_TRACKING_DISABLED=true` only after verifying the Resend domain settings. Enable sending for the pilot only after the preceding setup. Review Bryan's opt-in and verified recipient, then use the labeled test email.
5. Test desktop/mobile rendering, ordinary signed-out login return and unsubscribe. Confirm actual accepted/delivered records without making a fake progress event.
6. **Firecrawl reminder:** add `FIRECRAWL_API_KEY` when ready. Keep fallback disabled until the Phase 8 bounded evaluation passes. This is optional and does not block notifications or native website review.
7. Publish genuine homepage improvements manually and confirm only the exact changes actually published.

Never put API keys in chat messages, source files, browser variables or screenshots. Use Vercel's server-only settings.

## Release evidence and remaining live checkpoints

Verification on 2026-10-11:

- Unit tests: 72 files, 1,291 tests passed, including 37 focused delivery tests.
- Browser regressions: all 209 scenarios passed across the full run and focused rechecks. Initial failures exposed missing emulator setup flags/account fixtures; the seed now includes the authoritative account documents. Two development-browser runs reported an unclassified `Event` after their feature assertions passed. Strict error assertions remain enabled; the final notification suite passed 6/6 and the bell case passed five further sequential repetitions. Added diagnostics will preserve the event target if it recurs.
- Production build passed; lint reported zero errors and seven existing warnings. Desktop/mobile inbox, email previews, keyboard operation, safe sign-in return, independent preference errors, unsubscribe and Firestore write denial were checked with isolated fixtures.
- Firestore rules and indexes deployed successfully. Removed redundant implicit `__name__` index declarations to avoid an existing-index conflict in Firebase CLI; no index or account data was deleted.

Isolated fixtures exercise all states without inserting them into Bryan's production account. Production verification and deployment identifiers are recorded below after promotion.

Still require observation over time:

- A real scheduled invocation correlated with Vercel logs and saved notification run health (a manual request is not scheduler proof).
- A real published homepage edit and eligible complete reporting comparison.
- Exactly one genuine results-ready notice and its authenticated destination.
- Delivery health review before enrolling additional accounts.

Resend references: [idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys), [webhook signatures](https://resend.com/docs/webhooks/verify-webhooks-requests), [webhook event meanings](https://resend.com/docs/webhooks/event-types).

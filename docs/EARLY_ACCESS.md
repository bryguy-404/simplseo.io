# Invite only early access

Public **Get started** opens the invitation request form. Requests are saved before the admin email is attempted. Bryan can open **Account → Early-access invitations** to approve a request or send a direct invitation. Returning members use the normal **Sign in** page.

## Account and email behavior

- Invitations last 14 days and have an **Accept invitation** button. There are no typed codes. Loading or scanning the link does not accept it.
- The first verified Google account that explicitly accepts the link receives durable access. The invitation inbox and chosen Google account may differ. The email explains that the link is private and single-use.
- Google login establishes SimplSEO identity only. Search Console authorization remains a separate onboarding step and can use another Google account.
- A grant is attached to the Firebase UID. Logout, email changes and later visits do not require another invitation. Unfinished setup resumes; completed accounts go to the dashboard.
- Existing Firebase accounts created before the fixed rollout cutoff retain access. Existing `approvedUsers` approvals and administrator claims are also honored. No plans, website identities, confirmations or measurement dates are migrated or overwritten.
- Newly admitted accounts use onboarding v2 even outside its original pilot allowlist. Other feature pilot controls remain unchanged.
- Browser-supplied approval checks and typed invitation codes are retired. New authenticated APIs enforce admission before protected application work.

## Operations and controls

Production configuration:

| Setting | Value or role |
|---|---|
| `EARLY_ACCESS_ENABLED` | `true`; server admission gate |
| `EARLY_ACCESS_EXISTING_BEFORE` | `2026-10-13T17:32:00.000Z`; keep this fixed on future releases |
| `EARLY_ACCESS_EMAILS_ENABLED` | `true`; set `false` to pause invitation and request-notice email |
| `EARLY_ACCESS_ADMIN_EMAIL` | `simplseoai@gmail.com` |
| `ADMIN_UIDS` | Existing administrator allowlist; never browser-controlled |
| `INVITATION_SIGNING_SECRET` | Optional dedicated server secret; otherwise use the existing notification secret with a separate HMAC context |

Uses the verified Resend sender, reply-to address and production origin already configured for notifications. Contact email is unchanged. Access email is separate from optional progress-notification consent and from AI spending.

The admin list distinguishes saved requests, invited users and joined users. **Retry saved email** retains the same payload and idempotency key. **Send replacement link** explicitly revokes the previous invitation; it does not revoke an already joined account. Failed admin notices can be retried from the request card. Expired or declined requests can be submitted again after 24 hours.

Provider attempts are reserved atomically, with limits of 50 daily and 500 monthly for early-access email, three attempts per frozen email, and a shared dispatch lane with progress emails. Unknown outcomes are retried only within 23 hours of the first attempt, respecting [Resend's 24-hour idempotency retention](https://resend.com/docs/dashboard/emails/idempotency-keys). After that, inspect Resend before explicitly replacing an invitation. Provider acceptance is shown as acceptance, not guaranteed delivery. There is no new cron or automatic retry loop.

Invitation grants, links, delivery payloads and limits are server-owned. Tokens travel in the email URL fragment and the acceptance POST, not URL query logs. Account deletion removes linked grants, requests, invitations and mail; finishing provider work cannot recreate deleted records. Listing uses bounded document-ID pagination with no additional composite index.

## Verification

- Unit suite: 73 files, 1,311 tests passed, including access policy, email failure/retry limits, shared email dispatch, token tampering, single-use acceptance, deletion across different invitation and sign-in emails, legacy accounts and unchanged saved work.
- Browser and Firestore emulator checks: 19 cases passed, including two-account claim races, request UI at desktop/390px/320px, logout/sign-in restoration, direct-write denial, admin routing and access-check retry.
- Production build passed. Lint has no errors; existing image and hook warnings remain.
- No invitations were sent to real users during automated verification. Test identities and invitations exist only in the local emulators.
- Before release, all four production Firebase identities predate the rollout cutoff. Bryan's 368 saved records were fingerprinted for the live read-only preservation check.
- Staged production verification passed on `dpl_Dqko8tLD54sBsntRwehpqBgbft8J` (runtime commit `f177e24`): Bryan retains administrator access and the dashboard destination; anonymous requests are denied; all 368 saved records exactly match the pre-release fingerprint. See `docs/evidence/early-access-release-2026-10-13.json`.

## Rollback

Pause sending with `EARLY_ACCESS_EMAILS_ENABLED=false` and redeploy to retain the request inbox, grants and sign-in. To remove the admission gate deliberately, set both `EARLY_ACCESS_ENABLED` and legacy `NEXT_PUBLIC_ENABLE_ACCESS_REQUEST` to `false`, then redeploy. This opens registration; it is not required for an email outage.

The previous production deployment is `dpl_8juRPdXNVTp2JHumCZuoCSDgaZZr`. Rolling back the entire application retains saved data, but restores the old entry screens; accepted new invitations may need the current access-aware sign-in to resume. Prefer disabling sending or applying a focused fix while preserving the new admission reader. Never delete grants or reset the fixed cutoff as part of rollback.

The remaining live checkpoint is the first intended recipient opening a real invitation, choosing their Google account and completing setup. Mocked delivery and emulator acceptance do not establish real mailbox delivery for this feature.

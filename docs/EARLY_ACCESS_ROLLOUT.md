# Simplified early access — first 10–15 users

Bryan authorized the consistent simplified experience for every approved member on November 25, 2026. The invitation gate stays in place. Requesting access alone does not approve an account; accepted invitations, existing approved accounts and administrators retain the established admission rules.

## Production configuration

`config/early-access-rollout.json` is the non-secret production configuration contract. Apply it to the existing Vercel project, then deploy. The five `*_PILOT_UIDS` settings use `*`: new setup, visual dashboard, ongoing reviews/monitoring, mentor and notifications no longer require individually adding admitted users to feature lists. The master feature switches remain available for rollback. Protected APIs still call `requireUser` and enforce account/property ownership.

Notification delivery retains its existing separate switch, verified sender and per-user opt-in. This rollout never opts someone into email, approves pending requests, creates real invitations, changes Google permissions or resets saved website work. The Firecrawl fallback remains outside the rollout.

## First useful page

`Improve a page` now includes the confirmed website URL when it belongs to the selected Search Console property, even when no inventory or search rows exist yet. The review still fetches current HTML. This adds no fabricated impressions, indexing status, publication or monitoring enrollment. Existing observed and tracked pages keep their original URL identities and metrics.

## Verification

- The 15-account integration test accepts distinct invitations, saves/resumes photographer setup and checks feature eligibility, email opt-out, uninvited/revoked access and cross-account denial.
- The HTTP verifier runs against real local Auth/Firestore emulators. It exercises invitation acceptance, staged Google exchange/property selection, confirmed profile completion, returning sign-in and protected workspace reads for 15 accounts. Google replies are controlled fixtures; it does not prove 15 real OAuth grants or model answers. No production records or real mail are created.
- Browser verification passed using the compiled local app and an isolated photographer account: empty-search-data dashboard, first-page selection, mentor, simplified Settings, email opt-out and mobile navigation at 390 × 844. The fictional fixture website is deliberately not crawlable; this check does not claim a successful live website review or AI response.
- Current Google Auth Platform observations: the matching SimplSEO OAuth client belongs to `simpleseo-90570`; audience is External and In production. Its declared email and `webmasters.readonly` permissions appear as non-sensitive. No changes were made to Google settings. Branding verification is separate from permission access.
- The complete unit/API suite passed: **76 files, 1,344 tests**. Production compilation and scoped lint passed. The separate HTTP verifier also passed for all 15 accounts. After deployment, verify the exact source commit/production alias, read the configuration back, and check runtime errors.

## Local reproduction

Start the Firebase Auth and Firestore emulators using `demo-simpleseo` and the repository's rules. Java 21 is required by the installed emulator tooling.

```sh
node scripts/run-rollout-preview.cjs build
node scripts/run-rollout-preview.cjs start
node scripts/verify-early-access-rollout.cjs
```

The preview launcher pins demo Firebase, disables real email and Analytics, and loads controlled Google responses only in the local server process. Those responses are never loaded by the normal production build/start scripts. The verifier is fixed to localhost and demo Firebase. Browser fixture accounts are `rollout-photo-1@example.test` through `rollout-photo-15@example.test`; their test-only password is in the verifier. Stop every preview/emulator process started for verification.

## Limits and rollback

Per-account allowances remain: 20 page reviews/day; 3 new-page assessments, 5 drafts and 2 nearby-area checks/day; 50 mentor messages/day with separate research and burst limits. The mentor retains its shared **$25/month estimated spending cap**, rather than raising spending automatically for enrollment. Fifteen initial mentor reservations fit in an empty ledger; this is not a guarantee of a month's usage for 15 people. Reaching a cap preserves saved work and shows an allowance message. Website/Google availability, site-builder rendering, real-user usability and SEO outcomes still need cohort observation.

For a feature regression, use its existing master switch or restore a verified explicit account list, then redeploy. To roll back application code, use the preceding verified production deployment. Keep `EARLY_ACCESS_ENABLED=true`, the fixed existing-account cutoff and all grants, preferences, plans and history. Rollback must not open public registration or delete customer data.

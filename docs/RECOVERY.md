# Account recovery operations

This release separates dashboard access from Search Console visibility. The master roadmap defines scope and the live user checkpoint. Later product phases are not part of this implementation.

## Known production targets

- Firebase project: `simpleseo-90570`.
- Vercel project: `simplseo-io` (`prj_EMGZFw7371xFbfC2r2fFHKeNSfJ6`).
- Vercel team: `team_FeyySaQxPebSkHiDiFIyLd8l`.
- Existing deployed Firebase functions confirmed: `checkSeoTipProgress`, `listImplementedSeoTips`, `testPostStatsUpdate`, `updateAllMissingPostStats`, `updateDocumentWithGscData`, all Node 20 in `us-central1`.

Exact production deployment revision and account UID/property must be verified before migration. No identity is hardcoded into recovery code.

## Local verification

- `npm test` runs isolated logic and mocked API tests; unexpected HTTP calls fail.
- `npm run lint` uses ESLint directly. Baseline: zero errors, sixteen warnings.
- `npm run build` now bundles the existing Geist fonts locally; both a fresh restricted-network build and the Vercel build passed. The browser still uses the existing DM Sans stylesheet.
- Emulator tests use only `demo-simpleseo`, Firestore on `127.0.0.1:8080` and Auth on `127.0.0.1:9099`.
- Browser tests run against the isolated app configuration, never production credentials. Keep test reports and browser state out of version control.

## Release order

1. Complete tests and inspect the final diff, retaining unrelated local files.
2. Record the deployed source revision and exact Firebase target. Confirm the Google callback configuration and cron secret without printing credentials.
3. Preserve a protected backup of account records and timestamps. Dry-run migration with verified UID/property; compare intended field changes.
4. Deploy the disabled maintenance functions and paused recovery processing before enabling the recovered dashboard.
5. Deploy the app, run unauthorized endpoint checks, apply the narrow account migration and perform an authenticated Search Console check.
6. Confirm scheduled monitoring independently of setup completion. Record evidence without tokens or personal data.
7. Ask Bryan to perform the roadmap's live checkpoint. Pause further phases for feedback.

## Rollback

Retain disabled public maintenance functions, ownership checks and the outcome-processing pause. Do not roll back to synthetic metric generation. Restore only fields changed by recovery after checking that their current values still equal the migration's expected values; preserve newer user and cron writes. Immutable snapshots remain available. Keep backups outside Git with restrictive permissions.

## Limits

Search Analytics rows are observations, not an indexing verdict. Missing rows do not prove a penalty. Old performance records are unverified. Full authorization remediation and outcome formula redesign remain Phase 2. Already overwritten history cannot be reconstructed from current records alone.

## Verified source and commands

Original production deployment `dpl_GhXNL1wk9297SckvXxoYfPY7yTcg` was built from `main` at `8a83a4302b45e892c6e5f8e5ac815c569fec14a5`. Its alias is `https://simplseo-io.vercel.app`.

`inspect-recovery-account.cjs` reads the account/property match without printing credentials. `recover-account.cjs UID PROPERTY` is a dry run; `--apply` requires `RECOVERY_BACKUP_DIR` outside the repository and verifies the backup before writing. `rollback-recovery.cjs BACKUP_PATH` is also a dry run and refuses to overwrite recovery fields changed since migration. Progress processing remains paused during rollback.

`verify-recovery-release.cjs ORIGIN UID PROPERTY` creates a temporary in-memory Firebase session, checks ownership enforcement and history, then performs real Google monitoring and an authenticated call to the cron route. It never prints session credentials. A successful direct cron invocation does not by itself confirm the next scheduled invocation.


## Release result on October 10 2026

Production is running application commit `50e00ce` on deployment `dpl_35gDNbvorPtfkYKGKF97yE225uPv`, promoted to `https://simplseo-io.vercel.app`. Two superseded staged builds were cancelled without promotion. Firebase functions and Firestore rules were deployed successfully before recovery.

Validation passed: 36 logic/API tests, six browser/rules scenarios, fresh production build, Vercel production build, and lint with zero errors and the sixteen existing warnings. Failure-path coverage includes interrupted snapshots, bounded/failed scans, credential failures, stale monitoring responses, wrong-user requests, failed completion saves and blocked/declined reconnects.

The account matched `bryandevelops.com` and the exact property `https://bryandevelops.com/`. Recovery preserved 45 source records in an owner-only backup outside Git and created a read-only history snapshot containing 11 already-archived records. It retained all 29 tracked pages and did not reactivate archived keywords or implementations. A rollback dry run passed without changing production.

The authenticated live check at 15:14 UTC returned HTTP 200 with a usable Google connection, 29 pages checked, 4 with search data, 25 without data and zero page errors. Setup is complete, monitoring remains enabled, and automated outcome processing remains paused. The authenticated cron route also returned HTTP 200 and checked this account. This confirms the route works after completion, not that the next scheduled invocation has already occurred.

Open checkpoints: Bryan's live login/navigation/history review, and observation of the next automatic 03:00 UTC cron invocation. Do not begin Phase 2 or unpause automated outcome decisions until Bryan's recovery checkpoint is accepted.

Protected backups are in `/Users/bryanarambula/Backups/simpleseo/recovery/`; the apply-time backup ends in `1791645173838.json`. Do not attach these files to issues, PRs or public artifacts.

Post-release error scan: zero error-level records for the promoted deployment during the verification window. Temporary demo servers/emulators were stopped after verification.

## Repeating the browser checks

Use Java 21 or newer for Firestore emulation and install the Playwright Chromium browser. Start the emulators with `firebase emulators:start --only auth,firestore --project demo-simpleseo`, then run `node scripts/seed-emulators.cjs` and `node scripts/test-server.cjs` in separate terminals. Run `npm run test:e2e` against port 3100. If Chromium was installed to a custom location, set `PLAYWRIGHT_BROWSERS_PATH` to that directory for both installation and test execution. The fixtures use fake `.test` accounts and must never be copied into production.

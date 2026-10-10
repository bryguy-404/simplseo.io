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
- `npm run build` requires access to the existing Google Fonts dependency.
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

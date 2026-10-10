# Phase 2 Firestore and deletion audit

This audit covers the collection paths used in the repository as of October 10, 2026. It does not claim that Firestore rules secure Admin SDK calls: authenticated API and server-helper checks are a separate boundary.

## Rules and compatibility decisions

| Collection/path | Client access after this change | Account deletion coverage |
| --- | --- | --- |
| `onboarding/{uid}` | Owner read; whitelisted profile, preference, and onboarding-navigation updates. Creation allows only benign monitoring defaults. Client delete is denied. | Recursive UID root, last in deletion sequence. |
| `users/{uid}` | Owner read remains for existing browser Google API calls. All writes use authenticated server APIs. | Recursive root includes feedback, immutable recovery history, and any nested records. |
| `users/{uid}/feedbackPrompt/*` | Owner read/write; contains feedback timing, not measurements or credentials. | Included in user tree. |
| `users/{uid}/revampHistory/**` | No direct client access; authenticated history endpoint returns sanitized records. | Included in user tree. |
| `gscTokens/{uid}` | Owner read compatibility; no client writes/deletes. | Recursive UID root. |
| `implementedSeoTips`, `contentAuditResults`, `aiSuggestions` | Explicit owner read/write; legacy UID-prefixed ownerless records remain scoped. Owner transfers and client delete are denied. Writes require completed history if a recovery run exists. | `userId` query plus attributable UID-prefixed legacy records; recursive deletion. |
| `internalLinkSuggestions` | Scoped by explicit owner or legacy UID prefix; ownership cannot change. | Owner query and legacy UID prefix. |
| `pageContentCache/{uid}/pages/*`, `intentMismatches/{uid}/analyses/*` | UID-scoped read/write, no different `userId` assignment. | Entire UID root, including missing parent documents. |
| Flat page-content/intent caches | Explicit owner or attributable UID prefix; no ownership transfer. | Owner query plus UID prefix. |
| `seoMetaTitles/{uid}/titles/*`, `seoMetaDescriptions/{uid}/descriptions/*` | UID-scoped read/write. | Entire UID root. |
| Flat meta caches | Existing records require an explicit matching `userId`. New client creates are denied; clients use UID-scoped paths. Ownerless legacy documents are denied rather than assigning ownership by URL. | Explicit-owner query. Ownerless URL-keyed records cannot safely be attributed and are not guessed or deleted. |
| `focusKeywords`, `siteCrawls`, `contentKeywordEdits` | Server APIs only. | Recursive UID roots. |
| `conversations`, `genericKeywordsCache`, `contactMessages` | Server APIs only. | Owner query, recursively deleting child records. |
| `gscOAuthStates` | Server only. | `uid` query. |
| `progressJobs` | Server only. | Recursive `user-{uid}` root and any legacy UID root; shared daily cursor retained. |
| `requestLimits` | Server only. | `userId` query removes per-account AI quotas. Public IP buckets are not attributable to an account and require expiry cleanup. |
| `skippedKeywords/{uid}/keywords/*`, `createdContentOpportunities/{uid}/created/*` | Server APIs only. | Recursive UID roots, including orphaned children. |
| `trainingEvents/{sha256(uid)}/events/*`, `playbookStrategies/{sha256(uid)}/strategies/*`, `conversationSummaries/{sha256(uid)}/summaries/*` | Server only. | Recursive hash-scoped roots. |
| `accessRequests`, `approvedUsers`, `invitationCodes` | Server only. | Verified Firebase Auth email lookup/key; request-body email is ignored. |
| `deletedUsers` | Server only. No new copy of deleted profile/email is retained. | Existing UID-root record removed. |
| `appConfig` | Server only; shared configuration is not an account-owned record. | Retained. |
| Unknown/future paths | Default deny. | Must be added to the deletion inventory when introduced. |

## Trusted measurements

The entire `progressAssessment` field is server-owned. Rules deny its creation, modification, removal, and deleting the containing SEO record to bypass those restrictions. Recovery/monitoring fields in onboarding are also protected on create, update, replacement, and delete. `progressJobs` is inaccessible to client SDKs.

Historical `preStats`, `postStats`, and related legacy snapshots remain writable for existing panel compatibility. They are unverified client inputs and must not be used as authoritative measurements or to trigger success claims. The new progress engine obtains observations from Google independently. A preserved assessment for a previous implementation must be ignored when its implementation, page, or property no longer matches the current record.

Credential fields cannot be added to or changed in SEO records. Unchanged legacy values can remain, and clients may remove them during a fresh implementation without preserving old secrets. The read-only recovery-history API strips credentials.

## Known remaining credential limitation

Owners can still read their own `users` and legacy `gscTokens` documents because existing Google API clients require them. This change prevents other accounts from reading them and prevents direct token mutation, but **does not yet make refresh tokens server-only**. A complete server proxy migration is required before those owner reads can be removed. Rule changes alone cannot selectively hide fields in a readable Firestore document.

## Deletion behavior

The API derives the UID from verified Firebase authentication, then obtains email from Firebase Auth. It removes account-owned Firestore trees, hashed training/playbook/conversation data, OAuth states, and attributable legacy records. Each query is processed in groups of 200 and each matching root is deleted recursively; Firestore's 500-write batch limit does not truncate a large account.

When optional BigQuery logging is enabled, deletion first uses a parameterized hash filter against the configured existing export table. Project/dataset/table identifiers are validated. Missing configuration, provider failures, or streaming-buffer restrictions cause the endpoint to fail without claiming deletion succeeded. No BigQuery or production deletion was executed as part of implementation.

Failures are propagated, with sanitized responses. No tokens, email, profile copies, or provider request details are placed in deletion logs or retained in a `deletedUsers` notification record. The existing Settings flow still performs recent reauthentication and deletes the Firebase Auth account only after the data endpoint succeeds. Retries are idempotent; a partial failure is surfaced, not silently swallowed. Account context is deleted last to keep a retry possible.

Ownerless URL-only legacy meta records cannot be attributed reliably. They are inaccessible to ordinary clients; an administrative migration needs original provenance before assigning or erasing them. Shared `appConfig` statistics and any external email already delivered are not account documents. A concurrent application request may still write during deletion; a future account-deleting lifecycle/tombstone could coordinate every producer if concurrent teardown becomes necessary.

## Verification

- Unit tests cover hashed trees, missing parent documents, legacy namespaces, preservation of another account, 501 records, retry behavior, failures, path validation, parameterized BigQuery filtering, authentication identity, and sanitized API errors.
- Seven scenarios in `tests/browser/phase2-rules.spec.js` passed against real Auth/Firestore emulators in `demo-simpleseo`, with loopback endpoints hardcoded. They cover onboarding create/update/delete bypasses, authoritative outcome tampering, owner transfers, claiming another account's future legacy record IDs, immutable history, missing-record reads, ownerless legacy meta access, nested cross-account access, legitimate current writes, token mutation, safe credential removal, and server-managed collections.
- No deletion is run against a real account by these tests.

# Phase 2 access and request boundaries

Implementation inventory for the account/data reliability phase. This file covers the API and cache work; the master roadmap remains the phase/checkpoint authority. Final production operations and checks are recorded in [PHASE2.md](PHASE2.md).

## Authenticated account and AI routes

`app/lib/server/authenticatedRoute.js` verifies a revocation-checked Firebase ID token before handler, database, or provider work. It rejects a different query/body UID, rejects a different nested chat UID, and passes the verified UID to legacy handlers. It accepts only JSON objects and bounds request size to 500 KB. Existing recovery/GSC routes use their established `requireUser` guard.

The wrapper now covers:

- Conversation listing/creation and individual GET/PUT/DELETE. An existing conversation ID also requires a matching stored owner; another account receives 404 without reading or mutating its contents.
- Content-keyword edits, opportunity creation/skipping, page recrawls, implementation resets, H1 lookup, and training-event writes.
- All SEO assistant routes, content audits, intent analysis, branded-keyword filtering, keyword extraction, generic/long-tail analysis, content expansion, and the full chatbot.
- Sitemap and public page scraping, plus the new private page/intent cache endpoint.

Server-derived ownership is also applied to nested cache payloads. Resetting archived work returns 409. A legacy hardcoded page-name match in the reset route was removed; an unrelated implementation can no longer be selected by that special case. Full legacy record logging was removed because records could contain old Google tokens.

All AI POST routes share persisted request quotas of 30 requests per minute and 200 requests per UTC day per Firebase UID. Quotas are enforced transactionally before paid work. These are request-count safeguards, not token budgets, subscriptions, or protection against creating many accounts. `requestLimits` stores an account UID for these records and an `expiresAt` timestamp.

## Browser and server separation

Internal Admin SDK/provider modules no longer use `use server`, which had exposed exported functions as callable server actions without their route guards. Browser cache callers now use authenticated `/api/page-content/cache`. Internal cache helpers consistently use Admin SDK behind authenticated routes. Legacy meta caches are read only when their stored owner matches; writes never overwrite another owner's legacy entry. Reads no longer silently migrate another account's or ownerless data.

Browser API callers use `authenticatedFetch`. Server-to-server scraping now calls an internal helper instead of forwarding Firebase credentials to a configured base URL. Browser local-storage API caches are version 2 and include the Firebase UID, refuse signed-out reads/writes, and discard a response if the account changes while it is in flight. Old unscoped version 1 entries are not read.

Legacy playbook strategies are not injected into recommendations while their old success measurements remain unverified.

## Public website requests

`publicFetch` is the only server transport for user-controlled page URLs, sitemap URLs, redirects, crawls, and URL validation. It allows HTTP/HTTPS on normal web ports, rejects embedded credentials and nonpublic IP addresses, validates all DNS answers, and pins the validated address in the Node HTTP/TLS connection lookup. Every redirect is resolved and validated again. It bounds redirects to five, each request to fifteen seconds, and each response to 2 MiB; DNS lookup has a ten-second deadline. It never forwards Authorization or other caller-supplied credentials to a scanned website. Sitemap traversal is bounded to twenty child sitemaps.

Browser-only WordPress page loading is still a direct browser request; it does not run on the server or access server credentials.

## Google connection and administration

Initial onboarding now uses the same state-bound popup flow as recovery. Property selection is saved only after the server accepts the connection. Google tokens are no longer accepted from URL query parameters. `/api/auth/google` returns 410. The old callback URL remains a compatibility redirect carrying only the short-lived authorization code, state, or error to `/gsc-callback`; the authenticated exchange consumes and verifies state before exchanging the code.

`/api/admin/approve` requires a Firebase user with `customClaims.admin === true` or a UID in the server-only comma-separated `ADMIN_UIDS` environment setting. Missing configuration fails closed. A supplied email or old `ADMIN_SECRET` no longer grants authority. The admin page uses account sign-in and removes its old stored admin secret. Release configuration grants this role to Bryan's verified existing account; authenticated GET returned 200 and anonymous GET returned 401. No approval action or invitation email was triggered by verification.

## Intentionally public signup/contact routes

Access requests, invitation verification, approval-status lookup, and contact remain available before sign-in. They now have bounded input, same-origin checks when a browser Origin header is present, and persisted rate limits keyed by a hash of the route, IP, and time bucket. Invitation verification consumes a valid, unexpired code in a transaction. Code generation uses cryptographic randomness. Public approval lookup returns only approval/status information, never invitation codes or private timestamps. Contact identity fields cannot impersonate a supplied UID; verified identity is used only when a Firebase token accompanies the request. User-supplied email HTML is escaped, and SMTP certificate verification is enabled.

Public request-limit records are IP/time-bucket hashes, not attributed to an account. The Firestore TTL policy for `requestLimits.expiresAt` was deployed and verified ACTIVE on October 10, 2026. Expiry affects bucket eligibility immediately; physical deletion is asynchronous. TTL applies only to these temporary quota counters.

The approval-status lookup remains an intentional email-status lookup for the existing signup experience. When `NEXT_PUBLIC_ENABLE_ACCESS_REQUEST=true` on the server, the shared `requireUser` guard also requires a verified Firebase email in `approvedUsers` (or server-configured admin identity). A supplied request email cannot satisfy approval. Paid entitlements remain a separate pilot/billing concern; quotas do not supply a billing system.

## Verification

- `npm test -- --run tests/phase2Access.test.js tests/phase2ClientCache.test.js tests/publicFetch.test.js tests/revampCrawl.test.js`: 48 passed. Tests cover anonymous/cross-account routes before side effects, conversation ownership, nested cache spoofing, legacy cache isolation, missing/admin identity, invitation privacy/single use, quota enforcement, DNS pinning, private and mapped addresses, redirect revalidation, response bounds, account-switched browser caches, and prior recovery crawl behavior.
- `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/simpleseo-test-runtime/browsers npm run test:e2e -- tests/browser/phase2-access.spec.js`: two passed against only the local `demo-simpleseo` Auth/Firestore emulators and the local app. Real Firebase IDs could not cross account boundaries; a known conversation ID did not grant another account read, update, or delete access.
- Repository lint completed with zero errors; preexisting warnings remain.

These isolated tests did not perform live provider calls, mail delivery, production admin assignment, or TTL provisioning. Separate release checks subsequently verified a real Google observation, configured and checked admin access, and activated TTL; see [release evidence](PHASE2.md). No mail delivery was triggered.

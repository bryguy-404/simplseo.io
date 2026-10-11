# Phase 8 — Reliable onboarding

## Release scope

The new flow is **website → Google → business details → readiness → dashboard**. Setup is saved on the server and resumes after refresh, logout or another device. Beginners can enter business facts while Google connection is pending. They must explicitly select a matching owner/full-user Search Console property with a durable offline grant before completing new setup. Partial coverage, failed inspections and no reported activity are not completion gates.

Existing completed accounts retain dashboard access. Settings offers an optional business-profile review. Confirmation changes business facts only: the exact stored website/property/version identity, task plans, owner edits, publication dates and progress records remain intact. Website/property replacement continues through its separate transition.

This release does not publish websites, verify Google properties, submit indexing requests, redesign the mentor, send emails or add schedules. Firecrawl is implemented as a disabled optional adapter; its live rendering evaluation remains pending.

## Durable state and Google authorization

- `users/{uid}/onboardingSessions/current`: pinned setup version, revision, separate website/Google/profile/readiness state, request IDs, server save times and a bounded readiness lease. Previous website scopes are archived below session history.
- Browser legacy drafts can seed editable business fields only. They cannot supply tokens, a property, completion state or a replacement website identity.
- Required email verification has explicit send and retry controls. Verification refreshes the Firebase identity token and rechecks server access; it does not bypass existing account approval. Local-only business/location/service drafts survive migration, and a missing customer goal requires an explicit choice.
- Setup writes require authenticated identity, expected revision and an idempotency key. Failed saves keep the form visible; repeated successful submissions reuse saved results.
- OAuth credentials are held privately in `pendingGscConnections`, bound to the account, setup session, scope and connection version. A pending grant expires after 30 minutes; OAuth state expires after 10 minutes. Expiring a grant does not delete business input.
- Allowed property choices are validated against the entered website using Domain or URL-prefix boundaries. Restricted matches are explained separately. Refreshing the property list returns a new saved revision. The owner must select a property explicitly.
- Token refresh is proven before commitment. Credentials from separate attempts are never combined. Reconnection must validate before replacing a working connection; same-property reconnection does not move saved work.
- `/api/gsc/store-tokens` no longer accepts browser token/property writes. The new `/api/gsc/select` and adapted connect/exchange/properties endpoints use staged credentials.
- Completion is one guarded transaction: confirmed required profile, privacy acceptance, durable matching Google grant, compatible completion fields, versioned profile and final session. Inventory promotion is subsequent and retryable; it cannot undo otherwise valid completion.

`accountDeletionGuards/{sha256(uid)}` contains only a deletion marker and original deletion date. It deliberately survives data removal to prevent an in-flight valid Firebase Auth session from recreating deleted setup roots. It is private and does not contain tokens, emails, website facts or profile copy. All other new account-owned records participate in recursive deletion and final sweeps.

## Website review and extraction

Before Google is validated, native preview reads the homepage and up to four relevant linked pages. After validation, the shared inventory permits up to 20 sitemap documents, 500 discovered URLs and 100 HTML attempts, three concurrent native fetches, and resumable 45-second batches. Eligible preview observations are reused. Three explicitly started/restarted reviews per account per day are allowed; continuing a batch does not consume another start.

The inventory records failed, excluded, pending and truncated observations with dates. It prioritizes useful business/service/about/contact/FAQ/project pages. Structured business and FAQ markup is bounded and retained alongside readable excerpts. Source markup is untrusted evidence, not an instruction. Missing text does not establish a missing service.

Business extraction is explicit, requires a validated property, and makes at most one call for unchanged substantive evidence. Three attempts per account per day are reserved atomically. Invalid output, unknown usage and failures remain accounted for; saved input remains editable. `ONBOARDING_EXTRACTION_ENABLED=false` pauses paid extraction while retaining native review and manual confirmation.

Firecrawl, if later approved by evaluation, is limited to eligible unreadable content or JavaScript shells. It does not override 404/410, robots exclusions or authentication. SimplSEO controls discovery and sends only public URLs. Native HTTP/canonical/indexing observations remain separate from rendered copy. Limits are 10 attempts/inventory, 20/account/day, concurrency two and a global 500-attempt monthly ceiling, with no automatic paid retries/top-ups. Successful results use SimplSEO's own seven-day cache. Attempts, reported credits, unknown usage, latency and failures are separate from OpenAI accounting.

The eight-real-website, 40-attempt Firecrawl evaluation and privacy-disclosure update must pass before enabling this provider. Credentials were unavailable during this release; no Firecrawl calls were made. See [evaluation record](PHASE8_EVALUATION.md).

## Shared business profile and consumers

`users/{uid}/businessProfiles/{scopeHash}` stores a revisioned owner-confirmed profile with dated history. Supporting website observations, suggestions and unresolved questions remain separate. Required fields are name/category, main services, base city/region/country, actual service areas and inquiries/quotes/bookings goal. Builder, customer types and differentiators are optional. Suggested facts retain source URLs, observation dates and quoted evidence; owners confirm their own statements.

Refreshes propose facts for review and never overwrite owner corrections. Legacy accounts without a confirmation keep labeled legacy information. The common context reader feeds Improve a page, New page ideas and both assistant entry points. The assistant receives bounded current website excerpts without a new crawl on load; deeper mentor behavior is unchanged.

Substantive profile changes enter future analysis fingerprints. A new confirmation timestamp alone does not justify generation. If the profile changes while a recommendation is being generated, the save fails safely and retains previous work. New-page area confirmations remain separate: conflicting services produce a review notice instead of silently modifying the area or existing plans.

## Readiness and interfaces

Independent compact cards show Google connection, website review and buffered search activity. Technical details are expandable. Website observations include homepage availability, sitemap findings and indexing directives. After connection, Google inspection is limited to the homepage and up to two service pages, labeled as Google's dated stored view. Missing and failed observations are distinct; successful prior observations retain their dates after later failures.

- `/api/onboarding/workspace`: saved reads; begin/save/review/extract/profile-confirm/readiness/complete actions.
- `/api/business-profile`: common saved profile read and guarded update.
- Reads do not crawl, refresh Google or generate AI responses.
- All provider results are revalidated against account existence, website/property/version and relevant revisions before saving. Firestore rules deny direct writes to authoritative sessions, profiles, staged connections, inventories, extractions and provider accounting.
- The obsolete mandatory page/keyword gate is removed from this onboarding path. The first dashboard action is Improve an existing page, with New page ideas alongside it; loading either does not generate recommendations.

## Rollout and rollback

Server-only switches:

| Setting | Pilot value | Purpose |
| --- | --- | --- |
| `ONBOARDING_V2_ENABLED` | `true` | New v2 enrollment master switch |
| `ONBOARDING_V2_PILOT_UIDS` | Bryan's UID only | Initial enrollment allowlist |
| `ONBOARDING_EXTRACTION_ENABLED` | `true` | Explicit structured business extraction |
| `ONBOARDING_FIRECRAWL_ENABLED` | `false` | Optional rendered fallback |
| `ONBOARDING_FIRECRAWL_EVALUATION_PASSED` | `false` | Separate evaluation gate |

The setup version is pinned once begun. Disable enrollment to stop new v2 starts; enrolled users retain resume and manual completion. Disable extraction independently to stop paid extraction. Keep both Firecrawl gates false unless the real evaluation passes. No rollback deletes saved sessions, profile history or existing plans. Rules should not be rolled back to permit client credential/completion writes.

During the initial allowlist rollout, completed nonpilot accounts still use the dashboard. Nonpilot incomplete/new accounts see setup temporarily unavailable instead of entering the retired legacy wizard. Add a genuinely authorized fresh pilot account to the allowlist for the new-account checkpoint before broadening enrollment. This is not the old crawl/traffic waiting room.

Deploy with production environment variables and `--skip-domain`; verify the staged deployment before promoting the same deployment to the existing public URL. Saved reads and account identity are checked again after promotion. OAuth expiry is enforced in application code independently of asynchronous Firestore TTL cleanup.

## Validation and live checkpoints

Isolated production compilation passed. All 160 distinct browser/API/rules scenarios passed: 148 in the initial full run, eight recovery/access cases after seeding missing demo users (one overlapping pass), and five additional onboarding cases in the final patch. The initial seven failures were absent synthetic Auth fixtures, not application errors. The final optimized build passed all 25 onboarding UI cases, including verification retries, local-draft authority boundaries and the explicit customer goal. Six compiled API cases ran against Firebase emulators. No demo observations were written to production.

Focused tests cover property boundaries, durable grants, denied consent/cancellation, expired staged sessions, atomic saves, scope changes/deletion during external work, quotas/cache behavior, partial native review, grounded extraction, legacy reads and unchanged task/progress history. The staged begin→exchange→select→confirm→complete integration uses real service helpers with provider responses controlled; duplicate completion performs no provider work. Seven readiness races and profile changes during existing-page/new-page/follow-up analysis preserve previous results. Four isolated visual examples cover successful readiness, Google help, partial coverage and optional existing profile review; mobile and keyboard checks are included.

Final unit/API gate: **1,020 tests across 56 files passed**. Production build passed. Full lint completed with zero errors and nine existing warnings. `git diff --check` passed. The isolated browser preview is `/private/tmp/simpleseo-phase8-preview.html`; it is explicitly labeled and contains no live account data.

Live checkpoints remain distinct from automated tests:

1. Bryan previews the clearly labeled isolated examples.
2. Bryan optionally confirms real business facts in Settings. Verify the original property, website version, plans and progress dates remain unchanged.
3. A genuinely new account with an authorized website/property completes Google consent, logout/resume and the first useful dashboard action. No fake production account or simulated authorization completes this checkpoint.
4. Evaluate Firecrawl only when credentials are available, inspect real accounting and update disclosure before enabling it.
5. Correlate actual scheduled collection with persisted connection refresh/run health. Manual API checks do not establish that a schedule fired.

The existing homepage and new-page pilots continue. Only Bryan's real published edits can start measurement cycles; this onboarding release does not create one.

## Production pilot release — October 11, 2026

Application commit `35bd906` (core implementation `e829ca0`) was built with production settings, verified before promotion, and promoted as `dpl_4GcdF3NFCAhrMboFtuhzfHfYY9Sf` to the existing public URL. Enrollment is limited to Bryan's account; both Firecrawl switches remain false. Firestore rules/indexes deployed successfully, and both staged-credential TTL policies are ACTIVE.

Staged and public saved-state checks passed: six anonymous boundaries rejected access, 11 inspected records retained their contents/update times, the homepage plan remained available, and reads created no setup session, AI usage, cycle or publication confirmation. The first public preservation check overlapped the browser's normal Google credential refresh; the unchanged-record check passed when repeated without concurrent browser activity. The live dashboard and optional Settings profile entry were also inspected. The existing Google connection refreshed successfully during normal dashboard use; this is not verification of a scheduled invocation.

Bryan's profile remains labeled legacy until he chooses **Settings → Profile → Review business details** and confirms his real services/areas. No owner confirmation was submitted by the agent. No runtime errors appeared in the queried release window. Fresh-account consent/resume, owner profile confirmation, Firecrawl evaluation and an actual post-release scheduled run remain separate live checkpoints. The public evidence record is [phase8-release.json](evidence/phase8-release.json).

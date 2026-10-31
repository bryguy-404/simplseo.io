# Google authentication and the production domain

The public app is `https://simpl-seo.com`, hosted by Vercel project `simplseo-io`. Cloudflare manages DNS. Firebase and Google Cloud continue to use `simpleseo-90570`; this migration does not require new keys, OAuth clients, service accounts, user accounts, or customer Search Console properties.

## Firebase sign-in

Firebase Authentication → Settings → Authorized domains includes `simpl-seo.com`, the existing `simplseo-io.vercel.app`, Firebase's default domains, and localhost.

Keep `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=simpleseo-90570.firebaseapp.com`. This is the hosted authentication handler, not the website address. Its existing Google redirect is `https://simpleseo-90570.firebaseapp.com/__/auth/handler`.

The Firebase browser API key has no application/referrer restriction. Its existing API restrictions were retained.

## Search Console OAuth

The existing **SimplSEO** client is `956212275866-7dtgdq7b38b156riehghuvh8b8469ktg.apps.googleusercontent.com`.

Authorized JavaScript origins now include `https://simpl-seo.com`, alongside the existing Vercel and development origins. Registered callback URLs include:

- `https://simpl-seo.com/gsc-callback`
- `https://simplseo-io.vercel.app/gsc-callback`
- `http://localhost:3000/gsc-callback`
- The existing Firebase handler and previously registered return addresses

The active flow is `/api/gsc/connect` → Google → `/gsc-callback` → `/api/gsc/exchange-code`. The former setup guide's `/api/auth/google/callback` is not the current return path.

Leave `GOOGLE_REDIRECT_URI` unset while both website origins remain supported. The server saves the initiating origin's callback with the expiring OAuth state and reuses it during token exchange. The popup must return to its opener's origin. Do not weaken the origin, source-window, or state checks in `reconnectGsc.js`.

The existing read-only scope is `https://www.googleapis.com/auth/webmasters.readonly`. Saved refresh tokens and customer website properties remain with the same Google client.

Google Auth Platform → Branding now includes `simpl-seo.com` as an authorized domain, `https://simpl-seo.com/home` as the homepage, and `https://simpl-seo.com/privacy` as the privacy policy. Branding verification is separate from registering a working callback. Its pre-existing unverified status and OAuth audience were not changed.

## Production URL configuration

| Variable | Production value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://simpl-seo.com` |
| `NEXT_PUBLIC_BASE_URL` | `https://simpl-seo.com` |
| `NOTIFICATION_PUBLIC_ORIGIN` | `https://simpl-seo.com` |

The first two variables now have separate Production entries; Preview and Development values were retained. Rebuild production after changing them because `NEXT_PUBLIC_*` values are embedded at build time.

The notification origin controls invitation, notification, preference, and unsubscribe links. The old Vercel domain remains available so existing emails, Google callbacks, and the existing Resend webhook continue working.

## DNS

Configured on October 31, 2026 using this project's Vercel recommendations:

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| A | `@` | `216.198.79.1` | DNS only |
| A | `@` | `64.29.17.1` | DNS only |
| CNAME | `www` | `02cae934c83cce8f.vercel-dns-017.com` | DNS only |

Vercel redirects `www` to the apex with HTTP 308. Use fresh project recommendations for future DNS changes; these targets are not universal. Registration and Cloudflare nameservers were retained.

Email records `send`, `rsend`, `resend._domainkey`, and `_dmarc`, plus `_domainconnect`, were preserved. No records were deleted. The replaced parking records were apex A values `15.197.148.33` and `3.33.130.190`, and `www` CNAME `simpl-seo.com`, all previously proxied.

## Sharing and rollback

The homepage now has a server redirect from `/` to `/home`, meaningful default metadata, and canonical/Open Graph metadata based on the production URL. Application source: `3b671c185c82e3403bfc21d2e1460db804e173e4` on `codex/custom-domain`.

Pre-migration deployment: `dpl_HcFXhJy4AHTweJoEYHMMKWLHft3W`, source `304a33dcb42fc6a68f9cc399a29f122d06a9877d`. Application rollback can reuse it while retaining the additive Google/Firebase entries. To restore generated links, set the three Production URL variables to `https://simplseo-io.vercel.app` and rebuild. Restoring parked DNS would intentionally disconnect the custom website address.

Check the apex HTTPS response, `www` redirect, homepage metadata, privacy page, Firebase authorization, and Search Console connection initiated on the new origin. Verify email link configuration without sending unsolicited test emails.

## Verified release — October 31, 2026

Production deployment `dpl_35Gh7DcnVTriQQ1QrMwihH4k58Ce` reached READY and serves both custom domains and the existing Vercel alias. The production build and scoped lint passed.

- HTTPS and the `www` redirect passed, including path and query preservation.
- `/` returns an HTTP 307 to `/home`; a LinkedIn crawler request receives the new canonical URL, title, description, and Open Graph URL.
- The homepage, sign-in, privacy, access-request, and Google callback pages return HTTP 200.
- Firebase's public project configuration confirms the new authorized domain. Browser Google sign-in succeeded and reached the existing early-access gate for the selected account; access approvals were not changed.
- An in-memory session for the existing `bryandevelops.com` demo account successfully read its Google Search Console properties through the new origin. A connection-start request produced `https://simpl-seo.com/gsc-callback` with the existing read-only scope. Its temporary OAuth state was removed after verification. The saved refresh grant and selected property were preserved; no new Google consent grant was completed.
- Anonymous private API requests return HTTP 401. An empty same-origin access request returns HTTP 400; a foreign-origin request returns HTTP 403. Neither created an access request or sent email.
- The old Google callback remains HTTP 200. No new deployment error/fatal logs were found during verification.

No unsolicited test emails, Google credential rotations, customer data migrations, or OAuth audience changes were performed.

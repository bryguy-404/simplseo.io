# SimplSEO Analytics

Configured November 25, 2026 for the early-access launch.

## Property and deployment

- GA4 account: existing SimplAssist account (`415419405`); separate **SimplSEO** property (`565678359`). Other properties are unchanged.
- Property timezone: Indianapolis; reporting currency USD. No monetary value is assigned to leads.
- Web stream: **SimplSEO website**, `https://simpl-seo.com`, stream ID `16410644008`.
- Public measurement ID: `G-VQ95C4K8F8`.
- Vercel project `simplseo-io`: `NEXT_PUBLIC_GA_MEASUREMENT_ID` is scoped to **Production** only. The server includes it only for `VERCEL_ENV=production`; the browser also requires the exact production hostname.
- Google enhanced measurement is **off**. Do not enable it without reviewing privacy and duplicate page-view behavior: the app sends sanitized manual page views.
- `generate_lead` is registered as a **key event**, once per event, with no default monetary value.
- Google created an upgraded Tag Manager container, `GTM-58WVKW5R`, alongside the stream. **Version 2 is live**: all automatic event detection and user-provided data capabilities are off. The Analytics destination explicitly sets `send_page_view`, `allow_google_signals`, and `allow_ad_personalization_signals` to false. “Ignore duplicate instances of on-page configuration” is off so the app's sanitized context, cookie lifetime, and campaign settings apply. Keep these settings when publishing future container versions.

## Measurements

| Event | Actual trigger | Read it as |
| --- | --- | --- |
| `page_view` | Consented visit or route change to an explicitly allowed app/marketing route | Entry pages, traffic, returning browsers |
| `early_access_click` | Link or navigation button to Request access | Interest, not a completed request |
| `generate_lead` | Access-request API returns `success: true` | Successfully acknowledged request submission |
| `sign_up` | Explicit invitation acceptance succeeds | New access granted, not a sign-in |
| `tutorial_complete` | New onboarding saves complete with Google connected | Website setup completed |
| `published_improvement` | A publication confirmation is saved and verified in the UI | User reports publishing an edit; not automatic publishing or proof of SEO improvement |

Use Traffic acquisition and Landing page reports to compare sources and entry pages with `generate_lead`. Use event user counts and funnel exploration for requests → invitation acceptance → setup → first observed `published_improvement`. Retention/repeat visits measure whether consented browsers return; repeated publication events can show continued useful activity.

Important interpretation limits:

- Analytics starts at installation and only after opt-in; it cannot reconstruct earlier actions. Events before consent are not buffered or replayed.
- GA browser cookies are not account identity. Different browsers/devices, blocking tools, and declined consent affect counts. No Firebase UID or email is sent.
- Access-request responses deliberately conceal whether an email already exists. The client suppresses repeat request events from the same browser for 24 hours; GA is a marketing estimate, while the admin request queue remains authoritative.
- `published_improvement` records each newly saved confirmation, skipping server `alreadyConfirmed` responses. A funnel's first observed occurrence is not necessarily that account's first-ever website edit.
- The setup event covers the current onboarding workspace. Old legacy onboarding is unchanged.
- No purchase/revenue event is sent during free early access.

## Privacy and consent

`components/Analytics.jsx` asks permission with equally available Allow analytics and No thanks buttons. Choices expire after 180 days and can be changed in the marketing footer or privacy page. Global Privacy Control prevents collection. Analytics is not required to use the product.

Before opt-in there is no Google Analytics script or collection request. Withdrawal disables the GA property, updates consent to denied, and deletes only `_ga` cookies. Advertising storage, ad user data, ad personalization, and Google signals are disabled.

`app/lib/analytics.js` allows fixed route names and fixed event names only. It never accepts arbitrary event properties. It strips all query strings/fragments and uses fixed page titles; referrers are reduced to origins. Admin, callback, unknown, and dynamic record routes are excluded. No form answers, invitation tokens, connected customer page URLs, Search Console queries/metrics, or private SEO content are included in event payloads.

Campaign attribution accepts only these predefined, non-personal values:

- `utm_source`: `outreach`, `email`, `instagram`, `facebook`, `pinterest`, `linkedin`, `youtube`, `google`, `bing`, `chatgpt`, `perplexity`.
- `utm_medium`: `email`, `social`, `organic`, `referral`, `cpc`.
- `utm_campaign`: `photographers`, `wedding_photographers`, `portrait_photographers`, `early_access`.

Example outreach link: `https://simpl-seo.com/seo-for-photographers?utm_source=outreach&utm_medium=email&utm_campaign=photographers`. Never put recipient names, emails, or customer IDs in campaign links. Other campaign values need an explicit allowlist update; `utm_content` and `utm_term` are not collected.

## Verification

Story: visitor opts in → visits the photographer page → clicks Request access → successfully saves a request → Analytics records the corresponding non-personal events. Product activation events are emitted only after existing successful API/storage boundaries.

- 88 targeted tests passed across Analytics, early access, onboarding workspace, and publication confirmations. The test suite makes no external production requests.
- Targeted JS/JSX lint passed with existing image warnings; production build passed with existing unrelated warnings.
- Browser checks: decline → request form works; privacy page reopens the choice; opt-in on localhost loads no GA script; mobile banner fits a 390px viewport; no browser console errors in the local check.
- Live GA Realtime confirmed the photographer page, request page, and `early_access_click`. The first smoke test exposed an extra automatic page view from Google's upgraded container. Container version 2 disables that automatic view; app defaults are also set before tag initialization. The initial QA view remains in November 25 reports.
- Live consent checks confirmed no GA script before opt-in and no GA script after withdrawal and reload. Production lead requests, invitations, and published changes were not fabricated for Analytics QA; their success/failure boundaries are covered by the targeted tests.

## Official references

- [Manual page views and disabling automatic history views](https://developers.google.com/analytics/devguides/collection/ga4/views)
- [GA4 configuration: page context, campaign values, advertising controls](https://developers.google.com/analytics/devguides/collection/ga4/reference/config)
- [Consent mode implementation](https://developers.google.com/tag-platform/security/guides/consent)
- [Google Analytics event reference](https://developers.google.com/analytics/devguides/collection/ga4/reference/events)

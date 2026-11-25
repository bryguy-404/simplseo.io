# Approved website changes

Saved November 25, 2026. **Deferred at Bryan's request.** Tentative revisit: Sunday, November 29, 2026. This is a planning note, not a scheduled reminder or automatic implementation instruction.

## Agreed direction

Explore letting customers approve a proposed improvement and have SimplSEO apply it to their website. Bryan agreed with starting on one platform with a small set of supported edits, then expanding based on customer needs. The first platform and exact edit types are still undecided. WordPress is a technical candidate, not a selected integration.

The current priority is [SimplSEO's national photographer SEO page](PHOTOGRAPHER_SEO_PLAN.md). Resume that work independently of this feature. Existing SimplSEO recommendations and drafts still require the owner to make and publish website changes.

The intended future journey is: connect a supported website, review a specific before-and-after preview, approve, apply the change, verify the live result, and retain an undo option. Existing search observations and saved work must remain intact. Do not treat an approval or an API success response alone as proof that the intended change is live.

## What we learned from Hike

Hike says some owners preferred having SEO handled for them. Its Kit offering combines planning, approved implementation, reporting, and human support. That is its published positioning, not independent evidence of retention, profitability, or equivalent capabilities to SimplSEO. [Hike's history](https://www.hikeseo.co/about), [Kit's workflow](https://www.hikeseo.co/kit).

Its documented On-Site Optimizer uses a JavaScript snippet installed on the customer's website. It applies supported edits such as titles, descriptions, headings, text, image alternative text, and links. Hike claims compatibility with WordPress, Wix, Squarespace, and custom sites that permit the script. This is not proof of native access to every builder's saved content or support for every SEO task. Changes delivered through this method depend on the snippet remaining installed. [Optimizer introduction](https://www.hikeseo.co/post/onsite-optimizer-introduction), [implementation explanation](https://www.hikeseo.co/post/onsite-optimizer-a-revolution-in-seo-for-small-business).

Keep two approaches distinct:

- **Script applied when pages load:** can cover multiple builders with one installation, but relies on the script, stable page elements, and rendering behavior. Do not present this as saving every change into the builder itself.
- **Direct publishing integration:** saves supported changes through the site's API or a plugin. It needs platform-specific handling, permissions, and verification of exactly which fields can be changed.

Google can process JavaScript, but its documentation notes that not all bots execute it. Search and AI visibility claims therefore need actual rendering/indexing checks rather than reliance on a vendor's compatibility statement. [Google's JavaScript guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

## Platform evidence as of November 25

| Platform | Feasible path and limits |
| --- | --- |
| WordPress | Its REST API updates saved pages with authorized access. A plugin or connector could provide approved edits; SEO plugin fields and page-builder structures need their own handling. [Pages API](https://developer.wordpress.org/rest-api/reference/pages/), [authentication](https://developer.wordpress.org/rest-api/using-the-rest-api/authentication/). |
| Wix | Official SEO APIs read/write supported tags, with page-type and publishing distinctions. Custom code is another path. Verify the intended editor/site type, fields, permissions, and how live publication works. [SEO APIs](https://dev.wix.com/docs/api-reference/business-management/seo/introduction), [custom code](https://dev.wix.com/docs/overview/site-features-tools/about-custom-code). |
| Squarespace | Code injection is available on eligible plans. Public API documentation reviewed focuses on commerce; a general API for editing ordinary pages was not verified. [Code injection](https://support.squarespace.com/hc/en-us/articles/205815908-Customize-parts-of-your-site-with-code-injection), [API overview](https://developers.squarespace.com/commerce-apis/overview). |
| Custom website | A script is possible where installation is allowed. Direct publishing depends on that site's CMS, source repository, or deployment process; there is no single standard connector for all custom sites. |

These documented approaches generally do not require negotiating a partnership with each builder, but customer authorization and platform rules still apply. App marketplace distribution may require review. Wix also documents unlisted app installation links. [Wix distribution](https://dev.wix.com/docs/build-apps/launch-your-app/app-distribution/about-app-distribution).

## Resume here

1. Choose the initial platform using the first photographers' actual websites and their difficulty publishing recommendations. Confirm whether the first version will use a script or save changes directly.
2. Identify the smallest useful set of editable fields and verify current documentation, access requirements, and any plan restrictions. Do not promise complete platform support from one working field.
3. When implementation resumes, prove one approved edit on an authorized test site: capture the original, preview the exact change, apply it, inspect the live result, and undo it. Include a case where the owner changed the same content after the preview so newer work is preserved.
4. Expand only after the first flow is reliable. Check site/account isolation, failure recovery, performance and layout, and what crawlers can actually see. Keep human-assisted installation and ongoing support effort visible when judging usability and cost.

No integration code, test-site provisioning, installation, or deployment was performed during this discussion. No platform connection or automatic publication was enabled.

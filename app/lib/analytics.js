// Only explicit, non-personal values cross the Analytics boundary.
export const ANALYTICS_CHOICE_KEY = 'simplseo.analytics-choice.v1';
export const ANALYTICS_CHOICES_EVENT = 'simplseo-analytics-choices';
const ORIGIN = 'https://simpl-seo.com';
const HOSTS = new Set(['simpl-seo.com', 'www.simpl-seo.com']);
const PAGES = {
  '/home': 'Home', '/seo-for-photographers': 'SEO for photographers',
  '/request-access': 'Request early access', '/accept-invite': 'Accept invitation',
  '/privacy': 'Privacy policy', '/auth': 'Sign in', '/onboarding': 'Website setup',
  '/dashboard': 'Dashboard', '/settings': 'Settings', '/seo-mentor': 'SEO Mentor',
  '/chatbot': 'SEO Mentor', '/notifications': 'Notifications', '/contact': 'Contact',
  '/easy-wins': 'Easy wins', '/low-ctr': 'Low CTR', '/top-keywords': 'Top keywords',
  '/intent-mismatch': 'Intent mismatch', '/generic-keywords-ranking': 'Keyword opportunities',
  '/generic-keywords': 'New page ideas', '/revamp': 'Website setup', '/revamp/history': 'Previous website work',
};
const CAMPAIGNS = {
  utm_source: ['outreach', 'email', 'instagram', 'facebook', 'pinterest', 'linkedin', 'youtube', 'google', 'bing', 'chatgpt', 'perplexity'],
  utm_medium: ['email', 'social', 'organic', 'referral', 'cpc'],
  utm_campaign: ['photographers', 'wedding_photographers', 'portrait_photographers', 'early_access'],
};
const EVENTS = new Set(['early_access_click', 'generate_lead', 'sign_up', 'tutorial_complete', 'published_improvement']);
const SIX_MONTHS = 180 * 24 * 60 * 60 * 1000;
const DENIED = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };

export function analyticsPage(pathname) {
  return Object.hasOwn(PAGES, pathname) ? { page_location: ORIGIN + pathname, page_title: `${PAGES[pathname]} | SimplSEO` } : null;
}

export function analyticsReferrer(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? `${url.origin}/` : '';
  } catch { return ''; }
}

export function analyticsCampaign(search) {
  const query = new URLSearchParams(search);
  return Object.fromEntries(Object.entries(CAMPAIGNS).flatMap(([key, values]) => {
    const value = query.get(key);
    const parameter = key === 'utm_campaign' ? 'campaign_name' : key.replace('utm_', 'campaign_');
    return values.includes(value) ? [[parameter, value]] : [];
  }));
}

export function readAnalyticsChoice(storage, now = Date.now()) {
  try {
    const saved = JSON.parse(storage.getItem(ANALYTICS_CHOICE_KEY));
    return saved?.expiresAt > now && ['granted', 'denied'].includes(saved.choice) ? saved.choice : null;
  } catch { return null; }
}

// Injectable browser objects keep privacy and failure behavior testable without
// making real Analytics requests or depending on an authenticated account.
export function createAnalyticsClient({ window: win, document: doc, measurementId }) {
  const enabled = /^G-[A-Z0-9]+$/.test(measurementId || '') && HOSTS.has(win.location.hostname);
  let storage;
  try { storage = win.localStorage; } catch { /* Browsers may block storage access. */ }
  let choice = readAnalyticsChoice(storage);
  let initialized = false;
  let currentPath = '';
  let lastPage = '';
  let previousPage = '';
  const referrer = analyticsReferrer(doc.referrer);
  let currentReferrer = referrer;
  const campaign = analyticsCampaign(win.location.search);
  const send = (...args) => { try { win.gtag?.(...args); } catch { /* Analytics never blocks the product. */ } };
  const allowed = () => enabled && choice === 'granted' && !win.navigator?.globalPrivacyControl && Boolean(analyticsPage(currentPath));
  const disableKey = `ga-disable-${measurementId}`;

  function context() {
    return { ...analyticsPage(currentPath), page_referrer: currentReferrer };
  }

  function start() {
    if (!allowed()) return false;
    win[disableKey] = false;
    if (initialized) return true;
    win.dataLayer = win.dataLayer || [];
    win.gtag = function () { win.dataLayer.push(arguments); };
    send('consent', 'default', { ...DENIED, analytics_storage: 'granted' });
    const settings = {
      send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false,
      cookie_expires: SIX_MONTHS / 1000, cookie_update: false,
      ...context(), ...campaign,
    };
    // Google's remotely configured tag can initialize a destination on gtm.js
    // before our stream config. Defaults must protect that first event too.
    send('set', settings);
    send('js', new Date());
    send('config', measurementId, settings);
    const script = doc.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
    script.referrerPolicy = 'origin';
    script.id = 'simplseo-google-analytics';
    doc.head.appendChild(script);
    initialized = true;
    return true;
  }

  function page(pathname) {
    if (pathname !== currentPath) currentReferrer = previousPage || referrer;
    currentPath = pathname;
    win[disableKey] = !allowed();
    if (!start()) return false;
    // Set the context for automatic engagement events too; never use document.title
    // or the raw browser URL, which may contain private account data.
    send('set', context());
    if (lastPage === pathname) return false;
    send('event', 'page_view', { ...context(), send_to: measurementId });
    previousPage = analyticsPage(pathname).page_location;
    lastPage = pathname;
    return true;
  }

  function event(name) {
    if (!EVENTS.has(name) || !start()) return false;
    // Uniform access-request responses intentionally do not reveal whether an
    // email already exists. Suppress repeat submissions from this browser for a day.
    if (name === 'generate_lead') {
      const key = 'simplseo.analytics-last-request';
      try {
        if (Date.now() - Number(storage.getItem(key) || 0) < 86400000) return false;
        storage.setItem(key, String(Date.now()));
      } catch { /* Storage can be unavailable; the application still works. */ }
    }
    send('event', name, { ...context(), send_to: measurementId });
    return true;
  }

  function choose(next, persist = true) {
    if (!['granted', 'denied'].includes(next)) return;
    choice = next;
    if (persist) try { storage.setItem(ANALYTICS_CHOICE_KEY, JSON.stringify({ choice, expiresAt: Date.now() + SIX_MONTHS })); } catch { /* Session-only choice. */ }
    win[disableKey] = !allowed();
    if (initialized) send('consent', 'update', { ...DENIED, analytics_storage: allowed() ? 'granted' : 'denied' });
    if (choice === 'denied') {
      // Delete only GA cookies, including cookies set on the parent hostname.
      for (const cookie of doc.cookie.split(';')) {
        const name = cookie.trim().split('=')[0];
        if (!/^_ga(?:_|$)/.test(name)) continue;
        for (const domain of ['', win.location.hostname, '.simpl-seo.com']) {
          doc.cookie = `${name}=; Max-Age=0; Path=/;${domain ? ` Domain=${domain};` : ''} SameSite=Lax; Secure`;
        }
      }
      lastPage = '';
    } else page(currentPath);
  }

  return { enabled, page, event, choose, choice: () => choice };
}

let client;
export function initializeAnalytics(measurementId, pathname) {
  try {
    if (!client) client = createAnalyticsClient({ window, document, measurementId });
    client.page(pathname);
    return client;
  } catch { return null; }
}
export function trackAnalyticsEvent(name) {
  try { return client?.event(name) || false; } catch { return false; }
}
export function openAnalyticsChoices() {
  window.dispatchEvent(new Event(ANALYTICS_CHOICES_EVENT));
}

export function trackAccessRequest(result) {
  if (result?.success === true) trackAnalyticsEvent('generate_lead');
}
export function trackInvitationAccepted(result) {
  if (result?.success === true) trackAnalyticsEvent('sign_up');
}
export function trackSetupComplete(result, wasExisting) {
  if (!wasExisting && result?.session?.state === 'complete' && result.session.google?.status === 'connected') trackAnalyticsEvent('tutorial_complete');
}
export function trackPublishedImprovement(alreadyConfirmed = false) {
  if (!alreadyConfirmed) trackAnalyticsEvent('published_improvement');
}

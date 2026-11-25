import { describe, expect, it, vi } from 'vitest';
import { ANALYTICS_CHOICE_KEY, analyticsCampaign, analyticsPage, analyticsPromptPage, createAnalyticsClient, readAnalyticsChoice } from '../app/lib/analytics';

function browser(hostname = 'simpl-seo.com') {
  const values = new Map();
  const scripts = [];
  const window = {
    location: { hostname, search: '?email=private@example.test&utm_source=outreach&utm_medium=email&utm_campaign=photographers', hash: '#token=private' },
    navigator: {},
    localStorage: { getItem: key => values.get(key) ?? null, setItem: vi.fn((key, value) => values.set(key, value)) },
  };
  const document = { referrer: 'https://www.google.com/search?q=private', title: 'Private customer site', cookie: '_ga=old; app-session=keep',
    createElement: () => ({}), head: { appendChild: script => scripts.push(script) } };
  const client = createAnalyticsClient({ window, document, measurementId: 'G-TEST123' });
  const calls = () => (window.dataLayer || []).map(value => Array.from(value));
  const events = () => calls().filter(call => call[0] === 'event');
  return { window, document, client, values, scripts, calls, events };
}

describe('consent-gated GA4 collection', () => {
  it('makes no Analytics load or event before permission, including after declining', () => {
    const b = browser();
    b.client.page('/home'); b.client.event('generate_lead'); b.client.choose('denied');
    expect(b.scripts).toEqual([]); expect(b.calls()).toEqual([]);
    expect(readAnalyticsChoice(b.window.localStorage)).toBe('denied');
  });

  it.each(['localhost', '127.0.0.1', 'simplseo-preview.vercel.app', 'simpl-seo.com.evil.test'])('does not load on %s', host => {
    const b = browser(host); b.client.page('/home'); b.client.choose('granted');
    expect(b.scripts).toEqual([]); expect(b.events()).toEqual([]);
  });

  it('offers the choice card on public pages only, never inside the workspace', () => {
    for (const path of ['/home', '/seo-for-photographers', '/request-access', '/accept-invite', '/privacy', '/auth']) expect(analyticsPromptPage(path)).toBe(true);
    for (const path of ['/dashboard', '/settings', '/chatbot', '/low-ctr', '/generic-keywords', '/onboarding', '/contact', '/unknown', '']) expect(analyticsPromptPage(path)).toBe(false);
  });

  it('respects Global Privacy Control', () => {
    const b = browser(); b.window.navigator.globalPrivacyControl = true;
    b.client.page('/home'); b.client.choose('granted'); expect(b.scripts).toEqual([]);
  });

  it('loads one tag and one view per route, without raw URL, title, or referrer data', () => {
    const b = browser(); b.client.page('/seo-for-photographers'); b.client.choose('granted');
    b.client.page('/seo-for-photographers'); b.client.event('early_access_click'); b.client.page('/request-access');
    expect(b.scripts).toHaveLength(1);
    expect(b.events().map(call => call[1])).toEqual(['page_view', 'early_access_click', 'page_view']);
    expect(b.events()[0][2].page_referrer).toBe('https://www.google.com/');
    expect(b.events()[1][2].page_referrer).toBe('https://www.google.com/');
    expect(b.events()[2][2].page_referrer).toBe('https://simpl-seo.com/seo-for-photographers');
    expect(JSON.stringify(b.calls())).not.toMatch(/private|customer|email=/i);
    const config = b.calls().find(call => call[0] === 'config')[2];
    expect(config).toMatchObject({ send_page_view: false, allow_google_signals: false, allow_ad_personalization_signals: false, campaign_source: 'outreach', campaign_medium: 'email', campaign_name: 'photographers' });
    const commands = b.calls();
    const defaults = commands.findIndex(call => call[0] === 'set' && call[1].send_page_view === false);
    expect(defaults).toBeLessThan(commands.findIndex(call => call[0] === 'js'));
    expect(commands[defaults][1]).toEqual(config);
  });

  it('blocks unknown routes and arbitrary event names and never takes caller-supplied parameters', () => {
    const b = browser(); b.client.page('/home'); b.client.choose('granted');
    b.client.event('private_user_email'); b.client.event('sign_up', { email: 'private@example.test' });
    b.client.page('/gsc-callback'); b.client.event('sign_up');
    expect(b.window['ga-disable-G-TEST123']).toBe(true);
    expect(b.events().map(call => call[1])).toEqual(['page_view', 'sign_up']);
    expect(JSON.stringify(b.calls())).not.toContain('private');
    expect(analyticsPage('/dashboard/private-id')).toBe(null);
  });

  it('rejects arbitrary campaign values and expired choices', () => {
    expect(analyticsCampaign('?utm_source=person@example.com&utm_campaign=private&utm_content=secret')).toEqual({});
    const b = browser(); b.values.set(ANALYTICS_CHOICE_KEY, JSON.stringify({ choice: 'granted', expiresAt: 1 }));
    expect(readAnalyticsChoice(b.window.localStorage)).toBe(null);
  });

  it('stops after withdrawal and clears only Analytics cookies', () => {
    const b = browser(); const writes = [];
    Object.defineProperty(b.document, 'cookie', { get: () => '_ga=old; _ga_TEST123=old; app-session=keep', set: value => writes.push(value) });
    b.client.page('/home'); b.client.choose('granted'); b.client.choose('denied'); b.client.event('sign_up');
    expect(b.events()).toHaveLength(1); expect(b.window['ga-disable-G-TEST123']).toBe(true);
    expect(writes.length).toBeGreaterThan(0); expect(writes.every(value => value.startsWith('_ga'))).toBe(true);
  });

  it('does not create a storage-event feedback loop across tabs', () => {
    const b = browser(); b.client.page('/home'); b.client.choose('denied', false);
    expect(b.window.localStorage.setItem).not.toHaveBeenCalled();
  });

  it('works with storage disabled and ignores repeated accepted requests for 24 hours', () => {
    const b = browser(); b.client.page('/request-access'); b.client.choose('granted');
    b.client.event('generate_lead'); b.client.event('generate_lead');
    expect(b.events().filter(call => call[1] === 'generate_lead')).toHaveLength(1);
    Object.defineProperty(b.window, 'localStorage', { get() { throw new Error('Storage blocked'); } });
    const client = createAnalyticsClient({ window: b.window, document: b.document, measurementId: 'G-TEST123' });
    expect(() => { client.page('/home'); client.choose('granted'); client.event('sign_up'); }).not.toThrow();
  });

  it('records only verified milestones and skips existing setup and idempotent publication responses', async () => {
    vi.resetModules();
    const analytics = await import('../app/lib/analytics');
    const b = browser(); vi.stubGlobal('window', b.window); vi.stubGlobal('document', b.document);
    analytics.initializeAnalytics('G-TEST123', '/dashboard').choose('granted');
    analytics.trackAccessRequest({ success: false }); analytics.trackInvitationAccepted({ error: 'failed' });
    analytics.trackSetupComplete({ session: { state: 'draft' } }, false);
    analytics.trackSetupComplete({ session: { state: 'complete', google: { status: 'connected' } } }, true);
    analytics.trackPublishedImprovement(true);
    expect(b.events()).toHaveLength(1);
    analytics.trackAccessRequest({ success: true, email: 'private@example.test' });
    analytics.trackInvitationAccepted({ success: true });
    analytics.trackSetupComplete({ session: { state: 'complete', google: { status: 'connected' } } }, false);
    analytics.trackPublishedImprovement(false);
    expect(b.events().map(call => call[1])).toEqual(['page_view', 'generate_lead', 'sign_up', 'tutorial_complete', 'published_improvement']);
    expect(JSON.stringify(b.calls())).not.toContain('private');
    b.window.gtag = () => { throw new Error('Blocked'); };
    expect(() => analytics.trackPublishedImprovement(false)).not.toThrow();
  });
});

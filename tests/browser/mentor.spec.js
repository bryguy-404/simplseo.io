const { test, expect } = require('@playwright/test');
const admin = require('firebase-admin');
const uid = 'mentor-ui-alice';
const websiteUrl = 'https://example.test/';
const now = '2026-10-11T12:00:00.000Z';
let app;

test.beforeAll(async () => {
  Object.assign(process.env, { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' });
  app = admin.initializeApp({ projectId: 'demo-simpleseo' }, 'mentor-ui-tests');
  for (const id of [uid, 'mentor-ui-bob']) {
    try { await app.auth().createUser({ uid: id, email: `${id}@example.test`, password: 'Test-only-pass123!' }); }
    catch (error) { if (!['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) throw error; }
    await app.firestore().doc(`users/${id}`).set({ gscSiteUrl: websiteUrl });
    await app.firestore().doc(`onboarding/${id}`).set({ name: 'Mentor fixture', websiteUrl, gscProperty: websiteUrl,
      isComplete: true, postOnboardingStep: 'complete', revampStatus: 'complete', revampRunId: 'mentor-ui-run' });
  }
});
test.afterAll(async () => app?.delete());

async function setup(page, config = {}) {
  const conversation = { id: 'conversation-1', title: 'Homepage questions', revision: 1, readOnly: false, createdAt: now };
  const legacy = { id: 'legacy-1', title: 'Old SEO conversation', revision: 1, readOnly: true, legacy: true };
  const state = { conversations: [conversation, legacy], activeConversationId: conversation.id, messages: new Map([[conversation.id, []], [legacy.id, [{ id: 'old-1', role: 'assistant', content: 'Historical website wording.', image: 'https://example.test/old.png' }]]]), calls: [], errors: [], sends: 0, status: 'completed', ...config };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('hasSeenChatAssistant', 'true');
    localStorage.setItem('chatbotMessages-v1', JSON.stringify([{ content: 'Other account private content' }]));
  });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort();
    if (url.port !== '3100' || !url.pathname.startsWith('/api/')) return route.continue();
    const json = value => route.fulfill({ json: value });
    if (url.pathname === '/api/mentor') {
      const body = route.request().method() === 'POST' ? route.request().postDataJSON() : Object.fromEntries(url.searchParams);
      state.calls.push(body);
      const row = state.conversations.find(item => item.id === body.conversationId);
      switch (body.action) {
        case 'workspace': return json({ success: true, enabled: true, generationEnabled: state.enabled !== false, researchEnabled: true,
          scope: { key: 'mentor-ui-scope', websiteUrl, property: websiteUrl, websiteRunId: 'mentor-ui-run' }, homepageUrl: websiteUrl,
          pageOptions: [{ pageUrl: `${websiteUrl}services/plumbing`, label: 'Plumbing services' }], activeConversationId: state.activeConversationId, conversations: state.conversations.filter(row => !body.search || row.title.toLowerCase().includes(body.search.toLowerCase())) });
        case 'conversation': return json({ conversation: row, messages: state.messages.get(row.id) || [], nextCursor: null });
        case 'create': {
          const created = { id: `conversation-${state.conversations.length + 1}`, title: 'New conversation', revision: 1 };
          state.conversations.unshift(created); state.activeConversationId = created.id; state.messages.set(created.id, []);
          return json({ conversation: created, messages: [] });
        }
        case 'activate': {
          if (row.legacy) {
            const created = { id: 'legacy-continuation', title: 'Current SEO conversation', revision: 1 };
            state.conversations.unshift(created); state.activeConversationId = created.id; state.messages.set(created.id, []);
            return json({ conversation: created, messages: [] });
          }
          state.activeConversationId = row.id; return json({ conversation: row });
        }
        case 'send': {
          state.sends += 1;
          if (state.pause) await state.pause;
          const user = { id: `${body.turnId}-user`, turnId: body.turnId, role: 'user', content: body.message, createdAt: now };
          const assistant = { id: `${body.turnId}-assistant`, turnId: body.turnId, role: 'assistant', createdAt: now,
            content: '**Your homepage has 6 clicks.**\n\nThese are saved observations, not a fixed Google ranking.\n\n1. Keep the completed tasks.\n2. Review the next dated comparison.',
            sources: [{ id: 'g1', title: 'Google position guidance', url: 'https://support.google.com/webmasters/answer/7042828', retrievedAt: now }],
            metricCards: [{ id: 'home-metrics', title: 'Homepage', clicks: 6, impressions: 142, position: 12.4, status: state.metricStatus || 'available', window: { startDate: '2026-09-10', endDate: '2026-10-07' }, observedAt: now }],
            actions: [{ label: 'See your page progress', href: '/dashboard#page-progress' }] };
          row.revision += 2;
          const messages = state.status === 'completed' ? [user, assistant] : [user];
          state.messages.set(row.id, [...state.messages.get(row.id), ...messages]);
          state.lastTurn = { id: body.turnId, status: state.status, selection: body.selection, ...(state.status === 'failed' ? { error: 'Provider temporarily unavailable.' } : {}) };
          return json({ conversation: row, turn: state.lastTurn, messages });
        }
        case 'turn': return json({ turn: state.lastTurn || { status: 'unknown' }, conversation: row });
        case 'check': if (state.checkResult) return json({ check: state.checkResult }); return json({ message: body.kind === 'activity' ? 'Latest search data checked. The previous task plan is unchanged.' : 'Public page check saved. Publication dates are unchanged.' });
        case 'rename': row.title = body.title; row.revision += 1; return json({ conversation: row });
        case 'delete': state.conversations = state.conversations.filter(item => item.id !== row.id); if (state.activeConversationId === row.id) state.activeConversationId = null; return json({ success: true });
        default: return route.fulfill({ status: 400, json: { error: 'Unexpected mentor action' } });
      }
    }
    return json({ success: true, records: [], history: [], pages: [], conversations: [], data: [], profile: null, generationEnabled: false });
  });
  await page.goto('/auth');
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 15000 });
  await page.goto('/chatbot');
  await expect(page.getByRole('region', { name: 'SEO Mentor workspace' })).toBeVisible({ timeout: 30000 });
  if (state.enabled !== false) await expect(page.getByRole('textbox', { name: 'Ask your SEO question' })).toBeEnabled({ timeout: 30000 });
  return state;
}

async function ask(page, text = 'How is my homepage doing?') {
  await page.getByRole('textbox', { name: 'Ask your SEO question' }).fill(text);
  await page.getByRole('button', { name: 'Send question' }).click();
}

test('saved reads cause no generation; reply renders safe sources, dated metrics and navigation', async ({ page }) => {
  const state = await setup(page);
  expect(state.calls.every(call => ['workspace', 'conversation'].includes(call.action))).toBe(true);
  await expect(page.getByText('Other account private content')).toHaveCount(0);
  await ask(page);
  await expect(page.getByRole('button', { name: 'Show full answer' })).toBeVisible();
  await page.getByRole('button', { name: 'Show full answer' }).click();
  await expect(page.getByText('Your homepage has 6 clicks.', { exact: true })).toBeVisible();
  await expect(page.getByText('2026-09-10 – 2026-10-07').first()).toBeVisible();
  await page.getByText('Sources and evidence (1)').click();
  await expect(page.getByRole('link', { name: 'Google position guidance' })).toHaveAttribute('href', 'https://support.google.com/webmasters/answer/7042828');
  await expect(page.getByRole('link', { name: 'See your page progress' })).toHaveAttribute('href', '/dashboard#page-progress');
  await expect(page.getByRole('button', { name: /Attach|Upload/i })).toHaveCount(0);
  expect(state.calls.find(call => call.action === 'send')).toMatchObject({ selection: { pageUrl: websiteUrl } });
  await page.reload();
  await expect(page.getByText('Your homepage has 6 clicks.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show full answer' })).toHaveCount(0);
  expect(state.sends).toBe(1); expect(state.errors).toEqual([]);
});

test('loading blocks duplicate sends; reduced motion shows complete answers', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await setup(page);
  state.pause = new Promise(resolve => { state.release = resolve; });
  await ask(page);
  await expect(page.getByText('Reading the relevant evidence…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send question' })).toBeDisabled();
  state.release();
  await expect(page.getByText('Your homepage has 6 clicks.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show full answer' })).toHaveCount(0);
  expect(state.sends).toBe(1); expect(state.errors).toEqual([]);
});

test('history supports rename, legacy viewing and deliberate current continuation', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Open conversation history' }).click();
  await page.getByRole('button', { name: 'Rename Homepage questions' }).click();
  await page.getByRole('textbox', { name: 'Conversation name' }).fill('My homepage progress');
  await page.getByRole('button', { name: 'Save name' }).click();
  await expect(page.getByRole('button', { name: 'My homepage progress', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search conversations' }).fill('Old');
  await page.getByRole('button', { name: /^Old SEO conversation/ }).click();
  await expect(page.getByText('Historical website wording.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask your SEO question' })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'View historical attachment' })).toHaveAttribute('href', 'https://example.test/old.png');
  await page.getByRole('button', { name: 'Continue in a current conversation' }).click();
  await expect(page.getByText('Historical website wording.')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Ask your SEO question' })).toBeEnabled();
  expect(state.sends).toBe(0); expect(state.errors).toEqual([]);
});

test('explicit page checks preserve plans and require a selected page', async ({ page }) => {
  const state = await setup(page);
  await page.getByText('Page context · Homepage', { exact: true }).click();
  await page.getByLabel('Page to discuss or check').selectOption(`${websiteUrl}services/plumbing`);
  await page.getByRole('button', { name: 'Check latest data' }).click();
  await expect(page.getByText('Latest search data checked. The previous task plan is unchanged.')).toBeVisible();
  await page.getByRole('button', { name: 'Check this page' }).click();
  await expect(page.getByText('Public page check saved. Publication dates are unchanged.')).toBeVisible();
  expect(state.calls.filter(call => call.action === 'check').map(call => [call.kind, call.selection.pageUrl])).toEqual([['activity', `${websiteUrl}services/plumbing`], ['page', `${websiteUrl}services/plumbing`]]);
  expect(state.sends).toBe(0); expect(state.errors).toEqual([]);
});

test('failed generation preserves question and requires explicit retry', async ({ page }) => {
  const state = await setup(page, { status: 'failed' });
  await ask(page);
  await expect(page.getByText('This reply did not finish. Your earlier conversation is saved.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry answer' })).toBeVisible();
  expect(state.sends).toBe(1);
  state.status = 'completed';
  await page.getByRole('button', { name: 'Retry answer' }).click();
  await expect(page.getByText('Reply saved.', { exact: true })).toBeVisible();
  expect(state.sends).toBe(2);
  const sends = state.calls.filter(call => call.action === 'send');
  expect(sends[1].retryOf).toBe(sends[0].turnId);
  expect(sends[1].turnId).not.toBe(sends[0].turnId);
});

test('mobile keyboard and history drawer keep composer usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await setup(page);
  await page.getByRole('textbox', { name: 'Ask your SEO question' }).fill('What does average position mean?');
  await page.getByRole('textbox', { name: 'Ask your SEO question' }).press('Enter');
  await expect(page.getByText('Reply saved.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open conversation history' }).click();
  await page.getByRole('button', { name: 'Back to conversation' }).click();
  await expect(page.getByRole('textbox', { name: 'Ask your SEO question' })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(overflow).toBe(false); expect(state.errors).toEqual([]);
  await page.screenshot({ path: '/private/tmp/simpleseo-phase9-mentor-mobile.png', fullPage: true });
});

test('paused generation leaves saved history usable without a legacy generation path', async ({ page }) => {
  const state = await setup(page, { enabled: false });
  await expect(page.getByText('New mentor replies are paused. Your saved conversations remain available.')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask your SEO question' })).toBeDisabled();
  await page.getByRole('button', { name: 'Open conversation history' }).click();
  await page.getByRole('button', { name: /^Old SEO conversation/ }).click();
  await expect(page.getByText('Historical website wording.')).toBeVisible();
  expect(state.sends).toBe(0);
});

test('failed saved turns restore after reload without another generation', async ({ page }) => {
  const state = await setup(page, { status: 'failed' });
  await ask(page);
  await expect(page.getByRole('button', { name: 'Retry answer' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Retry answer' })).toBeVisible();
  expect(state.sends).toBe(1);
  const checks = state.calls.filter(call => call.action === 'turn');
  expect(checks.length).toBeGreaterThan(0);
});

test('widget and full mentor share active conversation and pending draft', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await setup(page);
  await ask(page, 'Explain my saved homepage plan.');
  await expect(page.getByText('Reply saved.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Ask your SEO question' }).fill('My follow-up question');
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open SEO Mentor', exact: true }).click();
  await expect(page.getByText('Your homepage has 6 clicks.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask your SEO question' })).toHaveValue('My follow-up question');
  await page.getByRole('link', { name: 'Open full SEO Mentor' }).click();
  await expect(page).toHaveURL(/chatbot/);
  await expect(page.getByRole('textbox', { name: 'Ask your SEO question' })).toHaveValue('My follow-up question');
  expect(state.sends).toBe(1); expect(state.errors).toEqual([]);
});

test('logout clears local draft but server conversation returns after sign-in', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await setup(page);
  await ask(page);
  await expect(page.getByText('Reply saved.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Ask your SEO question' }).fill('Private unsent note');
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Log out', exact: true }).click();
  await expect(page).toHaveURL(/auth/);
  const localDrafts = await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('mentor-draft-v1:')));
  expect(localDrafts).toEqual([]);
  await page.locator('input[type=email]').fill(`${uid}@example.test`);
  await page.locator('input[type=password]').fill('Test-only-pass123!');
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page).toHaveURL(/dashboard/);
  await page.goto('/chatbot');
  await expect(page.getByText('Your homepage has 6 clicks.', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Ask your SEO question' })).toHaveValue('');
  expect(state.sends).toBe(1);
});

test('partial check keeps dated observations and shows the actual indexing limitation', async ({ page }) => {
  const state = await setup(page);
  state.checkResult = { kind: 'technical', pageUrl: websiteUrl, lastSuccessAt: now, lastAttemptAt: '2026-10-12T12:00:00.000Z',
    lastError: 'Some checks could not finish. Previous successful observations remain dated below.', cached: false,
    result: { website: { status: 'available', technical: { noindex: { googlebot: false, generic: false } } }, indexing: { status: 'available', indexStatusResult: { coverageState: 'Submitted and indexed', lastCrawlTime: now } } },
    failedObservation: { website: { status: 'available', technical: { noindex: { googlebot: true, generic: true } } }, indexing: { status: 'unavailable' } } };
  await page.getByText('Page context · Homepage', { exact: true }).click();
  await page.getByRole('button', { name: 'Check this page' }).click();
  await expect(page.getByText('Some observations could not be updated. Your saved information is preserved.')).toBeVisible();
  await expect(page.getByText('Submitted and indexed')).toBeVisible();
  await page.getByText('Details from the incomplete check').click();
  await expect(page.getByText('Indexing directive found')).toBeVisible();
  await expect(page.getByText('The indexing check was unavailable. This does not mean the page is not indexed.')).toBeVisible();
  expect(state.sends).toBe(0);
});

test('unavailable metrics do not display fabricated zeroes; history can be deleted separately', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const state = await setup(page, { metricStatus: 'unavailable' });
  await ask(page);
  await expect(page.getByText('Reply saved.', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Saved search evidence').getByText('Not available')).toHaveCount(3);
  await page.getByRole('button', { name: 'Open conversation history' }).click();
  await page.getByRole('button', { name: 'Delete Homepage questions' }).click();
  await page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Homepage questions', exact: true })).toHaveCount(0);
  expect(state.calls.filter(call => call.action === 'delete')).toHaveLength(1);
  expect(state.sends).toBe(1);
});

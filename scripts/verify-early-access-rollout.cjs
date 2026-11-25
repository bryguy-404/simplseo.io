// Real HTTP, Firebase Auth and Firestore emulator verification. Provider replies
// are isolated by tests/fixtures/rollout-providers.cjs in the local app process.
Object.assign(process.env, require('./emulator-env.cjs'));
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { createHash, createHmac, randomUUID, randomBytes } = require('node:crypto');
const origin = 'http://127.0.0.1:3100';
const password = 'Isolated-rollout-only-123!';
const signingSecret = 'isolated-rollout-signing-secret-123456789';
const hash = text => createHash('sha256').update(text).digest('hex');
let stage = 'start';
async function main() {
  const app = admin.initializeApp({ projectId: 'demo-simpleseo' });
  const db = app.firestore();
  async function identity(uid) {
    try { await app.auth().createUser({ uid, email: `${uid}@example.test`, emailVerified: true, password }); }
    catch (error) { if (error.code !== 'auth/uid-already-exists') throw error; }
    const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.test`, password, returnSecureToken: true }),
    });
    const value = await response.json(); assert(response.ok && value.idToken); return value.idToken;
  }
  async function call(path, token, body, expected = 200) {
    const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: {
      'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000) });
    const value = await response.json(); assert.equal(response.status, expected, `${stage}: ${path}: ${value.error || ''}`); return value;
  }
  try {
    stage = 'anonymous and uninvited boundaries';
    const outsider = await identity('rollout-outsider');
    for (const path of ['/api/dashboard/config', '/api/conversations', '/api/onboarding/workspace', '/api/notifications/preferences']) {
      await call(path, null, null, 401); await call(path, outsider, null, 403);
    }
    for (let index = 1; index <= 15; index++) {
      const uid = `rollout-photo-${index}`, token = await identity(uid), website = `https://studio-${index}.example.test/`;
      stage = `photographer ${index}: invitation`;
      const invitationId = randomBytes(24).toString('hex'), requestId = hash(`${uid}@example.test`);
      // Only mail delivery is represented by a fixture; acceptance is the real API.
      await db.doc(`accessRequests/${requestId}`).set({ email: `${uid}@example.test`, status: 'invited', invitationId });
      await db.doc(`earlyAccessInvitations/${invitationId}`).set({ requestId, status: 'pending', userId: null,
        expiresAt: new Date(Date.now() + 86400000).toISOString() });
      await db.doc(`earlyAccessMail/${invitationId}`).set({ kind: 'invitation', status: 'sent' });
      const inviteToken = `${invitationId}.${createHmac('sha256', signingSecret).update(`simplseo-early-access-v1:${invitationId}`).digest('base64url')}`;
      await call('/api/access/invitation', token, { action: 'accept', token: inviteToken });
      assert.equal((await call('/api/access/status', token)).nextPath, '/onboarding');
      let workspace = await call('/api/onboarding/workspace', token, { action: 'begin', requestId: randomUUID() });
      const profile = { businessName: `Studio ${index}`, businessType: 'Wedding and portrait photographer', services: ['Wedding photography', 'Family portraits'],
        baseLocation: { city: 'South Bend', region: 'Indiana', country: 'United States' }, serviceAreas: ['South Bend, Indiana'], goal: 'inquiries', cmsPlatform: 'Squarespace' };
      workspace = await call('/api/onboarding/workspace', token, { action: 'save', requestId: randomUUID(), expectedRevision: workspace.session.revision,
        websiteUrl: website, profileDraft: profile, privacyPolicyAccepted: true, currentStep: 'google' });
      stage = `photographer ${index}: staged Google connection`;
      const connection = await call(`/api/gsc/connect?sessionRevision=${workspace.session.revision}`, token);
      const pending = await call('/api/gsc/exchange-code', token, { code: 'isolated-provider-code', state: connection.state });
      await call('/api/gsc/select', token, { pendingId: pending.pendingId, property: website, sessionRevision: pending.session.revision });
      workspace = await call('/api/onboarding/workspace', token);
      workspace = await call('/api/onboarding/workspace', token, { action: 'confirmProfile', requestId: randomUUID(), expectedRevision: workspace.session.revision,
        profileDraft: profile, confirmed: true, currentStep: 'ready' });
      workspace = await call('/api/onboarding/workspace', token, { action: 'complete', requestId: randomUUID(), expectedRevision: workspace.session.revision });
      assert.equal(workspace.session.state, 'complete');
      stage = `photographer ${index}: complete workspace`;
      assert.equal((await call('/api/access/status', token)).nextPath, '/dashboard');
      assert.equal((await call('/api/dashboard/config', token)).enabled, true);
      const mentor = await call('/api/conversations', token);
      assert(mentor.enabled && mentor.generationEnabled && mentor.researchEnabled);
      const prefs = await call('/api/notifications/preferences', token); assert(prefs.enabled && !prefs.emailEnabled);
      const progress = await call('/api/progress', token); assert(progress.ongoing.enabled);
      await call('/api/dashboard/work', token);
      await call('/api/dashboard/config?userId=rollout-outsider', token, null, 403);
      // A fresh sign-in resumes saved completion without another invitation.
      assert.equal((await call('/api/access/status', await identity(uid))).nextPath, '/dashboard');
    }
    console.log(JSON.stringify({ passed: true, accounts: 15, invitationAcceptance: true, resumableOnboarding: true,
      stagedGoogleConnection: 'controlled provider responses', simplifiedDashboard: true, mentor: true,
      progress: true, notificationsOptInPreserved: true, anonymousAndUninvitedDenied: true, crossAccountDenied: true,
      realEmailsSent: 0, realGoogleGrants: 0, realAiCalls: 0, productionRecordsChanged: 0 }));
  } finally { await app.delete(); }
}
main().catch(error => { console.error(`Rollout smoke test failed at ${stage}: ${error.message}`); process.exitCode = 1; });

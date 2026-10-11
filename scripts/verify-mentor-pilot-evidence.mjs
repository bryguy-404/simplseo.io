// Read-only pilot evidence audit. Capture BEFORE the two questions and activity
// check; verify AFTER them. This script never authenticates an app session,
// invokes generation/check endpoints, refreshes OAuth or writes to Firestore.
// Usage:
// node scripts/verify-mentor-pilot-evidence.mjs capture <private-identity.jsonl> <private-baseline.json>
// node scripts/verify-mentor-pilot-evidence.mjs verify <private-identity.jsonl> <private-baseline.json>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import { createServer } from 'vite';

const protectedCollections = ['pageReviewPlans', 'implementedSeoTips', 'pageProgressCycles', 'newPagePlans',
  'newPagePublications', 'newPageWorkspaces', 'newPageAssessments'];
const oauthFields = new Set(['gscAccessToken', 'gscRefreshToken', 'gscExpiresAt', 'gscConnectedAt']);
const stable = value => value?.toDate ? value.toDate().toISOString() : value instanceof Date ? value.toISOString()
  : Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])])) : value;
export const evidenceHash = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export function preservationChanges(before, after) {
  const old = new Map(before.map(item => [item.key, item])), current = new Map(after.map(item => [item.key, item]));
  return [...new Set([...old.keys(), ...current.keys()])].filter(key => old.get(key)?.hash !== current.get(key)?.hash)
    .map(key => ({ collection: current.get(key)?.collection || old.get(key)?.collection,
      change: !old.has(key) ? 'added' : !current.has(key) ? 'removed' : 'changed' }));
}
export function compareAnswerEnvelope(message, evidence) {
  const checks = {};
  for (const field of ['metricCards', 'actions']) {
    const allowed = new Set(evidence[field]);
    const supplied = message[field] || [];
    assert(Array.isArray(supplied), 'Malformed saved answer envelope.');
    checks[field] = { checked: supplied.length, matching: supplied.filter(item => allowed.has(evidenceHash(item))).length };
  }
  return checks;
}

let stage = 'configuration';
async function main() {
  dotenv.config({ path: '.env.local', quiet: true });
  // Firestore SDK diagnostics can include document paths. Only emit our report.
  console.log = () => {};
  const [mode, identityFile, baselineFile, ...extra] = process.argv.slice(2);
  assert(['capture', 'verify'].includes(mode) && identityFile && baselineFile && !extra.length);
  assert.equal(process.env.FIREBASE_PROJECT_ID, 'simpleseo-90570');
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const identities = fs.readFileSync(identityFile, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(identities.length, 1);
  const { uid, property } = identities[0];
  assert(typeof uid === 'string' && uid && !uid.includes('/'));
  assert.equal(property, 'https://bryandevelops.com/');
  const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom', logLevel: 'error' });
  try {
    const { db } = await vite.ssrLoadModule('/app/lib/firebaseAdmin.js');
    const { readMentorAccountScope, executeMentorEvidenceTool, assertMentorAccountScope } = await vite.ssrLoadModule('/app/lib/server/mentorEvidence.js');
    const { approvedGoogleDocumentationUrl } = await vite.ssrLoadModule('/app/lib/mentorDocumentationPolicy.js');
    const scope = await readMentorAccountScope(uid);
    assert.equal(scope.property, property);
    const scopeHash = evidenceHash(scope);
    const ownedList = async collection => {
      const list = await db.collection(collection).where('userId', '==', uid).limit(501).get();
      assert(list.size <= 500, 'Account collection exceeds the audit bound.');
      return list.docs;
    };
    const captureProtected = async () => {
      const captured = new Map();
      const visit = async (snapshot, collection, stripOAuth = false) => {
        if (!snapshot.exists || captured.has(snapshot.ref.path)) return;
        assert(captured.size < 5000, 'Protected snapshot exceeds the audit bound.');
        const data = stripOAuth ? Object.fromEntries(Object.entries(snapshot.data()).filter(([key]) => !oauthFields.has(key))) : snapshot.data();
        captured.set(snapshot.ref.path, { key: evidenceHash(snapshot.ref.path), collection, hash: evidenceHash(data) });
        for (const child of await snapshot.ref.listCollections()) {
          // Only profile descendants of users are relevant; do not read staged
          // credentials or unrelated user subcollections.
          if (collection === 'users' && child.id !== 'businessProfiles') continue;
          const children = await child.limit(501).get(); assert(children.size <= 500);
          for (const doc of children.docs) await visit(doc, collection === 'users' ? 'businessProfiles' : collection);
        }
      };
      await visit(await db.doc(`users/${uid}`).get(), 'users', true);
      await visit(await db.doc(`onboarding/${uid}`).get(), 'onboarding');
      for (const collection of protectedCollections) for (const doc of await ownedList(collection)) await visit(doc, collection);
      return [...captured.values()].sort((a, b) => a.key.localeCompare(b.key));
    };
    const readAnswers = async () => {
      const answers = [];
      for (const conversation of await ownedList('conversations')) {
        const data = conversation.data();
        if (data.schemaVersion !== 9 || data.scope?.key !== scope.key || data.status === 'deleted') continue;
        const messages = await conversation.ref.collection('messages').where('role', '==', 'assistant').limit(201).get();
        assert(messages.size <= 200, 'Conversation exceeds the audit bound.');
        for (const message of messages.docs) answers.push({ key: evidenceHash(message.ref.path), conversation, message });
      }
      return answers;
    };
    const readEvidence = async () => {
      const results = [];
      for (const [name, args] of [['read_business_context', {}], ['mentor_page_evidence', { pageUrl: property }],
        ['mentor_page_work', { pageUrl: property }], ['mentor_new_page_work', { planId: null }]]) {
        results.push(await executeMentorEvidenceTool(uid, scope, name, args));
      }
      return Object.fromEntries(['sources', 'metricCards', 'actions'].map(field => [field,
        [...new Set(results.flatMap(result => result[field] || []).map(evidenceHash))]]));
    };
    const readCheck = async () => {
      const key = evidenceHash([scope.key, 'activity', property]);
      return (await db.doc(`mentorCheckOperations/${key}`).get()).data() || null;
    };
    stage = 'saved baseline reads';
    const records = await captureProtected(), answers = await readAnswers(), evidence = await readEvidence(), check = await readCheck();
    await assertMentorAccountScope(uid, scope);
    if (mode === 'capture') {
      const baseline = { schemaVersion: 1, capturedAt: new Date().toISOString(), scopeHash, protectedRecords: records,
        previousAnswerKeys: answers.map(answer => answer.key), evidence, activityCheckHash: evidenceHash(check),
        activityCheckLastAttemptAt: check?.lastAttemptAt || null };
      fs.writeFileSync(baselineFile, `${JSON.stringify(baseline, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      process.stdout.write(`${JSON.stringify({ mode, capturedAt: baseline.capturedAt, protectedDocuments: records.length,
        existingAnswers: answers.length, cloudMutations: 0, generatedAnswers: 0, observationRefreshes: 0 })}\n`);
      return;
    }
    const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    assert.equal(baseline.schemaVersion, 1); assert.equal(baseline.scopeHash, scopeHash, 'Pilot scope or business profile changed.');
    stage = 'protected account preservation';
    const changes = preservationChanges(baseline.protectedRecords, records);
    assert.equal(changes.length, 0, 'Profile, tasks, publication or cycles changed after baseline.');
    const allowed = Object.fromEntries(['sources', 'metricCards', 'actions'].map(field => [field, [...baseline.evidence[field], ...evidence[field]]]));
    const previousKeys = new Set(baseline.previousAnswerKeys), freshAnswers = answers.filter(answer => !previousKeys.has(answer.key));
    assert.equal(freshAnswers.length, 2, 'Expected exactly two completed real pilot answers after capture.');
    const results = [];
    for (const item of freshAnswers) {
      stage = `pilot answer ${results.length + 1} agreement`;
      const message = item.message.data(), provenance = message.provenance;
      assert.equal(message.userId, uid); assert.equal(provenance?.scope?.key, scope.key);
      assert.equal(provenance?.scope?.profileRevision, scope.profileRevision);
      assert.equal(provenance?.turnId, message.turnId); assert.equal(provenance?.conversationId, item.conversation.id);
      const turn = (await item.conversation.ref.collection('turns').doc(message.turnId).get()).data();
      assert.equal(turn?.status, 'completed'); assert.equal(turn.userId, uid);
      const checked = compareAnswerEnvelope(message, allowed);
      for (const kind of ['metricCards', 'actions']) assert.equal(checked[kind].checked, checked[kind].matching, `Saved ${kind} disagree with account evidence.`);
      let accountSources = 0, documentationSources = 0;
      for (const source of message.sources || []) {
        if (source.type === 'google_documentation') {
          assert.equal(approvedGoogleDocumentationUrl(source.url), source.url);
          assert(/^google-[a-f0-9]{20}$/.test(source.id));
          const saved = (await db.doc(`mentorDocumentationCache/${source.id}`).get()).data();
          assert(saved?.excerpt && saved.url === source.url && saved.title === source.title);
          assert(Number.isFinite(Date.parse(source.observedAt)) && Date.parse(source.observedAt) <= Date.parse(saved.observedAt));
          documentationSources++;
        } else {
          assert(allowed.sources.includes(evidenceHash(source)), 'Account source does not match saved evidence.'); accountSources++;
        }
      }
      results.push({ answerNumber: results.length + 1, model: provenance.model, policyVersion: provenance.policyVersion,
        generatedAt: provenance.generatedAt, completedAt: stable(turn.completedAt),
        metricCardsChecked: checked.metricCards.checked, actionsChecked: checked.actions.checked,
        accountSourcesChecked: accountSources, documentationSourcesChecked: documentationSources,
        envelopeAgreement: true, answerTextIncluded: false });
    }
    stage = 'saved requested activity check';
    assert(check?.userId === uid && check.scopeKey === scope.key && check.pageUrl === property && check.kind === 'activity');
    assert(!check.leaseId && !check.leaseUntil, 'Requested check is still running.');
    const checkedAfterBaseline = Date.parse(check.lastAttemptAt) >= Date.parse(baseline.capturedAt);
    const observedAfterBaseline = evidenceHash(check) !== baseline.activityCheckHash;
    // A cooldown hit performs no writes. Report that honestly; the UI/API check
    // response is needed to prove the owner's click reused the existing cache.
    const investigation = { state: check.lastError ? 'unavailable_or_partial' : 'available', lastAttemptAt: check.lastAttemptAt,
      lastSuccessAt: check.lastSuccessAt, newPersistedCheckAfterBaseline: checkedAfterBaseline && observedAfterBaseline,
      cacheReuseNeedsUiConfirmation: !checkedAfterBaseline || !observedAfterBaseline };
    if (check.result?.value) {
      const saved = check.result.value;
      assert.equal(saved.pageUrl, property); assert.equal(saved.property, scope.property);
      assert(Number.isFinite(Date.parse(saved.fetchedAt)));
      investigation.savedObservationDate = saved.fetchedAt;
      investigation.reportingWindow = saved.window;
    }
    stage = 'aggregate cost ledger';
    const month = new Date().toISOString().slice(0, 7), ledger = (await db.doc(`mentorBudgetMonths/${month}`).get()).data() || {};
    const costs = { month, spentUsd: ledger.spentUsd || 0, reservedUsd: ledger.reservedUsd || 0,
      evaluationSpentUsd: ledger.evaluationSpentUsd || 0, evaluationReservedUsd: ledger.evaluationReservedUsd || 0,
      pricingVersion: ledger.pricingVersion || null };
    stage = 'read-only audit preservation';
    assert.equal(preservationChanges(records, await captureProtected()).length, 0);
    await assertMentorAccountScope(uid, scope);
    process.stdout.write(`${JSON.stringify({ verifiedAt: new Date().toISOString(), mode, baselineAt: baseline.capturedAt,
      scopeAndProfilePreserved: true, protectedDocuments: records.length, changedProtectedDocuments: 0,
      pilotAnswers: results, investigation, costs, cloudMutations: 0, generatedAnswers: 0, observationRefreshes: 0,
      limitation: 'This verifies saved metric cards, source identities and permitted actions. It does not automatically grade conversational prose or source-to-claim relevance; review the two answers in the app.' }, null, 2)}\n`);
  } finally { await vite.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error(`Mentor pilot evidence verification failed during ${stage}. Conversation text, private identities and credentials are omitted.`); process.exitCode = 1; });
}

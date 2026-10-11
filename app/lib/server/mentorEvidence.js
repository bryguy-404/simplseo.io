import { db } from '../firebaseAdmin';
import { readBusinessContext } from './businessProfile';
import { readNewPageInventory } from './newPageInventory';
import { readMentorContext, mentorPageInScope } from './mentorContext';
import { readSavedMentorActivity } from './mentorActivitySnapshots';
import { assertMentorAccountScope, mentorHash } from './mentorAccountScope';
import { RequestError } from './requestAuth';
import { publicOngoingCycle } from './ongoingProgress';
import { projectMentorPlan, projectMentorPage, projectMentorTechnical, projectMentorCycle, mentorProjection } from './mentorEvidenceProjection';
export { readMentorAccountScope, assertMentorAccountScope } from './mentorAccountScope';
export { runMentorCheck } from './mentorChecks';

const text = (value, max = 1200) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const source = (type, url, title, observedAt) => ({ id: `M${mentorHash([type, url, observedAt]).slice(0, 20)}`, type, url, title, observedAt: observedAt || null });
const pageAction = pageUrl => ({ id: `action-${mentorHash(['page', pageUrl]).slice(0, 16)}`, label: 'Improve this page', href: `/low-ctr?page=${encodeURIComponent(pageUrl)}` });
const navAction = (label, href) => ({ id: `action-${mentorHash(href).slice(0, 16)}`, label, href });
const normalizedWebsite = value => { try { return new URL(/^https?:\/\//i.test(value || '') ? value : `https://${value}`).href; } catch { return null; } };
const matches = (scope, record) => record && record.userId === scope.userId && record.property === scope.property
  && (record.websiteRunId || null) === (scope.websiteRunId || null) && (!record.websiteUrl
    || (normalizedWebsite(record.websiteUrl) && normalizedWebsite(record.websiteUrl) === normalizedWebsite(scope.websiteUrl)));
const optional = async fn => { try { return await fn(); } catch (e) { if (e instanceof RequestError && [400, 409].includes(e.status)) return null; throw e; } };
const envelope = (data, sources = [], metricCards = [], actions = []) => ({ data, sources, metricCards, actions });
const revisionCollections = { page_plan: 'pageReviewPlans', cycle: 'pageProgressCycles', new_page_plan: 'newPagePlans',
  assessment: 'newPageAssessments', activity: 'mentorActivitySnapshots', technical: 'mentorCheckOperations',
  publication: 'newPagePublications', inventory: 'newPageInventories', onboarding_inventory: 'onboardingInventories' };
const withoutObservationTimes = value => Array.isArray(value) ? value.map(withoutObservationTimes)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['fetchedAt', 'checkedAt', 'observedAt', 'lastAttemptAt', 'lastSuccessAt', 'updatedAt'].includes(key))
    .map(([key, child]) => [key, withoutObservationTimes(child)])) : value;
function substantiveRecord(kind, value) {
  if (!value) return null;
  if (kind === 'cycle') return { lifecycle: value.lifecycle, confirmedAt: value.confirmedAt, confirmation: value.confirmation,
    latestCheckpointId: value.latestCheckpointId, checkpointRevision: value.latestCheckpoint?.evidenceRevision,
    latestDecisionId: value.latestDecisionId, supersededByCycleId: value.supersededByCycleId,
    reviewChangesAllowed: value.reviewChangesAllowed };
  if (kind === 'activity') return { status: value.value?.status, window: value.value?.window,
    previousWindow: value.value?.previousWindow, current: value.value?.current, previous: value.value?.previous,
    totals: value.value?.totals, lastError: value.lastError || null };
  if (kind === 'technical') return withoutObservationTimes({ result: value.result, failedObservation: value.failedObservation,
    lastError: value.lastError || null });
  if (kind === 'publication') return withoutObservationTimes({ planId: value.planId, pageUrl: value.pageUrl,
    ownerDeclaredAt: value.ownerDeclaredAt, verifiedAt: value.verifiedAt, publicPage: value.publicPage,
    indexing: value.indexing, activity: value.activity, preexistingActivity: value.preexistingActivity, lastError: value.lastError });
  if (kind === 'inventory' || kind === 'onboarding_inventory') return { revision: value.revision || 0 };
  return { revision: value.revision || 0, status: value.status || null };
}
const evidenceRevision = (kind, id, value) => ({ kind, id, fingerprint: mentorHash(substantiveRecord(kind, value)) });

// These private references are captured by tools, not accepted as browser facts.
// The caller may include the same assertion in its final save transaction.
export async function assertMentorEvidenceRevisions(uid, scope, references = [], { tx } = {}) {
  if (!Array.isArray(references) || references.length > 100) throw new RequestError('Too much evidence was selected for this answer.', 400);
  await assertMentorAccountScope(uid, scope, tx);
  await Promise.all(references.map(async reference => {
    const collection = revisionCollections[reference?.kind];
    if (!collection || typeof reference.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(reference.id)
      || !/^[a-f0-9]{64}$/.test(reference.fingerprint || '')) throw new RequestError('This answer’s evidence could not be verified.', 409);
    const ref = db.collection(collection).doc(reference.id), value = (await (tx ? tx.get(ref) : ref.get())).data();
    if (value && !matches(scope, reference.kind.endsWith('inventory') ? value.scope : value)) throw new RequestError('This answer’s evidence no longer belongs to your website.', 409);
    if (mentorHash(substantiveRecord(reference.kind, value)) !== reference.fingerprint) {
      throw new RequestError('Your saved work changed while this answer was being prepared. Ask again to use the latest evidence.', 409);
    }
  }));
  if (!tx) await assertMentorAccountScope(uid, scope);
}

async function inventoryPages(uid, scope) {
  const inventory = await optional(() => readNewPageInventory(uid));
  if (inventory && inventory.scope?.userId === uid && inventory.scope.property === scope.property
    && normalizedWebsite(inventory.scope.websiteUrl) === normalizedWebsite(scope.websiteUrl) && (inventory.scope.websiteRunId || null) === (scope.websiteRunId || null)) {
    return { pages: inventory.pages.filter(page => mentorPageInScope(scope, page.url)).map(page => ({
      pageUrl: page.url, status: page.status, reason: page.reason || null, observedAt: page.observedAt || null,
      title: text(page.content?.htmlTitle, 300), content: page.content || null,
    })), limitations: inventory.coverage?.limitations || [], source: 'website_inventory',
    evidenceRevision: evidenceRevision('inventory', inventory.id, inventory) };
  }
  const context = await readMentorContext(uid);
  return { pages: context.pages.map(page => ({ ...page, status: 'fetched', content: {
    htmlTitle: page.title, seoMetaDescription: page.metaDescription, textContent: page.textContent, headings: page.headings,
  } })), limitations: context.limitations, source: context.source,
  evidenceRevision: context.inventoryIdentity ? evidenceRevision(context.inventoryIdentity.collection === 'onboardingInventories' ? 'onboarding_inventory' : 'inventory',
    context.inventoryIdentity.id, context.inventoryIdentity) : null };
}

export async function readMentorWorkspaceContext(uid, scope) {
  await assertMentorAccountScope(uid, scope);
  const inventory = await inventoryPages(uid, scope);
  const urls = new Map();
  const proposedHome = scope.websiteUrl ? (/^https?:\/\//i.test(scope.websiteUrl) ? scope.websiteUrl : `https://${scope.websiteUrl}`) : null;
  const homepageUrl = mentorPageInScope(scope, proposedHome) ? new URL(proposedHome).href : null;
  if (homepageUrl) urls.set(homepageUrl, { url: homepageUrl, title: 'Homepage' });
  for (const page of inventory.pages.slice(0, 100)) urls.set(page.pageUrl, { url: page.pageUrl, title: page.title || page.pageUrl });
  const activity = await readSavedMentorActivity(uid, scope);
  for (const page of activity?.value?.pages || []) if (mentorPageInScope(scope, page.pageUrl) && !urls.has(page.pageUrl)) {
    urls.set(page.pageUrl, { url: page.pageUrl, title: page.pageUrl });
  }
  await assertMentorAccountScope(uid, scope);
  return { pageOptions: [...urls.values()].slice(0, 100), homepageUrl,
    limitations: ['Saved observations may be partial or outdated. Opening this chat does not refresh them.'],
    lastActivityAt: activity?.lastSuccessAt || null };
}

const tool = (name, description, properties = {}) => ({ type: 'function', name, description,
  strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } });
const pageArg = { pageUrl: { type: 'string', description: 'Exact selected public page URL from this account.' } };
export const MENTOR_EVIDENCE_TOOLS = [
  tool('read_business_context', 'Read saved owner-confirmed or labeled legacy business facts and website identity.'),
  tool('mentor_find_pages', 'Find saved website pages by title or URL; missing pages remain unknown.', { query: { type: ['string', 'null'] } }),
  tool('mentor_page_evidence', 'Read saved exact-page search totals, incomplete reported queries, live-page excerpts and technical observations. No new checks.', pageArg),
  tool('mentor_page_work', 'Read saved page tasks, owner edits, published changes, checkpoints and follow-up decisions; never change them.', pageArg),
  tool('mentor_new_page_work', 'Read saved new-page ideas, owner drafts and publication status. Null planId lists current saved work.', { planId: { type: ['string', 'null'] } }),
];

export async function executeMentorEvidenceTool(uid, scope, name, args = {}, { deadline = Infinity } = {}) {
  if (deadline <= Date.now()) throw new RequestError('The mentor ran out of time. Your saved work is unchanged.', 503);
  const schema = MENTOR_EVIDENCE_TOOLS.find(item => item.name === name)?.parameters;
  if (!schema || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !Object.hasOwn(schema.properties, key))) {
    throw new RequestError('Choose a supported mentor evidence request.', 400);
  }
  await assertMentorAccountScope(uid, scope);
  let result;
  const evidenceRevisions = [];
  if (name === 'read_business_context') {
    const context = await readBusinessContext(uid, scope);
    result = envelope({ profile: context?.profile || null, status: context?.status || 'unavailable',
      confirmedAt: context?.confirmedAt || null, profileRevision: scope.profileRevision, websiteUrl: scope.websiteUrl,
      limitations: context?.limitations || [] }, [source('profile', '/settings', 'Saved business details', context?.confirmedAt)], [], [navAction('Review business details', '/settings')]);
  } else if (name === 'mentor_find_pages') {
    if (args.query !== null && (typeof args.query !== 'string' || args.query.length > 200)) throw new RequestError('Use a short page name.');
    const inventory = await inventoryPages(uid, scope);
    if (inventory.evidenceRevision) evidenceRevisions.push(inventory.evidenceRevision);
    const query = text(args.query, 200).toLowerCase();
    const pages = inventory.pages.filter(page => !query || `${page.pageUrl} ${page.title}`.toLowerCase().includes(query));
    result = envelope({ pages: pages.slice(0, 30).map(({ content: _content, ...page }) => page), limited: pages.length > 30,
      limitations: ['This is a partial saved inventory, not proof that unlisted pages do not exist or are not indexed.', ...inventory.limitations] });
  } else if (name === 'mentor_page_evidence' || name === 'mentor_page_work') {
    if (!mentorPageInScope(scope, args.pageUrl) || new URL(args.pageUrl).hash) throw new RequestError('Choose a page on your connected website.', 403);
    const pageUrl = args.pageUrl, link = pageAction(pageUrl);
    if (name === 'mentor_page_evidence') {
      const [inventory, activity, technicalDoc] = await Promise.all([inventoryPages(uid, scope), readSavedMentorActivity(uid, scope, { pageUrl }),
        db.collection('mentorCheckOperations').doc(mentorHash([scope.key, 'technical', pageUrl])).get()]);
      const page = inventory.pages.find(item => item.pageUrl === pageUrl), content = page?.content;
      const technical = technicalDoc.data();
      if (inventory.evidenceRevision) evidenceRevisions.push(inventory.evidenceRevision);
      if (matches(scope, technical)) evidenceRevisions.push(evidenceRevision('technical', technicalDoc.id, technical));
      const savedCheck = matches(scope, technical) ? projectMentorTechnical(technical) : null;
      const evidence = activity?.value;
      if (activity?.snapshotId) {
        evidenceRevisions.push(evidenceRevision('activity', activity.snapshotId, activity));
      }
      const metricCards = ['current', 'previous'].filter(key => evidence?.[key]).map(key => ({
        id: `metric-${mentorHash([pageUrl, evidence.window, key]).slice(0, 16)}`, title: key === 'current' ? 'Recent page activity' : 'Previous page activity',
        pageUrl, window: key === 'current' ? evidence.window : evidence.previousWindow, observedAt: evidence.fetchedAt,
        status: evidence[key].totalsStatus, ...(evidence[key].totals || {}), source: 'google_search_console',
      }));
      const activityPeriod = value => ({ totals: value.totals, totalsStatus: value.totalsStatus, queriesStatus: value.queriesStatus,
        queries: [...value.queries].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 3)
          .map(row => ({ query: text(row.query, 160), clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position })),
        savedQueryCount: value.queries.length, queriesLimited: value.queries.length > 3 || value.queries.some(row => row.query?.length > 160),
        querySelection: 'Top three reported searches by clicks, then impressions; partial.' });
      result = envelope({ pageUrl, page: content ? { status: page.status, observedAt: page.observedAt, ...projectMentorPage(content) } : null,
      activity: evidence ? { pageUrl, status: evidence.status, fetchedAt: evidence.fetchedAt, window: evidence.window, previousWindow: evidence.previousWindow,
        current: activityPeriod(evidence.current), previous: activityPeriod(evidence.previous) } : null,
      activityLastError: activity?.lastError || null, technical: savedCheck || null,
      limitations: ['Average position is not a fixed Google results page. Reported query totals omit searches; never sum them to reconstruct page totals.',
        'Publication, live page availability, Google stored indexing status and search activity are independent. Missing observations are not zero.'] },
      [source('website', pageUrl, page?.title || 'Saved page observations', page?.observedAt),
        ...(evidence ? [source('search_activity', link.href, 'Saved exact-page Search Console activity', evidence.fetchedAt)] : [])], metricCards, [link,
          ...['activity', 'technical'].map(kind => ({ id: `check-${mentorHash([kind, pageUrl]).slice(0, 16)}`, kind, pageUrl,
            label: kind === 'activity' ? 'Check latest data' : 'Check this page' }))]);
    } else {
      const [planDoc, cycles, activeCycles] = await Promise.all([
        db.collection('pageReviewPlans').doc(mentorHash([uid, scope.property, pageUrl, scope.websiteRunId])).get(),
        db.collection('pageProgressCycles').where('userId', '==', uid).where('property', '==', scope.property)
          .where('websiteRunId', '==', scope.websiteRunId).where('pageUrl', '==', pageUrl).limit(12).get(),
        db.collection('pageProgressCycles').where('userId', '==', uid).where('property', '==', scope.property)
          .where('websiteRunId', '==', scope.websiteRunId).where('lifecycle', '==', 'active').where('pageUrl', '==', pageUrl).limit(2).get(),
      ]);
      const plan = planDoc.data();
      evidenceRevisions.push(evidenceRevision('page_plan', planDoc.id, plan));
      const scopedCycles = [...new Map([...activeCycles.docs, ...cycles.docs].map(doc => [doc.id, { ...doc.data(), id: doc.id }])).values()]
        .filter(cycle => matches(scope, cycle));
      evidenceRevisions.push(...scopedCycles.map(cycle => evidenceRevision('cycle', cycle.id, cycle)));
      result = envelope({ pageUrl, plan: matches(scope, plan) ? projectMentorPlan({ ...plan, id: plan.id || planDoc.id }) : null,
      cycles: scopedCycles.slice(0, 2).map(cycle => projectMentorCycle(cycle, publicOngoingCycle(cycle).latestDecision)),
      cyclesLimited: scopedCycles.length > 2,
      limitations: ['These are saved plans and a bounded selection of current-version cycles; older history may be omitted. Talking about an edit does not confirm publication or reset its measurement dates.'] },
      [source('page_work', link.href, 'Saved page improvements and progress', plan?.updatedAt)], [], [link,
        ...scopedCycles.filter(cycle => cycle.lifecycle === 'active').slice(0, 1).map(cycle => ({
          id: `check-${mentorHash(['progress', cycle.id]).slice(0, 16)}`, kind: 'progress', pageUrl, cycleId: cycle.id, label: 'Check progress' }))]);
    }
  } else {
    if (args.planId !== null && (typeof args.planId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(args.planId))) throw new RequestError('Choose saved new-page work.');
    if (args.planId) {
      const planDoc = await db.collection('newPagePlans').doc(args.planId).get(), plan = planDoc.data();
      if (!matches(scope, plan)) throw new RequestError('Saved page plan not found.', 404);
      evidenceRevisions.push(evidenceRevision('new_page_plan', planDoc.id, plan));
      const publications = await db.collection('newPagePublications').where('userId', '==', uid).where('planId', '==', args.planId).limit(5).get();
      publications.docs.filter(doc => matches(scope, doc.data())).forEach(doc => evidenceRevisions.push(evidenceRevision('publication', doc.id, doc.data())));
      result = envelope({ id: args.planId, revision: plan.revision, status: plan.status, context: plan.context,
        idea: plan.idea, draft: plan.draft, ownerEdits: plan.ownerEdits || null, updatedAt: plan.updatedAt,
        publications: publications.docs.map(doc => doc.data()).filter(record => matches(scope, record)).map(record => ({
          pageUrl: record.pageUrl, ownerDeclaredAt: record.ownerDeclaredAt, verifiedAt: record.verifiedAt,
          publicPage: record.publicPage, indexing: record.indexing, activity: record.activity,
          preexistingActivity: record.preexistingActivity, lastError: record.lastError, nextCheckAt: record.nextCheckAt })) },
      [source('new_page_plan', '/generic-keywords', 'Saved new-page draft and publication observations', plan.updatedAt)], [], [navAction('Open New page ideas', '/generic-keywords')]);
    } else {
      const lists = await Promise.all(['newPagePlans', 'newPageAssessments'].map(collection => db.collection(collection)
        .where('userId', '==', uid).where('property', '==', scope.property).where('websiteRunId', '==', scope.websiteRunId).limit(30).get()));
      lists.forEach((list, index) => list.docs.forEach(doc => {
        if (matches(scope, doc.data())) evidenceRevisions.push(evidenceRevision(index ? 'assessment' : 'new_page_plan', doc.id, doc.data()));
      }));
      result = envelope({ plans: lists[0].docs.map(doc => ({ ...doc.data(), id: doc.id })).filter(record => matches(scope, record)).map(plan => ({
        id: plan.id, status: plan.status, topic: plan.idea?.topic, area: plan.context?.area, hasDraft: Boolean(plan.draft), updatedAt: plan.updatedAt })),
      assessments: lists[1].docs.map(doc => doc.data()).filter(record => matches(scope, record)).slice(0, 10).map(assessment => ({
        outcome: assessment.outcome, summary: assessment.summary, area: assessment.context?.area, ideas: assessment.ideas,
        questions: assessment.questions, updatedAt: assessment.updatedAt })) }, [], [], [navAction('Open New page ideas', '/generic-keywords')]);
    }
  }
  await assertMentorAccountScope(uid, scope);
  if (name === 'mentor_new_page_work') {
    const projected = mentorProjection(result.data, { textLimit: 300, arrayLimit: 4 });
    result.data = { ...projected.value, projection: { excerptedFields: projected.excerptedFields,
      fullSavedWork: 'Use Open New page ideas for complete owner-edited drafts and publication history. Excerpts are not finished replacement text.' } };
  }
  return JSON.parse(JSON.stringify({ ...result, evidenceRevisions }));
}

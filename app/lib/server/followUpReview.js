import { assertBusinessProfileRevision } from './businessProfile';
import { createHash, randomUUID } from 'node:crypto';
import OpenAI from 'openai';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { ongoingReviewEnabled } from './ongoingReviewFeature';
import { ongoingCycleRef, readOngoingScope, assertOngoingCycleScope, readOngoingCycle, publicOngoingCycle, refreshOngoingProgress } from './ongoingProgress';
import { readCurrentPageForReview } from './manualPageReview';
import { readPageReviewPlan, activateFollowUpPlan } from './pageReviewPlans';
import { followUpEvidence } from '../followUpEvidence';
import { collectPageReviewDiagnostics } from './pageReviewDiagnostics';
import { consumePageReviewQuota } from './requestQuota';
import { recordPageReviewResponse } from './aiUsage';
import { PAGE_REVIEW_MODEL, PAGE_REVIEW_TIMELINE, buildResearchRequest, parseWebResearch, responseText } from '../pageReviewPolicy';
import { FOLLOW_UP_VERSION, buildFollowUpRequest, followUpComparisons, validateFollowUpDecision, stableFollowUpInputs, freshResearchCheck, technicalBlockers } from '../followUpReviewPolicy';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const nowISO = () => new Date().toISOString();
const changed = () => new RequestError('This page review changed. Reload before continuing. Your saved work is unchanged.', 409);
const unavailableResearch = () => ({ status: 'unavailable', checkedAt: nowISO(), summary: '', sources: [],
  limitation: 'Public research was unavailable. No competitor or demand claims have been inferred.' });

export function publicFollowUpDecision(decision) {
  if (!decision) return null;
  return { id: decision.id, cycleId: decision.cycleId, pageUrl: decision.pageUrl,
    outcome: decision.outcome, summary: decision.summary, whatChanged: decision.whatChanged,
    meaning: decision.meaning, nextStep: decision.nextStep, reviewedAt: decision.reviewedAt,
    evidenceIds: decision.evidenceIds || [], proposedTasks: decision.proposedTasks || [],
    checkpointId: decision.checkpointId || null, checkpointRevision: decision.checkpointRevision ?? null,
    acceptedAt: decision.acceptedAt || null, sourcePlanRevision: decision.sourcePlanRevision ?? null,
    canAcceptTasks: decision.outcome === 'improve_page' && (decision.proposedTasks || []).length > 0 && !decision.acceptedAt && Number.isSafeInteger(decision.sourcePlanRevision),
  };
}

async function savedDecision(ref, cycle) {
  if (!cycle.latestDecisionId) return null;
  const snapshot = await ref.collection('decisions').doc(cycle.latestDecisionId).get();
  const decision = snapshot.data();
  if (!decision || decision.cycleId !== cycle.id || decision.userId !== cycle.userId
    || decision.property !== cycle.property || decision.websiteRunId !== (cycle.websiteRunId || null)
    || decision.pageUrl !== cycle.pageUrl) throw changed();
  return decision;
}

export async function readFollowUpReview(userId, cycleId) {
  // GET does not migrate, crawl, inspect Google, use AI or touch quota.
  const cycle = await readOngoingCycle(userId, cycleId);
  return { cycle, decision: cycle.latestDecision || null };
}

function validateAction(input) {
  if (!input || !['review', 'troubleshoot', 'accept_tasks'].includes(input.action)
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new RequestError('Choose a saved review and its current revision.');
  ongoingCycleRef(input.cycleId);
}

async function assertWritable(userId, input, { tx } = {}) {
  const scope = await readOngoingScope(userId, { tx, write: true });
  const ref = ongoingCycleRef(input.cycleId);
  const snapshot = tx ? await tx.get(ref) : await ref.get();
  const cycle = snapshot.data();
  assertOngoingCycleScope(cycle, scope);
  if (cycle.lifecycle !== 'active' || cycle.revision !== input.expectedRevision) throw changed();
  return { ref, cycle, scope };
}

function technicalDecision(cycle, currentPage, diagnostics) {
  const blockers = technicalBlockers(currentPage, diagnostics);
  const technical = cycle.technical;
  const fresh = part => part?.checkedAt && Date.now() - Date.parse(part.checkedAt) < 6 * 3600000;
  if (!currentPage && technical && !technical.errors?.publicPage && fresh(technical.publicPage)) {
    if (technical.publicPage.noindex) blockers.push({ kind: 'noindex', evidenceId: 'P4' });
    if (technical.publicPage.finalUrl && technical.publicPage.finalUrl !== cycle.pageUrl) blockers.push({ kind: 'redirect', evidenceId: 'P4' });
    if ([404, 410].includes(technical.publicPage.httpStatus)) blockers.push({ kind: 'not_found', evidenceId: 'P4' });
    if (technical.publicPage.canonicalUrl && technical.publicPage.canonicalUrl !== cycle.pageUrl) blockers.push({ kind: 'canonical_review', evidenceId: 'P4' });
  }
  if (!diagnostics && technical && !technical.errors?.indexing && fresh(technical.indexing)) {
    if (['BLOCKED_BY_META_TAG', 'BLOCKED_BY_HTTP_HEADER'].includes(technical.indexing.indexingState)) blockers.push({ kind: 'stored_noindex', evidenceId: 'I1' });
    if (technical.indexing.robotsTxtState === 'DISALLOWED') blockers.push({ kind: 'stored_robots_block', evidenceId: 'I1' });
  }
  if (!blockers.length) return null;
  const guidance = {
    noindex: { summary: 'Check the live page’s noindex setting',
      whatChanged: 'The downloaded page includes a noindex directive.',
      meaning: 'This setting asks search engines not to index this page. It may be intentional; the directive does not establish Google’s current indexing state.',
      nextStep: 'If this page should appear in search, remove its noindex setting in your website builder, publish the correction, then check the page again.' },
    not_found: { summary: 'Check this page’s published address',
      whatChanged: 'The saved page address returned a not-found response.',
      meaning: 'The page may have moved or been removed. Its old address cannot be assessed as a working public page.',
      nextStep: 'Open the saved address and check your website builder. Restore the page there if it should still exist, or verify the intended new address before starting a new review.' },
    redirect: { summary: 'Review the page’s destination address',
      whatChanged: 'The saved page address redirects to another URL.',
      meaning: 'A redirect may be intentional. Search activity for the old address may differ from activity for the destination.',
      nextStep: 'Open the destination shown in technical checks and confirm it is the intended page. Review the destination’s own search activity before changing the redirect or wording.' },
    canonical_review: { summary: 'Confirm the page’s intended canonical address',
      whatChanged: 'The live page declares another URL as its canonical address.',
      meaning: 'That can be correct for duplicate pages. Google may attribute search activity to another address, so this needs interpretation before copy changes.',
      nextStep: 'Compare the declared canonical in technical checks with the URL you want Google to use. Keep it if intentional; otherwise correct it in your website builder and publish before checking again.' },
    stored_noindex: { summary: 'Compare Google’s saved indexing block with the live page',
      whatChanged: 'Google’s stored inspection reports a noindex block.',
      meaning: 'This describes Google’s saved crawl, which may predate a correction. It is not a fresh live indexing test.',
      nextStep: 'Check the inspection date and the live page’s indexing setting. If the public page still has noindex unintentionally, remove it in your builder and publish; otherwise use the inspection link to review the stored result.' },
    stored_robots_block: { summary: 'Check the crawl block reported by Google',
      whatChanged: 'Google’s stored inspection reports that robots.txt blocked crawling.',
      meaning: 'The result reflects Google’s saved crawl and may predate a change to robots.txt.',
      nextStep: 'Use the inspection link to review the crawl date. Check whether robots.txt currently blocks this address; if the block is unintentional, ask your website provider to correct that rule, then check again.' },
  };
  const order = ['noindex', 'not_found', 'redirect', 'canonical_review', 'stored_noindex', 'stored_robots_block'];
  const primary = [...blockers].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))[0];
  return { outcome: 'fix_technical', ...guidance[primary.kind],
    evidenceIds: [...new Set(blockers.map(item => item.evidenceId))], proposedTasks: [], blockers };
}

function collectingDecision(cycle) {
  return { outcome: 'gather_evidence', summary: 'Keep collecting the next complete comparison',
    whatChanged: 'A complete dated comparison is not available for this change yet.',
    meaning: 'Missing observations do not show that your edits worked or failed.',
    nextStep: 'Continue monitoring this page. You can check its technical settings now or work on another page while the comparison develops.',
    evidenceIds: [], proposedTasks: [], checkpointId: cycle.latestCheckpointId || null };
}

export async function runFollowUpReview(userId, input, { signal, deadline = Date.now() + 175000 } = {}) {
  validateAction(input);
  if (!ongoingReviewEnabled(userId)) throw new RequestError('Ongoing page reviews are currently paused. Saved work remains available.', 409);
  let { ref, cycle } = await assertWritable(userId, input);
  if (input.action === 'accept_tasks') {
    if (typeof input.decisionId !== 'string' || !/^[a-f0-9]{64}$/.test(input.decisionId)) throw new RequestError('Choose the saved recommendation before adding tasks.');
    return activateFollowUpPlan(userId, { cycleId: input.cycleId, decisionId: input.decisionId,
      expectedRevision: input.expectedRevision, expectedPlanRevision: input.expectedPlanRevision });
  }
  if (input.action === 'troubleshoot') {
    await refreshOngoingProgress(userId, { cycleId: input.cycleId, expectedRevision: input.expectedRevision, technicalOnly: true, signal, deadline });
    return readFollowUpReview(userId, input.cycleId);
  }
  // Technical checks share the collector's cache and lease; repeated requests
  // do not spend AI allowance, even before a comparison is ready.
  const refreshed = await refreshOngoingProgress(userId, { cycleId: input.cycleId, expectedRevision: input.expectedRevision, technicalOnly: true, signal, deadline });
  input = { ...input, expectedRevision: refreshed.cycle?.revision };
  const attempt = randomUUID();
  const release = async () => {
    await db.runTransaction(async tx => {
      const scope = await readOngoingScope(userId, { tx });
      const latest = (await tx.get(ref)).data(); assertOngoingCycleScope(latest, scope);
      if (latest.followUpLease?.id === attempt) tx.update(ref, { followUpLease: null });
    }).catch(() => {});
  };
  cycle = await db.runTransaction(async tx => {
    const { cycle: latest } = await assertWritable(userId, input, { tx });
    if (Date.parse(latest.followUpLease?.expiresAt) > Date.now() || Date.parse(latest.leaseUntil) > Date.now()) {
      throw new RequestError('This page is already being checked. Please wait, then reload its saved review.', 409);
    }
    tx.update(ref, { followUpLease: { id: attempt, expiresAt: new Date(Date.now() + 190000).toISOString() } });
    return latest;
  });
  try {
    const previous = await savedDecision(ref, cycle);
    const currentPlan = await readPageReviewPlan(userId, cycle.pageUrl);
    const checkpointDocs = await ref.collection('checkpoints').orderBy('day', 'desc').limit(5).get();
    const previousCheckpoints = checkpointDocs.docs.map(document => document.data()).filter(point => point.id !== cycle.latestCheckpointId).slice(0, 4);
    const providerTimeout = max => {
      if (signal?.aborted) throw new RequestError('The follow-up was cancelled. Saved work is unchanged.', 409);
      const left = deadline - Date.now();
      if (left < 5000) throw new RequestError('This check took too long. Saved work is unchanged. Please try later.', 503);
      return Math.min(left, max);
    };
    const guard = async () => db.runTransaction(async tx => {
      const { cycle: latest } = await assertWritable(userId, input, { tx });
      if (latest.followUpLease?.id !== attempt) throw changed();
      const planRef = currentPlan?.id ? db.collection('pageReviewPlans').doc(currentPlan.id) : null;
      if (planRef && (await tx.get(planRef)).data()?.revision !== currentPlan.revision) throw changed();
      return latest;
    });
    if (previous?.acceptedAt && previous.checkpointId === cycle.latestCheckpointId
      && previous.checkpointRevision === (cycle.latestCheckpoint?.evidenceRevision || 1)
      && currentPlan?.followUp?.decisionId === previous.id && !technicalDecision(cycle)) {
      return { cycle: publicOngoingCycle(await guard()), decision: publicFollowUpDecision(previous), unchanged: true,
        message: 'Your accepted tasks are ready to work on. Confirm another publication only after making the edits.' };
    }
    let result = technicalDecision(cycle), context = null;
    if (!result && !cycle.latestCheckpoint) result = collectingDecision(cycle);
    let fingerprint;
    if (result) {
      fingerprint = hash(stableFollowUpInputs({ version: FOLLOW_UP_VERSION, confirmation: cycle.confirmation,
        comparisons: followUpComparisons(cycle, previousCheckpoints), technical: cycle.technical, outcome: result.outcome }));
    } else {
      providerTimeout(45000);
      const page = await readCurrentPageForReview(userId, cycle.pageUrl, { deadline, signal });
      if (page.provenance.property !== cycle.property || page.provenance.websiteRunId !== (cycle.websiteRunId || null)) throw changed();
      if (page.currentPage.finalUrl !== cycle.pageUrl) throw new RequestError('This page redirects. Use Check technical settings to review its destination before interpreting search changes.', 409);
      if (page.currentPage.textContent.length < 80) throw new RequestError('There is not enough readable page content for a supported follow-up. Your saved review is unchanged.', 422);
      const focus = cycle.confirmation?.searchFocus?.phrase;
      const evidence = followUpEvidence(cycle, page.currentPage);
      const diagnostics = await collectPageReviewDiagnostics(userId, { pageUrl: cycle.pageUrl, property: cycle.property,
        currentPage: page.currentPage, evidence, deadline, signal });
      const priorTasks = [...(currentPlan?.tasks || [])];
      for (const task of cycle.confirmation?.tasks || []) if (!priorTasks.some(item => item.id === task.id)) priorTasks.push({ ...task, status: 'done' });
      context = { ...page, evidence, diagnostics, priorTasks,
        ownerGoal: currentPlan?.review?.ownerGoal || '', focusKeywords: focus ? [focus] : [] };
      result = technicalDecision(cycle, page.currentPage, diagnostics);
      const research = previous?.review?.research || currentPlan?.review?.research;
      context.research = research || unavailableResearch();
      fingerprint = hash(stableFollowUpInputs({ version: FOLLOW_UP_VERSION, confirmation: cycle.confirmation,
        comparisons: followUpComparisons(cycle, previousCheckpoints), currentPage: context.currentPage, evidence, diagnostics,
        tasks: context.priorTasks, ownerGoal: context.ownerGoal, focusKeywords: context.focusKeywords,
        ...(context.businessProfile ? { businessProfile: { ...context.businessProfile, confirmedAt: null } } : {}) }));
      const previousDiagnostics = previous?.review?.diagnostics;
      const diagnosticFailure = previousDiagnostics?.inspection?.status === 'available' && diagnostics.inspection?.status !== 'available'
        || (previousDiagnostics?.relatedPages || []).some(old => old.status === 'available'
          && (diagnostics.relatedPages || []).some(current => current.pageUrl === old.pageUrl && current.status !== 'available'));
      if (!result && previous && diagnosticFailure) {
        return { cycle: publicOngoingCycle(await guard()), decision: publicFollowUpDecision(previous), unchanged: true,
          message: 'Some technical evidence could not be refreshed. Your saved recommendation is unchanged.' };
      }
      if (!result && (evidence.current.totalsStatus === 'unavailable' || evidence.previous.totalsStatus === 'unavailable')) {
        // A failed refresh must not replace an earlier useful saved decision.
        if (previous) return { cycle: publicOngoingCycle(await guard()), decision: publicFollowUpDecision(previous), unchanged: true,
          message: 'The comparison could not be refreshed. Your saved recommendation is unchanged.' };
        result = collectingDecision(cycle);
      }
      if (!result && previous?.inputFingerprint === fingerprint && freshResearchCheck(research)) {
        return { cycle: publicOngoingCycle(await guard()), decision: publicFollowUpDecision(previous), unchanged: true };
      }
      if (!result) {
        if (!process.env.OPENAI_API_KEY) throw new RequestError('Follow-up recommendations are temporarily unavailable. Saved work remains available.', 503);
        providerTimeout(45000); await guard();
        await consumePageReviewQuota(userId);
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 45000 });
        const usage = { userId, reviewRunId: randomUUID(), requestedModel: PAGE_REVIEW_MODEL, feature: 'page_follow_up' };
        if (!freshResearchCheck(research)) {
          try {
            const response = await recordPageReviewResponse({ ...usage, stage: 'research' }, () => openai.responses.create(
              buildResearchRequest(page.currentPage), { timeout: providerTimeout(45000), ...(signal ? { signal } : {}) }));
            context.research = parseWebResearch(response);
          } catch { context.research = unavailableResearch(); }
        }
        await guard();
        const previousDocs = await ref.collection('decisions').orderBy('reviewedAt', 'desc').limit(5).get();
        const previousDecisions = previousDocs.docs.map(document => document.data()).reverse();
        const response = await recordPageReviewResponse({ ...usage, stage: 'follow_up' }, () => openai.responses.create(
          buildFollowUpRequest({ ...context, cycle, previousDecisions, previousCheckpoints }), { timeout: providerTimeout(90000), ...(signal ? { signal } : {}) }));
        try { result = validateFollowUpDecision(responseText(response), context); }
        catch { throw new RequestError('The follow-up did not return a supported recommendation. Your saved work is unchanged. Please try later.', 502); }
      }
    }
    await guard();
    if (previous?.inputFingerprint === fingerprint && previous.outcome === result.outcome && !result.assessment) {
      return { cycle: publicOngoingCycle(await guard()), decision: publicFollowUpDecision(previous), unchanged: true };
    }
    const reviewedAt = nowISO();
    const decisionId = hash([cycle.id, fingerprint, attempt]);
    const { assessment, ...decisionFields } = result;
    const completedReview = assessment && context ? { ...assessment, ...context,
      timeline: PAGE_REVIEW_TIMELINE, provenance: { ...context.provenance, generatedAt: reviewedAt,
        reviewVersion: `follow_up_${FOLLOW_UP_VERSION}`, model: PAGE_REVIEW_MODEL },
    } : null;
    const decision = { ...decisionFields, id: decisionId, cycleId: cycle.id, userId, property: cycle.property,
      websiteRunId: cycle.websiteRunId || null, pageUrl: cycle.pageUrl, reviewedAt, acceptedAt: null,
      inputFingerprint: fingerprint, sourcePlanRevision: currentPlan?.revision ?? null,
      checkpointId: cycle.latestCheckpointId || null, checkpointRevision: cycle.latestCheckpoint ? (cycle.latestCheckpoint.evidenceRevision || 1) : null,
      review: completedReview,
      technicalObservation: result.outcome === 'fix_technical' ? context?.diagnostics || cycle.technical : null,
    };
    if (Buffer.byteLength(JSON.stringify(decision)) > 800000) throw new RequestError('This review is too large to save safely. Your saved work is unchanged.', 422);
    const updated = await db.runTransaction(async tx => {
      const { cycle: latest } = await assertWritable(userId, input, { tx });
      if (latest.followUpLease?.id !== attempt) throw changed();
      if (context) await assertBusinessProfileRevision(userId, context.provenance.businessProfileRevision, tx);
      if (currentPlan?.id && (await tx.get(db.collection('pageReviewPlans').doc(currentPlan.id))).data()?.revision !== currentPlan.revision) throw changed();
      const next = { ...latest, revision: latest.revision + 1, followUpLease: null,
        latestDecisionId: decisionId, latestDecision: publicFollowUpDecision(decision),
        reviewStatus: result.outcome === 'fix_technical' ? 'needs_attention' : latest.latestCheckpoint ? 'reviewed' : 'collecting' };
      tx.create(ref.collection('decisions').doc(decisionId), decision);
      tx.update(ref, next);
      return next;
    });
    return { cycle: publicOngoingCycle(updated), decision: publicFollowUpDecision(decision) };
  } finally { await release(); }
}

import { describe, expect, it } from 'vitest';
import fixtureData from './fixtures/follow-up-reviews.cjs';
import { buildResearchRequest } from '../app/lib/pageReviewPolicy';
import { FOLLOW_UP_SCHEMA, FOLLOW_UP_INSTRUCTIONS, buildFollowUpRequest, validateFollowUpDecision,
  stableFollowUpInputs, usableResearch, freshResearchCheck, technicalBlockers } from '../app/lib/followUpReviewPolicy';

const { context, keepDecision, improveDecision, fixtures } = fixtureData;
describe('follow-up review policy', () => {
  it('preserves useful no-change outcomes with exact dated comparison context', () => {
    const ctx = context('roofing');
    expect(validateFollowUpDecision(keepDecision(ctx), ctx)).toMatchObject({ outcome: 'keep_monitoring', proposedTasks: [] });
    const request = buildFollowUpRequest(ctx);
    expect(request.text.format.schema).toBe(FOLLOW_UP_SCHEMA);
    const sent = JSON.parse(request.input.at(-1).content);
    expect(sent.checkpoint.windows).toEqual(ctx.cycle.latestCheckpoint.windows);
    expect(sent.confirmedChange.confirmation.tasks).toEqual(ctx.cycle.confirmation.tasks);
    expect(FOLLOW_UP_INSTRUCTIONS).toContain('Missing query rows are not zero');
    expect(FOLLOW_UP_INSTRUCTIONS).toContain('A name may be a person, brand or place');
  });
  it('keeps original and later comparisons separately labeled without duplicating every query row', () => {
    const ctx = context('roofing'); ctx.cycle.originalComparison = structuredClone(ctx.cycle.latestCheckpoint);
    const request = buildFollowUpRequest({ ...ctx, previousCheckpoints: [ctx.cycle.latestCheckpoint] });
    const payload = JSON.parse(request.input.at(-1).content);
    expect(payload.comparisons.original.windows).toEqual(ctx.cycle.originalComparison.windows);
    expect(payload.comparisons.previous).toHaveLength(1);
    expect(payload.comparisons.original.post).not.toHaveProperty('queries');
    expect(payload.measurementLimitations).toContain('separate cycle');
  });
  it('allows a present content correction with sparse metrics and exact source quotes', () => {
    const ctx = context('landscaping', { sparse: true, weakHeading: true });
    const result = validateFollowUpDecision(improveDecision(ctx), ctx);
    expect(result.outcome).toBe('improve_page');
    expect(result.proposedTasks[0].currentQuote).toBe(ctx.currentPage.h1);
    const forged = improveDecision(ctx); forged.assessment.recommendations[0].supportingQuote = 'We have a new office in another city.';
    expect(() => validateFollowUpDecision(forged, ctx)).toThrow();
  });
  it.each(['The edit caused higher traffic.', 'Your change proved the title worked.', 'You will rank better next month.',
    'The page received 300 clicks.', 'Expect 200 visitors.', 'Your position is 2.', 'This has a 90% chance of success.'])('rejects unsupported claims: %s', text => {
    const ctx = context('roofing'), draft = keepDecision(ctx); draft.meaning = text;
    expect(() => validateFollowUpDecision(draft, ctx)).toThrow();
  });
  it('rejects fabricated evidence IDs and unavailable research source citations', () => {
    const ctx = context('roofing');
    for (const id of ['W1', 'P999', 'I999']) expect(() => validateFollowUpDecision({ ...keepDecision(ctx), evidenceIds: [id] }, ctx)).toThrow();
  });
  it('prioritizes an observed noindex block without inventing a penalty or failure from sparse traffic', () => {
    const ctx = context('plumbing', { noindex: true });
    expect(technicalBlockers(ctx.currentPage, ctx.diagnostics)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'noindex' })]));
    expect(() => validateFollowUpDecision(keepDecision(ctx), ctx)).toThrow();
    const fine = context('plumbing', { sparse: true });
    expect(technicalBlockers(fine.currentPage, fine.diagnostics)).toEqual([]);
    expect(() => validateFollowUpDecision({ ...keepDecision(fine), outcome: 'fix_technical' }, fine)).toThrow();
  });
  it('does not resurrect an identical completed task', () => {
    const ctx = context('web', { weakHeading: true }), draft = improveDecision(ctx);
    ctx.priorTasks.push({ status: 'done', recommendation: draft.assessment.recommendations[0] });
    expect(() => validateFollowUpDecision(draft, ctx)).toThrow();
  });
  it('blocks replacement edits in a completed task location during the pilot', () => {
    const ctx = context('web', { weakHeading: true }), draft = improveDecision(ctx);
    ctx.priorTasks.push({ status: 'done', recommendation: { ...draft.assessment.recommendations[0], proposedText: 'Previously published wording' } });
    // A later rewrite/reversal needs an explicit relationship and review flow;
    // the first pilot conservatively keeps that work out of automatic tasks.
    expect(() => validateFollowUpDecision(draft, ctx)).toThrow();
  });
  it('prevents actionable tasks from being hidden under monitoring or investigation outcomes', () => {
    const ctx = context('web', { weakHeading: true });
    for (const outcome of ['keep_monitoring', 'gather_evidence', 'investigate_visibility']) {
      expect(() => validateFollowUpDecision({ ...improveDecision(ctx), outcome }, ctx)).toThrow();
    }
  });
  it('ignores fetch timestamps in unchanged fingerprints but retains date windows and confirmation facts', () => {
    const ctx = context('roofing'), changed = structuredClone(ctx);
    changed.currentPage.fetchedAt = '2026-10-11T12:00:00Z'; changed.diagnostics.facts[0].text += ' observed later';
    changed.cycle.latestCheckpoint.windows.completeThrough = '2026-10-08';
    changed.cycle.latestCheckpoint.post.queriesCheckedAt = '2026-10-11T12:00:00Z';
    changed.cycle.latestCheckpoint.post.queryRevision = 2;
    expect(stableFollowUpInputs(changed)).toEqual(stableFollowUpInputs(ctx));
    changed.cycle.confirmedAt = '2026-09-10T12:00:00Z';
    expect(stableFollowUpInputs(changed)).not.toEqual(stableFollowUpInputs(ctx));
  });
  it('caches failed research checks without presenting them as usable sources and expires after seven days', () => {
    const now = Date.parse('2026-10-11T00:00:00Z');
    const research = { status: 'unavailable', checkedAt: '2026-10-10T12:00:00Z', sources: [] };
    expect(freshResearchCheck(research, now)).toBe(true); expect(usableResearch(research, now)).toBe(false);
    expect(freshResearchCheck({ ...research, checkedAt: '2026-10-04T00:00:00Z' }, now)).toBe(false);
    expect(freshResearchCheck({ ...research, checkedAt: '2026-10-12T00:00:00Z' }, now)).toBe(false);
  });
  it('limits public research to two searches and excludes private comparison/query/confirmation data', () => {
    const ctx = context('roofing'); ctx.evidence.current.queries[0].query = 'private search phrase';
    const request = buildResearchRequest(ctx.currentPage), serialized = JSON.stringify(request);
    expect(request.max_tool_calls).toBe(2); expect(serialized).not.toContain('private search phrase');
    expect(serialized).not.toContain('confirmed-description'); expect(serialized).not.toContain('impressions":');
  });
  it('keeps eight reviewed fixtures across four industries and both useful changes and no-edit cases', () => {
    expect(fixtures).toHaveLength(8); expect(new Set(fixtures.map(item => item.name.split('-')[0])).size).toBe(4);
    expect(fixtures.every(item => item.rubric && item.expected.length)).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import evaluation from '../scripts/evaluate-follow-up-reviews.cjs';
import data from './fixtures/follow-up-reviews.cjs';

const cases = data.fixtures.filter(fixture => fixture.opportunityGuard);
const opportunity = fixture => {
  const raw = data.keepDecision(fixture.context);
  raw.outcome = 'improve_page'; raw.assessment.action = 'improve_content';
  raw.assessment.recommendations = [{ type: 'content', basis: 'opportunity', benefit: 'visitor_decision',
    currentQuote: fixture.context.currentPage.contentSections[0].text,
    proposedText: null, instruction: 'Explain the existing service using actual business details confirmed by the owner.' }];
  return raw;
};
const check = (fixture, raw) => evaluation.validateFixtureOutcome(fixture, raw, { outcome: raw.outcome });

describe('narrowly adjudicated follow-up evaluation criteria', () => {
  it('applies the service-detail opportunity exception to exactly the two reviewed fixtures', () => {
    expect(cases.map(fixture => fixture.name)).toEqual(['roofing-decline-without-content-defect', 'landscaping-sparse-clicks']);
  });
  it.each(cases)('allows a grounded request for actual service detail in $name', fixture => {
    expect(() => check(fixture, opportunity(fixture))).not.toThrow();
  });
  it.each(cases)('still blocks metadata rewrites, unrelated edits and invented copy in $name', fixture => {
    const changes = [
      raw => { raw.assessment.metadataVerdict = 'revise'; raw.assessment.action = 'revise_metadata'; },
      raw => { raw.assessment.title = 'A different title'; },
      raw => { raw.assessment.description = 'A replacement description'; },
      raw => { raw.assessment.recommendations[0].type = 'heading'; },
      raw => { raw.assessment.recommendations[0].basis = 'observed_issue'; },
      raw => { raw.assessment.recommendations[0].benefit = 'search_relevance'; },
      raw => { raw.assessment.recommendations[0].proposedText = 'Invented new business process.'; },
      raw => { raw.assessment.recommendations[0].currentQuote = 'A nonexistent service or claim.'; },
      raw => { raw.assessment.recommendations[0].instruction = 'Add a promised same-day service.'; },
    ];
    for (const mutate of changes) { const raw = opportunity(fixture); mutate(raw); expect(() => check(fixture, raw)).toThrow(); }
  });
  it('does not add improve_page as an accepted outcome for other no-change scenarios', () => {
    const fixture = data.fixtures.find(item => item.name === 'roofing-positive-observations');
    expect(() => check(fixture, opportunity(fixture))).toThrow();
  });
});

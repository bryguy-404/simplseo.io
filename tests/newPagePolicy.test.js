import { describe, expect, it } from 'vitest';
import { NEW_PAGE_ASSESSMENT_INSTRUCTIONS, NEW_PAGE_DRAFT_INSTRUCTIONS, NEW_PAGE_ASSESSMENT_SCHEMA,
  newPageResearchRequest, newPageStructuredRequest, validateNewPageAssessment, validateNewPageDraft,
  uncertainCoveragePages, validateOwnerDraft, parseNearbyAreas } from '../app/lib/newPagePolicy';

const homepage = 'https://example.test/';
const servicePage = 'https://example.test/services/roof-replacement';
function bundle() {
  return { websiteUrl: homepage, context: { area: 'South Bend, Indiana, United States', services: ['Roof inspection', 'Roof replacement'] },
    pages: [{ url: homepage }, { url: servicePage }], unknownPages: [], priorPlans: [], queries: [{ query: 'roof inspection south bend' }],
    facts: [{ id: 'P1', text: 'Example Roofing provides roof inspection and roof replacement in South Bend.' },
      { id: 'O1', text: 'We inspect roof coverings and flashing, discuss what we find and supply photographs in a written report.' }],
    research: { sources: [{ id: 'W1', url: 'https://city.example/roofing', text: 'Public permit guidance.' }] } };
}
function idea() {
  return { outcome: 'new_page', topic: 'Roof inspections in South Bend', service: 'Roof inspection', intendedCustomer: 'Homeowners evaluating the condition of their roof',
    purpose: 'Explain the roof inspection service and its written report.', reason: 'The existing replacement page does not describe the inspection report.',
    distinctValue: 'Explain the separate inspection visit, roof-covering and flashing checks, and the documented findings an owner receives.',
    existingPageUrl: null, searchFocus: { phrase: 'roof inspection south bend', source: 'observed' }, requiredFacts: [], checkedPageUrls: [homepage, servicePage], uncertainPageUrls: [], evidenceIds: ['P1', 'O1'] };
}
const assessment = () => ({ outcome: 'new_page', summary: 'A separate inspection page can answer questions about this distinct service.', questions: [], ideas: [idea()] });
function draft() {
  return { title: 'Roof inspections in South Bend | Example Roofing', description: 'Learn about roof inspection and the written report from Example Roofing.', h1: 'Roof inspection in South Bend', slug: '/services/roof-inspection',
    sections: [{ id: 'inspection', heading: 'Understand the inspection', body: 'We inspect roof coverings and flashing, discuss what we find and supply photographs in a written report.' }],
    links: [{ url: servicePage, text: 'Roof replacement', placement: 'link_to' }, { url: homepage, text: 'Roof inspection', placement: 'link_from' }],
    optionalPrompts: ['Would a real inspection photograph help explain the report?'], claims: [{ claim: 'Example Roofing provides roof inspection in South Bend.', sourceId: 'P1', quote: 'Example Roofing provides roof inspection and roof replacement in South Bend.' },
      { claim: 'The inspection includes coverings and flashing, with photographs in a written report.', sourceId: 'O1', quote: 'We inspect roof coverings and flashing, discuss what we find and supply photographs in a written report.' }] };
}

describe('opportunity decisions and evidence', () => {
  it('resolves only owner-confirmed removals with verified missing-page evidence', () => {
    const removed = { url: 'https://example.test/old-service', status: 'retired', reason: 'owner_confirmed_removed',
      retirementProof: { ownerConfirmedAt: '2026-10-10T18:00:00Z', verifiedAt: '2026-10-10T18:00:00Z', httpStatus: 404 } };
    expect(uncertainCoveragePages({ pages: [removed] })).toEqual([]);
    expect(uncertainCoveragePages({ pages: [{ ...removed, retirementProof: { ...removed.retirementProof, httpStatus: 410 } }] })).toEqual([]);
    for (const change of [{ status: 'failed' }, { reason: 'unreadable' }, { retirementProof: null },
      ...[200, 301, 403, 500].map(httpStatus => ({ retirementProof: { ...removed.retirementProof, httpStatus } })),
      { retirementProof: { ...removed.retirementProof, verifiedAt: 'invalid' } },
      { retirementProof: { ...removed.retirementProof, ownerConfirmedAt: undefined } }]) {
      expect(uncertainCoveragePages({ pages: [{ ...removed, ...change }] })).toHaveLength(1);
    }
  });
  it('accepts a supported gap with observed search provenance and owner-grounded purpose', () => {
    expect(validateNewPageAssessment(assessment(), bundle())).toEqual(assessment());
  });
  it('accepts no recommendation without filling an idea quota', () => {
    const result = { outcome: 'no_opportunity', summary: 'The existing pages already cover the selected services and area.', questions: [], ideas: [] };
    expect(validateNewPageAssessment(result, bundle())).toEqual(result);
  });
  it('routes covered intent to an exact fetched page instead of another URL', () => {
    const result = assessment(); result.outcome = 'improve_existing';
    result.ideas[0] = { ...idea(), outcome: 'improve_existing', existingPageUrl: servicePage };
    expect(validateNewPageAssessment(result, bundle()).outcome).toBe('improve_existing');
    result.ideas[0].existingPageUrl = 'https://example.test/invented';
    expect(() => validateNewPageAssessment(result, bundle())).toThrow();
  });
  it('accepts a specific missing-fact question without inventing a page', () => {
    const result = { outcome: 'needs_information', summary: 'Confirm whether inspections include a report before planning this page.', questions: ['What does the customer receive after an inspection?'], ideas: [] };
    expect(validateNewPageAssessment(result, bundle())).toEqual(result);
    expect(() => validateNewPageAssessment({ ...result, questions: [] }, bundle())).toThrow();
  });
  it('blocks a new page when an unreadable or unreviewed URL could already serve it', () => {
    const context = bundle(); context.unknownPages = [{ url: 'https://example.test/roof-surveys', status: 'failed' }];
    expect(() => validateNewPageAssessment(assessment(), context)).toThrow('Finish reviewing');
    expect(uncertainCoveragePages({ pages: [
      { url: 'https://example.test/roof-surveys', status: 'failed' },
      { url: servicePage, status: 'pending' },
      { url: homepage, status: 'fetched', content: { h1: 'Actual service heading' } },
      { url: 'https://example.test/privacy', status: 'failed' },
      { url: 'https://example.test/file.pdf', status: 'excluded', reason: 'non_html_response' },
      { url: 'https://example.test/another.pdf', status: 'excluded', reason: 'non_html_resource' },
    ] }).map(page => page.url)).toEqual(['https://example.test/roof-surveys', servicePage]);
  });
  it('treats a downloaded JavaScript shell without readable page content as unknown coverage', () => {
    const result = uncertainCoveragePages({ pages: [
      { url: homepage, status: 'fetched', content: { htmlTitle: 'Loading app', h1: '', textContent: '', mainContent: '' } },
      { url: servicePage, status: 'fetched', content: { mainContent: 'A short but real service description.' } },
    ] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ url: homepage, status: 'unreviewed', reason: 'no_readable_html' });
  });
  it.each(['draft', 'dismissed', 'published'])('does not recreate a topic already saved as %s', status => {
    const context = bundle(); context.priorPlans = [{ status, idea: { topic: 'Different title', searchFocus: { phrase: 'Roof Inspection—South Bend' } } }];
    expect(() => validateNewPageAssessment(assessment(), context)).toThrow('already has a saved plan');
    context.priorPlans[0].idea = { topic: 'ROOF INSPECTIONS IN SOUTH BEND', searchFocus: { phrase: 'different phrase' } };
    expect(() => validateNewPageAssessment(assessment(), context)).toThrow('already has a saved plan');
  });
  it('does not relabel an invented phrase or case variant as an observed query', () => {
    const result = assessment(); result.ideas[0].searchFocus.phrase = 'Roof Inspection South Bend';
    expect(() => validateNewPageAssessment(result, bundle())).toThrow();
    result.ideas[0].searchFocus.source = 'proposed';
    expect(validateNewPageAssessment(result, bundle()).ideas[0].searchFocus.source).toBe('proposed');
  });
  it('requires confirmed service, actual checked URLs and first-party evidence for new pages', () => {
    for (const update of [{ service: 'Emergency roof rescue' }, { checkedPageUrls: [] }, { checkedPageUrls: ['https://example.test/invented'] }, { evidenceIds: ['W1'] }, { evidenceIds: ['P999'] }, { distinctValue: 'More SEO.' }]) {
      const result = assessment(); Object.assign(result.ideas[0], update);
      expect(() => validateNewPageAssessment(result, bundle()), JSON.stringify(update)).toThrow();
    }
  });
  it('rejects duplicate topics, malformed outcome combinations and fabricated demand promises', () => {
    const duplicate = assessment(); duplicate.ideas.push(idea());
    expect(() => validateNewPageAssessment(duplicate, bundle())).toThrow();
    for (const outcome of ['no_opportunity', 'needs_information', 'improve_existing']) expect(() => validateNewPageAssessment({ ...assessment(), outcome }, bundle())).toThrow();
    const fakeDemand = assessment(); fakeDemand.ideas[0].reason = 'This keyword has 1000 monthly searches.';
    expect(() => validateNewPageAssessment(fakeDemand, bundle())).toThrow();
    expect(() => validateNewPageAssessment({ ...assessment(), summary: 'This will improve rankings.' }, bundle())).toThrow();
  });
  it('permits narrow negative evidence disclaimers while still rejecting any numeric demand claim', () => {
    const result = assessment();
    result.ideas[0].reason = 'The supplied query shows observations for this topic, without establishing search volume.';
    expect(validateNewPageAssessment(result, bundle()).outcome).toBe('new_page');
    result.summary = 'This observed phrase does not establish keyword difficulty.';
    expect(validateNewPageAssessment(result, bundle()).outcome).toBe('new_page');
    result.ideas[0].reason += ' There are 1000 monthly searches.';
    expect(() => validateNewPageAssessment(result, bundle())).toThrow();
    result.ideas[0].reason = 'This has strong search volume.';
    expect(() => validateNewPageAssessment(result, bundle())).toThrow();
  });
  it.each(['Expected 300 additional visitors.', 'This page is indexed by Google.', 'This page is not indexed.', 'Google currently ranks this page at position 12.', 'This should bring 50 inquiries.'])('rejects invented performance or indexing assertions: %s', summary => {
    expect(() => validateNewPageAssessment({ ...assessment(), summary }, bundle())).toThrow();
  });
  it('allows honest indexing uncertainty without claiming a Google inspection occurred', () => {
    expect(validateNewPageAssessment({ ...assessment(), summary: 'This website review does not establish whether the page is indexed.' }, bundle()).outcome).toBe('new_page');
    expect(validateNewPageAssessment({ ...assessment(), summary: 'This review does not establish indexing status.' }, bundle()).outcome).toBe('new_page');
  });
});

describe('draft provenance and manual edits', () => {
  it('accepts a draft with exact first-party source quotes and known links', () => {
    expect(validateNewPageDraft(draft(), bundle())).toEqual(draft());
  });
  it.each(['source', 'quote', 'credential', 'number', 'placeholder', 'link'])('rejects unsupported draft %s', kind => {
    const result = draft();
    if (kind === 'source') result.claims[0].sourceId = 'W1';
    if (kind === 'quote') result.claims[0].quote = 'Invented statement that never appeared.';
    if (kind === 'credential') result.sections[0].body += ' Our certified team is fully insured.';
    if (kind === 'number') result.sections[0].body += ' Every inspection costs $149.';
    if (kind === 'placeholder') result.sections[0].body += ' Call [INSERT PHONE NUMBER].';
    if (kind === 'link') result.links[0].url = 'https://elsewhere.test/';
    expect(() => validateNewPageDraft(result, bundle())).toThrow();
  });
  it('blocks duplicate existing or saved slugs while allowing the current plan’s own slug', () => {
    const result = draft(); result.slug = '/services/roof-replacement/';
    expect(() => validateNewPageDraft(result, bundle())).toThrow('already exists');
    result.slug = '/services/roof-inspection';
    const context = bundle(); context.priorPlans = [{ id: 'existing', draft: { slug: result.slug + '/' } }];
    expect(() => validateNewPageDraft(result, context)).toThrow('Another plan');
    context.planId = 'existing';
    expect(validateNewPageDraft(result, context).slug).toBe(result.slug);
  });
  it.each(['https://example.test/page', '/page?q=1', '/page#part', '/New-Page', '/../../escape'])('rejects unsafe or unsupported slug %s', slug => {
    expect(() => validateNewPageDraft({ ...draft(), slug }, bundle())).toThrow();
  });
  it('preserves owner edits exactly without presenting them as generated verified claims', () => {
    const result = draft(); result.sections[0].body = 'My own wording, with deliberate spacing.  Keep it.';
    const saved = validateOwnerDraft(result);
    expect(saved.sections[0].body).toBe(result.sections[0].body);
    expect(saved).not.toHaveProperty('claims'); expect(saved).not.toHaveProperty('optionalPrompts');
    result.sections.push({ ...result.sections[0] });
    expect(() => validateOwnerDraft(result)).toThrow();
  });
});

describe('research boundaries and generation requests', () => {
  it('keeps private owner facts, query rows, metrics and identifiers out of the web-search payload', () => {
    const request = newPageResearchRequest({ businessName: 'Example', websiteUrl: homepage,
      context: { area: 'South Bend, Indiana', services: ['Roof inspection'], ownerFacts: 'PRIVATE_NOTE', userId: 'PRIVATE_UID' },
      queries: [{ query: 'PRIVATE_QUERY', clicks: 555 }], pages: [{ url: homepage, title: 'Roofing services', text: 'Public business description', private: 'PRIVATE_TOKEN' }] });
    expect(request).toMatchObject({ model: 'gpt-6.1-sol', store: false, max_tool_calls: 2, tool_choice: 'required' });
    expect(JSON.stringify(request)).not.toMatch(/PRIVATE_|555/);
    expect(request.input[1].content).toContain('South Bend');
  });
  it('requires cited actual source URLs for nearby suggestions without confirming service availability', () => {
    const response = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ areas: [{ name: 'Mishawaka', region: 'Indiana', country: 'United States', reason: 'A nearby municipality to consider if served.', sourceUrl: 'https://mishawaka.in.gov/' }] }) }] }] };
    expect(parseNearbyAreas(response, { sources: [{ url: 'https://mishawaka.in.gov/' }] })).toHaveLength(1);
    expect(() => parseNearbyAreas(response, { sources: [] })).toThrow();
  });
  it('uses strict structured output and treats all supplied evidence as untrusted data', () => {
    const request = newPageStructuredRequest(NEW_PAGE_ASSESSMENT_INSTRUCTIONS, bundle(), NEW_PAGE_ASSESSMENT_SCHEMA, 'new_page_assessment');
    expect(request).toMatchObject({ store: false, model: 'gpt-6.1-sol', text: { format: { type: 'json_schema', strict: true } } });
    expect(request.input[0].content).toContain('untrusted DATA');
    expect(NEW_PAGE_DRAFT_INSTRUCTIONS).toContain('owner publishes');
    expect(NEW_PAGE_DRAFT_INSTRUCTIONS).toContain('Public W sources');
  });
});

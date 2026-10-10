import { describe, expect, it } from 'vitest';
import { buildResearchRequest, buildReviewRequest, REVIEW_SCHEMA, STRATEGY_AREAS, validatePageAssessment } from '../app/lib/pageReviewPolicy';

const page = {
  url: 'https://example.com/products/mug', htmlTitle: 'Blue ceramic mug',
  seoMetaDescription: 'A blue ceramic mug made in our pottery studio.', h1: 'Our latest creation',
  textContent: 'Our blue ceramic mug is handmade in our pottery studio. It holds 300 ml and is dishwasher safe.',
  mainContent: 'Our blue ceramic mug is handmade in our pottery studio. It holds 300 ml and is dishwasher safe.',
  headings: [{ tag: 'h1', text: 'Our latest creation', screenReaderOnly: true, ariaHidden: false }],
  internalLinks: [{ url: 'https://example.com/care', text: 'Care instructions' }],
  technical: { noindex: { generic: false, googlebot: false }, robotsMeta: [] },
};
const evidence = { facts: ['P1', 'P2', 'P3', 'S1'].map(id => ({ id })), relatedPages: [], current: { queries: [] }, previous: { queries: [] } };
const diagnostics = { facts: ['I1', 'P4', 'P5', 'P6', 'D1'].map(id => ({ id, text: 'Supplied diagnostic fact.' })), inspection: { status: 'available', verdict: 'PASS' }, relatedPages: [] };
const context = { currentPage: page, evidence, diagnostics, research: { status: 'unavailable', sources: [] }, requireStrategy: true };
const recommendation = () => ({ type: 'heading', basis: 'opportunity', significance: 'primary', benefit: 'page_clarity',
  label: 'Name the product in the heading', location: 'Main product heading', reason: 'The supplied heading does not identify the product.',
  instruction: 'Check the rendered product heading and try the clearer product name if it is generic.',
  currentQuote: page.h1, proposedText: 'Handmade blue ceramic mug', supportingQuote: 'Our blue ceramic mug is handmade in our pottery studio.', targetUrl: null, evidenceIds: ['P3', 'P5'] });
const strategy = () => ({
  searchGoal: 'Help shoppers looking for a handmade ceramic mug assess this product.', focusArea: 'headings', finding: 'opportunity_to_test',
  priorityReason: 'Naming the product in the main heading offers more immediate clarity than adding another care link.',
  limitation: 'Source markup does not establish the rendered appearance or why the page ranks where it does.',
  checks: [
    { area: 'indexing', status: 'suitable', finding: 'Google reports the selected page as indexed.', evidenceIds: ['I1'] },
    { area: 'search_intent', status: 'unknown', finding: 'There are no reported search phrases to evaluate the visitor intent.', evidenceIds: [] },
    { area: 'content', status: 'suitable', finding: 'The page describes the mug, its size and care.', evidenceIds: ['P3'] },
    { area: 'headings', status: 'opportunity', finding: 'The supplied heading is generic; verify its display before testing the product name.', evidenceIds: ['P3', 'P5'] },
    { area: 'metadata', status: 'suitable', finding: 'The title and description name the product accurately.', evidenceIds: ['P1', 'P2'] },
    { area: 'internal_links', status: 'suitable', finding: 'A care instructions link is already supplied.', evidenceIds: ['P6'] },
  ],
});
const review = () => ({ action: 'improve_content', metadataVerdict: 'keep', metadataReason: 'The tags describe the product accurately.',
  summary: 'Test a clearer product heading', reason: 'Product clarity is the strongest opportunity supported by the supplied page.', nextStep: 'Review the product heading on your website.',
  evidenceIds: ['P1', 'P3', 'P5'], title: null, description: null, fieldReasons: { title: '', description: '' }, supportingQuotes: { title: '', description: '' }, targetPageUrl: null,
  pageGoal: 'Help shoppers decide whether the ceramic mug suits them.', strategy: strategy(), recommendations: [recommendation()] });
const validate = (data, overrides = {}) => validatePageAssessment(JSON.stringify(data), { ...context, ...overrides });
const supportingLink = () => ({ ...recommendation(), type: 'internal_link', significance: 'supporting', benefit: 'navigation',
  label: 'Add a contextual care link', location: 'Mug care paragraph', currentQuote: 'Care instructions',
  reason: 'This small navigation improvement may make care details easier to reach; it does not explain search performance.',
  instruction: 'Optionally add a care link beside the care description.',
  proposedText: 'Care instructions', supportingQuote: 'Care instructions', targetUrl: page.internalLinks[0].url, evidenceIds: ['P6'] });
const limited = () => ({ ...review(), strategy: { ...strategy(), finding: 'limited_findings', focusArea: 'none',
  priorityReason: 'Only an optional navigation improvement is supported; a main search growth opportunity is not established.',
  checks: strategy().checks.map(check => check.area === 'headings' ? { ...check, status: 'suitable', finding: 'The supplied heading is acceptable in the product context.' } : check),
}, recommendations: [supportingLink()] });
const uncertain = () => ({ ...review(), action: 'collect_data', strategy: { ...strategy(), finding: 'insufficient_evidence', focusArea: 'search_intent',
  priorityReason: 'The page purpose is clear, but the desired discovery audience needs owner clarification.',
}, recommendations: [{ ...recommendation(), type: 'check', basis: 'needs_check', benefit: 'diagnosis',
  label: 'Clarify the intended shopper', location: 'Product review notes', reason: 'The intended shopper affects which questions the page should answer.',
  instruction: 'Identify the main shopper question this product page should answer.', currentQuote: '', proposedText: null, supportingQuote: '' }] });

describe('v5 opportunity prioritization contract', () => {
  it('requires strategy in the current strict schema and enforces it without depending on requirePlan', () => {
    expect(REVIEW_SCHEMA.required).toContain('strategy');
    expect(REVIEW_SCHEMA.properties.strategy.required).toEqual(['searchGoal', 'focusArea', 'finding', 'priorityReason', 'limitation', 'checks']);
    expect(REVIEW_SCHEMA.properties.recommendations.items.required).toEqual(expect.arrayContaining(['significance', 'benefit']));
    const data = review(); delete data.strategy;
    expect(() => validate(data, { requirePlan: false })).toThrow();
    const legacy = validate(data, { requireStrategy: false });
    expect(legacy.analysis.strategy).toBeUndefined();
    expect(legacy.analysis.recommendations[0].significance).toBeUndefined();
    expect(() => validate({ ...review(), strategy: null }, { requireStrategy: false })).toThrow();
    expect(() => validate({ ...review(), strategy: {} }, { requireStrategy: false })).toThrow();
  });

  it('accepts a grounded nonlocal product opportunity while preserving metadata and source-only uncertainty', () => {
    const result = validate(review());
    expect(result.analysis).toMatchObject({ metadataVerdict: 'keep', strategy: { focusArea: 'headings', finding: 'opportunity_to_test' },
      recommendations: [{ significance: 'primary', benefit: 'page_clarity', basis: 'opportunity' }] });
    expect(result.title).toBeNull();
    expect(result.analysis.recommendations[0].instruction).toContain('Check the rendered');
  });

  it('normalizes six checks to a stable server order and deduplicates source IDs', () => {
    const data = review(); data.strategy.checks.reverse(); data.strategy.checks[0].evidenceIds = ['P6', 'P6'];
    const result = validate(data);
    expect(result.analysis.strategy.checks.map(check => check.area)).toEqual(STRATEGY_AREAS);
    expect(result.analysis.strategy.checks.at(-1).evidenceIds).toEqual(['P6']);
  });

  it('rejects missing, duplicate, excessive, unknown or malformed checks', () => {
    for (const checks of [undefined, [], strategy().checks.slice(0, 5), [...strategy().checks, strategy().checks[0]],
      strategy().checks.map((check, index) => index === 1 ? strategy().checks[0] : check),
      strategy().checks.map((check, index) => index === 1 ? { ...check, area: 'backlinks' } : check),
      strategy().checks.map((check, index) => index === 1 ? null : check),
    ]) expect(() => validate({ ...review(), strategy: { ...strategy(), checks } })).toThrow();
  });

  it('requires actual sources for findings while allowing honestly unknown areas to lack evidence', () => {
    for (const change of [{ status: 'excellent' }, { status: 'suitable', evidenceIds: [] }, { evidenceIds: ['P99'] },
      { evidenceIds: ['W1'] }, { evidenceIds: ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'] }, { evidenceIds: null }]) {
      const data = review(); data.strategy.checks[1] = { ...data.strategy.checks[1], ...change };
      expect(() => validate(data)).toThrow();
    }
    const data = review(); data.strategy.checks[1] = { ...data.strategy.checks[1], status: 'opportunity', evidenceIds: ['W1', 'P3'] };
    expect(validate(data, { research: { status: 'available', sources: [{ id: 'W1' }] } }).analysis.strategy.checks[1].evidenceIds).toEqual(['W1', 'P3']);
    expect(() => validate(data, { research: { status: 'unavailable', sources: [{ id: 'W1' }] } })).toThrow();
  });

  it.each([['searchGoal', 220], ['priorityReason', 400], ['limitation', 320]])('bounds and validates plain-language %s', (field, max) => {
    for (const value of [undefined, '', ' ', 'x'.repeat(max + 1), '<b>Change this</b>', 'See https://other.example.com', 'First\nSecond', 'This will improve rankings.', 'Your page received 400 clicks.']) {
      expect(() => validate({ ...review(), strategy: { ...strategy(), [field]: value } })).toThrow();
    }
  });

  it('rejects fabricated numeric results and promises inside individual findings', () => {
    for (const finding of ['', 'x'.repeat(261), 'This will improve rankings.', 'Your page has 400 impressions.', '<b>Unsafe</b>']) {
      const data = review(); data.strategy.checks[2].finding = finding;
      expect(() => validate(data)).toThrow();
    }
  });

  it('requires an exact focus and matching primary basis for a substantive opportunity', () => {
    for (const changes of [{ focusArea: 'none' }, { focusArea: 'content' }, { focusArea: 'backlinks' }, { finding: 'proven_rank_cause' }]) {
      expect(() => validate({ ...review(), strategy: { ...strategy(), ...changes } })).toThrow();
    }
    for (const basis of ['observed_issue', 'needs_check']) {
      expect(() => validate({ ...review(), recommendations: [{ ...recommendation(), basis, proposedText: null, supportingQuote: '' }] })).toThrow();
    }
    expect(() => validate({ ...review(), recommendations: [{ ...recommendation(), significance: 'supporting' }] })).toThrow();
  });

  it('requires exactly one first primary and recognized significance and benefit fields', () => {
    expect(validate({ ...review(), recommendations: [recommendation(), supportingLink()] }).analysis.recommendations).toHaveLength(2);
    expect(() => validate({ ...review(), recommendations: [supportingLink(), recommendation()] })).toThrow();
    expect(() => validate({ ...review(), recommendations: [recommendation(), { ...supportingLink(), significance: 'primary' }] })).toThrow();
    for (const change of [{ significance: undefined }, { significance: 'urgent' }, { benefit: undefined }, { benefit: 'ranking_boost' }]) {
      expect(() => validate({ ...review(), recommendations: [{ ...recommendation(), ...change }] })).toThrow();
    }
  });

  it('represents a minor navigation improvement as supporting and leaves the main cause unidentified', () => {
    const result = validate(limited());
    expect(result.analysis.strategy.finding).toBe('limited_findings');
    expect(result.analysis.strategy.focusArea).toBe('none');
    expect(result.analysis.recommendations[0]).toMatchObject({ significance: 'supporting', benefit: 'navigation' });
    expect(() => validate({ ...limited(), recommendations: [{ ...supportingLink(), significance: 'primary' }] })).toThrow();
    expect(() => validate({ ...limited(), strategy: { ...limited().strategy, focusArea: 'internal_links' } })).toThrow();
  });

  it('allows no suggested changes when only limited findings or missing evidence remain', () => {
    expect(validate({ ...limited(), action: 'keep_current', recommendations: [] }).analysis.recommendations).toEqual([]);
    expect(validate({ ...uncertain(), recommendations: [] }).analysis.recommendations).toEqual([]);
    expect(() => validate({ ...limited(), recommendations: [] })).toThrow();
    expect(() => validate({ ...review(), action: 'keep_current', recommendations: [] })).toThrow();
  });

  it('allows a specific main check for insufficient evidence but not an invented primary fix', () => {
    expect(validate(uncertain()).analysis.recommendations[0]).toMatchObject({ type: 'check', significance: 'primary', basis: 'needs_check', benefit: 'diagnosis', proposedText: null });
    expect(validate({ ...uncertain(), strategy: { ...uncertain().strategy, focusArea: 'none' } }).analysis.strategy.focusArea).toBe('none');
    expect(() => validate({ ...uncertain(), strategy: { ...uncertain().strategy, focusArea: 'content' } })).toThrow();
    for (const change of [{ type: 'content' }, { benefit: 'visitor_decision' }, { basis: 'opportunity' }, { proposedText: 'Invented customer proof' }]) {
      expect(() => validate({ ...uncertain(), recommendations: [{ ...uncertain().recommendations[0], ...change }] })).toThrow();
    }
  });

  it('preserves technical grounding when an indexing issue appears in the strategy itself', () => {
    const data = review();
    data.strategy = { ...strategy(), focusArea: 'indexing', finding: 'supported_issue',
      checks: strategy().checks.map(check => check.area === 'indexing' ? { ...check, status: 'issue', finding: 'The current page contains a noindex directive.', evidenceIds: ['P4'] } : check) };
    data.recommendations = [{ ...recommendation(), type: 'technical', basis: 'observed_issue', benefit: 'index_access', label: 'Remove unintended noindex',
      reason: 'The current directive excludes the page from indexing.', instruction: 'Remove noindex if this product page should appear in search.',
      currentQuote: 'noindex, follow', proposedText: null, supportingQuote: '', evidenceIds: ['P4'] }];
    data.action = 'investigate_visibility'; data.evidenceIds = ['P4'];
    expect(() => validate(data)).toThrow();
    const noindexPage = { ...page, technical: { noindex: { generic: true }, robotsMeta: [{ content: 'noindex, follow' }] } };
    expect(validate(data, { currentPage: noindexPage }).analysis.strategy.finding).toBe('supported_issue');
    const falseChecklist = review(); falseChecklist.strategy.checks[0] = data.strategy.checks[0];
    expect(() => validate(falseChecklist)).toThrow();
    falseChecklist.strategy.checks[0] = { ...data.strategy.checks[0], finding: 'A Google penalty blocks this page.' };
    expect(() => validate(falseChecklist)).toThrow();
  });

  it('requires both an observed primary basis and an issue check for a supported issue', () => {
    const data = review(); data.strategy.finding = 'supported_issue';
    expect(() => validate(data)).toThrow();
    data.strategy.checks[3].status = 'issue';
    expect(() => validate(data)).toThrow();
    data.recommendations[0].basis = 'observed_issue';
    expect(validate(data).analysis.strategy.finding).toBe('supported_issue');
  });
});

describe('v5 public research context and prioritization instructions', () => {
  it('sends bounded public main content and headings, without private inputs or arbitrary object fields', () => {
    const input = { ...page, mainContent: 'Public main content. '.repeat(300), textContent: 'Menu text only',
      headings: Array.from({ length: 12 }, (_, i) => ({ text: `${i}${'h'.repeat(400)}`, privateLabel: 'PRIVATE' })),
      ownerGoal: 'PRIVATE_OWNER_GOAL', evidence: { queries: ['PRIVATE_QUERY'] }, userId: 'PRIVATE_UID' };
    const request = buildResearchRequest(input); const data = JSON.parse(request.input[1].content);
    expect(Object.keys(data).sort()).toEqual(['heading', 'headings', 'pageUrl', 'publicPageExcerpt', 'title']);
    expect(data.publicPageExcerpt).toHaveLength(3500); expect(data.publicPageExcerpt).toContain('Public main content');
    expect(data.headings).toHaveLength(8); expect(data.headings.every(heading => heading.length === 300)).toBe(true);
    expect(JSON.stringify(request)).not.toContain('PRIVATE');
    expect(request).toMatchObject({ store: false, reasoning: { effort: 'low' }, max_output_tokens: 1800, max_tool_calls: 2, tool_choice: 'required' });
    expect(request.input[0].content).toContain('already answers those questions');
  });

  it('falls back to public body content and accepts the structured main content shape', () => {
    expect(JSON.parse(buildResearchRequest({ ...page, mainContent: undefined }).input[1].content).publicPageExcerpt).toBe(page.textContent);
    expect(JSON.parse(buildResearchRequest({ ...page, mainContent: '   ' }).input[1].content).publicPageExcerpt).toBe(page.textContent);
    expect(JSON.parse(buildResearchRequest({ ...page, mainContent: { text: 'Public product specifications.' } }).input[1].content).publicPageExcerpt).toBe('Public product specifications.');
    expect(JSON.parse(buildResearchRequest({ ...page, headings: undefined }).input[1].content).headings).toEqual([]);
  });

  it('removes ease-based ranking and requires scoped substantive assessment instead', () => {
    const request = buildReviewRequest({ currentPage: page, evidence, diagnostics, research: context.research });
    const instructions = request.input[0].content;
    expect(instructions).not.toContain('Choose the smallest useful action');
    expect(instructions).toContain('Ease of editing does not establish priority');
    expect(instructions).toContain('may help the destination more than the selected page');
    expect(instructions).toContain('sr-only and aria-hidden do not prove rendered visibility');
    expect(instructions).toContain('A supported issue or opportunity is not proof of a ranking cause');
  });
});

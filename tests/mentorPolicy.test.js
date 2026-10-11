import { describe, it, expect } from 'vitest';
import { validateMentorAnswer, estimatedMentorCost, mentorInputBound, MENTOR_LIMITS } from '../app/lib/mentorPolicy';
import { approvedGoogleDocumentationUrl, GOOGLE_GUIDANCE_TOOL } from '../app/lib/mentorDocumentationPolicy';

const refs = { sources: [{ id: 'g1', url: 'https://support.google.com/webmasters/answer/7440203' }],
  metricCards: [{ id: 'm1', clicks: 6 }], actions: [{ id: 'a1', href: '/low-ctr?page=homepage' }] };
const answer = { answer: 'Check the recorded indexing reason before concluding there is a penalty.', sourceIds: ['g1'], metricIds: ['m1'], actionIds: ['a1'] };
describe('mentor answer and documentation boundaries', () => {
  it('renders only supplied server facts, sources and actions', () => {
    expect(validateMentorAnswer(JSON.stringify(answer), refs)).toEqual({ answer: answer.answer, sources: refs.sources, metricCards: refs.metricCards, actions: refs.actions });
  });
  it.each(['sourceIds', 'metricIds', 'actionIds'])('rejects fabricated %s', key => {
    expect(() => validateMentorAnswer({ ...answer, [key]: ['invented'] }, refs)).toThrow();
  });
  it.each(['https://evil.test', '[click](javascript:alert(1))', '<script>alert(1)</script>', '![private](url)'])('rejects unverified outbound content %s', text => {
    expect(() => validateMentorAnswer({ ...answer, answer: text }, refs)).toThrow();
  });
  it('allows educational replies without account metrics or forced actions', () => {
    expect(validateMentorAnswer({ answer: 'An impression means a search appearance.', sourceIds: [], metricIds: [], actionIds: [] })).toMatchObject({ metricCards: [], actions: [] });
  });
  it.each(['http://developers.google.com/search/docs/test', 'https://developers.google.com.evil.test/search/docs/test',
    'https://support.google.com/accounts/answer/123', 'https://developers.google.com/maps/documentation', 'https://user@support.google.com/webmasters/answer/1',
    'https://support.google.com:444/webmasters/answer/1'])('rejects non-approved documentation %s', url => expect(approvedGoogleDocumentationUrl(url)).toBeNull());
  it('accepts only actual official documentation paths', () => {
    expect(approvedGoogleDocumentationUrl('https://developers.google.com/search/docs/essentials/spam-policies#doorway')).toBe('https://developers.google.com/search/docs/essentials/spam-policies');
    expect(approvedGoogleDocumentationUrl('https://support.google.com/business/answer/7091?hl=en')).toContain('/business/answer/7091');
    expect(GOOGLE_GUIDANCE_TOOL.parameters.additionalProperties).toBe(false);
  });
  it('has bounded allowances and no custom keyword or forced-edit rule', () => {
    expect(MENTOR_LIMITS).toMatchObject({ mainCalls: 3, inputTokens: 24000, outputTokens: 6000, monthlyUsd: 25 });
    expect(mentorInputBound({ text: '你好' })).toBeGreaterThan(2);
    expect(estimatedMentorCost({ inputTokens: 1000000, outputTokens: 1000000, searches: 2 })).toBe(12.02);
    expect(estimatedMentorCost({ inputTokens: 1000000, cacheWriteTokens: 1000000 })).toBe(2.5);
  });
});

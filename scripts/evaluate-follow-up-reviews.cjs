// Explicit --live only: at most sixteen sequential requests, no retries,
// production accounts, Google reads, website changes, or public research calls.
// --replay FILE revalidates saved outputs entirely offline and never rewrites
// their original pass/fail record or loads credentials/the OpenAI client.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { fixtures } = require('../tests/fixtures/follow-up-reviews.cjs');

async function loadPolicy() {
  const reviewSource = fs.readFileSync(path.join(__dirname, '../app/lib/pageReviewPolicy.js'), 'utf8');
  const reviewUrl = `data:text/javascript;base64,${Buffer.from(reviewSource).toString('base64')}`;
  const source = fs.readFileSync(path.join(__dirname, '../app/lib/followUpReviewPolicy.js'), 'utf8')
    .replace("'./pageReviewPolicy'", JSON.stringify(reviewUrl));
  const policy = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const review = await import(reviewUrl);
  return { ...policy, responseText: review.responseText, model: review.PAGE_REVIEW_MODEL };
}

function validateFixtureOutcome(fixture, raw, decision) {
  assert(fixture.expected.includes(decision.outcome), 'Outcome does not match the reviewed fixture rubric.');
  if (decision.outcome !== 'improve_page' || fixture.opportunityGuard !== 'owner_confirmed_service_detail_only') return;
  const assessment = raw.assessment, page = fixture.context.currentPage;
  assert(assessment.action === 'improve_content' && assessment.metadataVerdict === 'keep'
    && assessment.title === null && assessment.description === null, 'The confirmed metadata must remain unchanged.');
  assert(fixture.context.cycle.confirmation.description === page.seoMetaDescription, 'This fixture must retain its confirmed description.');
  const tasks = assessment.recommendations;
  assert(Array.isArray(tasks) && tasks.length > 0 && tasks.every(task => task.type === 'content'
    && task.basis === 'opportunity' && task.benefit === 'visitor_decision' && task.proposedText === null),
  'Only a substantive service-detail content opportunity is allowed.');
  const passages = [page.textContent, page.mainContent, ...(page.contentSections || []).map(section => section.text)].filter(value => typeof value === 'string');
  assert(tasks.every(task => typeof task.currentQuote === 'string' && task.currentQuote.trim().length >= 8
    && passages.some(text => text.includes(task.currentQuote.trim()))
    && /\b(?:actual|real|confirm(?:ed)?)\b/i.test(task.instruction)),
  'Each opportunity must quote existing service evidence and require actual owner facts.');
}

async function replay(file) {
  const originalBytes = fs.readFileSync(file), artifact = JSON.parse(originalBytes);
  assert(Array.isArray(artifact.results) && artifact.results.length > 0 && artifact.results.length <= 16, 'Use a bounded saved evaluation report.');
  const policy = await loadPolicy(), seen = new Set(), results = [];
  for (const saved of artifact.results) {
    const fixture = fixtures.find(item => item.name === saved.case);
    assert(fixture && [1, 2].includes(saved.repeat), 'Unknown saved fixture or repeat.');
    const key = `${saved.case}:${saved.repeat}`; assert(!seen.has(key), 'Duplicate saved fixture repeat.'); seen.add(key);
    let pass = false;
    try {
      const decision = policy.validateFollowUpDecision(saved.raw, fixture.context);
      validateFixtureOutcome(fixture, saved.raw, decision); pass = true;
    } catch { /* Keep failed provider responses or unsupported recommendations failed. */ }
    results.push({ case: saved.case, repeat: saved.repeat, originalPass: saved.pass === true, replayPass: pass, outcome: saved.raw?.outcome || null });
  }
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  assert.equal(sha256(fs.readFileSync(file)), sha256(originalBytes), 'The original report must remain unchanged.');
  return { mode: 'offline_replay', sourceReportSha256: sha256(originalBytes), originalPassed: artifact.results.filter(item => item.pass).length,
    originalFailed: artifact.results.filter(item => !item.pass).length, replayed: results.length,
    passed: results.filter(item => item.replayPass).length, failed: results.filter(item => !item.replayPass).length,
    paidCallsMade: 0, credentialsLoaded: false, researchCalls: 0, productionWrites: 0, originalReportUnchanged: true,
    results, limitation: 'The original evaluation record is preserved. This replays the existing responses against the final policy and narrowly adjudicated fixture criteria; it is not a new model run or proof of SEO improvement.' };
}

async function main() {
  const [mode, caseFlag, caseName, ...extra] = process.argv.slice(2);
  if (mode === '--replay') {
    assert(caseFlag && !caseName && !extra.length, 'Use --replay FILE.');
    const result = await replay(caseFlag); console.log(JSON.stringify(result, null, 2));
    if (result.failed) process.exitCode = 1;
    return;
  }
  if (!['--list', '--live'].includes(mode) || extra.length || (caseFlag && (caseFlag !== '--case' || !caseName))) {
    throw new Error('Use --list or --live, optionally --case EXACT_CASE_NAME; or --replay FILE.');
  }
  const selected = caseName ? fixtures.filter(item => item.name === caseName) : fixtures;
  assert(selected.length > 0 && selected.length <= 8, 'Choose an existing fixture.');
  const maxRequests = selected.length * 2;
  for (const item of selected) {
    assert(item.expected.length && item.rubric && item.context.cycle.confirmation.tasks.length);
    assert(item.context.cycle.latestCheckpoint.source === 'google_search_console');
    assert.equal(item.context.cycle.latestCheckpoint.windows.post.endDate, item.context.evidence.window.endDate);
    assert.equal(item.context.cycle.latestCheckpoint.windows.baseline.startDate, item.context.evidence.previousWindow.startDate);
  }
  if (mode === '--list') {
    console.log(JSON.stringify({ paidCallsMade: 0, fixtures: selected.map(item => ({ name: item.name, expected: item.expected, rubric: item.rubric })),
      repeats: 2, maxRequests, automaticRetries: 0, researchCalls: 0, productionWrites: 0,
      limitation: 'Synthetic tests check grounded recommendations and no-edit outcomes, not ranking improvement. Human review of saved outputs is still required.' }, null, 2));
    return;
  }
  require('dotenv').config({ path: '.env.local', quiet: true });
  if (!process.env.OPENAI_API_KEY || process.env.SIMPLESEO_TEST_MODE === '1') throw new Error('Evaluation credentials are unavailable.');
  const policy = await loadPolicy(), OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 90000 });
  const results = [], usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0, unreportedRequests: 0 };
  let requests = 0, failed = 0;
  for (const fixture of selected) for (let repeat = 1; repeat <= 2; repeat++) {
    assert(++requests <= maxRequests && requests <= 16);
    const start = Date.now(); let completion, raw;
    try {
      completion = await client.responses.create(policy.buildFollowUpRequest(fixture.context));
      if (completion.usage) {
        usage.inputTokens += Number(completion.usage.input_tokens) || 0;
        usage.outputTokens += Number(completion.usage.output_tokens) || 0;
        usage.totalTokens += Number(completion.usage.total_tokens) || 0;
      } else usage.unreportedRequests++;
      raw = JSON.parse(policy.responseText(completion));
      const decision = policy.validateFollowUpDecision(raw, fixture.context);
      validateFixtureOutcome(fixture, raw, decision);
      const result = { case: fixture.name, repeat, pass: true, outcome: decision.outcome,
        elapsedMs: Date.now() - start, model: completion.model, usage: completion.usage || null, raw, rubric: fixture.rubric };
      results.push(result);
      console.log(JSON.stringify({ case: fixture.name, repeat, pass: true, outcome: decision.outcome, usage: completion.usage || null }));
    } catch (error) {
      failed++;
      if (!completion) usage.unreportedRequests++;
      results.push({ case: fixture.name, repeat, pass: false, elapsedMs: Date.now() - start,
        outcome: raw?.outcome || null, raw: raw || null, rubric: fixture.rubric, usage: completion?.usage || null,
        failureStage: completion ? 'validation' : 'provider', status: Number.isInteger(error.status) ? error.status : null });
      console.log(JSON.stringify({ case: fixture.name, repeat, pass: false, outcome: raw?.outcome || null,
        failureStage: completion ? 'validation' : 'provider', usage: completion?.usage || null }));
    }
  }
  const directory = path.join(__dirname, '../tmp'); fs.mkdirSync(directory, { recursive: true });
  const artifact = path.join(directory, `follow-up-evaluation-${new Date().toISOString().replaceAll(/[:.]/g, '-')}.json`);
  const summary = { completedAt: new Date().toISOString(), requests, maxRequests, failed, passed: requests - failed,
    model: policy.model, usage, syntheticInputs: true, researchCalls: 0, websiteReads: 0, googleReads: 0,
    productionWrites: 0, websiteWrites: 0, automaticRetries: 0,
    limitation: 'These synthetic assessments require human review of usefulness and factual entailment. No SEO result is proven. Provider usage is not a final dollar bill, and unknown usage is not zero.' };
  fs.writeFileSync(artifact, JSON.stringify({ summary, results }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ ...summary, artifact }));
  if (failed) process.exitCode = 1;
}

module.exports = { loadPolicy, fixtures, validateFixtureOutcome, replay };
if (require.main === module) main().catch(() => { console.error('Follow-up evaluation did not complete. Credentials and provider details are omitted.'); process.exitCode = 1; });

// Explicit --live only; sixteen requests maximum, no retries or production writes.
// --list and --replay load no credentials and make no provider calls.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixtures } = require('../tests/fixtures/onboarding-extraction.cjs');
async function loadPolicy() {
  const base = fs.readFileSync(path.join(__dirname, '../app/lib/pageReviewPolicy.js'), 'utf8');
  const baseUrl = `data:text/javascript;base64,${Buffer.from(base).toString('base64')}`;
  const source = fs.readFileSync(path.join(__dirname, '../app/lib/onboardingExtractionPolicy.js'), 'utf8').replace("'./pageReviewPolicy'", JSON.stringify(baseUrl));
  return { ...await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`), ...await import(baseUrl) };
}
function rubric(fixture, facts) {
  const lower = value => String(value || '').toLowerCase();
  assert.equal(facts.businessName?.value || null, fixture.nameValue);
  if (fixture.typeValue) assert.equal(lower(facts.businessType?.value), fixture.typeValue);
  else assert.equal(facts.businessType, null);
  if (fixture.service) assert(facts.services.some(item => (fixture.allowedServices || [fixture.service]).includes(lower(item.value)))); else assert.equal(facts.services.length, 0);
  if (fixture.location) assert(facts.locations.some(item => (fixture.allowedLocations || [fixture.location]).includes(item.value))); else assert.equal(facts.locations.length, 0);
  const values = JSON.stringify({ businessName: facts.businessName?.value, businessType: facts.businessType?.value,
    services: facts.services.map(item => item.value), locations: facts.locations.map(item => item.value), faqs: facts.faqs });
  for (const prohibited of fixture.prohibited) assert(!lower(values).includes(lower(prohibited)), 'An unsupported business claim was extracted.');
}
async function main() {
  const [mode, argument, caseName, ...extra] = process.argv.slice(2);
  assert(['--list', '--live', '--replay'].includes(mode) && !extra.length
    && (mode === '--replay' ? !!argument && !caseName : !argument || (argument === '--case' && !!caseName)), 'Use --list, --live [--case NAME] or --replay FILE.');
  const selected = caseName ? fixtures.filter(item => item.name === caseName) : fixtures;
  assert(selected.length > 0, 'Choose an existing fixture.');
  if (mode === '--list') { console.log(JSON.stringify({ fixtures: selected.map(({ name, prohibited }) => ({ name, prohibited })), maxRequests: selected.length * 2,
    retries: 0, productionWrites: 0, firecrawlRequests: 0, credentialsLoaded: false }, null, 2)); return; }
  const policy = await loadPolicy();
  if (mode === '--replay') {
    const report = JSON.parse(fs.readFileSync(argument, 'utf8')); assert(Array.isArray(report.results) && report.results.length <= 16);
    const results = report.results.map(item => { let pass = false; const fixture = fixtures.find(candidate => candidate.name === item.case);
      try { assert(fixture); rubric(fixture, policy.validateOnboardingExtraction(item.raw, fixture.bundle)); pass = true; } catch {}
      return { case: item.case, repeat: item.repeat, pass }; });
    console.log(JSON.stringify({ mode: 'offline_replay', paidCalls: 0, results, passed: results.filter(item => item.pass).length, failed: results.filter(item => !item.pass).length }, null, 2));
    if (results.some(item => !item.pass)) process.exitCode = 1; return;
  }
  require('dotenv').config({ path: '.env.local', quiet: true }); assert(process.env.OPENAI_API_KEY && process.env.SIMPLESEO_TEST_MODE !== '1', 'Evaluation credentials are unavailable.');
  const OpenAI = require('openai'); const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 100000 });
  const results = [];
  for (const fixture of selected) for (let repeat = 1; repeat <= 2; repeat++) {
    let raw = null, pass = false, usage = null, failure = null;
    try { const response = await client.responses.create(policy.buildOnboardingExtractionRequest(fixture.bundle)); usage = response.usage || null;
      raw = JSON.parse(policy.responseText(response)); rubric(fixture, policy.validateOnboardingExtraction(raw, fixture.bundle)); pass = true;
    } catch { failure = 'provider_or_grounding_gate_failed'; }
    results.push({ case: fixture.name, repeat, pass, raw, usage, failure }); console.log(`${fixture.name} repeat ${repeat}: ${pass ? 'PASS' : 'FAIL'}`);
  }
  fs.mkdirSync('tmp', { recursive: true }); const output = `tmp/onboarding-extraction-evaluation-${new Date().toISOString().replaceAll(':', '-')}.json`;
  fs.writeFileSync(output, JSON.stringify({ model: policy.PAGE_REVIEW_MODEL, createdAt: new Date().toISOString(), results,
    limitations: ['Synthetic fact extraction fixtures do not establish production accuracy, ranking improvement, or Firecrawl rendering quality. Human review is still required.'] }, null, 2));
  console.log(JSON.stringify({ output, passed: results.filter(item => item.pass).length, failed: results.filter(item => !item.pass).length, paidRequests: results.length, retries: 0, productionWrites: 0 }));
  if (results.some(item => !item.pass)) process.exitCode = 1;
}
main().catch(() => { console.error('Evaluation stopped. Provider details and credentials are withheld.'); process.exitCode = 1; });

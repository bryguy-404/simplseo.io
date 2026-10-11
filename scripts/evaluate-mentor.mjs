// Explicit bounded real-model quality gate. No customer conversations, profile
// changes or synthetic observations are written. Only private usage/budget rows.
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import dotenv from 'dotenv';
import { createServer } from 'vite';
import OpenAI from 'openai';
import { mentorQualityScenarios, syntheticEvidence } from './fixtures/mentor-quality.mjs';
dotenv.config({ path: '.env.local', quiet: true });
const [identityFile, outputFile, countArg = '32', repairId] = process.argv.slice(2);
const citationRecheck = ['citation-recheck', 'citation-recheck-retry-failed'].includes(repairId);
const retryFailedCitation = repairId === 'citation-recheck-retry-failed';
if (!identityFile || !outputFile || process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_PROJECT_ID !== 'simpleseo-90570') throw new Error('Explicit pilot identity and report path required.');
const identities = fs.readFileSync(identityFile, 'utf8').trim().split('\n').map(JSON.parse);
if (identities.length !== 1 || identities[0].property !== 'https://bryandevelops.com/') throw new Error('Wrong pilot scope.');
const uid = identities[0].uid;
const saved = fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
let attempts = saved.reduce((sum, row) => sum + row.providerAttempts, 0), startedAnswers = 0;
const previousCitationAttempts = saved.filter(row => row.id.endsWith('-citation-recheck')).length;
const vite = await createServer({ server: { middlewareMode: true, hmr: false, ws: false, watch: null }, appType: 'custom', logLevel: 'error' });
try {
  const { generateMentorAnswer } = await vite.ssrLoadModule('/app/lib/server/mentorGeneration.js');
  const { readMentorAccountScope } = await vite.ssrLoadModule('/app/lib/server/mentorAccountScope.js');
  const scope = await readMentorAccountScope(uid);
  const provider = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, maxRetries: 0, timeout: 100000 }).responses;
  for (let repeat = 0; repeat < 2; repeat++) for (const scenario of mentorQualityScenarios) {
    // This mode requires owner authorization beyond the initial answer cap.
    // It evaluates only the two repaired citation cases, not the entire suite.
    if (citationRecheck && scenario.id !== 'general-no-google') continue;
    const id = `${scenario.id}-${repeat + 1}${citationRecheck ? '-citation-recheck' : ''}`;
    const previous = saved.filter(row => row.id === id).at(-1);
    const explicitRetry = previous?.outcome === 'failed' && (repairId === id || retryFailedCitation);
    if ((previous && !explicitRetry) || startedAnswers >= Number(countArg)) continue;
    if (citationRecheck && previousCitationAttempts + startedAnswers >= 4) throw new Error('Owner-authorized supplemental answer limit reached.');
    if (attempts >= 128) throw new Error('Evaluation attempt ceiling reached.');
    startedAnswers++;
    const start = Date.now(), turnId = `phase9eval-${randomUUID()}`, usage = [], callsBefore = attempts;
    let row;
    try {
      const answer = await generateMentorAnswer({ uid, scope, conversationId: 'isolated-quality-evaluation', turnId,
        message: scenario.question, selection: scenario.facts.ambiguous ? {} : { pageUrl: scenario.pageUrl },
        deadline: Date.now() + 120000, signal: AbortSignal.timeout(120000) }, {
        evaluation: true, researchEnabled: false,
        executeEvidence: async (_uid, _scope, name, args) => syntheticEvidence(scenario, name, args),
        provider: { create: async (request, options) => {
          if (++attempts > 128) throw new Error('Evaluation provider limit.');
          const response = await provider.create(request, options);
          usage.push({ model: response.model, usage: response.usage, searches: response.output?.filter(item => item.type === 'web_search_call').length || 0 });
          return response;
        } },
      });
      row = { id, industry: scenario.industry, question: scenario.question, rubric: scenario.rubric, answer, outcome: 'completed' };
      // The evaluation report never needs the actual pilot scope.
      delete row.answer.provenance.scope;
    } catch (error) { row = { id, industry: scenario.industry, question: scenario.question, rubric: scenario.rubric, outcome: 'failed', error: error.message }; }
    row.providerAttempts = attempts - callsBefore; row.durationMs = Date.now() - start; row.usage = usage;
    fs.appendFileSync(outputFile, `${JSON.stringify(row)}\n`);
    console.log(JSON.stringify({ id, outcome: row.outcome, providerAttempts: row.providerAttempts, durationMs: row.durationMs }));
    if (row.outcome !== 'completed') throw new Error('Quality gate stopped for investigation; no automatic retry.');
  }
} finally { await vite.close(); }

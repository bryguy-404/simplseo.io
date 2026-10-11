import { randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { requireCron } from './requestAuth';

const JOBS = new Set(['progress', 'website-monitoring']);
const STATUSES = new Set(['ready', 'collecting', 'insufficient_data', 'paused', 'error', 'skipped', 'superseded', 'usable', 'not_checked', 'reconnect_required', 'temporarily_unavailable', 'deferred']);
const finiteCount = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

// Two jobs × two request sources × 32 rotating day slots. No account identifiers,
// URLs, credentials or provider errors are stored in operational history.
function runRef(job, trigger, now) {
  const daySlot = Math.floor(now.getTime() / 86400000) % 32;
  return db.collection('cronRuns').doc(`${job}-${trigger}-${daySlot}`);
}
function countsFor(result) {
  const counts = {};
  for (const [state, count] of Object.entries(result?.counts || {})) {
    if (STATUSES.has(state)) counts[state] = finiteCount(count);
  }
  return counts;
}

export async function runTrackedCron(request, job, collect, now = new Date()) {
  requireCron(request);
  if (!JOBS.has(job)) throw new Error('Unknown collection job');
  // This is an authenticated request's header, not independent proof that the
  // platform scheduler ran. Operators also verify it against Vercel invocation logs.
  const trigger = request.headers.get('user-agent') === 'vercel-cron/1.0' ? 'vercel_cron_header' : 'authenticated_request';
  const ref = runRef(job, trigger, now);
  const runId = randomUUID();
  const startedAt = now.toISOString();
  const startClock = Date.now();
  await db.runTransaction(async tx => {
    const previous = (await tx.get(ref)).data();
    const sameDay = previous?.startedAt?.slice(0, 10) === startedAt.slice(0, 10);
    tx.set(ref, {
      schemaVersion: 1, job, trigger, runId, startedAt, finishedAt: null,
      status: 'running', durationMs: null, checked: null, counts: {},
      errorCode: null, lastSuccessfulAt: sameDay ? previous?.lastSuccessfulAt || null : null,
      lastSuccessfulRun: sameDay ? previous?.lastSuccessfulRun || null : null,
      lastCompletedRun: sameDay ? previous?.lastCompletedRun || null : null,
      invocationCount: sameDay ? finiteCount(previous?.invocationCount) + 1 : 1,
      environment: ['production', 'preview', 'development'].includes(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV : 'unknown',
      deploymentId: /^dpl_[a-zA-Z0-9]+$/.test(process.env.VERCEL_DEPLOYMENT_ID || '') ? process.env.VERCEL_DEPLOYMENT_ID : null,
    });
  });
  const finish = async patch => db.runTransaction(async tx => {
    const current = (await tx.get(ref)).data();
    if (!current || current.startedAt?.slice(0, 10) !== startedAt.slice(0, 10)) return;
    const finishedAt = new Date().toISOString();
    const durationMs = Math.max(0, Date.now() - startClock);
    const evidence = {};
    if (['completed', 'partial'].includes(patch.status)) {
      const completed = { runId, startedAt, finishedAt, durationMs, ...patch };
      if (!current.lastCompletedRun || current.lastCompletedRun.startedAt <= startedAt) evidence.lastCompletedRun = completed;
      if (patch.status === 'completed' && (!current.lastSuccessfulRun || current.lastSuccessfulRun.startedAt <= startedAt)) {
        evidence.lastSuccessfulRun = completed;
        evidence.lastSuccessfulAt = finishedAt;
      }
    }
    // A duplicate can be deferred while the first request is still running.
    // Preserve that real completion separately, without replacing the newer
    // attempt's status or a newer completed collection's evidence.
    if (current.runId === runId) tx.set(ref, { ...patch, finishedAt, durationMs, ...evidence }, { merge: true });
    else if (Object.keys(evidence).length) tx.set(ref, evidence, { merge: true });
  });
  try {
    const result = await collect();
    const counts = countsFor(result);
    const errors = (counts.error || 0) + (counts.reconnect_required || 0) + (counts.temporarily_unavailable || 0);
    const status = errors || counts.deferred || result?.moreRecords === true ? 'partial' : 'completed';
    const collectors = {};
    for (const key of ['existingPages', 'newPages']) {
      const item = result?.collectors?.[key];
      if (item) collectors[key] = { checked: finiteCount(item.checked), pagesChecked: finiteCount(item.pagesChecked),
        counts: countsFor(item), moreRecords: item.moreRecords === true };
    }
    await finish({ status, checked: finiteCount(result?.checked), pagesChecked: finiteCount(result?.pagesChecked), counts,
      moreRecords: result?.moreRecords === true, notificationsSent: finiteCount(result?.notificationsSent),
      ...(Object.keys(collectors).length ? { collectors } : {}),
    });
    return { ...result, collectionRun: { id: runId, status, trigger, startedAt } };
  } catch (error) {
    // Error text can contain provider payloads. Store only controlled categories.
    await finish({ status: error.status === 429 ? 'deferred' : 'failed', errorCode: error.status === 429 ? 'collection_busy' : 'collection_failed' });
    throw error;
  }
}

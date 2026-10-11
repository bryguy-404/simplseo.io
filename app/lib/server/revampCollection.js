import { randomUUID } from 'node:crypto';
import { db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { monitorRevamp } from './revampMonitor';

const MAX_ACCOUNTS = 20;
const MAX_PAGES_PER_ACCOUNT = 40;
const WORK_BUDGET_MS = 120000;

export async function runRevampCollection(now = new Date()) {
  const deadline = Date.now() + WORK_BUDGET_MS;
  const ref = db.collection('progressJobs').doc('daily-website-monitoring');
  const attempt = randomUUID();
  const previous = await db.runTransaction(async tx => {
    const prior = (await tx.get(ref)).data() || {};
    if (Date.parse(prior.leaseUntil) > now.getTime() || Date.parse(prior.lastStartedAt) + 60000 > now.getTime()) {
      throw new RequestError('Website monitoring is already running. Please try again later.', 429);
    }
    tx.set(ref, { attempt, lastStartedAt: now.toISOString(), leaseUntil: new Date(now.getTime() + 240000).toISOString() }, { merge: true });
    return prior;
  });
  const finish = async patch => db.runTransaction(async tx => {
    if ((await tx.get(ref)).data()?.attempt === attempt) tx.set(ref, { ...patch, leaseUntil: null }, { merge: true });
  });
  try {
    const base = () => db.collection('onboarding').where('revampMonitoringEnabled', '==', true).orderBy('__name__').limit(MAX_ACCOUNTS);
    let query = base();
    if (previous.cursor) query = query.startAfter(previous.cursor);
    let users = await query.get();
    if (users.empty && previous.cursor) users = await base().get();
    const counts = {}, results = [];
    let pagesChecked = 0, morePages = false;
    for (const user of users.docs) {
      if (Date.now() >= deadline) break;
      try {
        const result = await monitorRevamp(user.id, { maxPages: MAX_PAGES_PER_ACCOUNT, deadline, scheduled: true });
        const state = ['usable', 'not_checked', 'reconnect_required', 'temporarily_unavailable', 'deferred'].includes(result.connectionStatus) ? result.connectionStatus : 'error';
        counts[state] = (counts[state] || 0) + 1;
        pagesChecked += result.checked || 0;
        morePages ||= result.morePages === true;
        results.push({ userId: user.id, connectionStatus: state });
      } catch {
        counts.error = (counts.error || 0) + 1;
        results.push({ userId: user.id, error: 'Check failed; prior observations retained.' });
      }
    }
    const checked = results.length;
    const moreRecords = checked < users.size || users.size === MAX_ACCOUNTS || morePages;
    const cursor = checked === users.size && users.size < MAX_ACCOUNTS ? null : users.docs[checked - 1]?.id || previous.cursor || null;
    await finish({ cursor, lastFinishedAt: new Date().toISOString(), counts, checked, pagesChecked, moreRecords });
    return { checked, pagesChecked, counts, moreRecords, results, notificationsSent: 0 };
  } catch (error) {
    await finish({ lastErrorAt: new Date().toISOString() });
    throw error;
  }
}

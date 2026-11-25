import { createHash, randomUUID } from 'node:crypto';
import { auth, db } from '../firebaseAdmin';
import { RequestError } from './requestAuth';
import { claimProviderLane, releaseProviderLane } from './notificationDelivery';

const DAY = 86400000;
const ratings = ['Great', 'Okay', 'Frustrating'];
const stateRef = uid => db.collection('users').doc(uid).collection('dashboardFeedback').doc('state');
const hash = value => createHash('sha256').update(value).digest('hex');
const timestamp = value => value?.toMillis?.() || Date.parse(value || '') || null;

async function readSchedule(tx, uid, now) {
  const ref = stateRef(uid);
  const [saved, guard] = await Promise.all([
    tx.get(ref), tx.get(db.collection('accountDeletionGuards').doc(hash(uid))),
  ]);
  if (guard.data()?.blocked) throw new RequestError('Your account changed. Reload to continue.', 409);
  if (saved.exists) return { ref, state: saved.data(), exists: true };

  const old = (await tx.get(db.collection('users').doc(uid).collection('feedbackPrompt').doc('data'))).data() || {};
  const firstVisit = timestamp(old.firstDashboardVisit);
  const dismissals = Math.min(2, old.promptCount || 0);
  // Earlier contact submissions had no submission timestamp. Give those members a full quiet period.
  const nextPrompt = old.hasSubmittedFeedback ? now + 90 * DAY : Math.max(
    firstVisit ? firstVisit + 7 * DAY : 0,
    dismissals ? (timestamp(old.lastPromptShown) || now) + 30 * DAY : 0,
  );
  return { ref, exists: false, state: { firstVisit, nextPrompt, dismissals: old.hasSubmittedFeedback ? 0 : dismissals, usedFeature: false } };
}

export async function updateFeedbackPrompt(uid, { action, promptId }, now = Date.now()) {
  return db.runTransaction(async tx => {
    const { ref, state, exists } = await readSchedule(tx, uid, now);
    if (action === 'feature') {
      if (!state.usedFeature) tx.set(ref, { ...state, usedFeature: true });
    } else if (action === 'visit') {
      if (!state.firstVisit) {
        tx.set(ref, { ...state, firstVisit: now, nextPrompt: Math.max(state.nextPrompt, now + 7 * DAY) });
      } else if (state.usedFeature && state.dismissals < 2 && now >= state.nextPrompt) {
        const id = randomUUID();
        // Reserve one impression across tabs/devices. Navigating away also gives the user a break.
        tx.set(ref, { ...state, activePrompt: id, usedFeature: false, nextPrompt: now + 30 * DAY });
        return { promptId: id };
      } else if (!exists) {
        tx.set(ref, state);
      }
    } else if (action === 'dismiss') {
      if (typeof promptId !== 'string' || !promptId) throw new RequestError('Invalid feedback prompt.');
      if (promptId === state.activePrompt) {
        tx.update(ref, { activePrompt: null, dismissals: Math.min(2, state.dismissals + 1), nextPrompt: now + 30 * DAY });
      }
    } else throw new RequestError('Unknown feedback action.');
    return {};
  });
}

function submittedSchedule(state, now) {
  return { ...state, activePrompt: null, usedFeature: false, dismissals: state.dismissals >= 2 ? 2 : 0, nextPrompt: now + 90 * DAY };
}

// The existing Help & contact form can also receive explicit feedback.
export async function saveContactFeedback(uid, ref, contact) {
  await db.runTransaction(async tx => {
    const now = Date.now();
    const schedule = await readSchedule(tx, uid, now);
    tx.set(ref, contact);
    tx.set(schedule.ref, submittedSchedule(schedule.state, now));
  });
}

export async function submitDashboardFeedback(uid, { submissionId, rating, comment = '' }) {
  if (typeof submissionId !== 'string' || !/^[a-f0-9-]{36}$/i.test(submissionId) || !ratings.includes(rating)
    || typeof comment !== 'string' || comment.length > 2000) throw new RequestError('Choose a rating and keep your comment under 2,001 characters.');
  if (!process.env.RESEND_API_KEY || !process.env.RESEND_NOTIFICATION_FROM) throw new RequestError('Feedback email is unavailable. Please try again later.', 503);
  const id = hash(JSON.stringify([uid, submissionId]));
  const ref = db.collection('contactMessages').doc(id);
  const account = await auth.getUser(uid);
  const saved = await db.runTransaction(async tx => {
    const now = Date.now();
    const { ref: timing, state } = await readSchedule(tx, uid, now);
    const previous = (await tx.get(ref)).data();
    if (previous) {
      if (previous.rating !== rating || previous.comment !== comment.trim()) throw new RequestError('This response has already been saved.', 409);
      if (!previous.emailed && now - Date.parse(previous.createdAt) >= 23 * 3600000) throw new RequestError('Your response was saved. Email delivery could not be confirmed.', 409);
      return previous;
    }
    if (now - (state.lastSubmissionAt || 0) < 60000) throw new RequestError('Please wait a minute before sending more feedback.', 429);
    const profile = (await tx.get(db.collection('onboarding').doc(uid))).data() || {};
    const email = account.email || '';
    const name = account.displayName || profile.name || email;
    const message = [`Rating: ${rating}`, comment.trim(), `Business: ${profile.businessName || 'Not provided'}`, `From: ${name} (${email})`].filter(Boolean).join('\n\n');
    const item = { userId: uid, userEmail: email, email, name, subject: 'feedback', source: 'dashboard', rating, comment: comment.trim(),
      message, status: 'new', createdAt: new Date(now).toISOString(), emailed: false,
      mail: { from: process.env.RESEND_NOTIFICATION_FROM, to: ['simplseoai@gmail.com'], ...(email ? { reply_to: email } : {}),
        subject: `SimplSEO dashboard feedback · ${rating}`, text: message } };
    tx.create(ref, item);
    tx.set(timing, { ...submittedSchedule(state, now), lastSubmissionAt: now });
    return item;
  });
  if (saved.emailed) return {};
  const lane = await claimProviderLane(Date.now() + 20000);
  if (!lane) throw new RequestError('Your response is saved. Try sending the email again.', 503);
  try {
    const latest = await ref.get();
    if (!latest.exists) throw new RequestError('This response is no longer available.', 404);
    if (latest.data().emailed) return {};
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `feedback-${id}` },
      body: JSON.stringify(saved.mail), signal: AbortSignal.timeout(12000),
    });
    if (!response.ok || !(await response.json()).id) throw new Error('Email was not accepted');
    await ref.update({ emailed: true });
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError('Your response is saved. Try sending the email again.', 503);
  } finally { await releaseProviderLane(lane); }
  return {};
}

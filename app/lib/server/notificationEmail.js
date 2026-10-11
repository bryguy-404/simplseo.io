import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { RequestError } from './requestAuth';

export const notificationHash = value => createHash('sha256').update(value).digest('hex');
export const normalizeNotificationEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const escapeHtml = value => String(value || '').replace(/[&<>"']/g, value => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));
export function notificationOrigin() {
  try {
    const url = new URL(process.env.NOTIFICATION_PUBLIC_ORIGIN);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
export function notificationDeliveryConfigured() {
  return Boolean(notificationOrigin() && process.env.RESEND_API_KEY && process.env.RESEND_NOTIFICATION_FROM
    && process.env.RESEND_NOTIFICATION_REPLY_TO && process.env.RESEND_WEBHOOK_SECRET
    && process.env.NOTIFICATION_UNSUBSCRIBE_SECRET?.length >= 32 && process.env.NOTIFICATION_TRACKING_DISABLED === 'true');
}
export function unsubscribeToken(userId, recipient, secret = process.env.NOTIFICATION_UNSUBSCRIBE_SECRET) {
  if (!secret || secret.length < 32) throw new RequestError('Notification email setup is not complete.', 503);
  const body = Buffer.from(JSON.stringify({ v: 1, uid: userId, recipient: notificationHash(normalizeNotificationEmail(recipient)) })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}
export function verifyUnsubscribeToken(token, secret = process.env.NOTIFICATION_UNSUBSCRIBE_SECRET) {
  if (!secret || secret.length < 32 || typeof token !== 'string' || token.length > 2048) throw new RequestError('This unsubscribe link is unavailable.', 400);
  const [body, signature, extra] = token.split('.');
  const expected = createHmac('sha256', secret).update(body || '').digest();
  const supplied = Buffer.from(signature || '', 'base64url');
  if (extra || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new RequestError('This unsubscribe link is unavailable.', 400);
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { throw new RequestError('This unsubscribe link is unavailable.', 400); }
  if (data.v !== 1 || typeof data.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.uid)
    || !/^[a-f0-9]{64}$/.test(data.recipient)) throw new RequestError('This unsubscribe link is unavailable.', 400);
  return data;
}

export function renderNotificationEmail({ userId, recipient, events = [], deliveryId, test = false, origin = notificationOrigin() }) {
  if (!origin) throw new RequestError('Notification email setup is not complete.', 503);
  const token = unsubscribeToken(userId, recipient);
  const preferences = `${origin}/settings?tab=notifications`;
  const humanUnsubscribe = `${origin}/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
  const oneClick = `${origin}/api/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
  const inbox = `${origin}/notifications`;
  const selected = events.slice(0, 5);
  const heading = test ? 'Your SimplSEO test email' : 'Your page updates are ready';
  const intro = test ? 'This is a test of your notification settings. It does not represent a page improvement, publication or search result.'
    : 'There are saved updates to review in SimplSEO. Open an update to see its evidence and next step.';
  const rows = selected.map(event => ({
    name: String(event.pageName || event.title || 'Page update').slice(0, 200),
    title: String(event.title || 'Page update').slice(0, 200),
    message: String(event.message || '').slice(0, 600),
    date: String(event.occurredAt || '').slice(0, 10),
    href: `${origin}/notifications/${encodeURIComponent(event.id)}`,
  }));
  const text = [heading, '', intro, ...rows.flatMap(row => ['', row.name, row.title, row.message, row.date ? `Update date: ${row.date}` : '', row.href]), '',
    `View all updates: ${inbox}`, `Notification preferences: ${preferences}`, `Unsubscribe: ${humanUnsubscribe}`, '', 'Sign in with your usual account to view your saved work.'].filter(value => value !== undefined).join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#f4f7f5;color:#1a2922;font-family:Arial,sans-serif"><main style="max-width:560px;margin:24px auto;padding:28px;background:white;border-radius:16px"><p style="color:#087d44;font-weight:bold">SimplSEO${test ? ' · TEST' : ''}</p><h1 style="font-size:25px">${heading}</h1><p style="line-height:1.6">${intro}</p>${rows.map(row => `<section style="padding:18px 0;border-top:1px solid #dce5df"><h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(row.name)}</h2><p><strong>${escapeHtml(row.title)}</strong></p><p style="line-height:1.6">${escapeHtml(row.message)}</p>${row.date ? `<p style="font-size:13px;color:#516259">Update date: ${escapeHtml(row.date)}</p>` : ''}<a style="color:#087d44" href="${escapeHtml(row.href)}">View update</a></section>`).join('')}<p><a style="display:inline-block;padding:12px 18px;background:#087d44;color:white;text-decoration:none;border-radius:8px" href="${inbox}">View all updates</a></p><p style="font-size:13px;color:#516259">Sign in with your usual account to view your saved work.</p><footer style="font-size:12px;border-top:1px solid #dce5df;padding-top:18px"><a href="${preferences}">Notification preferences</a> · <a href="${escapeHtml(humanUnsubscribe)}">Unsubscribe</a></footer></main></body></html>`;
  return { from: process.env.RESEND_NOTIFICATION_FROM, to: [recipient], reply_to: process.env.RESEND_NOTIFICATION_REPLY_TO,
    subject: test ? 'SimplSEO notification test' : 'Your SimplSEO page updates', html, text,
    headers: { 'List-Unsubscribe': `<${oneClick}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    tags: [{ name: 'delivery_id', value: deliveryId }, { name: 'feature', value: 'page_notifications' }] };
}

// Svix's documented raw-body HMAC protocol. Timestamp validation and the durable
// webhook ID receipt below protect both freshness and repeated valid delivery.
export function verifyNotificationWebhook(raw, headers, { now = Date.now(), secret = process.env.RESEND_WEBHOOK_SECRET } = {}) {
  const id = headers.get('svix-id'), timestamp = headers.get('svix-timestamp'), signatures = headers.get('svix-signature');
  if (!secret?.startsWith('whsec_') || !id || id.length > 200 || !/^\d{1,12}$/.test(timestamp || '')
    || Math.abs(now / 1000 - Number(timestamp)) > 300 || typeof raw !== 'string' || raw.length > 200000) throw new RequestError('Invalid webhook.', 400);
  const secretBytes = Buffer.from(secret.slice(6), 'base64');
  if (secretBytes.length < 16 || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret.slice(6))) throw new RequestError('Invalid webhook.', 400);
  const expected = createHmac('sha256', secretBytes).update(`${id}.${timestamp}.${raw}`).digest();
  const valid = String(signatures || '').split(' ').some(signature => {
    const [version, encoded] = signature.split(',');
    if (version !== 'v1') return false;
    const value = Buffer.from(encoded || '', 'base64');
    return value.length === expected.length && timingSafeEqual(expected, value);
  });
  if (!valid) throw new RequestError('Invalid webhook.', 400);
  let event;
  try { event = JSON.parse(raw); } catch { throw new RequestError('Invalid webhook.', 400); }
  return { id, event };
}

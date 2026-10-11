import { pacificDay, PROGRESS_POLICY, shiftDay } from './progressAssessment';

const DAY_MS = 86400000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const AVAILABLE_OBSERVATIONS = new Set(['has_data', 'no_data', 'available']);

function validCalendarDay(value) {
  if (!DATE_ONLY.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function presentationDate(value) {
  try {
    if (value?.toDate) value = value.toDate();
    if (typeof value === 'string' && DATE_ONLY.test(value)) {
      return validCalendarDay(value) ? { day: value, time: null } : null;
    }
    // Timestamp strings need an explicit timezone. A browser's local timezone
    // must not move the start of a Google Search Console comparison.
    if (typeof value === 'string' && (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
      || !validCalendarDay(value.slice(0, 10)))) return null;
    if (!(value instanceof Date) && typeof value !== 'string') return null;
    const parsed = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    return { day: pacificDay(parsed), time: parsed.getTime() };
  } catch {
    return null;
  }
}

const daysBetween = (start, end) => (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / DAY_MS;

/** Presentation only: reaching the scheduled day does not prove data is ready. */
export function progressTimeline(cycle, now = new Date()) {
  const confirmed = presentationDate(cycle?.confirmedAt);
  const target = presentationDate(cycle?.nextReviewAt);
  const current = presentationDate(now);
  if (!confirmed || !target || !current || confirmed.day > current.day || target.day <= confirmed.day
    || (confirmed.time != null && current.time != null && confirmed.time > current.time)) return null;

  const completedDay = cycle?.latestCheckpoint?.day;
  const laterInterval = Number.isSafeInteger(completedDay) && completedDay >= PROGRESS_POLICY.windowDays
    && completedDay % PROGRESS_POLICY.windowDays === 0;
  const startDay = laterInterval ? shiftDay(target.day, -PROGRESS_POLICY.windowDays) : confirmed.day;
  if (startDay < confirmed.day) return null;
  const durationDays = daysBetween(startDay, target.day);
  if (durationDays <= 0) return null;
  return {
    elapsedDays: daysBetween(confirmed.day, current.day),
    daysRemaining: Math.max(0, daysBetween(current.day, target.day)),
    durationDays,
    percent: Math.min(100, Math.max(0, daysBetween(startDay, current.day) / durationDays * 100)),
    due: current.day >= target.day,
    startDay,
    targetDay: target.day,
  };
}

const oneDecimal = value => Math.round((value + Number.EPSILON) * 10) / 10;

function metricValue(observation, key) {
  if (!AVAILABLE_OBSERVATIONS.has(observation?.status)) return null;
  const value = observation[key];
  if (!Number.isFinite(value) || value < 0) return null;
  if (key === 'position') {
    if (!Number.isFinite(observation.impressions) || observation.impressions <= 0 || value < 1) return null;
    return oneDecimal(value);
  }
  return value;
}

/** Numeric direction describes the displayed values; it does not imply causality. */
export function resultMetrics(checkpoint) {
  return [['clicks', 'Clicks'], ['impressions', 'Appearances in search'], ['position', 'Average position']].map(([key, label]) => {
    const before = metricValue(checkpoint?.baseline, key);
    const after = metricValue(checkpoint?.post, key);
    if (before == null || after == null) return { key, label, before, after, delta: null, tone: 'unavailable', direction: null };
    // Compare the precision shown in the cards, so equal displayed positions
    // never acquire an improvement/decline arrow from hidden decimal places.
    const difference = key === 'position' ? oneDecimal(after - before) : after - before;
    const delta = difference === 0 ? 0 : difference;
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const improved = key === 'position' ? delta < 0 : delta > 0;
    return { key, label, before, after, delta, tone: delta === 0 ? 'neutral' : improved ? 'positive' : 'negative', direction };
  });
}

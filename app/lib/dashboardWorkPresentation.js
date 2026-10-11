import { progressTimeline } from './progressPresentation';

const clean = value => typeof value === 'string' ? value : '';
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const pageHref = url => `/low-ctr?page=${encodeURIComponent(url)}`;
const draftHref = id => `/generic-keywords?planId=${encodeURIComponent(id)}`;
const hasTotals = observation => ['available', 'has_data', 'no_data'].includes(observation?.status)
  && Number.isFinite(observation.clicks) && Number.isFinite(observation.impressions);
const hasComparison = checkpoint => checkpoint?.state !== 'incomplete'
  && hasTotals(checkpoint?.baseline) && hasTotals(checkpoint?.post);
export function dashboardPageLabel(url) {
  try { const parsed = new URL(url); return parsed.pathname === '/' && !parsed.search ? 'Homepage' : parsed.pathname + parsed.search; }
  catch { return 'Saved page'; }
}

// Fragments retain their own IDs across continuation pages. A failed linked
// publication read must not erase the last successful observation in this tab.
export function mergeDashboardWork(previous = [], incoming = []) {
  const records = new Map(previous.map(item => [`${item.kind}:${item.id}`, item]));
  for (const item of incoming) {
    if (!item?.kind || !item.id) continue;
    const key = `${item.kind}:${item.id}`, old = records.get(key);
    records.set(key, { ...item, ...(item.publicationError && old?.publication ? { publication: old.publication } : {}) });
  }
  return [...records.values()];
}

function cyclePresentation(cycle, now) {
  const checkpoint = cycle.latestCheckpoint;
  const decision = cycle.latestDecision;
  const matching = checkpoint && decision?.checkpointId === (cycle.latestCheckpointId || checkpoint.id)
    && decision?.checkpointRevision === checkpoint.evidenceRevision;
  const issues = (cycle.technical?.issues || []).filter(issue => !issue.stale);
  const base = { confirmedAt: cycle.confirmedAt, nextReviewAt: cycle.nextReviewAt,
    latestCheckpoint: checkpoint || null, stale: Boolean(cycle.lastError),
    observedAt: checkpoint?.observedAt || checkpoint?.post?.fetchedAt || checkpoint?.collectedAt,
    sortAt: cycle.confirmedAt, href: pageHref(cycle.pageUrl), actionLabel: 'View progress' };
  if (issues.length) return { ...base, state: 'attention', priority: 1, tone: 'attention', title: 'A page issue needs a look',
    detail: issues[0].message || issues[0].label || 'Open the verified finding and its repair guidance.', actionLabel: 'Check this issue',
    sortAt: cycle.technical?.checkedAt || cycle.confirmedAt };
  if (checkpoint && !matching && !hasComparison(checkpoint)) return { ...base, state: 'unavailable', priority: 2, tone: 'muted', title: 'More evidence is needed',
    detail: 'Part of the comparison is unavailable. Open the page to check what is missing; any reported numbers remain visible.', actionLabel: 'View available evidence',
    sortAt: checkpoint.observedAt || cycle.confirmedAt };
  if (checkpoint && !matching) return { ...base, state: 'ready', priority: 2, tone: 'info', title: 'Your results are ready',
    detail: 'Compare the saved periods, then review the next useful step.', actionLabel: 'Review my results',
    sortAt: checkpoint.createdAt || checkpoint.post?.fetchedAt || cycle.confirmedAt };
  if (matching && ['improve_page', 'investigate_visibility', 'fix_technical'].includes(decision.outcome) && !decision.acceptedAt) {
    return { ...base, state: 'reviewed', priority: 3, tone: 'info', title: 'Your next step is saved',
      detail: decision.nextStep || decision.summary || 'Open your saved guidance.', actionLabel: 'View next step', sortAt: decision.reviewedAt || cycle.confirmedAt };
  }
  const timeline = progressTimeline(cycle, now);
  if (cycle.lastError && !checkpoint) return { ...base, state: 'unavailable', priority: 4, tone: 'muted', title: 'The latest check could not finish',
    detail: 'Your changes are still saved. Open this page to retry the check.', actionLabel: 'View saved progress' };
  return { ...base, state: matching ? 'monitoring' : 'collecting', priority: 4, tone: 'info',
    title: timeline?.due ? 'Waiting for the latest data' : matching ? 'Keep monitoring this page' : 'Collecting data',
    detail: matching ? decision.nextStep || decision.summary || 'Your current guidance is saved while the next period develops.'
      : 'Your changes are confirmed. Search activity needs time to develop.' };
}

function legacyPresentation(record, now) {
  if (record.activeCycle) return cyclePresentation(record.activeCycle, now);
  const assessment = record.assessment || {};
  const base = { confirmedAt: record.implementedAt, nextReviewAt: record.nextReviewAt || assessment.nextReviewAt,
    latestCheckpoint: assessment.baseline && assessment.post ? { windows: assessment.windows, baseline: assessment.baseline, post: assessment.post } : null,
    sortAt: record.implementedAt, href: pageHref(record.pageUrl), actionLabel: 'View progress', priority: 4, tone: 'info' };
  if (record.activeCycleLookupFailed || record.activeCycleConflict) return { ...base, state: 'unavailable', tone: 'muted', title: 'Saved progress needs another check', detail: 'Open the page to load its current tracking state.' };
  if (['ready', 'insufficient_data'].includes(assessment.state) && hasComparison(base.latestCheckpoint)) return { ...base, state: 'ready', priority: 2, title: 'Your comparison is ready', detail: assessment.state === 'insufficient_data' ? 'Activity is limited, but you can review the reported numbers.' : 'View the saved activity before choosing another change.', actionLabel: 'View results' };
  if (assessment.state === 'insufficient_data' && base.latestCheckpoint) return { ...base, state: 'unavailable', tone: 'muted', title: 'More evidence is needed', detail: 'A complete comparison is unavailable. Open the page to see its saved observations.', actionLabel: 'View available evidence' };
  if (['error', 'paused'].includes(assessment.state)) return { ...base, state: 'unavailable', tone: 'muted', stale: true, title: 'View your saved progress', detail: 'The latest check is unavailable. Your confirmed changes remain saved.' };
  return { ...base, state: 'collecting', title: 'Collecting data', detail: 'Your confirmed changes are saved. Open the page for its reporting dates.' };
}

export function dashboardWorkPresentation(group, now = new Date()) {
  const { pageUrl, plan, cycle, legacy, newPage, cycleConflict } = group;
  const publication = newPage?.publication || null;
  const label = pageUrl ? dashboardPageLabel(pageUrl) : clean(newPage?.topic) || 'New page draft';
  const base = { key: group.key, pageUrl: pageUrl || null, label, publication,
    publicationError: newPage?.publicationError || null, taskCounts: plan?.taskCounts || null,
    confirmedAt: null, nextReviewAt: null, latestCheckpoint: null };
  if (cycleConflict) return { ...base, state: 'unavailable', priority: 4, tone: 'muted', title: 'Saved tracking needs a check',
    detail: 'More than one active record was found. Open the page to inspect its saved history.', href: pageHref(pageUrl), actionLabel: 'View saved progress', sortAt: null };
  let result = cycle ? cyclePresentation(cycle, now) : legacy ? legacyPresentation(legacy, now) : null;
  const pending = (plan?.taskCounts?.todo || 0) + (plan?.taskCounts?.needs_review || 0);
  if (pending && (!result || result.priority >= 3)) result = { ...result, state: 'working', priority: 3, tone: 'info',
    title: 'Continue your page improvements', detail: `${pending} saved ${pending === 1 ? 'task is' : 'tasks are'} ready to review.`,
    actionLabel: 'Continue working', href: pageHref(pageUrl), sortAt: plan.updatedAt };
  if (result) return { ...base, ...result };
  if (newPage?.status === 'draft') return { ...base, state: 'draft', priority: 3, tone: 'info', title: newPage.hasDraft ? 'Your draft is saved' : 'Your page plan is saved',
    detail: newPage.hasDraft ? 'Continue editing before you publish it on your website.' : 'Open the plan to prepare your page draft.', href: draftHref(newPage.id),
    actionLabel: 'Continue working', sortAt: newPage.updatedAt };
  if (publication) return { ...base, state: 'published', priority: 4, tone: 'info', title: 'Your page is published',
    detail: publication.lastError ? 'The latest tracking check could not finish. Previous observations remain dated below.' : 'Follow Google’s stored index status and this page’s search activity.',
    // Each independent observation renders its own date; a later failed
    // attempt or technical check must never redate the activity evidence.
    observedAt: null, stale: Boolean(publication.lastError),
    href: draftHref(newPage.id), actionLabel: 'View page tracking', sortAt: publication.verifiedAt };
  if (newPage?.status === 'published') return { ...base, state: 'unavailable', priority: 4, tone: 'muted', title: 'Your published plan is saved',
    detail: 'The publication observations could not be loaded.', href: draftHref(newPage.id), actionLabel: 'View saved plan', sortAt: newPage.updatedAt };
  return { ...base, state: 'saved', priority: 4, tone: 'muted', title: 'Your page review is saved',
    detail: 'Open your saved recommendations and completed work.', href: pageHref(pageUrl), actionLabel: 'View saved review', sortAt: plan?.updatedAt };
}

export function prioritizeDashboardWork(fragments = [], now = new Date()) {
  const groups = new Map();
  const add = item => {
    if (!item || (item.kind === 'new_page' && item.status === 'dismissed')) return;
    const url = item.kind === 'new_page' ? item.publication?.pageUrl : item.pageUrl;
    const key = url ? `page:${url}` : item.kind === 'new_page' ? `draft:${item.id}` : null;
    if (!key) return;
    const group = groups.get(key) || { key, pageUrl: url };
    if (item.kind === 'cycle') {
      if (group.cycle && group.cycle.id !== item.id) group.cycleConflict = true;
      group.cycle = item;
    } else if (item.kind === 'plan') group.plan = item;
    else if (item.kind === 'legacy') {
      group.legacy = item;
      if (item.activeCycleLookupFailed) group.cycleLookupFailed = true;
    }
    else if (item.kind === 'new_page') group.newPage = item;
    groups.set(key, group);
    if (item.kind === 'legacy' && item.activeCycle) add({ ...item.activeCycle, kind: 'cycle' });
  };
  fragments.forEach(add);
  return [...groups.values()].map(group => group.cycleLookupFailed ? {
    key: group.key, pageUrl: group.pageUrl, label: dashboardPageLabel(group.pageUrl), state: 'unavailable', priority: 4, tone: 'muted',
    title: 'Saved progress needs another check', detail: 'The current tracking state could not be verified. Open the page to inspect its saved progress.',
    href: pageHref(group.pageUrl), actionLabel: 'View saved progress', sortAt: null,
  } : dashboardWorkPresentation(group, now)).sort((a, b) =>
    a.priority - b.priority || (a.priority === 3 ? time(b.sortAt) - time(a.sortAt) : time(a.sortAt) - time(b.sortAt)) || a.key.localeCompare(b.key));
}

export function dashboardNextAction(items, { setupRequired = false, reconnectRequired = false, hasWorkError = false, fallbackPage } = {}) {
  if (setupRequired) return { title: 'Finish your website setup', detail: 'Review your website connection before continuing.', href: '/revamp', actionLabel: 'Review setup', tone: 'info' };
  if (reconnectRequired) return { title: 'Reconnect Google to refresh your numbers', detail: 'Your saved work is safe. Restore access to get the latest search activity.', href: '/settings', actionLabel: 'Reconnect Google', tone: 'attention' };
  if (items.length) return { ...items[0], title: items[0].title, detail: `${items[0].label} · ${items[0].detail}` };
  if (hasWorkError) return { title: 'Your saved work could not be loaded', detail: 'Retry the saved-work panel below, or open your page workspace.', href: '/low-ctr', actionLabel: 'Open Improve a page', tone: 'muted' };
  const url = typeof fallbackPage === 'string' ? fallbackPage : fallbackPage?.pageUrl;
  return { title: 'Make your first useful change', detail: url ? `Start with ${dashboardPageLabel(url)}. Review a useful improvement, then publish it on your website.` : 'Choose an existing page to find your next useful improvement.',
    href: url ? pageHref(url) : '/low-ctr', actionLabel: url ? 'Review this page' : 'Choose a page', tone: 'info' };
}

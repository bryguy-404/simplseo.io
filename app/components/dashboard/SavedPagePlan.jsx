"use client";

import { CheckCircle2, Copy, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { propertyContainsUrl } from '../../lib/revampState';
import { ActionBody } from './PageReviewActions';
import { usablePageAssessment } from './PageReviewAssessment';
import { pageIdentity, usablePageActivity } from './PageSearchActivity';

const priorities = { first: 'Do first', next: 'Do next', optional: 'Optional' };
const statuses = ['todo', 'needs_review', 'done', 'dismissed'];
const actionTypes = ['heading', 'content', 'internal_link', 'technical', 'metadata', 'check'];
const isText = value => typeof value === 'string';
const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };

// Fail closed if the saved response belongs to a different page or website version.
export function usableSavedPagePlan(plan, scope) {
  if (!plan || !isText(plan.id) || !plan.id || !Number.isInteger(plan.revision) || plan.revision < 1 || !isText(plan.updatedAt) || !Number.isFinite(Date.parse(plan.updatedAt)) ||
    !usablePageAssessment(plan.review) || !usablePageActivity({ success: true, evidence: plan.review.evidence, provenance: plan.review.provenance }, scope) ||
    plan.review.currentPage?.url !== scope.pageUrl || !Array.isArray(plan.tasks) || new Set(plan.tasks.map(task => task?.id)).size !== plan.tasks.length) return false;
  return plan.tasks.every(task => {
    const item = task?.recommendation;
    if (!task || !isText(task.id) || !task.id || !statuses.includes(task.status) || !Object.hasOwn(priorities, task.priority) ||
      !item || !actionTypes.includes(item.type) || !['label', 'location', 'reason', 'instruction', 'currentQuote', 'supportingQuote'].every(key => isText(item[key])) ||
      !item.label.trim() || !item.instruction.trim() || (item.proposedText !== null && !isText(item.proposedText)) || !Array.isArray(item.evidenceIds) ||
      !Array.isArray(task.facts) || !task.facts.every(fact => fact && ['id', 'label', 'text'].every(key => isText(fact[key]))) ||
      !Array.isArray(task.sources) || !task.sources.every(source => source && isText(source.id) && isText(source.title) && safeUrl(source.url))) return false;
    if (task.draft != null && (!isText(task.draft.title) || !isText(task.draft.description))) return false;
    if (item.targetUrl !== null && (!safeUrl(item.targetUrl) || !propertyContainsUrl(scope.property, item.targetUrl) || new URL(item.targetUrl).origin !== new URL(scope.pageUrl).origin)) return false;
    const knownIds = new Set([...task.facts, ...task.sources].map(source => source.id));
    return item.evidenceIds.length > 0 && item.evidenceIds.every(id => knownIds.has(id));
  });
}

function TaskControls({ task, busy, onStatus }) {
  const closed = ['done', 'dismissed'].includes(task.status);
  return <div className="flex flex-wrap gap-2 border-t pt-4">
    {closed ? <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(task.id, 'todo')}>Reopen task</Button> : <>
      {task.status === 'needs_review' && <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(task.id, 'todo')}>Keep on my list</Button>}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(task.id, 'done')}><CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />Mark done</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(task.id, 'dismissed')}>Dismiss</Button>
    </>}
  </div>;
}

function SavedTask({ task, index, expanded = false, busy, onStatus }) {
  const item = task.recommendation;
  const earlier = task.status === 'needs_review';
  const closed = ['done', 'dismissed'].includes(task.status);
  const copyDraft = async (value, field) => {
    try { await navigator.clipboard.writeText(value); toast.success(`${field} copied`); }
    catch { toast.error('Copy failed. You can select and copy the wording yourself.'); }
  };
  return <article aria-label={item.label} className={`overflow-hidden rounded-xl border bg-background/80 ${earlier ? 'border-amber-300 dark:border-amber-800' : task.priority === 'first' && !closed ? 'border-violet-300 dark:border-violet-700' : ''}`}>
    <details className="p-4 md:p-5" open={expanded || undefined}>
      <summary className="cursor-pointer list-none rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <p className={`text-xs font-semibold uppercase tracking-wide ${earlier ? 'text-amber-800 dark:text-amber-200' : 'text-violet-800 dark:text-violet-200'}`}>{closed ? task.status === 'done' ? 'Done' : 'Dismissed' : earlier ? 'Earlier suggestion · review before using' : `${priorities[task.priority]}${task.retained ? ' · Saved from an earlier review' : ''}`}</p>
        <h3 className="mt-2 text-base font-semibold md:text-lg">{index ? `${index}. ` : ''}{item.label}</h3>
        <p className="mt-1 text-xs text-muted-foreground">Open for what to change and why</p>
      </summary>
      <div className="mt-4 space-y-4">
        {(earlier || task.retained) && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-100">{earlier ? 'Your page changed after this suggestion, and the latest review did not reconfirm it. Check that it still fits before using it.' : 'This task is saved from an earlier review. The latest analysis did not repeat it; it remains on your list so you can decide whether it is still useful.'}{task.reviewedAt && <span className="mt-1 block">Last assessed {new Date(task.reviewedAt).toLocaleString()}.</span>}</p>}
        <ActionBody item={item} facts={task.facts} sources={task.sources} />
        {item.type === 'metadata' && task.draft && <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/20"><p className="text-xs font-semibold">Saved wording from this task</p>{[['title', 'Page title'], ['description', 'Page description']].map(([field, label]) => <div key={field}><div className="mb-1 flex items-center justify-between gap-2"><p className="text-xs text-muted-foreground">{label}</p><Button size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label={`Copy saved ${field} for ${item.label}`} onClick={() => copyDraft(task.draft[field], label)}><Copy className="h-4 w-4" aria-hidden="true" /></Button></div><p className="whitespace-pre-wrap break-words text-sm">{task.draft[field]}</p></div>)}{earlier && <p className="text-xs leading-relaxed text-muted-foreground">This is earlier wording. Analyze again before using it to confirm a new title or description change.</p>}</div>}
        <TaskControls task={task} busy={busy} onStatus={onStatus} />
      </div>
    </details>
  </article>;
}

export default function SavedPagePlan({ plan, busy, savingStatus, error, onStatus, onReload }) {
  const current = plan.tasks.filter(task => task.status === 'todo');
  const earlier = plan.tasks.filter(task => task.status === 'needs_review');
  const history = plan.tasks.filter(task => ['done', 'dismissed'].includes(task.status));
  return <section aria-label="Saved page tasks" className="mb-6 space-y-5 rounded-xl border bg-card p-5 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-xl font-semibold"><ListChecks className="h-5 w-5" aria-hidden="true" />Your saved task list</h2><p className="mt-1 break-words text-sm text-muted-foreground">{pageIdentity(plan.review.evidence.pageUrl)} · {current.length + earlier.length} unfinished {current.length + earlier.length === 1 ? 'task' : 'tasks'}</p></div><p className="text-xs text-muted-foreground">Saved {new Date(plan.updatedAt).toLocaleString()}</p></div>
    <p className="text-sm leading-relaxed text-muted-foreground">Start at the top. You can make several useful changes together. Tasks stay here when you refresh or analyze again.</p>
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button size="sm" variant="outline" disabled={busy} onClick={onReload}>Reload saved tasks</Button></div>}
    {savingStatus && <p role="status" className="text-xs text-muted-foreground">Saving task status…</p>}
    {current.length > 0 ? <div className="space-y-3">{current.map((task, index) => <SavedTask key={task.id} task={task} index={index + 1} expanded={index === 0} busy={busy} onStatus={onStatus} />)}</div> : <p className="rounded-lg border p-4 text-sm">{earlier.length ? 'Review the earlier suggestions below before choosing another edit.' : history.length ? 'No unfinished tasks. Your completed and dismissed tasks are saved below.' : 'This review did not identify a supported edit to add. Read the assessment for what to check next.'}</p>}
    {earlier.length > 0 && <div className="space-y-3"><h3 className="font-semibold">Earlier suggestions to review</h3>{earlier.map((task, index) => <SavedTask key={task.id} task={task} index={current.length + index + 1} busy={busy} onStatus={onStatus} />)}</div>}
    <p className="border-t pt-4 text-xs leading-relaxed text-muted-foreground">Marking a task done only updates this checklist. It does not change your website or start progress tracking. After publishing an edit yourself, use the separate confirmation below to track the change.</p>
    {history.length > 0 && <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Completed and dismissed tasks ({history.length})</summary><div className="mt-4 space-y-3">{history.map(task => <SavedTask key={task.id} task={task} busy={busy} onStatus={onStatus} />)}</div></details>}
  </section>;
}

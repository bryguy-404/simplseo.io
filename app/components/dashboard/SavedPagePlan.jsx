"use client";

import { useId } from 'react';
import { CheckCircle2, Copy, ListChecks } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { propertyContainsUrl } from '../../lib/revampState';
import { ActionBody } from './PageReviewActions';
import { usablePageAssessment } from './PageReviewAssessment';
import { usablePageActivity, usableConfirmedChangeActivity } from './PageSearchActivity';

const priorities = { first: 'Do first', next: 'Do next', optional: 'Optional' };
const statuses = ['todo', 'needs_review', 'done', 'dismissed'];
const actionTypes = ['heading', 'content', 'internal_link', 'technical', 'metadata', 'check'];
const isText = value => typeof value === 'string';
const safeUrl = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; } };

// Fail closed if the saved response belongs to a different page or website version.
export function usableSavedPagePlan(plan, scope) {
  if (!plan || !isText(plan.id) || !plan.id || !Number.isInteger(plan.revision) || plan.revision < 1 || !isText(plan.updatedAt) || !Number.isFinite(Date.parse(plan.updatedAt)) ||
    !usablePageAssessment(plan.review) || !(plan.review.provenance?.reviewVersion === 'follow_up_1' ? typeof plan.followUp?.cycleId === 'string' && typeof plan.followUp?.decisionId === 'string' && usableConfirmedChangeActivity(plan.review, scope) : usablePageActivity({ success: true, evidence: plan.review.evidence, provenance: plan.review.provenance }, scope)) ||
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

export function isPublishedTask(task, pageUrl) {
  const publication = task?.publication;
  return task?.status === 'done' && publication?.confirmationMethod === 'user-confirmed' && publication.changeType === 'page_content' &&
    publication.pageUrl === pageUrl && typeof publication.implementationId === 'string' && Boolean(publication.implementationId) &&
    typeof publication.implementedAt === 'string' && Number.isFinite(Date.parse(publication.implementedAt));
}

export function isSelectableEdit(task, pageUrl) {
  return task && ['todo', 'done'].includes(task.status) && ['heading', 'content', 'internal_link', 'technical', 'metadata'].includes(task.recommendation?.type) && !isPublishedTask(task, pageUrl);
}

function TaskControls({ task, pageUrl, busy, onStatus, selected, onTogglePublished, tracking }) {
  const id = useId();
  if (tracking || isPublishedTask(task, pageUrl)) return null;
  const closed = ['done', 'dismissed'].includes(task.status);
  return <div className="space-y-3 border-t pt-4">
    {isSelectableEdit(task, pageUrl) && <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-800 dark:bg-emerald-950/20"><Checkbox id={id} checked={selected} disabled={busy || !onTogglePublished} onCheckedChange={checked => onTogglePublished?.(task.id, checked === true)} /><Label htmlFor={id} className="leading-5">I published this edit</Label></div>}
    <div className="flex flex-wrap gap-2">
      {closed ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(task.id, 'todo')}>Reopen task</Button> : <>
        {task.status === 'needs_review' && <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(task.id, 'todo')}>This still applies</Button>}
        {task.status === 'todo' && task.recommendation.type === 'check' && <Button size="sm" variant="outline" disabled={busy} onClick={() => onStatus(task.id, 'done')}><CheckCircle2 className="mr-2 h-4 w-4" aria-hidden="true" />Mark check complete</Button>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus(task.id, 'dismissed')}>Dismiss</Button>
      </>}
    </div>
  </div>;
}

function SavedTask({ task, pageUrl, index, expanded = false, busy, onStatus, selected, onTogglePublished, tracking }) {
  const item = task.recommendation;
  const earlier = task.status === 'needs_review';
  const closed = ['done', 'dismissed'].includes(task.status);
  const published = isPublishedTask(task, pageUrl);
  const copyDraft = async (value, field) => {
    try { await navigator.clipboard.writeText(value); toast.success(`${field} copied`); }
    catch { toast.error('Copy failed. You can select and copy the wording yourself.'); }
  };
  return <article aria-label={item.label} className={`overflow-hidden rounded-xl border bg-background/80 ${earlier ? 'border-amber-300 dark:border-amber-800' : selected ? 'border-emerald-400 dark:border-emerald-700' : task.priority === 'first' && !closed && !tracking ? 'border-violet-300 dark:border-violet-700' : ''}`}>
    <details className="p-4 md:p-5" open={expanded && !tracking || undefined}>
      <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className={`text-xs font-semibold uppercase tracking-wide ${published ? 'text-emerald-800 dark:text-emerald-200' : earlier ? 'text-amber-800 dark:text-amber-200' : 'text-muted-foreground'}`}>{published ? 'Published' : closed ? task.status === 'done' ? 'Checklist complete' : 'Dismissed' : earlier ? 'Check before using' : priorities[task.priority]}</span>
        <h3 className="mt-1 text-base font-semibold md:text-lg">{index ? `${index}. ` : ''}{item.label}</h3>
      </summary>
      <div className="mt-4 space-y-4">
        {(earlier || task.retained) && <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-200">{earlier ? 'Your page changed. Check this earlier suggestion before using it.' : 'Saved from an earlier review. Check that it still fits.'}</p>}
        {published && <p className="text-xs text-muted-foreground">Publication confirmed {new Date(task.publication.implementedAt).toLocaleDateString()}.</p>}
        <ActionBody item={item} facts={task.facts} sources={task.sources} compact />
        {item.type === 'metadata' && task.draft && <div className="space-y-3 rounded-lg border border-violet-200 bg-violet-50 p-4 dark:border-violet-800 dark:bg-violet-950/20">{[['title', 'Suggested title'], ['description', 'Suggested description']].map(([field, label]) => <div key={field}><div className="mb-1 flex items-center justify-between gap-2"><p className="text-xs font-semibold">{label}</p><Button size="icon" variant="outline" className="h-8 w-8 shrink-0" aria-label={`Copy saved ${field} for ${item.label}`} onClick={() => copyDraft(task.draft[field], label)}><Copy className="h-4 w-4" aria-hidden="true" /></Button></div><p className="whitespace-pre-wrap break-words text-sm">{task.draft[field]}</p></div>)}</div>}
        <TaskControls task={task} pageUrl={pageUrl} busy={busy} onStatus={onStatus} selected={selected} onTogglePublished={onTogglePublished} tracking={tracking} />
      </div>
    </details>
  </article>;
}

export default function SavedPagePlan({ plan, busy, savingStatus, error, onStatus, onReload, selectedTaskIds = [], onTogglePublished, tracking = false }) {
  const pageUrl = plan.review.evidence.pageUrl;
  const current = plan.tasks.filter(task => task.status === 'todo');
  const earlier = plan.tasks.filter(task => task.status === 'needs_review');
  const history = plan.tasks.filter(task => ['done', 'dismissed'].includes(task.status));
  const renderTask = (task, index, expanded = false) => <SavedTask key={task.id} task={task} pageUrl={pageUrl} index={index} expanded={expanded} busy={busy} onStatus={onStatus} selected={selectedTaskIds.includes(task.id)} onTogglePublished={onTogglePublished} tracking={tracking} />;
  const activeTasks = <>
    {current.length > 0 && <div className="space-y-3">{current.map((task, index) => renderTask(task, index + 1, index === 0))}</div>}
    {earlier.length > 0 && <div className="space-y-3"><h3 className="text-sm font-semibold">Earlier suggestions to review</h3>{earlier.map((task, index) => renderTask(task, current.length + index + 1))}</div>}
  </>;
  return <section aria-label="Saved page tasks" className="mb-6 space-y-4 rounded-xl border bg-card p-5 md:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><h2 id="page-tasks-heading" tabIndex={-1} className="flex items-center gap-2 text-xl font-semibold"><ListChecks className="h-5 w-5" aria-hidden="true" />{tracking ? current.length + earlier.length > 0 ? 'Saved ideas' : 'Your saved changes' : 'Your next changes'}</h2><span className="text-xs text-muted-foreground">{current.length + earlier.length} remaining · Saved</span></div>
    {!tracking && current.length > 0 && <p className="text-sm text-muted-foreground">Make the edits on your website, then select the ones you published.</p>}
    {error && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{error}</p><Button size="sm" variant="outline" disabled={busy} onClick={onReload}>Reload saved tasks</Button></div>}
    {savingStatus && <p role="status" className="text-xs text-muted-foreground">Saving task status…</p>}
    {tracking && current.length + earlier.length > 0 ? <details><summary className="cursor-pointer text-sm font-medium">Other saved ideas ({current.length + earlier.length})</summary><div className="mt-4 space-y-3">{activeTasks}</div></details> : activeTasks}
    {!current.length && !earlier.length && !history.length && <p className="text-sm text-muted-foreground">No supported edit identified. See the analysis for what to check next.</p>}
    {history.length > 0 && <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Completed and dismissed ({history.length})</summary><div className="mt-4 space-y-3">{history.map(task => renderTask(task))}</div></details>}
  </section>;
}

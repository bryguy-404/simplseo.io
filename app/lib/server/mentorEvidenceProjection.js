// Projections for model context only. Never write these excerpts back to saved
// plans: owners' copy, complete evidence and measurement history stay intact.
const copy = (value, keys) => Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
const tally = values => values.reduce((counts, value) => ({ ...counts, [value || 'unknown']: (counts[value || 'unknown'] || 0) + 1 }), {});

export function mentorProjection(value, { textLimit = 240, arrayLimit = 6 } = {}) {
  const excerptedFields = [];
  const visit = (item, path) => {
    if (typeof item === 'string') {
      // A shortened address could name a different resource. Omit an unusually
      // long address rather than manufacturing a usable but incorrect link.
      if (/^(?:https?:\/\/|\/)/.test(item) && /(?:url|href|link)$/i.test(path)) {
        if (item.length > 2048) { excerptedFields.push(path); return null; }
        return item;
      }
      if (item.length > textLimit) excerptedFields.push(path);
      return item.slice(0, textLimit);
    }
    if (Array.isArray(item)) {
      if (item.length > arrayLimit) excerptedFields.push(path);
      return item.slice(0, arrayLimit).map((child, index) => visit(child, `${path}[${index}]`));
    }
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, visit(child, path ? `${path}.${key}` : key)]));
    return item;
  };
  return { value: visit(value, ''), excerptedFields };
}

export function projectMentorPlan(plan) {
  if (!plan) return null;
  const allTasks = plan.tasks || [];
  const selected = allTasks.slice(0, 6).map(task => ({
    ...copy(task, ['id', 'status', 'priority', 'retained', 'statusUpdatedAt', 'needsReviewReason']),
    recommendation: copy(task.recommendation, ['type', 'basis', 'label', 'location', 'reason', 'instruction', 'proposedText', 'targetUrl']),
    // This is the current saved draft, including owner edits, not a fresh copy
    // of the older generated recommendation.
    ...(task.draft !== undefined ? { draft: task.draft } : {}),
    ...(task.publication ? { publication: copy(task.publication, ['implementedAt', 'pageUrl', 'cycleId', 'recordId']) } : {}),
  }));
  const projected = mentorProjection({ ...copy(plan, ['id', 'revision', 'updatedAt']), tasks: selected,
    analysis: { ...copy(plan.review?.analysis, ['action', 'metadataVerdict', 'metadataReason', 'summary']),
      searchFocus: copy(plan.review?.analysis?.searchFocus, ['phrase', 'source', 'intent', 'reason']) } }, { textLimit: 180 });
  return { ...projected.value, tasksLimited: allTasks.length > selected.length, totalTasks: allTasks.length,
    taskStatusCounts: tally(allTasks.map(task => task.status)),
    projection: { excerptedFields: projected.excerptedFields, omitted: ['Repeated task evidence bodies', 'Duplicate analysis recommendations and strategy'],
      fullSavedWork: 'Use the Improve this page link for complete tasks and exact copy. Excerpts are not finished replacement text.' } };
}

export function projectMentorPage(content) {
  if (!content) return null;
  const page = { htmlTitle: content.htmlTitle || '', metaDescription: content.seoMetaDescription || '',
    headings: (content.headings || []).slice(0, 4).map(heading => typeof heading === 'string' ? heading : copy(heading, ['tag', 'text'])),
    content: (content.textContent || '').slice(0, 1000) };
  const projected = mentorProjection(page, { textLimit: 300 });
  return { ...projected.value, projection: { partialExcerpt: true, excerptedFields: projected.excerptedFields,
    headingDetailsOmitted: true, fullContentCharacters: content.textContent?.length || 0 } };
}

export function projectMentorTechnical(check) {
  if (!check) return null;
  const observation = result => !result ? null : ({ ...copy(result, ['pageUrl', 'checkedAt']),
    website: result.website ? { ...copy(result.website, ['status', 'httpStatus', 'message', 'fetchedAt', 'finalUrl']),
      technical: copy(result.website.technical, ['httpStatus', 'redirected', 'canonicalUrl', 'canonicalStatus', 'canonicalInProperty', 'noindex']),
      limitations: result.website.limitations } : null,
    indexing: result.indexing ? { ...copy(result.indexing, ['status', 'observedAt', 'inspectionResultLink', 'message']),
      indexStatusResult: copy(result.indexing.indexStatusResult, ['verdict', 'coverageState', 'robotsTxtState', 'indexingState', 'pageFetchState', 'lastCrawlTime', 'googleCanonical', 'userCanonical']) } : null });
  const projected = mentorProjection({ ...copy(check, ['lastError', 'lastAttemptAt', 'lastSuccessAt']),
    result: observation(check.result), failedObservation: observation(check.failedObservation) }, { textLimit: 300 });
  return { ...projected.value, projection: { excerptedFields: projected.excerptedFields, detailedTransportOmitted: true } };
}

export function projectMentorCycle(cycle, publicDecision) {
  const observation = value => value ? copy(value, ['window', 'startDate', 'endDate', 'status', 'clicks', 'impressions', 'ctr', 'position', 'fetchedAt', 'observedAt', 'source', 'queriesStatus', 'queryCoverage']) : value;
  const checkpoint = value => value ? { ...copy(value, ['id', 'day', 'evidenceRevision', 'state', 'reason', 'window', 'windows', 'comparison', 'observedAt', 'collectedAt', 'lowVolume', 'limitation', 'source']),
    baseline: observation(value.baseline), post: observation(value.post) } : value;
  const projected = mentorProjection({ ...copy(cycle, ['id', 'revision', 'lifecycle', 'confirmedAt', 'reviewStatus', 'nextReviewAt', 'lastError', 'lastSuccessAt', 'previousCycleId', 'supersededAt']),
    confirmation: copy(cycle.confirmation, ['summary', 'taskLabels', 'interveningChange', 'searchFocus']),
    originalComparison: checkpoint(cycle.originalComparison), latestCheckpoint: checkpoint(cycle.latestCheckpoint),
    technical: cycle.technical ? { ...copy(cycle.technical, ['checkedAt', 'errors', 'issues']),
      publicPage: copy(cycle.technical.publicPage, ['status', 'checkedAt', 'finalUrl', 'httpStatus', 'canonicalUrl', 'noindex']),
      indexing: copy(cycle.technical.indexing, ['status', 'checkedAt', 'verdict', 'coverageState', 'indexingState', 'pageFetchState', 'robotsTxtState', 'googleCanonical', 'userCanonical', 'lastCrawlTime', 'limitation']) } : null,
    latestDecision: publicDecision ? copy(publicDecision, ['id', 'decision', 'outcome', 'summary', 'whatChanged', 'meaning', 'nextStep', 'nextReviewAt', 'canAcceptTasks']) : publicDecision,
  }, { textLimit: 240, arrayLimit: 4 });
  return { ...projected.value, projection: { excerptedFields: projected.excerptedFields, queryRowsAndDetailedEvidenceOmitted: true } };
}

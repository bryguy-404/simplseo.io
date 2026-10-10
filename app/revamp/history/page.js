"use client";
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { authenticatedFetch } from '../../lib/authenticatedFetch';
const labels = { implementedSeoTips: 'SEO changes', contentAuditResults: 'Content audit', aiSuggestions: 'Suggestions', focusKeywords: 'Focus keywords' };
const label = key => key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
function HistoricalValue({ value, depth = 0 }) {
  if (value == null || depth > 5) return null;
  if (typeof value !== 'object') return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
  if (Array.isArray(value)) return <ul className="list-disc pl-5 space-y-2">{value.map((item, index) => <li key={index}><HistoricalValue value={item} depth={depth + 1} /></li>)}</ul>;
  return <dl className="space-y-2">{Object.entries(value).filter(([key]) => !/^(userId|preRevamp|revampRun|cacheKey|gsc|sourceId)/i.test(key)).map(([key, item]) => <div key={key}><dt className="font-medium">{label(key)}</dt><dd className="text-muted-foreground"><HistoricalValue value={item} depth={depth + 1} /></dd></div>)}</dl>;
}
export default function HistoryPage() {
  const [runs, setRuns] = useState([]), [records, setRecords] = useState([]), [error, setError] = useState('');
  const load = async runId => {
    try {
      const res = await authenticatedFetch(`/api/revamp/history${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`);
      const data = await res.json(); if (!res.ok) throw new Error(data.error);
      if (runId) setRecords(data.records); else setRuns(data.runs);
    } catch (e) { setError(e.message); }
  };
  useEffect(() => { load(); }, []);
  return <main className="max-w-4xl mx-auto p-6 space-y-5"><Link href="/dashboard" className="underline">Back to dashboard</Link><h1 className="text-3xl font-semibold">Previous website work</h1><p>Read-only records saved before a website update. Historical performance metrics are unverified and should not be treated as proven results.</p>{error && <p role="alert">{error}</p>}{!runs.length && <p>No completed history snapshots are available yet. Records already overwritten before recovery cannot be reconstructed.</p>}{runs.map(run => <button key={run.id} className="block underline" onClick={() => load(run.id)}>Website update · {run.completedAt ? new Date(run.completedAt).toLocaleDateString() : 'Saved history'}</button>)}{records.map(record => <details key={record.id} className="border rounded p-3"><summary>{labels[record.collection] || 'Previous work'}{record.data.pageUrl ? ` · ${record.data.pageUrl}` : ''}</summary><div className="mt-4 text-sm"><HistoricalValue value={record.data} /></div></details>)}</main>;
}

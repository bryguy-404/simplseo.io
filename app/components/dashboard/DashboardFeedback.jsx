"use client";

import { useEffect, useRef, useState } from 'react';
import FeedbackCard from './FeedbackCard';
import { toast } from 'sonner';
import { authenticatedFetch } from '../../lib/authenticatedFetch';

const featurePages = new Set(['/low-ctr', '/generic-keywords', '/chatbot']);

async function requestFeedback(userId, action, data = {}) {
  const response = await authenticatedFetch('/api/dashboard/feedback', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, userId, ...data }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Please try again.');
  return result;
}

export default function DashboardFeedback({ userId, pathname, overviewReady, manual, onCloseManual }) {
  const [promptId, setPromptId] = useState(null);
  const manualOpened = useRef(false);
  useEffect(() => {
    if (manual) manualOpened.current = true;
  }, [manual]);
  useEffect(() => {
    if (featurePages.has(pathname)) {
      requestFeedback(userId, 'feature').catch(() => {});
      return;
    }
    if (!overviewReady || pathname !== '/dashboard') return;
    let active = true;
    const timer = setTimeout(async () => {
      if (manualOpened.current) return;
      try {
        const result = await requestFeedback(userId, 'visit');
        if (active && !manualOpened.current) setPromptId(result.promptId || null);
      } catch { /* A prompt check must not interrupt the dashboard. */ }
    }, 400);
    return () => { active = false; clearTimeout(timer); };
  }, [userId, pathname, overviewReady]);

  if (!manual && !promptId) return null;
  function close() {
    setPromptId(null);
    if (manual) onCloseManual();
  }
  return <FeedbackCard manual={manual} onClose={async () => {
    close();
    if (promptId) {
      try { await requestFeedback(userId, 'dismiss', { promptId }); }
      catch { toast.error('Feedback closed. Your reminder preference could not be saved.'); }
    }
  }} onSend={async data => {
    await requestFeedback(userId, 'submit', data);
    close();
    toast.success('Thanks for sharing your feedback!');
  }} />;
}

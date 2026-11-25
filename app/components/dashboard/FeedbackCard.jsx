"use client";

import { useEffect, useRef, useState } from 'react';
import { Frown, Meh, MessageCircle, Smile, X } from 'lucide-react';

const choices = [['Great', Smile], ['Okay', Meh], ['Frustrating', Frown]];

export default function FeedbackCard({ manual, onClose, onSend }) {
  const [rating, setRating] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const heading = useRef(null);
  const submissionId = useRef(null);

  useEffect(() => { if (manual) heading.current?.focus({ preventScroll: true }); }, [manual]);

  async function perform(action) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError(failure.message || 'Please try again.'); }
    finally { setBusy(false); }
  }

  return <aside aria-labelledby="dashboard-feedback-heading"
    className="fixed bottom-24 left-3 right-3 z-50 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-border bg-card p-5 text-card-foreground shadow-[0_12px_48px_-14px_rgba(16,45,31,0.35)] sm:bottom-6 sm:left-6 sm:right-auto sm:w-[360px]">
    <div className="mb-3 flex items-center justify-between">
      <span className="grid size-9 place-items-center rounded-xl bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"><MessageCircle className="size-5" aria-hidden="true" /></span>
      <button type="button" aria-label="Close feedback" disabled={busy} onClick={() => perform(onClose)} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
    </div>
    <h2 id="dashboard-feedback-heading" ref={heading} tabIndex={-1} className="text-lg font-semibold leading-snug tracking-tight">How’s SimplSEO working for you?</h2>
    <p className="mt-1 text-sm text-muted-foreground">We’d love to hear what’s working and what we could do better.</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!rating) return;
      submissionId.current ??= crypto.randomUUID();
      setAttempted(true);
      perform(() => onSend({ submissionId: submissionId.current, rating, comment }));
    }}>
      <fieldset disabled={busy || attempted} className="mt-4 grid grid-cols-[1fr_1fr_1.24fr] gap-2">
        <legend className="sr-only">How’s SimplSEO working for you?</legend>
        {choices.map(([value, Icon]) => <label key={value} className="relative cursor-pointer">
          <input type="radio" name="dashboard-rating" value={value} checked={rating === value} onChange={() => setRating(value)} className="peer sr-only" />
          <span className="flex h-11 items-center justify-center gap-1.5 rounded-lg border text-sm font-medium peer-checked:border-emerald-600 peer-checked:bg-emerald-50 peer-checked:text-emerald-900 peer-focus-visible:ring-2 peer-focus-visible:ring-ring dark:peer-checked:bg-emerald-950 dark:peer-checked:text-emerald-200">
            <Icon aria-hidden="true" className="size-4" />{value}
          </span>
        </label>)}
      </fieldset>
      <label htmlFor="dashboard-feedback-comment" className="mt-4 block text-sm font-medium">What’s one thing we could make easier?</label>
      <textarea id="dashboard-feedback-comment" placeholder="Optional" maxLength={2000} rows={2} value={comment} readOnly={busy || attempted}
        onChange={event => setComment(event.target.value)} className="mt-2 block w-full resize-none rounded-lg border bg-background px-3 py-2 text-base placeholder:text-muted-foreground sm:text-sm" />
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-4 flex items-center justify-between gap-2">
        <button type="button" disabled={busy} onClick={() => perform(onClose)} className="min-h-10 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-muted">{manual ? 'Close' : 'Maybe later'}</button>
        <button type="submit" disabled={!rating || busy} className="min-h-10 rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">{busy ? 'Saving…' : attempted ? 'Retry sending' : 'Send feedback'}</button>
      </div>
    </form>
  </aside>;
}

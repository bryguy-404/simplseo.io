"use client";

import { useEffect, useRef, useState } from 'react';
import { Frown, Meh, Smile, X } from 'lucide-react';
import FeedbackDot from './FeedbackDot';

const choices = [['Great', Smile], ['Okay', Meh], ['Frustrating', Frown]];

// What the dot in the card's corner says. It is decoration: the card's own
// heading, labels and status text carry everything a customer needs.
const dotQuips = { Great: 'Yes! Love that.', Okay: 'Hmm, okay. Noted.', Frustrating: 'Oof. Tell me more?' };
const thanks = {
  Great: 'You made the dot’s day. Thank you!',
  Okay: 'Thank you! That’s how we get better.',
  Frustrating: 'Thank you for being straight with us.',
};
// Long enough for the dot's send-off to finish and the thank-you to be read.
const SENT_CLOSE_MS = 4200;

/**
 * onClose: the customer put the card away without answering.
 * onSend: saves the answer; rejects with a readable message if it could not.
 * onDone: the answer is saved and the thank-you has been shown.
 */
export default function FeedbackCard({ manual, onClose, onSend, onDone }) {
  const [rating, setRating] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [sent, setSent] = useState(false);
  // These four only steer the dot.
  const [hovered, setHovered] = useState('');
  const [listening, setListening] = useState(false);
  const [eager, setEager] = useState(false);
  const [nod, setNod] = useState(0);
  const heading = useRef(null);
  const confetti = useRef(null);
  const submissionId = useRef(null);
  const done = useRef(onDone);
  // A retry must resend exactly what was first sent, so the answer locks.
  const locked = busy || attempted;

  useEffect(() => { done.current = onDone; }, [onDone]);
  useEffect(() => { if (manual) heading.current?.focus({ preventScroll: true }); }, [manual]);
  useEffect(() => {
    if (!sent) return;
    const timer = window.setTimeout(() => done.current?.(), SENT_CLOSE_MS);
    return () => window.clearTimeout(timer);
  }, [sent]);

  async function perform(action) {
    if (busy) return;
    setBusy(true);
    setError('');
    try { await action(); }
    catch (failure) { setError(failure.message || 'Please try again.'); }
    finally { setBusy(false); }
  }

  function dismiss() {
    if (sent) onDone?.();
    else perform(onClose);
  }

  // A frustrated customer gets a quiet thank-you, not a party.
  const scene = !sent ? 'form' : rating === 'Frustrating' ? 'bow' : 'cheer';
  const leaning = eager && !!rating && !busy;
  const quip = busy ? 'One sec…'
    : error ? 'Uh-oh.'
    : leaning ? 'Send it!'
    : hovered ? dotQuips[hovered]
    : listening ? (comment ? 'Mm-hm, go on.' : 'I’m listening…')
    : rating ? dotQuips[rating]
    : 'Psst… got a sec?';

  return <aside aria-label="Product feedback"
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); dismiss(); } }}
    className="fixed bottom-24 left-3 right-3 z-50 max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-[22px] border border-border bg-card p-5 text-card-foreground shadow-[0_12px_48px_-14px_rgba(16,45,31,0.35)] sm:bottom-6 sm:left-6 sm:right-auto sm:w-[23rem] sm:p-6">
    <div className="flex items-center justify-between">
      <FeedbackDot mood={hovered || rating || 'idle'} scene={scene} eager={leaning} listening={listening} quip={quip} nod={nod} confetti={confetti} />
      <button type="button" aria-label="Close feedback" disabled={busy} onClick={dismiss} className="relative z-10 grid size-9 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
    </div>
    {sent
      // The top margin leaves room for the dot, which performs just above.
      ? <div className="mt-[52px] text-center">
        <p role="status" className="text-lg font-semibold">{thanks[rating] || thanks.Okay}</p>
        <p className="mt-1 text-sm text-muted-foreground">Your note is on its way to our team.</p>
      </div>
      : <form onSubmit={event => {
        event.preventDefault();
        if (!rating) return;
        submissionId.current ??= crypto.randomUUID();
        setAttempted(true);
        perform(async () => {
          await onSend({ submissionId: submissionId.current, rating, comment });
          setSent(true);
        });
      }}>
        <h2 id="dashboard-feedback-heading" ref={heading} tabIndex={-1} className="mt-3 max-w-[19rem] text-[23px] font-bold leading-tight tracking-tight outline-none">How’s SimplSEO working for you so far?</h2>
        <p className="mt-1.5 text-sm text-muted-foreground">Be honest, the dot can take it. Pick a face, hit send, and it’ll put on a little show.</p>
        <fieldset aria-labelledby="dashboard-feedback-heading" disabled={locked} className="mt-4 grid grid-cols-3 gap-2">
          {choices.map(([value, Icon]) => <label key={value} className="cursor-pointer"
            onPointerEnter={() => { if (!locked) setHovered(value); }} onPointerLeave={() => setHovered('')}>
            <input type="radio" name="dashboard-rating" value={value} checked={rating === value} onChange={() => setRating(value)} className="peer sr-only" />
            <span className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl border py-2 text-xs font-semibold text-muted-foreground hover:bg-muted peer-checked:border-emerald-600 peer-checked:bg-emerald-50 peer-checked:text-emerald-800 peer-focus-visible:ring-2 peer-focus-visible:ring-ring dark:peer-checked:border-emerald-500 dark:peer-checked:bg-emerald-950 dark:peer-checked:text-emerald-200">
              <Icon aria-hidden="true" className="size-[19px]" strokeWidth={1.7} />{value}
            </span>
          </label>)}
        </fieldset>
        <label htmlFor="dashboard-feedback-comment" className="mt-4 block text-sm font-semibold">What’s one thing we could make easier? <span className="text-xs font-normal text-muted-foreground">(optional)</span></label>
        <textarea id="dashboard-feedback-comment" maxLength={2000} rows={2} value={comment} readOnly={locked}
          onChange={event => { setComment(event.target.value); setNod(count => count + 1); }}
          onFocus={() => setListening(true)} onBlur={() => setListening(false)}
          className="mt-1.5 block w-full resize-y rounded-xl border bg-transparent px-3 py-2 text-base focus:outline-2 focus:outline-emerald-600 sm:text-sm" />
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-4 flex items-center justify-between gap-3">
          <button type="button" disabled={busy} onClick={dismiss} className="min-h-10 py-2 text-sm text-muted-foreground hover:underline">{manual ? 'Cancel' : 'Maybe later'}</button>
          <button type="submit" disabled={!rating || busy}
            onPointerEnter={() => setEager(true)} onPointerLeave={() => setEager(false)} onFocus={() => setEager(true)} onBlur={() => setEager(false)}
            className="min-h-10 rounded-full bg-emerald-700 px-6 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-[#00bf63] dark:text-[#06281a] dark:hover:bg-[#00a857]">{busy ? 'Saving…' : attempted ? 'Retry sending' : 'Send feedback'}</button>
        </div>
      </form>}
    {/* The cheer's confetti is drawn here, so it stays inside the card. */}
    <canvas ref={confetti} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
  </aside>;
}

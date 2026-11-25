"use client";

import { useEffect, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MentorMark } from './MentorMessage';

// The floating SEO Mentor button, with a quiet one-time nudge.
//
// The nudge appears once per browser session, after the person has been on a
// page for a little while, and then leaves on its own. It never bounces or
// repeats: the goal is to be noticed once, not to nag.

const nudges = [
  { path: '/dashboard', lines: ['Want these numbers explained in plain English?', 'Not sure what to work on next? Ask me.'] },
  { path: '/low-ctr', lines: ['Stuck on this page? Let’s talk it through.', 'Want a second opinion on this page?'] },
  { path: '/generic-keywords', lines: ['Not sure which page idea to pick? Ask me.', 'Want help choosing your next page?'] },
  { path: '/settings', lines: ['Wondering what a setting does? Just ask.'] },
];
const anywhere = ['Stuck on something? Ask your mentor.', 'Got an SEO question? I’m right here.', 'Not sure what something means? Just ask.'];

function nudgeFor(pathname) {
  const lines = nudges.find(item => pathname === item.path || pathname.startsWith(`${item.path}/`))?.lines || anywhere;
  return lines[Math.floor(Math.random() * lines.length)];
}

const SEEN = 'mentorNudgeShown';

export default function MentorLauncher({ open, onOpenChange, pathname = '', nudgeDelay = 20000, nudgeDuration = 12000, children }) {
  const [nudge, setNudge] = useState('');

  useEffect(() => {
    if (open) { setNudge(''); return; }
    let seen = false;
    try { seen = sessionStorage.getItem(SEEN) === '1'; } catch { /* Private mode: show it once per page instead. */ }
    if (seen) return;
    const timer = setTimeout(() => {
      setNudge(nudgeFor(pathname));
      try { sessionStorage.setItem(SEEN, '1'); } catch { /* ignore */ }
    }, nudgeDelay);
    return () => clearTimeout(timer);
  }, [open, pathname, nudgeDelay]);

  useEffect(() => {
    if (!nudge) return;
    const timer = setTimeout(() => setNudge(''), nudgeDuration);
    return () => clearTimeout(timer);
  }, [nudge, nudgeDuration]);

  const showNudge = Boolean(nudge) && !open;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {showNudge ? (
          <div className="flex max-w-[min(18rem,calc(100vw-3rem))] items-center gap-2.5 rounded-2xl rounded-br-md border border-border bg-popover py-2 pl-3 pr-1.5 text-sm text-popover-foreground shadow-xl animate-[mentor-nudge-in_0.45s_cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:animate-none">
            <MentorMark className="h-6 w-6" />
            <button type="button" className="min-w-0 flex-1 text-left leading-snug" onClick={() => onOpenChange(true)}>{nudge}</button>
            <button type="button" aria-label="Dismiss mentor tip" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" onClick={() => setNudge('')}><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
          </div>
        ) : null}
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={open ? 'Close SEO Mentor' : 'Open SEO Mentor'}
            className="relative grid h-14 w-14 place-items-center rounded-full bg-gradient-to-b from-[#12cf72] to-[#00a857] text-white shadow-[0_12px_28px_-10px_rgba(0,168,87,0.75),inset_0_1px_0_rgba(255,255,255,0.28)] outline-none transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-10px_rgba(0,168,87,0.85),inset_0_1px_0_rgba(255,255,255,0.28)] focus-visible:ring-4 focus-visible:ring-[#00bf63]/35 active:translate-y-0 active:scale-95 motion-reduce:transition-none"
          >
            {/* Two soft rings ripple out from the button when the nudge appears. */}
            {showNudge ? <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full border-2 border-[#00bf63] opacity-0 animate-[mentor-ring_1.8s_ease-out_2] motion-reduce:hidden" /> : null}
            <MessageCircle aria-hidden="true" className={`absolute h-6 w-6 transition-[transform,opacity] duration-300 motion-reduce:transition-none ${open ? 'rotate-90 scale-50 opacity-0' : ''}`} />
            <X aria-hidden="true" className={`absolute h-6 w-6 transition-[transform,opacity] duration-300 motion-reduce:transition-none ${open ? '' : '-rotate-90 scale-50 opacity-0'}`} />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent
        side="top"
        align="end"
        collisionPadding={16}
        sideOffset={14}
        className="z-[60] w-[calc(100vw-2rem)] max-w-[442px] overflow-hidden rounded-2xl border border-border bg-background p-0 shadow-2xl"
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

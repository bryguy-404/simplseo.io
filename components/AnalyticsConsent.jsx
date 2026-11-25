"use client";

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from './AnalyticsConsent.module.css';

// The analytics choice card, with the green dot from the logo as its mascot.
//
// The dot peeks over the card and watches the pointer. If the visitor allows
// analytics it hops along the card and does a spin; if they decline it gives a
// small nod and ducks away. Both buttons carry the same weight on purpose: the
// show is a thank-you, not pressure. The choice itself is recorded the moment a
// button is pressed; only the card's exit waits for the animation.

const SHOW_MS = 2300;
const BYE_MS = 420;

export default function AnalyticsConsent({ onChoose, onDone }) {
  const [state, setState] = useState('idle'); // idle | show | bye
  const [eager, setEager] = useState(false);
  const dot = useRef(null);
  const eyes = useRef(null);

  // The eyes follow the pointer a little.
  useEffect(() => {
    if (state !== 'idle') return;
    const look = event => {
      const box = dot.current?.getBoundingClientRect();
      if (!box || !eyes.current) return;
      const dx = event.clientX - (box.left + box.width / 2), dy = event.clientY - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1, reach = Math.min(1, distance / 160) * 2.6;
      eyes.current.style.transform = `translate(${(dx / distance) * reach}px, ${(dy / distance) * reach}px)`;
    };
    window.addEventListener('pointermove', look, { passive: true });
    return () => window.removeEventListener('pointermove', look);
  }, [state]);

  const choose = choice => {
    if (state !== 'idle') return;
    onChoose(choice);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onDone(); return; }
    if (eyes.current) eyes.current.style.transform = '';
    setState(choice === 'granted' ? 'show' : 'bye');
    window.setTimeout(onDone, choice === 'granted' ? SHOW_MS : BYE_MS);
  };

  return <section aria-label="Analytics choices" className={`${styles.wrap} fixed bottom-4 left-4 right-4 z-50 sm:right-auto sm:w-[25rem]`} data-state={state} data-eager={eager || undefined}>
    <div className={styles.track} aria-hidden="true">
      <div className={styles.runner}>
        <div className={styles.hopper}>
          <div ref={dot} className={styles.dot}>
            <span ref={eyes} className={styles.eyes}><i /><i /></span>
          </div>
          <span className={styles.sparks}>{Array.from({ length: 8 }, (_, index) => <i key={index} style={{ '--turn': `${index * 45}deg` }} />)}</span>
        </div>
      </div>
    </div>
    <div className={`${styles.card} rounded-2xl border border-border bg-background p-5 text-foreground shadow-xl`}>
      <p className="text-sm font-semibold">{state === 'show' ? 'Thank you! Enjoy the show.' : 'Help improve SimplSEO'}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Want to see the green dot peeking over this card do a trick? Allow Google Analytics cookies and it’ll put on a quick show.</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Analytics measures visits and useful actions, never your form answers or private SEO content. <Link href="/privacy" className="underline underline-offset-2">Privacy details</Link></p>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <button type="button" disabled={state !== 'idle'} onClick={() => choose('denied')} className="rounded-full border border-border px-3 py-2 text-sm font-medium transition-opacity hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:hover:bg-transparent">No thanks</button>
        <button type="button" disabled={state !== 'idle'} onClick={() => choose('granted')} onPointerEnter={() => setEager(true)} onPointerLeave={() => setEager(false)} onFocus={() => setEager(true)} onBlur={() => setEager(false)} className="rounded-full border border-border px-3 py-2 text-sm font-medium transition-opacity hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:hover:bg-transparent">Allow analytics</button>
      </div>
    </div>
  </section>;
}

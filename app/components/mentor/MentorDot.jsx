"use client";

import { useEffect, useRef, useState } from 'react';
import styles from './MentorDot.module.css';

// The SEO Mentor's face: the green dot from the logo, with eyes. It blinks,
// watches the pointer and now and then does something small on its own (a hop,
// a look around, a happy squint). It also reacts to the conversation through
// `mood`. It is decoration only and hidden from assistive technology.
//
// Moods:
//   idle       nothing is happening; this is when it plays on its own
//   listening  the question box has focus: it looks down at what is typed
//   curious    the question ends in "?": a tilt and one raised eye
//   thinking   a reply is being prepared: it looks up and sways
//   happy      a reply just arrived: a hop with smiling eyes
//   worried    something went wrong: it sags and its eyes droop
//
// The small things it does on its own while idle, and how long each lasts.
const ANTICS = { hop: 700, peek: 1500, joy: 1100, tilt: 1300, spin: 900, bounce: 1000 };
const FIRST_ANTIC_MS = 2600;

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * size: the dot's width in pixels
 * mood: see the list above
 * nod: change this number to make the dot nod once (one nod per keystroke)
 * calm: blinks and watches the pointer, but does nothing on its own
 * antic: play this one right away (used by the local preview)
 */
export default function MentorDot({ size = 32, mood = 'idle', nod = 0, calm = false, antic: forced = '', className = '' }) {
  const dot = useRef(null);
  const gaze = useRef(null);
  const last = useRef('');
  const [antic, setAntic] = useState('');
  const playful = mood === 'idle' && !calm;
  // The eyes are free to wander only when the mood is not pointing them somewhere.
  const follows = mood === 'idle' || mood === 'happy' || mood === 'worried';

  // The eyes follow the pointer a little.
  useEffect(() => {
    if (gaze.current) gaze.current.style.transform = '';
    if (!follows || prefersReducedMotion()) return;
    const look = event => {
      const box = dot.current?.getBoundingClientRect();
      if (!box || !gaze.current) return;
      const dx = event.clientX - (box.left + box.width / 2), dy = event.clientY - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1, reach = Math.min(1, distance / 160) * box.width * 0.072;
      gaze.current.style.transform = `translate(${(dx / distance) * reach}px, ${(dy / distance) * reach}px)`;
    };
    window.addEventListener('pointermove', look, { passive: true });
    return () => window.removeEventListener('pointermove', look);
  }, [follows]);

  // Every few seconds, while nothing else is going on, it does something small.
  useEffect(() => {
    if (!playful || prefersReducedMotion()) { setAntic(''); return; }
    let timer;
    const names = Object.keys(ANTICS);
    const rest = delay => { timer = window.setTimeout(play, delay); };
    const play = () => {
      if (document.hidden) { rest(4000); return; }
      const choices = names.filter(name => name !== last.current);
      const name = choices[Math.floor(Math.random() * choices.length)];
      last.current = name;
      setAntic(name);
      timer = window.setTimeout(() => { setAntic(''); rest(4500 + Math.random() * 4500); }, ANTICS[name]);
    };
    rest(FIRST_ANTIC_MS);
    return () => { window.clearTimeout(timer); setAntic(''); };
  }, [playful]);

  // A small nod for each keystroke.
  useEffect(() => {
    const element = dot.current;
    if (!nod || calm || !element || typeof element.animate !== 'function' || prefersReducedMotion()) return;
    element.animate([
      { transform: 'none' },
      { transform: 'translateY(7%) scale(1.05, 0.94)' },
      { transform: 'none' },
    ], { duration: 190, easing: 'ease-out' });
  }, [nod, calm]);

  // Pointing at it gets a hop.
  const boop = () => {
    if (!playful || antic || prefersReducedMotion()) return;
    last.current = 'hop';
    setAntic('hop');
    window.setTimeout(() => setAntic(current => (current === 'hop' ? '' : current)), ANTICS.hop);
  };

  return <span aria-hidden="true" className={`${styles.mark} ${className}`} style={{ '--s': `${size}px` }}
    data-mood={mood} data-antic={forced || antic || undefined} onPointerEnter={boop}>
    <span className={styles.hopper}>
      <span ref={dot} className={styles.dot}>
        <span ref={gaze} className={styles.gaze}>
          <span className={styles.eyes}><i /><i /></span>
        </span>
      </span>
    </span>
  </span>;
}

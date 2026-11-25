"use client";

import { useEffect, useRef } from 'react';
import { burstConfetti } from './confetti';
import styles from './FeedbackDot.module.css';

// The feedback card's mascot: the green dot from the logo, sitting in the
// card's top corner. It watches the pointer, pulls a face to match the rating
// being picked, listens while a note is typed, and once feedback is sent it
// hops to the middle of the card for a short show. It is decoration only:
// everything it says is hidden from assistive technology and repeats nothing
// the card's own text does not already say.
//
// DOT_BURST_MS is the top of the spinning jump in the `cheer` animation in
// FeedbackDot.module.css.
const DOT_BURST_MS = 1020;

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * mood: "Great" | "Okay" | "Frustrating" | "idle"
 * scene: "form" while the card is open, then "cheer" (a party) or "bow" (a quiet thank-you)
 * eager: leans in, for when the pointer is on the send button
 * listening: looks down at the note being typed
 * quip: what the speech bubble says
 * nod: change this number to make the dot nod once
 * confetti: ref to a canvas covering the card, where the cheer's confetti is drawn
 */
export default function FeedbackDot({ mood, scene, eager, listening, quip, nod, confetti }) {
  const dot = useRef(null);
  const eyes = useRef(null);

  // The eyes follow the pointer a little, unless the dot is busy elsewhere.
  useEffect(() => {
    if (eyes.current) eyes.current.style.transform = '';
    if (scene !== 'form' || listening || prefersReducedMotion()) return;
    const look = event => {
      const box = dot.current?.getBoundingClientRect();
      if (!box || !eyes.current) return;
      const dx = event.clientX - (box.left + box.width / 2), dy = event.clientY - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1, reach = Math.min(1, distance / 160) * 2.6;
      eyes.current.style.transform = `translate(${(dx / distance) * reach}px, ${(dy / distance) * reach}px)`;
    };
    window.addEventListener('pointermove', look, { passive: true });
    return () => window.removeEventListener('pointermove', look);
  }, [scene, listening]);

  // A small nod for each keystroke in the note.
  useEffect(() => {
    const element = dot.current;
    if (!nod || !element || typeof element.animate !== 'function' || prefersReducedMotion()) return;
    element.animate([
      { transform: 'none' },
      { transform: 'translateY(2.5px) scale(1.05, 0.94)' },
      { transform: 'none' },
    ], { duration: 190, easing: 'ease-out' });
  }, [nod]);

  // The cheer ends in confetti that stays inside the card.
  useEffect(() => {
    if (scene !== 'cheer' || prefersReducedMotion()) return;
    let stop = () => {};
    const timer = window.setTimeout(() => {
      const canvas = confetti.current, element = dot.current;
      if (!canvas || !element) return;
      const box = element.getBoundingClientRect(), frame = canvas.getBoundingClientRect();
      stop = burstConfetti(canvas, box.left + box.width / 2 - frame.left, box.top + box.height / 2 - frame.top,
        { pieces: 80, power: 0.5, gravity: 0.5 });
    }, DOT_BURST_MS);
    return () => { window.clearTimeout(timer); stop(); };
  }, [scene, confetti]);

  return <div aria-hidden="true" className={styles.pet} data-mood={mood} data-scene={scene}
    data-eager={eager ? '' : undefined} data-listening={listening ? '' : undefined}>
    <div className={styles.runner}>
      <div className={styles.hopper}>
        <div ref={dot} className={styles.dot}>
          <span ref={eyes} className={styles.eyes}><i /><i /></span>
        </div>
      </div>
    </div>
    {scene === 'form' && quip ? <span key={quip} className={styles.quip}>{quip}</span> : null}
  </div>;
}

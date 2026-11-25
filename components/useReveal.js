"use client";

import { useEffect, useRef, useState } from "react";

// Plays an entrance once, the first time an element scrolls into view.
// Returns a ref and a state to put on the element as `data-state`:
//   "static" - no JavaScript yet, or reduced motion: show the finished result
//   "armed"  - waiting below the fold, hidden and ready to animate
//   "in"     - in view: play the entrance
export default function useReveal({ threshold = 0.3 } = {}) {
  const ref = useRef(null);
  const [state, setState] = useState("static");

  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (node.getBoundingClientRect().top < window.innerHeight * 0.85) {
      setState("in");
      return;
    }
    setState("armed");
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      setState("in");
      observer.disconnect();
    }, { threshold });
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);

  return [ref, state];
}

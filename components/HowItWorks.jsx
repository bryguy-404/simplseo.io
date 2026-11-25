"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Globe2, TrendingUp } from "lucide-react";
import styles from "./HomepageRefinements.module.css";
import flow from "./HowItWorks.module.css";

// The four steps sit on one rising line: each step lifts the curve a little
// further. Coordinates are in the chart's own 1104 x 300 space.
const CHART = { width: 1104, height: 300 };

const steps = [
  { title: "Connect your site", description: "Add your website so SimplSEO can get to know your business and your pages.", x: 14.4, y: 236, at: 0.15 },
  { title: "Find your next step", description: "See what needs attention, with the reason explained in plain English.", x: 297.5, y: 196, at: 0.7 },
  { title: "Make a focused change", description: "Use your mentor’s guidance to update your website, one improvement at a time.", x: 580.7, y: 132, at: 1.25 },
  { title: "Follow your progress", description: "See how your clicks and rankings change, and build on what’s working.", x: 863.9, y: 56, at: 1.85 },
];

// Smooth curve through the step points (Catmull-Rom converted to Béziers).
const linePath = (() => {
  const points = [[-268, 262], ...steps.map((step) => [step.x, step.y]), [CHART.width, 2], [1344, -40]];
  let d = `M${points[1][0]} ${points[1][1]}`;
  for (let i = 1; i < points.length - 2; i++) {
    const [p0, p1, p2, p3] = [points[i - 1], points[i], points[i + 1], points[i + 2]];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0]} ${p2[1]}`;
  }
  return d;
})();
const areaPath = `${linePath} L${CHART.width} ${CHART.height} L${steps[0].x} ${CHART.height} Z`;

const percent = (value, total) => `${((value / total) * 100).toFixed(3)}%`;

function StepNote({ step }) {
  return (
    <span className={flow.note}>
      {step === 0 && <><Globe2 size={13} strokeWidth={1.7} />oakandpine.com<Check size={13} className={flow.noteGood} /></>}
      {step === 1 && <><i className={flow.noteDot} />Page title is unclear</>}
      {step === 2 && <><span className={flow.typed}>Kitchen remodeling in Austin</span><i className={flow.caret} /></>}
      {step === 3 && <><TrendingUp size={13} strokeWidth={1.9} className={flow.noteGood} />Clicks are climbing</>}
    </span>
  );
}

const HowItWorks = () => {
  const diagramRef = useRef(null);
  // "static" is what renders without JavaScript: everything visible, no motion.
  const [state, setState] = useState("static");

  useEffect(() => {
    const node = diagramRef.current;
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
    }, { threshold: 0.3 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="how-it-works" className={`${styles.polish} ${styles.howSection}`} aria-labelledby="how-it-works-title">
      <div className={`section-secondary ${styles.howInner}`}>
        <div className="max-w-6xl mx-auto">
          <div className={flow.head}>
            <p className={styles.eyebrow}>From insight to action</p>
            <h2 id="how-it-works-title" className={styles.sectionTitle}>How it works</h2>
            <p>A simple routine for making your website easier to find.</p>
          </div>

          <div ref={diagramRef} className={flow.diagram} data-state={state}>
            <div className={flow.chart} aria-hidden="true">
              <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} fill="none">
                <defs>
                  <linearGradient id="how-line" gradientUnits="userSpaceOnUse" x1="0" x2={CHART.width} y1="0" y2="0">
                    <stop offset="0" className={flow.lineFrom} />
                    <stop offset="0.8" className={flow.lineTo} />
                    <stop offset="1" className={flow.lineTo} stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="how-area" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" className={flow.lineTo} stopOpacity="0.16" />
                    <stop offset="1" className={flow.lineTo} stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path className={flow.grid} d={`M0 75H${CHART.width}M0 150H${CHART.width}M0 225H${CHART.width}`} />
                <path className={flow.area} d={areaPath} fill="url(#how-area)" />
                <path className={flow.line} d={linePath} stroke="url(#how-line)" pathLength="1" />
                <g className={flow.pulse}>
                  <g>
                    <circle r="10" className={flow.pulseHalo} />
                    <circle r="3.5" className={flow.pulseCore} />
                    <animateMotion dur="5.5s" repeatCount="indefinite" path={linePath} calcMode="spline" keyTimes="0;1" keySplines="0.45 0 0.3 1" />
                    <animate attributeName="opacity" dur="5.5s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;0.1;0.8;1" />
                  </g>
                </g>
              </svg>
              {steps.map((step, index) => {
                const position = { left: percent(step.x, CHART.width), top: percent(step.y, CHART.height), "--at": `${step.at}s`, "--y": step.y };
                return (
                  <div key={step.title} className={flow.marker} style={position}>
                    <i className={flow.drop} />
                    <i className={flow.dot} data-last={index === steps.length - 1 || undefined} />
                    <StepNote step={index} />
                  </div>
                );
              })}
            </div>

            <ol className={flow.steps}>
              {steps.map((step, index) => (
                <li key={step.title} style={{ "--at": `${step.at}s` }}>
                  <span className={flow.number}>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                    <div className={flow.inlineNote} aria-hidden="true"><StepNote step={index} /></div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowItWorks;

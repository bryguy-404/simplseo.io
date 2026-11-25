"use client";

import { useState } from "react";
import { ArrowRight, Check, Globe2, PencilLine, Search, BarChart3 } from "lucide-react";
import styles from "./Photographers.module.css";

const steps = [
  {
    label: "Understand",
    icon: Search,
    title: "Start with the page you already have.",
    description: "Imagine you photograph weddings in Madison, Wisconsin. Your page title says ‘Weddings | Your Studio’. It names the service, but gives a searching couple little context about where you work.",
  },
  {
    label: "Review",
    icon: Check,
    title: "Review a suggestion with a reason.",
    description: "A title that includes your actual service and location can describe the page more clearly. Use this wording only if Madison is somewhere you really photograph weddings. Your own recommendation will depend on your page and its evidence.",
  },
  {
    label: "Publish",
    icon: PencilLine,
    title: "Make the change in your website editor.",
    description: "Check the wording, update the page title in your website builder, and publish when you’re happy with it. SimplSEO gives you guidance; you stay in control of the edit.",
  },
  {
    label: "Follow",
    icon: BarChart3,
    title: "Watch what happens, without guessing.",
    description: "Review the page’s Google appearances and clicks over time. Search data can be delayed or too limited for a clear conclusion. A change in traffic alone doesn’t prove that one edit caused it.",
  },
];

export default function PhotographerExample() {
  const [active, setActive] = useState(0);
  const step = steps[active];
  const Icon = step.icon;

  return (
    <div className={styles.example}>
      <div className={styles.exampleTopline}>
        <span><span className={styles.statusDot} />One page. A clearer next step.</span>
        <span>Illustrative example</span>
      </div>
      <div className={styles.exampleBody}>
        <div className={styles.pagePreview}>
          <div className={styles.addressBar}><Globe2 size={14} aria-hidden="true" />yourstudio.example/weddings</div>
          <div className={styles.previewContent}>
            <p className={styles.smallLabel}>{active < 2 ? "Your page title" : active === 2 ? "In your website editor" : "After your edit"}</p>
            {active === 0 && <>
              <p className={styles.beforeTitle}>Weddings | Your Studio</p>
              <div className={styles.previewRule} />
              <p className={styles.previewQuestion}>Will a couple know where you work?</p>
              <div className={styles.contextTags}><span>Wedding photography</span><span>Madison, WI</span></div>
            </>}
            {active === 1 && <>
              <p className={styles.previousTitle}>Weddings | Your Studio</p>
              <ArrowRight className={styles.changeArrow} size={20} aria-hidden="true" />
              <p className={styles.suggestedTitle}>Wedding photographer in Madison, WI | Your Studio</p>
              <span className={styles.previewBadge}>Suggested wording to review</span>
            </>}
            {active === 2 && <>
              <p className={styles.suggestedTitle}>Wedding photographer in Madison, WI | Your Studio</p>
              <div className={styles.editorNote}><PencilLine size={16} aria-hidden="true" /><span>You review, edit, and publish.</span></div>
              <p className={styles.previewQuestion}>Keep your website. Use the editor you already know.</p>
            </>}
            {active === 3 && <>
              <p className={styles.suggestedTitle}>Give the change time.</p>
              <dl className={styles.observations}>
                <div><dt>Appearances</dt><dd>How often your page is shown</dd></div>
                <div><dt>Clicks</dt><dd>Visits from Google Search</dd></div>
              </dl>
              <span className={styles.previewBadge}>Look for a pattern over time</span>
            </>}
          </div>
        </div>
        <div className={styles.exampleGuidance} aria-live="polite" aria-atomic="true" id="photographer-example-detail">
          <div className={styles.exampleIcon}><Icon size={22} strokeWidth={1.6} aria-hidden="true" /></div>
          <p className={styles.smallLabel}>SimplSEO guidance</p>
          <h3>{step.title}</h3>
          <p>{step.description}</p>
        </div>
      </div>
      <div className={styles.exampleControls} role="group" aria-label="Explore the page improvement example">
        {steps.map((item, index) => (
          <button
            key={item.label}
            type="button"
            aria-pressed={active === index}
            aria-controls="photographer-example-detail"
            onClick={() => setActive(index)}
          >
            <span>{String(index + 1).padStart(2, "0")}</span>{item.label}
          </button>
        ))}
      </div>
      <p className={styles.exampleCaption}>A simplified walkthrough, not a customer result or a promise of higher rankings.</p>
    </div>
  );
}

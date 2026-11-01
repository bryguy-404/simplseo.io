import { Check, Globe2 } from "lucide-react";
import styles from "./HomepageRefinements.module.css";

const steps = [
  { title: "Connect your site", description: "Add your website so SimplSEO can get to know your business and your pages." },
  { title: "Find your next step", description: "See what needs attention, with the reason explained in plain English." },
  { title: "Make a focused change", description: "Use your mentor’s guidance to update your website, one improvement at a time." },
  { title: "Follow your progress", description: "See how your clicks and rankings change, and build on what’s working." },
];

function StepPreview({ step }) {
  return (
    <div className={styles.stepPreview} aria-hidden="true">
      {step === 0 && <div className={styles.sitePreview}>
        <div className={styles.miniBrowserBar}><i /><i /><i /></div>
        <div className={styles.siteAddress}><Globe2 size={16} strokeWidth={1.6} />Your website</div>
        <div className={styles.siteConnected}><Check size={12} />Connected</div>
      </div>}
      {step === 1 && <div className={styles.insightPreview}>
        <span className={styles.startHere}><i />A useful place to start</span>
        <strong>Clarify your page title</strong>
        <span className={styles.previewLine} /><span className={styles.previewLineShort} />
      </div>}
      {step === 2 && <div className={styles.editPreview}>
        <span>YOUR PAGE TITLE</span>
        <p>Kitchen remodeling<br />in Austin<span className={styles.editCaret} /></p>
        <span className={styles.editCheck}><Check size={13} /></span>
      </div>}
      {step === 3 && <div className={styles.progressPreview}>
        <span>See what changes over time</span>
        <svg viewBox="0 0 200 75" fill="none">
          <path className={styles.chartGrid} d="M0 20H200M0 45H200M0 70H200" />
          <path className={styles.chartArea} d="M0 62L24 57L47 60L73 43L100 47L123 33L150 36L176 17L197 10V75H0Z" />
          <path className={styles.chartLine} d="M0 62L24 57L47 60L73 43L100 47L123 33L150 36L176 17L197 10" />
          <circle cx="197" cy="10" r="4" className={styles.chartDot} />
        </svg>
      </div>}
    </div>
  );
}

const HowItWorks = () => (
  <section id="how-it-works" className={`${styles.polish} ${styles.howSection}`} aria-labelledby="how-it-works-title">
    <div className={`section-secondary ${styles.howInner}`}>
      <div className="max-w-6xl mx-auto">
        <div className={styles.howHeading}>
          <p className={styles.eyebrow}>From insight to action</p>
          <h2 id="how-it-works-title" className={styles.sectionTitle}>How it works</h2>
          <p>A simple routine for making your website easier to find.</p>
        </div>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title}>
              <div className={styles.stepTrack}><span>{String(index + 1).padStart(2, "0")}</span><i /></div>
              <StepPreview step={index} />
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  </section>
);

export default HowItWorks;

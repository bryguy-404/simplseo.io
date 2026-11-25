"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import HeroField from "./HeroField";
import useReveal from "./useReveal";
import styles from "./HomepageRefinements.module.css";
import motion from "./HomepageMotion.module.css";

const delay = (ms) => ({ "--rise-delay": `${ms}ms` });

// The closing panel picks the hero's particle field back up, so the page
// ends on the same note it opened with.
const CTA = ({
  eyebrow = "A little clarity. A clear next step.",
  title = "Ready to understand your SEO?",
  description = "Free during early access, with no credit card required. Bring your website, your questions, and your feedback.",
  buttonLabel = "Get started",
  note,
}) => {
  const [ref, state] = useReveal({ threshold: 0.35 });

  return (
    <section className={`${styles.polish} ${styles.cta}`} aria-labelledby="homepage-cta-title">
      <div ref={ref} className={`section-secondary ${styles.ctaInner}`} data-state={state}>
        <HeroField className={motion.ctaField} bleed={0} />
        <div className={`max-w-3xl mx-auto text-center ${styles.ctaContent}`}>
          <p className={`${styles.eyebrow} ${motion.reveal}`}>{eyebrow}</p>
          <h2 id="homepage-cta-title" className={`${styles.sectionTitle} ${motion.reveal}`} style={delay(90)}>{title}</h2>
          <p className={`${styles.ctaDescription} ${motion.reveal}`} style={delay(190)}>{description}</p>
          <div className={motion.reveal} style={delay(290)}>
            <Link href="/request-access" className={styles.primaryButton}>{buttonLabel}<ArrowRight size={17} aria-hidden="true" /></Link>
          </div>
          {note && <p className={styles.heroNote}>{note}</p>}
          <p className={`${styles.signInNote} ${motion.reveal}`} style={delay(380)}>Already have access? <Link href="/auth">Sign in</Link></p>
        </div>
      </div>
    </section>
  );
};

export default CTA;

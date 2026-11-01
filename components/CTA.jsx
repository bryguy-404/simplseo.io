import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./HomepageRefinements.module.css";

const CTA = () => (
  <section className={`${styles.polish} ${styles.cta}`} aria-labelledby="homepage-cta-title">
    <div className={`section-secondary ${styles.ctaInner}`}>
      <div className="max-w-3xl mx-auto text-center">
        <p className={styles.eyebrow}>A little clarity. A clear next step.</p>
        <h2 id="homepage-cta-title" className={styles.sectionTitle}>Ready to understand your SEO?</h2>
        <p className={styles.ctaDescription}>Free during early access, with no credit card required. Bring your website, your questions, and your feedback.</p>
        <Link href="/request-access" className={styles.primaryButton}>Get started<ArrowRight size={17} aria-hidden="true" /></Link>
        <p className={styles.signInNote}>Already have access? <Link href="/auth">Sign in</Link></p>
      </div>
    </div>
  </section>
);

export default CTA;

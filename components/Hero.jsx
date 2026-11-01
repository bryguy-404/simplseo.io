"use client";

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { SeoTooltip } from "./KeywordTooltip";
import styles from "./HomepageRefinements.module.css";

const Hero = () => (
  <section className={`${styles.polish} ${styles.hero}`}>
    <div className="max-w-4xl mx-auto text-center">
      <SeoTooltip className={styles.seoLink}>What is SEO?<ArrowRight size={14} aria-hidden="true" /></SeoTooltip>
      <h1 className="font-bold tracking-tight text-foreground mb-5">
        <span className="block text-5xl md:text-7xl lg:text-8xl">SEO made simple</span>
        <span className="block text-3xl md:text-5xl mt-2">for small businesses</span>
      </h1>
      <p className={styles.heroDescription}>
        Understand why customers aren&apos;t finding your business on Google and know exactly what to fix.
      </p>
      <div className={styles.heroActions}>
        <Link href="/request-access" className={styles.primaryButton}>Get started<ArrowRight size={17} aria-hidden="true" /></Link>
        <a href="#mentor-preview" className={styles.secondaryButton}><Play size={15} aria-hidden="true" />See the mentor in action</a>
      </div>
      <p className={styles.heroNote}>Free during early access<span aria-hidden="true">·</span>No credit card required</p>
    </div>
  </section>
);

export default Hero;

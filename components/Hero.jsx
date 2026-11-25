"use client";

import Link from "next/link";
import { ArrowRight, Play } from "lucide-react";
import { SeoTooltip } from "./KeywordTooltip";
import HeroField from "./HeroField";
import styles from "./HomepageRefinements.module.css";
import motion from "./HomepageMotion.module.css";

const delay = (ms) => ({ "--rise-delay": `${ms}ms` });

const Hero = () => (
  <section className={`${styles.polish} ${styles.hero} ${motion.heroStage}`}>
    <HeroField />
    <div className={`max-w-4xl mx-auto text-center ${motion.heroContent}`} data-hero-content>
      <div className={motion.rise}>
        <SeoTooltip className={styles.seoLink}>What is SEO?<ArrowRight size={14} aria-hidden="true" /></SeoTooltip>
      </div>
      <h1 className="font-bold tracking-tight text-foreground mb-5">
        <span className={`block text-5xl md:text-7xl lg:text-8xl ${motion.rise}`} style={delay(90)}>SEO made simple</span>
        <span className={`block text-3xl md:text-5xl mt-2 ${motion.rise}`} style={delay(190)}>for small businesses</span>
      </h1>
      <p className={`${styles.heroDescription} ${motion.rise}`} style={delay(310)}>
        Understand why customers aren&apos;t finding your business on Google and know exactly what to fix.
      </p>
      <div className={`${styles.heroActions} ${motion.rise}`} style={delay(430)}>
        <Link href="/request-access" className={styles.primaryButton}>Get started<ArrowRight size={17} aria-hidden="true" /></Link>
        <a href="#mentor-preview" className={styles.secondaryButton}><Play size={15} aria-hidden="true" />See the mentor in action</a>
      </div>
      <p className={`${styles.heroNote} ${motion.rise}`} style={delay(550)}>Free during early access<span aria-hidden="true">·</span>No credit card required</p>
    </div>
  </section>
);

export default Hero;

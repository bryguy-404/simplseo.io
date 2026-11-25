"use client";

import { useEffect, useRef } from "react";
import { FileText, MessageSquare, MousePointerClick, Search, TrendingUp } from "lucide-react";
import { KeywordTooltip, CTRTooltip } from "./KeywordTooltip";
import { ClicksVisual, MentorVisual, OutlineVisual, ProgressVisual, KeywordsVisual } from "./FeatureVisuals";
import useReveal from "./useReveal";
import fc from "./FeatureCards.module.css";
import styles from "./HomepageRefinements.module.css";

// Helper to render description with keyword tooltips
const renderDescription = (text) => {
  // Split by "keyword" or "keywords" (case insensitive) and wrap matches
  const parts = text.split(/(keywords?)/gi);
  return parts.map((part, index) => {
    if (part.toLowerCase() === "keyword" || part.toLowerCase() === "keywords") {
      return <KeywordTooltip key={index}>{part}</KeywordTooltip>;
    }
    return part;
  });
};

// Helper to render title with keyword tooltips
const renderTitle = (text) => {
  const parts = text.split(/(Keywords?)/gi);
  return parts.map((part, index) => {
    if (part.toLowerCase() === "keyword" || part.toLowerCase() === "keywords") {
      return <KeywordTooltip key={index}>{part}</KeywordTooltip>;
    }
    return part;
  });
};

const stackingCards = [
  {
    label: "Clicks",
    Icon: MousePointerClick,
    Visual: ClicksVisual,
    accentLight: "#b7791f",
    accentDark: "#e3ad4a",
    title: "Fix Pages That Get Views But No Clicks",
    titleSubtitle: "(The CTR Problem)",
    hasCTRTooltip: true, // Use CTR tooltip in subtitle
    description: "Your page shows up in Google but nobody clicks? We'll tell you exactly why and how to fix it. Usually it's the title we'll help you write better ones that people actually want to click.",
  },
  {
    label: "Mentor",
    Icon: MessageSquare,
    Visual: MentorVisual,
    accentLight: "#167b4d",
    accentDark: "#56d6a0",
    title: "Your Personal SEO Mentor",
    titleSubtitle: "(Trained Specifically for You)",
    description: "Ask your SEO mentor anything in plain English. It's trained on YOUR website content, so it knows your business and the keywords you care about. No more decoding SEO jargon. Think of it as your own SEO professional available 24/7.",
  },
  {
    label: "Content",
    Icon: FileText,
    Visual: OutlineVisual,
    accentLight: "#6d4fd8",
    accentDark: "#ab94fb",
    title: "AI Content Outlines",
    titleSubtitle: "(So You Know What to Write)",
    description: "Found a keyword opportunity but not sure what to write? We'll generate a complete content outline for you. Just add your expertise and hit publish. We do the SEO thinking, you do the writing.",
  },


  {
    label: "Progress",
    Icon: TrendingUp,
    Visual: ProgressVisual,
    accentLight: "#2f6fbd",
    accentDark: "#74b6f5",
    title: "Track Your Progress",
    titleSubtitle: "(Real Results, Not Just Data)",
    description: "See your rankings in real time with accurate data from Google. We notify you the moment a new page starts ranking and show side-by-side progress so you can see what's improving. Watch clicks rise, rankings climb, and know exactly what's working and what's not.",
  },
  {
    label: "Keywords",
    Icon: Search,
    Visual: KeywordsVisual,
    accentLight: "#c2457a",
    accentDark: "#f191b9",
    title: "Find Keywords You're Already Ranking For",
    titleSubtitle: "(But Didn't Know)",
    description: "We'll show you keywords people are searching for that lead to your site even if you don't have a page for them yet. It's like finding money in your couch cushions, but for SEO.",
    skipTitleKeyword: true, // Don't underline "Keywords" in title - it's self-explanatory here
  },

];

const FeatureCard = ({ card }) => {
  const [ref, state] = useReveal({ threshold: 0.35 });

  return (
    <article
      ref={ref}
      className={fc.card}
      data-state={state}
      style={{ "--accent-light": card.accentLight, "--accent-dark": card.accentDark }}
    >
      <div className={fc.copy}>
        <p className={fc.eyebrow}><card.Icon size={14} strokeWidth={2} aria-hidden="true" />{card.label}</p>
        <h3 className={fc.title}>
          {card.skipTitleKeyword ? card.title : renderTitle(card.title)}
          {card.titleSubtitle && (
            <span className={fc.subtitle}>
              {card.hasCTRTooltip ? <>{"(The "}<CTRTooltip>CTR</CTRTooltip>{" Problem)"}</> : card.titleSubtitle}
            </span>
          )}
        </h3>
        <p className={fc.description}>{renderDescription(card.description)}</p>
      </div>
      <div className={fc.stage} aria-hidden="true"><card.Visual /></div>
    </article>
  );
};

const StackingCards = () => {
  const sectionRef = useRef(null);

  useEffect(() => {
    const cards = sectionRef.current?.querySelectorAll('[data-stacking-card]');
    if (!cards) return;

    // Let tall cards scroll fully into view before they join the stack.
    const observer = new ResizeObserver((entries) => {
      entries.forEach(({ target }) => {
        target.style.setProperty('--card-height', `${target.getBoundingClientRect().height}px`);
      });
    });
    cards.forEach((card) => observer.observe(card));
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} id="stacking-cards" className="relative">
      {/* Section header */}
      <div className={`${styles.polish} text-center pb-16 px-4`}>
        <p className={styles.eyebrow}>Features</p>
        <h2 className={styles.sectionTitle}>
        What SimplSEO helps you fix
        </h2>
      </div>

      {/* Stacking cards container */}
      <div className="relative px-4 md:px-8 lg:px-16">
        <div className="max-w-7xl mx-auto">
          {stackingCards.map((card, index) => (
            <div
              key={card.title}
              data-stacking-card
              className="stacking-card sticky mb-8 last:mb-0"
              style={{
                '--mobile-top': `${100 + index * 16}px`,
                '--desktop-top': `${150 + index * 24}px`,
                zIndex: index + 1,
              }}
            >
              <style jsx>{`
                .stacking-card {
                  top: min(var(--mobile-top), calc(100svh - var(--card-height, 0px) - 24px));
                }
                @media (min-width: 768px) {
                  .stacking-card {
                    top: min(var(--desktop-top), calc(100svh - var(--card-height, 0px) - 24px));
                  }
                }
              `}</style>
              <FeatureCard card={card} />
            </div>
          ))}
        </div>
      </div>

      {/* Spacer to allow last card to be seen fully */}
      <div className="h-32" />
    </section>
  );
};

export default StackingCards;

"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";
import { Search, TrendingUp, MessageSquare, Sparkles, Target } from "lucide-react";
import { useTheme } from "@/app/contexts/ThemeContext";
import { KeywordTooltip, CTRTooltip } from "./KeywordTooltip";

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
    icon: TrendingUp,
    title: "Fix Pages That Get Views But No Clicks",
    titleSubtitle: "(The CTR Problem)",
    hasCTRTooltip: true, // Use CTR tooltip in subtitle
    description: "Your page shows up in Google but nobody clicks? We'll tell you exactly why and how to fix it. Usually it's the title we'll help you write better ones that people actually want to click.",
    lightColor: "hsl(45, 50%, 92%)",
    darkColor: "hsl(40, 35%, 32%)", // Soft warm beige
    image: "/images/homepage/search-clicks.webp",
    imageAlt: "A cursor clicks a highlighted search result with an improved title.",
  },
  {
    icon: MessageSquare,
    title: "Your Personal SEO Mentor",
    titleSubtitle: "(Trained Specifically for You)",
    description: "Ask your SEO mentor anything in plain English. It's trained on YOUR website content, so it knows your business and the keywords you care about. No more decoding SEO jargon. Think of it as your own SEO professional available 24/7.",
    lightColor: "hsl(145, 40%, 92%)",
    darkColor: "hsl(160, 30%, 32%)", // Soft sage
    image: "/images/homepage/seo-mentor.webp",
    imageAlt: "A website connected to a helpful conversation with a personal SEO mentor.",
  },
  {
    icon: Sparkles,
    title: "AI Content Outlines",
    titleSubtitle: "(So You Know What to Write)",
    description: "Found a keyword opportunity but not sure what to write? We'll generate a complete content outline for you. Just add your expertise and hit publish. We do the SEO thinking, you do the writing.",
    lightColor: "hsl(260, 30%, 94%)",
    darkColor: "hsl(260, 25%, 35%)",
    image: "/images/homepage/content-outlines.webp",
    imageAlt: "An organized article outline with section headings, writing prompts, and a pencil.",
  },


  {
    icon: Target,
    title: "Track Your Progress",
    titleSubtitle: "(Real Results, Not Just Data)",
    description: "See your rankings in real time with accurate data from Google. We notify you the moment a new page starts ranking and show side-by-side progress so you can see what's improving. Watch clicks rise, rankings climb, and know exactly what's working and what's not.",
    lightColor: "hsl(200, 40%, 92%)",
    darkColor: "hsl(210, 30%, 35%)", // Soft steel blue
    image: "/images/homepage/track-progress.webp",
    imageAlt: "A rising chart with a checkmark shows SEO performance improving over time.",
  },
  {
    icon: Search,
    title: "Find Keywords You're Already Ranking For",
    titleSubtitle: "(But Didn't Know)",
    description: "We'll show you keywords people are searching for that lead to your site even if you don't have a page for them yet. It's like finding money in your couch cushions, but for SEO.",
    lightColor: "hsl(320, 30%, 94%)",
    darkColor: "hsl(330, 25%, 35%)", // Soft dusty rose
    image: "/images/homepage/keyword-discovery.webp",
    imageAlt: "A magnifying glass reveals a highlighted keyword in a list of search results.",
    skipTitleKeyword: true, // Don't underline "Keywords" in title - it's self-explanatory here
  },

];

const StackingCards = () => {
  const { isDarkMode } = useTheme();
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
      <div className="text-center pb-16 px-4">
        <h2 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground mb-6">
        What SimplSEO helps you fix
        </h2>
        {/* <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Powerful SEO tools designed to help businesses of all sizes grow their organic traffic.
        </p> */}
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
              <div
                className="rounded-[2rem] p-8 md:p-12 lg:p-16 shadow-lg transition-all duration-300 min-h-[400px] md:min-h-[450px] flex flex-col md:flex-row items-center gap-8"
                style={{ backgroundColor: isDarkMode ? card.darkColor : card.lightColor }}
              >
              <div className="flex-1">
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${isDarkMode ? 'bg-white/10' : 'bg-foreground/10'}`}>
                  <card.icon className={`w-8 h-8 ${isDarkMode ? 'text-white' : 'text-foreground'}`} />
                </div>
                <h3 className={`text-3xl md:text-4xl lg:text-5xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-foreground'}`}>
                  {card.skipTitleKeyword ? card.title : renderTitle(card.title)}
                  {card.titleSubtitle && (
                    <>
                      <br />
                      <span className="text-lg md:text-3xl lg:text-4xl">
                        {card.hasCTRTooltip ? (
                          <>{"(The "}<CTRTooltip>CTR</CTRTooltip>{" Problem)"}</>
                        ) : (
                          card.titleSubtitle
                        )}
                      </span>
                    </>
                  )}
                </h3>
                <p className={`text-lg md:text-xl max-w-xl ${isDarkMode ? 'text-white/80' : 'text-foreground/70'}`}>
                  {renderDescription(card.description)}
                </p>
              </div>
              <div className="w-full min-w-0 flex-1 flex items-center justify-center">
                {card.image ? (
                  <Image
                    src={card.image}
                    alt={card.imageAlt}
                    width={1024}
                    height={1024}
                    sizes="(min-width: 1280px) 432px, (min-width: 1024px) 40vw, (min-width: 768px) 36vw, (min-width: 480px) 384px, calc(100vw - 96px)"
                    className="h-auto w-full max-w-sm lg:max-w-[27rem] object-contain"
                  />
                ) : (
                  <div className={`w-full max-w-md aspect-video rounded-2xl shadow-inner flex items-center justify-center ${isDarkMode ? 'bg-white/10' : 'bg-background/50'}`}>
                    <card.icon className={`w-20 h-20 ${isDarkMode ? 'text-white/30' : 'text-foreground/20'}`} />
                  </div>
                )}
              </div>
            </div>
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


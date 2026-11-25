"use client";

import { useEffect, useRef, useState, createContext, useContext } from "react";
import { KeywordTooltip } from "./KeywordTooltip";
import styles from "./HomepageRefinements.module.css";

// Context to share scroll progress across all text elements
const ScrollContext = createContext(0);

// All lines of text with their word counts
const lines = [
  "Most SEO tools are built for analysts, not business owners. They bury you in charts and numbers you don’t need.",
  "SimplSEO shows you only what matters:",
  "",
  "which pages need attention",
  "which keywords are improving", // Note: "keywords" here will be handled specially
  "what’s working (and what isn’t)",
  "simple actions you can take today",
  "No fluff.",
  "No confusing data.",
  "Just real results, explained in plain English.",
];

// Calculate total words and cumulative positions
const totalWords = lines.reduce((sum, line) => sum + line.split(" ").length, 0);
const lineStartPositions = [];
let cumulative = 0;
lines.forEach((line) => {
  lineStartPositions.push(cumulative);
  cumulative += line.split(" ").length;
});

// Component to render text with scroll-based reveal
const ScrollRevealText = ({ lineIndex, children }) => {
  const progress = useContext(ScrollContext);
  const text = typeof children === "string" ? children : "";
  const words = text.split(" ");
  const lineStart = lineStartPositions[lineIndex];
  
  return (
    <span>
      {words.map((word, wordIndex) => {
        const globalWordIndex = lineStart + wordIndex;
        const wordProgress = (globalWordIndex + 1) / totalWords;
        const isRevealed = progress >= wordProgress;
        
        // Check if this word is "keywords" to wrap with KeywordTooltip
        const isKeyword = word.toLowerCase() === "keywords";
        const wordContent = isKeyword ? (
          <KeywordTooltip>{word}</KeywordTooltip>
        ) : (
          word
        );
        
        return (
          <span
            key={wordIndex}
            className="transition-opacity duration-500 text-foreground"
            style={{
              opacity: isRevealed ? 1 : 0,
            }}
          >
            {wordContent}{wordIndex < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </span>
  );
};

// Animated bullet that appears with the first word of its line
const ScrollRevealBullet = ({ lineIndex }) => {
  const progress = useContext(ScrollContext);
  const lineStart = lineStartPositions[lineIndex];
  const bulletProgress = (lineStart + 1) / totalWords;
  const isRevealed = progress >= bulletProgress;
  
  return (
    <span 
      className="inline-block w-2 h-2 rounded-full bg-primary mr-3 align-middle transition-opacity duration-200"
      style={{ opacity: isRevealed ? 1 : 0 }}
    />
  );
};

const Features = () => {
  const sectionRef = useRef(null);
  const [progress, setProgress] = useState(0);
  
  useEffect(() => {
    const handleScroll = () => {
      const section = sectionRef.current;
      if (!section) return;
      
      const rect = section.getBoundingClientRect();
      const windowHeight = window.innerHeight;
      
      // Start when section enters viewport, complete when section is 20% from top
      const start = windowHeight * 0.8;
      const end = windowHeight * 0.1;
      const current = rect.top;
      
      if (current >= start) {
        setProgress(0);
      } else if (current <= end) {
        setProgress(1);
      } else {
        setProgress((start - current) / (start - end));
      }
    };
    
    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  
  return (
    <ScrollContext.Provider value={progress}>
      <section ref={sectionRef} id="features" className={`${styles.polish} pt-16 pb-1 px-4`}>
        <div className="max-w-3xl mx-auto text-center">
          <p className={styles.eyebrow}>Why SimplSEO</p>
          <h2 className={`${styles.sectionTitle} mb-10`}>
          SEO tools are confusing. SimplSEO isn’t.
          </h2>
          
          <div className="space-y-6 text-lg">
            <p className="text-xl md:text-2xl leading-relaxed">
              <ScrollRevealText lineIndex={0}>{lines[0]}</ScrollRevealText>
            </p>
            
            <p className="text-xl md:text-2xl font-semibold">
              <ScrollRevealText lineIndex={1}>{lines[1]}</ScrollRevealText>
            </p>
            
            <p className="text-lg md:text-xl leading-relaxed">
              <ScrollRevealText lineIndex={2}>{lines[2]}</ScrollRevealText>
            </p>
            
            <div className="space-y-3">
              <p className="text-lg md:text-xl">
                <ScrollRevealBullet lineIndex={3} />
                <ScrollRevealText lineIndex={3}>{lines[3]}</ScrollRevealText>
              </p>
              <p className="text-lg md:text-xl">
                <ScrollRevealBullet lineIndex={4} />
                <ScrollRevealText lineIndex={4}>{lines[4]}</ScrollRevealText>
              </p>
              <p className="text-lg md:text-xl">
                <ScrollRevealBullet lineIndex={5} />
                <ScrollRevealText lineIndex={5}>{lines[5]}</ScrollRevealText>
              </p>
              <p className="text-lg md:text-xl">
                <ScrollRevealBullet lineIndex={6} />
                <ScrollRevealText lineIndex={6}>{lines[6]}</ScrollRevealText>
              </p>
            </div>
            
            <div className="pt-6 space-y-1">
              <p className="text-xl md:text-2xl font-semibold">
                <ScrollRevealText lineIndex={7}>{lines[7]}</ScrollRevealText>
              </p>
              <p className="text-xl md:text-2xl font-semibold">
                <ScrollRevealText lineIndex={8}>{lines[8]}</ScrollRevealText>
              </p>
              <p className="text-xl md:text-2xl font-semibold">
                <ScrollRevealText lineIndex={9}>{lines[9]}</ScrollRevealText>
              </p>
            </div>
          </div>
        </div>
      </section>
    </ScrollContext.Provider>
  );
};

export default Features;


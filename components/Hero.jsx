"use client";

import { Button } from "@/components/ui/button";
import { ArrowRight, X } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";

const Hero = () => {
  const router = useRouter();
  const [buttonState, setButtonState] = useState("hidden"); // "hidden" | "bouncing" | "expanding" | "complete"
  const [showSeoPopup, setShowSeoPopup] = useState(false);
  const buttonRef = useRef(null);
  const timersRef = useRef([]);
  
  // Clear all timers
  const clearAllTimers = useCallback(() => {
    timersRef.current.forEach(timer => clearTimeout(timer));
    timersRef.current = [];
  }, []);
  
  // Start the animation sequence
  const startAnimation = useCallback(() => {
    clearAllTimers();
    setButtonState("hidden");
    
    const startTimer = setTimeout(() => {
      setButtonState("bouncing");
    }, 100);
    
    const expandTimer = setTimeout(() => {
      setButtonState("expanding");
    }, 700);
    
    const completeTimer = setTimeout(() => {
      setButtonState("complete");
    }, 1200);
    
    timersRef.current = [startTimer, expandTimer, completeTimer];
  }, [clearAllTimers]);
  
  // Intersection Observer to detect when button is in view
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            startAnimation();
          } else {
            clearAllTimers();
            setButtonState("hidden");
          }
        });
      },
      { threshold: 0.5 }
    );
    
    if (buttonRef.current) {
      observer.observe(buttonRef.current);
    }
    
    return () => {
      observer.disconnect();
      clearAllTimers();
    };
  }, [startAnimation, clearAllTimers]);
  
  // Get button styles based on state
  const getButtonStyles = () => {
    switch (buttonState) {
      case "hidden":
        return {
          width: "48px",
          height: "48px",
          padding: "0",
          transform: "scale(0)",
          borderRadius: "9999px",
        };
      case "bouncing":
        return {
          width: "48px",
          height: "48px",
          padding: "0",
          transform: "scale(1)",
          borderRadius: "9999px",
          animation: "bounce-in 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55) forwards",
        };
      case "expanding":
        return {
          width: "160px",
          height: "48px",
          padding: "0 2rem",
          transform: "scale(1)",
          borderRadius: "9999px",
          transition: "width 0.4s ease-out, padding 0.4s ease-out",
        };
      case "complete":
        return {
          width: "160px",
          height: "48px",
          padding: "0 2rem",
          transform: "scale(1)",
          borderRadius: "9999px",
        };
      default:
        return {};
    }
  };
  
  return (
    <>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes bounce-in {
          0% { transform: scale(0); }
          50% { transform: scale(1.3); }
          70% { transform: scale(0.85); }
          85% { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        @keyframes arrow-nudge {
          0%, 85% { transform: translateX(0); }
          90% { transform: translateX(4px); }
          95% { transform: translateX(0); }
          97% { transform: translateX(3px); }
          100% { transform: translateX(0); }
        }
        .seo-arrow-bounce {
          display: inline-block;
          animation: arrow-nudge 8s ease-in-out infinite;
        }
        .hero-button {
          transition: transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
        }
        .hero-button:hover {
          transform: scale(1.02) !important;
          box-shadow: 0 4px 12px rgba(0, 191, 99, 0.25);
          filter: brightness(1.05);
        }
        .hero-button:active {
          transform: scale(0.99) !important;
        }
      `}} />
      <section className="min-h-[100vh] flex flex-col items-center justify-center px-4 pt-32 pb-10">
        <div className="max-w-4xl mx-auto text-center">
        <button
            onClick={() => setShowSeoPopup(true)}
            className="group inline-flex items-center gap-1 text-sm md:text-base text-primary hover:text-primary/80 bg-primary/10 hover:bg-primary/20 px-3 py-1.5 rounded-full font-medium transition-colors mb-8 animate-fade-up"
            style={{ animationDelay: "0.05s" }}
          >
            <span>What is SEO?</span>
            <span className="text-xs seo-arrow-bounce">→</span>
          </button>
          <h1 className="font-bold tracking-tight text-foreground mb-4 animate-fade-up">
            <span className="block text-5xl md:text-7xl lg:text-8xl">SEO made simple</span>
            <span className="block text-3xl md:text-5xl lg:text-6x mt-2">for small businesses</span>
          </h1>

          <h2 className="text-xl md:text-2xl text-muted-foreground max-w-2xl mx-auto mb-12 animate-fade-up" style={{ animationDelay: "0.1s" }}>
          Understand why customers aren&apos;t finding your business on Google and know exactly what to fix.
          </h2>
          <div className="flex flex-col items-center gap-3 animate-fade-up" style={{ animationDelay: "0.2s" }}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <button
                ref={buttonRef}
                className="hero-button relative overflow-hidden font-semibold text-white bg-primary flex items-center justify-center gap-2"
                style={getButtonStyles()}
                onClick={() => router.push('/request-access')}
              >
                <span 
                  className="whitespace-nowrap transition-opacity duration-300"
                  style={{ opacity: buttonState === "complete" ? 1 : 0 }}
                >
                  Get started
                </span>
                <ArrowRight 
                  className="w-4 h-4 transition-opacity duration-300"
                  style={{ opacity: buttonState === "complete" ? 1 : 0 }}
                />
              </button>
              <Button 
                variant="outline" 
                size="lg" 
                className="rounded-full px-8 py-6 text-base font-semibold"
                onClick={() => document.getElementById('stacking-cards')?.scrollIntoView({ behavior: 'smooth' })}
              >
                See how it works
              </Button>
            </div>
            {/* <p className="text-sm text-muted-foreground">No credit card required</p> */}
          </div>
        </div>
      </section>

      {/* SEO Explanation Popup */}
      {showSeoPopup && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setShowSeoPopup(false)}
        >
          <div 
            className="relative w-full max-w-lg rounded-2xl border border-border bg-background p-6 md:p-8 shadow-2xl animate-fade-up"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowSeoPopup(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="mb-4">
              <span className="text-3xl mb-2 block">🔍</span>
              <h3 className="text-2xl font-bold text-foreground">What is SEO?</h3>
            </div>
            
            <div className="space-y-4 text-muted-foreground">
              <p>
                <strong className="text-foreground">SEO (Search Engine Optimization)</strong> is simply helping people find your website on Google.
              </p>
              
              <p>
                Think of it like putting a <strong className="text-foreground">bright, clear sign</strong> on your storefront instead of hoping customers wander in.
              </p>
              
              <p>
                When your pages are optimized, Google understands what you offer and shows you to the <strong className="text-foreground">right people</strong>, the ones actively searching for your products or services.
              </p>
              
              {/* <div className="mt-6 p-4 rounded-lg bg-primary/10 border border-primary/20">
                <p className="text-sm text-primary font-medium">
                  💡 SimplSEO makes this easy by showing you exactly what to fix — no technical knowledge required.
                </p>
              </div> */}
            </div>
            
            <button
              onClick={() => setShowSeoPopup(false)}
              className="mt-6 w-full py-3 rounded-full bg-primary text-white font-semibold hover:bg-primary/90 transition-colors"
            >
              Got it!
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default Hero;


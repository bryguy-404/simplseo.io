"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/app/contexts/ThemeContext";
import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import StackingCards from "@/components/StackingCards";
import HowItWorks from "@/components/HowItWorks";
import Pricing from "@/components/Pricing";
import CTA from "@/components/CTA";
import Footer from "@/components/Footer";
import Features from "@/components/Features";
import FAQ from "@/components/FAQ";
import AIBubble from "@/components/AIBubble";
import ChaosVisualizer from "@/components/ChaosVisualizer";
import { KeywordModalProvider } from "@/components/KeywordTooltip";
import SeoSchemas from "./_components/SeoSchemas";
export default function HomePage() {
  const { isDarkMode, toggleTheme } = useTheme();

  return (
    <>
      <SeoSchemas />
      <KeywordModalProvider>
      <div className="min-h-screen bg-background relative">
      {/* Static Background Orbs - Large and Spread Out */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        {/* Top left - Teal */}
        <div className="absolute -top-20 -left-32 w-[600px] h-[600px] bg-teal-500/15 rounded-full blur-3xl animate-pulse"></div>
        
        {/* Top right - Blue */}
        <div className="absolute top-[15%] -right-40 w-[550px] h-[550px] bg-blue-500/15 rounded-full blur-3xl animate-pulse delay-1000"></div>
        
        {/* Bottom left - Purple */}
        <div className="absolute bottom-[10%] -left-20 w-[500px] h-[500px] bg-purple-500/15 rounded-full blur-3xl animate-pulse delay-2000"></div>
        
        {/* Bottom right - Pink */}
        <div className="absolute -bottom-32 -right-20 w-[550px] h-[550px] bg-pink-500/15 rounded-full blur-3xl animate-pulse delay-3000"></div>
      </div>

      {/* Content */}
      <div className="relative z-10">
        <Navbar />
        <Hero />

        <Features />

        {/* A short, illustrative mentor walkthrough */}
        <section id="mentor-preview" aria-labelledby="mentor-preview-title" className="py-24 md:py-28 px-5 scroll-mt-24">
          <AIBubble />
        </section>

        <StackingCards />
        <HowItWorks />
        {/* <Pricing /> */}
        {/* Chaos Visualizer - Keywords Animation */}
        {/* <section className="w-full h-screen">
          <ChaosVisualizer />
        </section> */}
        <FAQ />
        <CTA />
        <Footer />
      </div>

      {/* Theme Toggle Button - Fixed Position */}
      <div className="fixed bottom-6 right-6 z-50">
        <button
          onClick={toggleTheme}
          className="relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 shadow-lg backdrop-blur-sm bg-background/40 border border-white/10"
          style={{
            backgroundColor: isDarkMode ? '#9ca3af' : '#000000'
          }}
          title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
        >
          {/* Sun Icon (Light Mode) - Always visible */}
          <div className="absolute left-1.5 flex items-center justify-center z-10">
            <Sun className="w-3.5 h-3.5 text-white" />
          </div>
          
          {/* Moon Icon (Dark Mode) - Always visible */}
          <div className="absolute right-1.5 flex items-center justify-center z-10">
            <Moon className="w-3.5 h-3.5 text-white" />
          </div>
          
          {/* Toggle Knob */}
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-lg transition-transform duration-300 ease-in-out z-20 ${
              isDarkMode ? 'translate-x-7' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
    </KeywordModalProvider>
    </>
  );
}


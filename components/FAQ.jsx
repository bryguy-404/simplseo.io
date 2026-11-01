"use client";

import { useState } from "react";
import { Plus, Minus } from "lucide-react";
import styles from "./HomepageRefinements.module.css";

const faqs = [
  {
    question: "Why is SimplSEO free right now?",
    answer: "SimplSEO is in early access. We're offering it for free while we learn from real small business owners. In return, we just ask users to share feedback so we can build the right features for you and your business"
  },
  {
    question: "Do I need SEO experience to use this?",
    answer: "No. SimplSEO is built for business owners, not SEO experts. We explain everything in plain English and show you exactly what to focus on first, no technical knowledge required."
  },
  {
    question: "How does this compare to hiring an SEO freelancer or agency?",
    answer: "Many small businesses hire SEO freelancers or agencies to understand what's holding their site back. In the U.S., this typically costs $1,000–$2,500 per month, often with long contracts and confusing reports.\n\nSimplSEO was built to give you that same clarity, without involving freelancers, agencies, or guesswork. You decide what to fix and when."
  },
  {
    question: "How is this different from running Google Ads?",
    answer: "Google Ads can bring traffic quickly, but the moment you stop paying, traffic stops. SEO focuses on improving how Google understands your website so customers can find you organically over time.\n\nSimplSEO helps you improve your SEO so you're not paying for every click."
  },
  {
    question: "How long does it take to see results?",
    answer: "SEO takes time, but SimplSEO gives you direction immediately. Most users understand what's holding their site back within minutes of connecting their website."
  },
  {
    question: "How do I know if SimplSEO is right for me?",
    answer: "SimplSEO is built for small business owners who want the benefits of SEO without paying thousands of dollars per month or learning SEO from scratch.\n\nIf you want clear guidance on what's holding your site back, what actually matters, and what to fix, SimplSEO is for you.\n\nAs you use SimplSEO, you naturally build a better understanding of how SEO works through your AI SEO Mentor that is trained specifically for you and your business using real insights and actions. No courses, jargon, or guesswork. You stay in control, at your own pace, with clarity every step of the way."
  },
  {
    question: "What do you need from me during early access?",
    answer: "We ask early users to share feedback about what's helpful, confusing, or missing. Your input directly shapes how SimplSEO evolves."
  }
];

const FAQItem = ({ question, answer, isOpen, onClick, index }) => {
  const triggerId = `homepage-faq-question-${index}`;
  const answerId = `homepage-faq-answer-${index}`;

  return (
    <div
      className={`group relative rounded-2xl transition-all duration-500 ${
        isOpen
          ? 'bg-gradient-to-br from-primary/5 via-primary/10 to-transparent'
          : 'hover:bg-muted/50'
      }`}
    >
      {/* Gradient border effect */}
      <div aria-hidden="true" className={`pointer-events-none absolute inset-0 rounded-2xl transition-opacity duration-500 ${
        isOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'
      }`} style={{
        background: 'linear-gradient(135deg, rgba(0,191,99,0.3) 0%, transparent 50%, rgba(0,191,99,0.1) 100%)',
        padding: '1px',
        mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        maskComposite: 'xor',
        WebkitMaskComposite: 'xor',
      }} />

      <button
        type="button"
        id={triggerId}
        aria-label={question}
        aria-expanded={isOpen}
        aria-controls={answerId}
        aria-describedby={isOpen ? answerId : undefined}
        onClick={onClick}
        className="relative w-full rounded-2xl p-4 sm:p-6 flex items-start gap-3 sm:gap-5 text-left"
      >
        {/* Number indicator */}
        <div aria-hidden="true" className={`flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl flex items-center justify-center font-mono text-xs sm:text-sm font-bold transition-all duration-300 ${
          isOpen
            ? 'bg-primary text-white shadow-lg shadow-primary/25'
            : 'bg-muted/80 text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary'
        }`}>
          {String(index + 1).padStart(2, '0')}
        </div>

        <div className="flex-1 min-w-0">
          <span className={`text-base sm:text-lg md:text-xl font-semibold block transition-colors duration-300 ${
            isOpen ? 'text-foreground' : 'text-foreground/80 group-hover:text-foreground'
          }`}>
            {question}
          </span>

          {/* Answer with smooth height animation */}
          <div
            id={answerId}
            aria-hidden={!isOpen}
            className={`grid transition-all duration-500 ease-out ${
              isOpen ? 'grid-rows-[1fr] opacity-100 mt-3 sm:mt-4' : 'grid-rows-[0fr] opacity-0'
            }`}
          >
            <div className="overflow-hidden">
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed whitespace-pre-line pr-2 sm:pr-4">
                {answer}
              </p>
            </div>
          </div>
        </div>

        {/* Toggle icon */}
        <div aria-hidden="true" className={`flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
          isOpen
            ? 'bg-primary text-white rotate-0'
            : 'bg-muted text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary'
        }`}>
          {isOpen ? (
            <Minus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          ) : (
            <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
          )}
        </div>
      </button>
    </div>
  );
};

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <section id="faq" className={`${styles.polish} ${styles.faqSection} py-16 sm:py-24 px-4 relative overflow-hidden`} aria-labelledby="faq-title">
      <div aria-hidden="true" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[600px] bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-4xl mx-auto relative">
        <div className={`${styles.faqHeading} text-center mb-10 sm:mb-16`}>
          <p className={styles.eyebrow}>Good questions. Clear answers.</p>
          <h2 id="faq-title" className={styles.sectionTitle}>Got questions?</h2>
          <p>A few things worth knowing before you get started.</p>
        </div>
        <div className="space-y-2 sm:space-y-3">
          {faqs.map((faq, index) => (
            <FAQItem key={faq.question} {...faq} index={index} isOpen={openIndex === index} onClick={() => setOpenIndex((current) => current === index ? null : index)} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQ;

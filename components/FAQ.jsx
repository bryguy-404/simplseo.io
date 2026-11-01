"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
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
    <div className={styles.faqItem} data-open={isOpen}>
      <h3>
        <button type="button" id={triggerId} aria-expanded={isOpen} aria-controls={answerId} onClick={onClick} className={styles.faqQuestion}>
          <span>{question}</span>
          <span className={styles.faqToggle} aria-hidden="true"><Plus size={17} strokeWidth={1.5} /></span>
        </button>
      </h3>
      <div id={answerId} role="region" aria-labelledby={triggerId} hidden={!isOpen} className={styles.faqAnswer}>
        <p>{answer}</p>
      </div>
    </div>
  );
};

const FAQ = () => {
  const [openIndex, setOpenIndex] = useState(0);

  return (
    <section id="faq" className={`${styles.polish} ${styles.faqSection}`} aria-labelledby="faq-title">
      <div className={styles.faqLayout}>
        <div className={styles.faqHeading}>
          <p className={styles.eyebrow}>Good questions. Clear answers.</p>
          <h2 id="faq-title" className={styles.sectionTitle}>Got questions?</h2>
          <p>A few things worth knowing before you get started.</p>
        </div>
        <div className={styles.faqList}>
          {faqs.map((faq, index) => (
            <FAQItem key={faq.question} {...faq} index={index} isOpen={openIndex === index} onClick={() => setOpenIndex((current) => current === index ? null : index)} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default FAQ;

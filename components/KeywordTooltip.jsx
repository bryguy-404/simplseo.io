"use client";

import { createContext, useContext, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ArrowRight, Check, Globe2, MousePointerClick, Search, X } from "lucide-react";
import styles from "./HomepageExplainer.module.css";

const ExplanationContext = createContext(null);

const explanations = {
  seo: {
    title: "What is SEO?",
    icon: Globe2,
    description: "SEO stands for search engine optimization. It helps people find your website when they search for what you offer.",
    takeaway: "Think of it as a clearer sign for your business. Your pages explain what you do, where you work, and who you can help.",
  },
  keyword: {
    title: "What is a keyword?",
    icon: Search,
    description: "A keyword is a word or phrase someone types into Google. It can be a whole question, not just one word.",
    takeaway: "The useful keywords connect what people are looking for with what your business actually offers.",
  },
  ctr: {
    title: "What is CTR?",
    icon: MousePointerClick,
    description: "Click-through rate is the percentage of people who see your page in search results and click through to your website.",
    takeaway: "Your title and description help people decide whether to visit. CTR helps you understand how often they take that next step.",
  },
};

function SearchExample() {
  return (
    <div>
      <div className={styles.searchQuery}><Search size={15} aria-hidden="true" /><span>kitchen remodeling in Austin</span></div>
      <div className={styles.searchResult}>
        <div className={styles.resultBusiness}><span aria-hidden="true">o<span>p</span></span><div>Oak &amp; Pine<small>oakandpine.example</small></div></div>
        <p className={styles.resultTitle}>Kitchen Remodeling in Austin</p>
        <p className={styles.resultDescription}>Thoughtful kitchen renovations, from design to installation.</p>
      </div>
      <div className={styles.exampleCaption}><Check size={14} aria-hidden="true" />A relevant search. A business that can help.</div>
    </div>
  );
}

function KeywordExample() {
  return (
    <div className={styles.keywordExample}>
      <p className={styles.exampleLabel}>Different searches. All keywords.</p>
      <ul>
        {["kitchen remodeling in Austin", "how much does a kitchen remodel cost?", "small kitchen design ideas"].map((query) => (
          <li key={query}><Search size={15} aria-hidden="true" /><span>{query}</span><ArrowRight size={14} aria-hidden="true" /></li>
        ))}
      </ul>
    </div>
  );
}

function CTRExample() {
  return (
    <figure className={styles.ctrExample}>
      <div className={styles.ctrVisual}>
        <div className={styles.dotGrid} aria-hidden="true">{Array.from({ length: 100 }, (_, index) => <i key={index} data-clicked={index < 5} />)}</div>
        <div className={styles.ctrMetric}><strong>5<span>%</span></strong><span>click-through rate</span><p><b>5 clicks</b> from 100 views</p></div>
      </div>
      <figcaption><span className={styles.legendDot} aria-hidden="true" />Each green dot is someone who clicked.</figcaption>
    </figure>
  );
}

export function KeywordModalProvider({ children }) {
  const [topic, setTopic] = useState("seo");
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef(null);
  const explanation = explanations[topic];
  const Icon = explanation.icon;

  const openExplanation = (nextTopic, opener) => {
    openerRef.current = opener;
    setTopic(nextTopic);
    setIsOpen(true);
  };

  return (
    <ExplanationContext.Provider value={openExplanation}>
      {children}
      <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className={styles.overlay} />
          <Dialog.Content
            className={styles.dialog}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              openerRef.current?.focus({ preventScroll: true });
            }}
          >
            <Dialog.Close className={styles.close} aria-label="Close explanation"><X size={19} aria-hidden="true" /></Dialog.Close>
            <div className={styles.eyebrow}><span className={styles.icon}><Icon size={18} strokeWidth={1.7} aria-hidden="true" /></span>In plain English</div>
            <Dialog.Title className={styles.title}>{explanation.title}</Dialog.Title>
            <Dialog.Description className={styles.description}>{explanation.description}</Dialog.Description>
            <div className={styles.example}>
              <span className={styles.exampleTag}>A simple example</span>
              {topic === "seo" && <SearchExample />}
              {topic === "keyword" && <KeywordExample />}
              {topic === "ctr" && <CTRExample />}
            </div>
            <p className={styles.takeaway}>{explanation.takeaway}</p>
            <div className={styles.footer}>
              <span>A little clarity goes a long way.</span>
              <Dialog.Close className={styles.done}>Got it<Check size={15} aria-hidden="true" /></Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </ExplanationContext.Provider>
  );
}

function ExplanationTrigger({ topic, children, className = "" }) {
  const openExplanation = useContext(ExplanationContext);

  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={(event) => {
        event.stopPropagation();
        openExplanation?.(topic, event.currentTarget);
      }}
      className={`${topic === "seo" ? "" : styles.term} ${className}`}
    >
      {children}
    </button>
  );
}

export const KeywordTooltip = (props) => <ExplanationTrigger topic="keyword" {...props} />;
export const CTRTooltip = (props) => <ExplanationTrigger topic="ctr" {...props} />;
export const SeoTooltip = (props) => <ExplanationTrigger topic="seo" {...props} />;

export default KeywordTooltip;

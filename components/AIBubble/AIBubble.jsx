"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { ArrowUpRight, Check, Globe2, RotateCcw, Search, Sparkles } from "lucide-react";
import styles from "./AIBubble.module.css";

const steps = [
  {
    label: "Understand",
    duration: 3200,
    heading: "First, I get to know your business.",
    message: "You remodel kitchens in Austin. That’s useful context for the advice I give you.",
    status: "Getting to know your page",
  },
  {
    label: "Find",
    duration: 4200,
    heading: "Your title leaves something out.",
    message: "“Services” doesn’t tell people what you offer or where you work. Let’s make that clearer.",
    status: "One opportunity spotted",
  },
  {
    label: "Guide",
    duration: 4000,
    heading: "Say what you do. And where.",
    message: "Try “Kitchen Remodeling in Austin.” Now people can see if you’re a match, before they click.",
    status: "A clear next step",
  },
];

const AIBubble = () => {
  const previewRef = useRef(null);
  const inView = useInView(previewRef, { amount: 0.45 });
  const reducedMotion = useReducedMotion();
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (reducedMotion) {
      setStep(2);
      setPlaying(false);
      setFinished(true);
    }
  }, [reducedMotion]);

  useEffect(() => {
    if (!inView || !playing || reducedMotion) return;

    const timer = window.setTimeout(() => {
      if (step < steps.length - 1) {
        setStep((current) => current + 1);
      } else {
        setPlaying(false);
        setFinished(true);
      }
    }, steps[step].duration);

    return () => window.clearTimeout(timer);
  }, [inView, playing, reducedMotion, step]);

  const selectStep = (index) => {
    setStep(index);
    setPlaying(false);
    setFinished((hasFinished) => hasFinished || index === steps.length - 1);
  };

  const replay = () => {
    setStep(0);
    setFinished(false);
    setPlaying(true);
  };

  const transition = { duration: reducedMotion ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] };
  const enter = { opacity: 0, y: reducedMotion ? 0 : 6 };
  const exit = { opacity: 0, y: reducedMotion ? 0 : -4 };

  return (
    <div
      ref={previewRef}
      className={styles.preview}
      data-mentor-demo
      data-step={step}
      data-playing={playing && inView && !reducedMotion}
    >
      <div className={styles.intro}>
        <h2 id="mentor-preview-title">See your mentor at work</h2>
        <span className={styles.example}>A quick example</span>
      </div>

      <div className={styles.scene} aria-labelledby="mentor-preview-title">
        <div className={styles.ambientGlow} aria-hidden="true" />

        <motion.div
          className={styles.searchCard}
          initial={false}
          animate={{ y: step === 2 && !reducedMotion ? -4 : 0 }}
          transition={transition}
        >
          <div className={styles.browserBar}>
            <div className={styles.windowDots} aria-hidden="true"><i /><i /><i /></div>
            <span><Globe2 size={12} aria-hidden="true" /> oakandpine.example</span>
            <span className={styles.windowSpacer} aria-hidden="true" />
          </div>

          <div className={styles.searchContent}>
            <div className={styles.searchLabel}>
              <Search size={14} aria-hidden="true" />
              {step === 2 ? "Suggested search preview" : "How your page appears in search"}
            </div>
            <div className={styles.business}>
              <span className={styles.businessMark} aria-hidden="true">o<span>p</span></span>
              <div><strong>Oak &amp; Pine</strong><span>oakandpine.example / services</span></div>
            </div>

            <div className={styles.titleArea} data-highlight={step === 1}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={step === 2 ? "suggested" : "original"}
                  className={styles.searchTitle}
                  initial={enter}
                  animate={{ opacity: 1, y: 0 }}
                  exit={exit}
                  transition={transition}
                >
                  {step === 2 ? <>Kitchen Remodeling in Austin <span>| Oak &amp; Pine</span></> : "Services | Oak & Pine"}
                </motion.p>
              </AnimatePresence>
              {step === 1 && <motion.span className={styles.titleUnderline} initial={{ scaleX: reducedMotion ? 1 : 0 }} animate={{ scaleX: 1 }} transition={{ duration: reducedMotion ? 0 : 0.6 }} aria-hidden="true" />}
            </div>

            <p className={styles.searchDescription}>
              Custom kitchen renovations, from design to installation. Serving Austin homeowners.
            </p>

            <div className={styles.pageNote} data-step={step}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span key={step} initial={enter} animate={{ opacity: 1, y: 0 }} exit={exit} transition={transition}>
                  {step === 0 && <><span className={styles.smallDot} /> Your service. Your city. Your context.</>}
                  {step === 1 && <><span className={styles.smallDot} /> A vague title is easy to overlook.</>}
                  {step === 2 && <><Check size={13} aria-hidden="true" /> Suggested title · ready for you to use</>}
                </motion.span>
              </AnimatePresence>
            </div>
          </div>

          {step === 0 && playing && inView && !reducedMotion && (
            <motion.div
              className={styles.scanLine}
              initial={{ top: "24%", opacity: 0 }}
              animate={{ top: ["24%", "44%", "85%"], opacity: [0, 0.65, 0] }}
              transition={{ duration: 2.7, times: [0, 0.25, 1], ease: "easeInOut" }}
              aria-hidden="true"
            />
          )}
        </motion.div>

        <div className={styles.connection} aria-hidden="true">
          <svg viewBox="0 0 160 90" fill="none">
            <path d="M2 2H66C84 2 92 12 92 30V52C92 70 104 80 122 80H158" />
            {playing && inView && !reducedMotion && (
              <motion.path
                d="M2 2H66C84 2 92 12 92 30V52C92 70 104 80 122 80H158"
                className={styles.connectionSignal}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: [0, 1], opacity: [0, 0.8, 0] }}
                transition={{ duration: 2, repeat: 1, ease: "easeInOut" }}
              />
            )}
          </svg>
        </div>

        <motion.div className={styles.mentorCard} initial={false} animate={{ y: step > 0 && !reducedMotion ? -4 : 0 }} transition={transition}>
          <div className={styles.mentorHeader}>
            <span className={styles.mentorMark}><Sparkles size={17} strokeWidth={1.7} aria-hidden="true" /></span>
            <span>Your SEO mentor<small>Advice with your business in mind</small></span>
          </div>

          <div className={styles.message} aria-live={playing ? "off" : "polite"} aria-atomic="true">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={step} initial={enter} animate={{ opacity: 1, y: 0 }} exit={exit} transition={transition}>
                <h3>{steps[step].heading}</h3>
                <p>{steps[step].message}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className={styles.mentorStatus} data-complete={step === 2}>
            {step === 2 ? <ArrowUpRight size={14} aria-hidden="true" /> : <span className={styles.statusDot} />}
            <span>{steps[step].status}</span>
          </div>
        </motion.div>
      </div>

      <div className={styles.controls}>
        <div className={styles.steps} aria-label="Explore the mentor example">
          {steps.map((item, index) => (
            <button key={item.label} type="button" onClick={() => selectStep(index)} aria-pressed={step === index} aria-label={(index + 1) + ". " + item.label} className={styles.step} data-active={step === index} data-complete={step > index}>
              <span className={styles.stepNumber}>{step > index ? <Check size={11} aria-hidden="true" /> : index + 1}</span>
              <span className={styles.stepLabel}>{item.label}</span>
            </button>
          ))}
        </div>
        {finished && !reducedMotion && (
          <button type="button" onClick={replay} className={styles.playback} aria-label="Replay mentor example">
            <RotateCcw size={13} aria-hidden="true" /><span>Replay</span>
          </button>
        )}
      </div>
      <p className={styles.footnote}>Your website informs the advice. You choose what to change.</p>
    </div>
  );
};

export default AIBubble;

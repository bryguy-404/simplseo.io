import { ArrowRight, Check, Search, Sparkles } from "lucide-react";
import fc from "./FeatureCards.module.css";

// Small product-style scenes for the feature cards. They are illustrations,
// all built around the same example business used in the mentor preview.

const step = (index) => ({ "--i": index });

export function ClicksVisual() {
  return (
    <div className={fc.panel}>
      <div className={fc.resultSite}>
        <span className={fc.avatar}>O</span>
        <div><b>Oak &amp; Pine</b><small>oakandpine.example › services</small></div>
      </div>
      <p className={`${fc.oldTitle} ${fc.seq}`} style={step(0)}><span>Services | Oak &amp; Pine</span></p>
      <p className={fc.newTitle}><span className={fc.typed} style={step(3)}>Kitchen Remodeling in Austin | Oak &amp; Pine</span></p>
      <span className={fc.skeleton} /><span className={fc.skeleton} style={{ width: "68%" }} />
      <div className={fc.compare}>
        <span>Clicks</span>
        <div><small>Before</small><i><em className={fc.grow} style={{ ...step(5), width: "14%" }} /></i><b>3</b></div>
        <div data-after><small>After</small><i><em className={fc.grow} style={{ ...step(6), width: "100%" }} /></i><b>19</b></div>
      </div>
    </div>
  );
}

export function MentorVisual() {
  return (
    <div className={fc.chat}>
      <p className={`${fc.bubbleUser} ${fc.seq}`} style={step(0)}>Why is nobody clicking my services page?</p>
      <div className={`${fc.mentorRow} ${fc.seq}`} style={step(3)}>
        <span className={fc.mentorAvatar}><Sparkles size={14} strokeWidth={1.8} /></span>
        <div className={fc.bubbleMentor}>
          <b>Your SEO mentor</b>
          <p>People see it on Google, but the title only says “Services.” Say what you do, and where.</p>
          <span className={`${fc.suggestion} ${fc.seq}`} style={step(6)}><Check size={12} strokeWidth={2.4} />Kitchen Remodeling in Austin</span>
        </div>
      </div>
    </div>
  );
}

const outline = ["What affects the price", "Typical price ranges in Austin", "How to plan your budget", "Questions to ask a contractor"];

export function OutlineVisual() {
  return (
    <div className={fc.panel}>
      <span className={fc.tag}><Search size={12} strokeWidth={2} />kitchen remodel cost austin</span>
      <p className={`${fc.docTitle} ${fc.seq}`} style={step(1)}>How Much Does a Kitchen Remodel Cost in Austin?</p>
      <ol className={fc.outline}>
        {outline.map((heading, index) => (
          <li key={heading} className={fc.seq} style={step(index + 3)}><span>H2</span>{heading}</li>
        ))}
      </ol>
    </div>
  );
}

export function ProgressVisual() {
  return (
    <div className={fc.panel}>
      <div className={fc.trackHead}><b>Kitchen Remodeling page</b><span>Day 21 of 45</span></div>
      <div className={fc.trackBar}><em className={fc.grow} style={{ ...step(1), width: "47%" }} /></div>
      <div className={fc.trendWrap}>
      <svg className={fc.trend} viewBox="0 0 320 112" fill="none">
        <path className={fc.trendGrid} d="M0 28H320M0 60H320M0 92H320" />
        <path className={fc.trendBefore} d="M0 88L34 85L68 89L104 87" />
        <path className={fc.trendMark} d="M104 14V100" />
        <path className={fc.trendArea} d="M104 87C140 84 150 70 182 64C214 58 222 44 252 36C282 28 296 20 316 14V112H104Z" />
        <path className={`${fc.trendAfter} ${fc.drawn}`} style={step(3)} pathLength="1" d="M104 87C140 84 150 70 182 64C214 58 222 44 252 36C282 28 296 20 316 14" />
        <circle className={`${fc.trendDot} ${fc.seq}`} style={step(10)} cx="316" cy="14" r="4" />
      </svg>
      <span className={fc.trendLabel}>Title updated</span>
      </div>
      <div className={fc.stats}>
        <div className={fc.seq} style={step(6)}><small>Clicks</small><b>3<ArrowRight size={13} />19</b></div>
        <div className={fc.seq} style={step(7)}><small>Position on Google</small><b>14<ArrowRight size={13} />6</b></div>
      </div>
    </div>
  );
}

const searches = [
  { query: "kitchen remodel cost austin", seen: 320, open: true },
  { query: "small kitchen remodel ideas", seen: 210 },
  { query: "cabinet refacing austin", seen: 140, open: true },
  { query: "galley kitchen remodel", seen: 90 },
];

export function KeywordsVisual() {
  return (
    <div className={fc.panel}>
      <div className={fc.listHead}><span>Searches already finding you</span><span>Times seen</span></div>
      <ul className={fc.queries}>
        {searches.map((search, index) => (
          <li key={search.query} className={fc.seq} style={step(index + 1)} data-open={search.open || undefined}>
            <span>{search.query}</span>
            {search.open && <em>No page yet</em>}
            <b>{search.seen}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

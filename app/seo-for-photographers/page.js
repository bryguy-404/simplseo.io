import Link from "next/link";
import { ArrowRight, ArrowDown, Check, Globe2, Heart, Search, PencilLine, BarChart3, Plus, Users } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import HeroField from "@/components/HeroField";
import CTA from "@/components/CTA";
import MarketingThemeToggle from "@/components/MarketingThemeToggle";
import { PUBLIC_SITE_URL } from "@/app/lib/publicSite";
import PhotographerExample from "./PhotographerExample";
import polish from "@/components/HomepageRefinements.module.css";
import motion from "@/components/HomepageMotion.module.css";
import styles from "./Photographers.module.css";

const title = "SEO for Photographers: Simple SEO Software | SimplSEO";
const description = "SEO guidance for wedding and portrait photographers who manage their own websites. Find what to improve with SimplSEO. Request free early access.";
const pageUrl = `${PUBLIC_SITE_URL}/seo-for-photographers`;

export const metadata = {
  title,
  description,
  alternates: { canonical: pageUrl },
  openGraph: { title, description, url: pageUrl, siteName: "SimplSEO", type: "website", locale: "en_US" },
  twitter: {
    card: "summary_large_image", title, description,
    images: [{ url: `${pageUrl}/opengraph-image`, alt: "SimplSEO — SEO for wedding and portrait photographers" }],
  },
};

const workflow = [
  { icon: Globe2, title: "Connect your website", text: "Add your site and connect its Google Search Console property so your search data can inform the guidance." },
  { icon: Search, title: "Understand your next step", text: "Review a page and the reason behind a recommendation. Sometimes the useful next step is to leave a page as it is." },
  { icon: PencilLine, title: "Make a focused change", text: "Review the suggested work, make the edit in your website builder, and publish it yourself." },
  { icon: BarChart3, title: "Follow your progress", text: "Look at available search observations over time. Keep limited data and unanswered questions in perspective." },
];

const faqs = [
  {
    question: "Do I need to know SEO before I start?",
    answer: "You don’t need to be an SEO specialist. SimplSEO explains the recommendation and why it may matter. You do need access to edit your website and a willingness to review and make the changes. SEO means helping search engines understand your website so it can appear for relevant searches.",
  },
  {
    question: "Does SimplSEO make changes to my website for me?",
    answer: "You make and publish the changes in your own website editor. SimplSEO helps you understand what to work on and follow your search performance. It doesn’t automatically edit your website or manage your Google Business Profile.",
  },
  {
    question: "Can I keep my current photography website?",
    answer: "Yes, you keep your website and its editor. During early access, we’ll check whether we can review your site and connect its Google Search Console property. Being able to review a site is different from integrating with its builder: you’ll still publish edits yourself.",
  },
  {
    question: "Why do I connect Google Search Console?",
    answer: "Search Console is Google’s free tool for understanding how your website appears in Google Search. It provides observations such as appearances, clicks, and the searches that showed your pages. Connecting it lets SimplSEO use data from your own site rather than assume how it is performing.",
  },
  {
    question: "What if my website is new or has very little traffic?",
    answer: "Limited search data can make conclusions less certain. You can still review your website, but it may take time to collect enough observations to assess a change. Missing data should not be treated as proof that nobody searches for your services.",
  },
  {
    question: "Is SimplSEO free for photographers?",
    answer: "SimplSEO is free during early access, with no credit card required. Submit a request and we’ll review it. If approved, you’ll receive an invitation by email. We’re looking for feedback from wedding and portrait photographers across the United States who manage their own websites. Early access does not promise a permanent free plan.",
  },
  {
    question: "How soon will I rank higher or get more bookings?",
    answer: "There is no guaranteed ranking, booking increase, or timeline. Search engines need time to revisit changes, and other factors affect performance. SimplSEO helps you make informed improvements and review search observations; those observations alone do not prove an increase in inquiries or bookings.",
  },
];

const schema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: title,
  description,
  url: pageUrl,
  inLanguage: "en-US",
  isPartOf: { "@type": "WebSite", name: "SimplSEO", url: `${PUBLIC_SITE_URL}/home` },
  about: { "@type": "SoftwareApplication", name: "SimplSEO", applicationCategory: "BusinessApplication", operatingSystem: "Web", url: `${PUBLIC_SITE_URL}/home` },
};

export default function PhotographersPage() {
  return (
    <div className={`${polish.polish} ${styles.page}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(schema).replace(/</g, "\\u003c") }} />
      <a href="#photographers-main" className={styles.skipLink}>Skip to content</a>
      <div className={motion.ambient} aria-hidden="true"><i /><i /><i /><i /></div>
      <div className={styles.content}>
        <Navbar links={[{ label: "See an example", href: "#example" }, { label: "How it works", href: "#how-it-works" }, { label: "FAQ", href: "#faq" }]} actionLabel="Request access" />
        <main id="photographers-main">
          <section className={`${motion.heroStage} ${styles.hero}`} aria-labelledby="photographer-title">
            <HeroField />
            <div className={`${motion.heroContent} ${styles.heroContent}`}>
              <p className={`${styles.audience} ${motion.rise}`}><span className={styles.statusDot} />For photographers who manage their own websites</p>
              <h1 id="photographer-title" className={motion.rise} style={{ "--rise-delay": "90ms" }}>
                <span className={styles.titleIntro}>SEO software for</span>
                <span>wedding &amp; portrait</span>
                <span className={styles.titleAccent}>photographers.</span>
              </h1>
              <p className={`${styles.heroDescription} ${motion.rise}`} style={{ "--rise-delay": "190ms" }}>
                Know what to improve on your photography website and why it matters. Clear guidance, grounded in your website and Google Search Console data.
              </p>
              <div className={`${polish.heroActions} ${motion.rise}`} style={{ "--rise-delay": "290ms" }}>
                <Link href="/request-access" className={polish.primaryButton}>Request free early access<ArrowRight size={17} aria-hidden="true" /></Link>
                <a href="#example" className={polish.secondaryButton}>See how it works<ArrowDown size={16} aria-hidden="true" /></a>
              </div>
              <p className={styles.accessNote}>Free during early access. Requests are reviewed before invitations are sent.</p>
            </div>
          </section>

          <section className={`${styles.section} ${styles.introduction}`} aria-labelledby="photographer-why">
            <div>
              <p className={polish.eyebrow}>Your portfolio is only the beginning</p>
              <h2 id="photographer-why" className={polish.sectionTitle}>Beautiful work.<br />A website people can find.</h2>
              <p className={styles.bodyCopy}>Your photographs show what you do. Your website also needs to explain who you photograph, where you work, and what a client can expect.</p>
              <p className={styles.bodyCopy}>SimplSEO helps you take a practical, DIY approach to SEO, one page at a time. Use your website and its search data to understand a useful next step, then make the change in your own editor.</p>
            </div>
            <ul className={styles.benefits}>
              <li><span aria-hidden="true"><Check size={14} strokeWidth={2.4} /></span><div><h3>Understand your search traffic</h3><p>See how your pages appear in Google and which searches are available in your site’s data.</p></div></li>
              <li><span aria-hidden="true"><Check size={14} strokeWidth={2.4} /></span><div><h3>Know why a change is suggested</h3><p>Connect the recommendation to your page, your services, and the evidence behind it.</p></div></li>
              <li><span aria-hidden="true"><Check size={14} strokeWidth={2.4} /></span><div><h3>Keep the work manageable</h3><p>Review a focused improvement. Keep wording that already describes your business well.</p></div></li>
            </ul>
          </section>

          <section id="example" className={styles.section} aria-labelledby="photographer-example-title">
            <div className={styles.sectionHeading}>
              <p className={polish.eyebrow}>From a question to a next step</p>
              <h2 id="photographer-example-title" className={polish.sectionTitle}>What could you work on first?</h2>
              <p>Here’s one way to think through a wedding photography page. Explore each step.</p>
            </div>
            <PhotographerExample />
          </section>

          <section className={styles.section} aria-labelledby="photographer-specialties">
            <div className={styles.sectionHeading}>
              <p className={polish.eyebrow}>Two specialties. Your own next step.</p>
              <h2 id="photographer-specialties" className={polish.sectionTitle}>Advice with your photography in mind.</h2>
              <p>The right recommendation starts with the work you actually do and the clients you want to reach.</p>
            </div>
            <div className={styles.specialties}>
              <article className={styles.specialty}>
                <p className={styles.specialtyTag}><Heart size={14} strokeWidth={2} aria-hidden="true" />Weddings</p>
                <h3>SEO for wedding photographers</h3>
                <p>A couple finding your wedding page should be able to understand your approach, where you photograph, and how to inquire.</p>
                <ul>
                  <li><Check size={16} aria-hidden="true" />Review a title that describes your service and actual location.</li>
                  <li><Check size={16} aria-hidden="true" />Check whether your page answers useful questions about your wedding coverage.</li>
                  <li><Check size={16} aria-hidden="true" />Give real work and relevant experience a clear place on the page.</li>
                </ul>
                <p className={styles.specialtyPrompt}><span>A useful question</span>“Does my wedding page explain where I work, or only show my photographs?”</p>
              </article>
              <article className={styles.specialty}>
                <p className={styles.specialtyTag}><Users size={14} strokeWidth={2} aria-hidden="true" />Portraits</p>
                <h3>SEO for portrait photographers</h3>
                <p>Parents looking for family portraits need different details from someone booking a professional headshot. Help each visitor understand the service you offer.</p>
                <ul>
                  <li><Check size={16} aria-hidden="true" />Make the type of portrait session clear on the relevant page.</li>
                  <li><Check size={16} aria-hidden="true" />Explain your real location, session experience, and next step.</li>
                  <li><Check size={16} aria-hidden="true" />Improve existing content before assuming you need more pages.</li>
                </ul>
                <p className={styles.specialtyPrompt}><span>A useful question</span>“Can a parent tell what a family session with me is like and how to book?”</p>
              </article>
            </div>
            <p className={styles.sectionNote}>These are examples to consider, not a checklist every website needs. Your recommendations should reflect your own pages.</p>
          </section>

          <section id="how-it-works" className={styles.section} aria-labelledby="photographer-how">
            <div className={styles.workflowPanel}>
              <div className={styles.sectionHeading}>
                <p className={polish.eyebrow}>A routine you can understand</p>
                <h2 id="photographer-how" className={polish.sectionTitle}>Your website. Your next step.</h2>
                <p>SimplSEO helps you decide what to work on. You choose what to change.</p>
              </div>
              <ol className={styles.workflow}>
                {workflow.map((step, index) => {
                  const Icon = step.icon;
                  return <li key={step.title}>
                    <div className={styles.workflowIcon}><Icon size={22} strokeWidth={1.6} aria-hidden="true" /><span>{String(index + 1).padStart(2, "0")}</span></div>
                    <h3>{step.title}</h3><p>{step.text}</p>
                  </li>;
                })}
              </ol>
            </div>
          </section>

          <section className={`${styles.section} ${styles.fit}`} aria-labelledby="photographer-fit">
            <div><p className={polish.eyebrow}>Made for the owner behind the camera</p><h2 id="photographer-fit" className={polish.sectionTitle}>You don’t have to become an SEO expert.</h2></div>
            <div><p className={styles.bodyCopy}>You do need a website you can edit, access to its Google Search Console property, and time to act on useful advice. An existing site with some search history gives you more to learn from.</p><p className={styles.bodyCopy}>We’re inviting wedding and portrait photographers across the United States to try SimplSEO and tell us what’s helpful, confusing, or missing.</p><Link href="/request-access" className={styles.textLink}>Bring your website and your questions<ArrowRight size={17} aria-hidden="true" /></Link></div>
          </section>

          <section id="faq" className={`${styles.section} ${styles.faqSection}`} aria-labelledby="photographer-faq">
            <div className={styles.sectionHeading}><p className={polish.eyebrow}>Before you get started</p><h2 id="photographer-faq" className={polish.sectionTitle}>A little more clarity.</h2></div>
            <div className={styles.faqs}>
              {faqs.map(faq => <details className={styles.faq} key={faq.question}>
                <summary>{faq.question}<Plus size={19} aria-hidden="true" /></summary>
                <p>{faq.answer}</p>
              </details>)}
            </div>
          </section>

          <CTA eyebrow="For your next chapter" title="Give your photography website a clearer next step." description="Bring your website, your questions, and your feedback. Explore SimplSEO for free during early access, with no credit card required." buttonLabel="Request free early access" note="We review requests and email invitations to approved applicants." />
        </main>
        <Footer />
      </div>
      <MarketingThemeToggle />
    </div>
  );
}

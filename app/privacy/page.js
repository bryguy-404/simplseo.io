"use client";

import { useTheme } from "@/app/contexts/ThemeContext";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function PrivacyPolicyPage() {
  const { isDarkMode } = useTheme();

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Link 
            href="/home" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
          <div className="flex items-center gap-4">
            <img
              src={isDarkMode ? "./dark.png" : "./light.png"}
              alt="SimplSEO Logo"
              className="rounded-md"
              style={{ width: '150px', height: 'auto' }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-4xl font-bold text-foreground mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground mb-8">Last Updated: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p>

        <div className="prose prose-lg dark:prose-invert max-w-none space-y-8">
          
          {/* Introduction */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">1. Introduction and Acceptance</h2>
            <p className="text-foreground/90 leading-relaxed">
              This Privacy Policy (&quot;Policy&quot;) governs the collection, use, storage, processing, and disclosure of personal information by SimplSEO (&quot;we,&quot; &quot;us,&quot; &quot;our,&quot; or the &quot;Company&quot;) through our web application, website, and related services (collectively, the &quot;Service&quot;). By accessing or using our Service, you (&quot;User,&quot; &quot;you,&quot; or &quot;your&quot;) acknowledge that you have read, understood, and agree to be bound by this Policy in its entirety.
            </p>
            <p className="text-foreground/90 leading-relaxed font-semibold">
              IMPORTANT: You must explicitly agree to this Privacy Policy during the onboarding process before you can access or use our Service. Your continued use of the Service constitutes ongoing acceptance of this Policy and any updates thereto.
            </p>
            <p className="text-foreground/90 leading-relaxed">
              If you do not agree with any provision of this Policy, you must immediately cease using the Service and delete your account. Disagreement with this Policy after account creation does not exempt you from the terms you previously accepted.
            </p>
          </section>

          {/* Definitions */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">2. Definitions</h2>
            <p className="text-foreground/90 leading-relaxed">For the purposes of this Policy, the following definitions shall apply:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>&quot;Personal Information&quot;</strong> means any information that identifies, relates to, describes, is reasonably capable of being associated with, or could reasonably be linked, directly or indirectly, with a particular individual or household.</li>
              <li><strong>&quot;Processing&quot;</strong> means any operation or set of operations performed on Personal Information, including collection, recording, organization, structuring, storage, adaptation, alteration, retrieval, consultation, use, disclosure, dissemination, alignment, combination, restriction, erasure, or destruction.</li>
              <li><strong>&quot;Google Search Console Data&quot;</strong> means search performance data, including but not limited to keywords, search queries, page URLs, click-through rates, impressions, and average position rankings obtained through Google&apos;s Search Console API.</li>
              <li><strong>&quot;AI-Generated Content&quot;</strong> means any content, suggestions, recommendations, or outputs produced by our artificial intelligence systems based on your data.</li>
              <li><strong>&quot;Training Data&quot;</strong> means anonymized and aggregated data derived from user interactions used to improve our AI models and services.</li>
            </ul>
          </section>

          {/* Information We Collect */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">3. Information We Collect</h2>
            
            <h3 className="text-xl font-medium text-foreground mt-6">3.1 Account and Authentication Information</h3>
            <p className="text-foreground/90 leading-relaxed">When you create an account or authenticate with our Service, we collect:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Email Address:</strong> Collected through direct registration or Google OAuth authentication. Used for account identification, authentication, communication, and password recovery.</li>
              <li><strong>Firebase User ID:</strong> A unique identifier assigned by Firebase Authentication to identify your account across our systems.</li>
              <li><strong>Google OAuth Tokens:</strong> Access tokens and refresh tokens obtained through Google OAuth 2.0 authentication, used exclusively to access Google Search Console data on your behalf.</li>
              <li><strong>Authentication Timestamps:</strong> Records of when you log in, log out, and authenticate with third-party services.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">3.2 Business and Onboarding Information</h3>
            <p className="text-foreground/90 leading-relaxed">During the onboarding process, we collect:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Business Name:</strong> The name of your business or organization.</li>
              <li><strong>Website URL:</strong> The primary URL of the website you wish to analyze and optimize.</li>
              <li><strong>Business Type/Industry:</strong> The category or industry classification of your business (e.g., &quot;Restaurant,&quot; &quot;Law Firm,&quot; &quot;E-commerce&quot;).</li>
              <li><strong>Business Location:</strong> Geographic location information including city, state/province, and country.</li>
              <li><strong>Google Search Console Property:</strong> The specific GSC property you authorize us to access.</li>
              <li><strong>User First Name:</strong> Your first name for personalization of communications and the AI assistant.</li>
              <li><strong>Onboarding Completion Status:</strong> Whether you have completed the onboarding process.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">3.3 Google Search Console Data</h3>
            <p className="text-foreground/90 leading-relaxed">With your explicit authorization via Google OAuth, we access and store the following data from your Google Search Console account:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Search Queries/Keywords:</strong> The search terms users enter in Google that result in impressions or clicks to your website.</li>
              <li><strong>Page URLs:</strong> The specific pages on your website that appear in search results.</li>
              <li><strong>Impressions:</strong> The number of times your pages appeared in search results.</li>
              <li><strong>Clicks:</strong> The number of times users clicked through to your website from search results.</li>
              <li><strong>Click-Through Rate (CTR):</strong> The percentage of impressions that resulted in clicks.</li>
              <li><strong>Average Position:</strong> The average ranking position of your pages in search results.</li>
              <li><strong>Date-Based Performance Metrics:</strong> Historical performance data typically spanning the last 28 days.</li>
            </ul>
            <p className="text-foreground/90 leading-relaxed">
              <strong>Note:</strong> We only request read-only access to your Google Search Console data. We cannot modify, delete, or submit data to your Google Search Console account.
            </p>

            <h3 className="text-xl font-medium text-foreground mt-6">3.4 User-Generated Content and Interactions</h3>
            <p className="text-foreground/90 leading-relaxed">We collect information you provide through your use of the Service:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Focus Keywords:</strong> Keywords you select or designate for optimization tracking.</li>
              <li><strong>Implemented SEO Tips:</strong> Records of which SEO recommendations you mark as implemented, including timestamps.</li>
              <li><strong>Content Opportunities:</strong> Keywords and page opportunities you mark as &quot;created&quot; for tracking purposes.</li>
              <li><strong>Chat Conversations:</strong> Messages you send to our AI SEO assistant, including questions, requests, and feedback.</li>
              <li><strong>Intent Mismatch Analyses:</strong> Results of AI analyses comparing your page content with user search intent.</li>
              <li><strong>Meta Title/Description Preferences:</strong> AI-generated meta titles and descriptions you accept or modify.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">3.5 Automatically Collected Technical Information</h3>
            <p className="text-foreground/90 leading-relaxed">We automatically collect certain information when you access or use the Service:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Device Information:</strong> Browser type, operating system, and device identifiers.</li>
              <li><strong>Usage Data:</strong> Pages visited, features used, time spent on pages, and navigation patterns.</li>
              <li><strong>Log Data:</strong> Server logs including IP addresses, access times, and referring URLs.</li>
              <li><strong>Local Storage Data:</strong> Information stored in your browser&apos;s local storage for session management and user preferences.</li>
            </ul>
          </section>

          {/* How We Use Your Information */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">4. How We Use Your Information</h2>
            
            <h3 className="text-xl font-medium text-foreground mt-6">4.1 Primary Service Purposes</h3>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>SEO Analysis and Recommendations:</strong> Processing your GSC data to identify optimization opportunities, track keyword rankings, and generate actionable SEO recommendations.</li>
              <li><strong>AI-Powered Assistance:</strong> Using relevant website observations, saved account evidence, business details, and conversation context to generate personalized SEO guidance.</li>
              <li><strong>Performance Tracking:</strong> Monitoring changes in your search performance over time and alerting you to significant changes.</li>
              <li><strong>Content Optimization:</strong> Generating and suggesting improvements to meta titles, descriptions, and content based on search intent analysis.</li>
              <li><strong>Page Updates:</strong> Providing in-app notices about saved result comparisons, published-page check-ins, verified technical concerns, and Google reconnection needs. If you opt in, we send a roundup to your verified sign-in email when new updates are available. These notices do not imply SEO success or that an edit caused a change.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">4.2 Service Improvement</h3>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>AI Model Training:</strong> Using anonymized and aggregated data to improve our AI models&apos; accuracy and relevance.</li>
              <li><strong>Feature Development:</strong> Analyzing usage patterns to develop new features and improve existing functionality.</li>
              <li><strong>Quality Assurance:</strong> Testing and debugging to ensure Service reliability and security.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">4.3 Communication</h3>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Service-Related Communications:</strong> Account verification, security alerts, and important service updates.</li>
              <li><strong>Performance Notifications:</strong> Alerts when your pages start ranking or achieve significant milestones.</li>
              <li><strong>Support:</strong> Responding to your inquiries and providing technical assistance.</li>
            </ul>
          </section>

          {/* Data Storage and Security */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">5. Data Storage and Security</h2>
            
            <h3 className="text-xl font-medium text-foreground mt-6">5.1 Storage Infrastructure</h3>
            <p className="text-foreground/90 leading-relaxed">Your data is stored using the following services and technologies:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Firebase/Firestore:</strong> Cloud-hosted NoSQL database provided by Google for storing user data, onboarding information, and application state.</li>
              <li><strong>Firebase Authentication:</strong> Secure authentication service managing user credentials and OAuth tokens.</li>
              <li><strong>Vercel:</strong> Cloud platform hosting our application with built-in security features.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">5.2 Security Measures</h3>
            <p className="text-foreground/90 leading-relaxed">We implement the following security measures to protect your data:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Encryption in Transit:</strong> All data transmitted between your browser and our servers is encrypted using TLS/SSL protocols.</li>
              <li><strong>Encryption at Rest:</strong> Data stored in our databases is encrypted using industry-standard encryption algorithms.</li>
              <li><strong>Access Controls:</strong> Strict Firestore security rules ensure users can only access their own data.</li>
              <li><strong>User ID Hashing:</strong> For training and analytics purposes, user IDs are hashed using SHA-256 encryption before storage.</li>
              <li><strong>Token Security:</strong> OAuth tokens are stored securely and refreshed automatically to maintain security.</li>
              <li><strong>Environment Variables:</strong> Sensitive configuration data (API keys, secrets) are stored as encrypted environment variables, never in code.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">5.3 Data Retention</h3>
            <p className="text-foreground/90 leading-relaxed">We retain your data according to the following policies:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Active Account Data:</strong> Retained for the duration of your account&apos;s existence.</li>
              <li><strong>GSC Performance Data:</strong> Cached data is refreshed regularly; historical snapshots may be retained for trend analysis.</li>
              <li><strong>Training Data:</strong> Anonymized training data may be retained indefinitely to improve our AI models.</li>
              <li><strong>Mentor Conversations:</strong> Your messages and saved replies are stored so you can return to a conversation in the chat widget or SEO Mentor. Saving a conversation does not automatically train a model.</li>
              <li><strong>Deleted Account Data:</strong> Upon account deletion, we will delete your Personal Information within 30 days, except where retention is required by law or for legitimate business purposes (e.g., anonymized training data).</li>
            </ul>
          </section>

          {/* Data Sharing and Disclosure */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">6. Data Sharing and Disclosure</h2>
            
            <h3 className="text-xl font-medium text-foreground mt-6">6.1 Third-Party Service Providers</h3>
            <p className="text-foreground/90 leading-relaxed">We share data with the following categories of service providers:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Google (Firebase, Google Cloud):</strong> Authentication, database hosting, and cloud infrastructure.</li>
              <li><strong>Google Search Console API:</strong> To fetch your search performance data with your authorization.</li>
              <li><strong>OpenAI:</strong> AI language model provider for generating SEO recommendations and powering our AI assistant. Your data may be processed by OpenAI&apos;s systems to generate responses.</li>
              <li><strong>Vercel:</strong> Application hosting and deployment.</li>
              <li><strong>Resend:</strong> For optional page-update emails, we send your verified recipient address and a short summary with page names, dates, and links. We do not include private search-query tables or chat content. Open and click tracking are disabled for these emails. Delivery, bounce, and complaint records help prevent duplicate or unwanted mail. Existing contact and access-request messages use our separate email service.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">6.2 What We Do NOT Share</h3>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>We do not sell your Personal Information to third parties.</li>
              <li>We do not share your raw GSC data with other users or competitors.</li>
              <li>We do not provide access to your account credentials to any third party.</li>
              <li>We do not share your business-specific information with marketing or advertising networks.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">6.3 Legal Disclosure</h3>
            <p className="text-foreground/90 leading-relaxed">We may disclose your information if required by law, including:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>In response to valid legal process (subpoenas, court orders, government requests).</li>
              <li>To protect our rights, property, or safety, or that of our users or the public.</li>
              <li>To investigate potential violations of our Terms of Service.</li>
              <li>In connection with a merger, acquisition, or sale of assets (with prior notice to users).</li>
            </ul>
          </section>

          {/* AI and Machine Learning */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">7. AI and Machine Learning</h2>
            
            <h3 className="text-xl font-medium text-foreground mt-6">7.1 How We Use AI</h3>
            <p className="text-foreground/90 leading-relaxed">Our Service uses artificial intelligence and machine learning in the following ways:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Personalized AI Assistant:</strong> The mentor uses relevant saved business information, website content, search observations, and conversation history as context when answering your questions. It does not create or automatically train a separate model for your business.</li>
              <li><strong>Content Analysis:</strong> AI analyzes your page content to detect intent mismatches with search queries.</li>
              <li><strong>Meta Content Generation:</strong> AI generates suggested meta titles and descriptions optimized for your target keywords.</li>
              <li><strong>Keyword Classification:</strong> AI identifies generic vs. branded keywords and categorizes opportunities.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">7.2 Mentor Conversations, Evidence, and Usage</h3>
            <p className="text-foreground/90 leading-relaxed">The personalized mentor processes and stores the following information to answer questions and preserve your work:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li><strong>Saved Conversations:</strong> Your submitted messages, replies, and supporting references are stored with your account. New mentor conversations are not copied into separate training-event logs.</li>
              <li><strong>Account Evidence:</strong> Relevant confirmed business details, website excerpts, dated search observations, and saved recommendations may be included in requests to OpenAI to answer your question.</li>
              <li><strong>Operational Usage:</strong> Separate accounting records track model usage, estimated costs, timing, and request outcomes. These records exclude conversation message text.</li>
              <li><strong>Public Documentation Research:</strong> When needed, the mentor searches official Google documentation using generic SEO topic terms. These public searches do not include your raw conversation, private Search Console queries or metrics, credentials, or unconfirmed business details.</li>
            </ul>
            <p className="text-foreground/90 leading-relaxed">
              Personalization and saved history do not automatically train a model or change your confirmed business profile. This mentor update does not itself remove records retained by earlier features; existing records remain subject to the retention and deletion provisions in this Policy.
            </p>

            <h3 className="text-xl font-medium text-foreground mt-6">7.3 Third-Party AI Processing</h3>
            <p className="text-foreground/90 leading-relaxed">
              Our AI features are powered by OpenAI&apos;s language models. When you use AI features, your data (including business context, page content, and queries) may be sent to OpenAI for processing. OpenAI&apos;s data usage is governed by their privacy policy and API terms of service. We do not send your GSC authentication credentials or tokens to OpenAI.
            </p>
          </section>

          {/* Your Rights and Choices */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">8. Your Rights and Choices</h2>
            
            <h3 className="text-xl font-medium text-foreground mt-6">8.1 Access and Portability</h3>
            <p className="text-foreground/90 leading-relaxed">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>Access the Personal Information we hold about you.</li>
              <li>Request a copy of your data in a portable format.</li>
              <li>View your GSC data and analysis results through the dashboard.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">8.2 Correction and Deletion</h3>
            <p className="text-foreground/90 leading-relaxed">You have the right to:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>Correct inaccurate Personal Information through account settings.</li>
              <li>Delete your account and associated data through the Settings page.</li>
              <li>Request deletion of specific data by contacting us.</li>
            </ul>

            <h3 className="text-xl font-medium text-foreground mt-6">8.3 Consent Withdrawal</h3>
            <p className="text-foreground/90 leading-relaxed">You may:</p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>Revoke Google Search Console access at any time through your Google Account settings.</li>
              <li>Opt out of notification emails through account settings.</li>
              <li>Delete your account to cease all data processing.</li>
            </ul>
            <p className="text-foreground/90 leading-relaxed">
              <strong>Note:</strong> Withdrawing consent may limit or prevent your ability to use certain features of the Service.
            </p>

            <h3 className="text-xl font-medium text-foreground mt-6">8.4 Account Deletion</h3>
            <p className="text-foreground/90 leading-relaxed">
              You can delete your account at any time through the Settings page. Upon deletion:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>Your account credentials and associated Personal Information (GSC data, SEO analyses, chat history, etc.) will be deleted immediately.</li>
              <li>Anonymized training data may be retained as it cannot be linked back to you.</li>
              <li>Cached data and logs will be purged according to our retention schedules.</li>
              <li><strong>Limited Retention for Product Improvement:</strong> We may retain your email address and basic account information (such as your website URL) for up to 90 days after deletion. This allows us to follow up for feedback to improve our service. This information is not used for marketing and will be permanently deleted after this period.</li>
              <li>This action is irreversible regarding your account access and primary data.</li>
            </ul>
          </section>

          {/* Consent Requirement */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">9. Consent Requirement for Service Use</h2>
            <p className="text-foreground/90 leading-relaxed font-semibold">
              BY USING OUR SERVICE, YOU EXPLICITLY CONSENT TO:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-foreground/90">
              <li>The collection and processing of all data described in this Policy.</li>
              <li>The use of your data for AI processing, saved conversations, and usage accounting as described in Section 7.</li>
              <li>The sharing of your data with third-party service providers as described in Section 6.</li>
              <li>The storage of your data using the infrastructure described in Section 5.</li>
              <li>Receiving service-related communications at the email address associated with your account.</li>
            </ul>
            <p className="text-foreground/90 leading-relaxed">
              <strong>Mandatory Agreement:</strong> During onboarding, you will be required to explicitly acknowledge and accept this Privacy Policy before proceeding. You cannot use the Service without this acceptance. This consent is a condition of using our Service.
            </p>
          </section>

          {/* International Data Transfers */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">10. International Data Transfers</h2>
            <p className="text-foreground/90 leading-relaxed">
              Your data may be transferred to, stored, and processed in countries other than your country of residence, including the United States. By using our Service, you consent to the transfer of your data to countries that may have different data protection laws than your jurisdiction. We ensure appropriate safeguards are in place for such transfers.
            </p>
          </section>

          {/* Children&apos;s Privacy */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">11. Children&apos;s Privacy</h2>
            <p className="text-foreground/90 leading-relaxed">
              Our Service is not intended for individuals under the age of 18. We do not knowingly collect Personal Information from children. If you believe we have collected information from a child, please contact us immediately, and we will take steps to delete such information.
            </p>
          </section>

          {/* Changes to This Policy */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">12. Changes to This Policy</h2>
            <p className="text-foreground/90 leading-relaxed">
              We reserve the right to modify this Privacy Policy at any time. Material changes will be communicated via email or prominent notice within the Service. Your continued use of the Service after such modifications constitutes acceptance of the updated Policy. We encourage you to review this Policy periodically.
            </p>
          </section>

          {/* Contact Information */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">13. Contact Information</h2>
            <p className="text-foreground/90 leading-relaxed">
              For questions, concerns, or requests regarding this Privacy Policy or your Personal Information, please contact us at:
            </p>
            <div className="bg-muted/50 p-4 rounded-lg">
              <p className="text-foreground/90"><strong>SimplSEO</strong></p>
              <p className="text-foreground/90">Email: simplseoai@gmail.com</p>
            </div>
            <p className="text-foreground/90 leading-relaxed">
              We will respond to your inquiry within 30 days.
            </p>
          </section>

          {/* Governing Law */}
          <section className="space-y-4">
            <h2 className="text-2xl font-semibold text-foreground border-b border-border pb-2">14. Governing Law</h2>
            <p className="text-foreground/90 leading-relaxed">
              This Privacy Policy shall be governed by and construed in accordance with the laws of the United States, without regard to its conflict of law provisions. Any disputes arising from this Policy shall be resolved in the courts of competent jurisdiction.
            </p>
          </section>

          {/* Acknowledgment */}
          <section className="space-y-4 bg-primary/10 p-6 rounded-lg border border-primary/20">
            <h2 className="text-2xl font-semibold text-foreground">Acknowledgment</h2>
            <p className="text-foreground/90 leading-relaxed">
              By creating an account and using SimplSEO, you acknowledge that:
            </p>
            <ol className="list-decimal pl-6 space-y-2 text-foreground/90">
              <li>You have read and understood this Privacy Policy in its entirety.</li>
              <li>You consent to the collection, use, and processing of your data as described herein.</li>
              <li>You understand that your consent is a mandatory requirement for using the Service.</li>
              <li>You may withdraw your consent by deleting your account, which will terminate your access to the Service.</li>
              <li>This Policy may be updated, and continued use constitutes acceptance of any changes.</li>
            </ol>
          </section>

        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-8 px-4 mt-12">
        <div className="max-w-4xl mx-auto text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} SimplSEO. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}

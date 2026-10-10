import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { db } from "../../../lib/firebaseAdmin";
import {
  logTrainingEvent,
  summarizeSeoContext,
} from "../../../lib/trainingLogger";
import { getPlaybookStrategies } from "../../../lib/playbookHelpers";
// import { doc, getDoc, setDoc } from "firebase/firestore";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function handlePOST(req) {
  const {
    pageUrl,
    onboarding = {},
    context = {},
    focusKeywords = "",
    userId,
    previousAttempts = [], // Array of previous meta optimization attempts with performance data
  } = await req.json();

  const normalizeFocusKeywordList = (value) => {
    if (Array.isArray(value)) {
      return value
        .map((kw) => (typeof kw === "string" ? kw.trim() : ""))
        .filter(Boolean);
    }
    if (typeof value === "string") {
      return value
        .split(",")
        .map((kw) => kw.trim())
        .filter(Boolean);
    }
    return [];
  };

  const focusKeywordList = normalizeFocusKeywordList(focusKeywords);
  
  // DEBUG: Log what we received
  console.log(`📥 [META DESC API] Received request for: ${pageUrl}`);
  console.log(`📥 [META DESC API] focusKeywords received:`, focusKeywords);
  console.log(`📥 [META DESC API] focusKeywordList (normalized):`, focusKeywordList);
  console.log(`📥 [META DESC API] userId:`, userId);
  console.log(`📥 [META DESC API] context.source:`, context?.source);
  console.log(`📥 [META DESC API] Stack trace:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));

  // 🚨 GUARD: Prevent creating documents with empty focusKeywords
  if (!focusKeywordList || focusKeywordList.length === 0) {
    console.error(`❌ [META DESC API] BLOCKED: Empty focusKeywords for ${pageUrl}`);
    console.error(`❌ [META DESC API] Request body:`, JSON.stringify({ pageUrl, focusKeywords, userId, context: context?.source }));
    return NextResponse.json(
      { 
        error: "focusKeywords is required. Please provide at least one focus keyword.",
        pageUrl 
      },
      { status: 400 }
    );
  }
  
  const focusKeywordsString = focusKeywordList.join(", ");
  const focusKeywordCacheKey = focusKeywordList.length
    ? `${pageUrl}::${focusKeywordList
        .map((kw) => kw.toLowerCase())
        .join("||")}`
    : pageUrl;

  // Check cache using backward-compatible helper
  const { getCachedMetaDescription } = await import("../../../lib/firestoreMigrationHelpers");
  const cached = await getCachedMetaDescription(userId, focusKeywordCacheKey);

  if (cached.success && cached.data?.description) {
    return NextResponse.json({ description: cached.data.description });
  }

  // 🧠 Try to get playbook strategies (returns [] if feature flag disabled)
  let playbookStrategies = [];
  if (onboarding?.businessType) {
    try {
      playbookStrategies = await getPlaybookStrategies({
        businessType: onboarding.businessType,
        businessLocation: onboarding.businessLocation,
        strategyType: "meta_description_optimization",
        limit: 5,
      });
    } catch (error) {
      console.error("Error fetching playbook strategies:", error);
      // Continue without playbook data - fallback to OpenAI only
    }
  }

  // Build prompt with or without playbook examples
  let prompt = `
You are an expert SEO copywriter who writes meta descriptions that get clicks.

Create a **compelling, action-driven meta description** for the following page:

---
Page URL: ${pageUrl}
Business Name: ${onboarding?.businessName || "N/A"}
Business Location: ${onboarding?.businessLocation || "N/A"}
Business Type: ${onboarding?.businessType || "N/A"}
Focus Keywords: ${focusKeywordsString || "N/A"}
Context: ${JSON.stringify(context)}
---

**CRITICAL:** If a Business Name is provided, use it EXACTLY as written — no modifications, abbreviations, or guesses.`;

  // Include previous attempts if available - helps AI learn from what didn't work
  if (previousAttempts && previousAttempts.length > 0) {
    prompt += `\n\n**PREVIOUS ATTEMPT ANALYSIS - LEARN FROM FAILURES:**\n`;
    prompt += `The following meta description(s) were tried before but FAILED to generate clicks:\n\n`;
    
    previousAttempts.forEach((attempt, index) => {
      const impressions = attempt.finalStats?.impressions || attempt.preStats?.impressions || 0;
      const clicks = attempt.finalStats?.clicks ?? 0;
      const position = Math.round(attempt.finalStats?.position || attempt.preStats?.position || 0);
      const daysTracked = attempt.daysTracked || 0;
      const descText = attempt.description || "[Description not recorded]";
      const attemptKeyword = attempt.keyword || attempt.previousKeyword || null;
      const attemptType = attempt.type || "meta-optimization";
      
      // Convert position to page number for context
      const pageNumber = position <= 10 ? "Page 1" : position <= 20 ? "Page 2" : position <= 30 ? "Page 3" : "Page 4+";
      
      prompt += `**Attempt #${index + 1}:**\n`;
      prompt += `Description: "${descText}"\n`;
      
      // Add keyword context if it was a pivot
      if (attemptKeyword) {
        prompt += `Target Keyword: "${attemptKeyword}"`;
        if (attemptType === "pivot-keyword-change" && attempt.newKeyword) {
          prompt += ` → Pivoted to: "${attempt.newKeyword}"`;
        }
        prompt += `\n`;
      }
      
      prompt += `Results: ${impressions} impressions, ${clicks} clicks, Position ${position} (${pageNumber}), tracked for ${daysTracked} days\n\n`;
      
      prompt += `What this means:\n`;
      prompt += `- Users SAW this description in search results (${impressions} times)\n`;
      prompt += `- Users CHOSE NOT TO CLICK (${clicks} clicks = ${impressions > 0 ? ((clicks/impressions)*100).toFixed(1) : 0}% CTR)\n`;
      if (attemptType === "pivot-keyword-change") {
        prompt += `- This was a KEYWORD PIVOT - the keyword itself may not match user intent\n`;
      } else {
        prompt += `- The description likely didn't convince them or match their intent\n`;
      }
      prompt += `\n`;
    });
    
    prompt += `**Your task:** Create a NEW description with a COMPLETELY DIFFERENT approach.

Consider why users might have skipped the previous description(s):
- Was the CTA weak? → Use stronger action verbs (Get, Discover, See, Start)
- Was it too generic? → Add specific details, numbers, or outcomes
- Did it address pain points? → Speak to what users are struggling with
- Was it too long/cluttered? → Make it scannable with clear value prop
- Did it match search intent? → Info-seekers want different things than buyers

Try one of these structural changes:
- If previous was passive → Try direct address ("You'll discover..." or "Get your...")
- If previous had weak CTA → Try urgency ("Start today", "See why ${new Date().getFullYear()} is different")
- If previous was feature-list → Try benefit-focused (outcomes, not features)
- If previous was long → Try shorter with one clear promise
- If previous was formal → Try conversational and relatable

**STRATEGIC GOAL:**
- KEEP the target keyword "${focusKeywordsString || 'main keyword'}" naturally included for ranking stability
- CHANGE everything else: phrasing, CTA, structure, hook, value proposition

The previous description(s) maintained ranking but failed to generate clicks. Your job is to make it click-worthy while preserving keyword relevance.

**CRITICAL:** Do NOT use similar phrasing, CTAs, structure, or hooks as ANY of the previous attempts. Make it genuinely different.\n`;
  }

  // Include playbook examples if available
  if (playbookStrategies.length > 0) {
    prompt += `\n\n**Successful Examples from Similar ${onboarding.businessType} Businesses:**\n`;
    playbookStrategies.forEach((strategy, index) => {
      const improvements = [];
      if (strategy.improvement?.ctrIncrease > 0) {
        improvements.push(`CTR +${strategy.improvement.ctrIncrease.toFixed(1)}%`);
      }
      if (strategy.improvement?.clicksIncrease > 0) {
        improvements.push(`Clicks +${strategy.improvement.clicksIncrease.toFixed(1)}%`);
      }
      if (strategy.improvement?.positionImprovement > 0) {
        improvements.push(`Position +${strategy.improvement.positionImprovement.toFixed(1)}`);
      }
      const improvementText = improvements.length > 0 ? ` (${improvements.join(", ")})` : "";
      prompt += `${index + 1}. "${strategy.description}"${improvementText}\n`;
    });
    prompt += `\nUse these successful examples as inspiration, but create a unique description tailored to this specific page.\n`;
  }

  prompt += `\n**WRITING GUIDELINES:**
- **Length:** Stay between 140-155 characters for optimal display in Google search results.
- **Structure:** Lead with a benefit or hook, include the focus keyword naturally, end with a clear call-to-action.
- **Tone:** Write like a human, not a robot. Be conversational and confident.
- **Avoid generic phrases:** Never use "elevate your online presence", "take your business to the next level", "solutions for your needs", or similar clichés.
- **Be specific:** Mention concrete benefits, outcomes, or differentiators (e.g., "free consultation", "same-day response", "10+ years experience").
- **Vary your approach:** Each description should feel unique and tailored to this specific page — not templated.
- **Call-to-action:** Use action words like "Get", "Discover", "See", "Learn", "Contact" — but vary them across pages.
- **CRITICAL:** Business name must appear EXACTLY as provided.
- **Output:** Only the meta description — no quotes, no explanations, no extra text.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 100,
  });

  const description = response.choices[0].message.content.trim();

  const createdAt = new Date().toISOString();

  // Save using backward-compatible helper (writes to both structures)
  if (userId) {
    const { saveMetaDescription } = await import("../../../lib/firestoreMigrationHelpers");
    await saveMetaDescription(userId, focusKeywordCacheKey, {
      description,
      createdAt,
      focusKeywords: focusKeywordList,
      pageUrl,
    });
  }

  await logTrainingEvent({
    userId,
    eventType: "meta_description_generated",
    businessType: onboarding?.businessType,
    businessLocation: onboarding?.businessLocation,
    payload: {
      pageUrl,
      focusKeywords: focusKeywordList,
      context: await summarizeSeoContext(context),
      description,
      createdAt,
    },
  });

  return NextResponse.json({ description });
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { db } from "../../../lib/firebaseAdmin";
import {
  logTrainingEvent,
  summarizeSeoContext,
} from "../../../lib/trainingLogger";
import { getPlaybookStrategies } from "../../../lib/playbookHelpers";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function handlePOST(req) {
  let {
    pageUrl,
    onboarding,
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
  console.log(`📥 [META TITLE API] Received request for: ${pageUrl}`);
  console.log(`📥 [META TITLE API] focusKeywords received:`, focusKeywords);
  console.log(`📥 [META TITLE API] focusKeywordList (normalized):`, focusKeywordList);
  console.log(`📥 [META TITLE API] userId:`, userId);
  console.log(`📥 [META TITLE API] context.source:`, context?.source);
  console.log(`📥 [META TITLE API] Stack trace:`, new Error().stack?.split('\n').slice(1, 4).join('\n'));

  // 🚨 GUARD: Prevent creating documents with empty focusKeywords
  if (!focusKeywordList || focusKeywordList.length === 0) {
    console.error(`❌ [META TITLE API] BLOCKED: Empty focusKeywords for ${pageUrl}`);
    console.error(`❌ [META TITLE API] Request body:`, JSON.stringify({ pageUrl, focusKeywords, userId, context: context?.source }));
    return NextResponse.json(
      { 
        error: "focusKeywords is required. Please provide at least one focus keyword.",
        pageUrl 
      },
      { status: 400 }
    );
  }

  // 🧠 Fallback if onboarding was not passed in
  if (!onboarding && userId) {
    try {
      const snap = await db.collection("onboarding").doc(userId).get();
      if (snap.exists) {
        onboarding = snap.data();
      }
    } catch (err) {
      console.error("Failed to load onboarding:", err);
    }
  }

  // NOTE: We intentionally do NOT auto-extract keywords here.
  // Focus keywords should always be passed from the client (dashboard, low-ctr, easy-wins).
  // This prevents creating duplicate documents with different auto-extracted keywords.

  const focusKeywordCacheKey = focusKeywordList.length
    ? `${pageUrl}::${focusKeywordList
        .map((kw) => kw.toLowerCase())
        .join("||")}`
    : pageUrl;

  // Check cache using backward-compatible helper
  const { getCachedMetaTitle } = await import("../../../lib/firestoreMigrationHelpers");
  const cached = await getCachedMetaTitle(userId, focusKeywordCacheKey);

  if (cached.success && cached.data?.title) {
    return NextResponse.json({ title: cached.data.title });
  }

  const focusKeywordsString = focusKeywordList.join(", ");

  // 🧠 Try to get playbook strategies (returns [] if feature flag disabled)
  let playbookStrategies = [];
  if (onboarding?.businessType) {
    try {
      playbookStrategies = await getPlaybookStrategies({
        businessType: onboarding.businessType,
        businessLocation: onboarding.businessLocation,
        strategyType: "meta_title_optimization",
        limit: 5,
      });
    } catch (error) {
      console.error("Error fetching playbook strategies:", error);
      // Continue without playbook data - fallback to OpenAI only
    }
  }

  // Build prompt with or without playbook examples
  let prompt = `
You are an expert SEO copywriter who writes meta titles that get clicks.

Create a **compelling, click-worthy meta title** for the following page:

---
Page URL: ${pageUrl}
Business Name: ${onboarding?.businessName || "N/A"}
Business Location: ${onboarding?.businessLocation || "N/A"}
Business Type: ${onboarding?.businessType || "N/A"}
Focus Keywords: ${focusKeywordsString || "N/A"}
Context (Impressions, CTR, etc): ${JSON.stringify(context)}
---

**CRITICAL RULES:**
- If a Business Name is provided, use it EXACTLY as written — no modifications, abbreviations, or guesses.
- Lead with the focus keyword or a compelling hook, then add the brand name at the end.
- Make every word earn its place — no filler words.`;

  // Include previous attempts if available - helps AI learn from what didn't work
  if (previousAttempts && previousAttempts.length > 0) {
    prompt += `\n\n**PREVIOUS ATTEMPT ANALYSIS - LEARN FROM FAILURES:**\n`;
    prompt += `The following meta title(s) were tried before but FAILED to generate clicks:\n\n`;
    
    previousAttempts.forEach((attempt, index) => {
      const impressions = attempt.finalStats?.impressions || attempt.preStats?.impressions || 0;
      const clicks = attempt.finalStats?.clicks ?? 0;
      const position = Math.round(attempt.finalStats?.position || attempt.preStats?.position || 0);
      const daysTracked = attempt.daysTracked || 0;
      const titleText = attempt.title || "[Title not recorded]";
      const attemptKeyword = attempt.keyword || attempt.previousKeyword || null;
      const attemptType = attempt.type || "meta-optimization";
      
      // Convert position to page number for context
      const pageNumber = position <= 10 ? "Page 1" : position <= 20 ? "Page 2" : position <= 30 ? "Page 3" : "Page 4+";
      
      prompt += `**Attempt #${index + 1}:**\n`;
      prompt += `Title: "${titleText}"\n`;
      
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
      prompt += `- Users SAW this title in search results (${impressions} times)\n`;
      prompt += `- Users CHOSE NOT TO CLICK (${clicks} clicks = ${impressions > 0 ? ((clicks/impressions)*100).toFixed(1) : 0}% CTR)\n`;
      if (attemptType === "pivot-keyword-change") {
        prompt += `- This was a KEYWORD PIVOT - the keyword itself may not match user intent\n`;
      } else {
        prompt += `- The title likely didn't match their intent or wasn't compelling enough\n`;
      }
      prompt += `\n`;
    });
    
    prompt += `**Your task:** Create a NEW title with a COMPLETELY DIFFERENT approach.

Consider why users might have skipped the previous title(s):
- Was it too generic? → Be more specific
- Was it too vague? → Add concrete details (numbers, outcomes, specifics)
- Did it match search intent? → Check if users want info, comparison, how-to, or solution
- Was it boring? → Try a stronger emotional hook or power word
- Was the brand placement wrong? → Try leading with benefit instead

Try one of these structural changes:
- If previous was a statement → Try a question format
- If previous was generic → Try adding [${new Date().getFullYear()}] or specific numbers
- If previous was feature-focused → Try benefit-focused
- If previous was long → Try shorter and punchier
- If previous had weak verbs → Try action verbs (Get, Discover, Build, Create)

**STRATEGIC GOAL:**
- KEEP the target keyword "${focusKeywordsString || 'main keyword'}" prominently placed for ranking stability
- CHANGE everything else: phrasing, structure, hook, angle, brand placement

The previous title(s) maintained ranking but failed to generate clicks. Your job is to make it click-worthy while preserving keyword relevance.

**CRITICAL:** Do NOT use similar phrasing, structure, hooks, or word patterns as ANY of the previous attempts. Make it genuinely different.\n`;
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
      prompt += `${index + 1}. "${strategy.title}"${improvementText}\n`;
    });
    prompt += `\nUse these successful examples as inspiration, but create a unique title tailored to this specific page.\n`;
  }

  prompt += `\n**WRITING GUIDELINES:**
- **Length:** Stay under 55 characters to ensure full visibility in Google search results.
- **Structure:** [Primary Keyword/Hook] | [Brand Name] — keyword-first for SEO.
- **Word choice:** Use short, powerful words (e.g., "SEO", "Web Design", "Expert" — not "Optimization", "Solutions", "Services").
- **Avoid generic phrases:** Never use "elevate your presence", "take to the next level", or similar clichés.
- **Be specific:** Include a concrete benefit, result, or differentiator when possible.
- **Vary your approach:** Each title should feel unique and tailored to this specific page — not templated.
- Use "|" or "—" as separators, but keep them minimal.
- **CRITICAL:** Business name must appear EXACTLY as provided.
- **Output:** Only the meta title — no quotes, no explanations, no extra text.
`;

  const response = await openai.chat.completions.create({
    model: "gpt-4-turbo",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 60,
  });

  const aiTitle = response.choices[0].message.content.trim();

  const createdAt = new Date().toISOString();

  // Save using backward-compatible helper (writes to both structures)
  if (userId) {
    const { saveMetaTitle } = await import("../../../lib/firestoreMigrationHelpers");
    await saveMetaTitle(userId, focusKeywordCacheKey, {
      title: aiTitle,
      createdAt,
      focusKeywords: focusKeywordList,
      pageUrl,
    });
  }

  await logTrainingEvent({
    userId,
    eventType: "meta_title_generated",
    businessType: onboarding?.businessType,
    businessLocation: onboarding?.businessLocation,
    payload: {
      pageUrl,
      focusKeywords: focusKeywordList,
      context: await summarizeSeoContext(context),
      aiTitle,
      createdAt,
    },
  });

  return NextResponse.json({ title: aiTitle });
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

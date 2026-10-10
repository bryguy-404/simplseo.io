import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";

async function handlePOST(req) {
  try {
    const { keyword, businessType, businessLocation, userId } = await req.json();

    if (!keyword) {
      return NextResponse.json({ error: "Keyword is required" }, { status: 400 });
    }

    // Generate all analyses in parallel for speed
    const [intentAnalysis, difficultyAnalysis, valueExplanation, pageTypeRecommendation] = await Promise.all([
      analyzeKeywordIntent(keyword),
      analyzeKeywordDifficulty(keyword, businessLocation),
      explainKeywordValue(keyword, businessType, businessLocation),
      recommendPageType(keyword, businessType)
    ]);

    return NextResponse.json({
      success: true,
      keyword,
      intent: intentAnalysis,
      difficulty: difficultyAnalysis,
      valueExplanation,
      pageType: pageTypeRecommendation
    });

  } catch (error) {
    console.error("Error in keyword analysis API:", error);
    return NextResponse.json({ error: "Failed to analyze keyword" }, { status: 500 });
  }
}

// Analyze keyword intent (Transactional, Commercial, Informational, Navigational)
async function analyzeKeywordIntent(keyword) {
  try {
    const prompt = `Classify the search intent for this keyword using standard Google search intent categories.

Keyword: "${keyword}"

Return ONLY valid JSON in this exact format:
{
  "category": "Transactional" | "Commercial" | "Informational" | "Navigational",
  "explanation": "1 sentence explanation",
  "buyerReadiness": "High" | "Medium" | "Low"
}

Intent definitions:
- Transactional: Ready to buy/book now (e.g., "book plumber", "buy shoes online")
- Commercial: Researching before purchase (e.g., "best dentist near me", "iPhone vs Samsung")
- Informational: Looking for information (e.g., "how to fix a leaky faucet", "what is SEO")
- Navigational: Looking for a specific website (e.g., "Facebook login", "Amazon")`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    // Clean and parse JSON
    const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanedContent);

  } catch (error) {
    console.error("Intent analysis error:", error);
    // Fallback based on keyword patterns
    return getIntentFallback(keyword);
  }
}

// Analyze keyword difficulty (AI-estimated)
async function analyzeKeywordDifficulty(keyword, businessLocation) {
  try {
    const prompt = `Analyze the SEO difficulty for this keyword and estimate how hard it would be for a small local business to rank.

Keyword: "${keyword}"
Business Location: "${businessLocation}"

Consider:
1. Keyword pattern (long-tail keywords are usually easier)
2. Expected competition (directories, large brands vs small businesses)
3. Commercial vs informational nature
4. Local modifiers (usually make keywords easier)
5. Query length and specificity

Return ONLY valid JSON in this exact format:
{
  "score": 1-10,
  "label": "Easy" | "Medium" | "Hard",
  "explanation": "1-2 sentence explanation",
  "competitorTypes": ["type1", "type2"],
  "rankingTimeframe": "1-3 months" | "3-6 months" | "6-12 months" | "12+ months"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 250,
        temperature: 0.4
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanedContent);

  } catch (error) {
    console.error("Difficulty analysis error:", error);
    return getDifficultyFallback(keyword);
  }
}

// Explain why this keyword matters for the business
async function explainKeywordValue(keyword, businessType, businessLocation) {
  try {
    const prompt = `Explain why the keyword "${keyword}" is valuable for a ${businessType} business in ${businessLocation}.

Focus on:
- Search intent and buyer readiness
- Relevance to local markets
- Lead generation potential
- Competition level for small businesses

Return 2-4 sentences that a business owner would understand. Be specific about WHY this keyword brings value.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.6
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content?.trim() || "This keyword can help attract new customers searching for your services.";

  } catch (error) {
    console.error("Value explanation error:", error);
    return `This keyword targets potential customers in ${businessLocation} who are actively looking for ${businessType} services.`;
  }
}

// Recommend what type of page to create
async function recommendPageType(keyword, businessType) {
  try {
    const prompt = `Based on the keyword "${keyword}" for a ${businessType} business, recommend what type of page should be created.

Choose ONE from these options:
- Service Page: For specific services offered
- Local Landing Page: For location-specific targeting
- Blog Article: For informational/educational content
- Pricing Page: For cost-related queries
- Comparison Page: For "best" or "vs" queries
- FAQ Page: For question-based queries
- Homepage Improvement: If the keyword should be on the main page

Return ONLY valid JSON in this exact format:
{
  "pageType": "Service Page" | "Local Landing Page" | "Blog Article" | "Pricing Page" | "Comparison Page" | "FAQ Page" | "Homepage Improvement",
  "reason": "1 sentence explaining why this page type is best",
  "suggestedUrl": "/suggested-url-slug",
  "priority": "High" | "Medium" | "Low"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.4
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content?.trim();
    
    const cleanedContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleanedContent);

  } catch (error) {
    console.error("Page type recommendation error:", error);
    return getPageTypeFallback(keyword);
  }
}

// Fallback functions for when AI fails
function getIntentFallback(keyword) {
  const lowerKeyword = keyword.toLowerCase();
  
  if (lowerKeyword.includes('how to') || lowerKeyword.includes('what is') || lowerKeyword.includes('guide')) {
    return { category: "Informational", explanation: "This keyword indicates the user is looking for information or education.", buyerReadiness: "Low" };
  }
  if (lowerKeyword.includes('best') || lowerKeyword.includes('top') || lowerKeyword.includes('review')) {
    return { category: "Commercial", explanation: "This keyword indicates the user is comparing options before making a decision.", buyerReadiness: "Medium" };
  }
  if (lowerKeyword.includes('near me') || lowerKeyword.includes('buy') || lowerKeyword.includes('book') || lowerKeyword.includes('hire')) {
    return { category: "Transactional", explanation: "This keyword indicates the user is ready to take action.", buyerReadiness: "High" };
  }
  
  return { category: "Commercial", explanation: "This keyword likely indicates someone researching options.", buyerReadiness: "Medium" };
}

function getDifficultyFallback(keyword) {
  const wordCount = keyword.split(' ').length;
  const hasLocation = keyword.toLowerCase().includes('near me') || keyword.split(',').length > 1;
  
  if (wordCount >= 4 || hasLocation) {
    return { score: 3, label: "Easy", explanation: "Long-tail and local keywords typically have less competition.", competitorTypes: ["Local businesses"], rankingTimeframe: "1-3 months" };
  }
  if (wordCount >= 3) {
    return { score: 5, label: "Medium", explanation: "Moderate competition expected for this keyword.", competitorTypes: ["Local businesses", "Regional companies"], rankingTimeframe: "3-6 months" };
  }
  
  return { score: 7, label: "Hard", explanation: "Shorter keywords typically have more competition.", competitorTypes: ["National brands", "Directories"], rankingTimeframe: "6-12 months" };
}

function getPageTypeFallback(keyword) {
  const lowerKeyword = keyword.toLowerCase();
  
  if (lowerKeyword.includes('near me') || lowerKeyword.includes('in ')) {
    return { pageType: "Local Landing Page", reason: "Location-specific keywords work best on dedicated landing pages.", suggestedUrl: `/${keyword.toLowerCase().replace(/\s+/g, '-')}`, priority: "High" };
  }
  if (lowerKeyword.includes('how to') || lowerKeyword.includes('guide') || lowerKeyword.includes('tips')) {
    return { pageType: "Blog Article", reason: "Educational content works best in blog format.", suggestedUrl: `/blog/${keyword.toLowerCase().replace(/\s+/g, '-')}`, priority: "Medium" };
  }
  if (lowerKeyword.includes('cost') || lowerKeyword.includes('price') || lowerKeyword.includes('pricing')) {
    return { pageType: "Pricing Page", reason: "Cost queries should lead to transparent pricing information.", suggestedUrl: `/pricing`, priority: "High" };
  }
  if (lowerKeyword.includes('best') || lowerKeyword.includes('vs') || lowerKeyword.includes('compare')) {
    return { pageType: "Comparison Page", reason: "Comparison queries work best with detailed comparison content.", suggestedUrl: `/best-${keyword.toLowerCase().replace(/\s+/g, '-')}`, priority: "Medium" };
  }
  
  return { pageType: "Service Page", reason: "This keyword is best targeted with a dedicated service page.", suggestedUrl: `/${keyword.toLowerCase().replace(/\s+/g, '-')}`, priority: "High" };
}


export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

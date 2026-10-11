import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
// app/api/chatbot/chat/route.js
import { NextResponse } from "next/server";
import OpenAI from "openai";
import { db } from "../../../lib/firebaseAdmin";
import {
  getImplementationSummary,
  getPageEnrichmentData,
  matchMessageToTrackedPages,
  formatEnrichmentForPrompt,
} from "../../../lib/chatEnrichmentHelper";

// Create the OpenAI instance
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Helper functions for page type detection and indexing (same as SEO assistant)
const normalizeUrl = (url) => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/\/$/, "");
  }
};

const detectPageType = (page) => {
  const url = (page.pageUrl || "").toLowerCase();
  const title = (page.title || "").toLowerCase();
  const content = (page.textContent || "").toLowerCase();
  const description = (page.metaDescription || "").toLowerCase();
  
  const patterns = {
    about: ['about', 'about-us', 'who-we-are', 'our-story', 'team', 'about me', 'about the company'],
    services: ['services', 'service', 'what-we-do', 'offerings', 'solutions', 'what we offer', 'our services'],
    contact: ['contact', 'contact-us', 'get-in-touch', 'reach-us', 'reach out', 'contact us'],
    blog: ['blog', 'post', 'article', 'news', '/blog/', '/posts/'],
    portfolio: ['portfolio', 'work', 'projects', 'case-studies', 'case studies', 'my work', 'our work'],
    pricing: ['pricing', 'plans', 'packages', 'cost', 'price', 'rates'],
    home: ['', '/', 'home', 'index', 'welcome'],
    products: ['products', 'product', 'shop', 'store', 'catalog'],
    testimonials: ['testimonials', 'reviews', 'testimonial', 'what clients say'],
  };
  
  try {
    const urlObj = new URL(page.pageUrl);
    const pathSegments = urlObj.pathname.split('/').filter(Boolean).map(s => s.toLowerCase());
    
    for (const [type, keywords] of Object.entries(patterns)) {
      const urlMatch = pathSegments.some(seg => 
        keywords.some(keyword => seg.includes(keyword) || keyword.includes(seg))
      );
      const titleMatch = keywords.some(keyword => title.includes(keyword));
      const descMatch = keywords.some(keyword => description.includes(keyword));
      const contentMatch = keywords
        .filter(keyword => keyword.length > 5)
        .some(keyword => content.includes(keyword));
      
      if (urlMatch || titleMatch || descMatch || contentMatch) {
        return type;
      }
    }
  } catch {
    for (const [type, keywords] of Object.entries(patterns)) {
      const titleMatch = keywords.some(keyword => title.includes(keyword));
      const descMatch = keywords.some(keyword => description.includes(keyword));
      const contentMatch = keywords
        .filter(keyword => keyword.length > 5)
        .some(keyword => content.includes(keyword));
      
      if (titleMatch || descMatch || contentMatch) {
        return type;
      }
    }
  }
  
  return 'other';
};

const buildPageIndex = (pages) => {
  const index = {};
  
  pages.forEach(page => {
    const type = detectPageType(page);
    if (!index[type]) index[type] = [];
    index[type].push({
      url: page.pageUrl,
      title: page.title || 'Untitled',
      description: page.metaDescription || '',
    });
  });
  
  const sections = [];
  
  for (const [type, pages] of Object.entries(index)) {
    if (pages.length === 0) continue;
    
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1) + (type === 'services' ? ' Pages' : type === 'products' ? ' Pages' : ' Page' + (pages.length > 1 ? 's' : ''));
    sections.push(
      `**${typeLabel}:**\n` +
      pages.map((p, i) => `  ${i+1}. "${p.title}" - ${p.url}`).join('\n')
    );
  }
  
  return sections.join('\n\n');
};

const buildPageSummaries = (pages, expandedUrls = new Set()) => {
  const cleanText = (text = "", length = 200) => {
    if (!text) return "";
    const trimmed = text.replace(/\s+/g, " ").trim();
    return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
  };

  return pages.map((page, idx) => {
    const isExpanded = expandedUrls.has(page.pageUrl);
    const summaryLength = isExpanded ? 2000 : 200;
    const headingsLimit = isExpanded ? 20 : 5;

    const headings = Array.isArray(page.headings)
      ? page.headings
          .map((h) => (typeof h === "string" ? h : h?.text || h?.value || ""))
          .filter(Boolean)
          .slice(0, headingsLimit)
      : [];

    const headingsFormatted = headings.map((h) => `      • ${h}`).join("\n");

    return `    ${idx + 1}. URL: ${page.pageUrl}
       Title: ${page.title || "N/A"}
       Description: ${page.metaDescription || "N/A"}
       Summary: ${cleanText(page.textContent || "", summaryLength)}
       Headings:
${headingsFormatted || "      • (none)"}`;
  }).join("\n\n");
};

const getCachedSitePages = async (userId, desiredCount = 25) => {
  if (!userId) return [];
  try {
    // Use backward-compatible helper (checks both old and new structures)
    const { getCachedSitePages: getCachedPages } = await import("../../../lib/firestoreMigrationHelpers");
    const pages = await getCachedPages(userId, {
      source: "site-crawl",
      limit: Math.max(desiredCount * 3, 50),
      useAdminSDK: true // Use admin SDK for server-side
    });

    // Sort pages
    pages.sort((a, b) => {
      const navScore = (b.isNavLink ? 1 : 0) - (a.isNavLink ? 1 : 0);
      if (navScore !== 0) return navScore;

      const orderA = typeof a.crawlOrder === "number" ? a.crawlOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.crawlOrder === "number" ? b.crawlOrder : Number.MAX_SAFE_INTEGER;
      if (orderA !== orderB) return orderA - orderB;

      const aTime = a.cachedAt ? new Date(a.cachedAt).getTime() : 0;
      const bTime = b.cachedAt ? new Date(b.cachedAt).getTime() : 0;
      return bTime - aTime;
    });

    return pages;
  } catch (error) {
    console.error("Failed to fetch cached site pages:", error);
    return [];
  }
};

async function handlePOST(req) {
  try {
    const { message, conversationHistory = [], userData, userId } = await req.json();

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    // Get cached pages and implementation summary in parallel

    const [cachedPages, implementationSummary] = await Promise.all([
      userId ? getCachedSitePages(userId, 25) : Promise.resolve([]),
      userId ? getImplementationSummary(userId) : Promise.resolve([]),
    ]);
    const pageIndex = cachedPages.length > 0 ? buildPageIndex(cachedPages) : null;

    // Match message to tracked pages and fetch deep enrichment
    const trackedPageUrls = matchMessageToTrackedPages(message, implementationSummary, cachedPages);

    // Also expand summaries for any cached page whose URL path matches the message
    const messageLower = message.toLowerCase();
    const expandedUrlSet = new Set(trackedPageUrls);
    for (const page of cachedPages.slice(0, 15)) {
      if (expandedUrlSet.has(page.pageUrl)) continue;
      try {
        const path = new URL(page.pageUrl).pathname;
        const segments = path.split("/").filter((s) => s.length > 2).map((s) => s.replace(/-/g, " ").toLowerCase());
        if (segments.some((seg) => messageLower.includes(seg))) {
          expandedUrlSet.add(page.pageUrl);
        }
      } catch { /* skip invalid URLs */ }
    }
    const pageSummaries = cachedPages.length > 0 ? buildPageSummaries(cachedPages.slice(0, 15), expandedUrlSet) : null;
    const enrichedPages = await Promise.all(
      trackedPageUrls.map(async (pageUrl) => ({
        pageUrl,
        data: await getPageEnrichmentData(userId, pageUrl),
      }))
    );
    const enrichmentString = formatEnrichmentForPrompt(implementationSummary, enrichedPages.filter((p) => p.data));

    // Create a comprehensive system prompt with all user data
    const systemPrompt = `You are an expert SEO coach and mentor for ${userData?.userFirstName || 'the user'}.

**Your Role:**
- Provide friendly, helpful, and clear SEO advice
- Use simple language that beginners can understand
- Give specific, actionable recommendations based on their actual data
- Be encouraging and supportive
- Adapt responses to different time periods (7 days, 1 month, 3 months, etc.)

**Complete User Profile:**
- Name: ${userData?.userFirstName || 'User'}
- Business: ${userData?.businessName || 'their business'}
- Location: ${userData?.businessLocation || 'their area'}
- Website: ${userData?.websiteUrl || 'their website'}
- Current Session: ${new Date().toISOString()}

**📊 Google Search Console Data (Last 28 Days):**
- Total Keywords Tracked: ${userData?.gscKeywords?.length || 0}
- Top Performing Pages: ${userData?.topPages?.length || 0}
- Low CTR Pages: ${userData?.lowCtrPages?.length || 0}
- Impression Trends: ${userData?.impressionTrends?.length || 0} days of data

**🏆 Top Performing Pages (by clicks):**
${userData?.topPages?.slice(0, 10).map(page => `- ${page.page} (${page.clicks} clicks)`).join('\n') || 'No data available'}

**📉 Low CTR Pages (need improvement):**
${userData?.lowCtrPages?.slice(0, 10).map(page => `- ${page.page} (${page.impressions} impressions, 0% CTR)`).join('\n') || 'No data available'}

**🔑 All Keywords Performance (Top 30 by Impressions):**
${userData?.gscKeywords?.slice(0, 30).map(kw => `- "${kw.keyword}" (${kw.impressions} impressions, ${kw.clicks} clicks, position ${kw.position}, ${kw.ctr} CTR)`).join('\n') || 'No data available'}

**⚡ Easy Win Keywords (positions 11-20):**
${userData?.easyWins?.slice(0, 10).map(kw => `- "${kw.keyword}" (position ${kw.position}, ${kw.ctr} CTR)`).join('\n') || 'No data available'}

**📈 Impression Trends (Last 28 Days):**
${userData?.impressionTrends?.slice(-7).map(day => `- ${day.date}: ${day.impressions} impressions, ${day.clicks} clicks`).join('\n') || 'No data available'}

**🤖 AI-Generated SEO Tips:**
${userData?.aiTips?.slice(0, 5).map(tip => `- ${tip}`).join('\n') || 'No data available'}

**🎯 Focus Keywords (User-Selected Keywords for Optimization):**
${userData?.focusKeywords && userData.focusKeywords.length > 0
  ? userData.focusKeywords.map((fk, idx) => {
      const keyword = typeof fk === 'string' ? fk : fk.keyword;
      const pageUrl = typeof fk === 'object' ? fk.pageUrl : null;
      const source = typeof fk === 'object' ? (fk.source === 'ai-generated' ? 'AI-generated' : 'GSC-existing') : 'GSC-existing';
      return `${idx + 1}. "${keyword}"${pageUrl ? ` → ${pageUrl}` : ''} (${source})`;
    }).join('\n')
  : 'No focus keywords selected yet. Users can select focus keywords in the Focus Keywords card on the dashboard to prioritize optimization efforts.'}

${enrichmentString ? `**Implementation Tracking & Content Audit Data:**
${enrichmentString}

**When users ask about tracked pages or implementations:**
- Use dated sourced observations only; legacy implementation tiers and success labels are not verified outcomes.
- Explain the first 28-day before/after comparison with a three-day reporting buffer. Pilot ongoing reviews add later 28-day periods. Do not invent checkpoint availability: direct users to Page progress for their current state.
- Reviewing results and keeping changes leave tracking active. Only confirmation of another published edit starts a new cycle. Low traffic does not itself require a rewrite or new keyword, and numerical changes do not prove the edit caused them.
- Reference specific content audit recommendations and AI suggestions when relevant
- Mention keyword history if they've pivoted keywords before
- Help them act on the specific AI suggestions that were generated for their page
- Be encouraging about progress and specific about next steps
` : ''}
**Time Period Flexibility:**
- When users ask about "this month" or "last 30 days", use the full 28-day dataset
- When users ask about "this week" or "last 7 days", focus on the most recent 7 days of trend data
- When users ask about "last 3 months", explain that current data covers 28 days and suggest they check back for longer-term trends
- Always specify the time period you're analyzing in your response

**Response Guidelines:**
1. Use their actual data to give specific advice
2. Reference their specific pages and keywords when relevant
3. Explain technical terms in simple language
4. Provide step-by-step action items
5. Use emojis sparingly but effectively
6. Keep responses concise but comprehensive
7. Always be encouraging and supportive
8. Specify the time period being analyzed
9. When data is limited, explain what's available and suggest next steps

**Format your responses with:**
- Clear headings using **bold text**
- Bullet points for lists
- Specific examples from their data
- Actionable next steps
- Time period context

${pageIndex ? `**Complete Website Page Index:**
When users ask about pages without providing URLs, use this index to find the right pages:
${pageIndex}

**Understanding Page Queries:**
- When user says "my about page" or "the about page", find pages with type "about" from the index above
- When user says "services pages" or "all services", find ALL pages with type "services" from the index above
- When user says "contact page", find pages with type "contact"
- When user asks to "optimize all my services pages", provide recommendations for ALL service pages
- Always identify which specific page(s) the user is referring to before answering
- If multiple pages match, mention all of them and their URLs
- Use the full content from the identified page(s) to answer questions

**Detailed Page Content:**
${pageSummaries || '(No cached pages available yet)'}

**Important Guidelines:**
- When answering questions about specific pages, FIRST identify which page(s) from the index match the query
- Use the detailed content summaries above to provide accurate, specific answers
- Always include the page URL when referencing a specific page
- If user asks about "all [type] pages", provide information about ALL matching pages
- When user asks "what's in my about page", use the content from the about page(s) to answer
- When user asks to "optimize my services pages", provide specific recommendations for each service page

**Fallback When Page Not Found:**
If you cannot find the specific page the user is asking about:
1. First, check the page index above to see if there are similar pages (e.g., if they ask about "pricing" but only "services" pages exist, suggest those)
2. Recommend 2-3 relevant pages from the index that might be what they're looking for, with their URLs
3. If no similar pages exist, politely ask: "I couldn't find that page in your website. Could you share the URL of the page you'd like help with? That way I can give you specific recommendations."
4. Always be helpful and suggest alternative pages that might be relevant to their question
5. Example response: "I couldn't find a specific [requested page type] page, but I found these related pages: [list with URLs]. Would any of these help, or could you share the URL of the page you're thinking of?"` : ''}

Remember: You have access to their real Google Search Console data from the last 28 days${pageIndex ? ' and their complete website content' : ''}, so use it to give personalized, data-driven advice!`;

    // Build messages array with conversation history
    const messagesArray = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: "user", content: message }
    ];

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo", // Conversational AI - GPT-4-turbo maintains quality at lower cost
      messages: messagesArray,
      max_tokens: 1000,
      temperature: 0.7,
    });

    const response = completion.choices[0]?.message?.content || "I'm sorry, I couldn't generate a response. Please try again.";

    return NextResponse.json({ 
      response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Chatbot API error:", error);
    return NextResponse.json({ 
      error: "Failed to generate response",
      details: error.message 
    }, { status: 500 });
  }
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

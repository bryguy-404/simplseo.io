import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
async function handlePOST(req) {
  try {
    const { 
      pageUrl, 
      focusKeyword, 
      pageContent, 
      title, 
      metaDescription, 
      headings,
      relatedKeywords, // GSC keywords the page ranks for
      previousAttempts = [] // Array of previous content gap attempts for AI learning
    } = await req.json();

    if (!pageUrl) {
      return Response.json({ error: "Missing pageUrl" }, { status: 400 });
    }

    console.log(`Generating E2 Content Gap Analysis for: ${pageUrl}`);
    console.log(`Focus Keyword: ${focusKeyword || 'Not provided'}`);
    console.log(`Related Keywords: ${relatedKeywords?.length || 0} keywords`);
    console.log(`Previous Attempts: ${previousAttempts?.length || 0} attempts for AI learning`);

    // Prepare the prompt for content gap analysis
    const prompt = createContentGapPrompt(pageUrl, focusKeyword, pageContent, title, metaDescription, headings, relatedKeywords, previousAttempts);

    // Call OpenAI API
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4-turbo",
        messages: [
          {
            role: "system",
            content: `You are an expert SEO content strategist specializing in content gap analysis. 
Your job is to analyze a page that ranks on page 3-4 (positions 26-40) and identify:
1. Missing content sections that top-ranking pages typically have
2. Topics the page should cover but doesn't
3. Questions users are likely asking that aren't answered
4. Ways to make the content more comprehensive and authoritative

Focus on actionable suggestions that will help the page move from page 3-4 to page 1-2.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2500
      }),
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error("OpenAI API error:", error);
      throw new Error(`OpenAI API failed: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResponse = openaiData.choices[0].message.content;

    console.log("Raw AI Content Gap Response:", aiResponse.substring(0, 500) + "...");

    // Parse the AI response
    const contentGaps = parseContentGapResponse(aiResponse);

    console.log(`Generated ${contentGaps.sections?.length || 0} content gap suggestions`);

    return Response.json({
      pageUrl,
      focusKeyword,
      contentGaps,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("Content gaps analysis error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function createContentGapPrompt(pageUrl, focusKeyword, pageContent, title, metaDescription, headings, relatedKeywords, previousAttempts = []) {
  const safePageContent = pageContent || "";
  const safeTitle = title || "";
  const safeMetaDescription = metaDescription || "";
  const safeHeadings = headings || [];
  const safeRelatedKeywords = relatedKeywords || [];

  // Normalize headings
  const normalizedHeadings = safeHeadings.map(h => {
    if (typeof h === 'string') {
      return { tag: 'h2', text: h };
    }
    return h;
  });

  // Format related keywords from GSC
  const keywordList = safeRelatedKeywords
    .slice(0, 15)
    .map(k => `- "${k.keyword}" (Position: ${Math.round(k.position || 0)}, Impressions: ${k.impressions || 0})`)
    .join('\n');

  // Build previous attempts section for AI learning
  let previousAttemptsSection = "";
  if (previousAttempts && previousAttempts.length > 0) {
    previousAttemptsSection = `\n\n**PREVIOUS CONTENT GAP IMPROVEMENTS - LEARN FROM WHAT DIDN'T WORK:**
The user has already tried improving this page ${previousAttempts.length} time(s) but the page still hasn't reached page 1. Here's what was tried:

`;
    previousAttempts.forEach((attempt, index) => {
      const impressionsBefore = attempt.preStats?.impressions || 0;
      const impressionsAfter = attempt.postStats?.impressions || attempt.finalStats?.impressions || 0;
      const positionBefore = Math.round(attempt.preStats?.position || 0);
      const positionAfter = Math.round(attempt.postStats?.position || attempt.finalStats?.position || 0);
      const daysTracked = attempt.daysTracked || 0;
      
      previousAttemptsSection += `**Attempt #${index + 1} (${attempt.type || 'content-gap'}):**
- Tracked for: ${daysTracked} days
- Position: ${positionBefore} → ${positionAfter} (${positionAfter < positionBefore ? '✅ improved' : positionAfter > positionBefore ? '❌ declined' : '→ no change'})
- Impressions: ${impressionsBefore} → ${impressionsAfter}
- Keyword: "${attempt.keyword || 'unknown'}"
${attempt.reason ? `- Reason: ${attempt.reason}` : ''}

`;
    });
    
    previousAttemptsSection += `**IMPORTANT:** Since previous improvements didn't get this page to page 1, suggest DIFFERENT and MORE COMPREHENSIVE content additions. Don't repeat what was likely already tried. Focus on what's STILL MISSING.
`;
  }

  return `Analyze this page that is currently ranking on page 3-4 (positions 26-40) for "${focusKeyword || 'unknown keyword'}".

PAGE INFORMATION:
- URL: ${pageUrl}
- Current Title: "${safeTitle}"
- Focus Keyword: "${focusKeyword || 'Not specified'}"
- Content Length: ${safePageContent.length} characters (~${Math.round(safePageContent.split(/\s+/).length)} words)

CURRENT HEADINGS:
${normalizedHeadings.map(h => `- ${(h.tag || 'h2').toUpperCase()}: "${h.text || ''}"`).join('\n') || 'No headings found'}

RELATED KEYWORDS FROM GOOGLE SEARCH CONSOLE:
${keywordList || 'No GSC data available'}

CURRENT CONTENT (excerpt):
${safePageContent.substring(0, 3000)}${safePageContent.length > 3000 ? '...' : ''}

TASK: Identify content gaps that are likely causing this page to rank on page 3-4 instead of page 1.
${previousAttemptsSection}
Analyze and provide:
1. MISSING CONTENT SECTIONS - What sections do top-ranking pages typically have that this page lacks?
2. UNANSWERED QUESTIONS - What questions would users searching "${focusKeyword}" want answered?
3. KEYWORD OPPORTUNITIES - Based on the GSC data, what related topics should be covered?
4. DEPTH IMPROVEMENTS - Where does the content lack depth or detail?
5. FAQ SUGGESTIONS - Specific FAQ questions and answers to add

Format your response as JSON:
{
  "summary": "Brief 2-3 sentence overview of the main content gaps",
  "sections": [
    {
      "title": "Add Section: Common Mistakes to Avoid",
      "type": "missing_section",
      "priority": "high",
      "description": "Users searching for this topic want to know what NOT to do",
      "suggestedContent": "Outline or key points to include in this section",
      "wordCountSuggestion": 200
    }
  ],
  "faqSuggestions": [
    {
      "question": "How often should I [do X]?",
      "answerOutline": "Brief answer outline covering the key points"
    }
  ],
  "keywordOpportunities": [
    {
      "keyword": "related long-tail keyword",
      "reason": "Why this keyword should be targeted",
      "suggestedUse": "How to incorporate this keyword naturally"
    }
  ],
  "quickWins": [
    "Add a summary/TL;DR at the top",
    "Include a step-by-step guide",
    "Add statistics or data to support claims"
  ]
}`;
}

function parseContentGapResponse(aiResponse) {
  try {
    // Try to extract JSON from the response
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        summary: parsed.summary || "Content gap analysis complete.",
        sections: parsed.sections || [],
        faqSuggestions: parsed.faqSuggestions || [],
        keywordOpportunities: parsed.keywordOpportunities || [],
        quickWins: parsed.quickWins || []
      };
    }
  } catch (error) {
    console.error("Failed to parse content gap JSON:", error);
  }

  // Fallback response
  return {
    summary: "Your page needs more comprehensive content to compete with top-ranking pages.",
    sections: [
      {
        title: "Add Step-by-Step Guide Section",
        type: "missing_section",
        priority: "high",
        description: "Users searching for this topic want practical, actionable steps",
        suggestedContent: "Break down the process into clear, numbered steps",
        wordCountSuggestion: 300
      },
      {
        title: "Add Common Mistakes to Avoid Section",
        type: "missing_section",
        priority: "high",
        description: "Help users avoid pitfalls - this type of content ranks well",
        suggestedContent: "List 5-7 common mistakes with explanations",
        wordCountSuggestion: 250
      },
      {
        title: "Add FAQ Section",
        type: "missing_section",
        priority: "medium",
        description: "Capture long-tail searches with an FAQ section",
        suggestedContent: "Answer 5-8 common questions about this topic",
        wordCountSuggestion: 400
      }
    ],
    faqSuggestions: [
      {
        question: "What is the best way to get started?",
        answerOutline: "Provide a brief, actionable answer"
      },
      {
        question: "How long does this typically take?",
        answerOutline: "Give realistic timeframes and factors that affect duration"
      }
    ],
    keywordOpportunities: [],
    quickWins: [
      "Add a summary or key takeaways section at the top",
      "Include specific examples or case studies",
      "Add internal links to related content on your site"
    ]
  };
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

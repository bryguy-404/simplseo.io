import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
async function handlePOST(req) {
  try {
    const { 
      pageUrl, 
      auditResult, 
      pageContent, 
      title, 
      metaDescription, 
      headings, 
      focusKeyword, 
      position,
      previousAttempts = [] // Array of previous rewrite attempts for AI learning
    } = await req.json();

    if (!pageUrl || !auditResult) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Determine if this is an E3 page (position 41+) for search intent analysis
    const isE3Page = position >= 41;
    
    console.log(`🤖 Generating AI content improvements for: ${pageUrl} (Position: ${position || 'unknown'}, E3: ${isE3Page}, Keyword: ${focusKeyword || 'none'})`);
    console.log(`📚 Previous Attempts: ${previousAttempts?.length || 0} attempts for AI learning`);

    // Use different prompt strategy based on position tier
    let prompt;
    let systemMessage;
    
    if (isE3Page && focusKeyword) {
      // E3 pages need search intent analysis, not just readability tweaks
      prompt = createE3SearchIntentPrompt(pageUrl, pageContent, title, metaDescription, headings, focusKeyword, previousAttempts);
      systemMessage = "You are an expert SEO content strategist specializing in content comprehensiveness and search intent matching. For pages ranking position 41+, the issue is usually incomplete content, NOT readability. Focus on identifying what content is MISSING based on what searchers expect to find.";
    } else {
      // E1/E2 pages use standard readability-focused prompt
      prompt = createImprovementPrompt(pageUrl, auditResult, pageContent, title, metaDescription, headings, previousAttempts);
      systemMessage = "You are an expert SEO content strategist. Provide specific, actionable suggestions to improve content quality, readability, and SEO performance. Focus on practical, implementable advice.";
    }

    // Call OpenAI API
    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4-turbo", // Complex analysis - GPT-4-turbo maintains quality at lower cost
        messages: [
          {
            role: "system",
            content: systemMessage
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.7,
        max_tokens: 2500 // Increased for more comprehensive E3 suggestions
      }),
    });

    if (!openaiResponse.ok) {
      const error = await openaiResponse.text();
      console.error("OpenAI API error:", error);
      throw new Error(`OpenAI API failed: ${openaiResponse.status}`);
    }

    const openaiData = await openaiResponse.json();
    const aiResponse = openaiData.choices[0].message.content;

    console.log("🔍 Raw AI Response:", aiResponse);

    // Parse the AI response into structured suggestions
    const suggestions = isE3Page && focusKeyword 
      ? parseE3Suggestions(aiResponse, focusKeyword)
      : parseAiSuggestions(aiResponse, auditResult);
    
    console.log("🔍 Parsed Suggestions:", JSON.stringify(suggestions, null, 2));

    console.log(`✅ Generated ${suggestions.length} AI suggestions for ${pageUrl}`);

    return Response.json({
      pageUrl,
      suggestions,
      analysisType: isE3Page && focusKeyword ? "search-intent" : "readability",
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Content improvements error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

function createImprovementPrompt(pageUrl, auditResult, pageContent, title, metaDescription, headings, previousAttempts = []) {
  const { contentScore, analysis, suggestions } = auditResult;
  
  // Add safety checks for undefined values
  const safePageContent = pageContent || "";
  const safeTitle = title || "";
  const safeMetaDescription = metaDescription || "";
  const safeHeadings = headings || [];
  
  // Normalize headings to handle both old (string) and new (object) formats
  const normalizedHeadings = safeHeadings.map(h => {
    if (typeof h === 'string') {
      return { tag: 'h2', text: h };  // Old format - assume H2
    }
    return h;
  });

  // Build previous attempts section for AI learning
  let previousAttemptsSection = "";
  if (previousAttempts && previousAttempts.length > 0) {
    previousAttemptsSection = `\n\n**PREVIOUS IMPROVEMENT ATTEMPTS - LEARN FROM WHAT DIDN'T WORK:**
The user has already tried improving this page ${previousAttempts.length} time(s) but the page still isn't performing well. Here's what was tried:

`;
    previousAttempts.forEach((attempt, index) => {
      const impressionsBefore = attempt.preStats?.impressions || 0;
      const impressionsAfter = attempt.postStats?.impressions || attempt.finalStats?.impressions || 0;
      const positionBefore = Math.round(attempt.preStats?.position || 0);
      const positionAfter = Math.round(attempt.postStats?.position || attempt.finalStats?.position || 0);
      const clicksBefore = attempt.preStats?.clicks || 0;
      const clicksAfter = attempt.postStats?.clicks || attempt.finalStats?.clicks || 0;
      const daysTracked = attempt.daysTracked || 0;
      
      previousAttemptsSection += `**Attempt #${index + 1} (${attempt.type || 'content-improvement'}):**
- Tracked for: ${daysTracked} days
- Position: ${positionBefore} → ${positionAfter} (${positionAfter < positionBefore ? '✅ improved' : positionAfter > positionBefore ? '❌ declined' : '→ no change'})
- Clicks: ${clicksBefore} → ${clicksAfter}
- Impressions: ${impressionsBefore} → ${impressionsAfter}
${attempt.reason ? `- Previous focus: ${attempt.reason}` : ''}

`;
    });
    
    previousAttemptsSection += `**CRITICAL:** Since previous improvements didn't achieve the desired results, you MUST suggest DIFFERENT strategies. Don't repeat similar advice. Think about what might have been MISSED or what DIFFERENT approach could work.
`;
  }
  
  return `You are an expert SEO content strategist. Analyze this specific page content and provide actionable improvements that users can copy-paste directly into their website.
${previousAttemptsSection}

PAGE INFORMATION:
- URL: ${pageUrl}
- Current Title: "${safeTitle}"
- Current Meta Description: "${safeMetaDescription}"
- Content Length: ${safePageContent.length} characters

CURRENT HEADINGS:
${normalizedHeadings.map(h => `- ${(h.tag || 'h2').toUpperCase()}: "${h.text || 'Unknown'}"`).join('\n')}

CONTENT AUDIT RESULTS:
- Overall Score: ${contentScore}/100
- Content Length: ${analysis.contentLength.score}/100 (${analysis.contentLength.value} characters)
- Readability: ${analysis.readability.score}/100 (${analysis.readability.value.toFixed(1)} Flesch-Kincaid)
- Heading Structure: ${analysis.headingStructure.score}/100 (${analysis.headingStructure.value.totalHeadings} headings)
- Title Optimization: ${analysis.titleOptimization.score}/100 (${analysis.titleOptimization.value.length} characters)
- Meta Description: ${analysis.metaDescription.score}/100 (${analysis.metaDescription.value.length} characters)
- Content Structure: ${analysis.contentStructure.score}/100 (${analysis.contentStructure.value.paragraphCount} paragraphs)

FULL PAGE CONTENT:
${safePageContent}

TASK: Based on the actual content above, provide specific, copy-paste ready improvements. For each suggestion:

1. Identify the EXACT problem in the current content
2. Provide the EXACT text that should be changed/added
3. Show BEFORE and AFTER examples using actual content from the page
4. Give specific implementation steps

Focus on:
- Rewriting complex sentences to be simpler
- Adding missing headings with specific text
- Improving the actual title and meta description
- Adding specific content sections
- Restructuring existing paragraphs

Format your response as JSON:
{
  "suggestions": [
    {
      "title": "Simplify Complex Sentences",
      "description": "Your content contains several complex sentences that reduce readability.",
      "aiRecommendation": "Rewrite these specific sentences to be clearer and more engaging.",
      "examples": [
        "BEFORE: 'Our comprehensive SEO optimization services ensure growth for your business'",
        "AFTER: 'We provide SEO services that help your business grow'",
        "BEFORE: 'Utilize our professional web development solutions'",
        "AFTER: 'Use our web development services'"
      ],
      "beforeAfter": [
        {
          "before": "EXACT complex sentence from the page",
          "after": "Simplified version that's easier to read"
        }
      ],
      "priority": "high"
    },
    {
      "title": "Add Missing Headings",
      "description": "Your content lacks proper heading structure for better organization.",
      "aiRecommendation": "Add these specific headings to organize your content better.",
      "examples": [
        "Add H1: 'South Bend Web Developer Services'",
        "Add H2: 'Our Web Development Process'",
        "Add H3: 'Discovery and Planning Phase'"
      ],
      "beforeAfter": [
        {
          "before": "Current paragraph without heading",
          "after": "H2: Specific Heading Title\n[Current paragraph content]"
        }
      ],
      "priority": "high"
    }
  ]
}`;
}

// E3-specific prompt: Search Intent Gap Analysis
// For pages at position 41+, readability tweaks won't help. The page needs MORE content that matches search intent.
function createE3SearchIntentPrompt(pageUrl, pageContent, title, metaDescription, headings, focusKeyword, previousAttempts = []) {
  const safePageContent = pageContent || "";
  const safeTitle = title || "";
  const safeMetaDescription = metaDescription || "";
  const safeHeadings = headings || [];
  
  // Normalize headings
  const normalizedHeadings = safeHeadings.map(h => {
    if (typeof h === 'string') {
      return { tag: 'h2', text: h };
    }
    return h;
  });

  // Build previous attempts section for AI learning
  let previousAttemptsSection = "";
  if (previousAttempts && previousAttempts.length > 0) {
    previousAttemptsSection = `\n\n**PREVIOUS REWRITE/IMPROVEMENT ATTEMPTS - LEARN FROM FAILURES:**
The user has already tried improving this page ${previousAttempts.length} time(s) but it's STILL at position 41+. Here's what was tried:

`;
    previousAttempts.forEach((attempt, index) => {
      const impressionsBefore = attempt.preStats?.impressions || 0;
      const impressionsAfter = attempt.postStats?.impressions || attempt.finalStats?.impressions || 0;
      const positionBefore = Math.round(attempt.preStats?.position || 0);
      const positionAfter = Math.round(attempt.postStats?.position || attempt.finalStats?.position || 0);
      const clicksBefore = attempt.preStats?.clicks || 0;
      const clicksAfter = attempt.postStats?.clicks || attempt.finalStats?.clicks || 0;
      const daysTracked = attempt.daysTracked || 0;
      
      previousAttemptsSection += `**Attempt #${index + 1} (${attempt.type || 'e3-rewrite'}):**
- Tracked for: ${daysTracked} days
- Position: ${positionBefore} → ${positionAfter} (${positionAfter < positionBefore ? '✅ improved' : positionAfter > positionBefore ? '❌ declined' : '→ no change'})
- Clicks: ${clicksBefore} → ${clicksAfter}
- Impressions: ${impressionsBefore} → ${impressionsAfter}
- Keyword: "${attempt.keyword || focusKeyword}"
${attempt.reason ? `- Previous focus: ${attempt.reason}` : ''}

`;
    });
    
    previousAttemptsSection += `**CRITICAL:** Previous content improvements did NOT move this page out of position 41+. This means the content changes were either:
1. Not comprehensive enough - the page still lacks what Google expects
2. Not matching search intent - the content topic may need a different angle
3. Missing key content sections that top-ranking pages have

You MUST suggest DIFFERENT and MORE AGGRESSIVE content changes. Consider if the page needs a completely different approach or structure.
`;
  }

  return `You are an expert SEO strategist. This page is ranking at position 41+ for the keyword "${focusKeyword}". 
${previousAttemptsSection}

At this position, the problem is NOT readability - it's that the content is likely INCOMPLETE compared to what searchers expect.

PAGE INFORMATION:
- URL: ${pageUrl}
- Focus Keyword: "${focusKeyword}"
- Current Title: "${safeTitle}"
- Current Meta Description: "${safeMetaDescription}"

CURRENT HEADINGS:
${normalizedHeadings.map(h => `- ${(h.tag || 'h2').toUpperCase()}: "${h.text || 'Unknown'}"`).join('\n') || '- No headings found'}

CURRENT PAGE CONTENT:
${safePageContent}

YOUR TASK - SEARCH INTENT GAP ANALYSIS:

STEP 1: Generate 5-7 questions that someone searching "${focusKeyword}" would want answered. Think about:
- What problem are they trying to solve?
- What information do they need?
- What would convince them to take action?
- What objections or concerns might they have?

STEP 2: For each question, determine if the current page content answers it:
- ✅ Fully covered
- ⚠️ Partially covered  
- ❌ Not covered at all

STEP 3: Generate HIGH-PRIORITY suggestions for content that is MISSING or incomplete.

IMPORTANT RULES:
1. NEVER suggest removing the focus keyword "${focusKeyword}" from the title
2. Prioritize ADDING content sections over readability tweaks
3. Be specific about WHAT content to add, not just "add more content"
4. Include the exact H2 heading and bullet points for each new section

Format your response as JSON:
{
  "searchIntentQuestions": [
    {
      "question": "What is the question a searcher would ask?",
      "coverage": "not-covered | partial | covered",
      "explanation": "Brief explanation of whether/how the page addresses this"
    }
  ],
  "suggestions": [
    {
      "title": "Add Section: [Specific Topic]",
      "description": "Searchers for '${focusKeyword}' expect to find information about [topic], but your page doesn't cover this.",
      "aiRecommendation": "Add a new section that covers [specific content].",
      "searchIntentMatch": "This addresses the searcher question: '[question from step 1]'",
      "suggestedHeading": "H2: Exact Heading to Add",
      "contentOutline": [
        "Point 1 to cover in this section",
        "Point 2 to cover in this section",
        "Point 3 to cover in this section"
      ],
      "examples": [
        "Add this section after your [existing section]",
        "Include: [specific information]",
        "Address: [specific concern or question]"
      ],
      "beforeAfter": [
        {
          "before": "Current state: No section about [topic]",
          "after": "H2: [Exact Heading]\\n- [Bullet point 1]\\n- [Bullet point 2]\\n- [Bullet point 3]"
        }
      ],
      "priority": "high"
    }
  ]
}

Focus on content GAPS, not style improvements. A page at position 41+ needs MORE relevant content to rank higher.`;
}

function parseAiSuggestions(aiResponse, auditResult) {
  try {
    // Try multiple approaches to extract JSON
    let jsonString = null;
    
    // Approach 1: Look for JSON between curly braces
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      jsonString = jsonMatch[0];
    }
    
    // Approach 2: Look for JSON after "suggestions" keyword
    if (!jsonString) {
      const suggestionsMatch = aiResponse.match(/suggestions[\s\S]*\}/);
      if (suggestionsMatch) {
        jsonString = '{' + suggestionsMatch[0];
      }
    }
    
    if (jsonString) {
      console.log("🔍 Attempting to parse JSON:", jsonString.substring(0, 500) + "...");
      
      // Try to parse as-is first
      try {
        const parsed = JSON.parse(jsonString);
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
          return cleanSuggestions(parsed.suggestions);
        }
      } catch (firstError) {
        console.log("🔍 First parse attempt failed, trying to clean JSON...");
        
        // Try cleaning the JSON
        try {
          // Remove problematic characters that break JSON
          const cleanedJson = jsonString
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters
            .replace(/\n/g, ' ')  // Replace newlines with spaces
            .replace(/\r/g, ' ')  // Replace carriage returns with spaces
            .replace(/\t/g, ' ')  // Replace tabs with spaces
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();
          
          console.log("🔍 Cleaned JSON:", cleanedJson.substring(0, 500) + "...");
          
          const parsed = JSON.parse(cleanedJson);
          if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
            return cleanSuggestions(parsed.suggestions);
          }
        } catch (secondError) {
          console.error("🔍 Second parse attempt also failed:", secondError.message);
        }
      }
    }
  } catch (error) {
    console.error("Failed to parse AI response as JSON:", error);
    console.error("Raw response that failed:", aiResponse.substring(0, 1000));
  }
  
  // Helper function to clean suggestions
  function cleanSuggestions(suggestions) {
    return suggestions.map(suggestion => ({
      ...suggestion,
      examples: suggestion.examples ? suggestion.examples.map(example => {
        if (typeof example === 'string') {
          // Remove any curly braces that might be in the string
          return example.replace(/[{}]/g, '');
        }
        return JSON.stringify(example).replace(/[{}]/g, '');
      }) : [],
      beforeAfter: suggestion.beforeAfter ? suggestion.beforeAfter.map(change => ({
        before: typeof change.before === 'string' ? 
          change.before.replace(/[{}]/g, '') : 
          JSON.stringify(change.before).replace(/[{}]/g, ''),
        after: typeof change.after === 'string' ? 
          change.after.replace(/[{}]/g, '') : 
          JSON.stringify(change.after).replace(/[{}]/g, '')
      })) : []
    }));
  }

  // Fallback: create suggestions based on audit results
  const fallbackSuggestions = [];
  
  if (auditResult.analysis.contentLength.score < 80) {
    fallbackSuggestions.push({
      title: "Expand Content",
      description: `Your content is ${auditResult.analysis.contentLength.value} characters. Aim for at least 1,000 words for better SEO performance.`,
      aiRecommendation: "Add more detailed sections, examples, case studies, and comprehensive information about your services. Include FAQ sections and detailed service descriptions.",
      examples: [
        "Add a 'Why Choose Us' section with 3-4 key benefits",
        "Include detailed service descriptions with pricing information",
        "Add customer testimonials and case studies"
      ],
      priority: "high"
    });
  }

  if (auditResult.analysis.headingStructure.score < 80) {
    fallbackSuggestions.push({
      title: "Optimize Heading Structure",
      description: "Improve your heading hierarchy for better content organization and SEO.",
      aiRecommendation: "Create a clear heading hierarchy: H1 for main topic, H2 for major sections, H3 for subsections. This helps both users and search engines understand your content structure.",
      examples: [
        "H1: South Bend Web Developer Services",
        "H2: Our Web Development Process",
        "H3: Discovery and Planning Phase"
      ],
      priority: "high"
    });
  }

  if (auditResult.analysis.readability.score < 80) {
    fallbackSuggestions.push({
      title: "Improve Readability",
      description: `Your readability score is ${auditResult.analysis.readability.value.toFixed(1)}. Aim for 60+ for better user engagement.`,
      aiRecommendation: "Use shorter sentences, simpler words, and break up long paragraphs. Add bullet points and numbered lists to make content easier to scan.",
      examples: [
        "Break long paragraphs into shorter ones (2-3 sentences)",
        "Use bullet points for lists and key features",
        "Replace complex words with simpler alternatives"
      ],
      priority: "medium"
    });
  }

  return fallbackSuggestions;
}

// E3-specific parser for search intent analysis results
function parseE3Suggestions(aiResponse, focusKeyword) {
  try {
    // Try to extract JSON
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      let jsonString = jsonMatch[0];
      
      // Try to parse as-is first
      try {
        const parsed = JSON.parse(jsonString);
        
        // Extract search intent questions if present
        const searchIntentQuestions = parsed.searchIntentQuestions || [];
        
        // Process suggestions to include E3-specific fields
        const suggestions = (parsed.suggestions || []).map(suggestion => ({
          ...suggestion,
          // Keep the focus keyword visible
          focusKeyword: focusKeyword,
          // Add search intent match info if available
          searchIntentMatch: suggestion.searchIntentMatch || null,
          suggestedHeading: suggestion.suggestedHeading || null,
          contentOutline: suggestion.contentOutline || [],
          // Clean examples
          examples: suggestion.examples ? suggestion.examples.map(example => {
            if (typeof example === 'string') {
              return example.replace(/[{}]/g, '');
            }
            return JSON.stringify(example).replace(/[{}]/g, '');
          }) : [],
          // Clean beforeAfter
          beforeAfter: suggestion.beforeAfter ? suggestion.beforeAfter.map(change => ({
            before: typeof change.before === 'string' ? 
              change.before.replace(/[{}]/g, '') : 
              JSON.stringify(change.before).replace(/[{}]/g, ''),
            after: typeof change.after === 'string' ? 
              change.after.replace(/[{}]/g, '') : 
              JSON.stringify(change.after).replace(/[{}]/g, '')
          })) : []
        }));

        // If we have search intent questions, add a summary suggestion at the top
        if (searchIntentQuestions.length > 0) {
          const notCovered = searchIntentQuestions.filter(q => q.coverage === 'not-covered');
          const partial = searchIntentQuestions.filter(q => q.coverage === 'partial');
          
          if (notCovered.length > 0 || partial.length > 0) {
            suggestions.unshift({
              title: "Search Intent Gap Analysis",
              description: `Your page is missing content that searchers expect to find for "${focusKeyword}".`,
              aiRecommendation: `We analyzed what questions searchers have when looking for "${focusKeyword}". Your page doesn't fully answer ${notCovered.length + partial.length} of these questions.`,
              searchIntentQuestions: searchIntentQuestions,
              priority: "high",
              isSearchIntentSummary: true,
              examples: [
                `${notCovered.length} questions not covered at all`,
                `${partial.length} questions only partially covered`,
                "See suggestions below for specific content to add"
              ]
            });
          }
        }

        return suggestions;
      } catch (parseError) {
        // Try cleaning the JSON
        const cleanedJson = jsonString
          .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
          .replace(/\n/g, ' ')
          .replace(/\r/g, ' ')
          .replace(/\t/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        
        const parsed = JSON.parse(cleanedJson);
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
          return parsed.suggestions;
        }
      }
    }
  } catch (error) {
    console.error("Failed to parse E3 AI response:", error);
    console.error("Raw response:", aiResponse.substring(0, 1000));
  }

  // E3-specific fallback suggestions based on search intent
  return [
    {
      title: "Search Intent Gap Analysis",
      description: `Your page is ranking at position 41+ for "${focusKeyword}". This usually means the content is incomplete.`,
      aiRecommendation: "Focus on adding comprehensive content that answers all questions a searcher might have.",
      priority: "high",
      isSearchIntentSummary: true,
      examples: [
        "Add a section explaining your process or methodology",
        "Include pricing information or process overview",
        "Add case studies or proof of results",
        "Answer common questions about the topic"
      ]
    },
    {
      title: "Add Section: Process & How It Works",
      description: `Searchers want to understand how your service/product works before committing.`,
      aiRecommendation: "Add a step-by-step explanation of your process.",
      suggestedHeading: "H2: How It Works",
      contentOutline: [
        "Step 1: Initial consultationććć step-by-step process",
        "Step 2: Implementation or delivery",
        "Step 3: Results and next steps"
      ],
      priority: "high",
      examples: [
        "Break down your service into clear steps",
        "Include timeline expectations",
        "Mention what the customer can expect"
      ]
    },
    {
      title: "Add Section: Results & Proof",
      description: `Searchers need proof before making a decision. Your page may lack social proof.`,
      aiRecommendation: "Add testimonials, case studies, or results data.",
      suggestedHeading: "H2: Results We've Achieved",
      contentOutline: [
        "Specific metrics or improvements achieved",
        "Customer testimonials or quotes",
        "Before/after comparisons if applicable"
      ],
      priority: "high",
      examples: [
        "Include specific numbers (e.g., '50% increase in traffic')",
        "Add customer quotes with names/companies",
        "Show before/after screenshots if relevant"
      ]
    },
    {
      title: "Add Section: FAQ",
      description: `Frequently asked questions directly address searcher concerns.`,
      aiRecommendation: "Add an FAQ section answering common questions about your topic.",
      suggestedHeading: "H2: Frequently Asked Questions",
      contentOutline: [
        "Question about pricing or cost",
        "Question about timeline or duration",
        "Question about what's included",
        "Question about guarantees or support"
      ],
      priority: "medium",
      examples: [
        "How much does [service] cost?",
        "How long does [process] take?",
        "What's included in [service/product]?",
        "Do you offer a guarantee?"
      ]
    }
  ];
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";

async function handlePOST(req) {
  try {
    const { keyword, pageUrl, pageContent, title, metaDescription, headings } = await req.json();

    if (!keyword || !pageUrl || !pageContent) {
      return NextResponse.json(
        { error: "Keyword, page URL, and page content are required" },
        { status: 400 }
      );
    }

    // Analyze intent match using OpenAI
    const analysis = await analyzeIntentWithOpenAI(keyword, pageUrl, pageContent, title, metaDescription, headings);

    return NextResponse.json(analysis);

  } catch (error) {
    console.error("Error in intent analysis:", error);
    return NextResponse.json(
      { error: "Failed to analyze intent match" },
      { status: 500 }
    );
  }
}

async function analyzeIntentWithOpenAI(keyword, pageUrl, pageContent, title, metaDescription, headings) {
  try {
    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY environment variable is not set");
      throw new Error("OpenAI API key not configured");
    }
    const prompt = `Analyze the search intent match between the keyword "${keyword}" and the page content below.

Page URL: ${pageUrl}
Page Title: ${title || 'No title found'}
Meta Description: ${metaDescription || 'No meta description found'}
Page Headings: ${headings?.join(', ') || 'No headings found'}
Page Content: ${pageContent.substring(0, 2000)}...

Please evaluate how well this page satisfies the searcher's intent for the keyword "${keyword}".

Consider:
- Does the page directly address what someone searching for "${keyword}" would expect to find?
- Is the content comprehensive and helpful for that search intent?
- Are there missing elements that would satisfy the searcher's needs?
- Is the content well-structured and easy to understand?
- Does the page match the user's search intent, even if the exact keyword isn't present?

Respond with a JSON object containing:
1. matchScore: A number from 0-100 indicating how well the page matches the search intent
2. reason: A brief explanation of why the score is what it is (if score is low, explain the mismatch)
3. suggestedFix: A specific, actionable recommendation to improve the content (e.g., "Add a pricing section", "Include location information", "Rewrite the introduction to address the search query directly")

Return only valid JSON with no additional text.`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4-turbo", // Complex reasoning - GPT-4-turbo maintains quality at lower cost
        messages: [
          {
            role: "system",
            content: "You are an SEO expert analyzing search intent matches. Provide accurate, actionable insights. Each keyword should be evaluated independently against the entire page content, not just for literal keyword matches."
          },
          {
            role: "user",
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 500,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error("No response from OpenAI");
    }

    // Parse the JSON response
    try {
      const analysis = JSON.parse(content);
      
      // Validate the response
      if (typeof analysis.matchScore !== 'number' || 
          analysis.matchScore < 0 || 
          analysis.matchScore > 100) {
        throw new Error("Invalid match score");
      }

      if (!analysis.reason || !analysis.suggestedFix) {
        throw new Error("Missing required fields");
      }

      return {
        matchScore: analysis.matchScore,
        reason: analysis.reason,
        suggestedFix: analysis.suggestedFix,
      };

    } catch (parseError) {
      console.error("Error parsing OpenAI response:", parseError);
      console.error("Raw response:", content);
      
      // Fallback response
      return {
        matchScore: 50,
        reason: "Unable to analyze content properly",
        suggestedFix: "Review the page content and ensure it directly addresses the search query",
      };
    }

  } catch (error) {
    console.error("Error calling OpenAI:", error);
    
    // Fallback response
    return {
      matchScore: 50,
      reason: "Analysis failed - unable to evaluate intent match",
      suggestedFix: "Manually review the page content against the search query",
    };
  }
}
export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

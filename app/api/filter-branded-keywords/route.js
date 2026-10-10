import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";

async function handlePOST(req) {
  try {
    const { keywords, businessName, businessType } = await req.json();

    if (!keywords || !Array.isArray(keywords) || keywords.length === 0) {
      return NextResponse.json({ error: "No keywords provided" }, { status: 400 });
    }

    if (!businessName) {
      return NextResponse.json({ error: "Business name is required" }, { status: 400 });
    }

    // Limit keywords to prevent API overload
    const keywordsToProcess = keywords.slice(0, 500);

    // Check if OpenAI API key is available
    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OpenAI API key not found");
      return NextResponse.json({ error: "OpenAI API key not configured" }, { status: 500 });
    }

    // Create a more robust prompt for OpenAI to identify branded vs non-branded keywords
    const businessNameLower = businessName.toLowerCase();
    const businessWords = businessNameLower.split(' ').filter(word => word.length > 2);
    
    const prompt = `You are an SEO expert analyzing keywords for a ${businessType || 'business'} called "${businessName}".

Your task: Classify each keyword as either "BRANDED" or "GENERIC".

BRANDED keywords are:
- EXACT variations of the business name "${businessName}" (e.g., "drive n shine", "drive & shine", "driveshine", "drive and shine")
- Keywords that contain the FULL business name "${businessName}" or clear variations
- Keywords that are clearly about this specific business
- Keywords containing "${businessNameLower}" or "${businessNameLower.replace(/\s+/g, '')}" or "${businessNameLower.replace(/\s+/g, ' n ')}" or "${businessNameLower.replace(/\s+/g, ' & ')}"

GENERIC keywords are:
- Service-based terms (e.g., "car wash near me", "auto detailing", "oil change")
- Location-based terms (e.g., "car wash lima ohio", "car wash fort wayne") 
- Industry terms that could apply to any business in the same industry
- Keywords that DON'T contain the business name "${businessName}" or its variations

IMPORTANT: 
- Only mark as BRANDED if the keyword clearly contains "${businessName}" or its variations
- If a keyword is just about the service or location without the business name, mark it as GENERIC
- You MUST return BOTH "branded" and "generic" arrays - even if one is empty
- Be very strict about branded classification - only include if it's clearly about this specific business
- CRITICAL: The response MUST include both "branded" and "generic" arrays. If you only return "branded", the system will fail.

Return ONLY a JSON object with this exact format:
{
  "branded": ["keyword1", "keyword2"],
  "generic": ["keyword3", "keyword4"]
}

Keywords to classify:
${keywordsToProcess.map(kw => `"${kw.keyword}"`).join(', ')}

Remember: Be very strict - only mark as branded if it clearly contains the business name "${businessName}" or its variations.`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are an expert SEO consultant who accurately classifies keywords as branded or generic. You MUST always return valid JSON with BOTH "branded" and "generic" arrays. Never return only one array. If you cannot complete the response, return an empty array for the missing category.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        max_tokens: 2000,
        temperature: 0.1 // Low temperature for consistent results
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`OpenAI API error: ${response.status}`);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content?.trim();
    
    if (!aiResponse) {
      console.error('No response from OpenAI');
      throw new Error('No response from OpenAI');
    }

    // Clean and parse JSON response
    let cleanedResponse = aiResponse
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    
    // Try to fix common JSON issues
    try {
      // Look for the JSON object boundaries
      const jsonStart = cleanedResponse.indexOf('{');
      const jsonEnd = cleanedResponse.lastIndexOf('}');
      
      if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
        cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
      }
      
      // Try to fix unterminated strings by finding the last complete entry
      if (cleanedResponse.includes('"') && !cleanedResponse.endsWith('}')) {
        // Find the last complete keyword entry
        const lastCompleteEntry = cleanedResponse.lastIndexOf('",');
        if (lastCompleteEntry !== -1) {
          cleanedResponse = cleanedResponse.substring(0, lastCompleteEntry + 1) + ']}';
        }
      }
      
      const classification = JSON.parse(cleanedResponse);
      
      if (!classification.branded || !classification.generic) {
        // If we have branded keywords from AI, use them and derive generic from the rest
        if (classification.branded && Array.isArray(classification.branded)) {
          const aiBrandedKeywords = classification.branded;
          const brandedKeywords = [];
          const genericKeywords = [];
          
          keywordsToProcess.forEach(kw => {
            if (aiBrandedKeywords.includes(kw.keyword)) {
              brandedKeywords.push(kw.keyword);
            } else {
              genericKeywords.push(kw.keyword);
            }
          });
          
          // Filter the processed keywords based on this classification
          const brandedKeywordsFiltered = keywordsToProcess.filter(kw => 
            brandedKeywords.includes(kw.keyword)
          );
          
          const genericKeywordsFiltered = keywordsToProcess.filter(kw => 
            genericKeywords.includes(kw.keyword)
          );
          
          return NextResponse.json({
            success: true,
            branded: brandedKeywordsFiltered,
            generic: genericKeywordsFiltered,
            brandedCount: brandedKeywordsFiltered.length,
            genericCount: genericKeywordsFiltered.length,
            totalProcessed: keywordsToProcess.length,
            totalReceived: keywords.length,
            limited: keywords.length > 500,
            fallback: true,
            reason: 'ai_missing_generic_array'
          });
        }
        
        // Use enhanced fallback parsing when AI response is incomplete
        const businessNameLower = businessName.toLowerCase();
        const businessWords = businessNameLower.split(' ').filter(word => word.length > 2);
        const brandedKeywords = [];
        const genericKeywords = [];
        
        keywordsToProcess.forEach(kw => {
          const keywordLower = kw.keyword.toLowerCase();
          
          // Enhanced branded detection
          const isBranded = 
            // Exact business name matches
            keywordLower.includes(businessNameLower) || 
            keywordLower.includes(businessNameLower.replace(/\s+/g, '')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' n ')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' & ')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' and ')) ||
            // Check for individual business words (but be more strict)
            (businessWords.length > 1 && businessWords.every(word => keywordLower.includes(word))) ||
            // Check for common brand variations
            keywordLower === businessNameLower ||
            keywordLower === businessNameLower.replace(/\s+/g, '') ||
            keywordLower === businessNameLower.replace(/\s+/g, ' n ') ||
            keywordLower === businessNameLower.replace(/\s+/g, ' & ') ||
            // Additional variations for business names with multiple words
            (businessWords.length > 1 && businessWords.every(word => keywordLower.includes(word))) ||
            // Check for partial brand matches (e.g., "drive n shine lima" should be branded)
            (businessWords.length > 1 && businessWords.every(word => keywordLower.includes(word)) && 
             (keywordLower.includes('drive') && keywordLower.includes('shine')));
          
          if (isBranded) {
            brandedKeywords.push(kw.keyword);
          } else {
            genericKeywords.push(kw.keyword);
          }
        });
        
        // Filter the processed keywords based on fallback classification
        const brandedKeywordsFiltered = keywordsToProcess.filter(kw => 
          brandedKeywords.includes(kw.keyword)
        );
        
        const genericKeywordsFiltered = keywordsToProcess.filter(kw => 
          genericKeywords.includes(kw.keyword)
        );
        
        return NextResponse.json({
          success: true,
          branded: brandedKeywordsFiltered,
          generic: genericKeywordsFiltered,
          brandedCount: brandedKeywordsFiltered.length,
          genericCount: genericKeywordsFiltered.length,
          totalProcessed: keywordsToProcess.length,
          totalReceived: keywords.length,
          limited: keywords.length > 500,
          fallback: true,
          reason: 'incomplete_ai_response'
        });
      }
      
      // If we get here, the JSON parsing was successful and complete
      // Validate the classification results
      if (classification.branded.length + classification.generic.length !== keywordsToProcess.length) {
        // Count mismatch - using fallback logic will handle this
      }
      
    } catch (parseError) {
      console.error('JSON parsing failed:', parseError.message);
      
      // Enhanced fallback: try to extract keywords manually with better logic
      const businessNameLower = businessName.toLowerCase();
      const businessWords = businessNameLower.split(' ').filter(word => word.length > 2);
      const brandedKeywords = [];
      const genericKeywords = [];
      
      // Look for keywords in the response text first
      const keywordMatches = cleanedResponse.match(/"([^"]+)"/g);
      if (keywordMatches) {
        keywordMatches.forEach(match => {
          const keyword = match.replace(/"/g, '');
          const keywordLower = keyword.toLowerCase();
          
          // Enhanced branded detection
          const isBranded = 
            keywordLower.includes(businessNameLower) || 
            keywordLower.includes(businessNameLower.replace(/\s+/g, '')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' n ')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' & ')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' and ')) ||
            (businessWords.length > 1 && businessWords.every(word => keywordLower.includes(word))) ||
            // Check for partial brand matches (e.g., "drive n shine lima" should be branded)
            (businessWords.length > 1 && businessWords.every(word => keywordLower.includes(word)) && 
             (keywordLower.includes('drive') && keywordLower.includes('shine')));
          
          if (isBranded) {
            brandedKeywords.push(keyword);
          } else {
            genericKeywords.push(keyword);
          }
        });
      }
      
      // If we have no generic keywords or very few, use the full keyword list
      if (genericKeywords.length === 0 || genericKeywords.length < keywordsToProcess.length * 0.1) {
        keywordsToProcess.forEach(kw => {
          const keywordLower = kw.keyword.toLowerCase();
          
          // Enhanced branded detection
          const isBranded = 
            keywordLower.includes(businessNameLower) || 
            keywordLower.includes(businessNameLower.replace(/\s+/g, '')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' n ')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' & ')) ||
            keywordLower.includes(businessNameLower.replace(/\s+/g, ' and ')) ||
            (businessWords.length > 1 && businessWords.every(word => keywordLower.includes(word))) ||
            keywordLower === businessNameLower ||
            keywordLower === businessNameLower.replace(/\s+/g, '') ||
            keywordLower === businessNameLower.replace(/\s+/g, ' n ') ||
            keywordLower === businessNameLower.replace(/\s+/g, ' & ') ||
            // Check for partial brand matches (e.g., "drive n shine lima" should be branded)
            (businessWords.length > 1 && businessWords.every(word => keywordLower.includes(word)) && 
             (keywordLower.includes('drive') && keywordLower.includes('shine')));
          
          if (isBranded) {
            brandedKeywords.push(kw.keyword);
          } else {
            genericKeywords.push(kw.keyword);
          }
        });
      }
      
      // Filter the processed keywords based on fallback classification
      const brandedKeywordsFiltered = keywordsToProcess.filter(kw => 
        brandedKeywords.includes(kw.keyword)
      );
      
      const genericKeywordsFiltered = keywordsToProcess.filter(kw => 
        genericKeywords.includes(kw.keyword)
      );
      
      return NextResponse.json({
        success: true,
        branded: brandedKeywordsFiltered,
        generic: genericKeywordsFiltered,
        brandedCount: brandedKeywordsFiltered.length,
        genericCount: genericKeywordsFiltered.length,
        totalProcessed: keywordsToProcess.length,
        totalReceived: keywords.length,
        limited: keywords.length > 500,
        fallback: true
      });
    }

    // If we get here, the JSON parsing was successful
    const classification = JSON.parse(cleanedResponse);

    // Filter the processed keywords based on AI classification
    const brandedKeywords = keywordsToProcess.filter(kw => 
      classification.branded.includes(kw.keyword)
    );
    
    const genericKeywords = keywordsToProcess.filter(kw => 
      classification.generic.includes(kw.keyword)
    );

    return NextResponse.json({
      success: true,
      branded: brandedKeywords,
      generic: genericKeywords,
      brandedCount: brandedKeywords.length,
      genericCount: genericKeywords.length,
      totalProcessed: keywordsToProcess.length,
      totalReceived: keywords.length,
      limited: keywords.length > 500
    });

  } catch (error) {
    console.error("Error in brand filtering API:", error);
    return NextResponse.json({ 
      error: "Failed to filter branded keywords",
      details: error.message 
    }, { status: 500 });
  }
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

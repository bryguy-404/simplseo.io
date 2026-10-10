import { scrapeContentResponse } from '../../../lib/server/scrapeContent';
import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

// Helper function to sanitize URL for use in Firestore document IDs
function sanitizeUrlForCache(url) {
  if (!url) return '';
  // Remove protocol (http:// or https://)
  let sanitized = url.replace(/^https?:\/\//, '');
  // Replace any remaining special characters with underscores
  sanitized = sanitized.replace(/[^a-zA-Z0-9]/g, '_');
  // Remove leading/trailing underscores
  sanitized = sanitized.replace(/^_+|_+$/g, '');
  return sanitized;
}

// ============================================================================
// SEMANTIC SIMILARITY DETECTION
// These modifier groups all target the same search intent
// ============================================================================
const SEMANTIC_GROUPS = {
  quality: ['best', 'top', 'top rated', 'top-rated', '#1', 'number one', 'premier', 'leading', 'greatest', 'finest'],
  price: ['affordable', 'cheap', 'budget', 'low cost', 'low-cost', 'inexpensive', 'economical', 'budget-friendly'],
  proximity: ['near me', 'nearby', 'close to me', 'around me', 'in my area', 'close by'],
  urgency: ['emergency', 'urgent', '24 hour', '24/7', 'same day', 'same-day', 'immediate'],
  reputation: ['trusted', 'reliable', 'reputable', 'professional', 'licensed', 'certified', 'experienced']
};

// Function to get the "canonical" version of a keyword for deduplication
function getSemanticKey(keyword) {
  let normalized = keyword.toLowerCase().trim();
  
  // Replace all synonyms with canonical version (the group name)
  Object.entries(SEMANTIC_GROUPS).forEach(([groupName, synonyms]) => {
    // Sort synonyms by length (longest first) to avoid partial replacements
    const sortedSynonyms = [...synonyms].sort((a, b) => b.length - a.length);
    sortedSynonyms.forEach(synonym => {
      if (normalized.includes(synonym)) {
        normalized = normalized.replace(new RegExp(synonym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), `[${groupName}]`);
      }
    });
  });
  
  // Remove extra spaces and normalize
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  return normalized;
}

// Deduplicate keywords based on semantic similarity
function deduplicateSemantically(suggestions) {
  const seen = new Map(); // semanticKey → best suggestion
  
  suggestions.forEach(suggestion => {
    const semanticKey = getSemanticKey(suggestion.keyword);
    
    if (!seen.has(semanticKey)) {
      seen.set(semanticKey, suggestion);
    } else {
      // Keep the one with higher priority
      const existing = seen.get(semanticKey);
      if ((suggestion.priority || 0) > (existing.priority || 0)) {
        seen.set(semanticKey, suggestion);
      }
    }
  });
  
  const unique = Array.from(seen.values());
  console.log(`🔍 Semantic dedup: ${suggestions.length} → ${unique.length} keywords`);
  return unique;
}

// ============================================================================
// BUSINESS TYPE AWARENESS
// Determines if a business is B2B or B2C to generate appropriate keywords
// ============================================================================
const B2B_BUSINESS_TYPES = [
  'web developer', 'web development', 'website developer', 'website design',
  'marketing agency', 'digital marketing', 'seo agency', 'seo services',
  'accountant', 'accounting', 'bookkeeper', 'bookkeeping',
  'consultant', 'consulting', 'business consultant',
  'photographer', 'photography', 'videographer', 'videography',
  'graphic designer', 'graphic design', 'branding agency',
  'software developer', 'software development', 'app developer',
  'it services', 'it support', 'managed services',
  'lawyer', 'attorney', 'law firm', 'legal services',
  'real estate agent', 'realtor', 'real estate',
  'insurance agent', 'insurance agency',
  'financial advisor', 'financial planning',
  'copywriter', 'copywriting', 'content writer'
];

function getBusinessTypeContext(businessType) {
  const businessTypeLower = businessType.toLowerCase();
  const isB2B = B2B_BUSINESS_TYPES.some(type => businessTypeLower.includes(type));
  
  if (isB2B) {
    return {
      isB2B: true,
      description: 'B2B (serves other businesses)',
      nichePrompt: `Target specific INDUSTRIES that might hire a ${businessType} as clients`,
      servicePrompt: `Specific services a ${businessType} offers (different service types, not synonyms)`,
      exampleNiche: getB2BNicheExamples(businessType),
      exampleServices: getB2BServiceExamples(businessType)
    };
  } else {
    return {
      isB2B: false,
      description: 'B2C (serves consumers directly)',
      nichePrompt: `SKIP industry-niche keywords - focus on customer situations instead`,
      servicePrompt: `Specific services a ${businessType} offers to customers`,
      exampleSituations: getB2CSituationExamples(businessType),
      exampleServices: getB2CServiceExamples(businessType)
    };
  }
}

function getB2BNicheExamples(businessType) {
  const bt = businessType.toLowerCase();
  if (bt.includes('web') || bt.includes('developer') || bt.includes('design')) {
    return ['restaurant website design', 'law firm website', 'dental office website', 'small business web design'];
  }
  if (bt.includes('marketing') || bt.includes('seo')) {
    return ['restaurant marketing', 'dental practice marketing', 'law firm seo', 'contractor marketing'];
  }
  if (bt.includes('photo')) {
    return ['real estate photography', 'product photography', 'headshot photographer', 'event photographer'];
  }
  return ['small business services', 'local business services'];
}

function getB2BServiceExamples(businessType) {
  const bt = businessType.toLowerCase();
  if (bt.includes('web') || bt.includes('developer')) {
    return ['WordPress development', 'e-commerce website', 'website redesign', 'custom web application', 'landing page design'];
  }
  if (bt.includes('marketing') || bt.includes('seo')) {
    return ['local seo', 'google ads management', 'social media marketing', 'email marketing', 'content marketing'];
  }
  if (bt.includes('photo')) {
    return ['portrait photography', 'commercial photography', 'event photography', 'product shots'];
  }
  return ['consulting', 'strategy', 'implementation', 'support'];
}

function getB2CSituationExamples(businessType) {
  const bt = businessType.toLowerCase();
  if (bt.includes('car wash') || bt.includes('auto')) {
    return ['car wash before road trip', 'muddy car cleaning', 'new car first wash', 'winter salt removal'];
  }
  if (bt.includes('dentist') || bt.includes('dental')) {
    return ['toothache relief', 'chipped tooth repair', 'dental emergency', 'first dental visit'];
  }
  if (bt.includes('restaurant') || bt.includes('food')) {
    return ['birthday dinner', 'business lunch', 'date night', 'family gathering'];
  }
  if (bt.includes('salon') || bt.includes('hair') || bt.includes('barber')) {
    return ['wedding hair', 'prom hairstyle', 'mens haircut', 'color correction'];
  }
  if (bt.includes('plumb')) {
    return ['clogged drain', 'water heater repair', 'leaky faucet', 'emergency plumber'];
  }
  if (bt.includes('hvac') || bt.includes('heating') || bt.includes('cooling')) {
    return ['ac not cooling', 'furnace repair', 'hvac maintenance', 'new ac installation'];
  }
  return ['same day service', 'weekend availability', 'emergency service'];
}

function getB2CServiceExamples(businessType) {
  const bt = businessType.toLowerCase();
  if (bt.includes('car wash') || bt.includes('auto detail')) {
    return ['car detailing', 'interior cleaning', 'wax treatment', 'ceramic coating', 'express wash'];
  }
  if (bt.includes('dentist') || bt.includes('dental')) {
    return ['teeth whitening', 'dental implants', 'invisalign', 'root canal', 'dental cleaning'];
  }
  if (bt.includes('salon') || bt.includes('hair')) {
    return ['haircut', 'hair coloring', 'balayage', 'keratin treatment', 'hair extensions'];
  }
  if (bt.includes('plumb')) {
    return ['drain cleaning', 'water heater installation', 'pipe repair', 'toilet repair', 'sewer line'];
  }
  if (bt.includes('hvac')) {
    return ['ac repair', 'furnace installation', 'duct cleaning', 'thermostat installation'];
  }
  return ['consultation', 'service', 'repair', 'installation'];
}

async function handlePOST(req) {
  try {
    const { gscKeywords, businessType, businessLocation, websiteUrl, customBusinessType, userId, forceRefresh } = await req.json();

    // Use custom business type if provided, otherwise use the selected business type
    const effectiveBusinessType = (businessType === "Other" && customBusinessType) ? customBusinessType : businessType;

    // Check for cached results first (unless forceRefresh is true)
    if (userId && !forceRefresh) {
      const sanitizedUrl = sanitizeUrlForCache(websiteUrl);
      const cacheKey = `genericKeywords_${userId}_${effectiveBusinessType}_${sanitizedUrl}`;
      
      try {
        const cachedDoc = await db.collection("genericKeywordsCache").doc(cacheKey).get();
        
        if (cachedDoc.exists) {
          const cachedData = cachedDoc.data();
          const cacheAge = Date.now() - cachedData.timestamp;
          
          // Keywords never expire - return cached data if it exists
          // This creates stability and forces users to work through their suggestions
          // The data flywheel will improve recommendations over time based on success stories
          console.log("✅ Returning cached keywords (never expires)");
            return NextResponse.json({
              success: true,
              opportunities: cachedData.opportunities,
              cannibalizationAnalysis: cachedData.cannibalizationAnalysis,
              hubAndSpokeStrategy: cachedData.hubAndSpokeStrategy,
              fromCache: true,
              cacheAge: Math.round(cacheAge / (60 * 60 * 1000)) // hours
            });
        } else {
          console.log("📝 No cache found, generating new data");
        }
      } catch (cacheError) {
        console.error("⚠️ Error checking cache:", cacheError);
        // Continue with generation if cache check fails
      }
    } else if (forceRefresh) {
      console.log("🔄 Force refresh requested - bypassing cache");
    }

    // Allow empty GSC keywords for pure AI generation
    if (!gscKeywords) {
      return NextResponse.json({ error: "No GSC keywords provided" }, { status: 400 });
    }

    // Extract existing keywords from GSC data for filtering
    const existingKeywords = gscKeywords.length > 0 ? gscKeywords.map(kw => kw.keyword.toLowerCase()) : [];

    // Crawl the user's website to understand current structure
    const siteAnalysis = await analyzeUserWebsite(websiteUrl, effectiveBusinessType);

    // Generate new AI-powered generic keyword opportunities
    const aiGeneratedOpportunities = await generateAIGenericKeywords(
      effectiveBusinessType, 
      businessLocation, 
      websiteUrl,
      existingKeywords,
      siteAnalysis
    );

    // Analyze keyword cannibalization for the new opportunities
    const cannibalizationAnalysis = analyzeKeywordCannibalization(aiGeneratedOpportunities);

    // Create hub-and-spoke keyword strategy
    const hubAndSpokeStrategy = createHubAndSpokeStrategy(aiGeneratedOpportunities, effectiveBusinessType, businessLocation);

    // Filter out pages that have Low CTR issues (avoid duplicate work)
    const lowCtrPages = gscKeywords
      .filter(kw => parseFloat(kw.ctr.replace('%', '')) <= 2 && kw.impressions > 20)
      .map(kw => kw.page);
    
    const uniqueLowCtrPages = [...new Set(lowCtrPages)];

    // Filter out opportunities for pages that have Low CTR issues
    const filteredOpportunities = aiGeneratedOpportunities.filter(opportunity => {
      const page = opportunity.currentPerformance?.page;
      return !uniqueLowCtrPages.includes(page);
    });

    // Prepare the response data
    const responseData = {
      opportunities: filteredOpportunities.slice(0, 50), // Return top 50
      cannibalizationAnalysis,
      hubAndSpokeStrategy,
      excludedLowCtrPages: uniqueLowCtrPages,
      excludedCount: aiGeneratedOpportunities.length - filteredOpportunities.length,
      totalGenerated: aiGeneratedOpportunities.length,
      totalFiltered: filteredOpportunities.length,
      strategy: "ai_generated_content_creation"
    };

    // Cache the results if userId is provided
    if (userId) {
      const sanitizedUrl = sanitizeUrlForCache(websiteUrl);
      const cacheKey = `genericKeywords_${userId}_${effectiveBusinessType}_${sanitizedUrl}`;
      console.log("💾 Caching generic keywords data for key:", cacheKey);
      
      try {
        await db.collection("genericKeywordsCache").doc(cacheKey).set({
          ...responseData,
          userId,
          businessType: effectiveBusinessType,
          websiteUrl,
          businessLocation,
          timestamp: Date.now(),
          createdAt: new Date().toISOString()
        });
      } catch (cacheError) {
        console.error("⚠️ Error caching data:", cacheError);
        // Continue even if caching fails
      }
    }

    return NextResponse.json(responseData);

  } catch (error) {
    console.error("Error in Generic Keywords API:", error);
    return NextResponse.json({ error: "Failed to generate generic keyword opportunities" }, { status: 500 });
  }
}

// Generate AI-powered generic keywords using Google Trends and business context
async function generateAIGenericKeywords(businessType, businessLocation, websiteUrl, existingKeywords, siteAnalysis) {
  try {
    // Get business type context (B2B vs B2C)
    const businessContext = getBusinessTypeContext(businessType);
    console.log(`🏢 Business context: ${businessContext.description}`);
    
    // 1. Get core keywords (limited set to avoid duplicates with AI)
    const coreKeywords = await getCoreKeywords(businessType, businessLocation, businessContext);
    
    // 2. Generate AI-powered keyword suggestions with business context
    const aiSuggestions = await generateAIKeywordSuggestions(businessType, businessLocation, websiteUrl, businessContext);
    
    // 3. Combine all suggestions
    const allSuggestions = [...coreKeywords, ...aiSuggestions];
    console.log(`📊 Total suggestions before dedup: ${allSuggestions.length}`);
    
    // 4. SEMANTIC DEDUPLICATION - removes "best X" if "top rated X" exists
    const semanticallyUnique = deduplicateSemantically(allSuggestions);
    
    // 5. Filter out keywords they already rank for
    const filteredSuggestions = semanticallyUnique.filter(suggestion => {
      const suggestionLower = suggestion.keyword.toLowerCase();
      const suggestionWords = suggestionLower.split(' ').filter(w => w.length > 2);
      
      return !existingKeywords.some(existing => {
        const existingLower = existing.toLowerCase();
        
        // Exact match - definitely filter out
        if (existingLower === suggestionLower) return true;
        
        // Semantic match - check if they're semantically the same
        if (getSemanticKey(existingLower) === getSemanticKey(suggestionLower)) return true;
        
        // If the existing keyword is a subset of the suggestion
        // Only filter if it's a very close match (80%+ word overlap)
        if (suggestionWords.length >= 2) {
          const existingWords = existingLower.split(' ').filter(w => w.length > 2);
          const matchingWords = suggestionWords.filter(w => existingWords.includes(w));
          const overlapRatio = matchingWords.length / Math.max(suggestionWords.length, existingWords.length);
          if (overlapRatio >= 0.8) return true;
        }
        
        return false;
      });
    });
    
    console.log(`🔍 After filtering existing keywords: ${filteredSuggestions.length} keywords`);
    
    // Parse location for fallback
    const locationParts = businessLocation.split(',').map(p => p.trim());
    const city = locationParts[0] || '';
    const stateAbbrev = getStateAbbreviation(locationParts[1] || '');
    
    // If all suggestions were filtered out, use location-based fallback suggestions
    const finalSuggestions = filteredSuggestions.length > 0 ? filteredSuggestions : [
      {
        keyword: `${businessType} ${city}`,
        category: 'location_based',
        priority: 9,
        searchVolume: "High",
        competition: "Medium",
        contentIdea: generateContentIdea(`${businessType} ${city}`, businessType, businessLocation),
        difficulty: "Medium",
        potential: "High",
        intent: "Transactional",
        intentExplanation: "Users searching with location are ready to contact a business",
        buyerReadiness: "High",
        difficultyScore: 5,
        difficultyLabel: "Medium",
        difficultyExplanation: "Local keyword with moderate competition",
        pageType: "Local Landing Page",
        pageTypeReason: "Best for capturing local search traffic",
        valueExplanation: `This keyword targets customers actively looking for ${businessType} in ${city}.`
      },
      {
        keyword: `best ${businessType} in ${city}`,
        category: 'location_based',
        priority: 9,
        searchVolume: "High",
        competition: "High",
        contentIdea: generateContentIdea(`best ${businessType} in ${city}`, businessType, businessLocation),
        difficulty: "High",
        potential: "High",
        intent: "Commercial",
        intentExplanation: "Users comparing options before choosing",
        buyerReadiness: "High",
        difficultyScore: 6,
        difficultyLabel: "Medium",
        difficultyExplanation: "Competitive but valuable local keyword",
        pageType: "Local Landing Page",
        pageTypeReason: "Perfect for 'best' comparison searches",
        valueExplanation: `Captures customers comparing ${businessType} options in ${city}.`
      },
      {
        keyword: `${businessType} services ${city} ${stateAbbrev}`,
        category: 'service_based',
        priority: 8,
        searchVolume: "Medium",
        competition: "Medium",
        contentIdea: generateContentIdea(`${businessType} services ${city}`, businessType, businessLocation),
        difficulty: "Medium",
        potential: "High",
        intent: "Commercial",
        intentExplanation: "Users researching services in their area",
        buyerReadiness: "Medium",
        difficultyScore: 5,
        difficultyLabel: "Medium",
        difficultyExplanation: "Standard local service keyword",
        pageType: "Service Page",
        pageTypeReason: "Ideal for listing all services with local optimization",
        valueExplanation: `Helps customers discover your ${businessType} services in ${city}.`
      }
    ];
    
    // 4. Convert to opportunity format with content creation focus
    const opportunities = await Promise.all(
      finalSuggestions.map(async (suggestion, index) => ({
        keyword: suggestion.keyword,
        category: suggestion.category,
        priority: suggestion.priority,
        searchVolume: suggestion.searchVolume || "Unknown",
        competition: suggestion.competition || "Medium",
        contentIdea: suggestion.contentIdea,
        actionItems: await getPersonalizedActionItems(suggestion, businessType, businessLocation, siteAnalysis),
        currentPerformance: {
          position: 0, // New keyword, not ranking yet
          ctr: "0%",
          impressions: 0,
          clicks: 0,
          page: null // No existing page
        },
        opportunity: "content_creation",
        difficulty: suggestion.difficulty || "Medium",
        potential: suggestion.potential || "High",
        // New enhanced fields
        intent: {
          category: suggestion.intent || "Commercial",
          explanation: suggestion.intentExplanation || "This keyword indicates potential customer interest.",
          buyerReadiness: suggestion.buyerReadiness || "Medium"
        },
        difficultyAnalysis: {
          score: suggestion.difficultyScore || 5,
          label: suggestion.difficultyLabel || suggestion.difficulty || "Medium",
          explanation: suggestion.difficultyExplanation || "Moderate competition expected."
        },
        pageType: {
          type: suggestion.pageType || "Service Page",
          reason: suggestion.pageTypeReason || "This page type is recommended for this keyword.",
          suggestedUrl: `/${suggestion.keyword.toLowerCase().replace(/\s+/g, '-')}`
        },
        valueExplanation: suggestion.valueExplanation || `This keyword can help attract customers searching for ${businessType} services in ${businessLocation}.`
      }))
    );
    
    return opportunities;
    
  } catch (error) {
    console.error("❌ Error generating AI keywords:", error);
    return [];
  }
}

// Generate core keywords - limited set to avoid semantic duplicates with AI
// Only generates ONE quality modifier keyword, ONE price modifier keyword, etc.
async function getCoreKeywords(businessType, businessLocation, businessContext) {
  try {
    // Parse location - get city and state separately
    const locationParts = businessLocation.split(',').map(p => p.trim());
    const city = locationParts[0] || '';
    const state = locationParts[1] || '';
    const stateAbbrev = getStateAbbreviation(state);
    
    // Generate MINIMAL core keywords - let AI handle the diversity
    // Only ONE from each semantic group to avoid duplicates
    const coreKeywords = [
      // ONE quality modifier keyword (best/top/top-rated - pick ONE)
      {
        keyword: `best ${businessType} in ${city}`,
        category: 'location_based',
        priority: 9,
        searchVolume: "High",
        competition: "High",
        contentIdea: `Create a comprehensive page showcasing why you're the best ${businessType} in ${city}`,
        difficulty: "Medium",
        potential: "Very High",
        intent: "Commercial",
        intentExplanation: "Users are comparing options before making a purchase decision",
        buyerReadiness: "High",
        difficultyScore: 6,
        difficultyLabel: "Medium",
        difficultyExplanation: "Competitive local keyword with high buyer intent",
        pageType: "Local Landing Page",
        pageTypeReason: "Best for capturing local search traffic",
        valueExplanation: `This keyword targets customers actively looking for the best ${businessType} in ${city}.`
      },
      // Primary location keyword
      {
        keyword: `${businessType} ${city} ${stateAbbrev}`,
        category: 'location_based',
        priority: 9,
        searchVolume: "High",
        competition: "Medium",
        contentIdea: `Create a local landing page optimized for ${city} customers`,
        difficulty: "Medium",
        potential: "Very High",
        intent: "Transactional",
        intentExplanation: "Users searching with location are ready to contact a local business",
        buyerReadiness: "High",
        difficultyScore: 5,
        difficultyLabel: "Medium",
        difficultyExplanation: "Local keyword with moderate competition",
        pageType: "Local Landing Page",
        pageTypeReason: "Optimized for local search intent",
        valueExplanation: `This keyword captures customers searching for ${businessType} services in your exact location.`
      },
      // ONE price modifier keyword (affordable/cheap/budget - pick ONE)
      {
        keyword: `affordable ${businessType} ${city}`,
        category: 'location_based',
        priority: 7,
        searchVolume: "Medium",
        competition: "Medium",
        contentIdea: `Create a pricing page showcasing your competitive rates in ${city}`,
        difficulty: "Easy",
        potential: "High",
        intent: "Commercial",
        intentExplanation: "Price-conscious customers comparing options",
        buyerReadiness: "Medium",
        difficultyScore: 4,
        difficultyLabel: "Easy",
        difficultyExplanation: "Less competitive than 'best' keywords but still valuable",
        pageType: "Pricing Page",
        pageTypeReason: "Perfect for showcasing competitive pricing",
        valueExplanation: `Attracts budget-conscious customers in ${city} looking for value.`
      }
    ];
    
    console.log(`📍 Generated ${coreKeywords.length} core keywords`);
    return coreKeywords;
    
  } catch (error) {
    console.error("Error generating core keywords:", error);
    return [];
  }
}

// Helper function to get state abbreviation
function getStateAbbreviation(state) {
  const stateMap = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
    'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
    'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
    'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
    'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
    'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
    'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
  };
  
  if (!state) return '';
  
  // If already abbreviated (2 letters), return as-is
  if (state.length === 2) return state.toUpperCase();
  
  // Look up full state name
  const abbrev = stateMap[state.toLowerCase()];
  return abbrev || state;
}

// Generate AI-powered keyword suggestions with business context awareness
async function generateAIKeywordSuggestions(businessType, businessLocation, websiteUrl, businessContext) {
  try {
    console.log("🧠 Generating AI keyword suggestions with business context...");
    
    // Parse location - get city and state separately
    const locationParts = businessLocation.split(',').map(p => p.trim());
    const city = locationParts[0] || '';
    const state = locationParts[1] || '';
    const stateAbbrev = getStateAbbreviation(state);
    
    // Build context-aware prompt based on B2B vs B2C
    const serviceExamples = businessContext.exampleServices?.join(', ') || 'various specialized services';
    const nicheOrSituationExamples = businessContext.isB2B 
      ? (businessContext.exampleNiche?.join(', ') || 'small business, local business')
      : (businessContext.exampleSituations?.join(', ') || 'emergency, same day');
    
    const prompt = `Generate 10 DIVERSE keyword opportunities for a ${businessType} business in ${city}, ${stateAbbrev}.

BUSINESS CONTEXT: This is a ${businessContext.description} business.

CRITICAL RULES - FOLLOW EXACTLY:
1. Each keyword MUST target a DIFFERENT search intent - NO SYNONYMS or variations
2. DO NOT generate multiple "quality" keywords (pick ONE: best OR top OR top-rated - NOT all three)
3. DO NOT generate multiple "price" keywords (pick ONE: affordable OR cheap OR budget - NOT all three)
4. At least 8 of 10 keywords must include "${city}" or "${stateAbbrev}"
5. Keywords must be things real people actually search for

GENERATE EXACTLY ONE KEYWORD FOR EACH CATEGORY:

1. **Service-Specific** (3 keywords): Different services a ${businessType} offers
   Examples for ${businessType}: ${serviceExamples}
   Format: "[specific service] ${city}" - e.g., "${serviceExamples.split(',')[0]?.trim() || 'specific service'} ${city}"

2. **${businessContext.isB2B ? 'Industry-Niche' : 'Customer Situation'}** (2 keywords): ${businessContext.isB2B ? 'Industries that hire ' + businessType : 'Situations when customers need ' + businessType}
   Examples: ${nicheOrSituationExamples}
   ${businessContext.isB2B ? `Format: "[industry] ${businessType} ${city}" - targeting specific client industries` : `Format: "[situation] ${businessType} ${city}" - targeting customer needs`}

3. **Question Keywords** (2 keywords): Questions people ask about ${businessType}
   Format: "how much does [service] cost ${city}", "how to find [service] ${city}"

4. **Long-Tail Specific** (2 keywords): Very specific 4-5 word phrases with lower competition
   Format: Unique, specific searches that competitors aren't targeting

5. **Urgency/Timing** (1 keyword): Time-sensitive searches
   Format: "same day ${businessType} ${city}" or "emergency ${businessType} ${city}"

DO NOT GENERATE:
- "best ${businessType}" variations (I already have this)
- "top rated ${businessType}" (synonym of best)
- "top ${businessType}" (synonym of best)  
- "affordable ${businessType}" variations (I already have this)
- "cheap ${businessType}" (synonym of affordable)
- "budget ${businessType}" (synonym of affordable)
- Generic keywords like "${businessType} tips" or "${businessType} near me"
- Any nonsensical combinations that don't make sense for a ${businessType}

Return ONLY a valid JSON array. Each object must have:
{
  "keyword": "the search term with location",
  "category": "service_based" | "long_tail" | "problem_solving" | "comparison" | "trending_search",
  "priority": 6-9,
  "contentIdea": "Brief content strategy",
  "difficulty": "Easy" | "Medium" | "Hard",
  "potential": "Medium" | "High" | "Very High",
  "intent": "Transactional" | "Commercial" | "Informational",
  "intentExplanation": "Why this intent",
  "buyerReadiness": "High" | "Medium" | "Low",
  "difficultyScore": 3-7,
  "difficultyLabel": "Easy" | "Medium" | "Hard",
  "difficultyExplanation": "Brief explanation",
  "pageType": "Service Page" | "Local Landing Page" | "Blog Article" | "FAQ Page",
  "pageTypeReason": "Why this page type",
  "valueExplanation": "Why this keyword matters"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are an SEO expert generating diverse keyword opportunities. You NEVER generate synonym variations of the same keyword. Each keyword you generate must target a genuinely different search intent. You understand the difference between B2B businesses (that serve other businesses) and B2C businesses (that serve consumers directly).`
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 3000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiResponse = data.choices[0]?.message?.content;
    
    if (!aiResponse) {
      throw new Error('No AI response received');
    }

    // Clean and parse JSON response
    const cleanedResponse = aiResponse.trim().replace(/```json\n?/g, '').replace(/```\n?/g, '');
    const suggestions = JSON.parse(cleanedResponse);
    console.log(`🧠 AI generated ${suggestions.length} diverse keyword suggestions`);
    
    return suggestions;
    
  } catch (error) {
    console.error("❌ AI keyword generation error:", error);
    // Return diverse fallback suggestions if AI fails
    const locationParts = businessLocation.split(',').map(p => p.trim());
    const city = locationParts[0] || '';
    const stateAbbrev = getStateAbbreviation(locationParts[1] || '');
    
    // Get service examples for this business type
    const services = businessContext?.exampleServices || ['services', 'consultation', 'repair'];
    
    return [
      {
        keyword: `${services[0] || businessType} ${city}`,
        category: 'service_based',
        priority: 8,
        contentIdea: `Create a dedicated service page for ${services[0]} in ${city}`,
        difficulty: "Medium",
        potential: "High",
        intent: "Commercial",
        intentExplanation: "Users looking for specific services",
        buyerReadiness: "High",
        difficultyScore: 5,
        difficultyLabel: "Medium",
        difficultyExplanation: "Specific service keyword with moderate competition",
        pageType: "Service Page",
        pageTypeReason: "Best for highlighting specific service offerings",
        valueExplanation: `Targets customers specifically looking for ${services[0]} services.`
      },
      {
        keyword: `${services[1] || 'professional ' + businessType} ${city}`,
        category: 'service_based',
        priority: 7,
        contentIdea: `Create content about ${services[1]} offerings in ${city}`,
        difficulty: "Medium",
        potential: "High",
        intent: "Commercial",
        intentExplanation: "Users researching specific services",
        buyerReadiness: "Medium",
        difficultyScore: 5,
        difficultyLabel: "Medium",
        difficultyExplanation: "Service-specific keyword",
        pageType: "Service Page",
        pageTypeReason: "Highlights specific service",
        valueExplanation: `Captures searches for ${services[1]} services.`
      },
      {
        keyword: `how much does ${businessType} cost ${city}`,
        category: 'problem_solving',
        priority: 7,
        contentIdea: `Create a pricing guide or FAQ page about ${businessType} costs`,
        difficulty: "Easy",
        potential: "High",
        intent: "Informational",
        intentExplanation: "Users researching prices before contacting",
        buyerReadiness: "Medium",
        difficultyScore: 4,
        difficultyLabel: "Easy",
        difficultyExplanation: "Question-based keywords have lower competition",
        pageType: "FAQ Page",
        pageTypeReason: "Perfect for answering pricing questions",
        valueExplanation: `Captures price-research traffic and builds trust.`
      },
      {
        keyword: `emergency ${businessType} ${city}`,
        category: 'trending_search',
        priority: 8,
        contentIdea: `Create an emergency services page with quick contact options`,
        difficulty: "Medium",
        potential: "High",
        intent: "Transactional",
        intentExplanation: "Users with urgent needs ready to hire immediately",
        buyerReadiness: "High",
        difficultyScore: 5,
        difficultyLabel: "Medium",
        difficultyExplanation: "Urgency keywords have high conversion",
        pageType: "Local Landing Page",
        pageTypeReason: "Emergency searches need quick information",
        valueExplanation: `Captures high-intent emergency searches.`
      },
      {
        keyword: `${businessType} for small business ${city}`,
        category: 'long_tail',
        priority: 6,
        contentIdea: `Create content targeting small business owners in ${city}`,
        difficulty: "Easy",
        potential: "Medium",
        intent: "Commercial",
        intentExplanation: "Small businesses looking for services",
        buyerReadiness: "Medium",
        difficultyScore: 3,
        difficultyLabel: "Easy",
        difficultyExplanation: "Long-tail keyword with less competition",
        pageType: "Service Page",
        pageTypeReason: "Can highlight small business packages",
        valueExplanation: `Targets the small business market segment.`
      }
    ];
  }
}

// Generate content ideas for keywords
function generateContentIdea(keyword, businessType, businessLocation) {
  const ideas = [
    `Create a comprehensive guide about "${keyword}" with local insights for ${businessLocation}`,
    `Write a detailed blog post explaining "${keyword}" and how it benefits customers`,
    `Develop a service page specifically for "${keyword}" with pricing and booking options`,
    `Create location-specific content about "${keyword}" in ${businessLocation.split(',')[0]}`,
    `Build a comparison page showing why your "${keyword}" services are the best`,
    `Develop FAQ content answering common questions about "${keyword}"`,
    `Create seasonal content about "${keyword}" with time-sensitive offers`,
    `Build a landing page for "${keyword}" with clear calls-to-action`
  ];
  
  return ideas[Math.floor(Math.random() * ideas.length)];
}

// Get content creation action items
function getContentCreationActionItems(suggestion, businessType, businessLocation) {
  const baseActions = [
    "Create dedicated content page",
    "Add to main navigation menu",
    "Include local SEO optimization",
    "Add customer testimonials",
    "Create booking/contact forms"
  ];
  
  const categoryActions = {
    'trending_search': [
      "Monitor trending performance",
      "Create timely content",
      "Add social media promotion"
    ],
    'service_based': [
      "Detail service offerings",
      "Add pricing information",
      "Include service areas"
    ],
    'location_based': [
      "Add local business info",
      "Include directions/maps",
      "Add local testimonials"
    ],
    'problem_solving': [
      "Address pain points",
      "Show solutions clearly",
      "Add before/after examples"
    ],
    'comparison': [
      "Compare with competitors",
      "Highlight unique benefits",
      "Add comparison charts"
    ]
  };
  
  return [...baseActions, ...(categoryActions[suggestion.category] || [])];
}

// Check if a keyword is a generic opportunity (not branded)
function isGenericOpportunity(keyword) {
  const brandedTerms = [
    'drive and shine', 'driveandshine', 'bryan develops', 'bryandevelops',
    'taco mensh', 'tacomensh'
  ];
  
  const lowerKeyword = keyword.toLowerCase();
  return !brandedTerms.some(term => lowerKeyword.includes(term));
}

// Analyze keyword cannibalization
function analyzeKeywordCannibalization(opportunities) {
  const keywordGroups = {};
  
  opportunities.forEach(opportunity => {
    const keyword = opportunity.keyword.toLowerCase();
    const page = opportunity.currentPerformance?.page || 'New Content';
    
    if (!keywordGroups[keyword]) {
      keywordGroups[keyword] = [];
    }
    keywordGroups[keyword].push({
      page,
      position: opportunity.currentPerformance?.position || 0,
      ctr: opportunity.currentPerformance?.ctr || '0%',
      impressions: opportunity.currentPerformance?.impressions || 0,
      clicks: opportunity.currentPerformance?.clicks || 0,
      priority: opportunity.priority
    });
  });
  
  const cannibalizedKeywords = Object.entries(keywordGroups)
    .filter(([keyword, pages]) => pages.length > 1)
    .map(([keyword, pages]) => ({
      keyword,
      pages: pages.sort((a, b) => b.priority - a.priority),
      issue: 'Multiple content pieces targeting same keyword',
      recommendation: getCannibalizationRecommendation(keyword, pages)
    }));
  
  const primaryPageAssignments = {};
  cannibalizedKeywords.forEach(({ keyword, pages }) => {
    const primaryPage = pages[0];
    primaryPageAssignments[keyword] = {
      primaryPage: primaryPage.page,
      reason: `Best performance: Position ${primaryPage.position}, CTR ${primaryPage.ctr}`,
      removeFrom: pages.slice(1).map(p => p.page)
    };
  });
  
  return {
    cannibalizedKeywords,
    primaryPageAssignments,
    totalCannibalized: cannibalizedKeywords.length,
    summary: `Found ${cannibalizedKeywords.length} keywords appearing on multiple pages. Consider consolidating to one primary page per keyword.`
  };
}

// Get cannibalization recommendation
function getCannibalizationRecommendation(keyword, pages) {
  if (pages.length <= 1) return "No cannibalization detected";
  
  const primaryPage = pages[0];
  const otherPages = pages.slice(1);
  
  return `Focus on "${primaryPage.page}" as the primary page for "${keyword}". Consider redirecting or updating content on: ${otherPages.map(p => p.page).join(', ')}`;
}

// Create hub-and-spoke keyword strategy
function createHubAndSpokeStrategy(opportunities, businessType, businessLocation) {
  console.log("🏗️ Creating hub-and-spoke keyword strategy...");
  
  const opportunitiesByPage = opportunities.reduce((acc, opportunity) => {
    const page = opportunity.currentPerformance?.page || 'New Content';
    if (!acc[page]) {
      acc[page] = [];
    }
    acc[page].push(opportunity);
    return acc;
  }, {});

  const pageTypes = identifyPageTypes(Object.keys(opportunitiesByPage));
  const strategy = { hub: null, spokes: [], assignments: {}, recommendations: [] };
  
  // Homepage as hub for broad keywords
  const homepage = Object.keys(opportunitiesByPage).find(page => 
    page.endsWith('/') || page.includes('homepage') || page === 'https://driveandshine.com/'
  );
  
  if (homepage) {
    strategy.hub = {
      page: homepage,
      type: 'homepage',
      keywords: opportunitiesByPage[homepage] || [],
      primaryKeywords: selectPrimaryKeywords(opportunitiesByPage[homepage] || [], 4),
      strategy: 'Focus on high-volume, broad keywords that represent your main services'
    };
  }
  
  // Other pages as spokes
  Object.entries(opportunitiesByPage).forEach(([page, pageOpportunities]) => {
    if (page === homepage) return;
    
    const pageType = pageTypes[page] || 'service';
    const primaryKeywords = selectPrimaryKeywords(pageOpportunities, 3);
    
    strategy.spokes.push({
      page,
      type: pageType,
      keywords: pageOpportunities,
      primaryKeywords,
      strategy: getPageSpecificStrategy(page, pageType, primaryKeywords)
    });
  });
  
  strategy.recommendations = generateOptimizationRecommendations(strategy, businessType, businessLocation);
  
  return strategy;
}

// Identify page types
function identifyPageTypes(pages) {
  const pageTypes = {};
  pages.forEach(page => {
    if (page === 'https://driveandshine.com/' || (page.endsWith('/') && !page.includes('/'))) {
      pageTypes[page] = 'homepage';
    } else if (page.includes('oil-change') || page.includes('oil')) {
      pageTypes[page] = 'oil-change';
    } else if (page.includes('detailing') || page.includes('detail')) {
      pageTypes[page] = 'detailing';
    } else if (page.includes('fort-wayne') || page.includes('location')) {
      pageTypes[page] = 'location';
    } else if (page.includes('free-car-wash') || page.includes('landing-page')) {
      pageTypes[page] = 'landing-page';
    } else if (page.includes('vip-membership') || page.includes('faq')) {
      pageTypes[page] = 'faq';
    } else if (page.includes('coupon') || page.includes('deal')) {
      pageTypes[page] = 'coupon';
    } else if (page.includes('service') || page.includes('services')) {
      pageTypes[page] = 'service';
    } else {
      pageTypes[page] = 'service';
    }
  });
  
  console.log("🔍 Page type identification:", pageTypes);
  return pageTypes;
}

// Select primary keywords for a page
function selectPrimaryKeywords(opportunities, maxCount) {
  return opportunities
    .sort((a, b) => b.priority - a.priority)
    .slice(0, maxCount)
    .map(opp => opp.keyword);
}

// Get page-specific strategy
function getPageSpecificStrategy(page, pageType, primaryKeywords) {
  const strategies = {
    'homepage': `Focus on broad service keywords like "${primaryKeywords[0]}" and "${primaryKeywords[1] || 'your main service'}" in your main heading and meta description`,
    'oil-change': `Create detailed content about "${primaryKeywords[0]}" with pricing, process, and benefits`,
    'detailing': `Develop comprehensive guides about "${primaryKeywords[0]}" with before/after photos and packages`,
    'location': `Optimize for local keywords like "${primaryKeywords[0]}" with location-specific content and testimonials`,
    'landing-page': `Focus on conversion-optimized content for "${primaryKeywords[0]}" with clear CTAs`,
    'faq': `Answer common questions about "${primaryKeywords[0]}" and related services`,
    'coupon': `Create time-sensitive offers for "${primaryKeywords[0]}" with clear expiration dates`,
    'service': `Develop detailed service pages for "${primaryKeywords[0]}" with pricing and booking options`
  };
  
  return strategies[pageType] || `Create comprehensive content about "${primaryKeywords[0]}" with clear value propositions`;
}

// Generate optimization recommendations
function generateOptimizationRecommendations(strategy, businessType, businessLocation) {
  const recommendations = [];
  
  if (strategy.hub) {
    recommendations.push({
      type: 'homepage_optimization',
      priority: 'High',
      title: 'Optimize Homepage for Broad Keywords',
      description: `Focus on ${strategy.hub.primaryKeywords.join(', ')} in your main heading and meta description`,
      action: 'Update homepage title and meta description to include primary keywords'
    });
  }
  
  strategy.spokes.forEach(spoke => {
    recommendations.push({
      type: 'content_creation',
      priority: 'Medium',
      title: `Create ${spoke.type} Content`,
      description: `Develop content for ${spoke.primaryKeywords.join(', ')}`,
      action: `Create or update ${spoke.page} with keyword-optimized content`
    });
  });
  
  recommendations.push({
    type: 'local_seo',
    priority: 'High',
    title: 'Local SEO Optimization',
    description: `Include ${businessLocation} in all content and meta descriptions`,
    action: 'Add location-specific content and local business schema markup'
  });
  
  return recommendations;
}

// Analyze user's website to understand current structure and content
async function analyzeUserWebsite(websiteUrl, businessType) {
  try {
    // Ensure the URL has a protocol
    const fullUrl = websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`;
    
    // Use the existing scrape-content API to get homepage data
    const response = await scrapeContentResponse(fullUrl);

    if (!response.ok) {
      console.warn("⚠️ Could not crawl website, using fallback analysis");
      return getFallbackSiteAnalysis(businessType);
    }

    const data = await response.json();
    const { title, metaDescription, textContent, headings } = data.data;

    // Analyze the content to understand current structure
    const analysis = {
      title: title || '',
      metaDescription: metaDescription || '',
      contentLength: textContent?.length || 0,
      headings: headings || [],
      navigation: extractNavigationInfo(headings, textContent),
      footer: extractFooterInfo(textContent),
      pages: extractPageInfo(headings, textContent),
      contentGaps: identifyContentGaps(headings, textContent, businessType),
      hasContactForm: checkForContactForm(textContent),
      hasTestimonials: checkForTestimonials(textContent),
      hasPricing: checkForPricing(textContent),
      hasLocationInfo: checkForLocationInfo(textContent)
    };

    return analysis;

  } catch (error) {
    console.error("Error analyzing website:", error);
    return getFallbackSiteAnalysis(businessType);
  }
}

// Extract navigation information from headings and content
function extractNavigationInfo(headings, content) {
  const navKeywords = ['services', 'about', 'contact', 'pricing', 'portfolio', 'gallery', 'testimonials'];
  const foundNavItems = [];
  
  headings.forEach(heading => {
    const headingLower = heading.toLowerCase();
    navKeywords.forEach(keyword => {
      if (headingLower.includes(keyword)) {
        foundNavItems.push(heading);
      }
    });
  });

  return {
    items: foundNavItems,
    hasServices: foundNavItems.some(item => item.toLowerCase().includes('service')),
    hasAbout: foundNavItems.some(item => item.toLowerCase().includes('about')),
    hasContact: foundNavItems.some(item => item.toLowerCase().includes('contact')),
    hasPricing: foundNavItems.some(item => item.toLowerCase().includes('pricing'))
  };
}

// Extract footer information
function extractFooterInfo(content) {
  const footerKeywords = ['copyright', 'privacy', 'terms', 'address', 'phone', 'email'];
  const foundFooterItems = [];
  
  footerKeywords.forEach(keyword => {
    if (content.toLowerCase().includes(keyword)) {
      foundFooterItems.push(keyword);
    }
  });

  return {
    items: foundFooterItems,
    hasContactInfo: foundFooterItems.some(item => ['address', 'phone', 'email'].includes(item)),
    hasLegalPages: foundFooterItems.some(item => ['privacy', 'terms'].includes(item))
  };
}

// Extract page information
function extractPageInfo(headings, content) {
  const pages = [];
  const h1Headings = headings.filter(h => h.startsWith('H1:') || h.includes('h1'));
  
  h1Headings.forEach(heading => {
    const cleanHeading = heading.replace(/^H1:\s*/, '').trim();
    if (cleanHeading) {
      pages.push({
        title: cleanHeading,
        type: categorizePageType(cleanHeading),
        hasContent: content.length > 500
      });
    }
  });

  return pages;
}

// Categorize page type based on heading
function categorizePageType(heading) {
  const headingLower = heading.toLowerCase();
  
  if (headingLower.includes('service')) return 'service';
  if (headingLower.includes('about')) return 'about';
  if (headingLower.includes('contact')) return 'contact';
  if (headingLower.includes('pricing')) return 'pricing';
  if (headingLower.includes('portfolio')) return 'portfolio';
  if (headingLower.includes('testimonial')) return 'testimonial';
  if (headingLower.includes('gallery')) return 'gallery';
  
  return 'content';
}

// Identify content gaps
function identifyContentGaps(headings, content, businessType) {
  const gaps = [];
  const contentLower = content.toLowerCase();
  
  // Check for common business content gaps
  const commonGaps = [
    { keyword: 'pricing', check: () => !contentLower.includes('pricing') && !contentLower.includes('price') },
    { keyword: 'testimonials', check: () => !contentLower.includes('testimonial') && !contentLower.includes('review') },
    { keyword: 'contact', check: () => !contentLower.includes('contact') && !contentLower.includes('phone') },
    { keyword: 'about', check: () => !contentLower.includes('about') && !contentLower.includes('story') },
    { keyword: 'location', check: () => !contentLower.includes('location') && !contentLower.includes('address') },
    { keyword: 'hours', check: () => !contentLower.includes('hours') && !contentLower.includes('open') },
    { keyword: 'booking', check: () => !contentLower.includes('book') && !contentLower.includes('appointment') }
  ];

  commonGaps.forEach(gap => {
    if (gap.check()) {
      gaps.push(gap.keyword);
    }
  });

  return gaps;
}

// Check for contact form
function checkForContactForm(content) {
  const formKeywords = ['form', 'contact', 'book', 'appointment', 'quote', 'inquiry'];
  return formKeywords.some(keyword => content.toLowerCase().includes(keyword));
}

// Check for testimonials
function checkForTestimonials(content) {
  const testimonialKeywords = ['testimonial', 'review', 'customer', 'client', 'satisfied', 'happy'];
  return testimonialKeywords.some(keyword => content.toLowerCase().includes(keyword));
}

// Check for pricing information
function checkForPricing(content) {
  const pricingKeywords = ['pricing', 'price', 'cost', 'rate', 'fee', '$', 'dollar'];
  return pricingKeywords.some(keyword => content.toLowerCase().includes(keyword));
}

// Check for location information
function checkForLocationInfo(content) {
  const locationKeywords = ['location', 'address', 'near', 'area', 'city', 'state', 'zip'];
  return locationKeywords.some(keyword => content.toLowerCase().includes(keyword));
}

// Get fallback site analysis when crawling fails
function getFallbackSiteAnalysis(businessType) {
  return {
    title: '',
    metaDescription: '',
    contentLength: 0,
    headings: [],
    navigation: { items: [], hasServices: false, hasAbout: false, hasContact: false, hasPricing: false },
    footer: { items: [], hasContactInfo: false, hasLegalPages: false },
    pages: [],
    contentGaps: ['pricing', 'testimonials', 'contact', 'about', 'location', 'hours', 'booking'],
    hasContactForm: false,
    hasTestimonials: false,
    hasPricing: false,
    hasLocationInfo: false
  };
}

// Get AI-generated personalized action items based on site analysis
async function getPersonalizedActionItems(suggestion, businessType, businessLocation, siteAnalysis) {
  try {
    // Generate AI-powered recommendations
    const aiActions = await generateAIActionItems(suggestion, businessType, businessLocation, siteAnalysis);
    return aiActions;
  } catch (error) {
    console.error("AI action generation failed, using fallback:", error);
    // Fallback to basic actions if AI fails
    return [
      `Create a dedicated page or blog post specifically about "${suggestion.keyword}" to help you rank for this keyword`,
      `Write content that directly addresses what people are looking for when they search "${suggestion.keyword}"`,
      `Include "${suggestion.keyword}" in your page titles, headings, and content naturally`,
      `Add local SEO optimization if this is a location-based keyword`
    ];
  }
}

// Generate AI-powered action items
async function generateAIActionItems(suggestion, businessType, businessLocation, siteAnalysis) {
  const prompt = `You are an SEO expert helping a ${businessType} business in ${businessLocation}. 

Generate 4-6 specific, actionable recommendations for the keyword: "${suggestion.keyword}"

Business Context:
- Business Type: ${businessType}
- Location: ${businessLocation}
- Keyword Category: ${suggestion.category}
- Search Volume: ${suggestion.searchVolume}
- Difficulty: ${suggestion.difficulty}

Current Website Analysis:
- Content Gaps: ${siteAnalysis?.contentGaps?.join(', ') || 'None identified'}
- Navigation Issues: ${!siteAnalysis?.navigation?.hasServices ? 'Missing Services menu' : 'Has Services menu'}, ${!siteAnalysis?.navigation?.hasPricing ? 'Missing Pricing menu' : 'Has Pricing menu'}, ${!siteAnalysis?.navigation?.hasContact ? 'Missing Contact menu' : 'Has Contact menu'}

Requirements:
1. Make each recommendation specific to the exact keyword "${suggestion.keyword}"
2. Include the keyword naturally in each recommendation
3. Focus on beginner-friendly, actionable steps
4. Explain WHY each action helps with SEO
5. Be specific about what content to create and where to put it
6. Consider the business type and location context
7. Address any identified content gaps or navigation issues

Format as a JSON array of strings, each string being one complete recommendation.

Example format:
[
  "Create a dedicated landing page for '${suggestion.keyword}' with clear calls-to-action and local contact information",
  "Write blog posts about '${suggestion.keyword}' topics and share them on social media to build authority",
  "Add '${suggestion.keyword}' to your page titles, meta descriptions, and H1 headings for better search visibility"
]`;

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
          content: 'You are an expert SEO consultant who provides specific, actionable recommendations for small businesses. Always include the exact keyword in your recommendations and explain the SEO benefit.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 800,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content?.trim();
  
  if (!content) {
    throw new Error('No content received from OpenAI');
  }

  try {
    // Clean up the content first - remove any markdown formatting
    let cleanContent = content
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .replace(/^json\s*/g, '')
      .trim();
    
    // Try to parse as JSON
    const actions = JSON.parse(cleanContent);
    if (Array.isArray(actions) && actions.length > 0) {
      // Clean up each action item
      return actions.map(action => {
        if (typeof action === 'string') {
          return action.trim();
        }
        return String(action).trim();
      }).filter(action => action.length > 0);
    } else {
      throw new Error('Invalid JSON format');
    }
  } catch (parseError) {
    console.error("❌ Failed to parse AI response as JSON:", content);
    // Fallback: split by lines and clean up
    const lines = content
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => {
        // Remove bullet points, quotes, and other formatting
        return line
          .replace(/^[-•*]\s*/, '')
          .replace(/^"\s*/, '')
          .replace(/"$/, '')
          .replace(/^\d+\.\s*/, '')
          .replace(/^json\s*/, '')
          .replace(/^\[/, '')
          .replace(/\]$/, '')
          .trim();
      })
      .filter(line => line.length > 0 && !line.match(/^[\[\]{}"]*$/));
    
    return lines;
  }
}


export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

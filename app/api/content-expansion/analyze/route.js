import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import googleTrends from 'google-trends-api';

async function handlePOST(request) {
  try {
    const { gscKeywords, businessType, businessLocation, websiteUrl, customBusinessType } = await request.json();

    // Use custom business type if provided, otherwise use the selected business type
    const effectiveBusinessType = (businessType === "Other" && customBusinessType) ? customBusinessType : businessType;

    // Debug: Log received data
    console.log("🔍 Content Expansion API Debug:", {
      gscKeywordsCount: gscKeywords?.length || 0,
      businessType,
      customBusinessType,
      effectiveBusinessType,
      businessLocation,
      websiteUrl,
      sampleKeywords: gscKeywords?.slice(0, 3) || []
    });

    if (!gscKeywords || !Array.isArray(gscKeywords)) {
      return NextResponse.json(
        { error: "GSC keywords data is required" },
        { status: 400 }
      );
    }

    // Analyze current keywords to identify patterns and opportunities
    const analysis = await analyzeContentExpansionOpportunities({
      gscKeywords,
      businessType: effectiveBusinessType,
      businessLocation,
      websiteUrl
    });

    return NextResponse.json({
      success: true,
      opportunities: analysis.opportunities,
      insights: analysis.insights,
      totalOpportunities: analysis.opportunities.length
    });

  } catch (error) {
    console.error("Content expansion analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze content expansion opportunities" },
      { status: 500 }
    );
  }
}

async function analyzeContentExpansionOpportunities({ gscKeywords, businessType, businessLocation, websiteUrl }) {
  // Extract and analyze current keyword patterns
  const currentKeywords = gscKeywords.map(kw => kw.keyword.toLowerCase());
  const topKeywords = gscKeywords
    .sort((a, b) => b.clicks - a.clicks)
    .slice(0, 10)
    .map(kw => kw.keyword);

  // Generate content expansion opportunities based on patterns
  const opportunities = await generateContentOpportunities({
    currentKeywords,
    topKeywords,
    businessType,
    businessLocation,
    websiteUrl,
    gscKeywords
  });

  // Generate insights about the analysis
  const insights = generateInsights(currentKeywords, opportunities, businessType);

  return {
    opportunities,
    insights
  };
}

async function generateContentOpportunities({ currentKeywords, topKeywords, businessType, businessLocation, websiteUrl, gscKeywords }) {
  const opportunities = [];

  // 1. Location-based expansion opportunities
  if (businessLocation) {
    const locationOpportunities = generateLocationOpportunities({
      currentKeywords,
      businessType,
      businessLocation,
      gscKeywords
    });
    opportunities.push(...locationOpportunities);
  }

  // 2. Service-based expansion opportunities
  const serviceOpportunities = generateServiceOpportunities({
    currentKeywords,
    businessType,
    topKeywords,
    gscKeywords
  });
  opportunities.push(...serviceOpportunities);

  // 3. Content gap opportunities based on current performance
  const contentGapOpportunities = generateContentGapOpportunities({
    currentKeywords,
    businessType,
    topKeywords,
    gscKeywords
  });
  opportunities.push(...contentGapOpportunities);

  // 4. Long-tail keyword opportunities
  const longTailOpportunities = generateLongTailOpportunities({
    currentKeywords,
    businessType,
    businessLocation,
    gscKeywords
  });
  opportunities.push(...longTailOpportunities);

  // 5. Google Trends opportunities
  const trendsOpportunities = await generateTrendsOpportunities({
    currentKeywords,
    businessType,
    businessLocation
  });
  opportunities.push(...trendsOpportunities);

  // Sort by priority and estimated impact
  return opportunities
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 15); // Return top 15 opportunities
}

function generateLocationOpportunities({ currentKeywords, businessType, businessLocation, gscKeywords }) {
  const opportunities = [];
  
  // Extract location from businessLocation (e.g., "South Bend Indiana 46628" -> "South Bend")
  let primaryLocation = "nearby";
  if (businessLocation && businessLocation.trim()) {
    primaryLocation = businessLocation.split(',')[0].trim();
  }
  
  // Analyze what location-based keywords they're already ranking for
  const existingLocationKeywords = currentKeywords.filter(kw => 
    kw.includes(primaryLocation.toLowerCase()) || 
    kw.includes('near me') || 
    kw.includes('local')
  );

  // Generate specific, actionable location opportunities
  const locationOpportunities = [
    {
      keyword: `${businessType} in ${primaryLocation}`,
      description: `Create location-specific page for ${primaryLocation}`,
      contentIdea: `"Best ${businessType} in ${primaryLocation}" - Include local testimonials, service areas, and contact info`,
      priority: 9,
      type: 'location_expansion',
      estimatedVolume: 'High',
      difficulty: 'Medium'
    },
    {
      keyword: `${businessType} near me ${primaryLocation}`,
      description: `Target "near me" searches in ${primaryLocation}`,
      contentIdea: `"${businessType} Near Me in ${primaryLocation}" - Add Google My Business optimization and local schema`,
      priority: 8,
      type: 'location_expansion',
      estimatedVolume: 'High',
      difficulty: 'Low'
    },
    {
      keyword: `best ${businessType} ${primaryLocation}`,
      description: `Compete for "best" searches in ${primaryLocation}`,
      contentIdea: `"Best ${businessType} in ${primaryLocation}" - Create comparison content and local reviews`,
      priority: 7,
      type: 'location_expansion',
      estimatedVolume: 'Medium',
      difficulty: 'Medium'
    }
  ];

  // Add nearby location opportunities
  const nearbyLocations = getNearbyLocations(primaryLocation);
  nearbyLocations.slice(0, 3).forEach(location => {
    if (!existingLocationKeywords.some(kw => kw.includes(location.toLowerCase()))) {
      locationOpportunities.push({
        keyword: `${businessType} in ${location}`,
        description: `Expand to nearby location: ${location}`,
        contentIdea: `"${businessType} in ${location}" - Create location page with local SEO optimization`,
        priority: 6,
        type: 'location_expansion',
        estimatedVolume: 'Medium',
        difficulty: 'Low'
      });
    }
  });

  return locationOpportunities;
}

function generateServiceOpportunities({ currentKeywords, businessType, topKeywords, gscKeywords }) {
  const opportunities = [];
  
  // Get service-specific keywords based on business type
  const serviceKeywords = getServiceKeywords(businessType);
  
  console.log(`🔧 Service keywords for ${businessType}:`, serviceKeywords);
  
  // Analyze what service keywords they're already ranking for
  const existingServiceKeywords = currentKeywords.filter(kw => 
    serviceKeywords.some(service => kw.includes(service.toLowerCase()))
  );
  
  console.log(`🔍 Existing service keywords:`, existingServiceKeywords);

  // Generate service-based opportunities
  serviceKeywords.slice(0, 5).forEach(service => {
    const serviceKeyword = `${businessType} ${service}`;
    const isAlreadyRanking = existingServiceKeywords.some(kw => kw.includes(service.toLowerCase()));
    
    console.log(`🔍 Checking service: ${serviceKeyword}, already ranking: ${isAlreadyRanking}`);
    
    if (!isAlreadyRanking) {
      opportunities.push({
        keyword: serviceKeyword,
        description: `Target ${service} service searches`,
        contentIdea: `"${businessType} ${service}" - Create dedicated service page with detailed information`,
        priority: 7,
        type: 'service_expansion',
        estimatedVolume: 'Medium',
        difficulty: 'Low'
      });
    }
  });
  
  console.log(`🔧 Generated ${opportunities.length} service opportunities`);

  return opportunities;
}

function generateContentGapOpportunities({ currentKeywords, businessType, topKeywords, gscKeywords }) {
  const opportunities = [];
  
  // Analyze keywords that are getting impressions but low clicks (potential content gaps)
  const lowCtrKeywords = gscKeywords.filter(kw => 
    kw.impressions > 10 && 
    parseFloat(kw.ctr.replace('%', '')) < 2
  );

  // Group by keyword to avoid duplicates
  const keywordGroups = {};
  lowCtrKeywords.forEach(kw => {
    if (!keywordGroups[kw.keyword]) {
      keywordGroups[kw.keyword] = {
        keyword: kw.keyword,
        totalImpressions: 0,
        totalClicks: 0,
        avgCtr: 0,
        count: 0
      };
    }
    keywordGroups[kw.keyword].totalImpressions += kw.impressions;
    keywordGroups[kw.keyword].totalClicks += kw.clicks;
    keywordGroups[kw.keyword].count += 1;
  });

  // Calculate average CTR for each keyword
  Object.values(keywordGroups).forEach(group => {
    group.avgCtr = (group.totalClicks / group.totalImpressions * 100).toFixed(1);
  });

  // Generate content ideas for low-performing keywords (max 2 to avoid duplicates)
  Object.values(keywordGroups)
    .sort((a, b) => b.totalImpressions - a.totalImpressions)
    .slice(0, 2)
    .forEach(kw => {
      opportunities.push({
        keyword: kw.keyword,
        description: `Improve content for "${kw.keyword}" (${kw.totalImpressions} impressions, ${kw.avgCtr}% CTR)`,
        contentIdea: `Create comprehensive content targeting "${kw.keyword}" - current CTR is low despite good impressions`,
        priority: 8,
        type: 'content_improvement',
        estimatedVolume: 'High',
        difficulty: 'Medium'
      });
    });

  return opportunities;
}

function generateLongTailOpportunities({ currentKeywords, businessType, businessLocation, gscKeywords }) {
  const opportunities = [];
  
  // Generate long-tail keyword opportunities
  const longTailKeywords = [
    `how to choose ${businessType}`,
    `${businessType} cost in ${businessLocation?.split(',')[0] || 'your area'}`,
    `what to expect from ${businessType}`,
    `${businessType} vs alternatives`,
    `professional ${businessType} services`
  ];

  longTailKeywords.forEach(keyword => {
    if (!currentKeywords.some(kw => kw.includes(keyword.toLowerCase()))) {
      opportunities.push({
        keyword: keyword,
        description: `Target informational searches`,
        contentIdea: `"${keyword}" - Create educational content to capture informational search intent`,
        priority: 6,
        type: 'long_tail',
        estimatedVolume: 'Medium',
        difficulty: 'Low'
      });
    }
  });

  return opportunities;
}

function generateInsights(currentKeywords, opportunities, businessType) {
  const locationOpportunities = opportunities.filter(opp => opp.type === 'location_expansion');
  const serviceOpportunities = opportunities.filter(opp => opp.type === 'service_expansion');
  const contentOpportunities = opportunities.filter(opp => opp.type === 'content_improvement');
  const longTailOpportunities = opportunities.filter(opp => opp.type === 'long_tail');

  const insights = [
    `Found ${opportunities.length} total opportunities for ${businessType}`,
    `${locationOpportunities.length} location-based opportunities`,
    `${serviceOpportunities.length} service-based opportunities`,
    `${contentOpportunities.length} content improvement opportunities`,
    `${longTailOpportunities.length} long-tail keyword opportunities`
  ];

  return {
    summary: `Great potential for content expansion! Focus on ${locationOpportunities.length > 0 ? 'location and ' : ''}service-based keywords first.`,
    details: insights,
    totalOpportunities: opportunities.length,
    locationBased: locationOpportunities.length,
    serviceBased: serviceOpportunities.length
  };
}

function getNearbyLocations(primaryLocation) {
  // This would ideally use a real location API, but for now we'll use a simple mapping
  const locationMap = {
    'South Bend': ['Mishawaka', 'Elkhart', 'Granger', 'Niles'],
    'Fort Wayne': ['New Haven', 'Huntington', 'Auburn', 'Kendallville'],
    'Indianapolis': ['Carmel', 'Fishers', 'Noblesville', 'Greenwood'],
    'Chicago': ['Evanston', 'Oak Park', 'Schaumburg', 'Naperville'],
    'Los Angeles': ['Beverly Hills', 'Santa Monica', 'Pasadena', 'Glendale'],
    'New York': ['Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    'Miami': ['Coral Gables', 'Aventura', 'Doral', 'Homestead']
  };

  return locationMap[primaryLocation] || ['nearby', 'local', 'downtown'];
}

function getServiceKeywords(businessType) {
  const serviceMap = {
    'Car Wash': ['mobile', 'detailing', 'waxing', 'interior cleaning', 'hand wash'],
    'Dentist': ['cleaning', 'whitening', 'orthodontics', 'cosmetic', 'emergency'],
    'Restaurant': ['delivery', 'catering', 'private events', 'takeout', 'brunch'],
    'Hair Salon': ['coloring', 'styling', 'cuts', 'treatments', 'wedding'],
    'Auto Repair': ['oil change', 'brake service', 'transmission', 'engine repair', 'diagnostics'],
    'Pet Grooming': ['bathing', 'nail trimming', 'teeth cleaning', 'flea treatment', 'boarding'],
    'Landscaping': ['lawn care', 'tree trimming', 'mulching', 'snow removal', 'design'],
    'Plumber': ['emergency', 'drain cleaning', 'water heater', 'repairs', 'installation'],
    'Electrician': ['wiring', 'outlets', 'lighting', 'panel upgrades', 'emergency'],
    'HVAC': ['heating', 'cooling', 'maintenance', 'repair', 'installation']
  };

  return serviceMap[businessType] || ['services', 'solutions', 'consultation', 'support', 'maintenance'];
}

async function generateTrendsOpportunities({ currentKeywords, businessType, businessLocation }) {
  const opportunities = [];
  
  console.log('🔍 Generating trends opportunities for:', businessType);
  
  // Get related queries from Google Trends (with fallback)
  const relatedQueries = await getGoogleTrendsData(businessType, businessLocation);
  
  // Filter out queries that user is already ranking for
  const newOpportunities = relatedQueries.filter(query => 
    !currentKeywords.some(kw => kw.includes(query.toLowerCase()))
  );
  
  console.log('📊 New trending opportunities found:', newOpportunities.length);
  
  // Convert to opportunity format with AI-generated content ideas
  for (const query of newOpportunities.slice(0, 5)) {
    console.log(`🤖 Generating AI content idea for: ${query}`);
    const aiContentIdea = await generateAIContentIdea(query, businessType, businessLocation);
    console.log(`✅ AI content idea: ${aiContentIdea.substring(0, 100)}...`);
    
    opportunities.push({
      keyword: query,
      description: `Trending search opportunity: "${query}"`,
      contentIdea: aiContentIdea,
      priority: 8, // Increased priority to compete with content improvement
      type: 'trending_search',
      estimatedVolume: 'High',
      difficulty: 'Medium'
    });
  }
  
  return opportunities;
}

async function getGoogleTrendsData(businessType, businessLocation) {
  try {
    console.log('🔍 Fetching Google Trends data for:', businessType);
    
    // Get related queries for the business type
    const relatedQueries = await googleTrends.relatedQueries({
      keyword: businessType,
      startTime: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // Last year
      geo: getCountryCode(businessLocation)
    });
    
    console.log('📊 Google Trends raw response:', relatedQueries);
    
    const data = JSON.parse(relatedQueries);
    const queries = [];
    
    // Extract related queries from the response
    if (data.default && data.default.rankedList) {
      data.default.rankedList.forEach(list => {
        if (list.rankedKeyword) {
          list.rankedKeyword.forEach(keyword => {
            if (keyword.query && keyword.value > 50) { // Only include queries with decent volume
              // Filter out competitor-specific terms and focus on generic opportunities
              if (isGenericOpportunity(keyword.query, businessType)) {
                queries.push(keyword.query);
              }
            }
          });
        }
      });
    }
    
    console.log('📈 Extracted trending queries:', queries);
    return queries.slice(0, 10); // Return top 10 related queries
    
  } catch (error) {
    console.error('Google Trends API error:', error);
    // Return fallback trending queries instead of throwing
    return getFallbackTrendingQueries(businessType);
  }
}

function getFallbackTrendingQueries(businessType) {
  // Fallback trending queries when Google Trends API fails
  const currentYear = new Date().getFullYear();
  const trendingQueries = [
    `${businessType} ${currentYear}`,
    `${businessType} near me`,
    `best ${businessType}`,
    `${businessType} reviews`,
    `${businessType} prices`,
    `${businessType} cost`,
    `${businessType} services`,
    `${businessType} company`,
    `${businessType} professional`,
    `${businessType} quality`
  ];
  
  console.log('🔄 Using fallback trending queries:', trendingQueries);
  return trendingQueries;
}

function isGenericOpportunity(query, businessType) {
  const lowerQuery = query.toLowerCase();
  const lowerBusinessType = businessType.toLowerCase();
  
  // Skip if it's just the business type alone
  if (lowerQuery === lowerBusinessType) return false;
  
  // Skip competitor-specific terms (common car wash chains)
  const competitorTerms = [
    'tommy', 'flagstop', 'bluewave', 'tsunami', 'riptide', 'whitewater', 
    'waters', 'mister', 'club', 'quack', 'quick quack', 'take 5', 'go car wash',
    'el car wash', 'mr car wash', 'tommys'
  ];
  
  const hasCompetitorName = competitorTerms.some(term => lowerQuery.includes(term));
  if (hasCompetitorName) return false;
  
  // Focus on generic, actionable opportunities
  const genericTerms = [
    'near me', 'open now', 'membership', 'express', 'touchless', 'hand wash',
    'self wash', 'self service', 'free', 'soap', 'cost', 'price', 'reviews',
    'best', 'quality', 'professional', 'service', 'company', currentYear.toString()
  ];
  
  const hasGenericTerm = genericTerms.some(term => lowerQuery.includes(term));
  const hasBusinessType = lowerQuery.includes(lowerBusinessType);
  
  // Must contain the business type and at least one generic term
  return hasBusinessType && hasGenericTerm;
}

async function generateAIContentIdea(keyword, businessType, businessLocation) {
  try {
    console.log(`🔍 Calling OpenAI API for: ${keyword}`);
    
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
            content: `You are an SEO expert helping a ${businessType} business in ${businessLocation}. Generate specific, actionable content ideas for SEO opportunities. Be concise but detailed.`
          },
          {
            role: 'user',
            content: `Create a specific content strategy for the keyword "${keyword}" for a ${businessType} business in ${businessLocation}. Include: 1) Content type (page, blog post, etc.), 2) Key elements to include, 3) SEO optimization tips, 4) Target audience. Keep it under 150 words.`
          }
        ],
        max_tokens: 200,
        temperature: 0.7
      })
    });

    console.log(`📡 OpenAI API response status: ${response.status}`);
    
    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log(`📝 OpenAI API response:`, data);
    
    const contentIdea = data.choices[0]?.message?.content || `Create content targeting "${keyword}" with local SEO optimization and relevant service information.`;
    console.log(`✅ Generated content idea: ${contentIdea.substring(0, 100)}...`);
    
    return contentIdea;
    
  } catch (error) {
    console.error('AI content generation error:', error);
    console.log('🔄 Falling back to pattern-based content idea');
    // Fallback to basic content idea
    return generateFallbackContentIdea(keyword, businessType, businessLocation);
  }
}

function generateFallbackContentIdea(keyword, businessType, businessLocation) {
  const location = businessLocation?.split(',')[0] || 'your area';
  
  if (keyword.includes('near me')) {
    return `Create a "${businessType} near me" page optimized for local search. Include Google My Business integration, local landmarks, service areas, and customer reviews. Add location schema markup and target "${location}" specifically.`;
  }
  
  if (keyword.includes('membership')) {
    return `Develop a membership program page explaining benefits, pricing tiers, and signup process. Include FAQ section, customer testimonials, and clear value proposition for recurring revenue.`;
  }
  
  if (keyword.includes('express') || keyword.includes('quick')) {
    return `Create a fast service page highlighting speed, efficiency, and convenience. Include time estimates, process overview, and mobile optimization for on-the-go customers.`;
  }
  
  if (keyword.includes('touchless') || keyword.includes('hand wash')) {
    return `Develop a service method page explaining the difference between touchless and hand wash options. Include benefits, process details, and pricing comparison.`;
  }
  
  return `Create comprehensive content targeting "${keyword}" with local SEO optimization, service details, and customer-focused information for ${location}.`;
}

function getCountryCode(businessLocation) {
  // Simple mapping of common locations to country codes
  if (businessLocation && businessLocation.toLowerCase().includes('united states')) return 'US';
  if (businessLocation && businessLocation.toLowerCase().includes('canada')) return 'CA';
  if (businessLocation && businessLocation.toLowerCase().includes('uk')) return 'GB';
  if (businessLocation && businessLocation.toLowerCase().includes('australia')) return 'AU';
  
  // Default to US for most cases
  return 'US';
}
export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

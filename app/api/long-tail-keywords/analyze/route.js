import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

async function handlePOST(req) {
  try {
    const { gscKeywords, businessType, businessLocation, websiteUrl, customBusinessType } = await req.json();

    // Use custom business type if provided, otherwise use the selected business type
    const effectiveBusinessType = (businessType === "Other" && customBusinessType) ? customBusinessType : businessType;

    console.log("🔍 Long-Tail Keywords Analysis starting for:", { 
      gscKeywordsCount: gscKeywords?.length || 0,
      businessType,
      customBusinessType,
      effectiveBusinessType,
      businessLocation 
    });

    if (!gscKeywords || gscKeywords.length === 0) {
      return NextResponse.json({ error: "No GSC keywords provided" }, { status: 400 });
    }

    // Generate long-tail keyword opportunities
    const opportunities = await generateLongTailOpportunities(
      gscKeywords, 
      effectiveBusinessType, 
      businessLocation, 
      websiteUrl
    );

    console.log("🎯 Long-tail opportunities generated:", opportunities.length);

    return NextResponse.json({
      success: true,
      opportunities: opportunities.slice(0, 10), // Return top 10
      totalFound: opportunities.length
    });

  } catch (error) {
    console.error("❌ Long-tail keywords analysis failed:", error);
    return NextResponse.json(
      { error: "Failed to analyze long-tail keywords" },
      { status: 500 }
    );
  }
}


async function generateLongTailOpportunities(gscKeywords, businessType, businessLocation, websiteUrl) {
  const opportunities = [];

  // 1. Service-based long-tail variations
  const serviceOpportunities = generateServiceLongTails(businessType, businessLocation);
  opportunities.push(...serviceOpportunities);

  // 2. Location-based long-tail variations
  const locationOpportunities = generateLocationLongTails(businessType, businessLocation);
  opportunities.push(...locationOpportunities);

  // 3. Problem/solution based long-tails
  const problemOpportunities = generateProblemLongTails(businessType, businessLocation);
  opportunities.push(...problemOpportunities);

  // 4. Comparison-based long-tails
  const comparisonOpportunities = generateComparisonLongTails(businessType, businessLocation);
  opportunities.push(...comparisonOpportunities);

  // 5. Time-based long-tails
  const timeOpportunities = generateTimeBasedLongTails(businessType, businessLocation);
  opportunities.push(...timeOpportunities);

  // 6. AI-powered suggestions based on existing keywords
  const aiOpportunities = await generateAILongTails(gscKeywords, businessType, businessLocation);
  opportunities.push(...aiOpportunities);

  // Remove duplicates and filter out existing keywords
  const existingKeywords = gscKeywords.map(kw => kw.keyword.toLowerCase());
  const uniqueOpportunities = opportunities.filter(opp => 
    !existingKeywords.includes(opp.keyword.toLowerCase())
  );

  // Sort by priority and estimated value
  return uniqueOpportunities
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 20); // Return top 20
}

function generateServiceLongTails(businessType, businessLocation) {
  const serviceMap = {
    "Car Wash": [
      "car wash with free vacuum",
      "hand wash car wash services",
      "touchless car wash near me",
      "eco-friendly car wash",
      "car wash with interior cleaning",
      "mobile car wash services",
      "car wash membership benefits",
      "car wash waxing services"
    ],
    "Restaurant": [
      "restaurant with outdoor seating",
      "family-friendly restaurant near me",
      "restaurant with live music",
      "restaurant with private dining",
      "restaurant with delivery service",
      "restaurant with happy hour",
      "restaurant with gluten-free options"
    ],
    "Dentist": [
      "dentist that accepts insurance",
      "emergency dentist near me",
      "dentist with evening hours",
      "pediatric dentist near me",
      "dentist with sedation options",
      "cosmetic dentist near me",
      "dentist with payment plans"
    ],
    "Other": [
      "best [businessType] near me",
      "[businessType] with free consultation",
      "affordable [businessType] services",
      "[businessType] with same-day service"
    ]
  };

  const services = serviceMap[businessType] || serviceMap["Other"];
  const location = businessLocation.split(',')[0]; // Get city name

  return services.map(service => ({
    keyword: service.replace('[businessType]', businessType.toLowerCase()),
    description: `Service-specific long-tail: "${service}"`,
    type: 'service_based',
    priority: 7,
    estimatedVolume: 'Medium',
    difficulty: 'Low',
    contentIdea: `Create a dedicated page about ${service} in ${location}. Include pricing, process, and benefits.`
  }));
}

function generateLocationLongTails(businessType, businessLocation) {
  const location = businessLocation.split(',')[0];
  const state = businessLocation.split(',')[1]?.trim() || '';
  
  const locationVariations = [
    `best ${businessType.toLowerCase()} in ${location}`,
    `${businessType.toLowerCase()} near ${location} ${state}`,
    `${businessType.toLowerCase()} ${location} hours`,
    `${businessType.toLowerCase()} ${location} reviews`,
    `${businessType.toLowerCase()} ${location} phone number`,
    `${businessType.toLowerCase()} ${location} address`,
    `${businessType.toLowerCase()} ${location} prices`,
    `${businessType.toLowerCase()} ${location} coupons`
  ];

  return locationVariations.map(keyword => ({
    keyword,
    description: `Location-based long-tail: "${keyword}"`,
    type: 'location_based',
    priority: 8,
    estimatedVolume: 'High',
    difficulty: 'Medium',
    contentIdea: `Optimize your Google My Business listing and create location-specific content for ${location}.`
  }));
}

function generateProblemLongTails(businessType, businessLocation) {
  const problemMap = {
    "Car Wash": [
      "car wash that removes bird poop",
      "car wash for dirty cars",
      "car wash that doesn't scratch paint",
      "car wash for white cars",
      "car wash for black cars",
      "car wash for luxury cars"
    ],
    "Restaurant": [
      "restaurant for large groups",
      "restaurant for business meetings",
      "restaurant for date night",
      "restaurant for kids birthday party",
      "restaurant for dietary restrictions"
    ],
    "Dentist": [
      "dentist for dental anxiety",
      "dentist for children",
      "dentist for seniors",
      "dentist for cosmetic work",
      "dentist for emergency care"
    ]
  };

  const problems = problemMap[businessType] || [];
  
  return problems.map(keyword => ({
    keyword,
    description: `Problem-solving long-tail: "${keyword}"`,
    type: 'problem_based',
    priority: 6,
    estimatedVolume: 'Medium',
    difficulty: 'Low',
    contentIdea: `Create content addressing this specific problem and how your ${businessType.toLowerCase()} solves it.`
  }));
}

function generateComparisonLongTails(businessType, businessLocation) {
  const comparisons = [
    `${businessType.toLowerCase()} vs diy`,
    `${businessType.toLowerCase()} vs competitors`,
    `best ${businessType.toLowerCase()} vs worst`,
    `${businessType.toLowerCase()} cost comparison`,
    `${businessType.toLowerCase()} quality comparison`
  ];

  return comparisons.map(keyword => ({
    keyword,
    description: `Comparison long-tail: "${keyword}"`,
    type: 'comparison_based',
    priority: 5,
    estimatedVolume: 'Low',
    difficulty: 'Medium',
    contentIdea: `Create comparison content showing why your ${businessType.toLowerCase()} is the best choice.`
  }));
}

function generateTimeBasedLongTails(businessType, businessLocation) {
  const timeVariations = [
    `${businessType.toLowerCase()} open now`,
    `${businessType.toLowerCase()} weekend hours`,
    `${businessType.toLowerCase()} holiday hours`,
    `${businessType.toLowerCase()} early morning`,
    `${businessType.toLowerCase()} late night`,
    `${businessType.toLowerCase()} same day service`
  ];

  return timeVariations.map(keyword => ({
    keyword,
    description: `Time-based long-tail: "${keyword}"`,
    type: 'time_based',
    priority: 6,
    estimatedVolume: 'Medium',
    difficulty: 'Low',
    contentIdea: `Create content about your hours and availability, and ensure your Google My Business hours are accurate.`
  }));
}

async function generateAILongTails(gscKeywords, businessType, businessLocation) {
  try {
    // Get top performing keywords to base suggestions on
    const topKeywords = gscKeywords
      .filter(kw => kw.clicks > 0)
      .sort((a, b) => b.clicks - a.clicks)
      .slice(0, 5)
      .map(kw => kw.keyword);

    if (topKeywords.length === 0) {
      return [];
    }

    const prompt = `You are an SEO expert. Generate 5 specific long-tail keyword variations for a ${businessType} business in ${businessLocation}.

Base these on these existing keywords: ${topKeywords.join(', ')}

Generate long-tail keywords that:
- Are 3+ words long
- Include location or service specifics
- Have commercial intent
- Are easier to rank for than the base keywords
- Include modifiers like "best", "near me", "with", "for", "that", etc.

Return only the keywords, one per line, no explanations.`;

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
        temperature: 0.7
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const aiKeywords = data.choices[0].message.content
      .split('\n')
      .map(kw => kw.trim())
      .filter(kw => kw.length > 0)
      .slice(0, 5);

    return aiKeywords.map(keyword => ({
      keyword,
      description: `AI-generated long-tail: "${keyword}"`,
      type: 'ai_generated',
      priority: 9,
      estimatedVolume: 'Medium',
      difficulty: 'Low',
      contentIdea: `Create targeted content for "${keyword}" with local SEO optimization.`
    }));

  } catch (error) {
    console.error("❌ AI long-tail generation failed:", error);
    return [];
  }
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

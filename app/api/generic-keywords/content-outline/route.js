import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";

// Helper to detect page type from URL and content
const detectPageType = (page) => {
  const url = (page.pageUrl || "").toLowerCase();
  const title = (page.title || "").toLowerCase();
  const description = (page.metaDescription || "").toLowerCase();
  
  const patterns = {
    about: ['about', 'about-us', 'who-we-are', 'our-story', 'team', 'about me'],
    services: ['services', 'service', 'what-we-do', 'offerings', 'solutions'],
    contact: ['contact', 'contact-us', 'get-in-touch', 'reach-us'],
    blog: ['blog', 'post', 'article', 'news', '/blog/', '/posts/'],
    portfolio: ['portfolio', 'work', 'projects', 'case-studies', 'my work'],
    pricing: ['pricing', 'plans', 'packages', 'cost', 'price', 'rates'],
    home: ['', '/', 'home', 'index'],
    testimonials: ['testimonials', 'reviews', 'testimonial'],
    faq: ['faq', 'frequently-asked', 'questions'],
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
      
      if (urlMatch || titleMatch || descMatch) {
        return type;
      }
    }
  } catch {
    for (const [type, keywords] of Object.entries(patterns)) {
      const titleMatch = keywords.some(keyword => title.includes(keyword));
      const descMatch = keywords.some(keyword => description.includes(keyword));
      
      if (titleMatch || descMatch) {
        return type;
      }
    }
  }
  
  return 'other';
};

// Build a structured page index from cached pages
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
  
  return index;
};

// Format page index for AI prompt
const formatPageIndexForPrompt = (pageIndex, websiteUrl) => {
  if (Object.keys(pageIndex).length === 0) return null;
  
  const sections = [];
  
  // Priority order for page types
  const typeLabels = {
    home: 'Homepage',
    services: 'Service Pages',
    about: 'About Page',
    contact: 'Contact Page',
    portfolio: 'Portfolio/Work Pages',
    blog: 'Blog Posts',
    pricing: 'Pricing Page',
    testimonials: 'Testimonials/Reviews Page',
    faq: 'FAQ Page',
    other: 'Other Pages'
  };
  
  for (const [type, label] of Object.entries(typeLabels)) {
    const pages = pageIndex[type];
    if (!pages || pages.length === 0) continue;
    
    sections.push(
      `**${label}:**\n` +
      pages.map((p, i) => `  - "${p.title}" → ${p.url}`).join('\n')
    );
  }
  
  return sections.join('\n\n');
};

// Fetch user's cached pages from Firestore
const getCachedSitePages = async (userId) => {
  if (!userId) return [];
  
  try {
    const { getCachedSitePages: getCachedPages } = await import("../../../lib/firestoreMigrationHelpers");
    const pages = await getCachedPages(userId, {
      source: "site-crawl",
      limit: 50,
      useAdminSDK: true
    });

    // Sort by nav links first, then by crawl order
    pages.sort((a, b) => {
      const navScore = (b.isNavLink ? 1 : 0) - (a.isNavLink ? 1 : 0);
      if (navScore !== 0) return navScore;

      const orderA = typeof a.crawlOrder === "number" ? a.crawlOrder : Number.MAX_SAFE_INTEGER;
      const orderB = typeof b.crawlOrder === "number" ? b.crawlOrder : Number.MAX_SAFE_INTEGER;
      return orderA - orderB;
    });

    return pages;
  } catch (error) {
    console.error("Failed to fetch cached site pages:", error);
    return [];
  }
};

async function handlePOST(req) {
  try {
    const { keyword, pageType, businessType, businessLocation, businessName, websiteUrl, userId } = await req.json();

    if (!keyword) {
      return NextResponse.json({ error: "Keyword is required" }, { status: 400 });
    }

    // Fetch user's existing pages if userId is provided
    let existingPages = [];
    let pageIndex = {};
    let formattedPageIndex = null;
    
    if (userId) {
      console.log(`📄 Fetching cached pages for user ${userId}...`);
      existingPages = await getCachedSitePages(userId);
      console.log(`✅ Found ${existingPages.length} cached pages`);
      
      if (existingPages.length > 0) {
        pageIndex = buildPageIndex(existingPages);
        formattedPageIndex = formatPageIndexForPrompt(pageIndex, websiteUrl);
        console.log(`📋 Built page index with ${Object.keys(pageIndex).length} categories`);
      }
    }

    const outline = await generateContentOutline(
      keyword, 
      pageType, 
      businessType, 
      businessLocation, 
      businessName, 
      websiteUrl,
      formattedPageIndex,
      pageIndex
    );

    return NextResponse.json({
      success: true,
      keyword,
      pageType,
      outline
    });

  } catch (error) {
    console.error("Error generating content outline:", error);
    return NextResponse.json({ error: "Failed to generate content outline" }, { status: 500 });
  }
}

async function generateContentOutline(keyword, pageType, businessType, businessLocation, businessName, websiteUrl, formattedPageIndex, pageIndex) {
  try {
    const companyName = businessName || 'Your Company';
    
    // Build the existing pages section for the prompt
    const existingPagesSection = formattedPageIndex ? `

**IMPORTANT - User's Existing Website Pages:**
The user already has these pages on their website. Use ACTUAL URLs when suggesting CTAs and internal links:

${formattedPageIndex}

**CTA and Internal Link Rules:**
1. For CTAs - Suggest linking to existing pages with their ACTUAL URLs (e.g., "Contact Us → ${pageIndex.contact?.[0]?.url || '/contact'}")
2. For internal links - Reference ACTUAL existing pages by URL
3. If a contact page exists, use it for "Get Quote" or "Contact Us" CTAs
4. If a services page exists, link to it when mentioning other services
5. If an about page exists, suggest linking to build trust
6. Be specific - don't say "link to contact page", say "link to ${pageIndex.contact?.[0]?.url || '/contact'}"
` : '';
    
    const prompt = `Generate a complete SEO-optimized content outline for a ${pageType || 'service page'} targeting:

Keyword: "${keyword}"
Location: ${businessLocation}
Business Type: ${businessType}
Business Name: ${companyName}
${websiteUrl ? `Website: ${websiteUrl}` : ''}
${existingPagesSection}

Create a detailed, actionable outline that a small business owner can follow to create content that ranks.

Include:
1. H1 (main title) - Include the keyword naturally
2. Meta Title (60 chars max) - Optimized for clicks, include "${companyName}" as the brand
3. Meta Description (155 chars max) - Compelling with keyword
4. H2 sections (4-6 main sections) with brief descriptions of what to cover
5. Optional H3s under each H2 where helpful
6. CTA placements - Where to add calls-to-action WITH SPECIFIC DESTINATION URLs from the existing pages above
7. Schema markup suggestions (LocalBusiness, FAQ, etc.)
8. Internal linking suggestions - Use ACTUAL URLs from the existing pages listed above
9. Word count recommendation

Return ONLY valid JSON in this exact format:
{
  "h1": "Main Page Title Here",
  "metaTitle": "Meta Title Under 60 Characters | ${companyName}",
  "metaDescription": "Compelling description under 155 characters that includes the keyword and encourages clicks.",
  "sections": [
    {
      "h2": "Section Heading",
      "description": "What to cover in this section",
      "h3s": ["Optional subheading 1", "Optional subheading 2"],
      "ctaPlacement": true,
      "ctaText": "Get Your Free Quote",
      "ctaDestination": "/contact (or actual URL from existing pages)"
    }
  ],
  "schema": ["LocalBusiness", "FAQ"],
  "internalLinks": [
    {"text": "our services", "url": "/services", "context": "Link when mentioning related services"},
    {"text": "contact us", "url": "/contact", "context": "Link for inquiries"}
  ],
  "wordCount": "800-1200 words",
  "additionalTips": ["Tip 1", "Tip 2"]
}

IMPORTANT: For "internalLinks" and "ctaDestination", use the ACTUAL URLs from the existing pages I provided above. Be specific!`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4-turbo',
        messages: [
          {
            role: 'system',
            content: `You are an expert SEO content strategist who creates detailed, actionable content outlines for small businesses. Your outlines help business owners create high-quality, ranking content without needing SEO expertise.

CRITICAL: When the user provides their existing website pages, you MUST use those ACTUAL URLs for all CTA destinations and internal link suggestions. Never use generic placeholders like "Link to contact page" - instead use the actual URL like "${pageIndex?.contact?.[0]?.url || 'https://example.com/contact'}".`
          },
          { role: 'user', content: prompt }
        ],
        max_tokens: 2000,
        temperature: 0.6
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
    console.error("Content outline generation error:", error);
    // Return a fallback outline with actual page URLs if available
    return generateFallbackOutline(keyword, pageType, businessType, businessLocation, businessName, pageIndex);
  }
}

function generateFallbackOutline(keyword, pageType, businessType, businessLocation, businessName, pageIndex = {}) {
  const location = businessLocation?.split(',')[0]?.trim() || 'Your Area';
  const companyName = businessName || 'Your Company';
  
  // Use actual URLs from pageIndex if available
  const contactUrl = pageIndex.contact?.[0]?.url || '/contact';
  const servicesUrl = pageIndex.services?.[0]?.url || '/services';
  const aboutUrl = pageIndex.about?.[0]?.url || '/about';
  const homeUrl = pageIndex.home?.[0]?.url || '/';
  
  return {
    h1: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} in ${location}`,
    metaTitle: `${keyword.charAt(0).toUpperCase() + keyword.slice(1)} | ${companyName}`,
    metaDescription: `Looking for ${keyword} in ${location}? ${companyName} offers professional ${businessType} services. Contact us today for a free quote!`,
    sections: [
      {
        h2: `Why Choose Our ${keyword} Services`,
        description: "Explain your unique value proposition and what sets you apart from competitors.",
        h3s: ["Our Experience", "Quality Guarantee", "Customer-First Approach"],
        ctaPlacement: true,
        ctaText: "Get Your Free Quote",
        ctaDestination: contactUrl
      },
      {
        h2: `Our ${keyword} Process`,
        description: "Walk customers through how you deliver this service step by step.",
        h3s: ["Step 1: Initial Consultation", "Step 2: Service Delivery", "Step 3: Follow-up"],
        ctaPlacement: false
      },
      {
        h2: `${keyword} Pricing`,
        description: "Be transparent about costs or provide a range. Include what's included.",
        h3s: [],
        ctaPlacement: true,
        ctaText: "Request a Quote",
        ctaDestination: contactUrl
      },
      {
        h2: `Serving ${location} and Surrounding Areas`,
        description: "Highlight your service area and local expertise.",
        h3s: [],
        ctaPlacement: false
      },
      {
        h2: "Frequently Asked Questions",
        description: "Answer 3-5 common questions about this service.",
        h3s: [],
        ctaPlacement: false
      },
      {
        h2: "Get Started Today",
        description: "Strong call-to-action with contact information and next steps.",
        h3s: [],
        ctaPlacement: true,
        ctaText: "Contact Us Now",
        ctaDestination: contactUrl
      }
    ],
    schema: ["LocalBusiness", "Service", "FAQ"],
    internalLinks: [
      { text: "our services", url: servicesUrl, context: "Link when mentioning your service offerings" },
      { text: "contact us", url: contactUrl, context: "Link for inquiries and quotes" },
      { text: "about us", url: aboutUrl, context: "Link to build trust and credibility" },
      { text: "home", url: homeUrl, context: "Link back to main page" }
    ],
    wordCount: "800-1200 words",
    additionalTips: [
      `Include the keyword "${keyword}" naturally 3-5 times throughout the content`,
      "Add high-quality images with alt text containing the keyword",
      "Include your business phone number and address prominently",
      "Add customer testimonials or reviews if available",
      "Make sure the page loads quickly on mobile devices"
    ]
  };
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

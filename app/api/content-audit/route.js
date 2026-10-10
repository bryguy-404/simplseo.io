import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
async function handlePOST(req) {
  try {
    const { pageUrl, pageContent, title, metaDescription, headings } = await req.json();

    if (!pageUrl || !pageContent) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    console.log(`🔍 Starting content audit for: ${pageUrl}`);

    // Content Quality Analysis
    const contentAnalysis = await analyzeContentQuality(pageContent, title, metaDescription, headings);
    
    // Generate AI improvement suggestions
    const aiSuggestions = await generateContentSuggestions(pageUrl, pageContent, title, metaDescription, headings, contentAnalysis);

    const auditResult = {
      pageUrl,
      contentScore: contentAnalysis.overallScore,
      analysis: contentAnalysis,
      suggestions: aiSuggestions,
      timestamp: new Date().toISOString()
    };

    console.log(`✅ Content audit completed for ${pageUrl}, score: ${contentAnalysis.overallScore}/100`);

    return Response.json(auditResult);

  } catch (error) {
    console.error("❌ Content audit error:", error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

async function analyzeContentQuality(pageContent, title, metaDescription, headings) {
  const analysis = {
    contentLength: {
      score: 0,
      value: pageContent.length,
      target: 1000,
      status: 'poor'
    },
    readability: {
      score: 0,
      value: calculateReadability(pageContent),
      target: 60,
      status: 'poor'
    },
    headingStructure: {
      score: 0,
      value: analyzeHeadingStructure(headings),
      status: 'poor'
    },
    titleOptimization: {
      score: 0,
      value: analyzeTitle(title),
      status: 'poor'
    },
    metaDescription: {
      score: 0,
      value: analyzeMetaDescription(metaDescription),
      status: 'poor'
    },
    contentStructure: {
      score: 0,
      value: analyzeContentStructure(pageContent, headings),
      status: 'poor'
    }
  };

  // Score content length (0-100)
  if (pageContent.length >= 2000) {
    analysis.contentLength.score = 100;
    analysis.contentLength.status = 'excellent';
  } else if (pageContent.length >= 1000) {
    analysis.contentLength.score = 80;
    analysis.contentLength.status = 'good';
  } else if (pageContent.length >= 500) {
    analysis.contentLength.score = 60;
    analysis.contentLength.status = 'fair';
  } else if (pageContent.length >= 200) {
    analysis.contentLength.score = 40;
    analysis.contentLength.status = 'poor';
  } else {
    analysis.contentLength.score = 20;
    analysis.contentLength.status = 'very_poor';
  }

  // Score readability (0-100)
  const readability = analysis.readability.value;
  if (readability >= 80) {
    analysis.readability.score = 100;
    analysis.readability.status = 'excellent';
  } else if (readability >= 60) {
    analysis.readability.score = 80;
    analysis.readability.status = 'good';
  } else if (readability >= 40) {
    analysis.readability.score = 60;
    analysis.readability.status = 'fair';
  } else {
    analysis.readability.score = 40;
    analysis.readability.status = 'poor';
  }

  // Score heading structure (0-100)
  const headingAnalysis = analysis.headingStructure.value;
  if (headingAnalysis.hasH1 && headingAnalysis.h1Count === 1 && headingAnalysis.totalHeadings >= 3) {
    analysis.headingStructure.score = 100;
    analysis.headingStructure.status = 'excellent';
  } else if (headingAnalysis.hasH1 && headingAnalysis.totalHeadings >= 2) {
    analysis.headingStructure.score = 80;
    analysis.headingStructure.status = 'good';
  } else if (headingAnalysis.hasH1) {
    analysis.headingStructure.score = 60;
    analysis.headingStructure.status = 'fair';
  } else {
    analysis.headingStructure.score = 30;
    analysis.headingStructure.status = 'poor';
  }

  // Score title optimization (0-100)
  const titleAnalysis = analysis.titleOptimization.value;
  if (titleAnalysis.length >= 30 && titleAnalysis.length <= 60 && titleAnalysis.hasKeywords) {
    analysis.titleOptimization.score = 100;
    analysis.titleOptimization.status = 'excellent';
  } else if (titleAnalysis.length >= 20 && titleAnalysis.length <= 70) {
    analysis.titleOptimization.score = 80;
    analysis.titleOptimization.status = 'good';
  } else if (titleAnalysis.length >= 10) {
    analysis.titleOptimization.score = 60;
    analysis.titleOptimization.status = 'fair';
  } else {
    analysis.titleOptimization.score = 30;
    analysis.titleOptimization.status = 'poor';
  }

  // Score meta description (0-100)
  const metaAnalysis = analysis.metaDescription.value;
  if (metaAnalysis.length >= 120 && metaAnalysis.length <= 160 && metaAnalysis.hasKeywords) {
    analysis.metaDescription.score = 100;
    analysis.metaDescription.status = 'excellent';
  } else if (metaAnalysis.length >= 100 && metaAnalysis.length <= 180) {
    analysis.metaDescription.score = 80;
    analysis.metaDescription.status = 'good';
  } else if (metaAnalysis.length >= 50) {
    analysis.metaDescription.score = 60;
    analysis.metaDescription.status = 'fair';
  } else {
    analysis.metaDescription.score = 30;
    analysis.metaDescription.status = 'poor';
  }

  // Score content structure (0-100)
  const structureAnalysis = analysis.contentStructure.value;
  if (structureAnalysis.hasIntroduction && structureAnalysis.hasConclusion && structureAnalysis.paragraphCount >= 5) {
    analysis.contentStructure.score = 100;
    analysis.contentStructure.status = 'excellent';
  } else if (structureAnalysis.hasIntroduction && structureAnalysis.paragraphCount >= 3) {
    analysis.contentStructure.score = 80;
    analysis.contentStructure.status = 'good';
  } else if (structureAnalysis.paragraphCount >= 2) {
    analysis.contentStructure.score = 60;
    analysis.contentStructure.status = 'fair';
  } else {
    analysis.contentStructure.score = 40;
    analysis.contentStructure.status = 'poor';
  }

  // Calculate overall score
  const scores = [
    analysis.contentLength.score,
    analysis.readability.score,
    analysis.headingStructure.score,
    analysis.titleOptimization.score,
    analysis.metaDescription.score,
    analysis.contentStructure.score
  ];

  analysis.overallScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);

  return analysis;
}

function calculateReadability(text) {
  // Simple Flesch-Kincaid readability score
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const syllables = text.toLowerCase().replace(/[^a-z]/g, '').split('').filter(char => 'aeiou'.includes(char)).length;
  
  if (sentences === 0 || words === 0) return 0;
  
  const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
  return Math.max(0, Math.min(100, score));
}

function analyzeHeadingStructure(headings) {
  // Handle both old format (plain strings) and new format (objects with tag/text)
  const normalizedHeadings = headings.map(h => {
    if (typeof h === 'string') {
      // Old format - assume H2 for plain strings (conservative estimate)
      return { tag: 'h2', text: h };
    }
    return h;
  });
  
  const h1Count = normalizedHeadings.filter(h => h.tag === 'h1').length;
  const h2Count = normalizedHeadings.filter(h => h.tag === 'h2').length;
  const h3Count = normalizedHeadings.filter(h => h.tag === 'h3').length;
  
  return {
    hasH1: h1Count > 0,
    h1Count,
    h2Count,
    h3Count,
    totalHeadings: normalizedHeadings.length,
    structure: normalizedHeadings.map(h => h.tag).join(' → ')
  };
}

function analyzeTitle(title) {
  return {
    length: title.length,
    hasKeywords: title.length > 0, // Simplified - could be enhanced with keyword detection
    wordCount: title.split(/\s+/).length
  };
}

function analyzeMetaDescription(metaDescription) {
  return {
    length: metaDescription.length,
    hasKeywords: metaDescription.length > 0, // Simplified - could be enhanced
    wordCount: metaDescription.split(/\s+/).length
  };
}

function analyzeContentStructure(content, headings) {
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  
  // Simple detection of introduction and conclusion
  const hasIntroduction = paragraphs.length > 0 && paragraphs[0].length > 50;
  const hasConclusion = paragraphs.length > 1 && paragraphs[paragraphs.length - 1].length > 30;
  
  return {
    paragraphCount: paragraphs.length,
    sentenceCount: sentences.length,
    hasIntroduction,
    hasConclusion,
    averageParagraphLength: paragraphs.length > 0 ? Math.round(content.length / paragraphs.length) : 0
  };
}

async function generateContentSuggestions(pageUrl, pageContent, title, metaDescription, headings, analysis) {
  try {
    // Generate AI suggestions based on analysis
    const suggestions = [];
    
    // Content length suggestions
    if (analysis.contentLength.score < 80) {
      suggestions.push({
        priority: 'high',
        category: 'content_length',
        title: 'Expand Content',
        description: `Your content is ${pageContent.length} characters. Aim for at least 1,000 words (${1000 * 5} characters) for better SEO performance.`,
        action: 'Add more detailed sections, examples, and comprehensive information.'
      });
    }
    
    // Readability suggestions
    if (analysis.readability.score < 80) {
      suggestions.push({
        priority: 'medium',
        category: 'readability',
        title: 'Improve Readability',
        description: `Your readability score is ${analysis.readability.value.toFixed(1)}. Aim for 60+ for better user engagement.`,
        action: 'Use shorter sentences, simpler words, and break up long paragraphs.'
      });
    }
    
    // Heading structure suggestions
    if (analysis.headingStructure.score < 80) {
      suggestions.push({
        priority: 'high',
        category: 'headings',
        title: 'Optimize Heading Structure',
        description: analysis.headingStructure.value.hasH1 
          ? 'Add more subheadings (H2, H3) to improve content organization.'
          : 'Add a main H1 heading and organize content with H2 and H3 subheadings.',
        action: 'Create a clear hierarchy: H1 for main topic, H2 for sections, H3 for subsections.'
      });
    }
    
    // Title optimization suggestions
    if (analysis.titleOptimization.score < 80) {
      suggestions.push({
        priority: 'high',
        category: 'title',
        title: 'Optimize Page Title',
        description: `Your title is ${title.length} characters. Aim for 30-60 characters for optimal display in search results.`,
        action: 'Include primary keywords and make it compelling for clicks.'
      });
    }
    
    // Meta description suggestions
    if (analysis.metaDescription.score < 80) {
      suggestions.push({
        priority: 'medium',
        category: 'meta_description',
        title: 'Improve Meta Description',
        description: `Your meta description is ${metaDescription.length} characters. Aim for 120-160 characters.`,
        action: 'Include keywords and create a compelling summary that encourages clicks.'
      });
    }
    
    // Content structure suggestions
    if (analysis.contentStructure.score < 80) {
      suggestions.push({
        priority: 'medium',
        category: 'structure',
        title: 'Improve Content Structure',
        description: 'Add clear introduction and conclusion sections.',
        action: 'Start with an engaging introduction and end with a strong conclusion that summarizes key points.'
      });
    }
    
    return suggestions;
    
  } catch (error) {
    console.error('Error generating suggestions:', error);
    return [];
  }
}

export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

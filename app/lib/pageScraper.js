
import { authenticatedFetch } from './authenticatedFetch';
/**
 * Reusable page scraping utility for SEO analysis
 * Used by both Intent Mismatch and Content Audit features
 */

export const scrapePageContent = async (pageUrl) => {
  try {
    console.log(`🔍 Scraping content for: ${pageUrl}`);
    
    const scrapeResponse = await authenticatedFetch("/api/scrape-content", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ pageUrl }),
    });

    if (!scrapeResponse.ok) {
      throw new Error(`Failed to scrape ${pageUrl}: ${scrapeResponse.status}`);
    }

    const scrapeData = await scrapeResponse.json();
    
    console.log(`✅ Scraped content for ${pageUrl}:`, {
      titleLength: scrapeData.data.title?.length || 0,
      contentLength: scrapeData.data.textContent?.length || 0,
      hasHeadings: scrapeData.data.headings?.length > 0
    });

    return {
      success: true,
      data: scrapeData.data,
      pageUrl
    };
  } catch (error) {
    console.error(`❌ Error scraping ${pageUrl}:`, error);
    return {
      success: false,
      error: error.message,
      pageUrl
    };
  }
};

/**
 * Get cached page content from Firestore (backward-compatible)
 * Uses new subcollection structure with fallback to old flat structure
 */
export const getCachedPageContent = async (userId, pageUrl) => {
  const { getCachedPageContent: getCached } = await import("./clientContentCache");
  return await getCached(userId, pageUrl);
};

/**
 * Cache page content in Firestore (backward-compatible)
 * Writes to both new subcollection and old flat structure
 */
export const cachePageContent = async (userId, pageUrl, contentData) => {
  const { cachePageContent: cacheContent } = await import("./clientContentCache");
  return await cacheContent(userId, pageUrl, contentData);
};

/**
 * Get or scrape page content with caching
 */
export const getPageContent = async (userId, pageUrl, forceRefresh = false) => {
  // Try to get cached content first (unless force refresh)
  if (!forceRefresh) {
    const cached = await getCachedPageContent(userId, pageUrl);
    if (cached.success) {
      return cached;
    }
  }
  
  // Scrape fresh content
  const scraped = await scrapePageContent(pageUrl);
  if (scraped.success) {
    // Cache the fresh content
    await cachePageContent(userId, pageUrl, scraped.data);
  }
  
  return scraped;
};

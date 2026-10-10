import { scrapeContentResponse } from '../../lib/server/scrapeContent';
import { authenticatedRoute } from '../../lib/server/authenticatedRoute';


import { NextResponse } from "next/server";
import { db } from "../../lib/firebaseAdmin";

const SCRAPE_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

/**
 * Re-crawl a single page to get fresh content
 * Used when pivoting to a new keyword to ensure AI suggestions use current page content
 */
async function handlePOST(request) {
  try {
    const { userId, pageUrl } = await request.json();

    if (!userId || !pageUrl) {
      return NextResponse.json(
        { error: "userId and pageUrl are required" },
        { status: 400 }
      );
    }

    // Normalize URL to match stored format (remove trailing slash)
    const normalizedUrl = pageUrl.replace(/\/$/, '');
    console.log(`🔄 Re-crawling page for pivot: ${normalizedUrl}`);

    // Scrape the page content (use normalized URL)
    const scrapeRes = await scrapeContentResponse(normalizedUrl);

    if (!scrapeRes.ok) {
      const errorText = await scrapeRes.text();
      console.error(`❌ Scrape failed: ${scrapeRes.status}`, errorText);
      return NextResponse.json(
        { error: `Failed to scrape page: ${scrapeRes.status}` },
        { status: 500 }
      );
    }

    const scrapeJson = await scrapeRes.json();
    if (!scrapeJson?.data) {
      return NextResponse.json(
        { error: "No data returned from scrape" },
        { status: 500 }
      );
    }

    // Save to pageContentCache using the migration helper (use normalized URL to match existing doc)
    const { cachePageContent } = await import("../../lib/firestoreMigrationHelpers");
    await cachePageContent(userId, normalizedUrl, {
      ...scrapeJson.data,
      source: "pivot-recrawl",
      isNavLink: false,
      crawlOrder: null,
      crawlTags: ["pivot", "recrawled"],
      recrawledAt: new Date().toISOString(),
      recrawlReason: "keyword-pivot",
    });

    console.log(`✅ Page re-crawled successfully: ${normalizedUrl}`);
    console.log(`   - Title: ${scrapeJson.data.title}`);
    console.log(`   - H1: ${scrapeJson.data.headings?.[0] || 'N/A'}`);

    return NextResponse.json({
      success: true,
      message: "Page content updated successfully",
      pageUrl: normalizedUrl,
      title: scrapeJson.data.title,
      headings: scrapeJson.data.headings || [],
      metaDescription: scrapeJson.data.metaDescription,
      recrawledAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Failed to re-crawl page:", error);
    return NextResponse.json(
      { error: "Failed to re-crawl page", details: error.message },
      { status: 500 }
    );
  }
}

export const POST = authenticatedRoute(handlePOST);

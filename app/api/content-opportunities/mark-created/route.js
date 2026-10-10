import { scrapeContentResponse } from '../../../lib/server/scrapeContent';
import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

const SCRAPE_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

async function handlePOST(req) {
  try {
    const { userId, keyword, pageUrl, opportunityId } = await req.json();

    // Validation
    if (!userId || !keyword || !pageUrl) {
      return NextResponse.json(
        { error: "userId, keyword, and pageUrl are required" },
        { status: 400 }
      );
    }

    // Validate URL format
    let normalizedUrl;
    try {
      const url = new URL(pageUrl);
      normalizedUrl = url.href;
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid URL format" },
        { status: 400 }
      );
    }

    // Generate opportunity ID if not provided
    const oppId = opportunityId || `${userId}_${keyword.toLowerCase().replace(/\s+/g, '-')}_${Date.now()}`;

    // Store in Firestore
    const createdOpportunity = {
      keyword: keyword.trim(),
      pageUrl: normalizedUrl,
      createdAt: new Date().toISOString(),
      status: "created",
      firstRankedAt: null, // Will be set when detected in GSC
      userId: userId,
    };

    // First, ensure the parent document exists with data so it appears in queries
    // (Without this, Firestore creates a "virtual" document that doesn't show in .get() queries)
    await db
      .collection("createdContentOpportunities")
      .doc(userId)
      .set({ userId, updatedAt: new Date().toISOString() }, { merge: true });

    // Then save the actual opportunity in the subcollection
    await db
      .collection("createdContentOpportunities")
      .doc(userId)
      .collection("created")
      .doc(oppId)
      .set(createdOpportunity, { merge: true });

    console.log(`✅ Created opportunity marked: ${oppId} for ${userId}`);

    // Auto-crawl the new page and add to pageContentCache
    // This allows AI chatbots to know about the new page content
    let pageCrawled = false;
    try {
      console.log(`🔍 Auto-crawling new page: ${normalizedUrl}`);
      
      const scrapeRes = await scrapeContentResponse(normalizedUrl);

      if (scrapeRes.ok) {
        const scrapeJson = await scrapeRes.json();
        
        if (scrapeJson?.data) {
          // Save to pageContentCache so chatbots can access it
          const { cachePageContent } = await import("../../../lib/firestoreMigrationHelpers");
          await cachePageContent(userId, normalizedUrl, {
            ...scrapeJson.data,
            source: "ai-created",  // Mark as AI-created page
            isNavLink: false,
            crawlOrder: null,
            createdFromKeyword: keyword.trim(),  // Track which keyword it was created for
          });
          
          pageCrawled = true;
          console.log(`✅ New AI-created page cached: ${normalizedUrl}`);
        }
      } else {
        console.warn(`⚠️ Failed to scrape new page (status ${scrapeRes.status}): ${normalizedUrl}`);
      }
    } catch (crawlError) {
      // Don't fail the whole operation if crawling fails
      // The page might not be live yet
      console.warn(`⚠️ Could not auto-crawl new page: ${crawlError.message}`);
    }

    return NextResponse.json({
      success: true,
      opportunityId: oppId,
      message: "Opportunity marked as created",
      pageCrawled: pageCrawled,
      crawlNote: pageCrawled 
        ? "Page content has been added to your website data for AI chatbots." 
        : "Page could not be crawled yet. It may not be live. AI chatbots will learn about it once it's indexed.",
    });
  } catch (error) {
    console.error("❌ Error marking opportunity as created:", error);
    return NextResponse.json(
      { error: "Failed to mark opportunity as created", details: error.message },
      { status: 500 }
    );
  }
}

// GET endpoint to fetch created opportunities
async function handleGET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const snapshot = await db
      .collection("createdContentOpportunities")
      .doc(userId)
      .collection("created")
      .get();

    const opportunities = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({
      success: true,
      opportunities: opportunities,
    });
  } catch (error) {
    console.error("❌ Error fetching created opportunities:", error);
    return NextResponse.json(
      { error: "Failed to fetch created opportunities", details: error.message },
      { status: 500 }
    );
  }
}


export const POST = authenticatedRoute(handlePOST);
export const GET = authenticatedRoute(handleGET);

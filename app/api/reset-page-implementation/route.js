import { scrapeContentResponse } from '../../lib/server/scrapeContent';
import { authenticatedRoute } from '../../lib/server/authenticatedRoute';


import { NextResponse } from "next/server";
import { db } from "../../lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

// Helper function to create safe document IDs (same as client-side)
const createSafeDocId = (userId, pageUrl) => {
  let hash = 0;
  for (let i = 0; i < pageUrl.length; i++) {
    const char = pageUrl.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const urlHash = Math.abs(hash).toString(36);
  return `${userId}_${urlHash}`;
};

/**
 * Reset a page's implementation status so it can be re-implemented with a new keyword
 * Preserves the old keyword's stats in keywordStatsHistory
 */
async function handlePOST(request) {
  try {
    const { userId, pageUrl, currentKeyword, keywordSource } = await request.json();

    if (!userId || !pageUrl) {
      return NextResponse.json(
        { error: "userId and pageUrl are required" },
        { status: 400 }
      );
    }

    // Try multiple URL formats to find the document
    const urlVariants = [
      pageUrl,
      pageUrl.endsWith('/') ? pageUrl.slice(0, -1) : pageUrl + '/',
      pageUrl.replace(/^https?:\/\//, 'https://'),
      pageUrl.replace(/^https?:\/\//, 'http://'),
    ];

    let docRef = null;
    let docSnap = null;
    let matchedUrl = null;

    console.log("🔍 Searching for document with userId:", userId);
    console.log("🔍 Page URL:", pageUrl);

    // Try each URL variant
    for (const url of urlVariants) {
      const docId = createSafeDocId(userId, url);
      console.log("🔍 Trying docId:", docId, "for URL:", url);
      const ref = db.collection("implementedSeoTips").doc(docId);
      const snap = await ref.get();
      if (snap.exists && snap.data().userId === userId) {
        console.log("✅ Found document by docId!");
        docRef = ref;
        docSnap = snap;
        matchedUrl = url;
        break;
      }
    }

    // If still not found, search by userId and pageUrl field
    if (!docSnap) {
      console.log("🔍 Searching by userId query...");
      const querySnapshot = await db.collection("implementedSeoTips")
        .where("userId", "==", userId)
        .get();
      
      console.log("🔍 Found", querySnapshot.docs.length, "documents for user");
      
      for (const doc of querySnapshot.docs) {
        const data = doc.data();
        const storedUrl = data.pageUrl?.toLowerCase().replace(/\/$/, '');
        const searchUrl = pageUrl.toLowerCase().replace(/\/$/, '');
        
        console.log("🔍 Checking stored URL:", storedUrl);
        
        if (storedUrl && (storedUrl === searchUrl)) {
          console.log("✅ Found document by query!");
          docRef = doc.ref;
          docSnap = doc;
          matchedUrl = data.pageUrl;
          break;
        }
      }
    }

    if (!docSnap) {
      return NextResponse.json(
        { error: "No implementation record found for this page. Tried multiple URL formats.", userId, pageUrl },
        { status: 404 }
      );
    }

    // Handle both regular DocumentSnapshot and QueryDocumentSnapshot
    const currentData = typeof docSnap.data === 'function' ? docSnap.data() : docSnap;
    console.log("Found document for URL:", matchedUrl);

    if (currentData.preRevampArchived === true) return NextResponse.json({ error: 'Previous website work is read-only. Start a new recommendation for this page.' }, { status: 409 });
    
    // Build the keyword stats history - preserve metrics from current keyword
    const keywordStatsHistory = currentData.keywordStatsHistory || [];
    
    // If we have stats from the current keyword, save them to history before resetting
    if (currentData.preStats && currentData.implementedAt) {
      const daysTracked = Math.floor(
        (Date.now() - new Date(currentData.implementedAt).getTime()) / (1000 * 60 * 60 * 24)
      );
      
      keywordStatsHistory.push({
        keyword: currentKeyword || "Unknown keyword",
        source: keywordSource || "gsc-existing",
        implementedAt: currentData.implementedAt,
        pivotedAt: new Date().toISOString(),
        preStats: currentData.preStats,
        postStats: currentData.postStats || null,
        postStatsHistory: currentData.postStatsHistory || [],
        daysTracked: daysTracked,
      });
    }

    // Reset the implementation status and delete progress fields
    // But preserve keywordStatsHistory
    await docRef.update({
      status: "pivoted",
      pivotedAt: new Date().toISOString(),
      keywordStatsHistory: keywordStatsHistory, // Preserve old keyword stats
      preStats: FieldValue.delete(),
      postStats: FieldValue.delete(),
      postStatsHistory: FieldValue.delete(),
      implementedAt: FieldValue.delete(),
      nextUpdateDue: FieldValue.delete(),
    });

    // Re-crawl the page to get fresh content
    let recrawled = false;
    try {
      const SCRAPE_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";
      
      // Normalize URL to match the stored format (remove trailing slash)
      const urlToRecrawl = (matchedUrl || pageUrl).replace(/\/$/, '');
      console.log("🔄 Re-crawling page with normalized URL:", urlToRecrawl);
      
      const scrapeRes = await scrapeContentResponse(urlToRecrawl);

      if (scrapeRes.ok) {
        const scrapeJson = await scrapeRes.json();
        if (scrapeJson?.data) {
          const { cachePageContent } = await import("../../lib/firestoreMigrationHelpers");
          
          // Cache with normalized URL (no trailing slash) to match existing document
          await cachePageContent(userId, urlToRecrawl, {
            ...scrapeJson.data,
            source: "pivot-recrawl",
            isNavLink: false,
            crawlOrder: null,
            crawlTags: ["pivot", "recrawled", "manual-reset"],
            recrawledAt: new Date().toISOString(),
            recrawlReason: "manual-reset",
          });
          recrawled = true;
          console.log("✅ Page re-crawled on reset:", urlToRecrawl);
        }
      }
    } catch (recrawlError) {
      console.warn("⚠️ Could not re-crawl page on reset:", recrawlError.message);
    }

    return NextResponse.json({
      success: true,
      message: `Page "${matchedUrl || pageUrl}" has been reset. Old keyword stats preserved in history. You can now implement it with the new keyword.`,
      previousStatus: currentData.status,
      newStatus: "pivoted",
      preservedHistory: keywordStatsHistory.length,
      pageRecrawled: recrawled,
    });
  } catch (error) {
    console.error("Failed to reset page implementation:", error);
    return NextResponse.json(
      { error: "Failed to reset page", details: error.message },
      { status: 500 }
    );
  }
}

export const POST = authenticatedRoute(handlePOST);

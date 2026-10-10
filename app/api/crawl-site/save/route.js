import { scrapeContentResponse } from '../../../lib/server/scrapeContent';
import { requireUser, errorResponse } from "../../../lib/server/requestAuth";
import { NextResponse } from "next/server";
import { db, admin } from "../../../lib/firebaseAdmin";

const SCRAPE_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

const sanitizeUrlArray = (value = []) => {
  if (!Array.isArray(value)) return [];
  const sanitized = value
    .filter((url) => typeof url === "string" && url.trim().length > 0)
    .map((url) => url.trim());
  return Array.from(new Set(sanitized));
};

export async function POST(req) {
  try {
    const {
      userId,
      approvedUrls = [],
      excludedUrls = [],
      manualUrls = [],
    } = await req.json();
    await requireUser(req, userId);

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const crawlDocRef = db.collection("siteCrawls").doc(userId);
    const crawlSnap = await crawlDocRef.get();

    if (!crawlSnap.exists) {
      return NextResponse.json(
        { error: "No crawl data found" },
        { status: 404 }
      );
    }

    const crawlData = crawlSnap.data();
    const pendingPages = Array.isArray(crawlData?.pendingPages)
      ? crawlData.pendingPages
      : [];

    const sanitizedApproved = sanitizeUrlArray(approvedUrls);
    const sanitizedExcluded = sanitizeUrlArray(excludedUrls);
    const sanitizedManual = sanitizeUrlArray(manualUrls);

    // Create a set of approved URLs for quick lookup
    const approvedSet = new Set(sanitizedApproved);
    const excludedSet = new Set(sanitizedExcluded);

    // Allow the operation if:
    // 1. There are pending pages to save, OR
    // 2. There are manual URLs to process, OR
    // 3. There are excluded URLs to remove (user is removing pages)
    const hasManualUrls = sanitizedManual.length > 0;
    const hasExcludedUrls = excludedSet.size > 0;
    
    if (pendingPages.length === 0 && !hasManualUrls && !hasExcludedUrls) {
      return NextResponse.json(
        { error: "No pending pages, manual URLs, or pages to remove" },
        { status: 400 }
      );
    }

    // Filter pending pages to only include approved ones
    const pagesToSave = pendingPages.filter(
      (page) =>
        page?.pageUrl &&
        approvedSet.has(page.pageUrl) &&
        !excludedSet.has(page.pageUrl)
    );

    // Handle new manual URLs that weren't in the initial crawl
    const existingPageUrls = new Set(pagesToSave.map((p) => p.pageUrl));
    const newManualUrls = sanitizedManual.filter(
      (url) => !existingPageUrls.has(url) && !excludedSet.has(url)
    );

    // Convert new manual URLs to page objects for processing
    for (const url of newManualUrls) {
      pagesToSave.push({
        pageUrl: url,
        tags: ["manual", "Added"],
        isNavLink: false,
        crawlOrder: null,
      });
    }

    // If pagesToSave is empty but we have approved URLs, fetch existing pages from cache
    // This handles the case where user is saving after initial crawl (pendingPages is deleted)
    if (pagesToSave.length === 0 && approvedSet.size > 0) {
      const { getCachedSitePages } = await import("../../../lib/firestoreMigrationHelpers");
      const existingCachedPages = await getCachedSitePages(userId, {
        source: "site-crawl",
        limit: 1000,
        useAdminSDK: true
      });
      
      // Add approved pages that aren't excluded to pagesToSave
      existingCachedPages.forEach((cachedPage) => {
        if (cachedPage.pageUrl && approvedSet.has(cachedPage.pageUrl) && !excludedSet.has(cachedPage.pageUrl)) {
          pagesToSave.push({
            pageUrl: cachedPage.pageUrl,
            tags: Array.isArray(cachedPage.crawlTags) ? cachedPage.crawlTags : [],
            isNavLink: !!cachedPage.isNavLink,
            crawlOrder: cachedPage.crawlOrder || null,
          });
        }
      });
      
      // Also add approved URLs that aren't in cache yet (shouldn't happen, but just in case)
      approvedSet.forEach((url) => {
        if (!excludedSet.has(url) && !pagesToSave.some(p => p.pageUrl === url)) {
          pagesToSave.push({
            pageUrl: url,
            tags: [],
            isNavLink: false,
            crawlOrder: null,
          });
        }
      });
    }

    // Allow operation even if no pages to save, as long as we're removing pages
    // This handles the case where user just wants to remove unchecked pages
    if (pagesToSave.length === 0 && !hasExcludedUrls) {
      return NextResponse.json(
        { error: "No approved pages to save" },
        { status: 400 }
      );
    }

    const errors = [];
    let savedCount = 0;

    // Scrape and save each approved page (only if there are pages to save)
    if (pagesToSave.length > 0) {
      for (const page of pagesToSave) {
      try {
        const { pageUrl, tags = [], isNavLink = false, crawlOrder = null } =
          page;

        // Scrape the page content
        const scrapeRes = await scrapeContentResponse(pageUrl);

        if (!scrapeRes.ok) {
          throw new Error(`Scrape failed with status ${scrapeRes.status}`);
        }

        const scrapeJson = await scrapeRes.json();
        if (!scrapeJson?.data) {
          throw new Error("No data returned from scrape endpoint");
        }

        const cachedAt = new Date().toISOString();
        const tagList = Array.isArray(tags) ? tags : [];

        // Save to pageContentCache using backward-compatible helper (writes to both structures)
        const { cachePageContent } = await import("../../../lib/firestoreMigrationHelpers");
        await cachePageContent(userId, pageUrl, {
          ...scrapeJson.data,
          source: "site-crawl",
          isNavLink: !!isNavLink,
          crawlOrder,
          crawlTags: tagList,
        });

        savedCount += 1;
      } catch (error) {
        console.warn(`⚠️ Failed to save page ${page.pageUrl}:`, error.message);
        errors.push({ url: page.pageUrl, message: error.message });
      }
    }
    }

    // Remove any pages from pageContentCache that are excluded (check both structures)
    if (excludedSet.size > 0) {
      // Delete from NEW structure: pageContentCache/{userId}/pages
      try {
        const newSnapshot = await db
          .collection("pageContentCache")
          .doc(userId)
          .collection("pages")
          .where("source", "==", "site-crawl")
          .get();

        for (const docSnap of newSnapshot.docs) {
          const data = docSnap.data();
          if (data?.pageUrl && excludedSet.has(data.pageUrl)) {
            await docSnap.ref.delete();
          }
        }
      } catch (error) {
        console.log("New structure deletion failed, trying old structure...");
      }

      // Also delete from OLD structure: pageContentCache (flat)
      try {
        const oldSnapshot = await db
          .collection("pageContentCache")
          .where("userId", "==", userId)
          .where("source", "==", "site-crawl")
          .get();

        for (const docSnap of oldSnapshot.docs) {
          const data = docSnap.data();
          if (data?.pageUrl && excludedSet.has(data.pageUrl)) {
            await docSnap.ref.delete();
          }
        }
      } catch (error) {
        console.error("Error deleting from old structure:", error);
      }
    }

    // Update crawl document with preferences and mark as completed
    await crawlDocRef.set(
      {
        status: errors.length > 0 ? "completed-with-errors" : "completed",
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastRun: admin.firestore.FieldValue.serverTimestamp(),
        approvedUrls: sanitizedApproved,
        excludedUrls: Array.from(excludedSet),
        manualUrls: sanitizedManual,
        pendingPages: admin.firestore.FieldValue.delete(),
        pendingGeneratedAt: admin.firestore.FieldValue.delete(),
      },
      { merge: true }
    );

    // Update onboarding document
    await db.collection("onboarding").doc(userId).set(
      {
        siteCrawlStatus:
          errors.length > 0 ? "completed-with-errors" : "completed",
        lastSiteCrawlAt: new Date().toISOString(),
      },
      { merge: true }
    );

    const removedCount = excludedSet.size;
    
    return NextResponse.json({
      success: true,
      saved: savedCount,
      removed: removedCount,
      errors,
      total: pagesToSave.length,
    });
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("❌ Failed to save pages:", error);
    return NextResponse.json(
      { error: "Failed to save pages", details: error.message },
      { status: 500 }
    );
  }
}


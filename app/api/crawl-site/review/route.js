import { requireUser, errorResponse } from "../../../lib/server/requestAuth";
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

const sanitizeUrlArray = (value = []) => {
  if (!Array.isArray(value)) return [];
  const sanitized = value
    .filter((url) => typeof url === "string" && url.trim().length > 0)
    .map((url) => url.trim());
  return Array.from(new Set(sanitized));
};

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = await requireUser(req, searchParams.get("userId"));

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const crawlDocRef = db.collection("siteCrawls").doc(userId);
    const crawlSnap = await crawlDocRef.get();
    const crawlData = crawlSnap.exists ? crawlSnap.data() : {};

    const approvedUrls = sanitizeUrlArray(crawlData?.approvedUrls);
    const excludedUrls = sanitizeUrlArray(crawlData?.excludedUrls);
    const manualUrls = sanitizeUrlArray(crawlData?.manualUrls);

    const excludedSet = new Set(excludedUrls);

    let pages = [];
    let requiresReview = false;

    if (
      crawlData?.status === "awaiting-review" &&
      Array.isArray(crawlData?.pendingPages) &&
      crawlData.pendingPages.length > 0
    ) {
      requiresReview = true;
      pages = crawlData.pendingPages
        .map((page) => {
          if (!page?.pageUrl) return null;
          const kept = page.kept !== false && !excludedSet.has(page.pageUrl);
          return {
            pageUrl: page.pageUrl,
            title:
              page?.title ||
              page.pageUrl.replace(/^https?:\/\//, ""),
            isNavLink: !!page?.isNavLink,
            crawlOrder:
              typeof page?.crawlOrder === "number" ? page.crawlOrder : null,
            kept,
            lastUpdated: page?.cachedAt || null,
            tags: Array.isArray(page?.tags) ? page.tags : [],
          };
        })
        .filter(Boolean)
        .sort((a, b) => {
          if (a.crawlOrder === null && b.crawlOrder === null) return 0;
          if (a.crawlOrder === null) return 1;
          if (b.crawlOrder === null) return -1;
          return a.crawlOrder - b.crawlOrder;
        });
    } else {
      // Use backward-compatible helper to get pages from both structures
      const { getCachedSitePages } = await import("../../../lib/firestoreMigrationHelpers");
      const cachedPages = await getCachedSitePages(userId, {
        source: "site-crawl",
        limit: 1000,
        useAdminSDK: true
      });

      // Create a map of cached pages by URL for quick lookup
      const cachedPagesMap = new Map();
      cachedPages.forEach((page) => {
        if (page.pageUrl) {
          cachedPagesMap.set(page.pageUrl, page);
        }
      });

      // Start with cached pages
      pages = cachedPages
        .map((data) => {
          const pageUrl = data?.pageUrl;
          if (!pageUrl) return null;

          const title =
            data?.title ||
            data?.metaTitle ||
            data?.meta?.title ||
            pageUrl.replace(/^https?:\/\//, "");

          return {
            pageUrl,
            title,
            isNavLink: !!data?.isNavLink,
            crawlOrder:
              typeof data?.crawlOrder === "number" ? data.crawlOrder : null,
            kept: !excludedSet.has(pageUrl),
            lastUpdated: data?.cachedAt || null,
            tags: Array.isArray(data?.crawlTags) ? data.crawlTags : [],
          };
        })
        .filter(Boolean);

      // Add approved URLs that aren't in cached pages (fallback)
      // This ensures approved pages show up even if they're not in pageContentCache yet
      approvedUrls.forEach((url) => {
        if (!excludedSet.has(url) && !cachedPagesMap.has(url)) {
          pages.push({
            pageUrl: url,
            title: url.replace(/^https?:\/\//, ""),
            isNavLink: false,
            crawlOrder: null,
            kept: true,
            lastUpdated: null,
            tags: [],
          });
        }
      });

      // Sort pages
      pages.sort((a, b) => {
        if (a.crawlOrder === null && b.crawlOrder === null) return 0;
        if (a.crawlOrder === null) return 1;
        if (b.crawlOrder === null) return -1;
        return a.crawlOrder - b.crawlOrder;
      });
    }

    return NextResponse.json({
      pages,
      status: crawlData?.status || null,
      lastRun: crawlData?.lastRun || crawlData?.completedAt || null,
      lastReviewedAt: crawlData?.lastReviewedAt || null,
      requiresReview,
      preferences: {
        approvedUrls,
        excludedUrls,
        manualUrls,
      },
    });
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("❌ Failed to load crawl review data:", error);
    return NextResponse.json(
      { error: "Failed to load crawl review data" },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const { userId, approvedUrls = [], excludedUrls = [], manualUrls = [] } =
      await req.json();
    await requireUser(req, userId);

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const sanitizedApproved = sanitizeUrlArray(approvedUrls);
    const sanitizedExcluded = sanitizeUrlArray(excludedUrls);
    const sanitizedManual = sanitizeUrlArray(manualUrls);

    const crawlDocRef = db.collection("siteCrawls").doc(userId);
    await crawlDocRef.set(
      {
        approvedUrls: sanitizedApproved,
        excludedUrls: sanitizedExcluded,
        manualUrls: sanitizedManual,
        lastReviewedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    return NextResponse.json({
      success: true,
      preferences: {
        approvedUrls: sanitizedApproved,
        excludedUrls: sanitizedExcluded,
        manualUrls: sanitizedManual,
      },
    });
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("❌ Failed to save crawl review preferences:", error);
    return NextResponse.json(
      { error: "Failed to save crawl preferences" },
      { status: 500 }
    );
  }
}



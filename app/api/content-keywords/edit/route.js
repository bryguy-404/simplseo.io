import { scrapeContentResponse } from '../../../lib/server/scrapeContent';
import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

const RATE_LIMIT_HOURS = 24; // 24 hours between edits

/**
 * Check if user can make edits (rate limiting)
 */
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

    const editHistoryRef = db.collection("contentKeywordEdits").doc(userId);
    const editHistorySnap = await editHistoryRef.get();

    if (!editHistorySnap.exists) {
      // No previous edits, allow editing
      return NextResponse.json({
        canEdit: true,
        lastEditAt: null,
        hoursUntilNextEdit: 0,
      });
    }

    const editHistory = editHistorySnap.data();
    const lastEditAt = editHistory.lastEditAt;

    if (!lastEditAt) {
      return NextResponse.json({
        canEdit: true,
        lastEditAt: null,
        hoursUntilNextEdit: 0,
      });
    }

    const lastEditTime = new Date(lastEditAt).getTime();
    const now = Date.now();
    const hoursSinceLastEdit = (now - lastEditTime) / (1000 * 60 * 60);
    const hoursUntilNextEdit = Math.max(0, RATE_LIMIT_HOURS - hoursSinceLastEdit);

    return NextResponse.json({
      canEdit: hoursSinceLastEdit >= RATE_LIMIT_HOURS,
      lastEditAt,
      hoursUntilNextEdit: Math.ceil(hoursUntilNextEdit),
      hoursSinceLastEdit: Math.floor(hoursSinceLastEdit),
    });
  } catch (error) {
    console.error("Failed to check edit rate limit:", error);
    return NextResponse.json(
      { error: "Failed to check rate limit" },
      { status: 500 }
    );
  }
}

/**
 * Save content/keywords edits with rate limiting
 */
async function handlePOST(req) {
  try {
    const {
      userId,
      pagesToRemove = [],
      pagesToAdd = [],
      keywordsToRemove = [],
      keywordsToAdd = [],
      snapshot = null, // Updated snapshot from Settings
    } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Check rate limiting
    const editHistoryRef = db.collection("contentKeywordEdits").doc(userId);
    const editHistorySnap = await editHistoryRef.get();

    if (editHistorySnap.exists) {
      const editHistory = editHistorySnap.data();
      const lastEditAt = editHistory.lastEditAt;

      if (lastEditAt) {
        const lastEditTime = new Date(lastEditAt).getTime();
        const now = Date.now();
        const hoursSinceLastEdit = (now - lastEditTime) / (1000 * 60 * 60);

        if (hoursSinceLastEdit < RATE_LIMIT_HOURS) {
          const hoursUntilNextEdit = Math.ceil(
            RATE_LIMIT_HOURS - hoursSinceLastEdit
          );
          return NextResponse.json(
            {
              error: "Rate limit exceeded",
              message: `You can make edits again in ${hoursUntilNextEdit} hour${hoursUntilNextEdit !== 1 ? "s" : ""}.`,
              hoursUntilNextEdit,
            },
            { status: 429 }
          );
        }
      }
    }

    // Validate that there are changes
    const hasPageChanges = pagesToRemove.length > 0 || pagesToAdd.length > 0;
    const hasKeywordChanges = keywordsToRemove.length > 0 || keywordsToAdd.length > 0;

    if (!hasPageChanges && !hasKeywordChanges) {
      return NextResponse.json(
        { error: "No changes to save" },
        { status: 400 }
      );
    }

    const changes = {
      pagesRemoved: pagesToRemove.length,
      pagesAdded: pagesToAdd.length,
      keywordsRemoved: keywordsToRemove.length,
      keywordsAdded: keywordsToAdd.length,
    };

    // Handle page changes
    if (hasPageChanges) {
      // Get current crawl preferences
      const crawlDocRef = db.collection("siteCrawls").doc(userId);
      const crawlSnap = await crawlDocRef.get();
      const crawlData = crawlSnap.exists ? crawlSnap.data() : {};

      const currentApproved = Array.isArray(crawlData.approvedUrls)
        ? crawlData.approvedUrls
        : [];
      const currentExcluded = Array.isArray(crawlData.excludedUrls)
        ? crawlData.excludedUrls
        : [];
      const currentManual = Array.isArray(crawlData.manualUrls)
        ? crawlData.manualUrls
        : [];

      // Remove pages
      const approvedSet = new Set(currentApproved);
      const excludedSet = new Set(currentExcluded);
      const manualSet = new Set(currentManual);

      pagesToRemove.forEach((url) => {
        approvedSet.delete(url);
        manualSet.delete(url);
        excludedSet.add(url);
      });

      // Add pages
      pagesToAdd.forEach((url) => {
        excludedSet.delete(url);
        approvedSet.add(url);
        manualSet.add(url); // Add to manual URLs
      });

      // Update crawl preferences
      await crawlDocRef.set(
        {
          approvedUrls: Array.from(approvedSet),
          excludedUrls: Array.from(excludedSet),
          manualUrls: Array.from(manualSet),
          lastReviewedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // If pages are being removed, delete them from pageContentCache
      if (pagesToRemove.length > 0) {
        const { getCachedSitePages } = await import("../../../lib/firestoreMigrationHelpers");
        const cachedPages = await getCachedSitePages(userId, {
          source: "site-crawl",
          limit: 1000,
          useAdminSDK: true,
        });

        const pagesToRemoveSet = new Set(pagesToRemove);

        // Delete from NEW structure
        try {
          const newSnapshot = await db
            .collection("pageContentCache")
            .doc(userId)
            .collection("pages")
            .where("source", "==", "site-crawl")
            .get();

          for (const docSnap of newSnapshot.docs) {
            const data = docSnap.data();
            if (data?.pageUrl && pagesToRemoveSet.has(data.pageUrl)) {
              await docSnap.ref.delete();
            }
          }
        } catch (error) {
          console.error("Error deleting from new structure:", error);
        }

        // Delete from OLD structure
        try {
          const oldSnapshot = await db
            .collection("pageContentCache")
            .where("userId", "==", userId)
            .where("source", "==", "site-crawl")
            .get();

          for (const docSnap of oldSnapshot.docs) {
            const data = docSnap.data();
            if (data?.pageUrl && pagesToRemoveSet.has(data.pageUrl)) {
              await docSnap.ref.delete();
            }
          }
        } catch (error) {
          console.error("Error deleting from old structure:", error);
        }
      }

      // If pages are being added, scrape and cache them
      if (pagesToAdd.length > 0) {
        const SCRAPE_BASE_URL =
          process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

        for (const url of pagesToAdd) {
          try {
            const scrapeRes = await scrapeContentResponse(url);

            if (scrapeRes.ok) {
              const scrapeJson = await scrapeRes.json();
              if (scrapeJson?.data) {
                const { cachePageContent } = await import("../../../lib/firestoreMigrationHelpers");
                await cachePageContent(userId, url, {
                  ...scrapeJson.data,
                  source: "site-crawl",
                  isNavLink: false,
                  crawlOrder: null,
                  crawlTags: ["manual", "Added"],
                });
              }
            }
          } catch (error) {
            console.error(`Failed to scrape page ${url}:`, error);
            // Continue with other pages even if one fails
          }
        }
      }
    }

    // Handle keyword changes
    if (hasKeywordChanges) {
      const focusKeywordsRef = db.collection("focusKeywords").doc(userId);
      const focusKeywordsSnap = await focusKeywordsRef.get();

      let currentKeywords = [];
      if (focusKeywordsSnap.exists) {
        const data = focusKeywordsSnap.data();
        currentKeywords = Array.isArray(data.keywords) ? data.keywords : [];
      }

      // Create a map for quick lookup
      const keywordMap = new Map();
      currentKeywords.forEach((kw) => {
        if (kw && typeof kw === "object" && kw.keyword) {
          keywordMap.set(kw.keyword.toLowerCase(), kw);
        } else if (typeof kw === "string") {
          keywordMap.set(kw.toLowerCase(), {
            keyword: kw,
            pageUrl: null,
            source: "gsc-existing",
          });
        }
      });

      // Remove keywords
      keywordsToRemove.forEach((keyword) => {
        keywordMap.delete(keyword.toLowerCase());
      });

      // Add keywords
      keywordsToAdd.forEach((entry) => {
        const keyword =
          typeof entry === "string"
            ? entry.trim()
            : entry?.keyword?.trim();
        if (keyword) {
          const pageUrl =
            typeof entry === "object" && entry.pageUrl
              ? entry.pageUrl.trim()
              : null;
          const source =
            typeof entry === "object" && entry.source === "ai-generated"
              ? "ai-generated"
              : "gsc-existing";

          keywordMap.set(keyword.toLowerCase(), {
            keyword,
            pageUrl: pageUrl || null,
            source,
          });
        }
      });

      const updateData = {
        userId,
        keywords: Array.from(keywordMap.values()),
        updatedAt: new Date().toISOString(),
      };

      // Update snapshot if provided (from Settings save)
      if (snapshot && typeof snapshot === 'object') {
        updateData.snapshot = {
          ...snapshot,
          savedAt: new Date().toISOString(),
        };
      }

      // Save updated keywords
      await focusKeywordsRef.set(updateData, { merge: true });
    }

    // Update edit history
    const editHistory = {
      lastEditAt: new Date().toISOString(),
      changes,
      editCount: editHistorySnap.exists
        ? (editHistorySnap.data().editCount || 0) + 1
        : 1,
    };

    // Store edit history
    await editHistoryRef.set(editHistory, { merge: true });

    return NextResponse.json({
      success: true,
      changes,
      message: "Changes saved successfully",
    });
  } catch (error) {
    console.error("Failed to save content/keywords edits:", error);
    return NextResponse.json(
      { error: "Failed to save changes", details: error.message },
      { status: 500 }
    );
  }
}


export const GET = authenticatedRoute(handleGET);
export const POST = authenticatedRoute(handlePOST);

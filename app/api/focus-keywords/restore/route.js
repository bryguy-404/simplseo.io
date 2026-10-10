import { requireUser, errorResponse, RequestError } from "../../../lib/server/requestAuth";
import { ensureCurrentHistory } from "../../../lib/server/revampHistory";

import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

/**
 * Restore focus keywords from the saved snapshot
 * This is used to recover keywords that were accidentally wiped
 */
export async function POST(request) {
  try {
    const { userId: requestedUid } = await request.json();
    const userId = await requireUser(request, requestedUid);
    await ensureCurrentHistory(userId);

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Get the current document with snapshot
    const docRef = await db.collection("focusKeywords").doc(userId).get();
    
    if (!docRef.exists) {
      return NextResponse.json(
        { error: "No focus keywords document found for this user" },
        { status: 404 }
      );
    }

    const data = docRef.data();
    if (data.preRevampArchived) throw new RequestError("Previous website keywords remain in read-only history.", 409);
    const snapshot = data.snapshot;

    if (!snapshot) {
      return NextResponse.json(
        { error: "No snapshot found to restore from" },
        { status: 404 }
      );
    }

    // Log what we found in the snapshot for debugging
    console.log("📸 Found snapshot with:");
    console.log("  - groupedByPage entries:", snapshot.groupedByPage?.length || 0);
    console.log("  - gscKeywordsRaw entries:", snapshot.gscKeywordsRaw?.length || 0);
    console.log("  - selectedByPage entries:", snapshot.selectedByPage?.length || 0);

    // Reconstruct keywords from selectedByPage (the actual selections)
    const restoredKeywords = [];
    const addedKeywords = new Set(); // Track what we've added to avoid duplicates

    // Build a map of pageUrl -> source from gscKeywordsRaw
    const sourceMap = new Map();
    if (snapshot.gscKeywordsRaw && Array.isArray(snapshot.gscKeywordsRaw)) {
      snapshot.gscKeywordsRaw.forEach((kw) => {
        if (kw.keyword && kw.page) {
          const key = `${kw.keyword.toLowerCase()}|${kw.page.toLowerCase().replace(/\/$/, '')}`;
          sourceMap.set(key, kw.source || "gsc-existing");
        }
      });
    }

    // Restore from selectedByPage (these are the actual user selections)
    if (snapshot.selectedByPage && Array.isArray(snapshot.selectedByPage)) {
      snapshot.selectedByPage.forEach(({ page, keyword }) => {
        if (!page || !keyword) return;
        
        const normalizedPage = page.toLowerCase().replace(/\/$/, '');
        const key = `${keyword.toLowerCase()}|${normalizedPage}`;
        
        if (addedKeywords.has(key)) return;
        addedKeywords.add(key);

        // Find the source from gscKeywordsRaw
        const source = sourceMap.get(key) || "gsc-existing";

        restoredKeywords.push({
          keyword: keyword,
          pageUrl: page,
          source: source,
        });
      });
    }

    console.log(`🔄 Restoring ${restoredKeywords.length} keywords from snapshot`);
    restoredKeywords.forEach((kw, idx) => {
      console.log(`  ${idx + 1}. "${kw.keyword}" -> ${kw.pageUrl} (${kw.source})`);
    });

    // Update Firestore with restored keywords
    await db
      .collection("focusKeywords")
      .doc(userId)
      .update({
        keywords: restoredKeywords,
        updatedAt: new Date().toISOString(),
        restoredAt: new Date().toISOString(),
        restoredFrom: "snapshot",
      });

    return NextResponse.json({
      success: true,
      message: `Successfully restored ${restoredKeywords.length} keywords from snapshot`,
      keywords: restoredKeywords,
      snapshotDate: snapshot.savedAt || "unknown",
    });
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("Failed to restore focus keywords:", error);
    return NextResponse.json(
      { error: "Failed to restore focus keywords", details: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to preview what will be restored (dry run)
 */
export async function GET(request) {
  try {
  const { searchParams } = new URL(request.url);
  const userId = await requireUser(request, searchParams.get("userId"));

  if (!userId) {
    return NextResponse.json(
      { error: "userId is required" },
      { status: 400 }
    );
  }

  try {
    const docRef = await db.collection("focusKeywords").doc(userId).get();
    
    if (!docRef.exists) {
      return NextResponse.json(
        { error: "No focus keywords document found for this user" },
        { status: 404 }
      );
    }

    const data = docRef.data();
    if (data.preRevampArchived) throw new RequestError("Previous website keywords remain in read-only history.", 409);
    const snapshot = data.snapshot;
    const currentKeywords = data.keywords || [];

    if (!snapshot) {
      return NextResponse.json({
        hasSnapshot: false,
        currentKeywordsCount: currentKeywords.length,
        currentKeywords: currentKeywords,
        message: "No snapshot available to restore from",
      });
    }

    // Preview what would be restored
    const previewKeywords = [];
    const addedKeywords = new Set();

    // Build source map
    const sourceMap = new Map();
    if (snapshot.gscKeywordsRaw && Array.isArray(snapshot.gscKeywordsRaw)) {
      snapshot.gscKeywordsRaw.forEach((kw) => {
        if (kw.keyword && kw.page) {
          const key = `${kw.keyword.toLowerCase()}|${kw.page.toLowerCase().replace(/\/$/, '')}`;
          sourceMap.set(key, kw.source || "gsc-existing");
        }
      });
    }

    if (snapshot.selectedByPage && Array.isArray(snapshot.selectedByPage)) {
      snapshot.selectedByPage.forEach(({ page, keyword }) => {
        if (!page || !keyword) return;
        
        const normalizedPage = page.toLowerCase().replace(/\/$/, '');
        const key = `${keyword.toLowerCase()}|${normalizedPage}`;
        
        if (addedKeywords.has(key)) return;
        addedKeywords.add(key);

        const source = sourceMap.get(key) || "gsc-existing";

        previewKeywords.push({
          keyword: keyword,
          pageUrl: page,
          source: source,
        });
      });
    }

    return NextResponse.json({
      hasSnapshot: true,
      snapshotDate: snapshot.savedAt || "unknown",
      currentKeywordsCount: currentKeywords.length,
      currentKeywords: currentKeywords,
      snapshotKeywordsCount: previewKeywords.length,
      snapshotKeywords: previewKeywords,
      groupedByPageCount: snapshot.groupedByPage?.length || 0,
      gscKeywordsRawCount: snapshot.gscKeywordsRaw?.length || 0,
      selectedByPageCount: snapshot.selectedByPage?.length || 0,
    });
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("Failed to preview restore:", error);
    return NextResponse.json(
      { error: "Failed to preview restore", details: error.message },
      { status: 500 }
    );
  }
  } catch (error) { return errorResponse(error); }
}

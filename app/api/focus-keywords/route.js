import { requireUser, errorResponse } from "../../lib/server/requestAuth";
import { ensureCurrentHistory } from "../../lib/server/revampHistory";

import { NextResponse } from "next/server";
import { db } from "../../lib/firebaseAdmin";

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
      return NextResponse.json({ keywords: [], updatedAt: null });
    }

    const data = docRef.data();
    if (data.preRevampArchived) return NextResponse.json({ keywords: [], updatedAt: data.updatedAt || null, snapshot: null, archived: true });
    const sanitizedKeywords = Array.isArray(data.keywords)
      ? data.keywords
          .map((entry) => {
            if (!entry) return null;
            if (typeof entry === "string") {
              const keyword = entry.trim();
              if (!keyword) return null;
              return { keyword, pageUrl: null, source: "gsc-existing" };
            }
            const keyword =
              typeof entry.keyword === "string" ? entry.keyword.trim() : null;
            if (!keyword) return null;
            const pageUrl =
              typeof entry.pageUrl === "string" && entry.pageUrl.trim().length
                ? entry.pageUrl.trim()
                : null;
            const source = entry.source === "ai-generated" ? "ai-generated" : "gsc-existing";
            return { keyword, pageUrl, source };
          })
          .filter(Boolean)
      : [];

    return NextResponse.json({
      keywords: sanitizedKeywords,
      updatedAt: data.updatedAt || null,
      snapshot: data.snapshot || null, // Include snapshot if available
    });
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("Failed to load focus keywords:", error);
    return NextResponse.json(
      { error: "Failed to load focus keywords" },
      { status: 500 }
    );
  }
  } catch (error) { return errorResponse(error); }
}

export async function POST(request) {
  try {
    const { userId: suppliedUserId, keywords = [], snapshot = null } = await request.json();
    const userId = await requireUser(request, suppliedUserId);
    await ensureCurrentHistory(userId);

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    if (!Array.isArray(keywords)) {
      return NextResponse.json(
        { error: "keywords must be an array" },
        { status: 400 }
      );
    }

    const cleanedKeywordsMap = new Map();
    keywords.forEach((entry) => {
      if (!entry) return;
      if (typeof entry === "string") {
        const keyword = entry.trim();
        if (!keyword) return;
        if (!cleanedKeywordsMap.has(keyword.toLowerCase())) {
          cleanedKeywordsMap.set(keyword.toLowerCase(), {
            keyword,
            pageUrl: null,
            source: "gsc-existing", // Default for backwards compatibility
          });
        }
        return;
      }

      const keyword =
        typeof entry.keyword === "string" ? entry.keyword.trim() : null;
      if (!keyword) return;
      const lower = keyword.toLowerCase();
      if (cleanedKeywordsMap.has(lower)) return;

      const pageUrl =
        typeof entry.pageUrl === "string" && entry.pageUrl.trim().length
          ? entry.pageUrl.trim()
          : null;

      const source = entry.source === "ai-generated" ? "ai-generated" : "gsc-existing";

      cleanedKeywordsMap.set(lower, { keyword, pageUrl, source });
    });

    // No limit - users can select focus keywords for all their pages
    const cleanedKeywords = Array.from(cleanedKeywordsMap.values());

    const updateData = {
      userId,
      preRevampArchived: false,
      keywords: cleanedKeywords,
      updatedAt: new Date().toISOString(),
    };

    // Save snapshot if provided (contains full state of FocusKeywordSelector when submitted)
    if (snapshot && typeof snapshot === 'object') {
      updateData.snapshot = {
        ...snapshot,
        savedAt: new Date().toISOString(),
      };
    }

    await db
      .collection("focusKeywords")
      .doc(userId)
      .set(updateData, { merge: true });

    return NextResponse.json({
      success: true,
      keywords: cleanedKeywords,
    });
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("Failed to save focus keywords:", error);
    return NextResponse.json(
      { error: "Failed to save focus keywords" },
      { status: 500 }
    );
  }
}


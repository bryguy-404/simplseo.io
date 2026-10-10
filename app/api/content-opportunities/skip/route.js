import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

// POST - Mark a keyword as skipped
async function handlePOST(req) {
  try {
    const { userId, keyword } = await req.json();

    if (!userId || !keyword) {
      return NextResponse.json(
        { error: "userId and keyword are required" },
        { status: 400 }
      );
    }

    // Create a document ID from the keyword
    const docId = keyword.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    // Save to Firestore
    await db
      .collection("skippedKeywords")
      .doc(userId)
      .collection("keywords")
      .doc(docId)
      .set({
        keyword: keyword,
        skippedAt: new Date().toISOString(),
        userId: userId,
      });

    return NextResponse.json({
      success: true,
      message: "Keyword marked as skipped",
      keyword: keyword,
    });
  } catch (error) {
    console.error("Error skipping keyword:", error);
    return NextResponse.json(
      { error: "Failed to skip keyword", details: error.message },
      { status: 500 }
    );
  }
}

// GET - Get all skipped keywords for a user
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
      .collection("skippedKeywords")
      .doc(userId)
      .collection("keywords")
      .get();

    const skippedKeywords = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json({
      success: true,
      skippedKeywords: skippedKeywords,
    });
  } catch (error) {
    console.error("Error fetching skipped keywords:", error);
    return NextResponse.json(
      { error: "Failed to fetch skipped keywords", details: error.message },
      { status: 500 }
    );
  }
}

// DELETE - Undo skip (restore a keyword)
async function handleDELETE(req) {
  try {
    const { userId, keyword } = await req.json();

    if (!userId || !keyword) {
      return NextResponse.json(
        { error: "userId and keyword are required" },
        { status: 400 }
      );
    }

    // Create the same document ID
    const docId = keyword.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

    // Delete from Firestore
    await db
      .collection("skippedKeywords")
      .doc(userId)
      .collection("keywords")
      .doc(docId)
      .delete();

    return NextResponse.json({
      success: true,
      message: "Keyword restored",
      keyword: keyword,
    });
  } catch (error) {
    console.error("Error restoring keyword:", error);
    return NextResponse.json(
      { error: "Failed to restore keyword", details: error.message },
      { status: 500 }
    );
  }
}


export const POST = authenticatedRoute(handlePOST);
export const GET = authenticatedRoute(handleGET);
export const DELETE = authenticatedRoute(handleDELETE);

import { NextResponse } from "next/server";
import { detectAndSaveSuccessfulStrategies } from "../../../lib/successDetector";

// POST - Detect and save successful strategies from implementedSeoTips
// This can be called manually or via cron job
export async function POST(req) {
  try {
    const { userId } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: "User ID is required" },
        { status: 400 }
      );
    }

    const result = await detectAndSaveSuccessfulStrategies(userId);

    if (result.success) {
      return NextResponse.json({
        success: true,
        message: `Detected and saved ${result.strategiesSaved} successful strategies`,
        strategiesSaved: result.strategiesSaved,
        strategyIds: result.strategyIds,
      });
    } else {
      return NextResponse.json(
        {
          success: false,
          error: result.error || "Failed to detect successful strategies",
        },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Error detecting successful strategies:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to detect successful strategies",
        details: error.message,
      },
      { status: 500 }
    );
  }
}

// GET - Detect and save successful strategies for all users (admin/cron endpoint)
// This can be called via cron job to process all users
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const secret = searchParams.get("secret");

    // Simple secret check for cron job security
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { db } = await import("../../../lib/firebaseAdmin");

    // Get all users with implemented SEO tips
    const snapshot = await db
      .collection("implementedSeoTips")
      .where("status", "==", "implemented")
      .get();

    // Get unique user IDs (excluding archived revamp data)
    const userIds = new Set();
    snapshot.forEach((doc) => {
      const data = doc.data();
      if (data.userId && !data.preRevampArchived) {
        userIds.add(data.userId);
      }
    });

    const results = [];
    for (const userId of userIds) {
      try {
        const result = await detectAndSaveSuccessfulStrategies(userId);
        results.push({
          userId,
          success: result.success,
          strategiesSaved: result.strategiesSaved || 0,
        });
      } catch (error) {
        results.push({
          userId,
          success: false,
          error: error.message,
        });
      }
    }

    const totalSaved = results.reduce(
      (sum, r) => sum + (r.strategiesSaved || 0),
      0
    );

    return NextResponse.json({
      success: true,
      message: `Processed ${userIds.size} users, saved ${totalSaved} strategies`,
      usersProcessed: userIds.size,
      totalStrategiesSaved: totalSaved,
      results,
    });
  } catch (error) {
    console.error("Error processing all users:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to process users",
        details: error.message,
      },
      { status: 500 }
    );
  }
}


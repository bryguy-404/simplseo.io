// Internal server module; callable only through authenticated routes.

import crypto from "crypto";
import { db } from "./firebaseAdmin";

// Hash user ID for privacy (same as BigQuery)
const hashIdentifier = (value) => {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
};

// Unified logger: writes to Firestore now, easy to migrate to BigQuery later
export const logTrainingEvent = async ({
  userId,
  eventType,
  businessType,
  businessLocation,
  payload,
}) => {
  if (!userId) {
    console.warn("⚠️ Skipping training log - no userId provided");
    return;
  }

  const eventData = {
    event_timestamp: new Date().toISOString(),
    event_type: eventType,
    hashed_user_id: hashIdentifier(userId), // Privacy: hash user ID
    business_type: businessType || null,
    business_location: businessLocation || null,
    payload_json: JSON.stringify(payload ?? {}),
    // Firestore-specific fields (for easy querying, can remove before BigQuery migration)
    userId: userId, // Keep for easy querying
    createdAt: new Date(), // Firestore timestamp
  };

  try {
    // Write to Firestore using subcollection structure
    // trainingEvents/{hashedUserId}/events/{autoId}
    const hashedUserId = hashIdentifier(userId);
    await db
      .collection("trainingEvents")
      .doc(hashedUserId)
      .collection("events")
      .add(eventData);

    // Optional: Also write to BigQuery if configured (for gradual migration)
    // This allows dual-write during migration period
    if (process.env.BIGQUERY_ENABLED === "true") {
      try {
        const { getBigQueryClient } = await import("./bigqueryClient");
        const client = await getBigQueryClient();
        const table = client
          .dataset(process.env.BIGQUERY_DATASET)
          .table(process.env.BIGQUERY_TABLE);
        await table.insert([
          {
            event_timestamp: eventData.event_timestamp,
            event_type: eventData.event_type,
            hashed_user_id: eventData.hashed_user_id,
            business_type: eventData.business_type,
            business_location: eventData.business_location,
            payload_json: eventData.payload_json,
          },
        ]);
      } catch (bqError) {
        console.error("❌ Failed to write to BigQuery (non-critical):", bqError);
        // Don't throw - Firestore write succeeded, BigQuery is optional
      }
    }
  } catch (error) {
    console.error("❌ Failed to log training event to Firestore:", error);
  }
};

const limitArray = (items, keys, limit = 5) => {
  if (!Array.isArray(items) || items.length === 0) return undefined;
  return items.slice(0, limit).map((item) => {
    if (!item || typeof item !== "object") return item;
    return keys.reduce((acc, key) => {
      if (item[key] !== undefined) {
        acc[key] = item[key];
      }
      return acc;
    }, {});
  });
};

export const summarizeSeoContext = async (context = {}) => {
  if (!context || typeof context !== "object") {
    return {};
  }

  return {
    aiTipsCount: Array.isArray(context.aiTips) ? context.aiTips.length : 0,
    gscKeywordsSample: limitArray(
      context.gscKeywords,
      ["keyword", "clicks", "impressions", "position", "ctr"],
      5
    ),
    easyWinsSample: limitArray(
      context.easyWins,
      ["keyword", "position", "clicks", "impressions", "ctr"],
      5
    ),
    lowCtrPagesSample: limitArray(
      context.lowCtrPages,
      ["page", "clicks", "impressions", "ctr"],
      5
    ),
    topPagesSample: limitArray(context.topPages, ["page", "clicks"], 5),
    dateRange: context.dateRange,
  };
};

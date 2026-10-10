"use server";

import { db } from "./firebaseAdmin";
import { savePlaybookStrategy } from "./playbookHelpers";
import crypto from "crypto";

// Hash user ID for privacy
const hashIdentifier = (value) => {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
};

// Extract page path from URL (anonymize)
function anonymizePageUrl(fullUrl) {
  try {
    const url = new URL(fullUrl);
    return url.pathname || "/homepage";
  } catch {
    return "/homepage";
  }
}

// Check implemented tips and extract successful ones
export async function detectAndSaveSuccessfulStrategies(userId) {
  const recovery = (await db.collection("onboarding").doc(userId).get()).data();
  if (recovery?.progressReviewRequired || recovery?.revampStatus === "in-progress") return { saved: 0, paused: true };
  try {
    // Get user's onboarding data for business context
    const onboardingDoc = await db.collection("onboarding").doc(userId).get();
    if (!onboardingDoc.exists) {
      console.log("No onboarding data found for user");
      return { success: false, error: "No onboarding data" };
    }

    const onboarding = onboardingDoc.data();
    if (!onboarding.businessType || !onboarding.businessLocation) {
      console.log("Missing business context in onboarding");
      return { success: false, error: "Missing business context" };
    }

    // Get all implemented tips for this user
    const snapshot = await db
      .collection("implementedSeoTips")
      .where("userId", "==", userId)
      .where("status", "==", "implemented")
      .get();

    const successfulStrategies = [];

    const activeDocs = snapshot.docs.filter((doc) => !doc.data().preRevampArchived);

    for (const doc of activeDocs) {
      const data = doc.data();
      const {
        preStats,
        postStats,
        implementedAt,
        pageUrl,
        title,
        description,
        focusKeywords,
      } = data;

      // Skip if no postStats yet (not measured)
      if (!postStats || !preStats) {
        continue;
      }

      // Skip if less than 7 days old
      const daysSince =
        (Date.now() - new Date(implementedAt).getTime()) /
        (1000 * 60 * 60 * 24);
      if (daysSince < 7) {
        continue;
      }

      // Check if already saved to playbook (prevent duplicates)
      const hashedUserId = hashIdentifier(userId);
      const pagePath = anonymizePageUrl(pageUrl);
      const existingCheck = await db
        .collectionGroup("strategies")
        .where("userId", "==", hashedUserId)
        .where("pagePath", "==", pagePath)
        .where("implementedAt", "==", new Date(implementedAt).toISOString())
        .limit(1)
        .get();

      if (!existingCheck.empty) {
        continue; // Already saved
      }

      // Determine strategy type
      let strategyType = "meta_title_optimization";
      if (description && !title) {
        strategyType = "meta_description_optimization";
      } else if (
        focusKeywords &&
        focusKeywords.length > 0 &&
        !title &&
        !description
      ) {
        strategyType = "keyword_targeting";
      }

      // Save to playbook
      const strategyId = await savePlaybookStrategy(userId, {
        businessType: onboarding.businessType,
        businessLocation: onboarding.businessLocation,
        strategyType,
        pageUrl,
        focusKeywords: focusKeywords || [],
        title: title || null,
        description: description || null,
        preStats,
        postStats,
        implementedAt,
        measuredAt: new Date().toISOString(),
      });

      if (strategyId) {
        successfulStrategies.push(strategyId);
      }
    }

    return {
      success: true,
      strategiesSaved: successfulStrategies.length,
      strategyIds: successfulStrategies,
    };
  } catch (error) {
    console.error("Error detecting successful strategies:", error);
    return {
      success: false,
      error: error.message,
    };
  }
}


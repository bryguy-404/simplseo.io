// Internal server module; callable only through authenticated routes.

import { db } from "./firebaseAdmin";
import crypto from "crypto";

// Hash user ID for privacy
const hashIdentifier = (value) => {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
};

// Calculate success metrics
function calculateSuccessMetrics(preStats, postStats) {
  const clicksIncrease =
    preStats.clicks > 0
      ? ((postStats.clicks - preStats.clicks) / preStats.clicks) * 100
      : postStats.clicks > 0
      ? 100
      : 0;

  const ctrIncrease =
    preStats.ctr > 0
      ? ((postStats.ctr - preStats.ctr) / preStats.ctr) * 100
      : postStats.ctr > 0
      ? 100
      : 0;

  const positionImprovement = preStats.position - postStats.position; // Positive = moved up

  const impressionsIncrease =
    preStats.impressions > 0
      ? ((postStats.impressions - preStats.impressions) /
          preStats.impressions) *
        100
      : postStats.impressions > 0
      ? 100
      : 0;

  // Calculate success score (0-100)
  const successScore = Math.min(
    100,
    Math.max(
      0,
      clicksIncrease * 0.3 +
        ctrIncrease * 0.3 +
        positionImprovement * 2 + // Each position = 2 points
        impressionsIncrease * 0.2
    )
  );

  return {
    clicksIncrease: Math.round(clicksIncrease * 100) / 100,
    ctrIncrease: Math.round(ctrIncrease * 100) / 100,
    positionImprovement: Math.round(positionImprovement * 100) / 100,
    impressionsIncrease: Math.round(impressionsIncrease * 100) / 100,
    successScore: Math.round(successScore * 100) / 100,
  };
}

// Check if strategy meets success criteria
function meetsSuccessCriteria(metrics) {
  return (
    metrics.clicksIncrease >= 20 || // 20%+ increase
    metrics.ctrIncrease >= 10 || // 10%+ increase
    metrics.positionImprovement >= 2 || // 2+ positions up
    metrics.impressionsIncrease >= 25 // 25%+ increase
  );
}

// Extract page path from URL (anonymize)
function anonymizePageUrl(fullUrl) {
  try {
    const url = new URL(fullUrl);
    return url.pathname || "/homepage";
  } catch {
    return "/homepage";
  }
}

// Detect page type from URL
function detectPageType(pageUrl) {
  const path = pageUrl.toLowerCase();
  if (path === "/" || path.includes("home")) return "home";
  if (path.includes("service")) return "services";
  if (path.includes("about")) return "about";
  if (path.includes("contact")) return "contact";
  if (path.includes("blog") || path.includes("article")) return "blog";
  if (path.includes("product")) return "products";
  return "other";
}

// Save successful strategy to playbook
export async function savePlaybookStrategy(userId, strategyData) {
  const {
    businessType,
    businessLocation,
    strategyType, // "meta_title_optimization", "meta_description_optimization", "keyword_targeting"
    pageUrl,
    focusKeywords,
    title, // For meta_title_optimization
    description, // For meta_description_optimization
    preStats,
    postStats,
    implementedAt,
    measuredAt,
  } = strategyData;

  // Calculate metrics
  const metrics = calculateSuccessMetrics(preStats, postStats);

  // Only save if meets success criteria
  if (!meetsSuccessCriteria(metrics)) {
    console.log(
      "Strategy doesn't meet success criteria, skipping playbook",
      metrics
    );
    return null;
  }

  const daysSinceImplementation = Math.floor(
    (new Date(measuredAt).getTime() - new Date(implementedAt).getTime()) /
      (1000 * 60 * 60 * 24)
  );

  // Parse location (city, state)
  const locationParts = businessLocation
    ? businessLocation.split(",").map((p) => p.trim())
    : [];
  const city = locationParts[0] || null;
  const state = locationParts[1] || null;

  const playbookStrategy = {
    // Business context (anonymized)
    businessType,
    businessLocation: city, // City only, e.g., "Austin"
    businessState: state || null,

    // Strategy details
    strategyType,
    pageType: detectPageType(pageUrl),
    pagePath: anonymizePageUrl(pageUrl), // Anonymized: "/services" not "https://example.com/services"
    focusKeywords: Array.isArray(focusKeywords)
      ? focusKeywords
      : [focusKeywords].filter(Boolean),

    // Strategy content (what was implemented)
    title: title || null,
    description: description || null,

    // Performance metrics
    preStats: {
      impressions: preStats.impressions || 0,
      clicks: preStats.clicks || 0,
      ctr: preStats.ctr || 0,
      position: preStats.position || 0,
    },
    postStats: {
      impressions: postStats.impressions || 0,
      clicks: postStats.clicks || 0,
      ctr: postStats.ctr || 0,
      position: postStats.position || 0,
    },

    // Calculated improvements
    improvement: {
      clicksIncrease: metrics.clicksIncrease,
      ctrIncrease: metrics.ctrIncrease,
      positionImprovement: metrics.positionImprovement,
      impressionsIncrease: metrics.impressionsIncrease,
      successScore: metrics.successScore,
    },

    // Metadata
    timeToResults: daysSinceImplementation,
    implementedAt: new Date(implementedAt).toISOString(),
    measuredAt: new Date(measuredAt).toISOString(),
    status: "success",

    // For easy querying (can remove before BigQuery migration)
    userId: hashIdentifier(userId), // Hashed for privacy
    createdAt: new Date().toISOString(),
  };

  // Save to subcollection structure
  // playbookStrategies/{hashedUserId}/strategies/{autoId}
  const hashedUserId = hashIdentifier(userId);
  const strategyRef = db
    .collection("playbookStrategies")
    .doc(hashedUserId)
    .collection("strategies")
    .doc(); // Auto-generate ID

  await strategyRef.set(playbookStrategy);

  console.log(
    `✅ Saved successful strategy to playbook: ${strategyType} for ${businessType} in ${city}`
  );

  return strategyRef.id;
}

// Get playbook strategies for similar businesses
// Legacy outcome scores were not validated. Do not reuse them in recommendations.
export async function getPlaybookStrategies() { return []; }

// Get all strategies for a user (for admin/debugging)
export async function getUserStrategies(hashedUserId) {
  try {
    const snapshot = await db
      .collection("playbookStrategies")
      .doc(hashedUserId)
      .collection("strategies")
      .get();

    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error("Error fetching user strategies:", error);
    return [];
  }
}


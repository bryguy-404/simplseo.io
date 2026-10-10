// Internal server module; callable only through authenticated routes.

import { db } from "./firebaseAdmin";
import crypto from "crypto";

const CONFIG_DOC_ID = "playbook_config";

// Hash user ID for privacy
const hashIdentifier = (value) => {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
};

// Get playbook configuration
export async function getPlaybookConfig() {
  try {
    const doc = await db.collection("appConfig").doc(CONFIG_DOC_ID).get();
    if (doc.exists) {
      return doc.data();
    }
    // Default config (playbook disabled)
    return {
      enabled: false,
      minStrategiesPerBusinessType: 5,
      minSuccessRate: 0.6,
      minDaysOld: 7,
      minBusinessesPerType: 3,
      enabledBusinessTypes: [], // Empty = auto-enable based on data quality
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching playbook config:", error);
    return { enabled: false }; // Fail-safe: disabled
  }
}

// Check if playbook is enabled for a specific business type
export async function checkIfPlaybookEnabled(businessType) {
  const config = await getPlaybookConfig();

  // Master switch is off
  if (!config.enabled) {
    return false;
  }

  // If specific business types are enabled, check if this one is included
  if (config.enabledBusinessTypes?.length > 0) {
    return config.enabledBusinessTypes.includes(businessType);
  }

  // If no specific types listed, check if we have enough data
  return await hasEnoughDataForBusinessType(businessType, config);
}

// Check if we have enough quality data for a business type
async function hasEnoughDataForBusinessType(businessType, config) {
  try {
    const snapshot = await db
      .collectionGroup("strategies")
      .where("businessType", "==", businessType)
      .where("status", "==", "success")
      .get();

    const strategies = snapshot.docs.map((doc) => doc.data());

    // Check minimum strategies
    if (strategies.length < config.minStrategiesPerBusinessType) {
      console.log(
        `❌ Not enough strategies for ${businessType}: ${strategies.length} < ${config.minStrategiesPerBusinessType}`
      );
      return false;
    }

    // Check minimum businesses (unique userIds)
    const uniqueBusinesses = new Set(strategies.map((s) => s.userId));
    if (uniqueBusinesses.size < config.minBusinessesPerType) {
      console.log(
        `❌ Not enough businesses for ${businessType}: ${uniqueBusinesses.size} < ${config.minBusinessesPerType}`
      );
      return false;
    }

    // Check success rate (all strategies are already "success", but check improvement)
    const successCount = strategies.filter(
      (s) =>
        s.improvement?.clicksIncrease > 0 ||
        s.improvement?.ctrIncrease > 0 ||
        s.improvement?.positionImprovement > 0 ||
        s.improvement?.impressionsIncrease > 0
    ).length;
    const successRate = successCount / strategies.length;
    if (successRate < config.minSuccessRate) {
      console.log(
        `❌ Success rate too low for ${businessType}: ${successRate} < ${config.minSuccessRate}`
      );
      return false;
    }

    // Check age (must be at least minDaysOld)
    const now = Date.now();
    const oldEnough = strategies.filter((s) => {
      const daysSince =
        (now - new Date(s.implementedAt).getTime()) /
        (1000 * 60 * 60 * 24);
      return daysSince >= config.minDaysOld;
    });

    if (oldEnough.length < config.minStrategiesPerBusinessType) {
      console.log(
        `❌ Not enough old strategies for ${businessType}: ${oldEnough.length} < ${config.minStrategiesPerBusinessType}`
      );
      return false;
    }

    console.log(
      `✅ ${businessType} meets all thresholds: ${strategies.length} strategies, ${uniqueBusinesses.size} businesses, ${(successRate * 100).toFixed(1)}% success rate`
    );
    return true;
  } catch (error) {
    console.error("Error checking data quality:", error);
    return false; // Fail-safe: disabled
  }
}

// Get playbook statistics for all business types
export async function getPlaybookStats() {
  try {
    const snapshot = await db
      .collectionGroup("strategies")
      .where("status", "==", "success")
      .get();

    const strategies = snapshot.docs.map((doc) => doc.data());

    const statsByType = {};

    strategies.forEach((s) => {
      if (!statsByType[s.businessType]) {
        statsByType[s.businessType] = {
          total: 0,
          successful: 0,
          uniqueBusinesses: new Set(),
          avgImprovement: {
            clicksIncrease: 0,
            ctrIncrease: 0,
            positionImprovement: 0,
            impressionsIncrease: 0,
          },
          strategies: [],
        };
      }

      statsByType[s.businessType].total++;
      if (
        s.improvement?.clicksIncrease > 0 ||
        s.improvement?.ctrIncrease > 0 ||
        s.improvement?.positionImprovement > 0 ||
        s.improvement?.impressionsIncrease > 0
      ) {
        statsByType[s.businessType].successful++;
      }
      statsByType[s.businessType].uniqueBusinesses.add(s.userId);
      statsByType[s.businessType].strategies.push(s);

      // Calculate averages
      if (s.improvement) {
        statsByType[s.businessType].avgImprovement.clicksIncrease +=
          s.improvement.clicksIncrease || 0;
        statsByType[s.businessType].avgImprovement.ctrIncrease +=
          s.improvement.ctrIncrease || 0;
        statsByType[s.businessType].avgImprovement.positionImprovement +=
          s.improvement.positionImprovement || 0;
        statsByType[s.businessType].avgImprovement.impressionsIncrease +=
          s.improvement.impressionsIncrease || 0;
      }
    });

    // Convert to readable format
    const config = await getPlaybookConfig();
    const stats = Object.entries(statsByType).map(([type, data]) => {
      const successRate = data.total > 0 ? data.successful / data.total : 0;
      const uniqueBusinesses = data.uniqueBusinesses.size;

      // Calculate average improvements
      const avgImprovement = {
        clicksIncrease:
          data.total > 0
            ? data.avgImprovement.clicksIncrease / data.total
            : 0,
        ctrIncrease:
          data.total > 0 ? data.avgImprovement.ctrIncrease / data.total : 0,
        positionImprovement:
          data.total > 0
            ? data.avgImprovement.positionImprovement / data.total
            : 0,
        impressionsIncrease:
          data.total > 0
            ? data.avgImprovement.impressionsIncrease / data.total
            : 0,
      };

      // Check if meets thresholds
      const now = Date.now();
      const oldEnough = data.strategies.filter((s) => {
        const daysSince =
          (now - new Date(s.implementedAt).getTime()) /
          (1000 * 60 * 60 * 24);
        return daysSince >= config.minDaysOld;
      }).length;

      const ready =
        data.total >= config.minStrategiesPerBusinessType &&
        successRate >= config.minSuccessRate &&
        uniqueBusinesses >= config.minBusinessesPerType &&
        oldEnough >= config.minStrategiesPerBusinessType;

      return {
        businessType: type,
        totalStrategies: data.total,
        successCount: data.successful,
        successRate: successRate,
        uniqueBusinesses: uniqueBusinesses,
        oldEnoughStrategies: oldEnough,
        avgImprovement: avgImprovement,
        ready: ready,
        meetsThresholds: {
          minStrategies: data.total >= config.minStrategiesPerBusinessType,
          minSuccessRate: successRate >= config.minSuccessRate,
          minBusinesses: uniqueBusinesses >= config.minBusinessesPerType,
          minDaysOld: oldEnough >= config.minStrategiesPerBusinessType,
        },
      };
    });

    return stats.sort((a, b) => b.totalStrategies - a.totalStrategies);
  } catch (error) {
    console.error("Error getting playbook stats:", error);
    return [];
  }
}

// Update playbook configuration (admin only)
export async function updatePlaybookConfig(newConfig) {
  try {
    const config = {
      ...newConfig,
      lastUpdated: new Date().toISOString(),
    };

    await db.collection("appConfig").doc(CONFIG_DOC_ID).set(config, {
      merge: true,
    });

    console.log("✅ Playbook config updated:", config);
    return { success: true, config };
  } catch (error) {
    console.error("Error updating playbook config:", error);
    return { success: false, error: error.message };
  }
}


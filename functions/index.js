const functions = require("firebase-functions"); // v1 SDK
const pubsub = require("firebase-functions/lib/providers/pubsub"); // required for .schedule
const admin = require("firebase-admin");
const fetch = require("node-fetch");

admin.initializeApp();
const db = admin.firestore();

// 🔐 Helper function to refresh GSC access token using refresh token
async function refreshAccessToken(refreshToken) {
  try {
    console.log("🔄 Refreshing access token using refresh token...");
    
    const response = await fetch("https://simplseo-io.vercel.app/api/gsc/refresh-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Token refresh failed: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log("✅ Access token refreshed successfully");
    return data.access_token;
  } catch (error) {
    console.error("❌ Error refreshing access token:", error.message);
    return null;
  }
}

// 🔐 Helper function to get a valid access token for a user
async function getValidAccessToken(userId) {
  try {
    const userDoc = await db.collection("users").doc(userId).get();
    const userData = userDoc.data();

    if (!userData) {
      console.log(`❌ No user data found for ${userId}`);
      return { token: null, siteUrl: null };
    }

    const siteUrl = userData.gscSiteUrl;
    const refreshToken = userData.gscRefreshToken;

    if (!refreshToken || !siteUrl) {
      console.log(`❌ No GSC refresh token or site URL for user ${userId}`);
      return { token: null, siteUrl: null };
    }

    // Always refresh the token to ensure it's valid
    // (Access tokens expire in 1 hour, cron jobs run every 24 hours)
    const freshToken = await refreshAccessToken(refreshToken);

    if (!freshToken) {
      console.log(`❌ Failed to refresh token for user ${userId}`);
      return { token: null, siteUrl: siteUrl };
    }

    // Update the stored access token for future use
    await db.collection("users").doc(userId).set({
      gscAccessToken: freshToken,
      gscConnectedAt: new Date().toISOString(),
    }, { merge: true });

    console.log(`✅ Got fresh access token for user ${userId}`);
    return { token: freshToken, siteUrl: siteUrl };
  } catch (error) {
    console.error(`❌ Error getting valid access token for ${userId}:`, error.message);
    return { token: null, siteUrl: null };
  }
}

// 🔧 Update all documents missing postStats
// Retired public maintenance endpoints must remain deployed as disabled handlers.
for (const name of ['updateAllMissingPostStats', 'updateDocumentWithGscData', 'listImplementedSeoTips', 'testPostStatsUpdate']) {
  exports[name] = functions.https.onRequest((req, res) => res.status(410).json({ error: 'Legacy maintenance endpoint disabled.' }));
}

exports.checkSeoTipProgress = pubsub
  .schedule("every day 01:00")
  .timeZone("America/New_York")
  .onRun(async (context) => {
    // ============================================
    // HELPER FUNCTIONS FOR 45-DAY SNAPSHOT SYSTEM
    // ============================================
    
    // Helper: Get expected CTR by position (industry averages)
    const getExpectedCTR = (position) => {
      if (position <= 1) return 0.28;  // 28%
      if (position <= 2) return 0.15;  // 15%
      if (position <= 3) return 0.10;  // 10%
      if (position <= 4) return 0.07;  // 7%
      if (position <= 5) return 0.05;  // 5%
      if (position <= 10) return 0.02; // 2%
      if (position <= 15) return 0.01; // 1%
      return 0.005; // 0.5% for position 16+
    };

    // Helper: Check if page is performing well (Success Detection)
    const isPageSuccessful = (position, impressions, clicks) => {
      if (impressions < 20) return false; // Not enough data
      const actualCTR = impressions > 0 ? clicks / impressions : 0;
      const expectedCTR = getExpectedCTR(position);
      return actualCTR >= expectedCTR; // Success if CTR >= 100% of expected
    };

    // Helper: Determine card type based on metrics for 45-day snapshot
    const determineCardType = (metrics, preStats) => {
      const clicks = metrics.clicks || 0;
      const impressions = metrics.impressions || 0;
      const position = metrics.position || 100;

      // Calculate new impressions since implementation
      const newImpressions = impressions - (preStats?.impressions || 0);
      const hasZeroClicks = clicks === 0;

      // Content Audit criteria: 0 clicks AND 50+ new impressions AND position >= 15
      if (hasZeroClicks && newImpressions >= 50 && position >= 15) {
        return "content-audit";
      }

      // Success criteria: CTR meets or exceeds expected for position
      if (isPageSuccessful(position, impressions, clicks)) {
        return "success";
      }

      // Default to pivot
      return "pivot";
    };

    // Helper: Check if snapshot needs refresh (7 days have passed)
    const needsSnapshotRefresh = (snapshot) => {
      if (!snapshot?.capturedAt) return true;
      const daysSinceSnapshot = (Date.now() - new Date(snapshot.capturedAt).getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceSnapshot >= 7;
    };

    // ============================================
    // QUERY BOTH IMPLEMENTED AND PASSIVE MONITORING PAGES
    // ============================================
    
    // Query for implemented pages
    const implementedSnapshot = await db
      .collection("implementedSeoTips")
      .where("status", "==", "implemented")
      .get();

    // Query for passive monitoring pages (dismissed but watching for decline)
    const passiveSnapshot = await db
      .collection("implementedSeoTips")
      .where("passiveMonitoring", "==", true)
      .get();

    // Combine both queries (using Map to deduplicate by doc ID)
    const allDocsMap = new Map();
    implementedSnapshot.docs.forEach(doc => allDocsMap.set(doc.id, doc));
    passiveSnapshot.docs.forEach(doc => allDocsMap.set(doc.id, doc));
    const allDocs = Array.from(allDocsMap.values());

    const now = Date.now();
    const nowISO = new Date().toISOString();
    const updates = [];
    let processedCount = 0;
    let skippedCount = 0;
    let createdCount = 0;
    let updatedCount = 0;
    let notDueYetCount = 0;
    let snapshotCreatedCount = 0;
    let snapshotRefreshedCount = 0;
    let resurfacedCount = 0;

    for (const doc of allDocs) {
      const data = doc.data();
      const { implementedAt, pageUrl, userId, preStats, postStats, nextUpdateDue, passiveMonitoring, dismissedMetrics, dayFortyFiveSnapshot } = data;
      if (data.preRevampArchived || !userId) continue;
      const recovery = (await db.collection('onboarding').doc(userId).get()).data();
      if (recovery?.progressReviewRequired || recovery?.revampStatus === 'in-progress') continue;

      console.log(`🔍 Processing document: ${doc.id}`);
      console.log(`📅 Implemented at: ${implementedAt}`);
      console.log(`📅 Next update due: ${nextUpdateDue || 'not set'}`);
      console.log(`📊 Has preStats: ${!!preStats}`);
      console.log(`📊 Has postStats: ${!!postStats}`);

      if (!implementedAt || !userId || !pageUrl || !preStats) {
        console.log(`❌ Skipping ${doc.id} - missing required fields`);
        continue;
      }

      const daysSince =
        (now - new Date(implementedAt).getTime()) / (1000 * 60 * 60 * 24);

      console.log(`📅 Days since implementation: ${daysSince.toFixed(1)}`);
      console.log(`🔄 Passive monitoring: ${passiveMonitoring || false}`);

      // ============================================
      // PASSIVE MONITORING: Check for decline in dismissed pages
      // ============================================
      if (passiveMonitoring && dismissedMetrics) {
        console.log(`👁️ Checking passive monitoring for ${pageUrl}`);
        
        // Get fresh access token
        const { token, siteUrl } = await getValidAccessToken(userId);
        if (!token || !siteUrl) {
          console.log(`❌ Skipping passive check for ${doc.id} - no valid GSC token`);
          continue;
        }

        // Fetch current metrics
        try {
          const passiveRes = await fetch(
            "https://simplseo-io.vercel.app/api/gsc/page-metrics",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token, siteUrl, pageUrl }),
            }
          );

          if (passiveRes.ok) {
            const currentMetrics = await passiveRes.json();
            
            // Check for significant decline
            const ctrDropPercent = dismissedMetrics.ctr > 0 
              ? ((dismissedMetrics.ctr - currentMetrics.ctr) / dismissedMetrics.ctr) * 100 
              : 0;
            const positionDrop = currentMetrics.position - dismissedMetrics.position;

            console.log(`📊 Passive monitoring metrics - CTR drop: ${ctrDropPercent.toFixed(1)}%, Position drop: ${positionDrop.toFixed(1)}`);

            // Resurface if CTR drops 50%+ OR position drops 10+
            if (ctrDropPercent >= 50 || positionDrop >= 10) {
              console.log(`⚠️ Resurfacing ${pageUrl} due to decline`);
              const declineReason = ctrDropPercent >= 50 ? "ctr-drop" : "position-drop";
              const cardType = determineCardType(currentMetrics, preStats);
              
              updates.push(
                doc.ref.set(
                  {
                    passiveMonitoring: false,
                    dayFortyFiveSnapshot: {
                      impressions: currentMetrics.impressions,
                      clicks: currentMetrics.clicks,
                      position: currentMetrics.position,
                      ctr: currentMetrics.ctr,
                      capturedAt: new Date().toISOString(),
                      cardType: cardType,
                      previousCardType: "dismissed",
                      declineDetected: true,
                      declineReason: declineReason,
                      declineDetails: {
                        ctrDropPercent: ctrDropPercent,
                        positionDrop: positionDrop,
                        previousCtr: dismissedMetrics.ctr,
                        previousPosition: dismissedMetrics.position,
                      }
                    },
                    postStats: currentMetrics,
                    updatedAt: new Date().toISOString(),
                    nextUpdateDue: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(),
                  },
                  { merge: true }
                )
              );
              resurfacedCount++;
            } else {
              console.log(`✅ ${pageUrl} still performing well, staying in passive monitoring`);
            }
          }
        } catch (err) {
          console.error(`❌ Error checking passive monitoring for ${pageUrl}:`, err);
        }
        continue; // Skip normal processing for passive monitoring pages
      }

      // Per-document scheduling logic:
      // 1. If nextUpdateDue exists, check if it's time to update
      // 2. If nextUpdateDue doesn't exist (legacy docs), fall back to 7-day check
      
      let shouldUpdate = false;
      
      if (nextUpdateDue) {
        // Per-document scheduling: check if the due DATE has arrived (ignore time)
        // This ensures updates happen on the due day, regardless of what time the cron runs
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Start of today (midnight)
        
        const dueDate = new Date(nextUpdateDue);
        dueDate.setHours(0, 0, 0, 0); // Start of due date (midnight)
        
        if (today >= dueDate) {
          shouldUpdate = true;
          console.log(`✅ ${doc.id} is due for update (due date: ${dueDate.toDateString()}, today: ${today.toDateString()})`);
        } else {
          const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
          console.log(`⏳ ${doc.id} not due yet - ${daysUntilDue} day(s) until due date`);
          notDueYetCount++;
          continue;
        }
      } else {
        // Legacy fallback: check if 7+ days have passed since implementation
        if (daysSince >= 7) {
          shouldUpdate = true;
          console.log(`✅ ${doc.id} is due for update (legacy: ${daysSince.toFixed(1)} days old)`);
        } else {
        console.log(`⏳ Skipping ${doc.id} - only ${daysSince.toFixed(1)} days old`);
        skippedCount++;
          continue;
        }
      }

      if (!shouldUpdate) {
        continue;
      }
      
      processedCount++;
      
      // 🔐 Get a fresh access token using the refresh token
      // This ensures we always have a valid token, even when running at midnight
      console.log(`🔐 Getting fresh access token for user ${userId}`);
      const { token, siteUrl } = await getValidAccessToken(userId);

      if (!token || !siteUrl) {
        console.log(`❌ Skipping ${doc.id} - no valid GSC token or site URL available`);
        skippedCount++;
        continue;
      }

      // Update document with fresh GSC data for reference
      await doc.ref.set({
        gscToken: token,
        siteUrl: siteUrl
      }, { merge: true });

      try {
        console.log(`🌐 Fetching postStats for ${pageUrl} from API`);
        
        const res = await fetch(
          "https://simplseo-io.vercel.app/api/gsc/page-metrics",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, siteUrl, pageUrl }),
          }
        );

        let newPostStats;
        
        if (res.ok) {
          newPostStats = await res.json();
          console.log(`✅ Fetched postStats for ${pageUrl}:`, newPostStats);
        } else {
          const errorText = await res.text();
          console.log(`⚠️ API failed for ${pageUrl}: ${res.status} - ${errorText}`);
          skippedCount++;
          continue; // Skip if API fails - don't use dummy data
        }

        // ✅ SAFEGUARD: Check if new data is all zeros
        const isAllZeros = newPostStats.impressions === 0 && 
                           newPostStats.clicks === 0 && 
                           newPostStats.ctr === 0 && 
                           newPostStats.position === 0;

        // ✅ SAFEGUARD: Check if existing postStats has real data
        const existingHasData = postStats && 
                               (postStats.impressions > 0 || 
                                postStats.clicks > 0 || 
                                (postStats.position > 0 && postStats.position < 100));

        // Decision logic:
        // 1. If postStats doesn't exist, create it (first time after 7 days)
        // 2. If postStats exists but is all zeros, update with new data (even if zeros - might be real)
        // 3. If postStats exists with real data and new data is zeros, skip (don't overwrite good data)
        // 4. If postStats exists and new data is better, update it

        // Calculate next update due date (7 days from now)
        const nextUpdateDueDate = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();
        const currentDate = new Date().toISOString();
        const dayNumber = Math.floor(daysSince);

        // Helper to create history entry from current postStats (before overwriting)
        const createHistoryEntry = (stats, dayNum) => ({
          date: currentDate,
          dayNumber: dayNum,
          impressions: stats.impressions,
          clicks: stats.clicks,
          ctr: stats.ctr,
          position: stats.position,
        });

        // Get existing history array (or empty array if none)
        const existingHistory = data.postStatsHistory || [];

        // ============================================
        // 45-DAY SNAPSHOT: Create/refresh for pages at 45+ days
        // ============================================
        let snapshotUpdate = {};
        if (daysSince >= 45) {
          const existingSnapshot = dayFortyFiveSnapshot;
          const shouldCreateOrRefresh = needsSnapshotRefresh(existingSnapshot);

          if (shouldCreateOrRefresh) {
            const cardType = determineCardType(newPostStats, preStats);
            snapshotUpdate = {
              dayFortyFiveSnapshot: {
                impressions: newPostStats.impressions,
                clicks: newPostStats.clicks,
                position: newPostStats.position,
                ctr: newPostStats.ctr,
                capturedAt: currentDate,
                cardType: cardType,
                previousCardType: existingSnapshot?.cardType || null,
                declineDetected: false,
              },
              allowReImplementation: true,  // Signals ready for new 45-day cycle
            };
            
            if (existingSnapshot) {
              console.log(`🔄 Refreshing 45-day snapshot for ${pageUrl} (cardType: ${cardType})`);
              snapshotRefreshedCount++;
            } else {
              console.log(`📸 Creating 45-day snapshot for ${pageUrl} (cardType: ${cardType})`);
              snapshotCreatedCount++;
            }
          } else {
            console.log(`⏳ 45-day snapshot still fresh for ${pageUrl} (cardType: ${existingSnapshot?.cardType})`);
          }
        }

        if (!postStats) {
          // First time - create postStats (even if zeros, it's the first attempt)
          // Also start the history array with this first entry
          console.log(`📝 Creating postStats for ${pageUrl} (first time)`);
          console.log(`📅 Next update scheduled for: ${nextUpdateDueDate}`);
          
          const firstHistoryEntry = createHistoryEntry(newPostStats, dayNumber);
          
          updates.push(
            doc.ref.set(
              {
                postStats: newPostStats,
                postStatsHistory: [firstHistoryEntry],
                updatedAt: currentDate,
                lastUpdated: currentDate,
                nextUpdateDue: nextUpdateDueDate,
                ...snapshotUpdate, // Include 45-day snapshot if applicable
              },
              { merge: true }
            )
          );
          createdCount++;
        } else if (!existingHasData && isAllZeros) {
          // Existing data is also zeros, update anyway (might get real data later)
          console.log(`🔄 Updating postStats for ${pageUrl} (both zeros, trying again)`);
          console.log(`📅 Next update scheduled for: ${nextUpdateDueDate}`);
          
          // Add to history even if zeros (tracks attempts)
          const historyEntry = createHistoryEntry(newPostStats, dayNumber);
          const updatedHistory = [...existingHistory, historyEntry];
          
          updates.push(
            doc.ref.set(
              {
                postStats: newPostStats,
                postStatsHistory: updatedHistory,
                updatedAt: currentDate,
                lastUpdated: currentDate,
                nextUpdateDue: nextUpdateDueDate,
                ...snapshotUpdate, // Include 45-day snapshot if applicable
              },
              { merge: true }
            )
          );
          updatedCount++;
        } else if (existingHasData && isAllZeros) {
          // Existing data is good, new data is zeros - SKIP to protect good data
          // But still update nextUpdateDue to check again in 7 days
          console.log(`🛡️ Skipping update for ${pageUrl} - existing data is good, new data is zeros`);
          console.log(`📅 Still scheduling next check for: ${nextUpdateDueDate}`);
          updates.push(
            doc.ref.set(
              {
                nextUpdateDue: nextUpdateDueDate,
                ...snapshotUpdate, // Include 45-day snapshot if applicable
              },
              { merge: true }
            )
          );
          skippedCount++;
          continue;
        } else {
          // Both have data - update with new data (refreshing)
          // ✅ Save current postStats to history BEFORE overwriting
          console.log(`🔄 Refreshing postStats for ${pageUrl}`);
          console.log(`📅 Next update scheduled for: ${nextUpdateDueDate}`);
          console.log(`📚 Saving previous postStats to history (day ${dayNumber})`);
          
          const historyEntry = createHistoryEntry(newPostStats, dayNumber);
          const updatedHistory = [...existingHistory, historyEntry];
          
          updates.push(
            doc.ref.set(
              {
                postStats: newPostStats,
                postStatsHistory: updatedHistory,
                updatedAt: currentDate,
                lastUpdated: currentDate,
                nextUpdateDue: nextUpdateDueDate,
                ...snapshotUpdate, // Include 45-day snapshot if applicable
              },
              { merge: true }
            )
          );
          updatedCount++;
        }
      } catch (err) {
        console.error(`❌ Error updating ${pageUrl}:`, err);
        skippedCount++;
      }
    }

    await Promise.all(updates);
    console.log(`✅ Daily cron completed:`);
    console.log(`   - Processed (due today): ${processedCount}`);
    console.log(`   - Created (first postStats): ${createdCount}`);
    console.log(`   - Updated (refreshed): ${updatedCount}`);
    console.log(`   - Skipped (protected good data): ${skippedCount}`);
    console.log(`   - Not due yet: ${notDueYetCount}`);
    console.log(`   - 45-day snapshots created: ${snapshotCreatedCount}`);
    console.log(`   - 45-day snapshots refreshed: ${snapshotRefreshedCount}`);
    console.log(`   - Resurfaced (passive monitoring decline): ${resurfacedCount}`);
    return null;
  });

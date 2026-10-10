import { NextResponse } from "next/server";
import { db, auth } from "../../../lib/firebaseAdmin";
import nodemailer from "nodemailer";

// Server-side GSC token management
async function getStoredGSCData(userId) {
  try {
    const userDoc = await db.collection("users").doc(userId).get();
    if (!userDoc.exists) {
      return null;
    }
    const userData = userDoc.data();
    return {
      refreshToken: userData.gscRefreshToken || null,
      accessToken: userData.gscAccessToken || null,
      siteUrl: userData.gscSiteUrl || null,  // Fixed: was gscProperty, should be gscSiteUrl
      tokenExpiresAt: userData.gscTokenExpiresAt || null,
    };
  } catch (error) {
    console.error("Error getting stored GSC data:", error);
    return null;
  }
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    return null;
  }

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: "956212275866-7dtgdq7b38b156riehghuvh8b8469ktg.apps.googleusercontent.com",
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error("Error refreshing access token:", error);
    return null;
  }
}

async function getValidAccessToken(userId) {
  const gscData = await getStoredGSCData(userId);
  if (!gscData?.refreshToken) {
    return null;
  }

  // Check if token is expired (with 5 minute buffer)
  const now = new Date();
  const expiresAt = gscData.tokenExpiresAt
    ? new Date(gscData.tokenExpiresAt)
    : null;

  if (expiresAt && expiresAt > now) {
    // Token is still valid
    return gscData.accessToken;
  }

  // Token expired, refresh it
  const newAccessToken = await refreshAccessToken(gscData.refreshToken);
  if (newAccessToken) {
    // Update token in Firestore
    const expiresIn = 3600; // 1 hour
    const newExpiresAt = new Date(now.getTime() + expiresIn * 1000);
    await db
      .collection("users")
      .doc(userId)
      .update({
        gscAccessToken: newAccessToken,
        gscTokenExpiresAt: newExpiresAt.toISOString(),
      });
    return newAccessToken;
  }

  return null;
}

// Create reusable transporter (supports both SendGrid and Gmail SMTP)
const createTransporter = () => {
  // Check if SendGrid is configured (preferred)
  if (process.env.SENDGRID_API_KEY) {
    return nodemailer.createTransport({
      service: "SendGrid",
      auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  }

  // Fallback to Gmail SMTP
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.warn("⚠️ No email configuration found. Email notifications will be skipped.");
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false,
    family: 4,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: {
      rejectUnauthorized: false,
    },
  });
};

// Fetch GSC keywords for a user
async function fetchGSCKeywords(siteUrl, token) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 90); // Last 90 days (3 months) to match Success Stories settling period

  const format = (d) => d.toISOString().split("T")[0];
  const from = format(start);
  const to = format(today);

  try {
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        siteUrl
      )}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: from,
          endDate: to,
          dimensions: ["query", "page"],
          rowLimit: 1000,
        }),
      }
    );

    const json = await res.json();

    if (!json.rows) {
      return [];
    }

    // Format the data
    return json.rows.map((row) => ({
      keyword: row.keys[0].replace(/^\[|\]$/g, ""),
      page: row.keys[1],
      clicks: row.clicks,
      impressions: row.impressions,
      position: Math.round(row.position),
      ctr: `${(row.ctr * 100).toFixed(1)}%`,
    }));
  } catch (error) {
    console.error("Error fetching GSC keywords:", error);
    return [];
  }
}

// Check if a specific page URL exists in GSC (for pages with low impressions not in top 1000)
async function checkPageExistsInGSC(siteUrl, token, pageUrl) {
  const today = new Date();
  const start = new Date(today);
  start.setDate(today.getDate() - 90); // 90 days to match Success Stories data window

  const format = (d) => d.toISOString().split("T")[0];
  const from = format(start);
  const to = format(today);

  // Try both with and without trailing slash
  const urlsToTry = [
    pageUrl,
    pageUrl.endsWith('/') ? pageUrl.slice(0, -1) : pageUrl + '/'
  ];

  for (const urlToCheck of urlsToTry) {
    try {
      const res = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
          siteUrl
        )}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: from,
            endDate: to,
            dimensions: ["page"],
            dimensionFilterGroups: [{
              filters: [{
                dimension: "page",
                operator: "equals",
                expression: urlToCheck
              }]
            }],
            rowLimit: 1,
          }),
        }
      );

      const json = await res.json();
      
      if (json.rows && json.rows.length > 0) {
        const row = json.rows[0];
        return {
          exists: true,
          impressions: row.impressions,
          clicks: row.clicks,
          ctr: `${(row.ctr * 100).toFixed(1)}%`,
          position: Math.round(row.position)
        };
      }
    } catch (error) {
      console.error(`Error checking page ${urlToCheck}:`, error);
    }
  }
  
  // Also try a "contains" search as a fallback
  try {
    const pathname = new URL(pageUrl).pathname.replace(/\/$/, '');
    
    const res = await fetch(
      `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
        siteUrl
      )}/searchAnalytics/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          startDate: from,
          endDate: to,
          dimensions: ["page"],
          dimensionFilterGroups: [{
            filters: [{
              dimension: "page",
              operator: "contains",
              expression: pathname
            }]
          }],
          rowLimit: 10,
        }),
      }
    );

    const json = await res.json();
    
    if (json.rows && json.rows.length > 0) {
      const row = json.rows[0];
      return {
        exists: true,
        impressions: row.impressions,
        clicks: row.clicks,
        ctr: `${(row.ctr * 100).toFixed(1)}%`,
        position: Math.round(row.position)
      };
    }
  } catch (error) {
    console.error(`Error in contains search for ${pageUrl}:`, error);
  }
  
  return { exists: false };
}

// Normalize URL to extract pathname only (not full URL with domain)
// This prevents false positives where any URL would match the homepage
function normalizeUrlPath(url) {
  try {
    const u = new URL(url);
    // Return just the pathname, normalized (lowercase, no trailing slash)
    return u.pathname.toLowerCase().replace(/\/$/, "") || "/";
  } catch {
    return url.toLowerCase().replace(/\/$/, "");
  }
}

// Check if URLs match - EXACT pathname matching only
// No includes() which causes false positives (e.g., every URL contains the homepage domain)
function urlsMatch(url1, url2) {
  const path1 = normalizeUrlPath(url1);
  const path2 = normalizeUrlPath(url2);
  // Use EXACT matching only
  return path1 === path2;
}

// Send success notification email
async function sendSuccessNotification(userEmail, opportunity) {
  const transporter = createTransporter();
  if (!transporter) {
    console.warn("⚠️ Email transporter not available. Skipping notification.");
    return false;
  }

  try {
    const dashboardUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://simplseo-io.vercel.app";
    const extraOpportunitiesUrl = `${dashboardUrl}/generic-keywords`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@simplseo.io",
      to: userEmail,
      subject: `🎉 Your page is now ranking in Google! - ${opportunity.keyword}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #00BF63;">🎉 Great News! Your Page is Ranking!</h2>
          <p>We have exciting news - the page you created is now appearing in Google Search Console!</p>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #00BF63; margin-top: 0;">Page Details:</h3>
            <p><strong>Keyword:</strong> ${opportunity.keyword}</p>
            <p><strong>Page URL:</strong> <a href="${opportunity.pageUrl}">${opportunity.pageUrl}</a></p>
            <p><strong>Position:</strong> ${opportunity.position}</p>
            <p><strong>Impressions:</strong> ${opportunity.impressions.toLocaleString()}</p>
            <p><strong>Clicks:</strong> ${opportunity.clicks.toLocaleString()}</p>
            <p><strong>CTR:</strong> ${opportunity.ctr}</p>
          </div>

          <p>You can view all your success stories and track your progress on the Extra Opportunities page:</p>
          <a href="${extraOpportunitiesUrl}" style="display: inline-block; background-color: #00BF63; color: #ffffff; padding: 10px 20px; border-radius: 5px; text-decoration: none; margin-top: 15px;">
            View Success Stories
          </a>

          <p style="margin-top: 30px; font-size: 0.9em; color: #777;">
            Keep up the great work! Your SEO efforts are paying off.
          </p>
          <p style="font-size: 0.8em; color: #999;">
            This email was sent from SimplSEO. If you have any questions, feel free to contact us.
          </p>
        </div>
      `,
      text: `Great News! Your Page is Ranking!\n\nWe have exciting news - the page you created is now appearing in Google Search Console!\n\nPage Details:\nKeyword: ${opportunity.keyword}\nPage URL: ${opportunity.pageUrl}\nPosition: ${opportunity.position}\nImpressions: ${opportunity.impressions.toLocaleString()}\nClicks: ${opportunity.clicks.toLocaleString()}\nCTR: ${opportunity.ctr}\n\nView your success stories: ${extraOpportunitiesUrl}`,
    });

    return true;
  } catch (error) {
    console.error("❌ Error sending success notification email:", error);
    return false;
  }
}

export async function GET(req) {
  // Verify this is a cron request (Vercel adds a header)
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    console.log("🔄 Starting daily success stories check...");

    // Get all users who have created opportunities
    const usersSnapshot = await db.collection("createdContentOpportunities").get();

    if (usersSnapshot.empty) {
      console.log("✅ No users with created opportunities found.");
      return NextResponse.json({
        success: true,
        message: "No users to check",
        checked: 0,
        matchesFound: 0,
        notificationsSent: 0,
      });
    }

    let checked = 0;
    let matchesFound = 0;
    let notificationsSent = 0;
    const errors = [];

    // Process each user
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const recovery = (await db.collection("onboarding").doc(userId).get()).data();
      if (recovery?.progressReviewRequired || recovery?.revampStatus === "in-progress") continue;

      try {
        // Get user's created opportunities
        const opportunitiesSnapshot = await db
          .collection("createdContentOpportunities")
          .doc(userId)
          .collection("created")
          .get();

        if (opportunitiesSnapshot.empty) {
          continue;
        }

        // Get user's email from Firebase Authentication (not Firestore)
        let userEmail = null;
        try {
          const userRecord = await auth.getUser(userId);
          userEmail = userRecord.email;
        } catch (authError) {
          console.log(`⚠️ Could not get auth user for ${userId}:`, authError.message);
          continue;
        }

        if (!userEmail) {
          console.log(`⚠️ No email found for user ${userId}`);
          continue;
        }

        // Get user's GSC data
        const gscData = await getStoredGSCData(userId);

        if (!gscData?.refreshToken || !gscData?.siteUrl) {
          console.log(`⚠️ No GSC connection for user ${userId}`);
          continue;
        }

        // Get valid access token
        const validToken = await getValidAccessToken(userId);
        if (!validToken) {
          console.log(`⚠️ Could not get valid GSC token for user ${userId}`);
          continue;
        }

        // Fetch GSC keywords
        const gscKeywords = await fetchGSCKeywords(gscData.siteUrl, validToken);

        if (gscKeywords.length === 0) {
          continue;
        }

        // Check each created opportunity for matches
        for (const oppDoc of opportunitiesSnapshot.docs) {
          const opportunity = { id: oppDoc.id, ...oppDoc.data() };

          // Skip if already notified (check if notificationSentAt exists)
          if (opportunity.notificationSentAt) {
            continue;
          }

          // Check if this opportunity's URL matches any GSC page in top 1000 results
          const matchingKw = gscKeywords.find((kw) =>
            urlsMatch(opportunity.pageUrl, kw.page)
          );

          let gscMetrics = null;

          if (matchingKw) {
            // Found in top 1000 results
            gscMetrics = {
              position: matchingKw.position,
              impressions: matchingKw.impressions,
              clicks: matchingKw.clicks,
              ctr: matchingKw.ctr,
            };
            console.log(`✅ Found "${opportunity.keyword}" in top 1000 GSC results`);
          } else {
            // Not in top 1000 - do a direct check for this specific URL
            // This catches low-impression pages that wouldn't appear in the top 1000
            console.log(`🔍 "${opportunity.keyword}" not in top 1000, doing direct check...`);
            const directCheck = await checkPageExistsInGSC(
              gscData.siteUrl,
              validToken,
              opportunity.pageUrl
            );

            if (directCheck.exists) {
              gscMetrics = {
                position: directCheck.position,
                impressions: directCheck.impressions,
                clicks: directCheck.clicks,
                ctr: directCheck.ctr,
              };
              console.log(`✅ Found "${opportunity.keyword}" via direct check: ${directCheck.impressions} impressions`);
            } else {
              console.log(`❌ "${opportunity.keyword}" not found in GSC yet`);
            }
          }

          if (gscMetrics) {
            matchesFound++;

            // Update opportunity with GSC metrics
            await db
              .collection("createdContentOpportunities")
              .doc(userId)
              .collection("created")
              .doc(opportunity.id)
              .update({
                firstRankedAt: new Date().toISOString(),
                position: gscMetrics.position,
                impressions: gscMetrics.impressions,
                clicks: gscMetrics.clicks,
                ctr: gscMetrics.ctr,
                notificationSentAt: new Date().toISOString(),
              });

            // Send notification email
            const emailSent = await sendSuccessNotification(userEmail, {
              keyword: opportunity.keyword,
              pageUrl: opportunity.pageUrl,
              position: gscMetrics.position,
              impressions: gscMetrics.impressions,
              clicks: gscMetrics.clicks,
              ctr: gscMetrics.ctr,
            });

            if (emailSent) {
              notificationsSent++;
              console.log(
                `✅ Notification sent to ${userEmail} for keyword: ${opportunity.keyword}`
              );
            }
          }
        }

        checked++;
      } catch (error) {
        console.error(`❌ Error processing user ${userId}:`, error);
        errors.push({ userId, error: error.message });
      }
    }

    console.log(`✅ Success stories check complete. Checked: ${checked}, Matches: ${matchesFound}, Notifications: ${notificationsSent}`);

    return NextResponse.json({
      success: true,
      checked,
      matchesFound,
      notificationsSent,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("❌ Error in cron job:", error);
    return NextResponse.json(
      {
        error: "Cron job failed",
        details: error.message,
      },
      { status: 500 }
    );
  }
}


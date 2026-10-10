import { NextResponse } from "next/server";
import { auth } from "../../lib/firebaseAdmin";
import nodemailer from "nodemailer";

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
    console.warn("⚠️ No email configuration found.");
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

// Test endpoint to verify email sending works
// Only available in development mode for safety
export async function POST(req) {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Not found" }, { status: 404 });
  // Block in production for security
  if (process.env.NODE_ENV === "production" && !process.env.ALLOW_TEST_EMAILS) {
    return NextResponse.json(
      { error: "Test emails not available in production" },
      { status: 403 }
    );
  }

  try {
    const { userId, keyword, pageUrl } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // Get user email from Firebase Auth
    let userEmail;
    try {
      const userRecord = await auth.getUser(userId);
      userEmail = userRecord.email;
    } catch (error) {
      return NextResponse.json(
        { error: `User not found: ${error.message}` },
        { status: 404 }
      );
    }

    if (!userEmail) {
      return NextResponse.json(
        { error: "User has no email address" },
        { status: 400 }
      );
    }

    // Create mock success data
    const mockData = {
      keyword: keyword || "plumber near me",
      pageUrl: pageUrl || "https://example.com/services/plumber",
      position: 8,
      impressions: 142,
      clicks: 12,
      ctr: "8.5%",
    };

    const transporter = createTransporter();
    if (!transporter) {
      return NextResponse.json(
        { error: "Email transporter not configured. Check SENDGRID_API_KEY or SMTP settings." },
        { status: 500 }
      );
    }

    const dashboardUrl = process.env.NEXT_PUBLIC_APP_URL || "https://simplseo-io.vercel.app";
    const extraOpportunitiesUrl = `${dashboardUrl}/generic-keywords`;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@simplseo.io",
      to: userEmail,
      subject: `🎉 [TEST] Your page is now ranking in Google! - ${mockData.keyword}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #fff3cd; border: 1px solid #ffc107; padding: 12px; border-radius: 8px; margin-bottom: 20px;">
            <p style="color: #856404; margin: 0; font-weight: bold;">⚠️ THIS IS A TEST EMAIL - No real GSC data was used</p>
          </div>
          
          <h2 style="color: #00BF63;">🎉 Great News! Your Page is Ranking!</h2>
          <p>We have exciting news - the page you created is now appearing in Google Search Console!</p>
          
          <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #00BF63; margin-top: 0;">Page Details:</h3>
            <p><strong>Keyword:</strong> ${mockData.keyword}</p>
            <p><strong>Page URL:</strong> <a href="${mockData.pageUrl}">${mockData.pageUrl}</a></p>
            <p><strong>Position:</strong> ${mockData.position}</p>
            <p><strong>Impressions:</strong> ${mockData.impressions.toLocaleString()}</p>
            <p><strong>Clicks:</strong> ${mockData.clicks.toLocaleString()}</p>
            <p><strong>CTR:</strong> ${mockData.ctr}</p>
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
      text: `[TEST EMAIL]\n\nGreat News! Your Page is Ranking!\n\nWe have exciting news - the page you created is now appearing in Google Search Console!\n\nPage Details:\nKeyword: ${mockData.keyword}\nPage URL: ${mockData.pageUrl}\nPosition: ${mockData.position}\nImpressions: ${mockData.impressions.toLocaleString()}\nClicks: ${mockData.clicks.toLocaleString()}\nCTR: ${mockData.ctr}\n\nView your success stories: ${extraOpportunitiesUrl}`,
    });

    console.log(`✅ Test email sent to ${userEmail}`);

    return NextResponse.json({
      success: true,
      message: "Test email sent successfully",
      sentTo: userEmail,
      mockData,
    });
  } catch (error) {
    console.error("❌ Error sending test email:", error);
    return NextResponse.json(
      { error: `Failed to send email: ${error.message}` },
      { status: 500 }
    );
  }
}

// GET endpoint to check if the test is available
export async function GET() {
  if (process.env.NODE_ENV === "production") return Response.json({ error: "Not found" }, { status: 404 });
  const isProduction = process.env.NODE_ENV === "production";
  const allowTestEmails = process.env.ALLOW_TEST_EMAILS === "true";

  return NextResponse.json({
    available: !isProduction || allowTestEmails,
    environment: process.env.NODE_ENV,
    hasEmailConfig: !!(process.env.SENDGRID_API_KEY || process.env.SMTP_USER),
  });
}


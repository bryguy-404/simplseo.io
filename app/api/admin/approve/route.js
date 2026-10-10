import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { randomInt } from 'node:crypto';
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";
import nodemailer from "nodemailer";

// Generate unique invitation code
function generateInvitationCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Removed confusing chars (0, O, I, 1)
  let code = "";
  
  // Generate 4 characters, then dash, then 4 more
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(randomInt(chars.length));
  }
  code += "-";
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(randomInt(chars.length));
  }
  
  return code;
}

// Create email transporter (reuse from contact form)
const createTransporter = () => {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
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
      rejectUnauthorized: true,
    },
  });
};

async function handlePOST(req) {
  try {
    const { requestId, action, userId } = await req.json();


    if (!requestId) {
      return NextResponse.json(
        { error: "Request ID is required" },
        { status: 400 }
      );
    }

    const requestRef = db.collection("accessRequests").doc(requestId);
    const requestDoc = await requestRef.get();

    if (!requestDoc.exists) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    const requestData = requestDoc.data();

    if (action === "approve") {
      // Generate unique invitation code
      let invitationCode = generateInvitationCode();
      
      // Ensure code is unique
      let codeExists = true;
      while (codeExists) {
        const existingCode = await db.collection("invitationCodes").doc(invitationCode).get();
        if (!existingCode.exists) {
          codeExists = false;
        } else {
          invitationCode = generateInvitationCode();
        }
      }

      // Update access request
      await requestRef.update({
        status: "approved",
        approvedAt: new Date().toISOString(),
        invitationCode: invitationCode,
        approvedBy: userId,
      });

      // Create invitation code document
      await db.collection("invitationCodes").doc(invitationCode).set({
        code: invitationCode,
        email: requestData.email,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
        used: false,
        usedAt: null,
        approvedBy: userId,
      });

      // Add to approvedUsers collection
      await db.collection("approvedUsers").doc(requestData.email).set({
        email: requestData.email,
        invitationCode: invitationCode,
        approvedAt: new Date().toISOString(),
        usedAt: null,
        approvedBy: userId,
      }, { merge: true });

      // Send email with invitation code
      const transporter = createTransporter();
      if (transporter) {
        try {
          const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://simplseo-io.vercel.app"}/verify-code?code=${invitationCode}`;
          
          await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.SMTP_USER,
            to: requestData.email,
            subject: "🎉 Your SimplSEO Access Has Been Approved!",
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #00BF63;">Welcome to SimplSEO!</h2>
                <p>Great news! Your access request has been approved.</p>
                
                <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                  <p style="margin: 0 0 10px 0; font-weight: bold;">Your Invitation Code:</p>
                  <p style="font-size: 24px; font-weight: bold; letter-spacing: 0.2em; font-family: monospace; color: #00BF63; margin: 0;">
                    ${invitationCode}
                  </p>
                </div>
                
                <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0; margin: 20px 0;">
                  <h3 style="margin-top: 0;">Next Steps:</h3>
                  <ol style="line-height: 1.8;">
                    <li>Click the button below to verify your code</li>
                    <li>Or visit: <a href="${verifyUrl}">${verifyUrl}</a></li>
                    <li>Create your account and start optimizing your SEO!</li>
                  </ol>
                  
                  <div style="text-align: center; margin-top: 30px;">
                    <a href="${verifyUrl}" style="background-color: #00BF63; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                      Verify Code & Get Started
                    </a>
                  </div>
                </div>
                
                <p style="color: #666; font-size: 12px; margin-top: 20px;">
                  This invitation code expires in 30 days. If you have any questions, feel free to contact us.
                </p>
              </div>
            `,
            text: `
Welcome to SimplSEO!

Great news! Your access request has been approved.

Your Invitation Code: ${invitationCode}

Next Steps:
1. Visit: ${verifyUrl}
2. Enter your invitation code
3. Create your account and start optimizing your SEO!

This invitation code expires in 30 days.
            `,
          });

          console.log(`✅ Approval email sent to ${requestData.email}`);
        } catch (emailError) {
          console.error("❌ Error sending approval email:", emailError);
          // Don't fail the request if email fails
        }
      }

      return NextResponse.json({
        success: true,
        invitationCode: invitationCode,
        email: requestData.email,
        message: "Request approved and invitation code sent",
      });
    } else if (action === "reject") {
      await requestRef.update({
        status: "rejected",
        approvedAt: new Date().toISOString(),
        approvedBy: userId,
      });

      return NextResponse.json({
        success: true,
        message: "Request rejected",
      });
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'approve' or 'reject'" },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error("❌ Error processing approval:", error);
    return NextResponse.json(
      { error: "Failed to process approval", details: error.message },
      { status: 500 }
    );
  }
}

// GET endpoint to list all pending requests
async function handleGET(req) {
  try {
    const { searchParams } = new URL(req.url);

    const status = searchParams.get("status") || "pending";
    
    // Fetch all requests and filter/sort in memory to avoid index requirement
    const snapshot = await db
      .collection("accessRequests")
      .get();

    const requests = snapshot.docs
      .map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter((request) => request.status === status)
      .sort((a, b) => {
        // Sort by requestedAt descending (newest first)
        const dateA = new Date(a.requestedAt || 0).getTime();
        const dateB = new Date(b.requestedAt || 0).getTime();
        return dateB - dateA;
      });

    return NextResponse.json({
      success: true,
      requests: requests,
      count: requests.length,
    });
  } catch (error) {
    console.error("❌ Error fetching requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch requests", details: error.message },
      { status: 500 }
    );
  }
}


export const GET = authenticatedRoute(handleGET, { admin: true });
export const POST = authenticatedRoute(handlePOST, { admin: true });

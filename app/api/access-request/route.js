import { publicRoute, escapeHtml } from '../../lib/server/publicRequest';
import { NextResponse } from "next/server";
import { db } from "../../lib/firebaseAdmin";
import nodemailer from "nodemailer";

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
    const { email, name, company, reason } = await req.json();

    // Validation
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email) || [name, company, reason].some(value => value != null && (typeof value !== 'string' || value.length > 4000))) {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already has a pending or approved request
    const existingRequestsSnapshot = await db
      .collection("accessRequests")
      .where("email", "==", normalizedEmail)
      .get();

    if (!existingRequestsSnapshot.empty) {
      const existingRequest = existingRequestsSnapshot.docs[0].data();
      if (existingRequest.status === "approved") {
        return NextResponse.json(
          { error: "This email already has approved access" },
          { status: 400 }
        );
      }
      if (existingRequest.status === "pending") {
        return NextResponse.json(
          { error: "A request for this email is already pending" },
          { status: 400 }
        );
      }
    }

    // Create access request
    const requestData = {
      email: normalizedEmail,
      name: name?.trim() || null,
      company: company?.trim() || null,
      reason: reason?.trim() || null,
      status: "pending",
      requestedAt: new Date().toISOString(),
      approvedAt: null,
      invitationCode: null,
      approvedBy: null,
    };

    const docRef = await db.collection("accessRequests").add(requestData);

    console.log(`✅ Access request created: ${docRef.id} for ${normalizedEmail}`);

    // Send email notification to admin
    const transporter = createTransporter();
    if (transporter) {
      try {
        const adminUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://simplseo-io.vercel.app"}/admin/access-requests`;
        
        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: "simplseoai@gmail.com",
          replyTo: normalizedEmail,
          subject: `[SimplSEO] New Access Request from ${name?.trim() || normalizedEmail}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #00BF63;">New Access Request</h2>
              <p>A new user has requested access to SimplSEO.</p>
              
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Email:</strong> ${escapeHtml(normalizedEmail)}</p>
                ${name ? `<p><strong>Name:</strong> ${escapeHtml(name.trim())}</p>` : ''}
                ${company ? `<p><strong>Company:</strong> ${escapeHtml(company.trim())}</p>` : ''}
                ${reason ? `<p><strong>Reason:</strong></p><p style="white-space: pre-wrap; margin-left: 20px;">${escapeHtml(reason.trim())}</p>` : ''}
                <p><strong>Requested At:</strong> ${new Date(requestData.requestedAt).toLocaleString()}</p>
              </div>
              
              <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0; margin: 20px 0;">
                <p style="margin-top: 0;"><strong>Review and approve this request:</strong></p>
                <div style="text-align: center; margin-top: 20px;">
                  <a href="${adminUrl}" style="background-color: #00BF63; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                    Go to Admin Dashboard
                  </a>
                </div>
                <p style="text-align: center; margin-top: 15px; color: #666; font-size: 12px;">
                  Or visit: <a href="${adminUrl}">${adminUrl}</a>
                </p>
              </div>
              
              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                This is an automated notification from SimplSEO.
              </p>
            </div>
          `,
          text: `
New Access Request

A new user has requested access to SimplSEO.

Email: ${normalizedEmail}
${name ? `Name: ${name.trim()}\n` : ''}${company ? `Company: ${company.trim()}\n` : ''}${reason ? `Reason: ${reason.trim()}\n` : ''}
Requested At: ${new Date(requestData.requestedAt).toLocaleString()}

Review and approve this request:
${adminUrl}
          `,
        });

        console.log(`✅ Access request notification email sent to admin`);
      } catch (emailError) {
        console.error("❌ Error sending access request notification email:", emailError);
        // Don't fail the request if email fails
      }
    } else {
      console.warn("⚠️ SMTP not configured - access request notification email not sent");
    }

    return NextResponse.json({
      success: true,
      requestId: docRef.id,
      message: "Access request submitted successfully",
    });
  } catch (error) {
    console.error("❌ Error creating access request:", error);
    return NextResponse.json(
      { error: "Failed to submit request" },
      { status: 500 }
    );
  }
}


export const POST = publicRoute(handlePOST, { limit: 5, windowMs: 3600000 });

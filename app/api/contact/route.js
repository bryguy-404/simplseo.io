import { auth } from '../../lib/firebaseAdmin';
import { requireUser } from '../../lib/server/requestAuth';
import { publicRoute, escapeHtml } from '../../lib/server/publicRequest';
import { NextResponse } from "next/server";
import { db } from "../../lib/firebaseAdmin";
import nodemailer from "nodemailer";

// Create reusable transporter (using Gmail SMTP)
const createTransporter = () => {
  // Use environment variables for SMTP configuration
  // If not set, email sending will be skipped but Firestore save will still work
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: false, // true for 465, false for other ports
    // Force IPv4 to avoid IPv6 connectivity issues
    family: 4,
    // Connection timeout and retry options
    connectionTimeout: 10000, // 10 seconds
    greetingTimeout: 10000,
    socketTimeout: 10000,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // TLS options for better compatibility
    tls: {
      rejectUnauthorized: true, // Allow self-signed certificates (if needed)
    },
  });
};

async function handlePOST(req) {
  try {
    const { name, email, subject, message } = await req.json();
    let userId = null; let userEmail = null;
    if (req.headers.has('authorization')) { userId = await requireUser(req); userEmail = (await auth.getUser(userId)).email || null; }

    // Validation
    if ([name, email, subject, message].some(value => typeof value !== 'string' || !value.trim()) || name.length > 200 || email.length > 254 || message.length > 10000) {
      return NextResponse.json(
        { error: "All fields are required" },
        { status: 400 }
      );
    }

    if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    if (message.trim().length < 10) {
      return NextResponse.json(
        { error: "Message must be at least 10 characters" },
        { status: 400 }
      );
    }

    const validSubjects = ["question", "feedback", "bug", "feature"];
    if (!validSubjects.includes(subject)) {
      return NextResponse.json(
        { error: "Invalid subject" },
        { status: 400 }
      );
    }

    // Save to Firestore
    const contactData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      subject,
      message: message.trim(),
      userId: userId || null,
      userEmail: userEmail || null,
      createdAt: new Date().toISOString(),
      status: "new", // new, read, replied
      readAt: null,
      repliedAt: null,
    };

    // Save to contactMessages collection
    const docRef = await db.collection("contactMessages").add(contactData);

    console.log(`✅ Contact message saved: ${docRef.id}`);

    // Send email to simplseoai@gmail.com
    const transporter = createTransporter();
    if (transporter) {
      try {
        const subjectLabels = {
          question: "Question",
          feedback: "Feedback",
          bug: "Bug Report",
          feature: "Feature Request",
        };

        const subjectLabel = subjectLabels[subject] || "Contact Form";

        await transporter.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: "simplseoai@gmail.com",
          replyTo: email.trim(),
          subject: `[SimplSEO Contact Form] "${subjectLabel}" from ${name.trim()}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #00BF63;">New Contact Form Submission</h2>
              <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Subject:</strong> ${subjectLabel}</p>
                <p><strong>From:</strong> ${escapeHtml(name.trim())} (${escapeHtml(email.trim())})</p>
                ${userId ? `<p><strong>User ID:</strong> ${escapeHtml(userId)}</p>` : ""}
                ${userEmail ? `<p><strong>User Email:</strong> ${escapeHtml(userEmail)}</p>` : ""}
                <p><strong>Submitted:</strong> ${new Date().toLocaleString()}</p>
              </div>
              <div style="background-color: #ffffff; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">
                <h3 style="margin-top: 0;">Message:</h3>
                <p style="white-space: pre-wrap; line-height: 1.6;">${escapeHtml(message.trim()).replace(/\n/g, "<br>")}</p>
              </div>
              <p style="color: #666; font-size: 12px; margin-top: 20px;">
                This email was sent from the SimplSEO contact form.
              </p>
            </div>
          `,
          text: `
New Contact Form Submission

Subject: ${subjectLabel}
From: ${name.trim()} (${email.trim()})
${userId ? `User ID: ${userId}` : ""}
${userEmail ? `User Email: ${userEmail}` : ""}
Submitted: ${new Date().toLocaleString()}

Message:
${message.trim()}

---
This email was sent from the SimpleSEO contact form.
          `,
        });

        console.log(`✅ Email sent to simplseoai@gmail.com for message ${docRef.id}`);
      } catch (emailError) {
        // Log email error but don't fail the request
        console.error("❌ Error sending email (message still saved to Firestore):", emailError);
      }
    } else {
      console.warn("⚠️ SMTP not configured - email not sent, but message saved to Firestore");
    }

    return NextResponse.json({
      success: true,
      messageId: docRef.id,
      message: "Message sent successfully",
    });
  } catch (error) {
    console.error("❌ Error saving contact message:", error);
    return NextResponse.json(
      { error: "Failed to send message" },
      { status: 500 }
    );
  }
}


export const POST = publicRoute(handlePOST, { limit: 5, windowMs: 3600000 });

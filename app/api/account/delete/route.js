import { requireUser, errorResponse } from "../../../lib/server/requestAuth";
import { NextResponse } from "next/server";
import { db, auth } from "../../../lib/firebaseAdmin";
import nodemailer from "nodemailer";

// ============================================
// ADMIN NOTIFICATION FOR ACCOUNT DELETIONS
// ============================================
async function notifyAdminOfDeletion(userInfo) {
  let transporter;

  // Use SendGrid if configured (preferred)
  if (process.env.SENDGRID_API_KEY) {
    transporter = nodemailer.createTransport({
      service: "SendGrid",
      auth: {
        user: "apikey",
        pass: process.env.SENDGRID_API_KEY,
      },
    });
  } else if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    // Fallback to Gmail SMTP
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587"),
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } else {
    console.warn("⚠️ No email config found - skipping admin notification");
    return false;
  }

  try {
    const adminEmail = process.env.ADMIN_EMAIL || process.env.SMTP_USER;
    
    await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@simplseo.io",
      to: adminEmail,
      subject: `🚨 User Deleted Account - ${userInfo.email || "Unknown"}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #ef4444;">🚨 User Account Deleted</h2>
          <p>A user has deleted their SimplSEO account. Consider reaching out for feedback.</p>
          
          <div style="background-color: #1a1a2e; color: #ffffff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ef4444;">
            <h3 style="margin-top: 0; color: #00BF63;">User Details:</h3>
            <p><strong>Email:</strong> ${userInfo.email || "N/A"}</p>
            <p><strong>User ID:</strong> ${userInfo.userId}</p>
            <p><strong>Website:</strong> ${userInfo.website || "N/A"}</p>
            <p><strong>Account Created:</strong> ${userInfo.createdAt || "Unknown"}</p>
            <p><strong>Deleted At:</strong> ${userInfo.deletedAt}</p>
            <p><strong>Days Active:</strong> ${userInfo.daysActive || "Unknown"}</p>
          </div>

          <p style="margin-top: 20px;">
            <strong>Follow up for feedback:</strong><br/>
            ${userInfo.email ? `<a href="mailto:${userInfo.email}?subject=Quick%20Question%20About%20SimplSEO&body=Hi%2C%0A%0AI%20noticed%20you%20recently%20deleted%20your%20SimplSEO%20account.%20I%27d%20love%20to%20hear%20any%20feedback%20you%20have%20-%20what%20could%20we%20have%20done%20better%3F%0A%0AThanks%2C%0ABryan" style="color: #00BF63;">${userInfo.email}</a>` : "Email not available"}
          </p>

          <hr style="border: none; border-top: 1px solid #333; margin: 30px 0;" />
          <p style="font-size: 0.8em; color: #999;">
            This notification was sent from SimplSEO's account deletion system.
          </p>
        </div>
      `,
      text: `User Account Deleted\n\nEmail: ${userInfo.email || "N/A"}\nUser ID: ${userInfo.userId}\nWebsite: ${userInfo.website || "N/A"}\nAccount Created: ${userInfo.createdAt || "Unknown"}\nDeleted At: ${userInfo.deletedAt}\nDays Active: ${userInfo.daysActive || "Unknown"}\n\nConsider reaching out for feedback.`,
    });

    console.log(`📧 Admin notified of account deletion: ${userInfo.email}`);
    return true;
  } catch (error) {
    console.error("❌ Failed to send admin notification:", error);
    return false;
  }
}

export async function POST(req) {
  try {
    const { userId } = await req.json();
    await requireUser(req, userId);

    if (!userId) {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    // ============================================
    // CAPTURE USER INFO BEFORE DELETION
    // ============================================
    let userInfo = { 
      userId,
      deletedAt: new Date().toISOString(),
    };

    // Get email and signup date from Firebase Auth
    try {
      const userRecord = await auth.getUser(userId);
      userInfo.email = userRecord.email;
      userInfo.createdAt = userRecord.metadata?.creationTime;
      
      // Calculate days active
      if (userRecord.metadata?.creationTime) {
        const createdDate = new Date(userRecord.metadata.creationTime);
        const now = new Date();
        const daysActive = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
        userInfo.daysActive = daysActive;
      }
    } catch (e) {
      console.log("⚠️ Could not get auth user:", e.message);
    }

    // Get additional info from Firestore (website, etc.)
    try {
      const userDoc = await db.collection("users").doc(userId).get();
      if (userDoc.exists) {
        const data = userDoc.data();
        userInfo.website = data.gscSiteUrl || data.siteUrl || data.website;
      }
    } catch (e) {
      console.log("⚠️ Could not get user doc:", e.message);
    }

    // Store deleted user record for analytics/follow-up
    try {
      await db.collection("deletedUsers").doc(userId).set({
        ...userInfo,
        notificationSent: false, // Will be updated after email
      });
      console.log("📝 Stored deleted user record for analytics");
    } catch (e) {
      console.log("⚠️ Could not store deleted user record:", e.message);
    }

    // Send admin notification email
    const notificationSent = await notifyAdminOfDeletion(userInfo);
    
    // Update notification status
    if (notificationSent) {
      try {
        await db.collection("deletedUsers").doc(userId).update({
          notificationSent: true,
          notificationSentAt: new Date().toISOString(),
        });
      } catch (e) {
        // Ignore if update fails
      }
    }
    // ============================================

    let deleteCount = 0;

    // 1. Delete onboarding data
    try {
      const onboardingRef = db.collection("onboarding").doc(userId);
      const onboardingSnap = await onboardingRef.get();
      if (onboardingSnap.exists) {
        await onboardingRef.delete();
        deleteCount++;
        console.log("✅ Deleted onboarding data");
      }
    } catch (error) {
      console.log("⚠️ Error deleting onboarding:", error.message);
    }

    // 2. Delete feedbackPrompt subcollection (must be done before deleting user document)
    try {
      const feedbackPromptSnapshot = await db
        .collection("users")
        .doc(userId)
        .collection("feedbackPrompt")
        .get();
      
      if (feedbackPromptSnapshot.docs.length > 0) {
        const batchFeedback = db.batch();
        feedbackPromptSnapshot.docs.forEach((doc) => {
          batchFeedback.delete(doc.ref);
          deleteCount++;
        });
        await batchFeedback.commit();
        console.log(`✅ Deleted ${feedbackPromptSnapshot.docs.length} feedbackPrompt documents`);
      }
    } catch (error) {
      console.log("⚠️ Error deleting feedbackPrompt:", error.message);
    }

    // Recovery history is a nested collection and must not survive account deletion.
    await db.recursiveDelete(db.collection('users').doc(userId).collection('revampHistory'));
    const oauthStates = await db.collection('gscOAuthStates').where('uid', '==', userId).get();
    for (const state of oauthStates.docs) await state.ref.delete();

    // 3. Delete user profile data
    try {
      const userRef = db.collection("users").doc(userId);
      const userSnap = await userRef.get();
      if (userSnap.exists) {
        await userRef.delete();
        deleteCount++;
        console.log("✅ Deleted user profile data");
      }
    } catch (error) {
      console.log("⚠️ Error deleting user profile:", error.message);
    }

    // 4. Delete implementedSeoTips
    try {
      const implementedSeoTipsSnapshot = await db
        .collection("implementedSeoTips")
        .where("userId", "==", userId)
        .get();
      
      const batch1 = db.batch();
      implementedSeoTipsSnapshot.docs.forEach((doc) => {
        batch1.delete(doc.ref);
        deleteCount++;
      });
      if (implementedSeoTipsSnapshot.docs.length > 0) {
        await batch1.commit();
        console.log(`✅ Deleted ${implementedSeoTipsSnapshot.docs.length} implementedSeoTips documents`);
      }
    } catch (error) {
      console.log("⚠️ Error deleting implementedSeoTips:", error.message);
    }

    // 5. Delete intentMismatches (both structures)
    try {
      // New structure: intentMismatches/{userId}/analyses
      try {
        const newAnalysesSnapshot = await db
          .collection("intentMismatches")
          .doc(userId)
          .collection("analyses")
          .get();
        
        const batch2a = db.batch();
        newAnalysesSnapshot.docs.forEach((doc) => {
          batch2a.delete(doc.ref);
          deleteCount++;
        });
        if (newAnalysesSnapshot.docs.length > 0) {
          await batch2a.commit();
          console.log(`✅ Deleted ${newAnalysesSnapshot.docs.length} intentMismatches from new structure`);
        }
      } catch (error) {
        console.log("⚠️ Error deleting from new intentMismatches structure:", error.message);
      }

      // Old structure: intentMismatches (flat)
      try {
        const intentMismatchesSnapshot = await db
          .collection("intentMismatches")
          .where("userId", "==", userId)
          .get();
        
        const batch2b = db.batch();
        intentMismatchesSnapshot.docs.forEach((doc) => {
          batch2b.delete(doc.ref);
          deleteCount++;
        });
        if (intentMismatchesSnapshot.docs.length > 0) {
          await batch2b.commit();
          console.log(`✅ Deleted ${intentMismatchesSnapshot.docs.length} intentMismatches from old structure`);
        }
      } catch (error) {
        console.log("⚠️ Error deleting from old intentMismatches structure:", error.message);
      }
    } catch (error) {
      console.log("⚠️ Error deleting intentMismatches:", error.message);
    }

    // 6. Delete internalLinkSuggestions
    try {
      const internalLinkSnapshot = await db
        .collection("internalLinkSuggestions")
        .where("userId", "==", userId)
        .get();
      
      const batch3 = db.batch();
      internalLinkSnapshot.docs.forEach((doc) => {
        batch3.delete(doc.ref);
        deleteCount++;
      });
      if (internalLinkSnapshot.docs.length > 0) {
        await batch3.commit();
        console.log(`✅ Deleted ${internalLinkSnapshot.docs.length} internalLinkSuggestions documents`);
      }
    } catch (error) {
      console.log("⚠️ Error deleting internalLinkSuggestions:", error.message);
    }

    // 7. Delete contentAuditResults
    try {
      const contentAuditSnapshot = await db
        .collection("contentAuditResults")
        .where("userId", "==", userId)
        .get();
      
      const batch4 = db.batch();
      contentAuditSnapshot.docs.forEach((doc) => {
        batch4.delete(doc.ref);
        deleteCount++;
      });
      if (contentAuditSnapshot.docs.length > 0) {
        await batch4.commit();
        console.log(`✅ Deleted ${contentAuditSnapshot.docs.length} contentAuditResults documents`);
      }
    } catch (error) {
      console.log("⚠️ Error deleting contentAuditResults:", error.message);
    }

    // 8. Delete aiSuggestions
    try {
      const aiSuggestionsSnapshot = await db
        .collection("aiSuggestions")
        .where("userId", "==", userId)
        .get();
      
      const batch5 = db.batch();
      aiSuggestionsSnapshot.docs.forEach((doc) => {
        batch5.delete(doc.ref);
        deleteCount++;
      });
      if (aiSuggestionsSnapshot.docs.length > 0) {
        await batch5.commit();
        console.log(`✅ Deleted ${aiSuggestionsSnapshot.docs.length} aiSuggestions documents`);
      }
    } catch (error) {
      console.log("⚠️ Error deleting aiSuggestions:", error.message);
    }

    // 9. Delete pageContentCache (both structures)
    try {
      // New structure: pageContentCache/{userId}/pages
      try {
        const newPagesSnapshot = await db
          .collection("pageContentCache")
          .doc(userId)
          .collection("pages")
          .get();
        
        if (newPagesSnapshot.docs.length > 0) {
          const batch6a = db.batch();
          newPagesSnapshot.docs.forEach((doc) => {
            batch6a.delete(doc.ref);
            deleteCount++;
          });
          await batch6a.commit();
          console.log(`✅ Deleted ${newPagesSnapshot.docs.length} pageContentCache from new structure`);
        }
      } catch (error) {
        console.error("❌ Error deleting from new pageContentCache structure:", error.message);
      }

      // Old structure: pageContentCache (flat)
      try {
        const pageCacheSnapshot = await db
          .collection("pageContentCache")
          .where("userId", "==", userId)
          .get();
        
        if (pageCacheSnapshot.docs.length > 0) {
          const batch6b = db.batch();
          pageCacheSnapshot.docs.forEach((doc) => {
            batch6b.delete(doc.ref);
            deleteCount++;
          });
          await batch6b.commit();
          console.log(`✅ Deleted ${pageCacheSnapshot.docs.length} pageContentCache from old structure`);
        }
      } catch (error) {
        console.error("❌ Error deleting from old pageContentCache structure:", error.message);
      }
    } catch (error) {
      console.log("⚠️ Error deleting pageContentCache:", error.message);
    }

    // 10. Delete siteCrawls
    try {
      const siteCrawlsRef = db.collection("siteCrawls").doc(userId);
      const siteCrawlsSnap = await siteCrawlsRef.get();
      if (siteCrawlsSnap.exists) {
        await siteCrawlsRef.delete();
        deleteCount++;
        console.log("✅ Deleted siteCrawls data");
      }
    } catch (error) {
      console.error("❌ Error deleting siteCrawls:", error.message);
    }

    // 11. Delete focusKeywords
    try {
      const focusKeywordsRef = db.collection("focusKeywords").doc(userId);
      const focusKeywordsSnap = await focusKeywordsRef.get();
      if (focusKeywordsSnap.exists) {
        await focusKeywordsRef.delete();
        deleteCount++;
        console.log("✅ Deleted focusKeywords data");
      }
    } catch (error) {
      console.error("❌ Error deleting focusKeywords:", error.message);
    }

    // 12. Delete conversations
    try {
      const conversationsSnapshot = await db
        .collection("conversations")
        .where("userId", "==", userId)
        .get();
      
      const batch7 = db.batch();
      conversationsSnapshot.docs.forEach((doc) => {
        batch7.delete(doc.ref);
        deleteCount++;
      });
      if (conversationsSnapshot.docs.length > 0) {
        await batch7.commit();
        console.log(`✅ Deleted ${conversationsSnapshot.docs.length} conversations`);
      }
    } catch (error) {
      console.log("⚠️ Error deleting conversations:", error.message);
    }

    // 13. Delete seoMetaTitles (both structures)
    try {
      // New structure: seoMetaTitles/{userId}/titles
      try {
        const newTitlesSnapshot = await db
          .collection("seoMetaTitles")
          .doc(userId)
          .collection("titles")
          .get();
        
        if (newTitlesSnapshot.docs.length > 0) {
          const batch8a = db.batch();
          newTitlesSnapshot.docs.forEach((doc) => {
            batch8a.delete(doc.ref);
            deleteCount++;
          });
          await batch8a.commit();
          console.log(`✅ Deleted ${newTitlesSnapshot.docs.length} seoMetaTitles from new structure`);
        }
      } catch (error) {
        console.error("❌ Error deleting from new seoMetaTitles structure:", error.message);
      }

      // Old structure: seoMetaTitles (flat)
      try {
        const seoTitlesSnapshot = await db
          .collection("seoMetaTitles")
          .where("userId", "==", userId)
          .get();
        
        if (seoTitlesSnapshot.docs.length > 0) {
          const batch8b = db.batch();
          seoTitlesSnapshot.docs.forEach((doc) => {
            batch8b.delete(doc.ref);
            deleteCount++;
          });
          await batch8b.commit();
          console.log(`✅ Deleted ${seoTitlesSnapshot.docs.length} seoMetaTitles from old structure`);
        }
      } catch (error) {
        console.error("❌ Error deleting from old seoMetaTitles structure:", error.message);
      }
    } catch (error) {
      console.log("⚠️ Error deleting seoMetaTitles:", error.message);
    }

    // 14. Delete seoMetaDescriptions (both structures)
    try {
      // New structure: seoMetaDescriptions/{userId}/descriptions
      try {
        const newDescriptionsSnapshot = await db
          .collection("seoMetaDescriptions")
          .doc(userId)
          .collection("descriptions")
          .get();
        
        if (newDescriptionsSnapshot.docs.length > 0) {
          const batch9a = db.batch();
          newDescriptionsSnapshot.docs.forEach((doc) => {
            batch9a.delete(doc.ref);
            deleteCount++;
          });
          await batch9a.commit();
          console.log(`✅ Deleted ${newDescriptionsSnapshot.docs.length} seoMetaDescriptions from new structure`);
        }
      } catch (error) {
        console.error("❌ Error deleting from new seoMetaDescriptions structure:", error.message);
      }

      // Old structure: seoMetaDescriptions (flat)
      try {
        const seoDescriptionsSnapshot = await db
          .collection("seoMetaDescriptions")
          .where("userId", "==", userId)
          .get();
        
        if (seoDescriptionsSnapshot.docs.length > 0) {
          const batch9b = db.batch();
          seoDescriptionsSnapshot.docs.forEach((doc) => {
            batch9b.delete(doc.ref);
            deleteCount++;
          });
          await batch9b.commit();
          console.log(`✅ Deleted ${seoDescriptionsSnapshot.docs.length} seoMetaDescriptions from old structure`);
        }
      } catch (error) {
        console.error("❌ Error deleting from old seoMetaDescriptions structure:", error.message);
      }
    } catch (error) {
      console.log("⚠️ Error deleting seoMetaDescriptions:", error.message);
    }

    // 15. Delete genericKeywordsCache
    try {
      const genericKeywordsSnapshot = await db
        .collection("genericKeywordsCache")
        .where("userId", "==", userId)
        .get();
      
      if (genericKeywordsSnapshot.docs.length > 0) {
        const batch10 = db.batch();
        genericKeywordsSnapshot.docs.forEach((doc) => {
          batch10.delete(doc.ref);
          deleteCount++;
        });
        await batch10.commit();
        console.log(`✅ Deleted ${genericKeywordsSnapshot.docs.length} genericKeywordsCache documents`);
      }
    } catch (error) {
      console.error("❌ Error deleting genericKeywordsCache:", error.message);
    }

    // 16. Delete contentKeywordEdits
    try {
      const contentKeywordEditsRef = db.collection("contentKeywordEdits").doc(userId);
      const contentKeywordEditsSnap = await contentKeywordEditsRef.get();
      if (contentKeywordEditsSnap.exists) {
        await contentKeywordEditsRef.delete();
        deleteCount++;
        console.log("✅ Deleted contentKeywordEdits data");
      }
    } catch (error) {
      console.error("❌ Error deleting contentKeywordEdits:", error.message);
    }

    console.log(`✅ Successfully deleted ${deleteCount} documents for user ${userId}`);

    return NextResponse.json({
      success: true,
      deletedCount: deleteCount,
      message: `Successfully deleted ${deleteCount} documents`,
    });
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("Error deleting user data:", error);
    return NextResponse.json(
      { error: "Failed to delete user data", details: error.message },
      { status: 500 }
    );
  }
}


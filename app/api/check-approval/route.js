import { publicRoute, escapeHtml } from '../../lib/server/publicRequest';
import { NextResponse } from "next/server";
import { db } from "../../lib/firebaseAdmin";

async function handleGET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const email = searchParams.get("email");

    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check approvedUsers collection
    const approvedUserDoc = await db.collection("approvedUsers").doc(normalizedEmail).get();

    if (approvedUserDoc.exists) {
      const data = approvedUserDoc.data();
      return NextResponse.json({
        approved: true,
        email: normalizedEmail,


      });
    }

    // Also check accessRequests for pending/approved status
    const requestsSnapshot = await db
      .collection("accessRequests")
      .where("email", "==", normalizedEmail)
      .get();

    if (!requestsSnapshot.empty) {
      const requestData = requestsSnapshot.docs[0].data();
      return NextResponse.json({
        approved: requestData.status === "approved",
        email: normalizedEmail,
        status: requestData.status,

      });
    }

    // No record found - not approved
    return NextResponse.json({
      approved: false,
      email: normalizedEmail,
      status: "not_found",
    });
  } catch (error) {
    console.error("❌ Error checking approval:", error);
    return NextResponse.json(
      { error: "Failed to check approval" },
      { status: 500 }
    );
  }
}


export const GET = publicRoute(handleGET, { limit: 60, windowMs: 60000 });

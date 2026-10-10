import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';


import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

// Normalize URL for consistent lookups
function normalizePageUrl(url) {
  if (!url) return url;
  // Remove trailing slash except for root
  const normalized = url.replace(/\/$/, '');
  return normalized;
}

async function handlePOST(request) {
  try {
    const { userId, pageUrl } = await request.json();

    if (!userId || !pageUrl) {
      return NextResponse.json(
        { error: "userId and pageUrl are required" },
        { status: 400 }
      );
    }

    const normalizedPageUrl = normalizePageUrl(pageUrl);
    let h1 = null;

    try {
      // Try NEW structure first: pageContentCache/{userId}/pages/{pageUrl}
      const encodedUrl = encodeURIComponent(normalizedPageUrl);
      const newDocRef = db
        .collection("pageContentCache")
        .doc(userId)
        .collection("pages")
        .doc(encodedUrl);
      
      const newDoc = await newDocRef.get();
      
      if (newDoc.exists) {
        const data = newDoc.data();
        console.log(`✅ Found page content in new structure for: ${pageUrl}`);
        console.log(`📋 Headings array length: ${data.headings?.length || 0}`);
        
        // Try multiple formats for H1
        if (data.h1) {
          h1 = data.h1;
          console.log(`✅ Found H1 field: ${h1}`);
        } else if (data.headings && Array.isArray(data.headings) && data.headings.length > 0) {
          // Since navigation is filtered at source, first heading should be the H1
          const firstHeading = data.headings[0];
          console.log(`📄 First heading: ${firstHeading}`);
          
          if (typeof firstHeading === "string") {
            h1 = firstHeading.trim();
            console.log(`✅ Using first heading as H1: ${h1}`);
          } else if (firstHeading && typeof firstHeading === "object") {
            // Object format - check for tag or use text
            if (firstHeading.tag && firstHeading.tag.toLowerCase() === "h1") {
              h1 = firstHeading.text || firstHeading.content || String(firstHeading);
            } else if (firstHeading.text) {
              h1 = firstHeading.text;
            } else if (firstHeading.content) {
              h1 = firstHeading.content;
            }
          }
        } else {
          console.log(`⚠️ No headings found in document`);
        }
      } else {
        console.log(`⚠️ Document not found in new structure, trying old structure...`);
        
        // Fallback to OLD structure: pageContentCache/{userId}_{pageUrl}
        const oldKey = `${userId}_${encodedUrl}`;
        const oldDocRef = db.collection("pageContentCache").doc(oldKey);
        const oldDoc = await oldDocRef.get();
        
        if (oldDoc.exists) {
          const data = oldDoc.data();
          console.log(`✅ Found page content in old structure`);
          console.log(`📋 Headings array length: ${data.headings?.length || 0}`);
          
          // Try multiple formats for H1
          if (data.h1) {
            h1 = data.h1;
            console.log(`✅ Found H1 field: ${h1}`);
          } else if (data.headings && Array.isArray(data.headings) && data.headings.length > 0) {
            const firstHeading = data.headings[0];
            console.log(`📄 First heading: ${firstHeading}`);
            
            if (typeof firstHeading === "string") {
              h1 = firstHeading.trim();
              console.log(`✅ Using first heading as H1: ${h1}`);
            } else if (firstHeading && typeof firstHeading === "object") {
              if (firstHeading.tag && firstHeading.tag.toLowerCase() === "h1") {
                h1 = firstHeading.text || firstHeading.content || String(firstHeading);
              } else if (firstHeading.text) {
                h1 = firstHeading.text;
              } else if (firstHeading.content) {
                h1 = firstHeading.content;
              }
            }
          }
        } else {
          console.log(`❌ Document not found in either structure for: ${pageUrl}`);
        }
      }
    } catch (error) {
      console.error("Error fetching H1:", error);
    }

    console.log(`🔍 Returning H1: ${h1 || "(null)"}`);
    return NextResponse.json({
      h1,
    });
  } catch (error) {
    console.error("Failed to fetch H1:", error);
    return NextResponse.json(
      { error: "Failed to fetch H1" },
      { status: 500 }
    );
  }
}


export const POST = authenticatedRoute(handlePOST);

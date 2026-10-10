import { publicFetch } from '../../../lib/server/publicFetch';
import { requireUser, errorResponse } from "../../../lib/server/requestAuth";
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

export async function POST(req) {
  try {
    const { url, userId: suppliedUserId } = await req.json();
    const userId = await requireUser(req, suppliedUserId);
    const websiteUrl = (await db.collection("onboarding").doc(userId).get()).data()?.websiteUrl;

    if (!url || !websiteUrl) {
      return NextResponse.json(
        { error: "url and websiteUrl are required" },
        { status: 400 }
      );
    }

    // Normalize URLs — auto-prepend https:// if missing
    const ensureProtocol = (u) =>
      /^https?:\/\//i.test(u) ? u : `https://${u}`;

    let parsedUrl, parsedSite;
    try {
      parsedUrl = new URL(ensureProtocol(url));
    } catch {
      return NextResponse.json(
        { valid: false, reason: "Invalid URL format" },
        { status: 200 }
      );
    }

    try {
      parsedSite = new URL(ensureProtocol(websiteUrl));
    } catch {
      return NextResponse.json(
        { valid: false, reason: "Invalid website URL" },
        { status: 200 }
      );
    }

    // Check domain match (strip www for comparison)
    const stripWww = (host) => host.replace(/^www\./, "").toLowerCase();
    if (stripWww(parsedUrl.hostname) !== stripWww(parsedSite.hostname)) {
      return NextResponse.json(
        {
          valid: false,
          reason: `URL must belong to ${parsedSite.hostname}`,
        },
        { status: 200 }
      );
    }

    // Check if the URL returns content (HEAD request with GET fallback)
    const fetchUrl = parsedUrl.href;
    try {
      let response = await publicFetch(fetchUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });

      // Some servers don't support HEAD, try GET
      if (response.status === 405 || response.status === 403) {
        response = await publicFetch(fetchUrl, {
          method: "GET",
          redirect: "follow",
          signal: AbortSignal.timeout(10000),
        });
      }

      if (response.ok) {
        const finalUrl = new URL(response.url);
        if (stripWww(finalUrl.hostname) !== stripWww(parsedSite.hostname)) return NextResponse.json({ valid: false, reason: 'This page redirects outside your website.' });
        return NextResponse.json({ valid: true, url: fetchUrl, finalUrl: finalUrl.href });
      }

      return NextResponse.json(
        {
          valid: false,
          reason: `Page returned status ${response.status}`,
        },
        { status: 200 }
      );
    } catch (fetchError) {
      return NextResponse.json(
        {
          valid: false,
          reason: "Could not reach the URL. Make sure the page is live.",
        },
        { status: 200 }
      );
    }
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("URL validation failed:", error);
    return NextResponse.json(
      { error: "Validation failed", details: error.message },
      { status: 500 }
    );
  }
}

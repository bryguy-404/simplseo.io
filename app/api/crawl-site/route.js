import { requireUser, errorResponse } from "../../lib/server/requestAuth";
import { NextResponse } from "next/server";
import { XMLParser } from "fast-xml-parser";
import * as cheerio from "cheerio";
import { db, admin } from "../../lib/firebaseAdmin";

const DEFAULT_MAX_PAGES = 25;
const MAX_LOW_SIGNAL_PAGES = 5;
const SCRAPE_BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

const WEIGHTS = {
  manual: 120,
  root: 110,
  nav: 100,
  priority: 95,
  approved: 90,
  sitemap: 70,
  fallback: 60,
};

const normalizeCandidateUrl = (url, origin) => {
  if (!url) return null;
  try {
    const originUrl = new URL(origin);
    const originHostname = originUrl.hostname.replace(/^www\./, ""); // Normalize: remove www
    
    const normalized = new URL(url, origin).toString();
    const cleaned = normalized.split("#")[0].replace(/\/$/, "");
    const cleanedUrl = new URL(cleaned);
    const cleanedHostname = cleanedUrl.hostname.replace(/^www\./, ""); // Normalize: remove www
    
    // Compare hostnames (without www) instead of full origins
    if (cleanedHostname !== originHostname) {
      return null;
    }
    return cleaned;
  } catch {
    return null;
  }
};

const sanitizeUrls = (values, origin) => {
  if (!Array.isArray(values)) return [];
  const sanitized = values
    .map((value) => normalizeCandidateUrl(value, origin))
    .filter(Boolean);
  return Array.from(new Set(sanitized));
};

const normalizeUrl = (websiteUrl) => {
  if (!websiteUrl) return null;
  try {
    const hasProtocol = websiteUrl.startsWith("http://") || websiteUrl.startsWith("https://");
    const url = new URL(hasProtocol ? websiteUrl : `https://${websiteUrl}`);
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
};

const fetchSitemapUrls = async (origin) => {
  const parser = new XMLParser();
  const possibleSitemaps = [
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
  ];

  const discovered = new Set();

  for (const sitemapUrl of possibleSitemaps) {
    try {
      const res = await fetch(sitemapUrl, {
        cache: "no-store",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      const json = parser.parse(xml);

      if (json.urlset?.url) {
        const urls = Array.isArray(json.urlset.url)
          ? json.urlset.url
          : [json.urlset.url];
        urls.forEach((entry) => {
          if (entry?.loc) discovered.add(entry.loc);
        });
      }

      if (json.sitemapindex?.sitemap) {
        const childSitemaps = Array.isArray(json.sitemapindex.sitemap)
          ? json.sitemapindex.sitemap
          : [json.sitemapindex.sitemap];

        for (const child of childSitemaps) {
          if (!child?.loc) continue;
          try {
            const childRes = await fetch(child.loc, {
              cache: "no-store",
              headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
            });
            if (!childRes.ok) continue;
            const childXml = await childRes.text();
            const childJson = parser.parse(childXml);
            const urls = childJson.urlset?.url || [];
            const normalized = Array.isArray(urls) ? urls : [urls];
            normalized.forEach((entry) => {
              if (entry?.loc) discovered.add(entry.loc);
            });
          } catch (error) {
            console.warn(`⚠️ Failed to fetch child sitemap ${child.loc}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️ Unable to fetch sitemap ${sitemapUrl}:`, error.message);
    }
  }

  return Array.from(discovered);
};

const fetchNavLinks = async (homepageUrl) => {
  try {
    const res = await fetch(`${SCRAPE_BASE_URL}/api/scrape-content`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageUrl: homepageUrl }),
    });

    if (!res.ok) {
      return [];
    }

    const json = await res.json();
    const links = Array.isArray(json?.data?.links) ? json.data.links : [];
    const filtered = links
      .map((link) => link?.href || "")
      .filter(Boolean)
      .map((href) => {
        try {
          return new URL(href, homepageUrl).toString();
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((url) => url.startsWith(homepageUrl));

    return Array.from(new Set(filtered));
  } catch (error) {
    console.warn("⚠️ Failed to fetch nav links:", error.message);
    return [];
  }
};

const junkPatterns = [
  "/tag/",
  "/category/",
  "/author/",
  "/feed",
  "/wp-json",
  "/wp-admin",
  "/format",
  "/sample",
  "/archive",
  "/test-",
  "/lorem",
  "/ipsum",
  "/demo",
  "/draft",
  "/placeholder",
  "/temp",
  "?",
  "#",
  "format-",
];

const isLikelyJunk = (url) => {
  return junkPatterns.some((pattern) =>
    url.toLowerCase().includes(pattern.toLowerCase())
  );
};

const toDepth = (url) => {
  try {
    const { pathname } = new URL(url);
    return pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
};

export async function POST(req) {
  let requestPayload;
  try {
    requestPayload = await req.json();
    const {
      userId,
      websiteUrl,
      maxPages = DEFAULT_MAX_PAGES,
      priorityUrls = [],
      approvedUrls: providedApproved = null,
      excludedUrls: providedExcluded = null,
      manualUrls: providedManual = null,
      mode = "confirmed",
    } = requestPayload;
    await requireUser(req, userId);

    if (!userId || !websiteUrl) {
      return NextResponse.json(
        { error: "userId and websiteUrl are required" },
        { status: 400 }
      );
    }

    const normalizedWebsite = normalizeUrl(websiteUrl);
    if (!normalizedWebsite) {
      return NextResponse.json(
        { error: "Invalid website URL" },
        { status: 400 }
      );
    }

    const origin = new URL(normalizedWebsite).origin;

    const crawlDocRef = db.collection("siteCrawls").doc(userId);
    const crawlSnap = await crawlDocRef.get();
    const storedPrefs = crawlSnap.exists ? crawlSnap.data() : {};

    const storedApproved = sanitizeUrls(storedPrefs?.approvedUrls, origin);
    const storedExcluded = sanitizeUrls(storedPrefs?.excludedUrls, origin);
    const storedManual = sanitizeUrls(storedPrefs?.manualUrls, origin);
    const storedPriority = sanitizeUrls(storedPrefs?.priorityUrls, origin);

    const sanitizedApproved =
      providedApproved !== null
        ? sanitizeUrls(providedApproved, origin)
        : storedApproved;
    const sanitizedExcluded =
      providedExcluded !== null
        ? sanitizeUrls(providedExcluded, origin)
        : storedExcluded;
    const sanitizedManual =
      providedManual !== null
        ? sanitizeUrls(providedManual, origin)
        : storedManual;

    const priorityCombined = Array.from(
      new Set([
        ...sanitizeUrls(priorityUrls, origin),
        ...storedPriority,
        ...sanitizedApproved,
      ])
    );

    const excludedSet = new Set(sanitizedExcluded);
    const finalManual = sanitizedManual.filter((url) => !excludedSet.has(url));
    const finalApproved = sanitizedApproved.filter(
      (url) => !excludedSet.has(url)
    );
    const filteredPriorityCombined = priorityCombined.filter(
      (url) => !excludedSet.has(url)
    );

    const isInitialReview = mode === "initial";

    await crawlDocRef.set(
      {
        status: "in-progress",
        websiteUrl: origin,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        maxPages,
        approvedUrls: finalApproved,
        excludedUrls: Array.from(excludedSet),
        manualUrls: finalManual,
        priorityUrls: filteredPriorityCombined,
      },
      { merge: true }
    );

    await db.collection("onboarding").doc(userId).set(
      {
        siteCrawlStatus: "in-progress",
      },
      { merge: true }
    );

    const navLinks = sanitizeUrls(
      await fetchNavLinks(normalizedWebsite),
      origin
    );
    const sitemapUrls = sanitizeUrls(await fetchSitemapUrls(origin), origin);

    const candidateMap = new Map();

    const addCandidate = (url, options = {}) => {
      const normalized = normalizeCandidateUrl(url, origin);
      if (!normalized) return;
      if (excludedSet.has(normalized)) return;

      const existing = candidateMap.get(normalized);
      const tags = new Set(existing?.tags || []);
      if (options.tag) tags.add(options.tag);

      const weight = Math.max(
        options.weight ?? WEIGHTS.fallback,
        existing?.weight ?? Number.NEGATIVE_INFINITY
      );

      candidateMap.set(normalized, {
        url: normalized,
        tags,
        weight,
        isNav: options.isNav || existing?.isNav || false,
      });
    };

    addCandidate(normalizedWebsite, { tag: "root", weight: WEIGHTS.root });

    finalManual.forEach((url) =>
      addCandidate(url, { tag: "manual", weight: WEIGHTS.manual })
    );

    navLinks.forEach((url) =>
      addCandidate(url, { tag: "nav", weight: WEIGHTS.nav, isNav: true })
    );

    filteredPriorityCombined.forEach((url) =>
      addCandidate(url, { tag: "priority", weight: WEIGHTS.priority })
    );

    finalApproved.forEach((url) =>
      addCandidate(url, { tag: "approved", weight: WEIGHTS.approved })
    );

    sitemapUrls.forEach((url) =>
      addCandidate(url, { tag: "sitemap", weight: WEIGHTS.sitemap })
    );

    const candidateList = Array.from(candidateMap.values()).map((entry) => {
      let adjustedWeight = entry.weight - toDepth(entry.url) * 2;
      if (isLikelyJunk(entry.url)) {
        adjustedWeight -= 15;
        entry.tags.add("low-signal");
      }
      return {
        ...entry,
        weight: adjustedWeight,
      };
    });

    const isHighPriority = (entry) =>
      entry.tags.has("manual") ||
      entry.tags.has("nav") ||
      entry.tags.has("priority") ||
      entry.tags.has("approved") ||
      entry.tags.has("root");

    const highPriority = candidateList
      .filter(isHighPriority)
      .sort((a, b) => b.weight - a.weight);

    const lowPriority = candidateList
      .filter((entry) => !isHighPriority(entry))
      .sort((a, b) => b.weight - a.weight);

    const limitedHigh = highPriority.slice(0, maxPages);
    const remainingSlots = Math.max(0, maxPages - limitedHigh.length);
    const limitedLow =
      remainingSlots > 0
        ? lowPriority.slice(0, Math.min(MAX_LOW_SIGNAL_PAGES, remainingSlots))
        : [];

    let targetEntries = [...limitedHigh, ...limitedLow]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, maxPages)
      .map((entry, index) => ({
        ...entry,
        crawlOrder: index,
      }));

    targetEntries = targetEntries.filter(
      (entry) => !excludedSet.has(entry.url)
    );

    let processed = 0;
    const errors = [];
    const processedPages = [];
    const pendingPages = [];
    const crawledUrls = new Set();
    const discoveredUrls = new Set(targetEntries.map((e) => e.url));
    const linkQueue = [];

    // Helper function to extract links from scraped HTML
    const extractLinksFromHtml = (html, baseUrl) => {
      try {
        const $ = cheerio.load(html);
        const links = [];
        $("a[href]").each((i, el) => {
          const href = $(el).attr("href");
          if (!href) return;
          try {
            const normalized = new URL(href, baseUrl).toString();
            const cleaned = normalized.split("#")[0].replace(/\/$/, "");
            if (cleaned.startsWith(origin) && !excludedSet.has(cleaned)) {
              links.push(cleaned);
            }
          } catch {
            // Invalid URL, skip
          }
        });
        return Array.from(new Set(links));
      } catch {
        return [];
      }
    };

    // Process initial target entries
    for (const entry of targetEntries) {
      const { url, tags, isNav, crawlOrder } = entry;
      crawledUrls.add(url);
      
      try {
        // Fetch the page HTML directly to extract links
        const pageRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
        });

        if (!pageRes.ok) {
          throw new Error(`Failed to fetch page: ${pageRes.status}`);
        }

        const html = await pageRes.text();

        // Extract links from this page and add to queue if not already discovered
        const pageLinks = extractLinksFromHtml(html, url);
        for (const linkUrl of pageLinks) {
          if (!discoveredUrls.has(linkUrl) && !crawledUrls.has(linkUrl)) {
            discoveredUrls.add(linkUrl);
            linkQueue.push({
              url: linkUrl,
              tags: new Set(["discovered"]),
              weight: WEIGHTS.fallback - 10,
            });
          }
        }

        // Now scrape the content using the API
        const scrapeRes = await fetch(`${SCRAPE_BASE_URL}/api/scrape-content`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageUrl: url }),
        });

        if (!scrapeRes.ok) {
          throw new Error(`Scrape failed with status ${scrapeRes.status}`);
        }

        const scrapeJson = await scrapeRes.json();
        if (!scrapeJson?.data) {
          throw new Error("No data returned from scrape endpoint");
        }

        const cachedAt = new Date().toISOString();
        const tagList = Array.from(tags);
        const title =
          scrapeJson?.data?.title ||
          scrapeJson?.data?.metaTitle ||
          scrapeJson?.data?.meta?.title ||
          url.replace(/^https?:\/\//, "");
        const isKept = !excludedSet.has(url);
        const basePageRecord = {
          pageUrl: url,
          title,
          isNavLink: !!isNav || tags.has("nav"),
          crawlOrder,
          tags: tagList,
          cachedAt,
          kept: isKept,
        };

        if (isInitialReview) {
          pendingPages.push(basePageRecord);
        } else {
          // Use backward-compatible helper (writes to both structures)
          const { cachePageContent } = await import("../../lib/firestoreMigrationHelpers");
          await cachePageContent(userId, url, {
              ...scrapeJson.data,
              source: "site-crawl",
              isNavLink: basePageRecord.isNavLink,
              crawlOrder,
              crawlTags: tagList,
          });
        }

        processed += 1;
        processedPages.push(basePageRecord);
      } catch (error) {
        console.warn(`⚠️ Failed to crawl ${url}:`, error.message);
        errors.push({ url, message: error.message });
      }
    }

    // Process discovered links if we haven't reached maxPages and this is initial review
    if (isInitialReview && processed < maxPages && linkQueue.length > 0) {
      // Sort discovered links by weight and depth
      const sortedLinks = linkQueue
        .map((entry) => {
          let adjustedWeight = entry.weight - toDepth(entry.url) * 2;
          if (isLikelyJunk(entry.url)) {
            adjustedWeight -= 15;
          }
          return { ...entry, adjustedWeight };
        })
        .sort((a, b) => b.adjustedWeight - a.adjustedWeight)
        .slice(0, maxPages - processed);

      // Process discovered links
      for (let i = 0; i < sortedLinks.length && processed < maxPages; i++) {
        const entry = sortedLinks[i];
        const { url, tags } = entry;
        
        if (crawledUrls.has(url)) continue;

        try {
          const pageRes = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.5",
            },
          });

          if (!pageRes.ok) continue;

          const html = await pageRes.text();
          
          // Extract more links from this discovered page
          const pageLinks = extractLinksFromHtml(html, url);
          for (const linkUrl of pageLinks) {
            if (!discoveredUrls.has(linkUrl) && !crawledUrls.has(linkUrl)) {
              discoveredUrls.add(linkUrl);
              linkQueue.push({
                url: linkUrl,
                tags: new Set(["discovered"]),
                weight: WEIGHTS.fallback - 10,
              });
            }
          }

          const scrapeRes = await fetch(`${SCRAPE_BASE_URL}/api/scrape-content`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageUrl: url }),
          });

          if (!scrapeRes.ok) continue;

          const scrapeJson = await scrapeRes.json();
          if (!scrapeJson?.data) continue;

          const cachedAt = new Date().toISOString();
          const tagList = Array.from(tags || []);
          const title =
            scrapeJson?.data?.title ||
            scrapeJson?.data?.metaTitle ||
            scrapeJson?.data?.meta?.title ||
            url.replace(/^https?:\/\//, "");
          const isKept = !excludedSet.has(url);
          const basePageRecord = {
            pageUrl: url,
            title,
            isNavLink: tags?.has("nav") || false,
            crawlOrder: processed,
            tags: tagList,
            cachedAt,
            kept: isKept,
          };

          pendingPages.push(basePageRecord);
          crawledUrls.add(url);
          processed += 1;
          processedPages.push(basePageRecord);
        } catch (error) {
          console.warn(`⚠️ Failed to crawl discovered page ${url}:`, error.message);
        }
      }
    }

    if (processed === 0 && errors.length > 0) {
      throw new Error('No pages could be scanned. Existing pages and preferences have been preserved.');
    }
    const targetUrlSet = new Set(targetEntries.map((entry) => entry.url));
    // A bounded scan cannot prove that absent URLs were retired. Preserve existing caches.

    if (isInitialReview) {
      await crawlDocRef.set(
        {
          status: "awaiting-review",
          pendingPages,
          pendingGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
          pageCount: processed,
          errorCount: errors.length,
          lastRun: admin.firestore.FieldValue.serverTimestamp(),
          approvedUrls: finalApproved,
          excludedUrls: Array.from(excludedSet),
          manualUrls: finalManual,
          priorityUrls: filteredPriorityCombined,
        },
        { merge: true }
      );

      await db.collection("onboarding").doc(userId).set(
        {
          siteCrawlStatus: "awaiting-review",
          lastSiteCrawlAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return NextResponse.json({
        success: true,
        processed,
        attempted: targetEntries.length,
        errors,
        pages: processedPages,
        requiresReview: true,
      });
    } else {
      await crawlDocRef.set(
        {
          status: errors.length > 0 ? "completed-with-errors" : "completed",
          completedAt: admin.firestore.FieldValue.serverTimestamp(),
          pageCount: processed,
          errorCount: errors.length,
          lastRun: admin.firestore.FieldValue.serverTimestamp(),
          lastCrawlUrls: Array.from(targetUrlSet),
          approvedUrls: finalApproved,
          excludedUrls: Array.from(excludedSet),
          manualUrls: finalManual,
          priorityUrls: filteredPriorityCombined,
          pendingPages: admin.firestore.FieldValue.delete(),
          pendingGeneratedAt: admin.firestore.FieldValue.delete(),
        },
        { merge: true }
      );

      await db.collection("onboarding").doc(userId).set(
        {
          siteCrawlStatus:
            errors.length > 0 ? "completed-with-errors" : "completed",
          lastSiteCrawlAt: new Date().toISOString(),
        },
        { merge: true }
      );

      return NextResponse.json({
        success: true,
        processed,
        attempted: targetEntries.length,
        errors,
        pages: processedPages,
        requiresReview: false,
      });
    }
  } catch (error) {
    if (error.status) return errorResponse(error);
    console.error("❌ Site crawl failed:", error);

    try {
      const userId = requestPayload?.userId;
      if (userId) {
        await db.collection("siteCrawls").doc(userId).set(
          {
            status: "error",
            errorMessage: error.message,
            failedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
        await db.collection("onboarding").doc(userId).set(
          {
            siteCrawlStatus: "error",
          },
          { merge: true }
        );
      }
    } catch (secondaryError) {
      console.warn("⚠️ Failed to record crawl error state:", secondaryError);
    }

    return NextResponse.json(
      { error: "Site crawl failed", details: error.message },
      { status: 500 }
    );
  }
}


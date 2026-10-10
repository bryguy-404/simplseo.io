import { publicFetch } from '../../lib/server/publicFetch';
import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { XMLParser } from "fast-xml-parser";

// Helper to extract base URL and construct sitemap URL
function getSitemapUrl(siteUrl) {
  if (!siteUrl) return null;
  
  // Clean the URL - remove trailing slashes and ensure https
  let baseUrl = siteUrl.replace(/\/+$/, '');
  if (!baseUrl.startsWith('http')) {
    baseUrl = `https://${baseUrl}`;
  }
  
  return `${baseUrl}/sitemap.xml`;
}

// Support both GET (with query param) and POST (with body)
async function handleGET(request) {
  const { searchParams } = new URL(request.url);
  const siteUrl = searchParams.get('siteUrl');
  
  if (!siteUrl) {
    return new Response(JSON.stringify({ error: "Missing siteUrl parameter" }), {
      status: 400,
    });
  }
  
  return fetchSitemap(siteUrl);
}

async function handlePOST(request) {
  try {
    const { siteUrl } = await request.json();
    
    if (!siteUrl) {
      return new Response(JSON.stringify({ error: "Missing siteUrl in request body" }), {
        status: 400,
      });
    }
    
    return fetchSitemap(siteUrl);
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
    });
  }
}

async function fetchSitemap(siteUrl) {
  const sitemapIndexUrl = getSitemapUrl(siteUrl);
  
  if (!sitemapIndexUrl) {
    return new Response(JSON.stringify({ error: "Invalid site URL" }), {
      status: 400,
    });
  }

  console.log(`📍 Fetching sitemap for: ${sitemapIndexUrl}`);

  try {
    const parser = new XMLParser();

    // Step 1: Fetch the sitemap (could be index or direct urlset)
    const indexRes = await publicFetch(sitemapIndexUrl);
    
    if (!indexRes.ok) {
      console.warn(`⚠️ Sitemap fetch failed: ${indexRes.status}`);
      return new Response(JSON.stringify({ 
        error: `Could not fetch sitemap: ${indexRes.status}`,
        urls: [] 
      }), {
        status: 200, // Return 200 with empty urls so the feature degrades gracefully
      });
    }
    
    const indexXml = await indexRes.text();
    const indexJson = parser.parse(indexXml);

    const allUrls = [];

    // Check if it's a sitemap index (contains <sitemapindex>) or direct urlset
    if (indexJson.sitemapindex?.sitemap) {
      // It's a sitemap index - fetch child sitemaps
      const sitemapList = indexJson.sitemapindex.sitemap;
      const sitemapUrls = Array.isArray(sitemapList)
        ? sitemapList.map((s) => s.loc)
        : [sitemapList.loc];

      // Step 2: Fetch each child sitemap and collect URLs
      for (const url of sitemapUrls.slice(0, 20)) {
        try {
          const res = await publicFetch(url);
          const xml = await res.text();
          const json = parser.parse(xml);
          const urls = json.urlset?.url || [];

          const normalized = Array.isArray(urls) ? urls : [urls];
          const locs = normalized.map((u) => u.loc).filter(Boolean);
          allUrls.push(...locs);
        } catch (err) {
          console.warn(`⚠️ Failed to fetch child sitemap: ${url}`, err.message);
        }
      }
    } else if (indexJson.urlset?.url) {
      // It's a direct urlset (single sitemap file)
      const urls = indexJson.urlset.url;
      const normalized = Array.isArray(urls) ? urls : [urls];
      const locs = normalized.map((u) => u.loc).filter(Boolean);
      allUrls.push(...locs);
    }

    console.log(`✅ Found ${allUrls.length} URLs in sitemap for ${siteUrl}`);

    return new Response(JSON.stringify({ urls: allUrls }), {
      status: 200,
    });
  } catch (err) {
    console.error("❌ Error in sitemap API:", err.message);
    return new Response(JSON.stringify({ error: err.message, urls: [] }), {
      status: 200, // Return 200 with empty urls so the feature degrades gracefully
    });
  }
}

export const GET = authenticatedRoute(handleGET);
export const POST = authenticatedRoute(handlePOST);

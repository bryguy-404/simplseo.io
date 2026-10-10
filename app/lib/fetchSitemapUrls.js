
import { authenticatedFetch } from './authenticatedFetch';
// ✅ app/lib/fetchSitemapUrls.js
/**
 * Fetch sitemap URLs for a given site
 * @param {string} siteUrl - The base URL of the site (e.g., "https://example.com")
 * @returns {Promise<string[]>} Array of URLs from the sitemap
 */
export async function fetchSitemapUrls(siteUrl) {
  if (!siteUrl) {
    console.error("❌ fetchSitemapUrls: siteUrl is required");
    return [];
  }
  
  try {
    const res = await authenticatedFetch("/api/sitemap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteUrl }),
    });
    if (!res.ok) throw new Error(`API Error: ${res.status}`);
    const json = await res.json();
    return json.urls || [];
  } catch (err) {
    console.error("❌ Client failed to fetch sitemap URLs:", err.message);
    return [];
  }
}

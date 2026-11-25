import { PUBLIC_SITE_URL } from "./lib/publicSite";

export default function robots() {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    sitemap: `${PUBLIC_SITE_URL}/sitemap.xml`,
  };
}

import { PUBLIC_SITE_URL } from "./lib/publicSite";

export default function sitemap() {
  return ["/home", "/seo-for-photographers", "/privacy"].map(path => ({
    url: `${PUBLIC_SITE_URL}${path}`,
  }));
}

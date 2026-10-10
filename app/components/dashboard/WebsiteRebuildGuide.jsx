"use client";

import { Button } from '@/components/ui/button';
import { propertyContainsUrl } from '../../lib/revampState';

export default function WebsiteRebuildGuide({ pages = [], property }) {
  const known = [...new Map(pages.map(value => typeof value === 'string' ? { url: value } : value)
    .filter(page => page?.url && propertyContainsUrl(property || '', page.url)).map(page => [page.url, page])).values()];
  const download = () => {
    const rows = [['Tracked URL', 'Path and query', 'Search data status', 'Observation start', 'Observation end', 'Observed redirect destination', 'Planned replacement URL'],
      ...known.map(page => { const url = new URL(page.url); return [page.url, url.pathname + url.search, page.searchDataStatus || 'not_checked', page.observationWindow?.startDate || '', page.observationWindow?.endDate || '', page.finalUrl || '', '']; })];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const objectUrl = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = objectUrl; link.download = 'website-url-plan.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  };
  return <details className="border rounded-lg p-5">
    <summary className="cursor-pointer font-semibold">Rebuilding your website? Keep a URL plan</summary>
    <div className="mt-4 space-y-4 text-sm">
      <p>A new design can keep existing URLs when those pages still serve the same purpose. Your tracked list is a starting point; compare it with your old sitemap and the pages in your website builder.</p>
      <ol className="list-decimal pl-5 space-y-2">
        <li>Keep the same URL for a page that continues to serve the same purpose.</li>
        <li>If a URL changes, map the old address to its relevant replacement. Ask your website builder or developer to set a permanent 301 or 308 redirect directly to it.</li>
        <li>Update internal links and your sitemap to the final URLs. Avoid sending unrelated old pages to your homepage.</li>
        <li>Use URL Inspection in Google Search Console for crawl and index status. Search impressions alone cannot answer whether every page is indexed.</li>
      </ol>
      <Button variant="outline" onClick={download} disabled={!known.length}>Download tracked URL list ({known.length})</Button>
      <p className="text-muted-foreground">The download includes exact paths and query strings, saved observation dates and a blank replacement-URL column. It is a planning sheet; it does not change your website or set up redirects.</p>
      <p><a className="underline" href="https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes" target="_blank" rel="noopener noreferrer">Google&apos;s guide to URL changes</a><span aria-hidden="true"> · </span><a className="underline" href="https://search.google.com/search-console" target="_blank" rel="noopener noreferrer">Open Google Search Console</a></p>
    </div>
  </details>;
}

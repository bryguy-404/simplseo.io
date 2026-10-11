"use client";

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function GoogleSetup({ google, properties, property, onPropertyChange, onConnect, onSelect, onRefresh, onContinue, busy, websiteSaved, canRefresh }) {
  const connected = Boolean(google?.property && ['selected', 'connected', 'validated', 'ready'].includes(google.status));
  const accessIssues = (google?.propertyIssues || []).filter(item => item.matchesWebsite && item.reason === 'insufficient_permission');
  const matching = properties.filter(item => item.matchesWebsite === true);
  return <div className="space-y-5">
    <div className="rounded-lg border bg-sky-500/5 p-4 space-y-2"><p className="font-medium">See how people find your website</p><p className="text-sm text-muted-foreground">Connect the Google account that has access to your website in Search Console.</p></div>
    {connected ? <div role="status" className="rounded-md border border-primary/30 p-4"><p className="font-medium">Website selected</p><p className="break-all text-sm mt-1">{google.property}</p></div> : <p className="text-sm">Your business draft stays saved while you connect Google.</p>}
    <Button variant={connected ? 'outline' : 'default'} disabled={busy || !websiteSaved} onClick={onConnect}>{connected ? 'Choose a different Google connection' : 'Connect Google Search Console'}</Button>
    {!websiteSaved && <p className="text-sm text-muted-foreground">Save your website address first.</p>}
    {properties.length > 0 && <form className="space-y-3" onSubmit={event => { event.preventDefault(); onSelect(); }}><Label htmlFor="setup-google-property">Choose your website in Google</Label><select id="setup-google-property" value={property} onChange={event => onPropertyChange(event.target.value)} required disabled={busy} className="w-full rounded-md border bg-background px-3 py-2 text-sm"><option value="">Choose a website</option>{properties.map(item => { const url = typeof item === 'string' ? item : item.siteUrl || item.property; return <option key={url} value={url} disabled={item.matchesWebsite === false}>{url}{item.matchesWebsite === true ? ' (matches your website)' : item.matchesWebsite === false ? ' (different website)' : ''}</option>; })}</select>{matching.length === 1 && <p className="text-sm text-muted-foreground break-all">Suggested match: {matching[0].siteUrl || matching[0].property}. Confirm this is the website you want to improve.</p>}<Button disabled={busy || !property}>Use this website</Button></form>}
    {accessIssues.length > 0 && <div className="rounded-md border border-amber-500/40 p-4 text-sm space-y-2"><p className="font-medium">Your website needs more Google access</p>{accessIssues.map(item => <p className="break-all" key={item.siteUrl}>{item.siteUrl}</p>)}<p>Ask the Search Console owner to give your Google account full-user or owner access. Then refresh the websites below.</p></div>}
    {canRefresh && <div className="space-y-2"><p className="text-sm text-muted-foreground">Only websites where you have owner or full-user access can be selected.</p>{!properties.length && !accessIssues.length && <p className="text-sm">No websites with that access were returned. Check your Google account or add your website in Search Console, then refresh.</p>}<Button variant="outline" disabled={busy} onClick={onRefresh}>Refresh websites</Button></div>}
    <details className="rounded-md border p-4 text-sm"><summary className="cursor-pointer">I don’t have Search Console set up yet</summary><ol className="mt-3 list-decimal pl-5 space-y-2"><li>Open Google Search Console and add your website.</li><li>Follow Google’s ownership verification instructions.</li><li>Return here and connect the Google account you used.</li></ol><a href="https://search.google.com/search-console/welcome" target="_blank" rel="noopener noreferrer" className="mt-4 inline-block underline">Open Google Search Console</a><p className="mt-3 text-muted-foreground">You can finish your business details now and come back to connect Google.</p></details>
    <Button variant="outline" disabled={busy} onClick={onContinue}>Continue to business details</Button>
  </div>;
}

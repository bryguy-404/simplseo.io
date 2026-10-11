"use client";

import Link from 'next/link';
import { EmailChoice } from '../notifications/NotificationPreferences';
import { Button } from '@/components/ui/button';

const safeInspectionLink = value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'search.google.com' ? url.href : null; } catch { return null; }
};
const dateLabel = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : ''; };

export default function SetupReadiness({ readiness, session, inventory, reviewed, googleReady, privacy, onPrivacyChange, notificationPreferences, emailUpdates = false, onEmailUpdatesChange, busy, canFinish, onCheck, onComplete, onStep }) {
  const observations = readiness?.website?.observations;
  const homepage = observations?.homepage;
  const technical = homepage?.technical;
  const entries = [
    ['Business details', session.profileConfirmed ? 'Confirmed' : 'Confirm your services and areas first.'],
    ['Google connection', readiness?.google?.message || (googleReady ? `Selected: ${session.google.property}` : 'Connect and select your website in Google.')],
    ['Website review', readiness?.website?.message || (inventory ? `${reviewed} pages reviewed. Unchecked pages can be reviewed later.` : 'Not checked yet.')],
    ['Search activity', readiness?.search?.message || 'Not checked yet. No traffic is required.'],
  ];
  return <div className="space-y-5">
    <p className="text-sm">Your website does not need traffic or every page indexed to get started.</p>
    <ul className="space-y-3">{entries.map(([label, message]) => <li key={label} className="rounded-md border p-3"><p className="font-medium text-sm">{label}</p><p className="mt-1 text-sm text-muted-foreground break-words">{message}</p></li>)}</ul>
    {readiness?.checkedAt && <p className="text-xs text-muted-foreground">Setup checked {dateLabel(readiness.checkedAt)}.</p>}
    {observations && <details className="rounded-md border p-4 text-sm"><summary className="cursor-pointer">Website review details</summary><p className="mt-3 text-muted-foreground">SimplSEO checked the public website. These checks do not tell us whether Google has indexed a page.</p>{homepage && <div className="mt-3 space-y-1"><p className="font-medium">Homepage</p><p className="break-all">{homepage.url}</p><p>{homepage.status === 'fetched' ? 'Page read successfully.' : homepage.status === 'not_checked' ? 'Not checked yet.' : 'We could not read this page. You can retry the website review.'}</p>{homepage.observedAt && <p className="text-xs text-muted-foreground">Observed {dateLabel(homepage.observedAt)}</p>}{homepage.finalUrl && homepage.finalUrl !== homepage.url && <p className="break-all">Redirected to: {homepage.finalUrl}</p>}{(technical?.noindex?.generic || technical?.noindex?.googlebot) && <p>This page asks search engines not to index it.</p>}{technical?.canonicalUrl && <p className="break-all">Preferred page declared by your website: {technical.canonicalUrl}</p>}</div>}<p className="mt-3">Crawl instructions (robots.txt): {observations.robotsStatus === 'reviewed' || observations.robotsStatus === 'available' ? 'Read' : observations.robotsStatus === 'not_found' ? 'Not found' : observations.robotsStatus === 'not_checked' ? 'Not checked' : 'Could not be read'}.</p>{observations.sitemaps?.length > 0 && <ul className="mt-3 divide-y">{observations.sitemaps.map(item => <li className="py-2 space-y-1" key={item.url}><p className="break-all">{item.url}</p><p>{item.status === 'reviewed' ? 'Sitemap read' : item.status === 'pending' ? 'Not checked yet' : 'Sitemap could not be read'}</p>{item.observedAt && <p className="text-xs text-muted-foreground">Checked {dateLabel(item.observedAt)}</p>}</li>)}</ul>}</details>}
    {readiness?.inspections?.length > 0 && <details className="rounded-md border p-4 text-sm"><summary className="cursor-pointer">Google’s stored page checks</summary><p className="mt-3 text-muted-foreground">These are Google’s stored observations. They are separate from SimplSEO’s website review.</p><ul className="mt-3 divide-y">{readiness.inspections.map(item => <li key={item.url} className="py-3 space-y-1"><p className="break-all font-medium">{item.url}</p><p>{item.status === 'available' ? item.result?.coverageState || 'Google returned a stored observation.' : 'Google’s status could not be checked. Try again later.'}</p>{item.checkedAt && <p className="text-xs text-muted-foreground">Checked {dateLabel(item.checkedAt)}</p>}{safeInspectionLink(item.inspectionUrl) && <a href={safeInspectionLink(item.inspectionUrl)} className="underline inline-block" target="_blank" rel="noopener noreferrer">Open Google’s page inspection</a>}</li>)}</ul></details>}
    <Button variant="outline" disabled={busy} onClick={onCheck}>Check setup</Button>
    <label className="flex gap-3 text-sm"><input type="checkbox" checked={privacy} onChange={event => onPrivacyChange(event.target.checked)} className="mt-0.5" /><span>I agree to the <Link href="/privacy" target="_blank" className="underline">privacy policy</Link>.</span></label>
    {notificationPreferences?.enabled && !notificationPreferences.chosenAt && <EmailChoice checked={emailUpdates} onChange={onEmailUpdatesChange} disabled={busy || !notificationPreferences.recipientVerified} recipient={notificationPreferences.recipient} />}
    <div className="flex flex-wrap gap-2"><Button disabled={busy || !canFinish} onClick={onComplete}>Open my SEO workspace</Button>{!session.profileConfirmed && <Button variant="link" onClick={() => onStep('business')}>Confirm business details</Button>}{!googleReady && <Button variant="link" onClick={() => onStep('google')}>Connect Google to finish</Button>}</div>
  </div>;
}

"use client";

import { useEffect, useRef, useState } from 'react';
import { notificationRequest, saveNotificationPreference } from '../../lib/notificationClient';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function EmailChoice({ checked, onChange, disabled = false, recipient }) {
  return <label className="flex items-start gap-3 rounded-lg border p-4 text-sm"><input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-primary" /><span>Email me when my page results or check-ins are ready.<span className="mt-1 block text-xs text-muted-foreground">One roundup when there are new updates, at most once a day.{recipient ? ` Sent to ${recipient}.` : ''} You can turn this off in Settings.</span></span></label>;
}

export default function NotificationPreferences() {
  const [preferences, setPreferences] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const load = async () => {
    setError(''); setBusy(true);
    try { const result = await notificationRequest('/api/notifications/preferences'); if (active.current) setPreferences(result); }
    catch (failure) { if (active.current) setError(failure.message); }
    finally { if (active.current) setBusy(false); }
  };
  useEffect(() => { let active = true; notificationRequest('/api/notifications/preferences').then(result => { if (active) setPreferences(result); }).catch(failure => { if (active) setError(failure.message); }); return () => { active = false; }; }, []);
  const save = async enabled => {
    if (!preferences || busy) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await saveNotificationPreference(preferences, enabled); if (active.current) { setPreferences(result); setNotice(enabled ? 'Your email choice is saved.' : 'Progress emails are off. Your updates remain in the bell.'); } }
    catch (failure) { if (active.current) setError(`${failure.message} We could not confirm your email choice was saved. Reload the saved choice before trying again.`); }
    finally { if (active.current) setBusy(false); }
  };
  const test = async () => {
    setBusy(true); setError(''); setNotice('');
    try { const result = await notificationRequest('/api/notifications/test-email', { idempotencyKey: crypto.randomUUID() }); if (active.current) setNotice(result.message || 'Your labeled test email was submitted.'); }
    catch (failure) { if (active.current) setError(failure.message); }
    finally { if (active.current) setBusy(false); }
  };
  const state = preferences?.emailState;
  return <section aria-label="Notification preferences" className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
    <div><h2 className="text-xl font-semibold">Notifications</h2><p className="mt-2 text-sm text-muted-foreground">Return when there is something useful to review. In-app updates remain available when email is off.</p></div>
    {!preferences && !error && <p role="status">Loading your saved email choice…</p>}
    {error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><Button variant="outline" disabled={busy} onClick={load}>Reload email choice</Button></div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {preferences?.enabled === false ? <p className="text-sm text-muted-foreground">Page notifications will be available when enabled for your account.</p> : preferences && <>
      <div className="flex items-start justify-between gap-4 rounded-lg border p-4"><label htmlFor="progress-emails" className="space-y-1"><span className="block font-medium">Email progress updates</span><span className="block text-sm text-muted-foreground">Only when there are new results, check-ins or an issue to review. At most one roundup per day.</span></label><Switch id="progress-emails" checked={preferences.emailEnabled} disabled={busy || !preferences.recipientVerified || state === 'suppressed' || Boolean(error)} onCheckedChange={save} /></div>
      <div className="space-y-2 text-sm"><p>Sign-in email: <strong className="break-all">{preferences.recipient || 'No email available'}</strong>{preferences.recipientVerified ? ' · verified' : ' · verification needed'}</p>
        {state === 'verify_email' && <p>Verify your sign-in email before enabling email updates.</p>}
        {state === 'confirm_new_email' && <div className="space-y-2"><p>Your sign-in email changed. Email updates are paused until you confirm this verified address.</p><Button variant="outline" disabled={busy || !preferences.recipientVerified} onClick={() => save(true)}>Use this verified email</Button></div>}
        {state === 'suppressed' && <p role="status">Email is paused after a delivery problem or spam complaint. Your in-app updates are still available. Contact support before enabling email again.</p>}
        {!preferences.sendingEnabled && <p className="text-muted-foreground">Email delivery is not enabled yet. Your saved preference will be used after setup is complete.</p>}
      </div>
      <Button variant="outline" disabled={busy || !preferences.sendingEnabled || !preferences.emailEnabled || state !== 'enabled' || Boolean(error)} onClick={test}>Send a labeled test email</Button>
      <p className="text-xs text-muted-foreground">Test emails go only to your verified sign-in address. Limit: one per minute and three per day.</p>
    </>}
  </section>;
}

// This is triggered only after a successful publication confirmation. A failed
// preference save never changes or rolls back that already-saved SEO work.
export function PublicationEmailPrompt({ accountId }) {
  const [preferences, setPreferences] = useState(null);
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  useEffect(() => {
    let active = true;
    mounted.current = true;
    setOpen(false); setPreferences(null); setChecked(false); setError('');
    const onPublished = async () => {
      try {
        const result = await notificationRequest('/api/notifications/preferences');
        if (active && result.enabled && !result.chosenAt) { setPreferences(result); setChecked(false); setError(''); setOpen(true); }
      } catch { /* Publication is saved. Settings remains the email recovery path. */ }
    };
    window.addEventListener('seo-publication-confirmed', onPublished);
    window.addEventListener('new-page-publication-confirmed', onPublished);
    return () => { active = false; mounted.current = false; window.removeEventListener('seo-publication-confirmed', onPublished); window.removeEventListener('new-page-publication-confirmed', onPublished); };
  }, [accountId]);
  const save = async enabled => {
    if (busy || !preferences) return;
    setBusy(true); setError('');
    try { const result = await saveNotificationPreference(preferences, enabled); if (mounted.current) { setPreferences(result); setOpen(false); } }
    catch (failure) { if (mounted.current) setError(`Your publication is saved. Your email choice could not be saved: ${failure.message}`); }
    finally { if (mounted.current) setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) save(false); }}><DialogContent><DialogHeader><DialogTitle>Your published change is recorded</DialogTitle><DialogDescription>Would you like an email when there is a useful update? Your page tracking is already saved.</DialogDescription></DialogHeader><EmailChoice checked={checked} onChange={setChecked} disabled={busy || !preferences?.recipientVerified} recipient={preferences?.recipient} />{!preferences?.recipientVerified && <p className="text-xs text-muted-foreground">Verify your sign-in email to enable this later in Settings.</p>}{error && <div className="space-y-2"><p role="alert" className="text-sm text-destructive">{error}</p><p className="text-xs text-muted-foreground">You can retry your email choice in Settings → Notifications.</p><Button variant="link" className="h-auto px-0" onClick={() => setOpen(false)}>Continue to my saved work</Button></div>}<DialogFooter><Button variant="outline" disabled={busy} onClick={() => save(false)}>No thanks</Button><Button disabled={busy} onClick={() => save(checked)}>{busy ? 'Saving…' : 'Save email choice'}</Button></DialogFooter></DialogContent></Dialog>;
}

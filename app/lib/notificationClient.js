"use client";

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import { authenticatedFetch } from './authenticatedFetch';

const entries = new Map();
const listeners = new Set();
let activeAccount = null;
let activeScope = '';
const TTL = 30_000;

export async function notificationRequest(path, body, method = 'POST') {
  const response = await authenticatedFetch(path, body === undefined ? {} : {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Your updates could not be loaded. Please try again.');
  return result;
}

export function clearNotificationCache() { entries.clear(); activeAccount = null; activeScope = ''; listeners.forEach(listener => listener()); }
export function invalidateNotifications() { entries.clear(); listeners.forEach(listener => listener()); }

export function useNotifications() {
  const { user } = useAuth();
  const { data, isLoaded } = useOnboarding();
  const scope = user?.id && isLoaded && data?.isComplete ? JSON.stringify([user.id, data.websiteUrl, data.gscProperty, data.revampRunId]) : '';
  const [view, setView] = useState({ scope: '', loading: true, result: null, error: '' });
  const load = useCallback(async ({ force = false } = {}) => {
    if (!scope) return;
    let entry = entries.get(scope);
    if (!entry) { entry = { fetchedAt: 0, result: null, promise: null }; entries.set(scope, entry); }
    if (!force && entry.result && Date.now() - entry.fetchedAt < TTL) { setView({ scope, result: entry.result, error: '', loading: false }); return; }
    setView(previous => ({ scope, result: previous.scope === scope ? previous.result : null, error: '', loading: true }));
    if (!entry.promise) entry.promise = notificationRequest('/api/notifications?limit=20').then(result => {
      if (entries.get(scope) === entry) { entry.result = result; entry.fetchedAt = Date.now(); }
      return result;
    }).finally(() => { entry.promise = null; });
    try { const result = await entry.promise; if (entries.get(scope) === entry) setView({ scope, result, error: '', loading: false }); }
    catch (error) { if (entries.get(scope) === entry) setView({ scope, result: entry.result, error: error.message, loading: false }); }
  }, [scope]);
  useEffect(() => {
    if (activeAccount !== user?.id || activeScope !== scope) { entries.clear(); activeAccount = user?.id || null; activeScope = scope; }
    if (!scope) { setView({ scope: '', result: null, error: '', loading: false }); return; }
    load();
    const refresh = () => { load(); };
    const focus = () => { if (document.visibilityState !== 'hidden') load(); };
    listeners.add(refresh); window.addEventListener('focus', focus);
    return () => { listeners.delete(refresh); window.removeEventListener('focus', focus); };
  }, [scope, user?.id, load]);
  return { ...(view.scope === scope ? view : { result: null, error: '', loading: Boolean(scope) }), scope, refresh: load };
}

export async function saveNotificationPreference(preferences, emailEnabled) {
  const result = await notificationRequest('/api/notifications/preferences', {
    expectedRevision: preferences.revision, emailEnabled, idempotencyKey: crypto.randomUUID(),
  }, 'PATCH');
  return result;
}

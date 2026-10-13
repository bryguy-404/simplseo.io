"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import OnboardingWorkspace from '../components/onboarding/OnboardingWorkspace';
import EmailVerification from '../components/onboarding/EmailVerification';
import { Button } from '@/components/ui/button';
import { notificationAuthPath, notificationReturnFromLocation } from '../lib/notificationNavigation';

export default function OnboardingPage() {
  const { user, isLoading, logout, access, refreshAccess } = useAuth();
  const { data, isLoaded, setupWorkspace, setupError, refreshSetup } = useOnboarding();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !user) router.replace(notificationAuthPath('/auth', notificationReturnFromLocation(window.location)));
    else if (access?.status === 'pending') router.replace('/auth');
    else if (access?.status === 'approved' && isLoaded && data.isComplete) router.replace(notificationReturnFromLocation(window.location) || '/dashboard');
  }, [user, isLoading, isLoaded, data.isComplete, router, access?.status]);
  if (user && access?.status === 'error') return <div className="max-w-xl mx-auto p-6 space-y-4"><p role="alert">{access.error}</p><Button onClick={refreshAccess}>Retry access check</Button><Button variant="outline" onClick={logout}>Sign out</Button></div>;
  if (isLoading || !isLoaded || !user || data.isComplete) return <p role="status" className="p-8">Loading your saved setup…</p>;
  if (/^Verify your email\b/i.test(setupError)) return <EmailVerification key={user.id} userId={user.id} email={user.email} onVerified={refreshSetup} onSignOut={logout} />;
  if (setupError) return <div className="max-w-xl mx-auto p-6 space-y-4"><p role="alert">{setupError}</p><Button onClick={() => refreshSetup().catch(() => {})}>Retry loading setup</Button></div>;
  if (setupWorkspace?.pinned || setupWorkspace?.eligible) return <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12"><OnboardingWorkspace key={user.id} /></div>;
  return <div className="max-w-xl mx-auto p-6 space-y-4"><h1 className="text-2xl font-semibold">Your account is saved</h1><p>The new website setup is currently available to pilot accounts. Your saved details are still here; you can return when setup is available for your account.</p><Button variant="outline" onClick={() => refreshSetup().catch(() => {})}>Check setup availability</Button></div>;
}

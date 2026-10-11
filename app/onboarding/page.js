"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../contexts/AuthContext';
import { useOnboarding } from '../contexts/OnboardingContext';
import OnboardingWorkspace from '../components/onboarding/OnboardingWorkspace';
import { Button } from '@/components/ui/button';

export default function OnboardingPage() {
  const { user, isLoading } = useAuth();
  const { data, isLoaded, setupWorkspace, setupError, refreshSetup } = useOnboarding();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !user) router.replace('/auth');
    else if (isLoaded && data.isComplete) router.replace('/dashboard');
  }, [user, isLoading, isLoaded, data.isComplete, router]);
  if (isLoading || !isLoaded || !user || data.isComplete) return <p role="status" className="p-8">Loading your saved setup…</p>;
  if (setupError) return <div className="max-w-xl mx-auto p-6 space-y-4"><p role="alert">{setupError}</p><Button onClick={() => refreshSetup().catch(() => {})}>Retry loading setup</Button></div>;
  if (setupWorkspace?.pinned || setupWorkspace?.eligible) return <div className="max-w-4xl mx-auto px-4 py-8 sm:py-12"><OnboardingWorkspace key={user.id} /></div>;
  return <div className="max-w-xl mx-auto p-6 space-y-4"><h1 className="text-2xl font-semibold">Your account is saved</h1><p>The new website setup is currently available to pilot accounts. Your saved details are still here; you can return when setup is available for your account.</p><Button variant="outline" onClick={() => refreshSetup().catch(() => {})}>Check setup availability</Button></div>;
}

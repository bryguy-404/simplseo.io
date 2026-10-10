"use client";
import dynamic from 'next/dynamic';
import { useOnboarding } from '../contexts/OnboardingContext';
import { useAuth } from '../contexts/AuthContext';
import MainLayout from '../components/MainLayout';
import CurrentWebsiteDashboard from '../components/dashboard/CurrentWebsiteDashboard';

// Keep first-time setup separate from the completed account's daily workspace.
const SetupFlow = dynamic(() => import('./SetupFlow'), { loading: () => <p className="p-8">Loading website setup…</p> });
export default function Dashboard() {
  const { data, isLoaded } = useOnboarding();
  const { user } = useAuth();
  if (!isLoaded) return <MainLayout><p role="status">Loading your workspace…</p></MainLayout>;
  const initialSetup = !['in-progress', 'complete'].includes(data?.revampStatus)
    && ['pages', 'keywords'].includes(data?.postOnboardingStep);
  const scope = `${user?.id || ''}:${data.gscProperty || ''}:${data.revampRunId || ''}`;
  return initialSetup ? <SetupFlow key={scope} /> : <CurrentWebsiteDashboard key={scope} />;
}

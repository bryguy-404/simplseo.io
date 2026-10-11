"use client";
import { useOnboarding } from '../contexts/OnboardingContext';
import { useAuth } from '../contexts/AuthContext';
import MainLayout from '../components/MainLayout';
import CurrentWebsiteDashboard from '../components/dashboard/CurrentWebsiteDashboard';

export default function Dashboard() {
  const { data, isLoaded } = useOnboarding();
  const { user } = useAuth();
  if (!isLoaded) return <MainLayout><p role="status">Loading your workspace…</p></MainLayout>;
  const scope = `${user?.id || ''}:${data.gscProperty || ''}:${data.revampRunId || ''}`;
  return <CurrentWebsiteDashboard key={scope} />;
}

"use client";
import { useOnboarding } from '../contexts/OnboardingContext';
import { useAuth } from '../contexts/AuthContext';
import MainLayout from '../components/MainLayout';
import CurrentWebsiteDashboard from '../components/dashboard/CurrentWebsiteDashboard';
import { PageLoader } from '@/app/components/BrandLoader';

export default function Dashboard() {
  const { data, isLoaded } = useOnboarding();
  const { user } = useAuth();
  if (!isLoaded) return <MainLayout><PageLoader label="Loading your workspace…" /></MainLayout>;
  const scope = `${user?.id || ''}:${data.gscProperty || ''}:${data.revampRunId || ''}`;
  return <CurrentWebsiteDashboard key={scope} />;
}

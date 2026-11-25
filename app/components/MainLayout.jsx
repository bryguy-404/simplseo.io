"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import { useTheme } from "../contexts/ThemeContext";
import WorkspaceHeader from "./WorkspaceHeader";
import { clearNotificationCache } from "../lib/notificationClient";
import { notificationAuthPath, notificationReturnFromLocation } from "../lib/notificationNavigation";
import { PublicationEmailPrompt } from "./notifications/NotificationPreferences";
import ChatAssistant from "../components/ChatAssistant";
import MentorLauncher from "./mentor/MentorLauncher";
import { PageLoader } from '@/app/components/BrandLoader';

const MainLayout = ({
  children,
  showChat = true,
  feedbackOverview = false,
  aiTips = [],
  gscKeywords = [],
  easyWins = [],
  topPages = [],
  lowCtrPages = [],
  impressionTrends = [],
}) => {
  const { logout, user, isLoading, access } = useAuth();
  const { data, isLoaded: isOnboardingLoaded } = useOnboarding();
  const { isDarkMode, toggleTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [isChatOpen, setIsChatOpen] = useState(false);

  useEffect(() => {
    // Don't redirect if on public pages (request-access, verify-code)
    const publicPages = ["/request-access", "/verify-code"];
    if (typeof window !== "undefined" && !isLoading && !user && !publicPages.includes(pathname)) {
      router.push(notificationAuthPath("/auth", notificationReturnFromLocation(window.location)));
    }
  }, [user, isLoading, router, pathname]);

  useEffect(() => {
    if (
      !isLoading &&
      user &&
      access?.status === 'approved' &&
      isOnboardingLoaded &&
      !data?.isComplete &&
      pathname !== "/onboarding"
    ) {
      router.push(notificationAuthPath("/onboarding", notificationReturnFromLocation(window.location)));
    }
  }, [isLoading, user, isOnboardingLoaded, data?.isComplete, pathname, router, access?.status]);

  useEffect(() => {
    if (user && access?.status === 'pending') router.replace('/auth');
  }, [user, access?.status, router]);

  // Keep the daily workspace focused. Chat opens only when requested, including
  // a deliberate contextual-help action; a first visit must not send AI work.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const hasSeenChat = localStorage.getItem("hasSeenChatAssistant");
      
      if (!hasSeenChat) {
        localStorage.setItem("hasSeenChatAssistant", "true");
      }
    }
  }, []);

  const handleLogout = async () => {
    clearNotificationCache();
    await logout();
    
    // Returning members use regular sign-in; their invitation grant stays saved.
    router.push("/auth");
  };



  // Listen for chat open events from other components (like intent mismatch page or focus keywords)
  useEffect(() => {
    const handleChatOpenEvent = (event) => {
      if (event.detail?.context === 'intent_mismatch' || event.detail?.context === 'focus_keywords') {
        setIsChatOpen(true);
        // The chat context is already stored in localStorage
        console.log('Chat opened with context:', event.detail);
      }
    };

    window.addEventListener('openChatAssistant', handleChatOpenEvent);
    
    return () => {
      window.removeEventListener('openChatAssistant', handleChatOpenEvent);
    };
  }, []);

  // Don't render anything while loading to prevent hook ordering issues
  if (isLoading || (user && access?.status !== 'approved')) {
    if (access?.status === 'error') return <div role="status" className="p-8"><p>{access.error}</p><a className="underline" href="/auth">Retry sign-in</a></div>;
    return <PageLoader label="Checking your access…" className="min-h-screen" />;
  }

  // Check if user is in post-onboarding flow or revamp flow
  const isInRevampFlow = data?.revampStatus === 'in-progress';

  // Public pages that don't need header/navigation
  const publicPages = ["/request-access", "/verify-code"];
  const isPublicPage = publicPages.includes(pathname);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {!isPublicPage && (
        <WorkspaceHeader
          key={JSON.stringify([user?.id, pathname])}
          feedbackUserId={user && data?.isComplete ? user.id : null}
          feedbackOverview={feedbackOverview}
          isAdmin={access?.isAdmin}
          pathname={pathname}
          businessName={data?.businessName || user?.displayName || user?.email}
          websiteUrl={data?.websiteUrl}
          isDarkMode={isDarkMode}
          toggleTheme={toggleTheme}
          onLogout={handleLogout}
        />
      )}

      {user && data?.isComplete && <PublicationEmailPrompt key={JSON.stringify([user.id, data.websiteUrl, data.gscProperty, data.revampRunId])} accountId={user.id} />}
      {/* Main */}
      <main className="flex-1 overflow-auto">
        {pathname === "/chatbot" ? (
          <div className="w-full">
            {children}
          </div>
        ) : (
          <div className="container mx-auto p-4 transition-all duration-300">
            {children}
          </div>
        )}
      </main>

      {/* Floating SEO Mentor button (not on the mentor page itself or the contact page) */}
      {showChat && pathname !== "/chatbot" && pathname !== "/contact" && (
        <MentorLauncher open={isChatOpen} onOpenChange={setIsChatOpen} pathname={pathname}>
          <ChatAssistant
            onClose={() => setIsChatOpen(false)}
            aiTips={aiTips}
            gscKeywords={gscKeywords}
            easyWins={easyWins}
            topPages={topPages}
            lowCtrPages={lowCtrPages}
            impressionTrends={impressionTrends}
            />
        </MentorLauncher>
      )}
    </div>
  );
};

export default MainLayout;

"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import { useTheme } from "../contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";
import WorkspaceHeader from "./WorkspaceHeader";
import { clearNotificationCache } from "../lib/notificationClient";
import { notificationAuthPath, notificationReturnFromLocation } from "../lib/notificationNavigation";
import { PublicationEmailPrompt } from "./notifications/NotificationPreferences";
import ChatAssistant from "../components/ChatAssistant";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const MainLayout = ({
  children,
  showChat = true,
  aiTips = [],
  gscKeywords = [],
  easyWins = [],
  topPages = [],
  lowCtrPages = [],
  impressionTrends = [],
}) => {
  const { logout, user, isLoading } = useAuth();
  const { data, isLoaded: isOnboardingLoaded } = useOnboarding();
  const { isDarkMode, toggleTheme } = useTheme();
  const pathname = usePathname();
  const router = useRouter();
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

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
      isOnboardingLoaded &&
      !data?.isComplete &&
      pathname !== "/onboarding"
    ) {
      router.push(notificationAuthPath("/onboarding", notificationReturnFromLocation(window.location)));
    }
  }, [isLoading, user, isOnboardingLoaded, data?.isComplete, pathname, router]);

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
    
    // After logout, always go to auth page
    // Users can log in if they have an account, or try to create one
    // If they try to create account with non-approved email, they'll be redirected to request-access
    router.push("/auth");
  };



  const handleChatOpen = (open) => {
    setIsChatOpen(open);
  };

  // Handle manual click to open chat
  const handleManualChatOpen = () => {
    setIsChatOpen(!isChatOpen);
    setShowTooltip(false); // Hide tooltip when chat is opened
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

  // Auto-animate every 30 seconds
  useEffect(() => {
    if (isChatOpen) return; // Don't animate if chat is open

    const interval = setInterval(() => {
      setIsAnimating(true);
      setTimeout(() => {
        setIsAnimating(false);
        // Keep tooltip visible after animation
        setShowTooltip(true);
      }, 5000); // Animation duration
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [isChatOpen]);

  // Don't render anything while loading to prevent hook ordering issues
  if (isLoading) {
    return null;
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

      {/* Chat Assistant */}
      {showChat && (
        <>
          {/* Inline styles for the animation */}
          {isAnimating && (
            <style jsx>{`
              @keyframes bounce-squash {
                0% {
                  transform: translateY(0) scaleX(1) scaleY(1);
                }
                10% {
                  transform: translateY(-20px) scaleX(1.05) scaleY(0.95);
                }
                25% {
                  transform: translateY(-50px) scaleX(0.95) scaleY(1.05);
                }
                50% {
                  transform: translateY(0) scaleX(1.2) scaleY(0.8); /* squash on impact */
                }
                75% {
                  transform: translateY(-30px) scaleX(0.98) scaleY(1.02);
                }
                100% {
                  transform: translateY(0) scaleX(1) scaleY(1);
                }
              }
            `}</style>
          )}
          
          {/* Only show floating chat button if not on chatbot or contact page */}
          {pathname !== "/chatbot" && pathname !== "/contact" && (
            <Popover open={isChatOpen} onOpenChange={handleChatOpen}>
              <PopoverTrigger asChild>
                <div className="fixed bottom-6 right-6" onClick={handleManualChatOpen}>
                <Button
                  className="rounded-full w-14 h-14 shadow-lg flex items-center justify-center z-50 bg-[#00BF63] hover:bg-[#00BF63]/90"
                  aria-label={isChatOpen ? 'Close SEO Mentor' : 'Open SEO Mentor'}
                  size="icon"
                  style={{
                    animation: isAnimating ? 'bounce-squash 1s ease-in-out' : 'none'
                  }}
                >
                  <MessageSquare className="w-6 h-6 text-white" />
                  {unreadMessages > 0 && !isChatOpen && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                      {unreadMessages}
                    </span>
                  )}
                </Button>
                
                {/* Tooltip that appears during animation */}
                {(isAnimating || showTooltip) && (
                  <div 
                    className="fixed bottom-25 right-6 bg-[#00bf63]/8 backdrop-blur-md text-foreground text-sm px-3 py-2 rounded-lg shadow-lg z-50"
                    style={{
                      animation: isAnimating ? 'bounce-squash 1s ease-in-out' : 'none'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <span>Confused? I can help! 🙌</span>
                    </div>
                    <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-[#00bf63]/8"></div>
                  </div>
                )}
              </div>
            </PopoverTrigger>
          <PopoverContent
            side="top"
            align="end"
            className="p-0 rounded-xl shadow-xl backdrop-blur-md bg-white/1 border border-white/10 ring-1 ring-white/20 mr-2 mb-2 z-[60]"
            sideOffset={16}
            style={{ width: 'auto', minWidth: '320px', maxWidth: '100vw' }}
          >
            <div className="overflow-hidden rounded-xl">
              <ChatAssistant
                onClose={() => setIsChatOpen(false)}
                aiTips={aiTips}
                gscKeywords={gscKeywords}
                easyWins={easyWins}
                topPages={topPages}
                lowCtrPages={lowCtrPages}
                impressionTrends={impressionTrends}
              />
            </div>
          </PopoverContent>
            </Popover>
          )}
        </>
      )}
    </div>
  );
};

export default MainLayout;

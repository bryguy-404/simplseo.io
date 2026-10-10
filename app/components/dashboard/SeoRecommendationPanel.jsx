"use client";
import { writeSeoRecord } from "../../lib/writeSeoRecord";

import { Copy, ChevronDown, History } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { db } from "../../lib/firebaseConfig";
import { doc, getDoc, deleteDoc } from "firebase/firestore";
import { useAuth } from "../../contexts/AuthContext";
import {
  fetchWithCache,
  CACHE_DURATIONS,
} from "../../lib/apiCache";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

// Helper function to create safe document IDs
const createSafeDocId = (userId, pageUrl) => {
  // Create a more unique hash to avoid collisions
  let hash = 0;
  for (let i = 0; i < pageUrl.length; i++) {
    const char = pageUrl.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string and take first 16 chars
  const urlHash = Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8);
  return `${userId}_${urlHash}`;
};

// Helper function to capitalize first letter of each word
const capitalizeWords = (text) => {
  if (!text) return '';
  return text
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
};

const SeoRecommendationPanel = ({
  title,
  pageUrl,
  metaTitleTip = "",
  metaDescriptionTip = "",
  suggestedTitle = "",
  suggestedDescription = "",
  keywordSource = "gsc-existing", // "ai-generated" or "gsc-existing"
  focusKeyword = "",
  keywordHistory = [], // Previously tried keywords for this page
  keywordStatsHistory = [], // Stats history from previous keyword attempts
}) => {
  const { user } = useAuth();

  const [isOpen, setIsOpen] = useState(false);
  const [isImplemented, setIsImplemented] = useState(false);
  const [checking, setChecking] = useState(false);
  const [postStats, setPostStats] = useState(null);
  const [delta, setDelta] = useState(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingCheckboxValue, setPendingCheckboxValue] = useState(false);
  const [showRefreshButton, setShowRefreshButton] = useState(false);
  const [daysSinceImplementation, setDaysSinceImplementation] = useState(null);
  const [fortyFiveDayProgress, setFortyFiveDayProgress] = useState(null);
  const [totalDaysTarget, setTotalDaysTarget] = useState(45); // Default 45, can be extended (90, 135, etc.)
  const [currentH1, setCurrentH1] = useState(null);
  const [loadingH1, setLoadingH1] = useState(false);
  const [currentMetaTitle, setCurrentMetaTitle] = useState(null);
  const [currentMetaDescription, setCurrentMetaDescription] = useState(null);
  const [loadingMetaTags, setLoadingMetaTags] = useState(false);
  const fetchedPageUrlRef = useRef(null);
  const [metaTagsExpanded, setMetaTagsExpanded] = useState(false); // For collapsing meta tags when implemented
  const detailsContentRef = useRef(null);
  const [detailsMaxHeight, setDetailsMaxHeight] = useState("0px");
  const metaTagsContentRef = useRef(null);
  const [metaTagsMaxHeight, setMetaTagsMaxHeight] = useState("0px");
  
  // Content Audit tracking states
  const [isContentAuditTracking, setIsContentAuditTracking] = useState(false);
  const [implementationType, setImplementationType] = useState(null); // "e1-meta", "e2-content-gap", etc.

  const copyToClipboard = async (text, type) => {
    try {
      // Remove any surrounding quotes before copying
      const cleanText = text?.replace(/^["']|["']$/g, '') || '';
      await navigator.clipboard.writeText(cleanText);
      const typeLabel = 
        type === "title" ? "Meta title" :
        type === "description" ? "Meta description" :
        type === "h1" ? "H1" :
        "Text";
      toast.success(`${typeLabel} copied to clipboard`);
    } catch {
      toast.error("Failed to copy text");
    }
  };

  const handleImplementation = async (checked) => {
    setIsImplemented(checked);

    if (checked && user?.id && pageUrl) {
      try {
        // Get GSC data using the token manager
        const { createGSCTokenManager } = await import("../../lib/gscTokenManager");
        const tokenManager = createGSCTokenManager(user.id);
        
        let preStats = { impressions: 0, clicks: 0, ctr: 0, position: 0 };
        let gscToken = null;
        let siteUrl = null;

        try {
          // Get stored GSC data
          const gscData = await tokenManager.getStoredGSCData();
          if (gscData?.accessToken && gscData?.siteUrl) {
            gscToken = gscData.accessToken;
            siteUrl = gscData.siteUrl;
            
            // Get valid access token
            const validToken = await tokenManager.getValidAccessToken();
            if (validToken) {
              const res = await fetch("/api/gsc/page-metrics", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token: validToken, siteUrl, pageUrl }),
              });
              if (res.ok) preStats = await res.json();
            }
          }
        } catch (error) {
          console.error("Error getting GSC data:", error);
        }

        const docId = createSafeDocId(user.id, pageUrl);
        const implementedAt = new Date();
        // Set nextUpdateDue to exactly 7 days after implementation
        // This creates an individual 7-day cycle for each tip
        const nextUpdateDue = new Date(implementedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        
        await writeSeoRecord(
          doc(db, "implementedSeoTips", docId),
          {
            userId: user.id,
            pageUrl,
            implementedAt: implementedAt.toISOString(),
            nextUpdateDue: nextUpdateDue.toISOString(), // Individual 7-day schedule
            title: suggestedTitle,
            description: suggestedDescription,
            status: "implemented",
            preStats,
            gscToken, // Save the token for the Firebase function
            siteUrl,  // Save the site URL for the Firebase function
          },
          { merge: true }
        );

        toast.success("SEO tip marked as implemented.");
      } catch (err) {
        console.error("Failed to save implementation:", err);
        toast.error("❌ Failed to save to Firestore.");
      }
    }
  };

  const handleRefreshSuggestions = async () => {
    try {
      // Fetch previous meta optimization attempts for AI learning (with full stats)
      let previousAttempts = [];
      try {
        const docId = createSafeDocId(user.id, pageUrl);
        const seoTipDoc = await getDoc(doc(db, "implementedSeoTips", docId));
        if (seoTipDoc.exists()) {
          const data = seoTipDoc.data();
          const rawHistory = data.metaOptimizationHistory || [];
          // Map to include full stats for smarter AI recommendations
          previousAttempts = rawHistory.slice(-3).map(attempt => ({
            title: attempt.title,
            description: attempt.description,
            outcome: attempt.outcome || "unknown",
            // Include full stats for AI learning
            preStats: attempt.preStats || null,
            postStats: attempt.postStats || attempt.finalStats || null,
            daysTracked: attempt.daysTracked || 0,
            keyword: attempt.keyword || attempt.previousKeyword || null,
            type: attempt.type || "meta-optimization",
          }));
          if (previousAttempts.length > 0) {
            console.log(`🧠 Found ${previousAttempts.length} previous meta attempt(s) with full stats for AI learning`);
          }
        }
      } catch (historyError) {
        console.warn("Could not fetch meta optimization history:", historyError);
      }

      const payload = {
        pageUrl,
        userId: user?.id,
        // ✅ Pass focus keyword to generate consistent cache key
        ...(focusKeyword ? { focusKeywords: [focusKeyword] } : {}),
        // Include previous attempts for AI learning (with full stats)
        ...(previousAttempts.length > 0 ? { previousAttempts } : {}),
      };

      const titleRes = await fetch("/api/seo-assistant/meta-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const descRes = await fetch("/api/seo-assistant/meta-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Build the correct cache key (with focus keyword if available)
      const cacheKey = focusKeyword 
        ? `${pageUrl}::${focusKeyword.toLowerCase()}`
        : pageUrl;
      const encodedCacheKey = encodeURIComponent(cacheKey);
      
      await deleteDoc(doc(db, "seoMetaTitles", encodedCacheKey));
      await deleteDoc(doc(db, "seoMetaDescriptions", encodedCacheKey));

      toast.success("New AI suggestions will appear on next refresh.");
    } catch (err) {
      console.error("Error refreshing suggestions:", err);
      toast.error("❌ Failed to refresh suggestions.");
    }
  };

  const onCheckboxChange = (checked) => {
    setPendingCheckboxValue(checked);
    if (checked) {
      setShowConfirmModal(true);
    } else {
      handleImplementation(false);
    }
  };

  useEffect(() => {
    console.log(`🔍 [${pageUrl}] useEffect triggered - checking if implemented`);
    const fetchExisting = async () => {
      if (!user?.id || !pageUrl) {
        console.log(`🔍 [${pageUrl}] Missing user.id or pageUrl, skipping`);
        return;
      }

      try {
        const docId = createSafeDocId(user.id, pageUrl);
        console.log(`🔍 [${pageUrl}] Fetching implementedSeoTips document:`, docId);
        const snapshot = await getDoc(doc(db, "implementedSeoTips", docId));
        const data = snapshot.data();
        console.log(`🔍 [${pageUrl}] Document data:`, data);
        
        // Check if document exists and has a valid tracking status
        // Valid statuses: "implemented", "e1-tracking", "e2-tracking", etc.
        const validTrackingStatuses = ["implemented", "e1-tracking", "e2-tracking", "content-improving"];
        if (!data || !data.status || !validTrackingStatuses.includes(data.status)) {
          console.log(`🔍 [${pageUrl}] Document doesn't exist or status is not a valid tracking status`);
          return;
        }
        
        console.log(`✅ [${pageUrl}] Document found with status: '${data.status}'`);

        setIsImplemented(true);
        
        // Check if this is a Content Audit tracking page
        // Can be detected by status OR implementationType field
        const isAuditTracking = 
          data.status === "e1-tracking" || 
          data.status === "e2-tracking" || 
          data.status === "content-improving" ||
          data.implementationType === "e1-meta" ||
          data.implementationType === "e2-content-gap" ||
          data.implementationType === "e3-rewrite" ||
          data.implementationType === "e3-pivot" ||
          data.implementationType === "wait-extension";
          
        if (isAuditTracking) {
          setIsContentAuditTracking(true);
          setImplementationType(data.implementationType || data.status);
          console.log(`🎯 [${pageUrl}] Content Audit tracking detected: ${data.implementationType || data.status}`);
        }

        const implementedDate = new Date(data.implementedAt);
        const today = new Date();
        const days = Math.floor(
          (today - implementedDate) / (1000 * 60 * 60 * 24)
        );
        setDaysSinceImplementation(Math.min(days, 7)); // cap at 7 days

        const totalDays = Math.floor(
          (today - implementedDate) / (1000 * 60 * 60 * 24)
        );
        setDaysSinceImplementation(Math.min(totalDays, 7)); // already exists
        
        // Check if user has extended the tracking period (clicked "Wait Another 45 Days")
        const extendedTarget = data.extendedTotalDays || 45;
        setTotalDaysTarget(extendedTarget);
        setFortyFiveDayProgress(Math.min(totalDays, extendedTarget)); // 👈 cap at extended target (45, 90, 135, etc.)

        if (data.preStats && data.postStats) {
          setDelta({
            impressions: data.postStats.impressions - data.preStats.impressions,
            clicks: data.postStats.clicks - data.preStats.clicks,
            ctr: (data.postStats.ctr - data.preStats.ctr).toFixed(2),
            position: (data.postStats.position - data.preStats.position).toFixed(
              2
            ),
          });
        }

        const daysSince =
          (Date.now() - new Date(data.implementedAt).getTime()) /
          (1000 * 60 * 60 * 24);
        const zeroClicks = data?.postStats?.clicks === 0;

        if (daysSince >= 45 && zeroClicks) {
          setShowRefreshButton(true);
        }
      } catch (error) {
        console.error(`❌ [${pageUrl}] Error fetching implementedSeoTips:`, error);
        console.error(`❌ [${pageUrl}] Error details:`, {
          code: error.code,
          message: error.message,
          docId: createSafeDocId(user.id, pageUrl)
        });
        return;
      }
    };

    fetchExisting();
  }, [user, pageUrl]);

  useEffect(() => {
    if (isOpen && detailsContentRef.current) {
      // Use a large fixed value to ensure all content is visible (especially nested collapsibles)
      setDetailsMaxHeight("3000px");
    } else {
      setDetailsMaxHeight("0px");
    }
  }, [
    isOpen,
    isImplemented,
    keywordHistory?.length,
    keywordSource,
    focusKeyword,
    daysSinceImplementation,
    fortyFiveDayProgress,
    totalDaysTarget,
    showRefreshButton,
    loadingMetaTags,
    currentMetaTitle,
    currentMetaDescription,
    loadingH1,
    currentH1,
    metaTagsExpanded,
  ]);

  useEffect(() => {
    if (metaTagsExpanded && metaTagsContentRef.current) {
      // Use a large fixed value to ensure all content is visible
      setMetaTagsMaxHeight("2000px");
    } else {
      setMetaTagsMaxHeight("0px");
    }
  }, [
    metaTagsExpanded,
    keywordSource,
    focusKeyword,
    loadingMetaTags,
    currentMetaTitle,
    currentMetaDescription,
    loadingH1,
    currentH1,
  ]);

  // Fetch H1 from pageContentCache for AI-generated keywords
  useEffect(() => {
    const fetchH1 = async () => {
      if (keywordSource !== "ai-generated" || !user?.id || !pageUrl) {
        return;
      }

      setLoadingH1(true);
      try {
        console.log(`🔍 Fetching H1 for: ${pageUrl}`);
        const response = await fetch("/api/page-content/get-h1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            pageUrl,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`✅ H1 API response:`, data);
          if (data.h1) {
            console.log(`✅ Setting current H1: ${data.h1}`);
            setCurrentH1(data.h1);
          } else {
            console.log(`⚠️ No H1 in response`);
            setCurrentH1(null);
          }
        } else {
          const errorData = await response.json().catch(() => ({}));
          console.error(`❌ H1 API error: ${response.status}`, errorData);
          setCurrentH1(null);
        }
      } catch (error) {
        console.error("Error fetching H1:", error);
        setCurrentH1(null);
      } finally {
        setLoadingH1(false);
      }
    };

    if (isOpen && keywordSource === "ai-generated") {
      fetchH1();
    }
  }, [isOpen, keywordSource, user?.id, pageUrl]);

  // Fetch current meta tags when panel opens (with caching)
  useEffect(() => {
    const fetchCurrentMetaTags = async () => {
      if (!isOpen || !pageUrl) return;
      
      // Reset state if pageUrl changed
      if (fetchedPageUrlRef.current !== pageUrl) {
        setCurrentMetaTitle(null);
        setCurrentMetaDescription(null);
        fetchedPageUrlRef.current = pageUrl;
      }
      
      // Don't fetch if we already have data for this pageUrl (same session)
      if (fetchedPageUrlRef.current === pageUrl && (currentMetaTitle !== null || currentMetaDescription !== null)) {
        return;
      }
      
      setLoadingMetaTags(true);
      try {
        const result = await fetchWithCache(
          "/api/scrape-content",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pageUrl }),
          },
          24 * 60 * 60 * 1000, // 24 hours cache
          { pageUrl } // cache params
        );

        if (result.success && result.data) {
          setCurrentMetaTitle(result.data.title || null);
          setCurrentMetaDescription(result.data.metaDescription || null);
        }
      } catch (error) {
        console.error("Error fetching current meta tags:", error);
        setCurrentMetaTitle(null);
        setCurrentMetaDescription(null);
      } finally {
        setLoadingMetaTags(false);
      }
    };

    fetchCurrentMetaTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pageUrl]);

  return (
    <>
      <Collapsible
        open={isOpen}
        onOpenChange={setIsOpen}
        className="w-full space-y-2"
      >
        <CollapsibleTrigger className="flex w-full flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-lg border p-4 font-medium hover:bg-muted/50 data-[state=open]:bg-muted/50">
          <div className="flex flex-col items-start gap-1 min-w-0 flex-1">
            <div className="flex items-center gap-2 w-full min-w-0">
              <div
                className={`h-2 w-2 rounded-full flex-shrink-0 ${
                  isImplemented ? "bg-green-500" : "bg-yellow-500"
                }`}
              />
              <a
                href={pageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-primary hover:text-primary/80 truncate block max-w-full"
                onClick={(e) => e.stopPropagation()}
              >
                {title.replace(/^Fix:\s*/, "")}
              </a>
            </div>
            {focusKeyword && (
              <div className="text-xs text-muted-foreground pl-4 truncate max-w-full">
                Focus Keyword: <span className="font-medium text-foreground">{focusKeyword}</span>
              </div>
            )}
          </div>
          <div className="text-muted-foreground text-sm flex-shrink-0 self-start sm:self-center">
            {isOpen ? "Hide details" : "Show details"}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent
          forceMount
          className="rounded-lg border bg-card shadow-sm overflow-hidden"
          style={{
            maxHeight: detailsMaxHeight,
            opacity: isOpen ? 1 : 0,
            padding: isOpen ? "1rem" : "0px",
            pointerEvents: isOpen ? "auto" : "none",
            display: "block",
            transition: "max-height 300ms ease, opacity 300ms ease, padding 300ms ease",
          }}
        >
          <div ref={detailsContentRef} className="space-y-4">
            {/* Content Audit Tracking Label - Show when tracking E1/E2 implementation */}
            {isContentAuditTracking && (
              <div className="rounded-lg border-2 border-purple-300 dark:border-purple-700 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/30 dark:to-pink-900/30 p-3 mb-2">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-purple-500 animate-pulse" />
                  <span className="text-sm font-semibold text-purple-800 dark:text-purple-200">
                    {implementationType === "e1-meta" && "Content Audit Meta Implementation - Tracking Progress"}
                    {implementationType === "e2-content-gap" && "Content Gap Implementation - Tracking Progress"}
                    {implementationType === "e3-rewrite" && "Content Rewrite - Tracking Progress"}
                    {implementationType === "e3-pivot" && "Keyword Pivot - Tracking Progress"}
                    {implementationType === "wait-extension" && "Wait Extension - Tracking Progress"}
                    {implementationType === "e1-tracking" && "Content Audit Meta Implementation - Tracking Progress"}
                    {implementationType === "e2-tracking" && "Content Gap Implementation - Tracking Progress"}
                    {implementationType === "content-improving" && "Content Improvement - Tracking Progress"}
                    {!["e1-meta", "e2-content-gap", "e3-rewrite", "e3-pivot", "wait-extension", "e1-tracking", "e2-tracking", "content-improving"].includes(implementationType) && "Content Audit - Tracking Progress"}
                  </span>
                </div>
                <p className="text-xs text-purple-600 dark:text-purple-400 mt-1 ml-5">
                  Your implementation is being tracked. Check back in 7 days for initial results.
                </p>
              </div>
            )}
            
            <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Fix this SEO issue</h3>
            {keywordSource === "ai-generated" && !isContentAuditTracking && (
              <span className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded">
                AI Suggested Keyword
              </span>
            )}
            </div>

          {/* Previously Tried Keywords Section - Show when there's keyword history */}
          {keywordHistory && keywordHistory.length > 0 && (
            <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/20 p-3">
              <div className="flex items-center gap-2 mb-2">
                <History className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                  Previously Tried Keywords
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {keywordHistory.map((item, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-1 rounded bg-amber-100/80 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 line-through"
                    title={`Tested on ${new Date(item.testedAt).toLocaleDateString()}`}
                  >
                    {item.keyword}
                    {item.source === "ai-generated" && (
                      <span className="ml-1 text-purple-600 dark:text-purple-400">(AI)</span>
                    )}
                  </span>
                ))}
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                These keywords were previously tested but didn&apos;t perform as expected after 45+ days.
              </p>
            </div>
          )}

          {keywordSource === "ai-generated" && focusKeyword && (
            <div className="rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 p-3 mb-4">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                Keyword: <span className="font-semibold">{focusKeyword}</span>
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Status: Not ranking yet (AI suggested)
              </p>
            </div>
          )}

          <div className="space-y-4">
            {/* Show "Waiting for Results" FIRST when implemented */}
            {isImplemented && daysSinceImplementation !== null && (
              <div className="space-y-4 w-full">
                {/* 7-Day Progress */}
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>{daysSinceImplementation >= 7 ? '✓ Results Ready!' : 'Waiting for Results (7 Days)'}</span>
                    <span>{daysSinceImplementation}/7 days</span>
                  </div>
                  <div className="h-2 w-full rounded bg-muted/60">
                    <div
                      className={`h-2 rounded transition-all duration-500 ${daysSinceImplementation >= 7 ? 'bg-green-500' : 'bg-primary'}`}
                      style={{
                        width: `${(daysSinceImplementation / 7) * 100}%`,
                      }}
                    />
                  </div>
                  {daysSinceImplementation >= 7 ? (
                    <div className="mt-2 p-2 rounded-md bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                      <p className="text-sm text-green-700 dark:text-green-300 font-medium">
                        7 days have passed! Your SEO progress is now available.
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        Check the <strong>SEO Progress</strong> section below to see how your changes are performing.
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      Your changes are being tracked! Google recommends waiting 7
                      days to let your SEO changes take effect. We&apos;ll track
                      performance and show results in the SEO Progress section
                      once enough data is available.
                    </p>
                  )}
                </div>

                {/* Progress to New Ideas */}
                {fortyFiveDayProgress !== null && (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                      <span>
                        Check Back for New Ideas ({totalDaysTarget} Days)
                        {totalDaysTarget > 45 && (
                          <span className="ml-1 text-amber-500 dark:text-amber-400">
                            (Extended)
                          </span>
                        )}
                      </span>
                      <span>{fortyFiveDayProgress}/{totalDaysTarget} days</span>
                    </div>
                    <div className="h-2 w-full rounded bg-muted/60">
                      <div
                        className={`h-2 rounded transition-all duration-500 ${
                          totalDaysTarget > 45 
                            ? "bg-gradient-to-r from-primary/70 to-amber-500/70" 
                            : "bg-primary/70"
                        }`}
                        style={{
                          width: `${(fortyFiveDayProgress / totalDaysTarget) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {totalDaysTarget > 45 ? (
                        <>
                          You extended tracking to gather more data. We&apos;ll evaluate again at {totalDaysTarget} days.
                        </>
                      ) : (
                        <>
                          No clicks after {totalDaysTarget} days? You&apos;ll be able to refresh this
                          recommendation and get updated suggestions tailored to
                          your page
                        </>
                      )}
                    </p>
                  </div>
                )}

                {/* Continuous Progress Info - only show before 7 days */}
                {daysSinceImplementation < 7 && (
                  <div className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-2 text-xs text-blue-700 dark:text-blue-300">
                    <span className="font-medium">💡 Tip:</span> After 7 days, your progress will appear in the SEO Progress section below. 
                    The system continues monitoring your performance daily, so check back regularly for ongoing updates!
                  </div>
                )}

                {/* Try New Suggestions button - hidden for now
                {showRefreshButton && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" onClick={handleRefreshSuggestions}>
                        🔁 Try New Suggestions
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      No clicks after 45 days. Click to get fresh AI title and
                      description.
                    </TooltipContent>
                  </Tooltip>
                )}
                */}
              </div>
            )}

            {/* Meta Tags Section - Collapsible when implemented */}
            {isImplemented ? (
              <Collapsible open={metaTagsExpanded} onOpenChange={setMetaTagsExpanded}>
                <CollapsibleTrigger className="flex w-full items-center justify-between rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 p-3 text-sm font-medium hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="text-green-700 dark:text-green-300">View Implemented Meta Tags</span>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-green-600 dark:text-green-400 transition-transform ${metaTagsExpanded ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent
                  forceMount
                  className="overflow-hidden"
                  style={{
                    maxHeight: metaTagsMaxHeight,
                    opacity: metaTagsExpanded ? 1 : 0,
                    marginTop: metaTagsExpanded ? "0.75rem" : "0px",
                    pointerEvents: metaTagsExpanded ? "auto" : "none",
                    display: "block",
                    transition: "max-height 300ms ease, opacity 300ms ease, margin 300ms ease",
                  }}
                >
                  <div ref={metaTagsContentRef} className="space-y-4">
                    <div>
                    <Label className="mb-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      {keywordSource === "ai-generated" ? "Step 1: Optimize Meta Tags" : "Optimize Meta Tags"}
                    </Label>
                    {keywordSource === "ai-generated" && (
                      <div className="mb-3 rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 p-3">
                        <p className="text-xs text-blue-900 dark:text-blue-100">
                          <strong>💡 What you&apos;re changing:</strong> The <strong>Meta Title</strong> is the clickable headline shown in Google search results, and the <strong>Meta Description</strong> is the short text snippet that appears below the title.
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                          <strong>📍 Where to find them:</strong> These are typically found in your website&apos;s SEO settings, page editor, or plugin settings (like Yoast SEO, Rank Math, or All in One SEO). Look for fields labeled &quot;SEO Title&quot; or &quot;Meta Title&quot; and &quot;Meta Description&quot; when editing your page.
                        </p>
                      </div>
                    )}
                    <div className="space-y-4">
                      {/* Meta Title Comparison Card */}
                      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                        <Label className="text-sm font-medium">Meta Title</Label>
                        <div className="space-y-2">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Current</Label>
                            {loadingMetaTags ? (
                              <p className="text-xs text-muted-foreground italic">Loading...</p>
                            ) : currentMetaTitle ? (
                              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-300 dark:border-amber-700 text-sm text-amber-700 dark:text-amber-300">
                                {currentMetaTitle}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">Not found</p>
                            )}
                          </div>
                          <div className="flex items-center justify-center py-1 text-green-600 font-medium">
                            ✓ Implemented
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Suggested</Label>
                            <div className="flex items-center justify-between gap-2">
                              <Textarea
                                value={suggestedTitle?.replace(/^["']|["']$/g, '') || ''}
                                readOnly
                                className="resize-none flex-1 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900/40 text-green-900 dark:text-green-100"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => copyToClipboard(suggestedTitle?.replace(/^["']|["']$/g, '') || '', "title")}
                                className="flex-shrink-0"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Meta Description Comparison Card */}
                      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                        <Label className="text-sm font-medium">Meta Description</Label>
                        <div className="space-y-2">
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Current</Label>
                            {loadingMetaTags ? (
                              <p className="text-xs text-muted-foreground italic">Loading...</p>
                            ) : currentMetaDescription ? (
                              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-300 dark:border-amber-700 text-sm text-amber-700 dark:text-amber-300 max-h-32 overflow-y-auto">
                                {currentMetaDescription}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">Not found</p>
                            )}
                          </div>
                          <div className="flex items-center justify-center py-1 text-green-600 font-medium">
                            ✓ Implemented
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground mb-1 block">Suggested</Label>
                            <div className="flex items-center justify-between gap-2">
                              <Textarea
                                value={suggestedDescription?.replace(/^["']|["']$/g, '') || ''}
                                readOnly
                                className="resize-none flex-1 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900/40 text-green-900 dark:text-green-100"
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  copyToClipboard(suggestedDescription?.replace(/^["']|["']$/g, '') || '', "description")
                                }
                                className="flex-shrink-0"
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                    {/* H1 Replacement Section for AI-generated keywords (inside collapsible when implemented) */}
                    {keywordSource === "ai-generated" && focusKeyword && (
                      <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
                      <Label className="mb-3 block font-semibold flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-500"></span>
                        Step 2: Update Page Content
                      </Label>
                      <div className="mb-3 rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 p-3">
                        <p className="text-xs text-blue-900 dark:text-blue-100">
                          <strong>💡 What you&apos;re changing:</strong> The H1 (Heading 1) is the main title that appears at the top of your page content. It&apos;s the largest heading on the page and tells both users and search engines what the page is about.
                        </p>
                        <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                          <strong>📍 Where to find it:</strong> In your page editor (WordPress, Wix, Squarespace, etc.), look for the main title field at the top of your content editor. It&apos;s usually the first thing you see when editing a page. Replace the current H1 with the suggested one below.
                        </p>
                      </div>
                      {loadingH1 ? (
                        <p className="text-sm text-muted-foreground">Loading current H1...</p>
                      ) : currentH1 ? (
                        <div className="space-y-3">
                          <div className="rounded-md border bg-background p-3 space-y-2">
                            <div className="text-sm">
                              <span className="text-muted-foreground font-medium">Current H1: <span className="text-muted-foreground/70 font-normal">(H1 is the header/title in your page)</span></span>
                              <div className="mt-1 p-2 bg-muted/50 rounded border border-muted">
                                <span className="font-medium text-foreground">{currentH1}</span>
                              </div>
                            </div>
                            <div className="flex items-center justify-center text-muted-foreground">
                              ↓
                            </div>
                            <div className="text-sm">
                              <span className="text-muted-foreground font-medium">Replace with:</span>
                              <div className="mt-1 p-2 bg-primary/10 rounded border border-primary/30">
                                <span className="font-semibold text-primary">{capitalizeWords(focusKeyword)}</span>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(capitalizeWords(focusKeyword), "h1")}
                            className="w-full"
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy H1 Replacement
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-md border bg-background p-3">
                            <div className="text-sm">
                              <span className="text-muted-foreground font-medium">Suggested H1:</span>
                              <div className="mt-1 p-2 bg-primary/10 rounded border border-primary/30">
                                <span className="font-semibold text-primary">{capitalizeWords(focusKeyword)}</span>
                              </div>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyToClipboard(capitalizeWords(focusKeyword), "h1")}
                            className="w-full"
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            Copy H1 Replacement
                          </Button>
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-3">
                        💡 <strong>Why:</strong> This keyword isn&apos;t ranking yet. Adding it to your H1 helps Google understand what this page is about.
                      </p>
                    </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              /* Not implemented - show everything normally */
              <>
                <div>
                  <Label className="mb-2 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    {keywordSource === "ai-generated" ? "Step 1: Optimize Meta Tags" : "Optimize Meta Tags"}
                  </Label>
                  {keywordSource === "ai-generated" && (
                    <div className="mb-3 rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 p-3">
                      <p className="text-xs text-blue-900 dark:text-blue-100">
                        <strong>💡 What you&apos;re changing:</strong> The <strong>Meta Title</strong> is the clickable headline shown in Google search results, and the <strong>Meta Description</strong> is the short text snippet that appears below the title.
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                        <strong>📍 Where to find them:</strong> These are typically found in your website&apos;s SEO settings, page editor, or plugin settings (like Yoast SEO, Rank Math, or All in One SEO). Look for fields labeled &quot;SEO Title&quot; or &quot;Meta Title&quot; and &quot;Meta Description&quot; when editing your page.
                      </p>
                    </div>
                  )}
                  <div className="space-y-4">
                    {/* Meta Title Comparison Card */}
                    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                      <Label className="text-sm font-medium">Meta Title</Label>
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Current</Label>
                          {loadingMetaTags ? (
                            <p className="text-xs text-muted-foreground italic">Loading...</p>
                          ) : currentMetaTitle ? (
                            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-300 dark:border-amber-700 text-sm text-amber-700 dark:text-amber-300">
                              {currentMetaTitle}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">Not found</p>
                          )}
                        </div>
                        <div className="flex items-center justify-center py-1 text-muted-foreground">
                          ↓ Replace with ↓
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Suggested</Label>
                          <div className="flex items-center justify-between gap-2">
                            <Textarea
                              value={suggestedTitle?.replace(/^["']|["']$/g, '') || ''}
                              readOnly
                              className="resize-none flex-1 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900/40 text-green-900 dark:text-green-100"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(suggestedTitle?.replace(/^["']|["']$/g, '') || '', "title")}
                              className="flex-shrink-0"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Meta Description Comparison Card */}
                    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
                      <Label className="text-sm font-medium">Meta Description</Label>
                      <div className="space-y-2">
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Current</Label>
                          {loadingMetaTags ? (
                            <p className="text-xs text-muted-foreground italic">Loading...</p>
                          ) : currentMetaDescription ? (
                            <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded border border-amber-300 dark:border-amber-700 text-sm text-amber-700 dark:text-amber-300 max-h-32 overflow-y-auto">
                              {currentMetaDescription}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic">Not found</p>
                          )}
                        </div>
                        <div className="flex items-center justify-center py-1 text-muted-foreground">
                          ↓ Replace with ↓
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground mb-1 block">Suggested</Label>
                          <div className="flex items-center justify-between gap-2">
                            <Textarea
                              value={suggestedDescription?.replace(/^["']|["']$/g, '') || ''}
                              readOnly
                              className="resize-none flex-1 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-900/40 text-green-900 dark:text-green-100"
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                copyToClipboard(suggestedDescription?.replace(/^["']|["']$/g, '') || '', "description")
                              }
                              className="flex-shrink-0"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* H1 Replacement Section for AI-generated keywords */}
                {keywordSource === "ai-generated" && focusKeyword && (
                  <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
                    <Label className="mb-3 block font-semibold flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-green-500"></span>
                      Step 2: Update Page Content
                    </Label>
                    <div className="mb-3 rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 p-3">
                      <p className="text-xs text-blue-900 dark:text-blue-100">
                        <strong>💡 What you&apos;re changing:</strong> The H1 (Heading 1) is the main title that appears at the top of your page content. It&apos;s the largest heading on the page and tells both users and search engines what the page is about.
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                        <strong>📍 Where to find it:</strong> In your page editor (WordPress, Wix, Squarespace, etc.), look for the main title field at the top of your content editor. It&apos;s usually the first thing you see when editing a page. Replace the current H1 with the suggested one below.
                      </p>
                    </div>
                    {loadingH1 ? (
                      <p className="text-sm text-muted-foreground">Loading current H1...</p>
                    ) : currentH1 ? (
                      <div className="space-y-3">
                        <div className="rounded-md border bg-background p-3 space-y-2">
                          <div className="text-sm">
                            <span className="text-muted-foreground font-medium">Current H1: <span className="text-muted-foreground/70 font-normal">(H1 is the header/title in your page)</span></span>
                            <div className="mt-1 p-2 bg-muted/50 rounded border border-muted">
                              <span className="font-medium text-foreground">{currentH1}</span>
                            </div>
                          </div>
                          <div className="flex items-center justify-center text-muted-foreground">
                            ↓
                          </div>
                          <div className="text-sm">
                            <span className="text-muted-foreground font-medium">Replace with:</span>
                            <div className="mt-1 p-2 bg-primary/10 rounded border border-primary/30">
                              <span className="font-semibold text-primary">{capitalizeWords(focusKeyword)}</span>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(capitalizeWords(focusKeyword), "h1")}
                          className="w-full"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy H1 Replacement
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="rounded-md border bg-background p-3">
                          <div className="text-sm">
                            <span className="text-muted-foreground font-medium">Suggested H1:</span>
                            <div className="mt-1 p-2 bg-primary/10 rounded border border-primary/30">
                              <span className="font-semibold text-primary">{capitalizeWords(focusKeyword)}</span>
                            </div>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => copyToClipboard(capitalizeWords(focusKeyword), "h1")}
                          className="w-full"
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Copy H1 Replacement
                        </Button>
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-3">
                      💡 <strong>Why:</strong> This keyword isn&apos;t ranking yet. Adding it to your H1 helps Google understand what this page is about.
                    </p>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="implemented"
                    checked={isImplemented}
                    onCheckedChange={onCheckboxChange}
                  />
                  <Label htmlFor="implemented">
                    I&apos;ve updated this on my site
                  </Label>
                </div>
              </>
            )}

            {/* Show implemented message (for implemented state) */}
            {isImplemented && (
              <div className="flex items-center gap-2 text-green-600 font-medium">
                ✓ You've marked this as implemented.
              </div>
            )}
          </div>
        </div>
        </CollapsibleContent>
      </Collapsible>

      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-lg transition-colors">
            <h2 className="mb-2 text-lg font-semibold text-foreground">Confirm Update</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              Are you sure you&apos;ve updated this SEO recommendation on your live
              site? This will impact your performance tracking.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowConfirmModal(false);
                  setPendingCheckboxValue(false);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setShowConfirmModal(false);
                  await handleImplementation(true);
                  // Refresh the page so user can see the updated UI (SEO Progress card, etc.)
                  window.location.reload();
                }}
              >
                Yes, I've updated it
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SeoRecommendationPanel;

"use client";
import { authenticatedFetch } from "../../lib/authenticatedFetch";
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
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [pendingCheckboxValue, setPendingCheckboxValue] = useState(false);
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
    if (checking || !user?.id || !pageUrl) return;
    if (!checked) {
      setChecking(true);
      try {
        await writeSeoRecord(doc(db, 'implementedSeoTips', createSafeDocId(user.id, pageUrl)), {
          userId: user.id, pageUrl, status: 'cancelled', cancelledAt: new Date().toISOString(),
        }, { merge: true });
        setIsImplemented(false);
        window.dispatchEvent(new Event('seo-implementation-changed'));
      } catch { toast.error('Unable to save. Your change is still marked as confirmed.'); }
      finally { setChecking(false); }
      return;
    }
    if (checked && user?.id && pageUrl) {
      setChecking(true);
      try {
        const docId = createSafeDocId(user.id, pageUrl);
        const implementedAt = new Date();
        await writeSeoRecord(
          doc(db, "implementedSeoTips", docId),
          {
            userId: user.id,
            pageUrl,
            implementedAt: implementedAt.toISOString(),
            title: suggestedTitle,
            description: suggestedDescription,
            status: "implemented",
          },
          { merge: true }
        );

        setIsImplemented(true);
        window.dispatchEvent(new Event('seo-implementation-changed'));
        toast.success("Change confirmed. Page progress will show dated observations as they become available.");
      } catch (err) {
        console.error("Failed to save implementation:", err);
        toast.error("❌ Failed to save to Firestore.");
      } finally { setChecking(false); }
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

      const titleRes = await authenticatedFetch("/api/seo-assistant/meta-title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const descRes = await authenticatedFetch("/api/seo-assistant/meta-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      // Build the correct cache key (with focus keyword if available)
      const cacheKey = focusKeyword 
        ? `${pageUrl}::${focusKeyword.toLowerCase()}`
        : pageUrl;
      const encodedCacheKey = encodeURIComponent(cacheKey);
      
      await deleteDoc(doc(db, "seoMetaTitles", user.id, "titles", encodedCacheKey));
      await deleteDoc(doc(db, "seoMetaDescriptions", user.id, "descriptions", encodedCacheKey));

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
        
        // Check if document exists and has a valid tracking status
        // Valid statuses: "implemented", "e1-tracking", "e2-tracking", etc.
        const validTrackingStatuses = ["implemented", "e1-tracking", "e2-tracking", "content-improving"];
        if (!data || data.preRevampArchived || !data.status || !validTrackingStatuses.includes(data.status)) {
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
        const response = await authenticatedFetch("/api/page-content/get-h1", {
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
                  Your change is saved. Check Page progress for dated search observations.
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
                These keywords were used previously. Their historical performance results are unverified.
              </p>
            </div>
          )}

          {keywordSource === "ai-generated" && focusKeyword && (
            <div className="rounded-md border border-blue-200 dark:border-blue-900/40 bg-blue-50 dark:bg-blue-900/20 p-3 mb-4">
              <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                Keyword: <span className="font-semibold">{focusKeyword}</span>
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-300">
                Source: AI suggestion; ranking has not been verified
              </p>
            </div>
          )}

          <div className="space-y-4">
            {isImplemented && <p className="rounded border p-3 text-sm text-muted-foreground">
              Your change is saved. Page progress compares two complete 28-day periods, with a reporting delay. Low traffic can make this comparison inconclusive; elapsed time alone does not establish a result.
            </p>}

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
                        💡 <strong>Why:</strong> This is an AI suggestion. Use it only if it accurately describes the page; ranking has not been verified.
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
                      💡 <strong>Why:</strong> This is an AI suggestion. Use it only if it accurately describes the page; ranking has not been verified.
                    </p>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="implemented"
                    checked={isImplemented}
                    disabled={checking}
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

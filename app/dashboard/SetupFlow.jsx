"use client";
import { searchWindow } from "../lib/searchWindow";

import { reconnectGsc } from "../lib/reconnectGsc";
import { authenticatedFetch } from "../lib/authenticatedFetch";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../lib/firebaseConfig";
import { createGSCTokenManager } from "../lib/gscTokenManager";
import MainLayout from "../components/MainLayout";
import PageProgress from "../components/dashboard/PageProgress";
import { useRouter } from "next/navigation";
import SeoRecommendationPanel from "../components/dashboard/SeoRecommendationPanel";
import Link from "next/link";
import SquashBounceLoader from "../components/ui/squash-bounce-loader";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useOnboarding } from "../contexts/OnboardingContext";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Unlink,
  AlertTriangle,
  FileText,
  Plus,
  X,
  RefreshCw,
  Info,
  HelpCircle,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import DateRangeFilter from "../components/dashboard/DateRangeFilter";
import KeywordTable from "../components/dashboard/KeywordTable";
import ContentExpansionCard from "../components/dashboard/ContentExpansionCard";
import LongTailKeywordCard from "../components/dashboard/LongTailKeywordCard";
import GenericKeywordCard from "../components/dashboard/GenericKeywordCard";
import { toast } from "sonner";
import {
  saveFocusKeywords,
  getFocusKeywords,
} from "../lib/firestoreHelpers";
import {
  fetchWithCache,
  CACHE_DURATIONS,
  generateKeywordSignature,
  clearCache,
} from "../lib/apiCache";
import FocusKeywordSelector from "../components/dashboard/FocusKeywordSelector";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { initializeFeedbackTracking } from "../lib/feedbackPromptTracker";

const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

// Normalize URL for comparison (remove trailing slashes, ensure consistent format)
const normalizeUrlForComparison = (url) => {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Remove trailing slash except for root
    const normalized = u.pathname === '/' ? u.origin : u.origin + u.pathname.replace(/\/$/, '');
    return normalized.toLowerCase();
  } catch {
    // Fallback: just remove trailing slash and lowercase
    return url.trim().replace(/\/$/, '').toLowerCase();
  }
};

if (typeof window !== "undefined") {
  window.google = window.google || {};
}

export default function Dashboard() {
  const { data, updateData } = useOnboarding();
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [isGscConnected, setIsGscConnected] = useState(false);
  const [gscAccessToken, setGscAccessToken] = useState(null);
  const [gscKeywords, setGscKeywords] = useState([]);
  const [gscImpressionTrends, setGscImpressionTrends] = useState([]);
  const dateRange = "28"; // Fixed at 28 days for all dashboard data (optimal sweet spot)
  const [chartDateRange, setChartDateRange] = useState("28"); // Separate date range for chart only
  const [topPages, setTopPages] = useState([]);
  const [lowCtrPages, setLowCtrPages] = useState([]);
  const [aiTips, setAiTips] = useState([]);
  const [generatedTitles, setGeneratedTitles] = useState([]);
  const [generatedMeta, setGeneratedMeta] = useState([]);
  const [hasShownGscError, setHasShownGscError] = useState(false);
  const [gscAlert, setGscAlert] = useState(null);
  const [isLoadingGscData, setIsLoadingGscData] = useState(false);
  const [isRefreshingData, setIsRefreshingData] = useState(false); // ✅ NEW: Track refresh state

  // Use AI-powered filtering for non-branded keywords
  const [nonBrandedKeywords, setNonBrandedKeywords] = useState([]);
  const [isFilteringKeywords, setIsFilteringKeywords] = useState(false);
  const [focusKeywords, setFocusKeywords] = useState([]);
  const [focusKeywordByPage, setFocusKeywordByPage] = useState(new Map());
  const [focusKeywordSourceByPage, setFocusKeywordSourceByPage] = useState(new Map()); // Track source: "ai-generated" or "gsc-existing"
  const [initialFocusKeywordsLoaded, setInitialFocusKeywordsLoaded] = useState(
    false
  );
  const [isSavingFocusKeywords, setIsSavingFocusKeywords] = useState(false);
  const [hasAutoSelectedFocusKeywords, setHasAutoSelectedFocusKeywords] =
    useState(false);
  const [crawlPages, setCrawlPages] = useState([]);
  const [isLoadingCrawlReview, setIsLoadingCrawlReview] = useState(false);
  const [hasLoadedCrawlReview, setHasLoadedCrawlReview] = useState(false);
  const [needsCrawlReview, setNeedsCrawlReview] = useState(false);
  const [reviewSelections, setReviewSelections] = useState(new Map());
  const [manualReviewUrls, setManualReviewUrls] = useState([]);
  const [newUrlInput, setNewUrlInput] = useState("");
  const [isRecrawling, setIsRecrawling] = useState(false);
  const [isInitialCrawlRunning, setIsInitialCrawlRunning] = useState(false);

  // Normalize page URLs consistently - same logic as normalizeUrlForComparison
  // This ensures consistent keys when storing and looking up focus keywords
  const normalizePageKey = (page) => {
    if (!page) return "__unknown__";
    try {
      const u = new URL(page);
      // Remove trailing slash except for root
      const normalized = u.pathname === '/' ? u.origin : u.origin + u.pathname.replace(/\/$/, '');
      return normalized.toLowerCase();
    } catch {
      // Fallback: just remove trailing slash and lowercase
      return page.trim().replace(/\/$/, '').toLowerCase();
    }
  };
  const assignmentsToEntries = (assignments, sourceMap = new Map()) =>
    Array.from(assignments.entries())
      .map(([pageKey, keyword]) => {
        if (typeof keyword !== "string") return null;
        const trimmed = keyword.trim();
        if (!trimmed) return null;
        const source = sourceMap.get(pageKey) || "gsc-existing"; // Default to gsc-existing if not specified
        return {
          keyword: trimmed,
          pageUrl: pageKey === "__unknown__" ? null : pageKey,
          source, // "ai-generated" or "gsc-existing"
        };
      })
      .filter(Boolean);

  const focusKeywordSet = useMemo(
    () =>
      new Set(
        (focusKeywords || []).map((keyword) => keyword.trim().toLowerCase())
      ),
    [focusKeywords]
  );

  const focusKeywordAssignmentsByKeyword = useMemo(() => {
    const map = new Map();
    focusKeywordByPage.forEach((keyword, pageKey) => {
      if (!keyword) return;
      const normalizedKeyword = keyword.trim().toLowerCase();
      if (!normalizedKeyword) return;
      map.set(normalizedKeyword, pageKey === "__unknown__" ? null : pageKey);
    });
    return map;
  }, [focusKeywordByPage]);

  const normalizeManualUrl = useCallback(
    (value) => {
      if (!value || !data?.websiteUrl) return null;
      try {
        const raw = value.trim();
        if (!raw) return null;
        const base = data.websiteUrl.startsWith("http")
          ? data.websiteUrl
          : `https://${data.websiteUrl}`;
        const baseUrl = new URL(base);
        const baseHostname = baseUrl.hostname.replace(/^www\./, ""); // Normalize: remove www
        const baseOrigin = baseUrl.origin;

        const normalized = new URL(raw, baseOrigin).toString();
        const cleaned = normalized.split("#")[0].replace(/\/$/, "");
        const cleanedUrl = new URL(cleaned);
        const cleanedHostname = cleanedUrl.hostname.replace(/^www\./, ""); // Normalize: remove www

        // Compare hostnames (without www) instead of full origins
        if (cleanedHostname !== baseHostname) return null;

        return cleaned;
      } catch {
        return null;
      }
    },
    [data?.websiteUrl]
  );

  const loadCrawlReview = useCallback(
    async (force = false) => {
      if (!user?.id) return;
      if (isLoadingCrawlReview) return;
      if (!force && hasLoadedCrawlReview) return;
      try {
        setIsLoadingCrawlReview(true);
        const res = await authenticatedFetch(`/api/crawl-site/review?userId=${user.id}`);
        if (!res.ok) {
          throw new Error("Failed to load crawl pages");
        }
        const json = await res.json();
        const prefs = json?.preferences || {};
        const manualSet = new Set(prefs.manualUrls || []);
        const approvedSet = new Set(prefs.approvedUrls || []);
        const excludedSet = new Set(prefs.excludedUrls || []);

        const pages = (json?.pages || []).map((page) => {
          const tags = Array.isArray(page.tags) ? [...page.tags] : [];
          if (page.isNavLink && !tags.includes("Navigation")) {
            tags.push("Navigation");
          }
          if (manualSet.has(page.pageUrl) && !tags.includes("Added")) {
            tags.push("Added");
          }
          if (approvedSet.has(page.pageUrl) && !tags.includes("Priority")) {
            tags.push("Priority");
          }

          return {
            ...page,
            tags,
            kept: page.kept !== false && !excludedSet.has(page.pageUrl),
          };
        });

        const selectionMap = new Map();
        pages.forEach((page) => {
          selectionMap.set(page.pageUrl, page.kept !== false);
        });

        setCrawlPages(pages);
        setReviewSelections(selectionMap);
        setManualReviewUrls(Array.from(new Set(prefs.manualUrls || [])));
        setHasLoadedCrawlReview(true);
        const requiresReview =
          typeof json?.requiresReview === "boolean"
            ? json.requiresReview
            : json?.status === "awaiting-review";
        setNeedsCrawlReview(requiresReview && pages.length > 0);
      } catch (error) {
        console.error("⚠️ Failed to load crawl review:", error);
        toast.error("Could not load crawled pages.", {
          description: error?.message || "Please try again.",
        });
      } finally {
        setIsLoadingCrawlReview(false);
      }
    },
    [user?.id, isLoadingCrawlReview, hasLoadedCrawlReview]
  );
  const hasFocusKeywords = focusKeywords.length > 0;

  // Initialize feedback tracking on first dashboard visit
  useEffect(() => {
    if (user?.id) {
      initializeFeedbackTracking(user.id);
    }
  }, [user?.id]);

  useEffect(() => {
    if (
      data?.siteCrawlStatus === "completed" ||
      data?.siteCrawlStatus === "completed-with-errors" ||
      data?.siteCrawlStatus === "awaiting-review"
    ) {
      loadCrawlReview();
    }
  }, [data?.siteCrawlStatus, loadCrawlReview]);
  const crawlTriggeredRef = useRef(false);

  const handleTogglePage = (pageUrl, checked) => {
    setReviewSelections((prev) => {
      const updated = new Map(prev);
      updated.set(pageUrl, checked === true);
      return updated;
    });
  };

  const handleAddManualUrl = () => {
    const normalized = normalizeManualUrl(newUrlInput);
    if (!normalized) {
      toast.error("Enter a valid URL on your website.");
      return;
    }
    if (
      manualReviewUrls.includes(normalized) ||
      crawlPages.some((page) => page.pageUrl === normalized)
    ) {
      toast.info("That page is already included.");
      setNewUrlInput("");
      return;
    }
    setManualReviewUrls((prev) => [...prev, normalized]);
    setNewUrlInput("");
  };

  const handleRemoveManualUrl = (url) => {
    setManualReviewUrls((prev) => prev.filter((item) => item !== url));
  };

  const handleManualUrlKeyDown = (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddManualUrl();
    }
  };

  // Detect if there are new manual URLs that aren't in crawlPages yet
  const hasNewManualUrls = useMemo(() => {
    if (!manualReviewUrls.length || !crawlPages.length) {
      return manualReviewUrls.length > 0;
    }
    const existingPageUrls = new Set(crawlPages.map((p) => p.pageUrl));
    return manualReviewUrls.some((url) => !existingPageUrls.has(url));
  }, [manualReviewUrls, crawlPages]);

  const handleInitialCrawl = async () => {
    if (!user?.id || !data?.websiteUrl) return;
    try {
      setIsInitialCrawlRunning(true);
      updateData?.({
        siteCrawlStatus: "in-progress",
      });
      const keepUrls = crawlPages
        .filter((page) => reviewSelections.get(page.pageUrl) !== false)
        .map((page) => page.pageUrl);
      const removedUrls = crawlPages
        .filter((page) => reviewSelections.get(page.pageUrl) === false)
        .map((page) => page.pageUrl);

      const priorityUrls = Array.from(
        new Set([
          ...keepUrls,
          ...topPages.map((page) => page.page).filter(Boolean),
          ...manualReviewUrls,
        ])
      );

      const res = await authenticatedFetch("/api/crawl-site", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          websiteUrl: data.websiteUrl,
          mode: "initial",
          priorityUrls,
          approvedUrls: keepUrls,
          excludedUrls: removedUrls,
          manualUrls: manualReviewUrls,
        }),
      });

      const responseJson = await res.json();
      if (!res.ok) {
        throw new Error(responseJson?.error || "Initial crawl failed");
      }

      const requiresReview = Boolean(responseJson?.requiresReview);
      const hadErrors =
        Array.isArray(responseJson?.errors) && responseJson.errors.length > 0;
      const completedStatus = requiresReview
        ? "awaiting-review"
        : hadErrors
        ? "completed-with-errors"
        : "completed";

      updateData?.({
        siteCrawlStatus: completedStatus,
        lastSiteCrawlAt: new Date().toISOString(),
      });

      setHasLoadedCrawlReview(false);
      setNeedsCrawlReview(requiresReview);
      await loadCrawlReview(true);

      toast.success(
        requiresReview
          ? "Initial crawl finished. Review the pages below."
          : "Initial crawl finished."
      );
    } catch (error) {
      console.error("❌ Initial crawl failed:", error);
      updateData?.({
        siteCrawlStatus: "error",
      });
      toast.error("Failed to run initial crawl", {
        description: error?.message || "Please try again.",
      });
    } finally {
      setIsInitialCrawlRunning(false);
    }
  };

  const handleSave = async () => {
    if (!user?.id || !data?.websiteUrl) return;
    const keepUrls = crawlPages
      .filter((page) => reviewSelections.get(page.pageUrl) !== false)
      .map((page) => page.pageUrl);
    const removedUrls = crawlPages
      .filter((page) => reviewSelections.get(page.pageUrl) === false)
      .map((page) => page.pageUrl);
    const manualUrls = Array.from(new Set(manualReviewUrls)).filter(
      (url) => !removedUrls.includes(url)
    );
    try {
      setIsRecrawling(true);

      // Save approved pages to pageContentCache without recrawling
      const res = await authenticatedFetch("/api/crawl-site/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          approvedUrls: keepUrls,
          excludedUrls: removedUrls,
          manualUrls,
        }),
      });

      const responseJson = await res.json();

      if (!res.ok) {
        throw new Error(responseJson?.error || "Failed to save pages");
      }

      const completedStatus =
        responseJson?.errors?.length > 0
          ? "completed-with-errors"
          : "completed";

      // If in post-onboarding flow, mark pages step as completed and move to keywords
      const updatePayload = {
        siteCrawlStatus: completedStatus,
        lastSiteCrawlAt: new Date().toISOString(),
      };

      if (data?.postOnboardingStep === 'pages') {
        updatePayload.pagesStepCompleted = true;
        updatePayload.postOnboardingStep = 'keywords'; // Automatically move to keywords step
      }

      updateData?.(updatePayload);

      // Scroll to top when transitioning to keywords step
      if (updatePayload.postOnboardingStep === 'keywords') {
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);
      }

      // Reload the review to show updated status, but don't reload pages
      // since we're not recrawling - just update the status
      setHasLoadedCrawlReview(false);
      await loadCrawlReview(true);
      setNeedsCrawlReview(false);

      const savedCount = responseJson.saved || 0;
      const removedCount = responseJson.removed || 0;

      if (savedCount > 0 && removedCount > 0) {
        toast.success(
          `Saved ${savedCount} page${savedCount !== 1 ? "s" : ""} and removed ${removedCount} page${removedCount !== 1 ? "s" : ""} from your content cache.`
        );
      } else if (savedCount > 0) {
        toast.success(
          `Saved ${savedCount} page${savedCount !== 1 ? "s" : ""} to your content cache.`
        );
      } else if (removedCount > 0) {
        toast.success(
          `Removed ${removedCount} page${removedCount !== 1 ? "s" : ""} from your content cache.`
        );
      }
    } catch (error) {
      console.error("❌ Save failed:", error);
      updateData?.({
        siteCrawlStatus: "error",
      });
      toast.error("Failed to save pages", {
        description: error?.message || "Please try again.",
      });
    } finally {
      setIsRecrawling(false);
    }
  };

  const handleAddAndSave = async () => {
    if (!user?.id || !data?.websiteUrl) return;

    // Find new manual URLs that aren't in crawlPages yet
    const existingPageUrls = new Set(crawlPages.map((p) => p.pageUrl));
    const newManualUrls = manualReviewUrls.filter(
      (url) => !existingPageUrls.has(url)
    );

    if (newManualUrls.length === 0) {
      toast.info("No new URLs to add.");
      return;
    }

    try {
      setIsRecrawling(true);

      // Process each new URL one by one with validation
      const { doc, getDoc, setDoc } = await import("firebase/firestore");
      const { db } = await import("../lib/firebaseConfig");

      const successfullyAddedUrls = [];

      for (const url of newManualUrls) {
        // 1. Validate URL belongs to domain (already done via normalizeManualUrl, but double-check)
        const normalized = normalizeManualUrl(url);
        if (!normalized || normalized !== url) {
          toast.error(`Invalid URL: ${url} does not belong to your website domain.`);
          continue;
        }

        // 2. Check if URL already exists in pageContentCache
        const docId = `${user.id}_${encodeURIComponent(url)}`;
        const existingDoc = await getDoc(doc(db, "pageContentCache", docId));
        if (existingDoc.exists()) {
          toast.warning(`URL already saved: ${url}`);
          continue;
        }

        // 3. Scrape and verify content exists
        const scrapeRes = await authenticatedFetch("/api/scrape-content", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageUrl: url }),
        });

        if (!scrapeRes.ok) {
          toast.error(`Failed to crawl ${url}: Invalid URL or no content found.`);
          continue;
        }

        const scrapeJson = await scrapeRes.json();
        if (!scrapeJson?.data || !scrapeJson.data.textContent) {
          toast.error(`Invalid URL: ${url} has no crawlable content.`);
          continue;
        }

        // 4. Save to pageContentCache
        await setDoc(
          doc(db, "pageContentCache", docId),
          {
            ...scrapeJson.data,
            userId: user.id,
            pageUrl: url,
            source: "site-crawl",
            isNavLink: false,
            crawlOrder: null,
            cachedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            crawlTags: ["manual", "Added"],
          },
          { merge: true }
        );

        successfullyAddedUrls.push(url);
        toast.success(`Added ${url} to your content cache.`);
      }

      // Update preferences to include the new manual URLs
      const keepUrls = crawlPages
        .filter((page) => reviewSelections.get(page.pageUrl) !== false)
        .map((page) => page.pageUrl);
      const removedUrls = crawlPages
        .filter((page) => reviewSelections.get(page.pageUrl) === false)
        .map((page) => page.pageUrl);

      await authenticatedFetch("/api/crawl-site/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          approvedUrls: [...keepUrls, ...successfullyAddedUrls],
          excludedUrls: removedUrls,
          manualUrls: manualReviewUrls,
        }),
      });

      // Reload the list to show newly added pages
      if (successfullyAddedUrls.length > 0) {
        setHasLoadedCrawlReview(false);
        await loadCrawlReview(true);
      }

      // Clear the processed URLs from manualReviewUrls and clear the input field
      // Remove all processed URLs (both successful and failed) from the manual review URLs
      setManualReviewUrls((prev) =>
        prev.filter((url) => !newManualUrls.includes(url))
      );
      setNewUrlInput("");

      // If in post-onboarding flow, mark pages step as completed and move to keywords
      if (data?.postOnboardingStep === 'pages') {
        updateData?.({
          pagesStepCompleted: true,
          postOnboardingStep: 'keywords', // Automatically move to keywords step
        });

        // Scroll to top when transitioning to keywords step
        setTimeout(() => {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 100);
      }
    } catch (error) {
      console.error("❌ Add & Save failed:", error);
      toast.error("Failed to add URL", {
        description: error?.message || "Please try again.",
      });

      // Still clear the URLs and input even on error
      setManualReviewUrls((prev) =>
        prev.filter((url) => !newManualUrls.includes(url))
      );
      setNewUrlInput("");
    } finally {
      setIsRecrawling(false);
    }
  };


  const generateMetaDescription = useCallback(async (pageUrl) => {
    try {
      // Look up the saved focus keyword for this page
      const normalizedUrl = normalizeUrlForComparison(pageUrl);
      let focusKeywordForPage = null;

      // DEBUG: Log the lookup process
      console.log(`🔍 [META DESC] Looking up focus keyword for: ${pageUrl}`);
      console.log(`🔍 [META DESC] Normalized URL: ${normalizedUrl}`);
      console.log(`🔍 [META DESC] focusKeywordByPage size: ${focusKeywordByPage.size}`);
      console.log(`🔍 [META DESC] focusKeywordByPage entries:`, Array.from(focusKeywordByPage.entries()));

      for (const [pageKey, keyword] of focusKeywordByPage.entries()) {
        if (pageKey && pageKey !== "__unknown__") {
          const normalizedPageKey = normalizeUrlForComparison(pageKey);
          console.log(`🔍 [META DESC] Comparing: "${normalizedPageKey}" === "${normalizedUrl}" ? ${normalizedPageKey === normalizedUrl}`);
          if (normalizedPageKey === normalizedUrl) {
            focusKeywordForPage = keyword;
            console.log(`✅ [META DESC] Found focus keyword: ${keyword}`);
            break;
          }
        }
      }

      if (!focusKeywordForPage) {
        console.warn(`⚠️ [META DESC] No focus keyword found for ${pageUrl}`);
      }

      const cacheParams = {
        pageUrl,
        businessName: data?.businessName,
        businessType: data?.businessType
      };

      const result = await fetchWithCache(
        "/api/seo-assistant/meta-description",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pageUrl,
            onboarding: data,
            context: { lowCtrPages, aiTips }, // same context as titles
            userId: user?.id,
            // Pass saved focus keyword if available
            ...(focusKeywordForPage ? { focusKeywords: [focusKeywordForPage] } : {}),
          }),
        },
        CACHE_DURATIONS.META_DESCRIPTION,
        cacheParams
      );

      return (
        result.description ||
        "Your page is ranking but not getting clicks. Consider improving your title or meta description."
      );
    } catch (err) {
      console.error("❌ Failed to fetch AI meta description", err);
      return "Meta description could not be generated.";
    }
  }, [data, lowCtrPages, aiTips, user?.id, focusKeywordByPage]);

  const generateMetaTitle = useCallback(async (pageUrl) => {
    try {
      // Look up the saved focus keyword for this page
      const normalizedUrl = normalizeUrlForComparison(pageUrl);
      let focusKeywordForPage = null;

      // DEBUG: Log the lookup process
      console.log(`🔍 [META TITLE] Looking up focus keyword for: ${pageUrl}`);
      console.log(`🔍 [META TITLE] Normalized URL: ${normalizedUrl}`);
      console.log(`🔍 [META TITLE] focusKeywordByPage size: ${focusKeywordByPage.size}`);

      for (const [pageKey, keyword] of focusKeywordByPage.entries()) {
        if (pageKey && pageKey !== "__unknown__") {
          const normalizedPageKey = normalizeUrlForComparison(pageKey);
          console.log(`🔍 [META TITLE] Comparing: "${normalizedPageKey}" === "${normalizedUrl}" ? ${normalizedPageKey === normalizedUrl}`);
          if (normalizedPageKey === normalizedUrl) {
            focusKeywordForPage = keyword;
            console.log(`✅ [META TITLE] Found focus keyword: ${keyword}`);
            break;
          }
        }
      }

      if (!focusKeywordForPage) {
        console.warn(`⚠️ [META TITLE] No focus keyword found for ${pageUrl}`);
      }

      const cacheParams = {
        pageUrl,
        businessName: data?.businessName,
        businessType: data?.businessType
      };

      const result = await fetchWithCache(
        "/api/seo-assistant/meta-title",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pageUrl,
            onboarding: data,
            context: { lowCtrPages, aiTips }, // feel free to expand this later
            userId: user?.id,
            // Pass saved focus keyword if available
            ...(focusKeywordForPage ? { focusKeywords: [focusKeywordForPage] } : {}),
          }),
        },
        CACHE_DURATIONS.META_TITLE,
        cacheParams
      );

      return result.title || "Suggested Meta Title";
    } catch (err) {
      console.error("❌ Failed to fetch AI meta title", err);
      return "Suggested Meta Title";
    }
  }, [data, lowCtrPages, aiTips, user?.id, focusKeywordByPage]);

  useEffect(() => {
    const fetchTitlesAndDescriptions = async () => {
      const results = await Promise.all(
        aiTips.map(async (tip) => {
          const match = tip.match(/href="(.*?)"/);
          const pageUrl = match?.[1] || "";

          // Skip pages that don't have a focus keyword selected
          const normalizedUrl = normalizeUrlForComparison(pageUrl);
          const focusKeyword = focusKeywordByPage.get(normalizedUrl);
          if (!focusKeyword) {
            console.log(`⏭️ Skipping meta generation for ${pageUrl} - no focus keyword selected`);
            return null; // Skip this page
          }

          const [title, description] = await Promise.all([
            generateMetaTitle(pageUrl),
            generateMetaDescription(pageUrl),
          ]);

          return { pageUrl, title, description };
        })
      );

      // Filter out null results (pages without focus keywords)
      setGeneratedMeta(results.filter(Boolean));
    };

    // Wait for ALL conditions before generating meta:
    // 1. aiTips exist (pages to process)
    // 2. Focus keywords loaded from Firestore
    // 3. At least one focus keyword selected (so API has keywords to use)
    // 4. Post-onboarding flow complete (user finished selecting pages + keywords)
    const hasCompletedOnboarding = !data?.postOnboardingStep || data?.postOnboardingStep === 'complete';

    if (aiTips.length > 0 && initialFocusKeywordsLoaded && focusKeywordByPage.size > 0 && hasCompletedOnboarding) {
      fetchTitlesAndDescriptions();
    }
  }, [aiTips, generateMetaTitle, generateMetaDescription, initialFocusKeywordsLoaded, focusKeywordByPage.size, data?.postOnboardingStep]);

  useEffect(() => {
    const loadFocusKeywords = async () => {
      if (!user?.id) {
        setFocusKeywords([]);
        setInitialFocusKeywordsLoaded(false);
        setFocusKeywordByPage(new Map());
        setFocusKeywordSourceByPage(new Map());
        setHasAutoSelectedFocusKeywords(false);
        return;
      }
      try {
        const stored = await getFocusKeywords(user.id);
        console.log(`📦 [LOAD FOCUS KW] Raw from Firestore:`, stored);

        if (Array.isArray(stored) && stored.length > 0) {
          const keywordList = [];
          const assignments = new Map();
          const sources = new Map();
          stored.forEach(({ keyword, pageUrl, source }) => {
            if (!keyword) return;
            keywordList.push(keyword);
            const pageKey = normalizePageKey(pageUrl);
            console.log(`📦 [LOAD FOCUS KW] Storing: "${pageUrl}" -> normalized: "${pageKey}" -> keyword: "${keyword}"`);
            assignments.set(pageKey, keyword);
            // Store source, defaulting to "gsc-existing" for backwards compatibility
            sources.set(pageKey, source || "gsc-existing");
          });
          console.log(`📦 [LOAD FOCUS KW] Final assignments map:`, Array.from(assignments.entries()));
          setFocusKeywords(keywordList);
          setFocusKeywordByPage(assignments);
          setFocusKeywordSourceByPage(sources);
          setHasAutoSelectedFocusKeywords(true);
        } else {
          setFocusKeywords([]);
          setFocusKeywordByPage(new Map());
          setFocusKeywordSourceByPage(new Map());
        }
      } catch (error) {
        console.error("Failed to load focus keywords:", error);
      } finally {
        setInitialFocusKeywordsLoaded(true);
      }
    };
    loadFocusKeywords();
  }, [user?.id]);

  // Define buildAssignmentsFromKeywords before using it in useEffect
  const buildAssignmentsFromKeywords = useCallback((
    keywordsList = [],
    currentAssignments = new Map(),
    rows = []
  ) => {
    if (!keywordsList.length) {
      return new Map();
    }

    const next = new Map();
    const reservedPages = new Set();
    const previousByKeyword = new Map();

    // Build map of previous assignments (from Firestore)
    currentAssignments?.forEach((keyword, pageKey) => {
      if (!keyword) return;
      previousByKeyword.set(keyword.toLowerCase(), { pageKey, keyword });
    });

    const rowsByKeyword = new Map();
    rows.forEach((row) => {
      const key = row.keyword?.toLowerCase();
      if (!key) return;
      if (!rowsByKeyword.has(key)) {
        rowsByKeyword.set(key, []);
      }
      rowsByKeyword.get(key).push(row);
    });

    rowsByKeyword.forEach((list) => {
      list.sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
    });

    keywordsList.forEach((keyword) => {
      const lower = keyword?.toLowerCase();
      if (!lower) return;

      const keywordRows = rowsByKeyword.get(lower) || [];
      const previousAssignment = previousByKeyword.get(lower);

      // If keyword exists in GSC, use GSC logic
      if (keywordRows.length > 0) {
        let chosenPageKey = previousAssignment?.pageKey;

        if (chosenPageKey) {
          const stillValid = keywordRows.some(
            (row) => normalizePageKey(row.page) === chosenPageKey
          );
          if (!stillValid || reservedPages.has(chosenPageKey)) {
            chosenPageKey = null;
          }
        }

        if (!chosenPageKey) {
          const candidate = keywordRows.find(
            (row) => !reservedPages.has(normalizePageKey(row.page))
          );
          chosenPageKey = normalizePageKey((candidate || keywordRows[0]).page);
        }

        if (chosenPageKey && !reservedPages.has(chosenPageKey)) {
          next.set(chosenPageKey, keyword);
          reservedPages.add(chosenPageKey);
        }
      } else {
        // Keyword doesn't exist in GSC - preserve it from previous assignments (Firestore)
        // This allows hardcoded/AI keywords to persist
        if (previousAssignment) {
          const pageKey = previousAssignment.pageKey;
          if (!reservedPages.has(pageKey)) {
            next.set(pageKey, keyword);
            reservedPages.add(pageKey);
          }
        }
      }
    });

    return next;
  }, []); // Empty deps since it's a pure function

  useEffect(() => {
    // Always rebuild assignments, even if no GSC keywords
    // This allows non-GSC keywords (hardcoded/AI) to persist
    setFocusKeywordByPage((prev) =>
      buildAssignmentsFromKeywords(focusKeywords, prev, gscKeywords)
    );
  }, [gscKeywords, focusKeywords, buildAssignmentsFromKeywords, focusKeywordByPage.size]);

  // Fetch dashboard metrics (always uses 28 days - optimal sweet spot)
  const fetchDashboardMetrics = useCallback(async (siteUrl, token) => {
    setIsLoadingGscData(true);
    const { startDate: from, endDate: to } = searchWindow(dateRange);

    try {
      // 🔹 Fetch keyword + page performance
      const keywordRes = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
          siteUrl
        )}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: from,
            endDate: to,
            dataState: "final",
            dimensions: ["query", "page"],
            rowLimit: 500,
          }),
        }
      );

      if (!keywordRes.ok) throw new Error("Search Console could not load. Try again.");
      const keywordJson = await keywordRes.json();

      if (keywordJson.rows) {
        const formatted = keywordJson.rows.map((row) => ({
          keyword: row.keys[0].replace(/^\[|\]$/g, ""),
          page: row.keys[1],
          clicks: row.clicks,
          impressions: row.impressions,
          position: Math.round(row.position),
          ctr: `${(row.ctr * 100).toFixed(1)}%`,
        }));

        // Merge dashboard metrics keywords (don't overwrite focus keywords if they exist)
        setGscKeywords((prevKeywords) => {
          // If focus keywords already loaded, merge dashboard metrics into them
          // Otherwise, use dashboard metrics as base
          if (prevKeywords.length === 0) {
            return formatted;
          }

          // Merge: dashboard metrics for recent data, keep focus keywords for older data
          const existingMap = new Map();
          prevKeywords.forEach((kw) => {
            const key = `${kw.keyword?.toLowerCase()}_${kw.page}`;
            existingMap.set(key, kw);
          });

          // Add/update with dashboard metrics (recent data takes precedence for metrics)
          formatted.forEach((kw) => {
            const key = `${kw.keyword?.toLowerCase()}_${kw.page}`;
            existingMap.set(key, kw);
          });

          return Array.from(existingMap.values());
        });

        // 🔹 Top pages by clicks
        const pageClickMap = {};
        formatted.forEach((row) => {
          pageClickMap[row.page] = (pageClickMap[row.page] || 0) + row.clicks;
        });

        const sortedPages = Object.entries(pageClickMap)
          .map(([page, clicks]) => ({ page, clicks }))
          .sort((a, b) => b.clicks - a.clicks)
          .slice(0, 5);

        setTopPages(sortedPages);

        // 🔹 Low CTR pages
        const lowCtr = formatted.filter(
          (kw) =>
            parseFloat(kw.ctr.replace("%", "")) <= 2 && kw.impressions > 20
        );

        const grouped = Object.values(
          lowCtr.reduce((acc, item) => {
            if (!acc[item.page]) {
              acc[item.page] = { ...item, clicks: 0, impressions: 0, keywords: new Set() };
            }
            acc[item.page].clicks += item.clicks;
            acc[item.page].impressions += item.impressions;
            if (item.keyword) {
              acc[item.page].keywords.add(item.keyword);
            }
            return acc;
          }, {})
        ).map((entry) => ({
          ...entry,
          keywords: Array.from(entry.keywords || []),
        }));

        setLowCtrPages(grouped);

        // 🔹 AI tips
        const ai = grouped.map((kw) => {
          return `Your page <a href="${kw.page}" class="underline">${kw.page}</a> is ranking but not getting clicks. Consider improving your title or meta description.`;
        });

        setAiTips(ai);
      } else {
        setGscKeywords([]);
        setTopPages([]);
      }
    } catch (err) {
      console.error("❌ Failed to fetch dashboard metrics:", err);
    } finally {
      setIsLoadingGscData(false);
    }
  }, [dateRange]);

  // Fetch chart trends (uses chartDateRange - can be changed by user)
  const fetchChartTrends = useCallback(async (siteUrl, token, range) => {
    setIsRefreshingData(true);
    const { startDate: from, endDate: to } = searchWindow(range);

    try {
      // 🔹 Fetch daily impressions for the chart
      const trendsRes = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
          siteUrl
        )}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: from,
            endDate: to,
            dataState: "final",
            dimensions: ["date"],
            rowLimit: 1000,
          }),
        }
      );

      if (!trendsRes.ok) throw new Error("Search Console could not load. Try again.");
      const trendsJson = await trendsRes.json();

      if (trendsJson.rows) {
        const trends = trendsJson.rows.map((row) => {
          const dateObj = new Date(row.keys[0]);
          const formattedDate = `${
            dateObj.getMonth() + 1
          }/${dateObj.getDate()}/${dateObj.getFullYear().toString().slice(-2)}`;
          return {
            date: formattedDate,
            impressions: row.impressions,
          };
        });

        setGscImpressionTrends(trends);
      } else {
        setGscImpressionTrends([]);
      }
    } catch (err) {
      console.error("❌ Failed to fetch chart trends:", err);
    } finally {
      setIsRefreshingData(false);
    }
  }, []);

  // Fetch focus keywords with 90-day period (separate from dashboard metrics)
  const fetchFocusKeywords = useCallback(async (siteUrl, token) => {
    try {
      const { startDate: from, endDate: to } = searchWindow("90");

      const keywordRes = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
          siteUrl
        )}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: from,
            endDate: to,
            dataState: "final",
            dimensions: ["query", "page"],
            rowLimit: 500,
          }),
        }
      );

      if (!keywordRes.ok) throw new Error("Search Console could not load. Try again.");
      const keywordJson = await keywordRes.json();

      console.log("🔑 Focus Keywords API Response:", {
        totalRows: keywordJson.rows?.length || 0,
        requestedLimit: 500,
        hasRows: !!keywordJson.rows,
        dateRange: "90 days"
      });

      if (keywordJson.rows) {
        const formatted = keywordJson.rows.map((row) => ({
          keyword: row.keys[0].replace(/^\[|\]$/g, ""),
          page: row.keys[1],
          clicks: row.clicks,
          impressions: row.impressions,
          position: Math.round(row.position),
          ctr: `${(row.ctr * 100).toFixed(1)}%`,
        }));

        console.log("✅ Focus Keywords fetched:", {
          totalKeywords: formatted.length,
          uniquePages: new Set(formatted.map(f => f.page)).size,
          uniqueKeywords: new Set(formatted.map(f => f.keyword)).size,
        });

        // Merge with existing gscKeywords, preferring focus keywords data
        setGscKeywords((prevKeywords) => {
          // Create a map of existing keywords by key (keyword+page)
          const existingMap = new Map();
          prevKeywords.forEach((kw) => {
            const key = `${kw.keyword?.toLowerCase()}_${kw.page}`;
            existingMap.set(key, kw);
          });

          // Add/update with focus keywords (90-day data takes precedence)
          formatted.forEach((kw) => {
            const key = `${kw.keyword?.toLowerCase()}_${kw.page}`;
            existingMap.set(key, kw);
          });

          return Array.from(existingMap.values());
        });
      }
    } catch (error) {
      console.error("❌ Failed to fetch focus keywords:", error);
      // Don't throw - let dashboard metrics still load
    }
  }, []);

  // Define fetchAndMatchGSC before the useEffect that uses it
  const fetchAndMatchGSC = useCallback(async (token) => {
    if (!user?.id) return;

    // Use the GSC property selected during onboarding
    const selectedProperty = data?.gscProperty;

    if (selectedProperty) {
      // Fetch dashboard metrics (always 28 days - optimal sweet spot)
      fetchDashboardMetrics(selectedProperty, token);

      // Fetch chart trends (uses chartDateRange - can be changed by user)
      fetchChartTrends(selectedProperty, token, chartDateRange);

      // Fetch focus keywords with fixed 90-day period (separate from dashboard metrics)
      fetchFocusKeywords(selectedProperty, token);
    } else {
      if (!hasShownGscError) {
        toast.error("No GSC Property Selected", {
          description: "Please complete the onboarding process and select a Google Search Console property.",
          duration: 30000,
          style: {
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca'
          }
        });
        setHasShownGscError(true);
        setGscAlert({
          type: "no-property-selected",
          title: "No GSC Property Selected",
          description: "Please complete the onboarding process and select a Google Search Console property.",
          action: "Complete Onboarding"
        });
      }
    }
  }, [user?.id, data?.gscProperty, chartDateRange, hasShownGscError, fetchDashboardMetrics, fetchChartTrends, fetchFocusKeywords]);

  useEffect(() => {
    if (isLoading || !user?.id) return;

    // Reset error flag when user changes
    setHasShownGscError(false);

    const checkGSCConnection = async () => {
      try {
        // Debug: Log onboarding data
        console.log("🔍 Dashboard onboarding data:", {
          hasGSC: data?.hasGSC,
          gscProperty: data?.gscProperty,
          googleEmail: data?.googleEmail,
          fullData: data
        });

        // Check if a GSC property was selected during onboarding
        if (!data?.gscProperty) {
          setIsGscConnected(false);
          return;
        }

        const tokenManager = createGSCTokenManager(user.id);
        const accessToken = await tokenManager.getValidAccessToken();

        if (!accessToken) {
          setIsGscConnected(false);
          return;
        }

        // Verify token is still valid
        const response = await fetch("https://searchconsole.googleapis.com/webmasters/v3/sites", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (response.status === 200) {
          setGscAccessToken(accessToken);
          setIsGscConnected(true);
          fetchAndMatchGSC(accessToken);
        } else {
          console.warn("⚠️ GSC token is invalid, try reconnecting manually.");
          setIsGscConnected(false);
        }
      } catch (error) {
        console.error("⚠️ Error checking GSC connection:", error);
        setIsGscConnected(false);
      }
    };

    checkGSCConnection();
  }, [isLoading, user?.id, data?.gscProperty, data?.hasGSC, data, fetchAndMatchGSC]);

  useEffect(() => {
    if (!user?.id || !data?.websiteUrl) return;
    if (!data?.hasGSC) return;

    const status = data?.siteCrawlStatus;
    if (
      status === "in-progress" ||
      status === "completed" ||
      status === "completed-with-errors" ||
      status === "awaiting-review"
    ) {
      return;
    }

    if (crawlTriggeredRef.current) {
      return;
    }

    crawlTriggeredRef.current = true;

    const startCrawl = async () => {
      try {
        console.log("🌐 Starting site crawl for:", data.websiteUrl);
        updateData?.({ siteCrawlStatus: "in-progress" });
        const priorityUrls = Array.from(
          new Set(topPages.map((page) => page.page).filter(Boolean))
        );
        const res = await authenticatedFetch("/api/crawl-site", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            websiteUrl: data.websiteUrl,
            mode: "initial",
            priorityUrls,
          }),
        });

        const result = await res.json();
        if (!res.ok) {
          console.error("❌ Site crawl failed:", result?.error || result);
          updateData?.({ siteCrawlStatus: "error" });
          crawlTriggeredRef.current = false;
        } else {
          const requiresReview = Boolean(result?.requiresReview);
          const hadErrors = Array.isArray(result?.errors) && result.errors.length > 0;
          const completedStatus = requiresReview
            ? "awaiting-review"
            : hadErrors
            ? "completed-with-errors"
            : "completed";
          updateData?.({
            siteCrawlStatus: completedStatus,
            lastSiteCrawlAt: new Date().toISOString(),
          });
          setHasLoadedCrawlReview(false);
          setNeedsCrawlReview(requiresReview);
          await loadCrawlReview(true);
          crawlTriggeredRef.current = false;
          console.log("✅ Site crawl completed:", result);
        }
      } catch (error) {
        crawlTriggeredRef.current = false;
        updateData?.({ siteCrawlStatus: "error" });
        console.error("❌ Failed to start site crawl:", error);
      }
    };

    startCrawl();
  }, [
    user?.id,
    data?.websiteUrl,
    data?.hasGSC,
    data?.siteCrawlStatus,
    updateData,
    loadCrawlReview,
    topPages,
  ]);

  // Commented out to prevent duplicate calls
  // useEffect(() => {
  //   if (gscAccessToken) {
  //     fetchAndMatchGSC(gscAccessToken);
  //   }
  // }, [gscAccessToken, dateRange]);

  // ✅ Refresh chart data when chart date range changes (doesn't affect other dashboard data)
  useEffect(() => {
    if (gscAccessToken && isGscConnected && data?.gscProperty) {
      console.log(`🔄 Chart date range changed to ${chartDateRange} days, refreshing chart data...`);
      fetchChartTrends(data.gscProperty, gscAccessToken, chartDateRange);
    }
  }, [chartDateRange, gscAccessToken, isGscConnected, data?.gscProperty, fetchChartTrends]);

  // AI-powered brand filtering effect
  useEffect(() => {
    const filterKeywordsWithAI = async () => {
      if (!gscKeywords.length || !data?.businessName) return;

      setIsFilteringKeywords(true);
      try {
        // Generate signature from keywords to detect when they change
        const keywordSignature = generateKeywordSignature(gscKeywords);

        const cacheParams = {
          keywordsCount: gscKeywords.length,
          keywordSignature: keywordSignature, // Include signature to detect keyword changes
          businessName: data.businessName,
          businessType: data.businessType
        };

        const result = await fetchWithCache(
          '/api/filter-branded-keywords',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              keywords: gscKeywords,
              businessName: data.businessName,
              businessType: data.businessType
            })
          },
          CACHE_DURATIONS.FILTER_BRANDED_KEYWORDS,
          cacheParams
        );

        if (result.fromCache) {
          console.log(`✅ AI filtering result (cached, ${result.cacheAge}h old):`, result);
        } else {
          console.log("✅ AI filtering result (fresh):", result);
        }
        console.log(
          "🔍 Branded keywords from AI:",
          result.branded?.map((kw) => kw.keyword) || []
        );
        console.log(
          "🔍 Generic keywords from AI:",
          result.generic?.map((kw) => kw.keyword) || []
        );

        // Set only the generic (non-branded) keywords - limit to 4 for dashboard
        setNonBrandedKeywords(result.generic.slice(0, 4));
      } catch (error) {
        console.error("❌ AI filtering failed, using enhanced fallback:", error);
        // Enhanced fallback filtering if AI fails
        const businessName = data?.businessName?.toLowerCase() || "";
        const businessWords = businessName
          .split(" ")
          .filter((word) => word.length > 2);

        const fallback = gscKeywords
          .filter((kw) => {
            const keyword = kw.keyword.toLowerCase();

            // Enhanced branded detection - same logic as API
            const isBranded =
              // Exact business name matches
              keyword.includes(businessName) ||
              keyword.includes(businessName.replace(/\s+/g, "")) ||
              keyword.includes(businessName.replace(/\s+/g, " n ")) ||
              keyword.includes(businessName.replace(/\s+/g, " & ")) ||
              keyword.includes(businessName.replace(/\s+/g, " and ")) ||
              // Check for individual business words (but be more strict)
              (businessWords.length > 1 &&
                businessWords.every((word) => keyword.includes(word))) ||
              // Check for common brand variations
              keyword === businessName ||
              keyword === businessName.replace(/\s+/g, "") ||
              keyword === businessName.replace(/\s+/g, " n ") ||
              keyword === businessName.replace(/\s+/g, " & ");

            // Return true if NOT branded (i.e., it's generic)
            return !isBranded;
          })
          .slice(0, 4);

        console.log(
          `🔄 Dashboard fallback filtering: ${fallback.length} generic keywords from ${gscKeywords.length} total`
        );
        setNonBrandedKeywords(fallback);
      } finally {
        setIsFilteringKeywords(false);
      }
    };

    filterKeywordsWithAI();
  }, [gscKeywords, data?.businessName, data?.businessType, user?.id, initialFocusKeywordsLoaded]);

  // Track previous business info to detect changes and clear cache
  const prevBusinessInfoRef = useRef({ businessName: null, businessType: null });

  // Clear cache when business name or type changes
  useEffect(() => {
    const prevBusinessName = prevBusinessInfoRef.current.businessName;
    const prevBusinessType = prevBusinessInfoRef.current.businessType;

    // Only clear cache if business info actually changed
    if (
      (data?.businessName && data.businessName !== prevBusinessName) ||
      (data?.businessType && data.businessType !== prevBusinessType)
    ) {
      if (prevBusinessName || prevBusinessType) {
        console.log("🔄 Business info changed, cache will be invalidated on next fetch");
      }

      // Update ref
      prevBusinessInfoRef.current = {
        businessName: data?.businessName || null,
        businessType: data?.businessType || null
      };
    }
  }, [data?.businessName, data?.businessType]);

  const requestGSCAuthToken = async () => {
    try {
      await reconnectGsc(data?.gscProperty);
      const tokenManager = createGSCTokenManager(user.id);
      const accessToken = await tokenManager.getValidAccessToken();
      setGscAccessToken(accessToken); setIsGscConnected(true);
      await updateData({ hasGSC: true }); await fetchAndMatchGSC(accessToken);
    } catch (error) { window.alert(error.message); }
  };

  const gscKeywordsWithFocus = useMemo(
    () =>
      gscKeywords.map((kw) => ({
        ...kw,
        isFocus: focusKeywordSet.has(kw.keyword.toLowerCase()),
      })),
    [gscKeywords, focusKeywordSet]
  );

  const groupedByPage = useMemo(() => {
    const map = new Map();
    gscKeywords.forEach((row) => {
      const page = row.page || "__unknown__";
      const keyword = row.keyword;
      if (!keyword) return;
      const lower = keyword.toLowerCase();
      const entry = map.get(page);
      if (entry) {
        if (!entry.includes(lower)) {
          entry.push(lower);
        }
      } else {
        map.set(page, [lower]);
      }
    });
    return map;
  }, [gscKeywords]);


  const easyWins = useMemo(() => {
    const filtered = gscKeywordsWithFocus.filter((kw) => {
      const pos = kw.position;
      const ctr = parseFloat(kw.ctr.replace("%", ""));
      return pos > 10 && pos <= 20 && ctr < 3 && kw.impressions > 10;
    });

    return filtered.sort((a, b) => {
      const aFocus = a.isFocus ? 1 : 0;
      const bFocus = b.isFocus ? 1 : 0;
      if (aFocus !== bFocus) {
        return bFocus - aFocus;
      }
      return a.position - b.position;
    });
  }, [gscKeywordsWithFocus]);

  const orderedFocusKeywords = useMemo(
    () => (focusKeywords || []).map((keyword) => keyword.trim()).filter(Boolean),
    [focusKeywords]
  );

  const focusKeywordTopRows = useMemo(() => {
    const map = new Map();
    gscKeywords.forEach((row) => {
      const key = row.keyword?.toLowerCase();
      if (!key || !focusKeywordSet.has(key)) return;
      const existing = map.get(key);
      if (!existing || row.impressions > existing.impressions) {
        map.set(key, row);
      }
    });
    return map;
  }, [gscKeywords, focusKeywordSet]);

  const focusKeywordsNotShownInEasyWins = useMemo(() => {
    const shown = new Set(
      easyWins
        .filter((kw) => kw.isFocus)
        .map((kw) => kw.keyword?.toLowerCase())
        .filter(Boolean)
    );

    return orderedFocusKeywords
      .filter((keyword) => !shown.has(keyword.toLowerCase()))
      .map((keyword) => {
        const lower = keyword.toLowerCase();
        const data = focusKeywordTopRows.get(lower) || null;
        const mappedPage = focusKeywordAssignmentsByKeyword.get(lower) || null;
        const page = mappedPage ?? data?.page ?? null;
        return {
          keyword,
          data,
          page,
        };
      });
  }, [
    orderedFocusKeywords,
    easyWins,
    focusKeywordTopRows,
    focusKeywordAssignmentsByKeyword,
  ]);

  const prioritizedLowCtrPages = useMemo(() => {
    return lowCtrPages
      .map((page) => {
        // First, check if there's an assigned focus keyword for this page URL
        // This should ALWAYS take priority, regardless of source (AI-generated or GSC-existing)
        const normalizedPageUrl = normalizeUrlForComparison(page.page);
        let assignedKeyword = null;

        for (const [pageKey, keyword] of focusKeywordByPage.entries()) {
          if (pageKey && pageKey !== "__unknown__") {
            const normalizedPageKey = normalizeUrlForComparison(pageKey);
            if (normalizedPageKey === normalizedPageUrl) {
              assignedKeyword = keyword;
              break;
            }
          }
        }

        // Only use assigned keywords - no fallback to GSC matching
        // This ensures only pages where the user explicitly selected a focus keyword are marked
        let primaryKeyword = assignedKeyword;
        let focusKeywords = [];

        if (assignedKeyword) {
          focusKeywords = [assignedKeyword];
          primaryKeyword = assignedKeyword;
        } else {
          // No assigned keyword - use first keyword from GSC data as primary
          // but don't mark it as a focus keyword
          primaryKeyword = page.keywords?.[0] || null;
        }

        return {
          ...page,
          focusKeywords,
          primaryKeyword,
        };
      })
      .sort((a, b) => {
        const aFocus = a.focusKeywords.length;
        const bFocus = b.focusKeywords.length;
        if (aFocus !== bFocus) {
          return bFocus - aFocus;
        }
        return b.impressions - a.impressions;
      });
  }, [lowCtrPages, focusKeywordSet, focusKeywordByPage]);

  const focusKeywordsNotShownLowCtr = useMemo(() => {
    const shown = new Set();
    prioritizedLowCtrPages.forEach((page) => {
      page.focusKeywords?.forEach((keyword) => {
        shown.add(keyword.toLowerCase());
      });
    });

    return orderedFocusKeywords
      .filter((keyword) => !shown.has(keyword.toLowerCase()))
      .map((keyword) => {
        const lower = keyword.toLowerCase();
        const data = focusKeywordTopRows.get(lower) || null;
        const mappedPage = focusKeywordAssignmentsByKeyword.get(lower) || null;
        const page = mappedPage ?? data?.page ?? null;
        return {
          keyword,
          data,
          page,
        };
      });
  }, [
    orderedFocusKeywords,
    prioritizedLowCtrPages,
    focusKeywordTopRows,
    focusKeywordAssignmentsByKeyword,
  ]);

  if (isLoading || !user) {
    return null; // or show a loader/spinner if you want
  }

  const handleFocusKeywordToggle = async ({
    keyword,
    page,
    isSelectedForPage,
    source = "gsc-existing", // Default to gsc-existing if not specified
  }) => {
    if (!user?.id || !keyword) return;

    const pageKey = normalizePageKey(page);
    const lowerKeyword = keyword.toLowerCase();

    const nextAssignments = new Map(focusKeywordByPage);
    const nextSources = new Map(focusKeywordSourceByPage);

    if (isSelectedForPage) {
      nextAssignments.delete(pageKey);
      nextSources.delete(pageKey);
    } else {
      nextAssignments.delete(pageKey);
      nextSources.delete(pageKey);
      for (const [existingPageKey, existingKeyword] of Array.from(
        nextAssignments.entries()
      )) {
        if (existingKeyword?.toLowerCase() === lowerKeyword) {
          nextAssignments.delete(existingPageKey);
          nextSources.delete(existingPageKey);
        }
      }

      if (pageKey === "__unknown__") {
        const keywordRow = gscKeywords.find(
          (row) => row.keyword?.toLowerCase() === lowerKeyword
        );
        const resolvedPageKey = normalizePageKey(keywordRow?.page);
        nextAssignments.set(resolvedPageKey, keyword);
        nextSources.set(resolvedPageKey, source);
      } else {
        nextAssignments.set(pageKey, keyword);
        nextSources.set(pageKey, source);
      }
    }

    const uniqueKeywords = Array.from(
      new Set(
        Array.from(nextAssignments.values())
          .map((item) => item?.trim())
          .filter(Boolean)
      )
    );

    const entries = assignmentsToEntries(nextAssignments, nextSources);

    setFocusKeywordByPage(nextAssignments);
    setFocusKeywordSourceByPage(nextSources);
    setFocusKeywords(uniqueKeywords);

    setIsSavingFocusKeywords(true);
    try {
      // Create a set of keywords already in gscKeywordsRaw
      const existingKeywordsSet = new Set(
        gscKeywords.map(kw => `${kw.keyword.toLowerCase()}|${normalizePageKey(kw.page)}`)
      );

      // Collect all keywords for gscKeywordsRaw (GSC + AI-generated selected keywords)
      const allKeywordsRaw = [...gscKeywords.map(kw => ({
        keyword: kw.keyword,
        page: kw.page,
        clicks: kw.clicks || 0,
        impressions: kw.impressions || 0,
        position: kw.position || 999,
        ctr: kw.ctr || "0%",
        source: kw.source || "gsc-existing",
      }))];

      // Add AI-generated keywords that are selected but not in GSC data
      nextAssignments.forEach((keyword, pageKey) => {
        const source = nextSources.get(pageKey) || "gsc-existing";
        if (source === "ai-generated") {
          const key = `${keyword.toLowerCase()}|${normalizePageKey(pageKey)}`;
          if (!existingKeywordsSet.has(key)) {
            // Find the page URL (might be pageKey or need to resolve)
            const pageUrl = Array.from(groupedByPage.keys()).find(
              url => normalizePageKey(url) === pageKey
            ) || pageKey;

            allKeywordsRaw.push({
              keyword,
              page: pageUrl === "__unknown__" ? null : pageUrl,
              clicks: 0,
              impressions: 0,
              position: 999,
              ctr: "0%",
              source: "ai-generated",
            });
          }
        }
      });

      // Create snapshot of current FocusKeywordSelector state
      const snapshot = {
        groupedByPage: Array.from(groupedByPage.entries()).map(([page, keywords]) => ({
          page,
          keywords: Array.isArray(keywords) ? keywords : [],
        })),
        gscKeywordsRaw: allKeywordsRaw,
        selectedByPage: Array.from(nextAssignments.entries()).map(([page, keyword]) => ({
          page,
          keyword,
        })),
      };

      await saveFocusKeywords(user.id, entries, snapshot);
      setHasAutoSelectedFocusKeywords(true);
      toast.success("Focus keywords updated.");
    } catch (error) {
      console.error("Failed to save focus keywords:", error);
      toast.error("We couldn't save your focus keywords. Try again.");
    } finally {
      setIsSavingFocusKeywords(false);
    }
  };

  const handleFocusKeywordHelp = () => {
    // Build pages without keywords list
    const pagesWithoutKeywords = [];
    groupedByPage.forEach((keywords, pageUrl) => {
      const pageKey = normalizePageKey(pageUrl);
      if (!focusKeywordByPage.has(pageKey)) {
        // Get keyword data for this page
        const pageKeywords = gscKeywords
          .filter(kw => normalizePageKey(kw.page) === pageKey)
          .map(kw => ({
            keyword: kw.keyword,
            impressions: kw.impressions,
            clicks: kw.clicks,
            position: kw.position,
            ctr: kw.ctr,
          }))
          .sort((a, b) => b.impressions - a.impressions);

        pagesWithoutKeywords.push({
          pageUrl: pageUrl === "__unknown__" ? null : pageUrl,
          keywords: pageKeywords,
        });
      }
    });

    // Build selected keywords summary
    const selectedKeywordsSummary = [];
    focusKeywordByPage.forEach((keyword, pageKey) => {
      const pageUrl = Array.from(groupedByPage.keys()).find(
        url => normalizePageKey(url) === pageKey
      ) || pageKey;

      const keywordData = gscKeywords.find(
        kw => kw.keyword?.toLowerCase() === keyword?.toLowerCase()
      );

      selectedKeywordsSummary.push({
        pageUrl: pageUrl === "__unknown__" ? null : pageUrl,
        keyword: keyword,
        impressions: keywordData?.impressions || 0,
        clicks: keywordData?.clicks || 0,
        position: keywordData?.position || null,
      });
    });

    // Create help message - more welcoming/introductory
    const helpMessage = `I clicked the Help button on the Focus Keywords card. Can you help me understand how to choose focus keywords for my website?`;

    // Store context in localStorage
    localStorage.setItem("chatContext", JSON.stringify({
      type: "focus_keywords",
      focusKeywordContext: {
        selectedKeywords: Array.from(focusKeywordByPage.entries()).map(([page, keyword]) => ({
          page: page,
          keyword: keyword,
        })),
        availableKeywordsByPage: Array.from(groupedByPage.entries()).map(([page, keywords]) => ({
          page: page === "__unknown__" ? null : page,
          keywords: keywords,
        })),
        businessName: data?.businessName || "",
        businessType: data?.businessType || "",
        businessLocation: data?.businessLocation || "",
        pagesWithoutKeywords: pagesWithoutKeywords,
        totalPages: groupedByPage.size,
        totalSelected: focusKeywordByPage.size,
        // Include full keyword data for analysis
        keywordData: gscKeywords.map(kw => ({
          keyword: kw.keyword,
          page: kw.page,
          impressions: kw.impressions,
          clicks: kw.clicks,
          position: kw.position,
          ctr: kw.ctr,
        })),
      },
      message: helpMessage,
    }));

    // Dispatch custom event to open chat
    const chatEvent = new CustomEvent('openChatAssistant', {
      detail: {
        context: 'focus_keywords',
        message: helpMessage,
      }
    });
    window.dispatchEvent(chatEvent);

    // Show toast notification
    toast.success("Focus keyword help loaded!", {
      description: "Chat is ready to help you choose the best keywords.",
    });
  };

  const defaultFocusKeywords = async () => {
    const sourceList = nonBrandedKeywords.length
      ? nonBrandedKeywords
      : gscKeywords;
    if (!sourceList.length) {
      toast.error("We need more Search Console data before we can suggest keywords.");
      return;
    }

    const keywordToRow = new Map(
      gscKeywords.map((row) => [row.keyword?.toLowerCase(), row])
    );
    const nextAssignments = new Map();
    const usedKeywords = new Set();

    sourceList
      .slice()
      .sort((a, b) => {
        const aImpressions =
          typeof a === "string"
            ? keywordToRow.get(a?.toLowerCase())?.impressions || 0
            : a.impressions || 0;
        const bImpressions =
          typeof b === "string"
            ? keywordToRow.get(b?.toLowerCase())?.impressions || 0
            : b.impressions || 0;
        return bImpressions - aImpressions;
      })
      .forEach((item) => {
        const keyword = typeof item === "string" ? item : item.keyword;
        if (!keyword) return;
        const lower = keyword.toLowerCase();
        if (usedKeywords.has(lower)) return;

        const row =
          typeof item === "string" ? keywordToRow.get(lower) : item;
        const pageKey = normalizePageKey(row?.page);

        if (!row || nextAssignments.has(pageKey)) return;

        usedKeywords.add(lower);
        nextAssignments.set(pageKey, keyword);
      });

    const entries = assignmentsToEntries(nextAssignments, new Map()); // Auto-selected are gsc-existing

    if (!entries.length) {
      toast.error("We couldn't find unique keywords per page to suggest yet.");
      return;
    }

    const autoKeywords = entries.map((entry) => entry.keyword);
    // Set all sources to gsc-existing for auto-selected keywords
    const autoSources = new Map();
    nextAssignments.forEach((_, pageKey) => {
      autoSources.set(pageKey, "gsc-existing");
    });

    setFocusKeywordByPage(nextAssignments);
    setFocusKeywordSourceByPage(autoSources);
    setFocusKeywords(autoKeywords);

    setIsSavingFocusKeywords(true);
    try {
      // Create a set of keywords already in gscKeywordsRaw
      const existingKeywordsSet = new Set(
        gscKeywords.map(kw => `${kw.keyword.toLowerCase()}|${normalizePageKey(kw.page)}`)
      );

      // Collect all keywords for gscKeywordsRaw (GSC + AI-generated selected keywords)
      const allKeywordsRaw = [...gscKeywords.map(kw => ({
        keyword: kw.keyword,
        page: kw.page,
        clicks: kw.clicks || 0,
        impressions: kw.impressions || 0,
        position: kw.position || 999,
        ctr: kw.ctr || "0%",
        source: kw.source || "gsc-existing",
      }))];

      // Add AI-generated keywords that are selected but not in GSC data
      nextAssignments.forEach((keyword, pageKey) => {
        const source = autoSources.get(pageKey) || "gsc-existing";
        if (source === "ai-generated") {
          const key = `${keyword.toLowerCase()}|${normalizePageKey(pageKey)}`;
          if (!existingKeywordsSet.has(key)) {
            // Find the page URL (might be pageKey or need to resolve)
            const pageUrl = Array.from(groupedByPage.keys()).find(
              url => normalizePageKey(url) === pageKey
            ) || pageKey;

            allKeywordsRaw.push({
              keyword,
              page: pageUrl === "__unknown__" ? null : pageUrl,
              clicks: 0,
              impressions: 0,
              position: 999,
              ctr: "0%",
              source: "ai-generated",
            });
          }
        }
      });

      // Create snapshot for auto-selected keywords
      const snapshot = {
        groupedByPage: Array.from(groupedByPage.entries()).map(([page, keywords]) => ({
          page,
          keywords: Array.isArray(keywords) ? keywords : [],
        })),
        gscKeywordsRaw: allKeywordsRaw,
        selectedByPage: Array.from(nextAssignments.entries()).map(([page, keyword]) => ({
          page,
          keyword,
        })),
      };

      await saveFocusKeywords(user.id, entries, snapshot);
      setHasAutoSelectedFocusKeywords(true);
      toast.success("Picked starter focus keywords for you.");
    } catch (error) {
      console.error("Failed to save initial focus keywords:", error);
      toast.error("We couldn't save your focus keywords. Try again.");
    } finally {
      setIsSavingFocusKeywords(false);
    }
  };

  const handleRefreshKeywords = async () => {
    if (!user?.id || !gscAccessToken || !isGscConnected) {
      toast.error("Please connect Google Search Console first.");
      return;
    }

    try {
      console.log("🔄 Refresh button clicked - starting refresh...");
      setIsRefreshingData(true);
      toast.info("Refreshing keywords with updated limit...");
      await fetchAndMatchGSC(gscAccessToken);
      console.log("✅ Refresh complete");
      toast.success("Keywords refreshed! You should see more options now.");
    } catch (error) {
      console.error("Failed to refresh keywords:", error);
      toast.error("Failed to refresh keywords. Please try again.");
    } finally {
      setIsRefreshingData(false);
    }
  };

  // Post-onboarding flow handlers
  const handleNextToKeywords = () => {
    if (data?.pagesStepCompleted) {
      updateData({ postOnboardingStep: 'keywords' });
    }
  };

  const handleSubmitKeywords = async () => {
    // If focus keywords are already saved, just complete the flow
    if (focusKeywords.length > 0) {
      updateData({
        postOnboardingStep: 'complete',
        pagesStepCompleted: false // Reset this flag
      });

      // Scroll to top when completing the flow
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }, 100);

      toast.success("Welcome to your SEO Dashboard!");
    } else {
      toast.error("Please select at least one focus keyword before continuing.");
    }
  };

  const stripHtmlTags = (html) => {
    if (typeof window === "undefined") return html;
    const div = document.createElement("div");
    div.innerHTML = html;
    return div.textContent || div.innerText || "";
  };

  const postOnboardingStep = data?.postOnboardingStep;
  const isInPostOnboardingFlow = !['in-progress', 'complete'].includes(data?.revampStatus) && postOnboardingStep && postOnboardingStep !== 'complete';
  const pagesStepCompleted = data?.pagesStepCompleted || false;

  return (
    <MainLayout
      aiTips={aiTips}
      gscKeywords={gscKeywords}
      easyWins={easyWins}
      topPages={topPages}
      lowCtrPages={lowCtrPages}
      impressionTrends={gscImpressionTrends}
      isLoading={isLoadingGscData}
    >
      {['in-progress', 'complete'].includes(data?.revampStatus) && <div className="border rounded-lg p-5 mb-6 space-y-2">
        <h2 className="text-xl font-semibold">Website update monitoring</h2>
        <p>Your dashboard is available while search data arrives. Previous website work is preserved as read-only history. Page progress shows dated comparisons when enough data is available.</p>
        <a href="/revamp" className="underline mr-4">Review website setup</a>
        <a href="/revamp/history" className="underline">Previous website work</a>
      </div>}
      {!isInPostOnboardingFlow && <PageProgress />}
      {/* Welcome message - shown when flow is complete or not in post-onboarding flow */}
      {(!isInPostOnboardingFlow || postOnboardingStep === 'complete') && (
        <div className="mb-6 animate-in fade-in duration-500">
          <h1 className="text-5xl font-bold mb-2">
            Welcome {data?.name ? data.name.split(" ")[0] : ""}!<br/> <span className="text-3xl">SEO Dashboard</span>
          </h1>
          <p className="text-muted-foreground">
            Get insights and recommendations for improving your website&apos;s search
            performance
          </p>
        </div>
      )}

      {/* Post-onboarding flow title */}
      {isInPostOnboardingFlow && postOnboardingStep !== 'complete' && (
        <div className="mb-6 animate-in fade-in duration-500">
          {postOnboardingStep === 'pages' && (
            <h1 className="text-5xl font-bold mb-2">
              Let&apos;s Get Started {data?.name ? data.name.split(" ")[0] : ""}!
            </h1>
          )}
          {postOnboardingStep === 'keywords' && (
            <h1 className="text-5xl font-bold mb-2">
              Choose Your Focus Keywords
            </h1>
          )}
        </div>
      )}

      <div className={cn("mb-6", isInPostOnboardingFlow && postOnboardingStep !== 'pages' && "hidden")}>

        {data?.siteCrawlStatus === "in-progress" && (
          <Alert className="mt-4 border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
            <AlertTitle>Scanning your website…</AlertTitle>
            <AlertDescription>
              We&apos;re crawling up to 25 pages so the AI coach can understand your content.
              This only takes a minute.
            </AlertDescription>
          </Alert>
        )}

        {/* Website scan complete card - show in pages step OR when not in post-onboarding flow (but hide after completion) */}
        {((postOnboardingStep === 'pages') || (!isInPostOnboardingFlow && postOnboardingStep !== 'complete')) &&
         (data?.siteCrawlStatus === "completed" ||
          data?.siteCrawlStatus === "completed-with-errors" ||
          data?.siteCrawlStatus === "awaiting-review") && (
          <Alert className="mt-4 border-green-200 bg-green-50 dark:border-green-900/40 dark:bg-green-900/20">
            <CheckCircle className="h-4 w-4 text-green-600 mt-1" />
            <div className="flex flex-col gap-4 w-full">
              <div className="min-w-0">
                <AlertTitle>Website scan complete</AlertTitle>
                <AlertDescription>
                  We crawled these pages so your SEO Mentor understands your business. Now the chatbot and AI tips use your real services and wording, not generic guesses.
                  <span className="block text-xs text-muted-foreground mt-1 mb-4">
                    Last crawl:{" "}
                    {data?.lastSiteCrawlAt
                      ? new Date(data.lastSiteCrawlAt).toLocaleString()
                      : "Just now"}
                  </span>
                </AlertDescription>

                <Alert className="w-full border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <AlertDescription className="!block text-sm text-blue-900 dark:text-blue-100 leading-relaxed">
                    <span className="font-bold">Tip:</span> Select only the pages that are actually on your website. If you see anything you don’t recognize, or pages you no longer use, just uncheck them. <br></br> A good rule: choose the pages that appear in your site’s main menu.
                  </AlertDescription>
                </Alert>
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  {needsCrawlReview
                    ? "Finish this step to personalize your SEO Mentor."
                    : "Your SEO Mentor uses the pages you select for guidance."}
                </p>

                {crawlPages.length > 0 ? (
                  <>
                    <div className="space-y-2 rounded-md border border-border bg-background/80 p-3">
                      {crawlPages
                        .filter((page) => reviewSelections.get(page.pageUrl) !== false)
                        .map((page) => (
                          <div
                            key={`kept-${page.pageUrl}`}
                            className="flex flex-col gap-2 rounded-md border border-border/60 bg-background p-3"
                          >
                            <div className="flex items-start gap-3">
                              <Checkbox
                                checked
                                onCheckedChange={(checked) =>
                                  handleTogglePage(page.pageUrl, checked)
                                }
                                className="mt-1"
                              />
                              <div className="flex-1 min-w-0 space-y-1">
                                <p className="text-sm font-medium text-foreground">
                                  {page.title}
                                </p>
                                <a
                                  href={page.pageUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-xs text-primary underline break-all"
                                >
                                  {page.pageUrl}
                                </a>
                              </div>
                            </div>
                            {Array.isArray(page.tags) && page.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 pl-7">
                                {page.tags.map((tag) => (
                                  <Badge
                                    key={`${page.pageUrl}-${tag}`}
                                    variant="secondary"
                                    className="text-[10px]"
                                  >
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>

                    {crawlPages.some((page) => reviewSelections.get(page.pageUrl) === false) && (
                      <div className="space-y-2 rounded-md border border-dashed border-muted-foreground/40 bg-muted/20 p-3">
                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                          Removed from this crawl (these pages will be skipped unless you re-check them)
                        </p>
                        {crawlPages
                          .filter((page) => reviewSelections.get(page.pageUrl) === false)
                          .map((page) => (
                            <div
                              key={`removed-${page.pageUrl}`}
                              className="flex flex-col gap-2 rounded-md border border-border/40 bg-background/60 p-3"
                            >
                              <div className="flex items-start gap-3">
                                <Checkbox
                                  checked={false}
                                  onCheckedChange={(checked) =>
                                    handleTogglePage(page.pageUrl, checked)
                                  }
                                  className="mt-1"
                                />
                                <div className="flex-1 min-w-0 space-y-1 text-muted-foreground">
                                  <p className="text-sm font-medium line-through">
                                    {page.title}
                                  </p>
                                  <a
                                    href={page.pageUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs underline"
                                  >
                                    {page.pageUrl}
                                  </a>
                                </div>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-md border border-dashed border-muted-foreground/40 p-4 text-sm text-muted-foreground">
                    We didn&apos;t detect pages to crawl yet. Add a few important URLs below so the AI coach has something to learn from.
                  </div>
                )}

                {/* Tip for adding URLs */}
                <Alert className="border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20">
                  <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
                  <AlertDescription className="text-sm text-blue-900 dark:text-blue-100 flex items-center gap-1.5">
                    <span className="font-bold">Tip:</span>
                    <span>Manually add any important pages that weren&apos;t detected in the crawl.</span>
                  </AlertDescription>
                </Alert>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    value={newUrlInput}
                    onChange={(event) => setNewUrlInput(event.target.value)}
                    onKeyDown={handleManualUrlKeyDown}
                    placeholder="https://yourdomain.com/page"
                    className="sm:flex-1"
                    disabled={isRecrawling || isLoadingCrawlReview}
                  />
                  <Button
                    type="button"
                    onClick={handleAddManualUrl}
                    disabled={isRecrawling || isLoadingCrawlReview}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add URL
                  </Button>
                </div>
                {manualReviewUrls.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {manualReviewUrls.map((url) => (
                      <Badge
                        key={url}
                        variant="secondary"
                        className="flex items-center gap-2"
                      >
                        <span className="max-w-[220px] truncate">{url}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveManualUrl(url)}
                          className="rounded-full p-0.5 hover:bg-muted"
                          disabled={isRecrawling}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={handleInitialCrawl}
                    disabled={
                      isInitialCrawlRunning ||
                      isRecrawling ||
                      isLoadingCrawlReview ||
                      data?.siteCrawlStatus === "in-progress"
                    }
                  >
                    {isInitialCrawlRunning ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    Initial Crawl
                  </Button>
                  <Button
                    onClick={hasNewManualUrls ? handleAddAndSave : handleSave}
                    disabled={
                      isRecrawling ||
                      isInitialCrawlRunning ||
                      isLoadingCrawlReview ||
                      data?.siteCrawlStatus === "in-progress"
                    }
                  >
                    {isRecrawling ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : null}
                    {hasNewManualUrls ? "Add & Save" : "Save"}
                  </Button>
                  {needsCrawlReview && !isInPostOnboardingFlow && (
                    <span className="text-xs text-muted-foreground">
                      We&apos;ll unlock the rest of your dashboard once this crawl finishes.
                    </span>
                  )}
                </div>
              </div>
            </div>
          </Alert>
        )}

        {data?.siteCrawlStatus === "error" && (
          <Alert className="mt-4 border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-900/20">
            <XCircle className="h-4 w-4 text-red-600" />
            <AlertTitle>We couldn&apos;t scan your website</AlertTitle>
            <AlertDescription>
              Please double-check your website URL in settings, then refresh to try again.
            </AlertDescription>
          </Alert>
        )}
        {/* {focusKeywords.length === 0 && (
          <Alert className="mt-4 border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <AlertTitle>Let&apos;s pick focus keywords</AlertTitle>
            <AlertDescription>
              Choose the keywords you want to improve first. We&apos;ll personalize the
              dashboard and chatbot around them.
            </AlertDescription>
          </Alert>
        )} */}
      </div>

      {/* Focus Keywords card - show in keywords step OR when not in post-onboarding flow (but hide after completion) */}
      {((postOnboardingStep === 'keywords') || (!isInPostOnboardingFlow && postOnboardingStep !== 'complete')) && (
        <section
          className={cn(
            "space-y-6 transition-all duration-300",
            false
          )}
        >
          {isGscConnected && (
            <Card className="col-span-full mb-6">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between">
                  <span>Choose Your Focus Keywords</span>
                  {postOnboardingStep !== 'keywords' && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleFocusKeywordHelp}
                        title="Get help choosing focus keywords"
                        className="text-primary hover:text-primary"
                      >
                        <HelpCircle className="h-4 w-4 mr-2" />
                        Help
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleRefreshKeywords}
                        disabled={isRefreshingData || isLoadingGscData || !isGscConnected}
                        title="Refresh keywords from Google Search Console"
                      >
                        <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshingData || isLoadingGscData ? 'animate-spin' : ''}`} />
                        Refresh
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={defaultFocusKeywords}
                        disabled={isFilteringKeywords || isSavingFocusKeywords}
                      >
                        Smart Suggest
                      </Button>
                    </div>
                  )}
                </CardTitle>
                <CardDescription>
                  Choose the keywords that matter most for each page so the rest of the dashboard can highlight them first.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FocusKeywordSelector
                  keywords={gscKeywords}
                  selectedByPage={focusKeywordByPage}
                  onToggle={handleFocusKeywordToggle}
                  isSaving={isSavingFocusKeywords}
                  suggestions={nonBrandedKeywords}
                  groupedByPage={groupedByPage}
                  businessName={data?.businessName || ""}
                  businessType={data?.businessType || ""}
                  businessLocation={data?.businessLocation || ""}
                  userId={user?.id || ""}
                />
                {/* Submit button for post-onboarding flow */}
                {postOnboardingStep === 'keywords' && (
                  <div className="mt-6 flex justify-end">
                    <Button
                      onClick={handleSubmitKeywords}
                      disabled={focusKeywords.length === 0 || isSavingFocusKeywords}
                      size="lg"
                    >
                      Submit
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </section>
      )}

      {/* Rest of dashboard content - only show when flow is complete or not in post-onboarding flow */}
      {((postOnboardingStep === 'complete') || (!isInPostOnboardingFlow)) && (
        <section
          className={cn(
            "space-y-6 transition-all duration-300",
            false
          )}
        >


        {/* GSC Setup Alert */}
        {gscAlert && (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-red-800 mb-2">
                  {gscAlert.title}
                </h3>
                <p className="text-red-700 mb-4">
                  {gscAlert.description}
                </p>
                <Button
                  onClick={() => {
                    if (gscAlert.type === "no-property-selected") {
                      router.push("/onboarding");
                    } else {
                      window.open("https://search.google.com/search-console", "_blank");
                    }
                  }}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {gscAlert.action}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="col-span-full mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center justify-between">
            <span>Search Impressions</span>
            <DateRangeFilter
              value={chartDateRange}
              onValueChange={(value) => setChartDateRange(value)}
              isLoading={isRefreshingData}
            />
          </CardTitle>
          <CardDescription>
            Track how often your website appears in Google search results - Last {chartDateRange === "all" ? "year" : `${chartDateRange} days`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingGscData && gscImpressionTrends.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground">Loading chart data...</p>
            </div>
          ) : !isGscConnected ? (
            <div className="text-center py-8">
              <div className="bg-muted inline-flex items-center justify-center w-16 h-16 rounded-full mb-4">
                <Unlink className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                Connect Google Search Console
              </h3>
              <p className="text-muted-foreground text-sm mb-4">
                Track how often your website appears in Google search results and see your search visibility over time
              </p>
              <Button onClick={requestGSCAuthToken}>Connect GSC</Button>
            </div>
          ) : (
            <div className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={gscImpressionTrends}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip
                    formatter={(value) => value}
                    labelFormatter={(label) => `Date: ${label}`}
                  />
                  <Line
                    type="monotone"
                    dataKey="impressions"
                    stroke="black"
                    strokeWidth={1}
                    dot={{ r: 5, fill: "#00BF63" }}
                    activeDot={{ r: 6, fill: "#00BF63" }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Alert className="mb-6 border-primary/20 bg-primary/5">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Quick SEO Tip</AlertTitle>
        <AlertDescription>
          {data.businessType === "Dentist"
            ? "Add your business hours, services, and patient reviews to improve your local SEO as a dental practice."
            : `Add your business hours and location details to your website to improve your local SEO visibility in ${
                data.businessLocation || "your area"
              }. Embed Google reviews to your website if you have any, this will help also with discoverability`}
        </AlertDescription>
      </Alert>
      {/* Getting Started Card */}
       {/* <Card>
        <CardHeader>
          <CardTitle>Your Next Steps</CardTitle>
          <CardDescription>
            Follow these steps to improve your SEO
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center">
                <div className="bg-primary/10 text-primary h-8 w-8 rounded-full flex items-center justify-center mr-3">
                  <span className="font-medium">1</span>
                </div>
                <div>
                  <p className="font-medium">Connect Google Search Console</p>
                  <p className="text-sm text-muted-foreground">
                    Track your search rankings and performance
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm">
                <ExternalLink className="h-4 w-4 mr-1" />
                Setup
              </Button>
            </div>

            <div className="flex justify-between items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center">
                <div className="bg-primary/10 text-primary h-8 w-8 rounded-full flex items-center justify-center mr-3">
                  <span className="font-medium">2</span>
                </div>
                <div>
                  <p className="font-medium">Complete Your Local SEO Profile</p>
                  <p className="text-sm text-muted-foreground">
                    Add business details for local search
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm">
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex justify-between items-center p-3 border rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-center">
                <div className="bg-primary/10 text-primary h-8 w-8 rounded-full flex items-center justify-center mr-3">
                  <span className="font-medium">3</span>
                </div>
                <div>
                  <p className="font-medium">Optimize Website Content</p>
                  <p className="text-sm text-muted-foreground">
                    Improve page titles, descriptions, and content
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm">
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card> */}


      {/* Top Row - Action Items */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6 mt-6">

        {/* Improve a page Card */}
        <Card
          className={cn(
            "col-span-full md:col-span-1 h-full border-red-200 shadow-red-100 transition-all",
            hasFocusKeywords && "border-primary/40 shadow-[0_0_0_1px_rgba(0,191,99,0.15)]"
          )}
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Improve a page
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
                    High Priority
                  </span>
                </CardTitle>
                <CardDescription>
                  These pages show up in searches but aren&apos;t getting many
                  clicks. Consider rewriting their titles and meta descriptions
                  to improve click-through rate. Data from last 28 days.
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/low-ctr">See More</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isGscConnected ? (
              isLoadingGscData && prioritizedLowCtrPages.length === 0 ? (
                <div className="text-center py-8">
                  <SquashBounceLoader size="lg" className="mb-4" />
                  <p className="text-sm text-muted-foreground">Loading CTR data...</p>
                </div>
              ) : prioritizedLowCtrPages.length === 0 ? (
                <div className="text-center py-6">
                  <div className="bg-green-100 dark:bg-green-900/20 inline-flex items-center justify-center w-12 h-12 rounded-full mb-3">
                    <CheckCircle2 className="w-6 h-6 text-green-600" />
                  </div>
                  <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">
                  Great performance so far
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-300">
                  Click &quot;See More&quot; to optimize the focus keywords you selected
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {prioritizedLowCtrPages.map((page, idx) => {
                    const focusKeyword = page.focusKeywords?.[0] || null;
                    const focusKeywordLower = focusKeyword
                      ? focusKeyword.toLowerCase()
                      : null;
                    const additionalKeywords = (page.keywords || []).filter(
                      (keyword) =>
                        keyword &&
                        keyword.toLowerCase() !== focusKeywordLower &&
                        keyword !== focusKeyword
                    );

                    return (
                      <li key={idx} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="text-red-600 h-4 w-4 flex-shrink-0" />
                          <a
                            href={page.page}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#00BF63] underline truncate"
                          >
                            {page.page}
                          </a>
                          {focusKeyword && (
                            <Badge variant="secondary" className="ml-auto">
                              Focus keyword
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground pl-6">
                          {page.impressions} impressions, {page.clicks} clicks (
                          {page.ctr} CTR)
                        </div>
                        <div className="pl-6 text-xs text-muted-foreground">
                          {focusKeyword ? (
                            <div className="flex flex-col gap-1">
                              <span>
                                Primary keyword:&nbsp;
                                <span className="font-medium text-foreground">
                                  {focusKeyword}
                                </span>
                              </span>
                              {additionalKeywords.length > 0 && (
                                <span>
                                  Other low-CTR queries:&nbsp;
                                  {additionalKeywords.join(", ")}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span>
                              Primary keyword:&nbsp;
                              {page.primaryKeyword || "—"}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )
            ) : (
              <div className="text-center py-6">
                <div className="bg-muted inline-flex items-center justify-center w-16 h-16 rounded-full mb-4">
                  <Unlink className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">
                  Connect Google Search Console
                </h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Find pages with low click-through rates and fix them to improve your SEO performance
                </p>
                <Button onClick={requestGSCAuthToken}>Connect GSC</Button>
              </div>
            )}
            {focusKeywordsNotShownLowCtr.length > 0 && (
              <div className="mt-4 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-4 text-sm">
                <p className="font-semibold mb-2">Focus keywords not showing up here yet</p>
                <p className="text-xs text-muted-foreground mb-3">
                  These keywords are on your focus list, but they haven&apos;t hit the Low CTR threshold. Click &quot;See More&quot; to optimize these pages.
                </p>
                <ul className="space-y-2">
                  {focusKeywordsNotShownLowCtr.map(({ keyword, data, page }) => (
                    <li key={keyword} className="flex flex-col gap-1 rounded-sm bg-background/60 px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{keyword}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          Focus
                        </Badge>
                      </div>
                      {data ? (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{data.impressions} impressions</span>
                          <span>Pos. {data.position}</span>
                          {(page || data.page) && (
                            <a
                              href={page || data.page}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#00BF63] underline"
                            >
                              View page
                            </a>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>No Search Console data yet for this keyword.</span>
                          {page && (
                            <a
                              href={page}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#00BF63] underline"
                            >
                              View page
                            </a>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI-Generated Content Opportunities */}
        <Card
          className={cn(
            "col-span-full md:col-span-1 h-full border-red-200 shadow-red-100 transition-all",
            hasFocusKeywords && "border-primary/40 shadow-[0_0_0_1px_rgba(0,191,99,0.15)]"
          )}
        >
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="flex flex-wrap items-center gap-2">
                  New page ideas
                  <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full font-medium">
                    Optional
                  </span>
                </CardTitle>
                <CardDescription>
                  Check existing coverage before planning useful new pages.
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm" className="self-start sm:flex-shrink-0">
                <Link href="/generic-keywords">See More</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isGscConnected ? (
              isLoadingGscData && gscKeywords.length === 0 ? (
                <div className="text-center py-8">
                  <SquashBounceLoader size="lg" className="mb-4" />
                  <p className="text-sm text-muted-foreground">Loading opportunities...</p>
                </div>
              ) : (
                <GenericKeywordCard gscKeywords={gscKeywords} />
              )
            ) : (
              <div className="text-center py-6">
                <div className="bg-muted inline-flex items-center justify-center w-16 h-16 rounded-full mb-4">
                  <Unlink className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-medium mb-2">
                  Connect Google Search Console
                </h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Connect your website to review its existing coverage
                </p>
                <Button onClick={requestGSCAuthToken}>Connect GSC</Button>
              </div>
            )}
          </CardContent>
        </Card>
        </div>

      {/* Bottom Row - Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Top Performing Keywords Card */}
        <Card className="col-span-full md:col-span-1 h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Top Performing Keywords
                  <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-full font-medium">
                    Insights
                  </span>
                </CardTitle>
                <CardDescription>
                  Your most clicked search terms in the last 28 days
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link href="/top-keywords">See More</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingGscData && gscKeywords.length === 0 ? (
              <div className="text-center py-8">
                <SquashBounceLoader size="lg" className="mb-4" />
                <p className="text-sm text-muted-foreground">Loading keywords...</p>
              </div>
            ) : (
              <KeywordTable keywords={gscKeywordsWithFocus} title="Top Keywords" />
            )}
          </CardContent>
        </Card>

        {/* Top Pages Card */}
        <Card className="col-span-full md:col-span-1 h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  Top Pages
                  <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded-full font-medium">
                    Insights
                  </span>
                </CardTitle>
                <CardDescription>
                  Pages that appeared in search results in the last 28 days (may include
                  0-click pages)
                </CardDescription>
              </div>
              {/* <Button variant="outline" size="sm">
                See More
              </Button> */}
            </div>
          </CardHeader>
          <CardContent>
            {isLoadingGscData && topPages.length === 0 ? (
              <div className="text-center py-8">
                <SquashBounceLoader size="lg" className="mb-4" />
                <p className="text-sm text-muted-foreground">Loading pages...</p>
              </div>
            ) : topPages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data yet</p>
            ) : (
              <ul className="space-y-2">
                {topPages.map((page) => (
                  <li key={page.page}>
                    <a
                      href={page.page}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#00BF63] underline truncate max-w-full block"
                    >
                      {page.page}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
        </section>
      )}
    </MainLayout>
  );
}

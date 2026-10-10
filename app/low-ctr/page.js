"use client";

import { reconnectGsc } from "../lib/reconnectGsc";
import { authenticatedFetch } from "../lib/authenticatedFetch";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import { db } from "../lib/firebaseConfig";
import { doc, getDoc, setDoc, collection, query, where, getDocs } from "firebase/firestore";
import { createGSCTokenManager } from "../lib/gscTokenManager";
import SeoRecommendationPanel from "../components/dashboard/SeoRecommendationPanel";
import MainLayout from "../components/MainLayout";
import SeoPerformanceCard from "../components/dashboard/SeoPerformanceCard";
import SeoImpactLeaderboard from "../components/dashboard/SeoImpactLeaderboard";
import SuccessPanel from "../components/dashboard/SuccessPanel";
import { Button } from "@/components/ui/button";
import { fetchWpPages } from "../lib/fetchWpPages";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { AlertTriangle, Unlink } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import SquashBounceLoader from "../components/ui/squash-bounce-loader";
import { useMinimumLoading } from "../hooks/use-minimum-loading";
import { Calendar, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import ContentAuditPanel from "../components/dashboard/ContentAuditPanel";
import PivotOptionsPanel from "../components/dashboard/PivotOptionsPanel";
import { Badge } from "@/components/ui/badge";
import { getFocusKeywords } from "../lib/firestoreHelpers";
import {
  fetchWithCache,
  CACHE_DURATIONS,
} from "../lib/apiCache";

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

// Helper function to create safe document IDs
const createSafeDocId = (userId, pageUrl) => {
  // Create a more unique hash to avoid collisions
  let hash = 0;
  for (let i = 0; i < pageUrl.length; i++) {
    const char = pageUrl.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  // Convert to positive hex string and take first 8 chars
  const urlHash = Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8);
  const finalId = `${userId}_${urlHash}`;
  
  // Debug logging
  console.log("🔍 createSafeDocId Debug:");
  console.log("  userId:", userId);
  console.log("  pageUrl:", pageUrl);
  console.log("  raw hash:", hash);
  console.log("  urlHash:", urlHash);
  console.log("  finalId:", finalId);
  console.log("  expectedId:", "c7uSLI9gpbUSoeRv05zeDklER763_3b0a68f3");
  console.log("  match:", finalId === "c7uSLI9gpbUSoeRv05zeDklER763_3b0a68f3");
  
  return finalId;
};

// ✅ Add filtering function at top
const isRelevantPage = (url) =>
  url.includes("bryandevelops.com/") &&
  !url.includes("/tag/") &&
  !url.includes("/category/") &&
  !url.includes("/event") &&
  !url.includes("/faq") &&
  !url.includes("/author/") &&
  !url.includes("/author/") &&
  !url.includes("/topics/") &&
  !url.includes("/rvm") &&
  !url.includes("wordpress-maintenance-support") &&
  !url.includes("post-format") &&
  !url.includes("sample") &&
  !url.includes("chat") &&
  !url.includes("blockquote") &&
  !url.includes("?") &&
  !url.includes("carousel") &&
  !url.includes("video") &&
  !url.includes("status") &&
  !url.includes("/wp-json") &&
  !url.includes("/feed") &&
  !url.match(/\/\d{4}\/\d{2}\/\d{2}/); // ✅ fixed

export default function LowCtrPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [lowCtrPages, setLowCtrPages] = useState([]);
  const [aiMetaByPage, setAiMetaByPage] = useState({});
  const [sitemapUrls, setSitemapUrls] = useState([]);
  const [implementedPages, setImplementedPages] = useState([]);
  const [pageImplementationDates, setPageImplementationDates] = useState({});
  const [pivotedPagesData, setPivotedPagesData] = useState({}); // Track pivoted pages and their keyword history
  const [loading, setLoading] = useState(true);
  const [timePeriod, setTimePeriod] = useState(28); // Default to 28 days
  const shouldShowLoader = useMinimumLoading(loading, 3000);
  const [focusKeywords, setFocusKeywords] = useState([]);
  const [focusKeywordAssignments, setFocusKeywordAssignments] = useState(
    new Map()
  );
  const [focusKeywordSourceByPage, setFocusKeywordSourceByPage] = useState(new Map()); // Track source: "ai-generated" or "gsc-existing"
  const [isGscConnected, setIsGscConnected] = useState(false);
  const [focusKeywordsLoaded, setFocusKeywordsLoaded] = useState(false);
  const [gscKeywordRows, setGscKeywordRows] = useState([]);
  const [viewMode, setViewMode] = useState("raw");
  const [userHasToggledView, setUserHasToggledView] = useState(false);
  
  // Recovery state - temporary until keywords are restored
  const [needsRecovery, setNeedsRecovery] = useState(false);
  const [snapshotKeywordCount, setSnapshotKeywordCount] = useState(0);
  const [isRestoring, setIsRestoring] = useState(false);

  useEffect(() => {
    const fetchGSCData = async () => {
      if (!user?.id) {
        return;
      }

      try {
        const tokenManager = createGSCTokenManager(user.id);
        
        // Add a small delay to ensure tokens are stored
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const gscData = await tokenManager.getStoredGSCData();
        
        if (!gscData?.refreshToken || !gscData?.siteUrl) {
          setIsGscConnected(false);
          setLoading(false);
          return;
        }

        setIsGscConnected(true);

        // Get valid access token (refresh if needed)
        const validToken = await tokenManager.getValidAccessToken();
        if (!validToken) {
          setIsGscConnected(false);
          setLoading(false);
          return;
        }

        fetchLowCtrPages(gscData.siteUrl, validToken);
      } catch (error) {
        console.error("Error fetching GSC data:", error);
        setLoading(false);
      }
    };

    fetchGSCData();
  }, [user, timePeriod]); // Add timePeriod dependency

  const requestGSCAuthToken = async () => {
    try {
      const tokens = await reconnectGsc();
      setIsGscConnected(true); window.location.reload();
    } catch (error) { window.alert(error.message); }
  };

  useEffect(() => {
    const loadWpPages = async () => {
      const domain = "bryandevelops.com";
      const pages = await fetchWpPages(domain);
      setSitemapUrls(pages);
    };

    loadWpPages();
  }, []);

  // ✅ Fetch implemented pages and their implementation dates
  useEffect(() => {
    const fetchImplementedPages = async () => {
      if (!user?.id) return;

      // Fetch implemented pages
      const implementedQuery = query(
        collection(db, "implementedSeoTips"),
        where("userId", "==", user.id),
        where("status", "==", "implemented")
      );

      // Also fetch pivoted pages to track their keyword history
      const pivotedQuery = query(
        collection(db, "implementedSeoTips"),
        where("userId", "==", user.id),
        where("status", "==", "pivoted")
      );

      const [implementedSnapshot, pivotedSnapshot] = await Promise.all([
        getDocs(implementedQuery),
        getDocs(pivotedQuery)
      ]);
      
      const now = Date.now();
      const fortyFiveDaysInMs = 45 * 24 * 60 * 60 * 1000;

      const pageData = {};
      const eligiblePages = [];
      const pivotedData = {};

      // Process implemented pages (exclude archived revamp data)
      implementedSnapshot.docs.filter(doc => !doc.data().preRevampArchived).forEach(doc => {
        const data = doc.data();
        if (data.postStats && data.implementedAt && data.preStats) {
          const daysSince = Math.floor((now - new Date(data.implementedAt).getTime()) / (1000 * 60 * 60 * 24));
          
          // Calculate new impressions since implementation
          const newImpressions = (data.postStats.impressions || 0) - (data.preStats.impressions || 0);
          const currentPosition = data.postStats.position || 0;
          
          // Store implementation data for each page
          pageData[data.pageUrl] = {
            implementedAt: data.implementedAt,
            daysSince: daysSince,
            hasZeroClicks: data.postStats.clicks === 0,
            newImpressions: newImpressions,
            currentPosition: currentPosition,
            preStats: data.preStats,
            postStats: data.postStats,
            keywordHistory: data.keywordHistory || [],
            keywordStatsHistory: data.keywordStatsHistory || [],
            // 45-Day Snapshot System
            dayFortyFiveSnapshot: data.dayFortyFiveSnapshot || null,
          };

          // Content Audit eligibility: 45+ days AND 0 clicks AND 50+ new impressions AND position >= 15
          const isEligible = daysSince >= 45 && 
                            data.postStats.clicks === 0 && 
                            newImpressions >= 50 && 
                            currentPosition >= 15;
          
          if (isEligible) {
            eligiblePages.push(data.pageUrl);
          }
        }
      });

      // Process pivoted pages - store their keyword history so we can show it in the SEO panel
      pivotedSnapshot.docs.filter(doc => !doc.data().preRevampArchived).forEach(doc => {
        const data = doc.data();
        pivotedData[data.pageUrl] = {
          isPivoted: true,
          pivotedAt: data.pivotedAt,
          keywordHistory: data.keywordHistory || [],
          keywordStatsHistory: data.keywordStatsHistory || [],
          pivotedToKeyword: data.pivotedToKeyword,
          pivotedFromKeyword: data.pivotedFromKeyword
        };
      });

      setPageImplementationDates(pageData);
      setImplementedPages(eligiblePages);
      setPivotedPagesData(pivotedData);
    };

    fetchImplementedPages();
  }, [user]);

  useEffect(() => {
    const fetchFocus = async () => {
      if (!user?.id) return;
      try {
        const keywords = await getFocusKeywords(user.id);
        if (Array.isArray(keywords) && keywords.length > 0) {
          const keywordList = [];
          const assignments = new Map();
          const sources = new Map();
          keywords.forEach(({ keyword, pageUrl, source }) => {
            if (!keyword) return;
            keywordList.push(keyword);
            assignments.set(keyword.toLowerCase(), pageUrl || null);
            if (pageUrl) {
              // Normalize URL to ensure consistent matching
              const normalizedUrl = normalizeUrlForComparison(pageUrl);
              if (normalizedUrl) {
                sources.set(normalizedUrl, source || "gsc-existing");
              }
            }
          });
          setFocusKeywords(keywordList);
          setFocusKeywordAssignments(assignments);
          setFocusKeywordSourceByPage(sources);
        } else {
          setFocusKeywords([]);
          setFocusKeywordAssignments(new Map());
          setFocusKeywordSourceByPage(new Map());
        }
      } catch (error) {
        console.error("Failed to load focus keywords:", error);
      }
      setFocusKeywordsLoaded(true);
    };

    fetchFocus();
  }, [user?.id]);

  // Check if recovery is needed (snapshot has more keywords than current)
  useEffect(() => {
    const checkRecovery = async () => {
      if (!user?.id) return;
      
      try {
        const response = await authenticatedFetch(`/api/focus-keywords/restore?userId=${encodeURIComponent(user.id)}`);
        if (response.ok) {
          const data = await response.json();
          if (data.hasSnapshot && data.snapshotKeywordsCount > data.currentKeywordsCount) {
            setNeedsRecovery(true);
            setSnapshotKeywordCount(data.snapshotKeywordsCount);
          }
        }
      } catch (error) {
        console.error("Failed to check recovery status:", error);
      }
    };
    
    checkRecovery();
  }, [user?.id]);

  // Handle keyword recovery from snapshot
  const handleRecoverKeywords = async () => {
    if (!user?.id) return;
    
    setIsRestoring(true);
    try {
      const response = await authenticatedFetch("/api/focus-keywords/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to restore keywords");
      }
      
      const result = await response.json();
      
      // Refresh focus keywords state
      const keywords = await getFocusKeywords(user.id);
      if (Array.isArray(keywords) && keywords.length > 0) {
        const keywordList = [];
        const assignments = new Map();
        const sources = new Map();
        keywords.forEach(({ keyword, pageUrl, source }) => {
          if (!keyword) return;
          keywordList.push(keyword);
          assignments.set(keyword.toLowerCase(), pageUrl || null);
          if (pageUrl) {
            const normalizedUrl = normalizeUrlForComparison(pageUrl);
            if (normalizedUrl) {
              sources.set(normalizedUrl, source || "gsc-existing");
            }
          }
        });
        setFocusKeywords(keywordList);
        setFocusKeywordAssignments(assignments);
        setFocusKeywordSourceByPage(sources);
      }
      
      setNeedsRecovery(false);
      alert(`✅ Restored ${result.keywords.length} keywords successfully! The page will now refresh.`);
      window.location.reload();
    } catch (error) {
      console.error("Failed to restore keywords:", error);
      alert(`❌ Failed to restore: ${error.message}`);
    } finally {
      setIsRestoring(false);
    }
  };

  // ✅ Memoized filtered sitemap pages
  const relevantPages = useMemo(
    () => sitemapUrls.filter(isRelevantPage),
    [sitemapUrls]
  );

  useEffect(() => {
    if (!focusKeywordsLoaded || userHasToggledView) return;
    if (focusKeywords.length > 0) {
      setViewMode("focus");
    } else {
      setViewMode("raw");
    }
  }, [focusKeywordsLoaded, focusKeywords.length, userHasToggledView]);

  const lowCtrUrls = useMemo(
    () => new Set(lowCtrPages.map((p) => p.page)),
    [lowCtrPages]
  );

  const orderedFocusKeywords = useMemo(
    () => (focusKeywords || []).map((keyword) => keyword.trim()).filter(Boolean),
    [focusKeywords]
  );

  const focusKeywordSet = useMemo(
    () => new Set(orderedFocusKeywords.map((keyword) => keyword.toLowerCase())),
    [orderedFocusKeywords]
  );

  const focusKeywordTopRows = useMemo(() => {
    const map = new Map();
    gscKeywordRows.forEach((row) => {
      const keyword = row.keys?.[0];
      const page = row.keys?.[1];
      if (!keyword || !focusKeywordSet.has(keyword.toLowerCase())) return;
      const impressions = row.impressions || 0;
      const position = row.position != null ? Number(row.position.toFixed(1)) : null;
      const entry = map.get(keyword.toLowerCase());
      if (!entry || impressions > entry.impressions) {
        map.set(keyword.toLowerCase(), {
          keyword,
          impressions,
          position,
          page,
        });
      }
    });
    return map;
  }, [gscKeywordRows, focusKeywordSet]);

  const focusLowCtrPages = useMemo(() => {
    if (!focusKeywordSet.size) return [];

    return lowCtrPages
      .map((page) => {
        // First, check if there's an assigned focus keyword for this page URL
        const normalizedPageUrl = normalizeUrlForComparison(page.page);
        let assignedKeyword = null;
        
        for (const [keywordLower, assignedPageUrl] of focusKeywordAssignments.entries()) {
          if (assignedPageUrl) {
            const normalizedAssignedUrl = normalizeUrlForComparison(assignedPageUrl);
            if (normalizedAssignedUrl === normalizedPageUrl) {
              const originalKeyword = focusKeywords.find(k => k.toLowerCase() === keywordLower);
              if (originalKeyword) {
                assignedKeyword = originalKeyword;
                break;
              }
            }
          }
        }
        
        // Only include pages with assigned keywords - no fallback to GSC matching
        // This ensures only pages where the user explicitly selected a focus keyword appear
        if (!assignedKeyword) {
          return null;
        }

        const matchingKeywords = [assignedKeyword];
        const additionalKeywords = (page.keywords || []).filter((keyword) => {
          if (!keyword) return false;
          return keyword.toLowerCase() !== assignedKeyword.toLowerCase();
        });

        return {
          ...page,
          focusKeyword: assignedKeyword,
          matchingKeywords,
          additionalKeywords,
        };
      })
      .filter(Boolean);
  }, [lowCtrPages, focusKeywordSet, focusKeywordAssignments, focusKeywords]);

  const focusKeywordsNotShown = useMemo(() => {
    // Build a set of keywords that are actually assigned to low-CTR pages
    const shownInLowCtr = new Set();
    
    // Only mark keywords that are actually focus keywords for low-CTR pages
    focusLowCtrPages.forEach((page) => {
      if (page.focusKeyword) {
        shownInLowCtr.add(page.focusKeyword.toLowerCase());
      }
    });

    return orderedFocusKeywords
      .filter((keyword) => {
        const lower = keyword.toLowerCase();
        // Include if:
        // 1. Not shown in focusLowCtrPages (not assigned to a low-CTR page)
        // 2. Has a page assignment (assigned to a specific page URL)
        const assignedPage = focusKeywordAssignments.get(lower);
        return !shownInLowCtr.has(lower) && assignedPage;
      })
      .map((keyword) => {
        const lower = keyword.toLowerCase();
        const data = focusKeywordTopRows.get(lower) || null;
        const mappedPage = focusKeywordAssignments.get(lower) || null;
        return {
          keyword,
          data,
          page: mappedPage ?? data?.page ?? null,
        };
      });
  }, [
    orderedFocusKeywords,
    focusLowCtrPages,
    focusKeywordTopRows,
    focusKeywordAssignments,
  ]);

  const buildSuggestionKey = (pageUrl, focusKeyword) =>
    `${pageUrl}::${focusKeyword ? focusKeyword.toLowerCase() : "__none__"}`;

  const focusSuggestionTargets = useMemo(() => {
    const targets = focusLowCtrPages.map((page) => ({
      pageUrl: page.page,
      focusKeyword: page.focusKeyword,
      metrics: {
        impressions: page.impressions,
        clicks: page.clicks,
        ctr: page.ctr,
      },
      key: buildSuggestionKey(page.page, page.focusKeyword),
    }));

    const seen = new Set(targets.map((item) => item.pageUrl));

    focusKeywordsNotShown.forEach(({ keyword, data, page }) => {
      const pageUrl = page || data?.page;
      if (!pageUrl || seen.has(pageUrl)) return;
      seen.add(pageUrl);
      targets.push({
        pageUrl,
        focusKeyword: keyword,
        metrics: {
          impressions: data?.impressions ?? 0,
          clicks: data?.clicks ?? 0,
          ctr:
            data && typeof data.impressions === "number" && data.impressions > 0
              ? `${(((data.clicks ?? 0) / data.impressions) * 100).toFixed(1)}%`
              : "0%",
        },
        key: buildSuggestionKey(pageUrl, keyword),
      });
    });

    return targets;
  }, [focusLowCtrPages, focusKeywordsNotShown]);

  // Create reverse map: pageUrl → keyword (for looking up focus keyword by page)
  const focusKeywordByPage = useMemo(() => {
    const map = new Map();
    console.log(`📦 [LOW-CTR] Building focusKeywordByPage from assignments:`, Array.from(focusKeywordAssignments.entries()));
    focusKeywordAssignments.forEach((pageUrl, keyword) => {
      if (pageUrl) {
        const normalizedUrl = normalizeUrlForComparison(pageUrl);
        if (normalizedUrl) {
          console.log(`📦 [LOW-CTR] Mapping: "${normalizedUrl}" -> "${keyword}"`);
          map.set(normalizedUrl, keyword);
        }
      }
    });
    console.log(`📦 [LOW-CTR] Final focusKeywordByPage size: ${map.size}`);
    return map;
  }, [focusKeywordAssignments]);

  const rawSuggestionTargets = useMemo(
    () => {
      console.log(`📦 [LOW-CTR rawSuggestionTargets] Building for ${lowCtrPages.length} pages, focusKeywordByPage size: ${focusKeywordByPage.size}`);
      return lowCtrPages.map((page) => {
        // Look up saved focus keyword for this page
        const normalizedPageUrl = normalizeUrlForComparison(page.page);
        const savedFocusKeyword = focusKeywordByPage.get(normalizedPageUrl) || null;
        console.log(`📦 [LOW-CTR rawSuggestionTargets] "${page.page}" -> normalized: "${normalizedPageUrl}" -> keyword: "${savedFocusKeyword || 'NULL'}"`);
        
        return {
          pageUrl: page.page,
          focusKeyword: savedFocusKeyword,
          metrics: {
            impressions: page.impressions,
            clicks: page.clicks,
            ctr: page.ctr,
          },
          key: buildSuggestionKey(page.page, savedFocusKeyword),
        };
      });
    },
    [lowCtrPages, focusKeywordByPage]
  );

  const suggestionTargets = useMemo(() => {
    if (viewMode === "focus") {
      if (focusSuggestionTargets.length > 0) {
        return focusSuggestionTargets;
      }
      return rawSuggestionTargets;
    }
    return rawSuggestionTargets;
  }, [viewMode, focusSuggestionTargets, rawSuggestionTargets]);

  const requestAiMeta = async ({
    pageUrl,
    focusKeyword: focusKeywordArg,
    key,
  }) => {
    try {
      // DEBUG: Log what's being sent to the API
      console.log(`🔍 [LOW-CTR requestAiMeta] pageUrl: ${pageUrl}`);
      console.log(`🔍 [LOW-CTR requestAiMeta] focusKeywordArg: ${focusKeywordArg || 'NULL'}`);
      
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
            console.log(`🧠 [LOW-CTR requestAiMeta] Found ${previousAttempts.length} previous meta attempt(s) with full stats for AI learning`);
          }
        }
      } catch (historyError) {
        console.warn("Could not fetch meta optimization history:", historyError);
      }
      
      const payload = {
        pageUrl,
        userId: user?.id, // ✅ Add userId so API can fetch onboarding data
        context: {
          source: "low-ctr-suggestions",
          ...(focusKeywordArg ? { focusKeyword: focusKeywordArg } : {}),
        },
        ...(focusKeywordArg ? { focusKeywords: [focusKeywordArg] } : {}),
        // Include previous attempts for AI learning (with full stats)
        ...(previousAttempts.length > 0 ? { previousAttempts } : {}),
      };
      
      console.log(`🔍 [LOW-CTR requestAiMeta] payload.focusKeywords:`, payload.focusKeywords || 'NOT SET');
      if (previousAttempts.length > 0) {
        console.log(`🔍 [LOW-CTR requestAiMeta] payload.previousAttempts:`, previousAttempts.length, 'attempts');
      }

      // Cache params for both title and description
      const cacheParams = {
        pageUrl,
        focusKeyword: focusKeywordArg || null,
        source: "low-ctr-suggestions"
      };

      const [titleResult, descResult] = await Promise.all([
        fetchWithCache(
          "/api/seo-assistant/meta-title",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          CACHE_DURATIONS.META_TITLE,
          cacheParams
        ).catch(() => ({ title: null, fromCache: false })),
        fetchWithCache(
          "/api/seo-assistant/meta-description",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
          CACHE_DURATIONS.META_DESCRIPTION,
          cacheParams
        ).catch(() => ({ description: null, fromCache: false }))
      ]);

      return {
        pageUrl,
        title: titleResult.title || "Suggested Title",
        description: descResult.description || "Suggested Description",
        focusKeyword: focusKeywordArg || null,
        key,
      };
    } catch (error) {
      console.error("Failed to fetch AI meta suggestions:", error);
      return {
        pageUrl,
        title: "Suggested Title",
        description: "Suggested Description",
        focusKeyword: focusKeywordArg || null,
        key,
      };
    }
  };

  useEffect(() => {
    const missing = suggestionTargets.filter(
      ({ key }) => !aiMetaByPage[key]
    );
    if (!missing.length) return;

    // Filter to only include pages with focus keywords selected
    const missingWithKeywords = missing.filter(({ focusKeyword, pageUrl }) => {
      if (!focusKeyword) {
        console.log(`⏭️ [LOW-CTR] Skipping meta generation for ${pageUrl} - no focus keyword selected`);
        return false;
      }
      return true;
    });

    if (!missingWithKeywords.length) return;

    let cancelled = false;
    const loadSuggestions = async () => {
      const suggestions = await Promise.all(
        missingWithKeywords.map((target) => requestAiMeta(target))
      );
      if (cancelled) return;
      setAiMetaByPage((prev) => {
        const next = { ...prev };
        suggestions.forEach((entry) => {
          next[entry.key] = entry;
        });
        return next;
      });
    };

    loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, [suggestionTargets, aiMetaByPage]);


  // Helper function to check if a page is eligible for Content Quality Audit
  // Uses snapshot cardType if available (45+ days), otherwise falls back to real-time metrics
  const isPageEligibleForContentAudit = (pageUrl) => {
    const pageData = pageImplementationDates[pageUrl];
    if (!pageData) return false;
    
    const { daysSince, hasZeroClicks, newImpressions, currentPosition, dayFortyFiveSnapshot } = pageData;
    
    // If snapshot exists with cardType, use that for stable card display
    if (dayFortyFiveSnapshot?.cardType) {
      return dayFortyFiveSnapshot.cardType === "content-audit";
    }
    
    // Fallback to real-time criteria for pages without snapshot:
    // 1. 45+ days since implementation (Google had time to react)
    // 2. 0 clicks (CTR fixes didn't work)
    // 3. 50+ new impressions (enough exposure to evaluate)
    // 4. Position >= 15 (page 2+, not close to page 1)
    return daysSince >= 45 && 
           hasZeroClicks && 
           (newImpressions || 0) >= 50 && 
           (currentPosition || 0) >= 15;
  };

  // Helper: Get expected CTR by position (industry averages)
  const getExpectedCTR = (position) => {
    if (position <= 1) return 0.28;  // 28%
    if (position <= 2) return 0.15;  // 15%
    if (position <= 3) return 0.10;  // 10%
    if (position <= 4) return 0.07;  // 7%
    if (position <= 5) return 0.05;  // 5%
    if (position <= 10) return 0.025; // 2.5%
    if (position <= 15) return 0.01;  // 1%
    return 0.005; // 0.5% for position 16+
  };

  // Helper: Check if page is performing well (Success Detection)
  const isPageSuccessful = (position, impressions, clicks) => {
    if (impressions < 20) return false; // Not enough data
    const actualCTR = impressions > 0 ? clicks / impressions : 0;
    const expectedCTR = getExpectedCTR(position);
    return actualCTR >= expectedCTR; // Success if CTR >= 100% of expected
  };

  // Helper function to check if a page needs Pivot Options
  // Uses snapshot cardType if available (45+ days), otherwise falls back to real-time metrics
  const isPageEligibleForPivotOptions = (pageUrl) => {
    // Check if the page has already been pivoted - if so, don't show pivot card
    const normalizedUrl = normalizeUrlForComparison(pageUrl);
    const isPivoted = Object.keys(pivotedPagesData).some(url => 
      normalizeUrlForComparison(url) === normalizedUrl
    );
    
    if (isPivoted) {
      console.log("🔄 Page already pivoted, hiding pivot options:", pageUrl);
      return false;
    }
    
    const pageData = pageImplementationDates[pageUrl];
    
    // TEST FLAG: Force show for test page regardless of Content Audit criteria
    // BUT still require 45+ days of tracking (like real pages)
    // TODO: Remove after testing
    const isTestPage = pageUrl?.toLowerCase().includes("best-website-builders");
    if (isTestPage) {
      // Still check if page has been tracking for 45+ days
      if (!pageData || pageData.daysSince < 45) {
        console.log("🧪 TEST: Test page not yet at 45 days, hiding pivot options:", pageUrl, "daysSince:", pageData?.daysSince);
        return false;
      }
      console.log("🧪 TEST: Showing pivot options for test page (45+ days):", pageUrl);
      return true;
    }
    
    if (!pageData) return false;
    
    const { daysSince, hasZeroClicks, newImpressions, currentPosition, postStats, dayFortyFiveSnapshot } = pageData;
    
    // If snapshot exists with cardType, use that for stable card display
    if (dayFortyFiveSnapshot?.cardType) {
      return dayFortyFiveSnapshot.cardType === "pivot";
    }
    
    // Fallback to real-time criteria for pages without snapshot:
    // Must have 45+ days
    if (daysSince < 45) return false;
    
    // SUCCESS DETECTION: If page is performing well, don't show Pivot card
    const clicks = postStats?.clicks || 0;
    const impressions = postStats?.impressions || newImpressions || 0;
    const position = currentPosition || 100;
    
    if (isPageSuccessful(position, impressions, clicks)) {
      console.log("✅ Page is successful, hiding pivot options:", pageUrl, `CTR: ${((clicks/impressions)*100).toFixed(1)}% at position ${Math.round(position)}`);
      return false;
    }
    
    // Show pivot options if ANY of the Content Audit criteria are NOT met
    // (but still has 45+ days)
    const meetsContentAuditCriteria = 
      hasZeroClicks && 
      (newImpressions || 0) >= 50 && 
      (currentPosition || 0) >= 15;
    
    return !meetsContentAuditCriteria;
  };

  // Helper function to check if a page should show Success Card
  // Uses snapshot cardType - only shows for pages with healthy CTR at 45+ days
  const isPageEligibleForSuccess = (pageUrl) => {
    const pageData = pageImplementationDates[pageUrl];
    if (!pageData) return false;
    
    const { dayFortyFiveSnapshot, daysSince, postStats, currentPosition } = pageData;
    
    // If snapshot exists with cardType, use that for stable card display
    if (dayFortyFiveSnapshot?.cardType) {
      return dayFortyFiveSnapshot.cardType === "success";
    }
    
    // Fallback to real-time criteria for pages without snapshot:
    if (daysSince < 45) return false;
    
    const clicks = postStats?.clicks || 0;
    const impressions = postStats?.impressions || 0;
    const position = currentPosition || 100;
    
    return isPageSuccessful(position, impressions, clicks);
  };

  const fetchLowCtrPages = async (siteUrl, token) => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - timePeriod);

    const format = (d) => d.toISOString().split("T")[0];
    const from = format(start);
    const to = format(today);

    const res = await fetch(
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
          dimensions: ["query", "page"],
          rowLimit: 250,
        }),
      }
    );

    const json = await res.json();
    if (!json.rows) {
      return;
    }
    setGscKeywordRows(json.rows);
    
    const filteredRows = json.rows.filter(
      (r) =>
        parseFloat((r.ctr * 100).toFixed(1)) <= 2 && r.impressions > 20
    );
    
    const grouped = Object.values(
      filteredRows
        .reduce((acc, row) => {
          const page = row.keys[1];
          if (!acc[page]) {
            acc[page] = {
              page,
              clicks: 0,
              impressions: 0,
              ctr: "0%",
              keywords: new Set(),
            };
          }
          acc[page].clicks += row.clicks;
          acc[page].impressions += row.impressions;
          const query = row.keys?.[0];
          if (query) {
            acc[page].keywords.add(query);
          }
          return acc;
        }, {})
    ).map((item) => ({
      ...item,
      ctr:
        item.impressions > 0
          ? `${((item.clicks / item.impressions) * 100).toFixed(1)}%`
          : "0%",
      keywords: Array.from(item.keywords || []),
    }));

    setLowCtrPages(grouped);

    // Look up saved focus keywords for each page - only include pages with focus keywords
    const pagesWithKeywords = grouped.filter((item) => {
      const normalizedPageUrl = normalizeUrlForComparison(item.page);
      const savedFocusKeyword = focusKeywordByPage.get(normalizedPageUrl) || null;
      
      if (!savedFocusKeyword) {
        console.log(`⏭️ [LOW-CTR fetchLowCtrPages] Skipping meta generation for ${item.page} - no focus keyword selected`);
        return false;
      }
      console.log(`📦 [LOW-CTR fetchLowCtrPages] "${item.page}" -> normalized: "${normalizedPageUrl}" -> keyword: "${savedFocusKeyword}"`);
      return true;
    });

    if (pagesWithKeywords.length > 0) {
      const aiResults = await Promise.all(
        pagesWithKeywords.map((item) => {
          const normalizedPageUrl = normalizeUrlForComparison(item.page);
          const savedFocusKeyword = focusKeywordByPage.get(normalizedPageUrl);
          
          return requestAiMeta({
            pageUrl: item.page,
            focusKeyword: savedFocusKeyword,
          });
        })
      );

      setAiMetaByPage((prev) => {
        const next = { ...prev };
        aiResults.forEach((entry) => {
          next[entry.pageUrl] = entry;
        });
        return next;
      });
    }
    
    setLoading(false);
  };

  const PerformanceDelta = ({ pageUrl }) => {
    const [delta, setDelta] = useState(null);

    useEffect(() => {
      const fetchDelta = async () => {
        const docId = createSafeDocId(user.id, pageUrl);
        const snapshot = await getDoc(doc(db, "implementedSeoTips", docId));
        const data = snapshot.data();
        if (!data?.postStats || !data?.preStats) return;

        const deltaData = {
          impressions: data.postStats.impressions - data.preStats.impressions,
          clicks: data.postStats.clicks - data.preStats.clicks,
          ctr: (data.postStats.ctr - data.preStats.ctr).toFixed(4),
          position: (data.postStats.position - data.preStats.position).toFixed(
            2
          ),
        };

        setDelta(deltaData);
      };

      fetchDelta();
    }, [pageUrl]);

    if (!delta) return null;

    const cleanUrl = pageUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");

    return (
      <li>
        <div className="text-sm">
          <strong>{cleanUrl}</strong>
          <ul className="list-disc ml-6 text-muted-foreground">
            <li>Impressions: {delta.impressions}</li>
            <li>Clicks: {delta.clicks}</li>
            <li>CTR: {delta.ctr}</li>
            <li>Position: {delta.position}</li>
          </ul>
        </div>
      </li>
    );
  };

  if (isLoading || !user) return null;

  if (shouldShowLoader) {
    return (
      <MainLayout>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">Low CTR Fixes</h1>
          <Button onClick={() => router.back()} variant="outline">
            Back to Dashboard
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <SquashBounceLoader size="lg" className="mb-4" />
              <p className="text-muted-foreground">Loading low CTR data...</p>
            </div>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  const suggestionsToRender = suggestionTargets.map((target) => {
    const suggestion = aiMetaByPage[target.key];
    // Normalize URL for consistent lookup against focusKeywordSourceByPage
    const normalizedPageUrl = normalizeUrlForComparison(target.pageUrl);
    const source = focusKeywordSourceByPage.get(normalizedPageUrl) || "gsc-existing";
    return {
      pageUrl: target.pageUrl,
      focusKeyword: target.focusKeyword,
      title: suggestion?.title || "Hang tight—we're crafting a fresh meta title.",
      description:
        suggestion?.description ||
        "Your AI-powered meta description will appear here shortly.",
      source, // "ai-generated" or "gsc-existing"
    };
  });

  return (
    <MainLayout>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Low CTR Fixes</h1>
        <Button onClick={() => router.back()} variant="outline">
          Back to Dashboard
        </Button>
      </div>

      <p className="text-muted-foreground mb-4">
        These pages show up in Google search results but aren&apos;t getting many clicks. 
        This usually means your page titles and descriptions aren&apos;t compelling enough 
        to make people want to click. Try making them more attractive and keyword-focused!
      </p>

      {/* Recovery Banner - Shows when keywords were accidentally wiped */}
      {needsRecovery && (
        <Alert className="mb-6 border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertTitle className="text-red-900 dark:text-red-100">
            Focus Keywords Need Recovery
          </AlertTitle>
          <AlertDescription className="text-red-800 dark:text-red-200">
            <p className="mb-3">
              Your saved snapshot has {snapshotKeywordCount} keywords but only {focusKeywords.length} are currently active. 
              Click below to restore your keywords from the backup.
            </p>
            <Button 
              onClick={handleRecoverKeywords}
              disabled={isRestoring}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isRestoring ? "Restoring..." : `Restore ${snapshotKeywordCount} Keywords Now`}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isGscConnected && !loading && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="text-center py-6">
              <div className="bg-muted inline-flex items-center justify-center w-16 h-16 rounded-full mb-4">
                <Unlink className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-medium mb-2">
                Connect Google Search Console
              </h3>
              <p className="text-muted-foreground text-sm mb-4">
                Connect your Google Search Console account to see low CTR pages and get optimization suggestions.
              </p>
              <Button onClick={requestGSCAuthToken}>Connect GSC</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isGscConnected && (
        <>
      {/* Focus keywords view button - hidden for now
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={viewMode === "focus" ? "default" : "outline"}
            onClick={() => {
              setUserHasToggledView(true);
              setViewMode("focus");
            }}
            disabled={!focusKeywordSet.size}
          >
            Focus keywords view
          </Button>
        </div>
        {!focusKeywordSet.size && focusKeywordsLoaded && (
          <span className="text-xs text-muted-foreground">
            Add focus keywords on the dashboard to unlock the focus view.
          </span>
        )}
      </div>
      */}

      {viewMode === "focus" ? (
        <>
          <Card className="mb-6 border-primary/40 bg-primary/5">
            <CardHeader>
              <CardTitle>Focus keywords with low CTR</CardTitle>
              <CardDescription>
                These focus keywords are showing up in search results but aren&apos;t getting clicks yet. Prioritize their titles and descriptions first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!focusKeywordSet.size ? (
                <p className="text-sm text-muted-foreground">
                  Add focus keywords on the dashboard to see prioritized alerts here.
                </p>
              ) : focusLowCtrPages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Great news—none of your focus keywords are hitting the Low CTR threshold right now.
                </p>
              ) : (
                <ul className="space-y-3">
                  {focusLowCtrPages.map((page, idx) => (
                    <li key={idx} className="rounded-md border border-primary/30 bg-background/80 p-4 shadow-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <AlertTriangle className="text-red-600 h-4 w-4 flex-shrink-0" />
                        <a
                          href={page.page}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#00BF63] underline truncate"
                        >
                          {page.page}
                        </a>
                        <Badge variant="secondary">Focus keyword</Badge>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">
                        {page.impressions} impressions, {page.clicks} clicks ({page.ctr} CTR)
                      </div>
                      <div className="mt-2 text-xs text-muted-foreground flex flex-col gap-1">
                        <span>
                          Primary keyword:&nbsp;
                          <span className="font-medium text-foreground">
                            {page.focusKeyword}
                          </span>
                        </span>
                        {page.additionalKeywords?.length > 0 && (
                          <span>
                            Other low-CTR queries:&nbsp;
                            {page.additionalKeywords.join(", ")}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {focusKeywordsNotShown.length > 0 && (
            <Card className="mb-6 border-dashed border-muted-foreground/30 bg-muted/30">
              <CardHeader>
                <CardTitle>Keep an eye on your focus keywords</CardTitle>
                <CardDescription>
                  These keywords are on your focus list but haven&apos;t triggered Low CTR warnings yet. Optimize their pages to drive more impressions and clicks.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3">
                  {focusKeywordsNotShown.map(({ keyword, data, page }) => (
                    <li
                      key={keyword}
                      className="rounded-md bg-background p-3 shadow-sm border border-muted/40"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{keyword}</span>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          Focus keyword
                        </Badge>
                      </div>
                      {data ? (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          <span>{data.impressions} impressions</span>
                          {typeof data.position === "number" && (
                            <span>Avg. position {data.position}</span>
                          )}
                          {(page || data.page) && (
                            <a
                              href={page || data.page}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#00BF63] underline"
                            >
                              View ranking page
                            </a>
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-muted-foreground">
                          We don&apos;t have enough Search Console data for this keyword yet.
                          {page && (
                            <>
                              {" "}
                              <a
                                href={page}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[#00BF63] underline"
                              >
                                View page
                              </a>
                            </>
                          )}
                        </p>
                      )}
                      <p className="mt-3 text-xs text-muted-foreground">
                        Try updating the page&apos;s title, meta description, and on-page content using the <span className="font-bold">AI-Powered SEO Suggestions</span> section to target this keyword more directly.
                      </p>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card className="mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Raw Low CTR Data</CardTitle>
                <CardDescription>
                  Pages with low click-through rates (2% or less) - these need better titles and descriptions
                </CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    Last {timePeriod} days
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setTimePeriod(7)}>
                    Last 7 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTimePeriod(28)}>
                    Last 28 days
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
          <CardContent>
            {lowCtrPages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No issues found</p>
            ) : (
              <ul className="space-y-2">
                {lowCtrPages.map((page, idx) => {
                  // Find the focus keyword specifically assigned to THIS page URL
                  // This should ALWAYS take priority, regardless of source (AI-generated or GSC-existing)
                  let assignedFocusKeyword = null;
                  const normalizedPageUrl = normalizeUrlForComparison(page.page);
                  
                  for (const [keywordLower, assignedPageUrl] of focusKeywordAssignments.entries()) {
                    if (assignedPageUrl) {
                      const normalizedAssignedUrl = normalizeUrlForComparison(assignedPageUrl);
                      if (normalizedAssignedUrl === normalizedPageUrl) {
                        // Find the original keyword (case-sensitive) from focusKeywords
                        const originalKeyword = focusKeywords.find(k => k.toLowerCase() === keywordLower);
                        if (originalKeyword) {
                          assignedFocusKeyword = originalKeyword;
                          break;
                        }
                      }
                    }
                  }
                  
                  // Only use GSC match as fallback if NO assigned keyword was found
                  // This ensures user-selected keywords (including AI-generated) always take priority
                  const focusMatch = !assignedFocusKeyword 
                    ? page.keywords?.find((keyword) =>
                        focusKeywordSet.has(keyword.toLowerCase())
                      )
                    : null;
                  
                  const primaryKeyword = assignedFocusKeyword || focusMatch || page.keywords?.[0] || null;
                  
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
                        {(assignedFocusKeyword || focusMatch) && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                            Focus keyword
                          </Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground pl-6">
                        {page.impressions} impressions, {page.clicks} clicks ({page.ctr} CTR)
                      </div>
                      {primaryKeyword && (
                        <div className="pl-6 text-xs text-muted-foreground">
                          Keyword: {primaryKeyword}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>AI-Powered SEO Suggestions</CardTitle>
          <CardDescription>
            AI-generated title and meta description suggestions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {suggestionsToRender.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No AI suggestions available yet.
            </p>
          ) : (
            suggestionsToRender.map((meta, idx) => {
              const cleanUrl = meta.pageUrl
                .replace(/^https?:\/\//, "")
                .replace(/\/$/, "");
              const titlePrefix = meta.focusKeyword ? "Focus" : "Fix";
              
              // Get keyword history for this page from either implemented or pivoted data
              const normalizedPageUrl = normalizeUrlForComparison(meta.pageUrl);
              
              // Check implemented pages first
              let pageKeywordHistory = [];
              let pageKeywordStatsHistory = [];
              
              // Look in pageImplementationDates
              const implDataEntry = Object.entries(pageImplementationDates).find(([url]) => 
                normalizeUrlForComparison(url) === normalizedPageUrl
              );
              if (implDataEntry) {
                pageKeywordHistory = implDataEntry[1].keywordHistory || [];
                pageKeywordStatsHistory = implDataEntry[1].keywordStatsHistory || [];
              }
              
              // Also check pivotedPagesData (may have more recent history)
              const pivotDataEntry = Object.entries(pivotedPagesData).find(([url]) => 
                normalizeUrlForComparison(url) === normalizedPageUrl
              );
              if (pivotDataEntry) {
                // Merge keyword history from pivoted data if exists
                const pivotHistory = pivotDataEntry[1].keywordHistory || [];
                const pivotStatsHistory = pivotDataEntry[1].keywordStatsHistory || [];
                
                // Combine, avoiding duplicates
                pivotHistory.forEach(item => {
                  if (!pageKeywordHistory.some(h => h.keyword?.toLowerCase() === item.keyword?.toLowerCase())) {
                    pageKeywordHistory.push(item);
                  }
                });
                pivotStatsHistory.forEach(item => {
                  if (!pageKeywordStatsHistory.some(h => h.keyword?.toLowerCase() === item.keyword?.toLowerCase())) {
                    pageKeywordStatsHistory.push(item);
                  }
                });
              }
              
              return (
                <SeoRecommendationPanel
                  key={idx}
                  title={`${titlePrefix}: ${cleanUrl}`}
                  pageUrl={meta.pageUrl}
                  suggestedTitle={meta.title}
                  suggestedDescription={meta.description}
                  keywordSource={meta.source}
                  focusKeyword={meta.focusKeyword}
                  keywordHistory={pageKeywordHistory}
                  keywordStatsHistory={pageKeywordStatsHistory}
                />
              );
            })
          )}
        </CardContent>
      </Card>

      {/* Content Audit Section */}
      {/* <Card className="mb-6">
        <CardHeader>
          <CardTitle>Content Quality Audit</CardTitle>
          <CardDescription>
            Analyze content quality, readability, and structure to improve SEO performance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {lowCtrPages.map((page, idx) => (
            <ContentAuditPanel
              key={idx}
              pageUrl={page.page}
              pageData={page}
            />
          ))}
        </CardContent>
      </Card> */}


      <div className="mb-6">
        <SeoImpactLeaderboard totalRecommendations={suggestionsToRender.length} />
      </div>


      {implementedPages.length > 0 && (
        <>
          <Alert className="mb-6 border-primary/20 bg-primary/5">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Still No Clicks After 45 Days?</AlertTitle>
            <AlertDescription>
              That&apos;s okay — it&apos;s totally normal. SEO takes time and a bit of trial
              and error. To improve your chances, try these additional tips
              alongside your AI-generated title and description.
            </AlertDescription>
          </Alert>


          {/* Content Quality Audit Card */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Content Quality Audit</CardTitle>
              <CardDescription>
                Pages that have had enough exposure but still aren&apos;t getting clicks may need deeper content improvements beyond meta tags.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {(() => {
                const eligiblePages = lowCtrPages.filter((page) => isPageEligibleForContentAudit(page.page));
                
                if (eligiblePages.length === 0) {
                  return (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground mb-2">
                        No pages are eligible for Content Quality Audit yet.
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Pages become eligible when: 45+ days since implementation, 0 clicks, 50+ new impressions, and ranking on page 2 or beyond.
                      </p>
                    </div>
                  );
                }
                
                return eligiblePages.map((page) => {
                  const implData = pageImplementationDates[page.page];
                  const normalizedPageUrl = normalizeUrlForComparison(page.page);
                  const pageFocusKeyword = focusKeywordByPage.get(normalizedPageUrl) || null;
                  const pageKeywordSource = focusKeywordSourceByPage.get(normalizedPageUrl) || "gsc-existing";
                  
                  return (
                    <div key={page.page} className="mb-4">
                      <div className="text-sm text-muted-foreground mb-2">
                        Implemented {Math.floor(implData?.daysSince || 0)} days ago • 
                        {implData?.newImpressions || 0} new impressions • Position {Math.round(implData?.currentPosition || 0)}
                      </div>
                      <ContentAuditPanel
                        pageUrl={page.page}
                        pageData={page}
                        implementationData={implData}
                        focusKeyword={pageFocusKeyword}
                        keywordSource={pageKeywordSource}
                        snapshot={implData?.dayFortyFiveSnapshot}
                      />
                    </div>
                  );
                });
              })()}
            </CardContent>
          </Card>

        </>
      )}

      {/* Success Card - For pages performing well at 45+ days */}
      {(() => {
        // Find pages eligible for success card
        const successEligiblePages = lowCtrPages.filter((page) => isPageEligibleForSuccess(page.page));
        
        // Also check pageImplementationDates for pages not in lowCtrPages
        Object.entries(pageImplementationDates).forEach(([pageUrl, data]) => {
          if (data.dayFortyFiveSnapshot?.cardType === "success") {
            const alreadyInList = successEligiblePages.some(p => 
              normalizeUrlForComparison(p.page) === normalizeUrlForComparison(pageUrl)
            );
            if (!alreadyInList) {
              successEligiblePages.push({
                page: pageUrl,
                impressions: data.postStats?.impressions || 0,
                clicks: data.postStats?.clicks || 0,
                ctr: "0%",
                keywords: [],
              });
            }
          }
        });
        
        if (successEligiblePages.length === 0) return null;
        
        return (
          <Card className="mb-6 border-emerald-200 dark:border-emerald-800">
            <CardHeader>
              <CardTitle className="text-emerald-700 dark:text-emerald-300">Pages Performing Well</CardTitle>
              <CardDescription>
                These pages are meeting or exceeding expected click-through rates for their positions.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {successEligiblePages.map((page) => {
                const implData = pageImplementationDates[page.page];
                const normalizedPageUrl = normalizeUrlForComparison(page.page);
                const pageFocusKeyword = focusKeywordByPage.get(normalizedPageUrl) || null;
                
                return (
                  <SuccessPanel
                    key={page.page}
                    pageUrl={page.page}
                    focusKeyword={pageFocusKeyword}
                    snapshot={implData?.dayFortyFiveSnapshot}
                    implementationData={implData}
                    preStats={implData?.preStats}
                  />
                );
              })}
            </CardContent>
          </Card>
        );
      })()}

      {/* Pivot Options Card - For pages that reached 45 days but don't meet Content Audit criteria */}
      {/* This is outside the implementedPages condition so it can show independently for testing */}
      {(() => {
        // Start with pages from lowCtrPages that are eligible
        let pivotEligiblePages = lowCtrPages.filter((page) => isPageEligibleForPivotOptions(page.page));
        
        // TEST FLAG: Also check pageImplementationDates for test page
        // This handles pages that aren't in lowCtrPages (low impressions)
        // TODO: Remove after testing
        const testPageUrl = "https://bryandevelops.com/best-website-builders/";
        const testPageInList = pivotEligiblePages.some(p => 
          p.page.toLowerCase().includes("best-website-builders")
        );
        
        // Check if test page is already pivoted - if so, don't force-add it
        const isTestPagePivoted = Object.keys(pivotedPagesData).some(url => 
          url.toLowerCase().includes("best-website-builders")
        );
        
        if (!testPageInList && !isTestPagePivoted) {
          // Check if test page exists in pageImplementationDates AND has 45+ days
          const testPageData = Object.entries(pageImplementationDates).find(([url]) => 
            url.toLowerCase().includes("best-website-builders")
          );
          
          if (testPageData && testPageData[1]?.daysSince >= 45) {
            console.log("🧪 TEST: Adding test page to pivot options from implementationDates (45+ days)");
            pivotEligiblePages = [...pivotEligiblePages, {
              page: testPageData[0],
              impressions: testPageData[1]?.postStats?.impressions || 0,
              clicks: testPageData[1]?.postStats?.clicks || 0,
              ctr: "0%",
              keywords: [],
            }];
          } else {
            // Don't force add test page if it doesn't have 45+ days
            console.log("🧪 TEST: Test page not at 45 days yet, not adding to pivot options. Days:", testPageData?.[1]?.daysSince);
          }
        } else if (isTestPagePivoted) {
          console.log("🔄 TEST: Test page already pivoted, not showing in pivot options");
        }
        
        if (pivotEligiblePages.length === 0) return null;
        
        return (
          <Card className="mb-6 border-amber-200 dark:border-amber-800">
            <CardHeader>
              <CardTitle>Pivot Your Strategy</CardTitle>
              <CardDescription>
                These pages have been tracking for 45+ days but don&apos;t meet Content Audit criteria. 
                Consider waiting for more data or trying a different keyword strategy.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {pivotEligiblePages.map((page) => {
                const implData = pageImplementationDates[page.page];
                const normalizedPageUrl = normalizeUrlForComparison(page.page);
                const pageFocusKeyword = focusKeywordByPage.get(normalizedPageUrl) || null;
                const pageKeywordSource = focusKeywordSourceByPage.get(normalizedPageUrl) || "gsc-existing";
                
                return (
                  <div key={page.page} className="mb-4">
                    <div className="text-sm text-muted-foreground mb-2">
                      Implemented {Math.floor(implData?.daysSince || 0)} days ago • 
                      {implData?.newImpressions || 0} new impressions • Position {Math.round(implData?.currentPosition || 0)}
                    </div>
                    <PivotOptionsPanel
                      pageUrl={page.page}
                      pageData={page}
                      implementationData={implData}
                      focusKeyword={pageFocusKeyword}
                      keywordSource={pageKeywordSource}
                      snapshot={implData?.dayFortyFiveSnapshot}
                    />
                  </div>
                );
              })}
            </CardContent>
          </Card>
        );
      })()}
      </>
      )}

    </MainLayout>
  );
}

"use client";
import { writeSeoRecord } from "../../lib/writeSeoRecord";

import { authenticatedFetch } from "../../lib/authenticatedFetch";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { 
  Clock, 
  Sparkles, 
  History, 
  TrendingUp, 
  AlertCircle, 
  Loader2,
  ChevronDown,
  ChevronRight,
  Check,
  RefreshCw,
  Zap,
  ExternalLink,
  CheckCircle2,
  Lightbulb,
  ArrowRight
} from "lucide-react";
// ChevronUp removed - now using ChevronRight/ChevronDown to match Content Audit Card
import { toast } from "sonner";
import { db } from "../../lib/firebaseConfig";
import { doc, getDoc, deleteField } from "firebase/firestore";
import { useAuth } from "../../contexts/AuthContext";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Search, MousePointerClick, ArrowUp, ArrowDown, Minus } from "lucide-react";

// Helper function to create safe document IDs
const createSafeDocId = (userId, pageUrl) => {
  let hash = 0;
  for (let i = 0; i < pageUrl.length; i++) {
    const char = pageUrl.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  const urlHash = Math.abs(hash).toString(16).padStart(8, '0').substring(0, 8);
  return `${userId}_${urlHash}`;
};

// CTR Benchmark by position (industry averages)
const getExpectedCTR = (position) => {
  if (position <= 1) return 0.28;  // 28%
  if (position <= 2) return 0.15;  // 15%
  if (position <= 3) return 0.10;  // 10%
  if (position <= 4) return 0.07;  // 7%
  if (position <= 5) return 0.05;  // 5%
  if (position <= 10) return 0.025; // 2.5%
  if (position <= 15) return 0.01;  // 1% (top of page 2)
  return 0.005; // 0.5% for position 16+
};

// Check if page is performing well (Success Detection)
const isPageSuccessful = (position, impressions, clicks) => {
  // Need minimum data to evaluate
  if (impressions < 20) return false;
  
  const actualCTR = impressions > 0 ? clicks / impressions : 0;
  const expectedCTR = getExpectedCTR(position);
  
  // Success if CTR >= 100% of expected
  return actualCTR >= expectedCTR;
};

// Check for low impressions (possible indexing issue) - Now with position context for B1/B2
const getLowImpressionsGuidance = (impressions, daysSince, position) => {
  if (impressions >= 50) return null;
  
  // B1: Very low impressions (0-19)
  if (impressions < 20) {
    // B1 with position 40+: Deep position + very low visibility = strong pivot signal
    if (position >= 40) {
      return {
        type: "pivot-recommended",
        severity: "warning",
        message: `Very low visibility (only ${impressions} impressions) at a deep position (${Math.round(position)}). This keyword may be too competitive.`,
        action: "Consider pivoting to a less competitive keyword. Your page is indexed but buried too deep to gain traction.",
        icon: "🎯"
      };
    }
    // B1 with position <40: Could be indexing issue
    return {
      type: "indexing-check",
      severity: "warning",
      message: `Very low visibility (only ${impressions} impressions in ${daysSince || 45}+ days). Your page may not be properly indexed in Google.`,
      action: "Check if your page is indexed in Google Search Console. If not, request indexing.",
      icon: "🔍"
    };
  }
  
  // B2: Low impressions (20-49)
  // B2 with position 40+: Deep position + minimal visibility = consider pivot
  if (position >= 40) {
    return {
      type: "pivot-recommended",
      severity: "info",
      message: `Minimal visibility (${impressions} impressions) despite being tracked for ${daysSince || 45}+ days, and your page is at position ${Math.round(position)}.`,
      action: "This keyword may be too competitive for your current domain authority. Consider pivoting to a less competitive, longer-tail keyword.",
      icon: "🎯"
    };
  }
  
  // B2 with position <40: Just needs more time
  return {
    type: "wait-for-data",
    severity: "info",
    message: `Only ${impressions} impressions so far. This isn't enough data to evaluate CTR performance accurately.`,
    action: "Wait for more impressions before making changes. SEO takes time!",
    icon: "⏳"
  };
};

// Check if page meets CTR Benchmark fail criteria (EXPANDED: positions 1-15)
const checkCtrBenchmarkFail = (position, impressions, clicks) => {
  // EXPANDED: Check positions 1-15 (was 1-5)
  if (position > 15) return null;
  if (impressions < 50) return null; // Need enough impressions to judge
  
  const expectedCTR = getExpectedCTR(position);
  const expectedClicks = Math.round(impressions * expectedCTR);
  const actualCTR = impressions > 0 ? clicks / impressions : 0;
  
  // CRITICAL: 0 clicks when expecting at least 1
  if (clicks === 0 && expectedClicks >= 1) {
    return {
      isFail: true,
      severity: "critical",
      position: Math.round(position),
      impressions,
      expectedClicks: Math.max(1, expectedClicks),
      actualClicks: clicks,
      expectedCTR: (expectedCTR * 100).toFixed(1),
      actualCTR: (actualCTR * 100).toFixed(2)
    };
  }
  
  // UNDERPERFORMING: Has some clicks but CTR < 50% of expected (NEW)
  if (clicks > 0 && actualCTR < expectedCTR * 0.5 && expectedClicks >= 2) {
    return {
      isFail: true,
      severity: "underperforming",
      position: Math.round(position),
      impressions,
      expectedClicks,
      actualClicks: clicks,
      expectedCTR: (expectedCTR * 100).toFixed(1),
      actualCTR: (actualCTR * 100).toFixed(2)
    };
  }
  
  // POOR: CTR < 20% of expected (severe underperformance)
  if (actualCTR < expectedCTR * 0.2 && expectedClicks >= 2) {
    return {
      isFail: true,
      severity: "poor",
      position: Math.round(position),
      impressions,
      expectedClicks,
      actualClicks: clicks,
      expectedCTR: (expectedCTR * 100).toFixed(1),
      actualCTR: (actualCTR * 100).toFixed(2)
    };
  }
  
  return null;
};

const PivotOptionsPanel = ({
  pageUrl,
  pageData,
  implementationData,
  focusKeyword = "",
  keywordSource = "gsc-existing",
  snapshot,
}) => {
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(true);
  const [showKeywordSelection, setShowKeywordSelection] = useState(false);
  const [hybridKeywords, setHybridKeywords] = useState([]);
  const [loadingHybridKeywords, setLoadingHybridKeywords] = useState(false);
  const [currentRankingKeywords, setCurrentRankingKeywords] = useState([]);
  const [loadingRankingKeywords, setLoadingRankingKeywords] = useState(false);
  const [keywordHistory, setKeywordHistory] = useState([]);
  const [waitAnotherCycle, setWaitAnotherCycle] = useState(false);
  const [extendedDeadline, setExtendedDeadline] = useState(null);
  const [selectedKeyword, setSelectedKeyword] = useState(null); // Successfully saved keyword
  const [pendingKeyword, setPendingKeyword] = useState(null); // Keyword selected but not yet saved
  const [pendingKeywordSource, setPendingKeywordSource] = useState(null); // Source of pending keyword
  const [isSaving, setIsSaving] = useState(false);
  const [isOptimizingMeta, setIsOptimizingMeta] = useState(false); // For "Optimize Meta Only" action
  
  // Optimize Meta Only - 2-step flow state (matching E1 Content Audit behavior)
  const [optimizeMetaNewTitle, setOptimizeMetaNewTitle] = useState(null);
  const [optimizeMetaNewDescription, setOptimizeMetaNewDescription] = useState(null);
  const [showOptimizeMetaSuggestions, setShowOptimizeMetaSuggestions] = useState(false);
  const [isMarkingOptimizeMetaImplemented, setIsMarkingOptimizeMetaImplemented] = useState(false);
  const [showOptimizeMetaConfirmModal, setShowOptimizeMetaConfirmModal] = useState(false);
  
  // Pivot to New Keyword - 2-step flow state (matching Content Audit E3 behavior)
  const [showPivotMetaSuggestions, setShowPivotMetaSuggestions] = useState(false);
  const [pivotNewMetaTitle, setPivotNewMetaTitle] = useState(null);
  const [pivotNewMetaDescription, setPivotNewMetaDescription] = useState(null);
  const [pivotNewKeyword, setPivotNewKeyword] = useState(null);
  const [pivotNewKeywordSource, setPivotNewKeywordSource] = useState(null);
  const [pivotOldKeyword, setPivotOldKeyword] = useState(null);
  const [isMarkingPivotImplemented, setIsMarkingPivotImplemented] = useState(false);
  const [showPivotConfirmModal, setShowPivotConfirmModal] = useState(false);
  
  const contentRef = useRef(null);
  const [contentMaxHeight, setContentMaxHeight] = useState("0px");
  
  // Keyword Insights Modal state
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [keywordInsightsData, setKeywordInsightsData] = useState(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(false);
  
  // Keyword Comparison state - for smart recommendations (similar to E3 in Content Audit)
  const [keywordComparisonData, setKeywordComparisonData] = useState(null);
  const [keywordComparisonLoaded, setKeywordComparisonLoaded] = useState(false);
  const [isLoadingKeywordComparison, setIsLoadingKeywordComparison] = useState(false);
  
  // Wait Extension Confirmation Modal state
  const [showWaitConfirmModal, setShowWaitConfirmModal] = useState(false);

  // Get current metrics for checks
  const currentPosition = implementationData?.currentPosition || 100;
  const currentImpressions = implementationData?.postStats?.impressions || implementationData?.newImpressions || 0;
  const currentClicks = implementationData?.postStats?.clicks || 0;
  const daysSinceImpl = implementationData?.daysSince || 45;

  // Check if page is performing well (Success Detection)
  const pageIsSuccessful = implementationData ? isPageSuccessful(
    currentPosition,
    currentImpressions,
    currentClicks
  ) : false;

  // Check for low impressions guidance (now with position context for B1/B2)
  const lowImpressionsGuidance = implementationData ? getLowImpressionsGuidance(
    currentImpressions,
    daysSinceImpl,
    currentPosition
  ) : null;

  // Check CTR Benchmark fail (only if not successful and has enough impressions)
  const ctrBenchmarkFail = (implementationData && !pageIsSuccessful && !lowImpressionsGuidance) 
    ? checkCtrBenchmarkFail(currentPosition, currentImpressions, currentClicks) 
    : null;

  // Calculate reasons why Content Audit isn't available
  const pivotReasons = [];
  if (implementationData) {
    const { newImpressions, currentPosition, hasZeroClicks } = implementationData;
    
    if (!hasZeroClicks) {
      pivotReasons.push("You have clicks! That's a good sign.");
    }
    if ((newImpressions || 0) < 50) {
      pivotReasons.push(`Only ${newImpressions || 0} new impressions (need 50+)`);
    }
    if ((currentPosition || 0) < 15 && (currentPosition || 0) > 0) {
      pivotReasons.push(`Position ${Math.round(currentPosition || 0)} is on page 1 (need page 2+)`);
    }
  }
  if (pivotReasons.length === 0) {
    pivotReasons.push("Page is performing differently than expected");
  }

  // Calculate recommendation: Wait vs Pivot vs Optimize Meta
  // This provides clear guidance based on deeper metric analysis
  const getRecommendation = () => {
    if (!implementationData) {
      return { action: "wait", confidence: "low", reason: "Not enough data to make a recommendation." };
    }

    const { newImpressions, hasZeroClicks, postStats } = implementationData;
    const clicks = postStats?.clicks || 0;
    const impressions = postStats?.impressions || newImpressions || 0;
    const position = currentPosition || 100;
    const keywordsTried = keywordHistory.length;

    // SUCCESS DETECTION - Page is performing well!
    if (pageIsSuccessful) {
      const actualCTR = impressions > 0 ? ((clicks / impressions) * 100).toFixed(1) : 0;
      const expectedCTR = (getExpectedCTR(position) * 100).toFixed(1);
      return {
        action: "success",
        confidence: "high",
        reason: `Your page is performing well! CTR of ${actualCTR}% meets or exceeds the expected ${expectedCTR}% for position ${Math.round(position)}. No changes needed - keep monitoring!`,
        icon: ""
      };
    }

    // LOW IMPRESSIONS - Now with position-aware recommendations (B1/B2)
    if (lowImpressionsGuidance) {
      // Determine action based on guidance type
      let action = "wait";
      let confidence = "medium";
      
      if (lowImpressionsGuidance.type === "indexing-check") {
        action = "check-indexing";
        confidence = "high";
      } else if (lowImpressionsGuidance.type === "pivot-recommended") {
        action = "pivot";
        confidence = "high";
      }
      
      return {
        action,
        confidence,
        reason: `${lowImpressionsGuidance.icon} ${lowImpressionsGuidance.message} ${lowImpressionsGuidance.action}`,
        icon: lowImpressionsGuidance.icon
      };
    }

    // CTR BENCHMARK FAIL - Position 1-15 with CTR issues
    if (ctrBenchmarkFail) {
      const pageNum = Math.ceil(ctrBenchmarkFail.position / 10);
      const positionDesc = ctrBenchmarkFail.position <= 10 ? "page 1" : `top of page ${pageNum}`;
      
      // Different messaging based on severity
      if (ctrBenchmarkFail.severity === "critical") {
        return {
          action: "optimize-meta",
          confidence: "high",
          reason: `Critical CTR Fail: You're in position ${ctrBenchmarkFail.position} (${positionDesc}) with ${ctrBenchmarkFail.impressions} impressions but 0 clicks. You should have ~${ctrBenchmarkFail.expectedClicks} click${ctrBenchmarkFail.expectedClicks > 1 ? 's' : ''} at this position! Your keyword IS working - Google sees your content as relevant. The problem is your Meta Title isn't compelling enough. Don't change your keyword - just rewrite your Meta Title and Description!`,
          icon: ""
        };
      }
      
      if (ctrBenchmarkFail.severity === "underperforming") {
        return {
          action: "optimize-meta",
          confidence: "high",
          reason: `Underperforming CTR: You're getting some clicks (${ctrBenchmarkFail.actualClicks}) at position ${ctrBenchmarkFail.position}, but your CTR of ${ctrBenchmarkFail.actualCTR}% is below the expected ${ctrBenchmarkFail.expectedCTR}% for this position. Your keyword is working, but your Meta Title could be more compelling. Try refreshing your Meta Title and Description!`,
          icon: ""
        };
      }
      
      // Poor severity
      return {
        action: "optimize-meta",
        confidence: "high",
        reason: `Poor CTR Performance: At position ${ctrBenchmarkFail.position} with ${ctrBenchmarkFail.impressions} impressions, you should be getting more clicks. Your current CTR of ${ctrBenchmarkFail.actualCTR}% is well below the expected ${ctrBenchmarkFail.expectedCTR}%. Consider optimizing your Meta Title and Description.`,
        icon: ""
      };
    }

    // IMPRESSION VELOCITY - "Rising Star" Signal
    // Check if impressions are growing significantly month-over-month
    if (implementationData.preStats && impressions > 0) {
      const baselineImpressions = implementationData.preStats.impressions || 1;
      const growthPercent = ((impressions - baselineImpressions) / baselineImpressions) * 100;
      
      // If impressions grew by 100%+ (doubled or more), it's a rising star
      if (growthPercent >= 100 && clicks === 0) {
        return {
          action: "wait",
          confidence: "high",
          reason: `Rising Star! Your visibility has grown by ${Math.round(growthPercent)}% since implementation (${baselineImpressions} → ${impressions} impressions). Google is starting to trust this page—give it 45 more days to stabilize before making changes.`,
          icon: ""
        };
      }
      
      // Even 50%+ growth is a good sign worth noting
      if (growthPercent >= 50 && clicks === 0 && position > 15) {
        return {
          action: "wait",
          confidence: "medium",
          reason: `Momentum Building! Impressions grew ${Math.round(growthPercent)}% since implementation (${baselineImpressions} → ${impressions}). Google is noticing this page—wait for the trend to continue.`,
          icon: ""
        };
      }
    }

    // Strong indicators to WAIT (only if not caught by CTR benchmark)
    if (clicks > 0 && !ctrBenchmarkFail) {
      return {
        action: "wait",
        confidence: "high",
        reason: `You're getting clicks (${clicks})! Your CTR optimizations are working. Give it more time to build momentum.`,
        icon: ""
      };
    }

    // Only suggest waiting for top position if NOT a CTR benchmark fail
    if (position < 10 && !ctrBenchmarkFail) {
      return {
        action: "wait",
        confidence: "high", 
        reason: `You're ranking in position ${Math.round(position)} (top of page 1)! You're very close to breakthrough. Keep your current strategy.`,
        icon: ""
      };
    }

    if (impressions < 30) {
      return {
        action: "wait",
        confidence: "medium",
        reason: `Only ${impressions} impressions so far. Google hasn't shown your page enough yet to judge performance. Wait for more exposure.`,
        icon: ""
      };
    }

    if (position >= 10 && position < 20) {
      return {
        action: "wait",
        confidence: "medium",
        reason: `Position ${Math.round(position)} is on the edge of page 1. A small content tweak might push you over. Consider waiting.`,
        icon: ""
      };
    }

    // KEYWORD COMPARISON DATA - Use for smarter pivot recommendations
    const isFocusKeywordBest = keywordComparisonData?.isFocusKeywordBest;
    const bestAlternative = keywordComparisonData?.bestAlternative;
    const focusPosition = keywordComparisonData?.focusKeywordData?.position;
    const bestPosition = bestAlternative?.position;

    // Strong indicators to PIVOT - Now with keyword comparison intelligence
    if (position >= 40 && impressions >= 50 && clicks === 0) {
      // Check if there's a better keyword to suggest
      if (isFocusKeywordBest) {
        return {
          action: "optimize-meta",
          confidence: "medium",
          reason: `Position ${Math.round(position)} with ${impressions} impressions but 0 clicks. However, your focus keyword "${focusKeyword}" is already your best performer. Consider optimizing your meta title/description instead of pivoting.`,
          icon: "",
          keywordInsight: `Your focus keyword is outperforming ${keywordComparisonData?.allKeywordsCount - 1 || 0} other keywords for this page.`
        };
      } else if (bestAlternative) {
        return {
          action: "pivot",
          confidence: "high",
          reason: `Position ${Math.round(position)} with ${impressions} impressions but 0 clicks. We found a better keyword! "${bestAlternative.keyword}" is ranking at position ${bestPosition?.toFixed(1)} — consider pivoting to capitalize on this.`,
          icon: "",
          keywordInsight: `"${bestAlternative.keyword}" is ranking ${(focusPosition - bestPosition)?.toFixed(1) || "better"} positions higher than your focus keyword.`,
          suggestedPivotKeyword: bestAlternative.keyword
        };
      }
      return {
        action: "pivot",
        confidence: "high",
        reason: `Position ${Math.round(position)} with ${impressions} impressions but 0 clicks suggests Google isn't connecting this keyword to your content. Try a different keyword.`,
        icon: ""
      };
    }

    if (keywordsTried >= 2) {
      return {
        action: "pivot",
        confidence: "high",
        reason: `You've already tried ${keywordsTried} keywords. Consider using AI-generated hybrid keywords to find a fresh angle.`,
        icon: ""
      };
    }

    if (position >= 30 && impressions >= 100 && clicks === 0) {
      // Check for better alternative keyword
      if (isFocusKeywordBest) {
        return {
          action: "optimize-meta",
          confidence: "medium",
          reason: `High impressions (${impressions}) but no clicks at position ${Math.round(position)}. Your focus keyword "${focusKeyword}" is your strongest — try optimizing your meta title instead of pivoting.`,
          icon: "",
          keywordInsight: `Your focus keyword is already your best performer.`
        };
      } else if (bestAlternative) {
        return {
          action: "pivot",
          confidence: "high",
          reason: `High impressions (${impressions}) but no clicks at position ${Math.round(position)}. We noticed "${bestAlternative.keyword}" (Position ${bestPosition?.toFixed(1)}) is outperforming your focus keyword. Consider pivoting!`,
          icon: "",
          keywordInsight: `"${bestAlternative.keyword}" is ranking better than "${focusKeyword}".`,
          suggestedPivotKeyword: bestAlternative.keyword
        };
      }
      return {
        action: "pivot",
        confidence: "medium",
        reason: `High impressions (${impressions}) but no clicks at position ${Math.round(position)} indicates a keyword-content mismatch. A new keyword might help.`,
        icon: ""
      };
    }

    // Moderate case - could go either way - Now with keyword insight
    if (position >= 20 && position < 40) {
      if (bestAlternative) {
        return {
          action: "pivot",
          confidence: "medium",
          reason: `Position ${Math.round(position)} with ${impressions} impressions is in the "watch zone". We noticed "${bestAlternative.keyword}" (Position ${bestPosition?.toFixed(1)}) is ranking higher than your focus keyword. Consider pivoting to that keyword.`,
          icon: "",
          keywordInsight: `"${bestAlternative.keyword}" might be a better fit for this page.`,
          suggestedPivotKeyword: bestAlternative.keyword
        };
      } else if (isFocusKeywordBest) {
        return {
          action: "wait",
          confidence: "medium",
          reason: `Position ${Math.round(position)} with ${impressions} impressions is in the "watch zone". Your focus keyword "${focusKeyword}" is your best performer — give it more time to climb.`,
          icon: "",
          keywordInsight: `Your focus keyword is already outperforming other keywords.`
        };
      }
      return {
        action: "either",
        confidence: "low",
        reason: `Position ${Math.round(position)} with ${impressions} impressions is in the "watch zone". You could wait for more data or try a new keyword - both are reasonable choices.`,
        icon: ""
      };
    }

    // Default fallback - with keyword insight if available
    if (bestAlternative) {
      return {
        action: "pivot",
        confidence: "low",
        reason: `Your metrics are mixed. We noticed "${bestAlternative.keyword}" (Position ${bestPosition?.toFixed(1)}) might be a better keyword fit for this page.`,
        icon: "",
        keywordInsight: `Consider pivoting to "${bestAlternative.keyword}".`,
        suggestedPivotKeyword: bestAlternative.keyword
      };
    }
    
    return {
      action: "either",
      confidence: "low",
      reason: "Your metrics are mixed. Consider your content quality and whether the current keyword truly matches your page's topic.",
      icon: ""
    };
  };

  const recommendation = getRecommendation();

  // Load saved data (keyword history, extended deadline)
  useEffect(() => {
    const loadSavedData = async () => {
      if (!user?.id || !pageUrl) return;

      try {
        const docId = createSafeDocId(user.id, pageUrl);
        const snapshot = await getDoc(doc(db, "implementedSeoTips", docId));
        const data = snapshot.data();

        if (data?.keywordHistory) {
          setKeywordHistory(data.keywordHistory);
        }
        if (data?.extendedDeadline) {
          setExtendedDeadline(new Date(data.extendedDeadline));
          setWaitAnotherCycle(true);
        }
      } catch (error) {
        console.error("Error loading pivot data:", error);
      }
    };

    loadSavedData();
  }, [user?.id, pageUrl]);

  // Fetch keyword comparison data on mount for smart recommendations
  useEffect(() => {
    if (user?.id && pageUrl && focusKeyword && !keywordComparisonLoaded) {
      fetchKeywordComparison();
    }
  }, [user?.id, pageUrl, focusKeyword, keywordComparisonLoaded]);

  // Fetch current ranking keywords when keyword selection is opened
  const fetchRankingKeywords = async () => {
    if (!user?.id || !pageUrl) return;

    setLoadingRankingKeywords(true);
    try {
      const { createGSCTokenManager } = await import("../../lib/gscTokenManager");
      const tokenManager = createGSCTokenManager(user.id);
      const gscData = await tokenManager.getStoredGSCData();
      
      if (!gscData?.siteUrl) {
        setLoadingRankingKeywords(false);
        return;
      }
      
      const validToken = await tokenManager.getValidAccessToken();
      if (!validToken) {
        setLoadingRankingKeywords(false);
        return;
      }

      const response = await authenticatedFetch("/api/gsc/page-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: validToken,
          siteUrl: gscData.siteUrl,
          pageUrl,
          dateRange: "28",
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const allKeywords = [
          ...(data.keywords?.topPerformers || []),
          ...(data.keywords?.otherKeywords || []),
        ].sort((a, b) => (b.impressions || 0) - (a.impressions || 0));
        setCurrentRankingKeywords(allKeywords);
      }
    } catch (error) {
      console.error("Error fetching ranking keywords:", error);
    } finally {
      setLoadingRankingKeywords(false);
    }
  };

  // Handle opening keyword selection
  const handleOpenKeywordSelection = () => {
    setShowKeywordSelection(true);
    // Fetch keywords when opening the selection
    if (currentRankingKeywords.length === 0) {
      fetchRankingKeywords();
    }
  };

  // Handle generating hybrid keywords
  const handleGenerateHybridKeywords = async () => {
    if (!user?.id || !pageUrl) return;

    setLoadingHybridKeywords(true);
    try {
      const topRankingKeyword = currentRankingKeywords.length > 0 
        ? currentRankingKeywords[0].keyword 
        : null;

      const response = await authenticatedFetch("/api/seo-assistant/suggest-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageUrl,
          userId: user.id,
          hybridMode: true,
          currentRankingKeyword: topRankingKeyword,
          currentFocusKeyword: focusKeyword,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.suggestions?.length > 0) {
          const enhancedSuggestions = data.suggestions.map(suggestion => ({
            ...(typeof suggestion === "string" ? { keyword: suggestion } : suggestion),
            hybridSource: topRankingKeyword,
            isHybrid: true,
          }));
          setHybridKeywords(enhancedSuggestions);
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.error || "Failed to generate hybrid keywords");
      }
    } catch (error) {
      console.error("Error generating hybrid keywords:", error);
      toast.error("Failed to generate hybrid keywords. Please try again.");
    } finally {
      setLoadingHybridKeywords(false);
    }
  };

  // Handle selecting a keyword (just marks it as pending, doesn't save yet)
  const handleSelectKeyword = (keyword, source = "gsc-existing") => {
    setPendingKeyword(keyword);
    setPendingKeywordSource(source);
  };

  // Handle saving the pending keyword - Now generates AI meta suggestions (2-step flow matching Content Audit E3)
  // The actual pivot/reset happens when user clicks "I've Updated This On My Site" after reviewing new metas
  const handleSavePendingKeyword = async () => {
    if (!user?.id || !pageUrl || !pendingKeyword) return;

    setIsSaving(true);
    
    try {
      // Re-crawl the page to get fresh content for new AI suggestions
      toast.info("Generating new meta suggestions for your new keyword...");
      try {
        const recrawlRes = await authenticatedFetch("/api/recrawl-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            pageUrl,
          }),
        });
        
        if (recrawlRes.ok) {
          console.log("✅ Page re-crawled for pivot");
        }
      } catch (recrawlError) {
        console.warn("⚠️ Could not re-crawl page:", recrawlError);
      }

      // Fetch previous meta optimization attempts for AI learning
      let previousAttempts = [];
      try {
        const docId = createSafeDocId(user.id, pageUrl);
        const currentDoc = await getDoc(doc(db, "implementedSeoTips", docId));
        if (currentDoc.exists()) {
          const data = currentDoc.data();
          previousAttempts = data.metaOptimizationHistory || [];
        }
      } catch (historyError) {
        console.warn("Could not fetch meta history:", historyError);
      }

      // Build the payload for AI meta generation - using the NEW keyword
      const payload = {
        pageUrl,
        userId: user.id,
        context: {
          source: "pivot-card-keyword-change",
        },
        focusKeywords: [pendingKeyword], // Use the NEW keyword for meta generation
      };

      // If we have previous attempts, include them for AI learning (with full stats)
      if (previousAttempts.length > 0) {
        payload.previousAttempts = previousAttempts.slice(-3).map(attempt => ({
          title: attempt.title,
          description: attempt.description,
          outcome: attempt.outcome || "unknown",
          // Include full stats for smarter AI recommendations
          preStats: attempt.preStats || null,
          postStats: attempt.postStats || attempt.finalStats || null,
          daysTracked: attempt.daysTracked || 0,
          keyword: attempt.keyword || attempt.previousKeyword || null,
          type: attempt.type || "meta-optimization",
        }));
        console.log(`🧠 Passing ${payload.previousAttempts.length} previous attempt(s) with full stats to AI`);
      }

      // Generate new AI metas
      const [titleRes, descRes] = await Promise.all([
        authenticatedFetch("/api/seo-assistant/meta-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, _nocache: Date.now() }),
        }),
        authenticatedFetch("/api/seo-assistant/meta-description", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, _nocache: Date.now() }),
        }),
      ]);

      const [titleData, descData] = await Promise.all([titleRes.json(), descRes.json()]);

      if (titleData.title && descData.description) {
        // Store the new suggestions and keyword info in state
        setPivotNewMetaTitle(titleData.title);
        setPivotNewMetaDescription(descData.description);
        setPivotNewKeyword(pendingKeyword);
        setPivotNewKeywordSource(pendingKeywordSource === "hybrid" ? "ai-generated" : pendingKeywordSource);
        setPivotOldKeyword(focusKeyword);
        setShowPivotMetaSuggestions(true);
        setShowKeywordSelection(false);
        
        toast.success("New meta suggestions ready! Review them below.", {
          duration: 3000
        });
      } else {
        throw new Error("Failed to generate meta suggestions");
      }
    } catch (error) {
      console.error("Error generating pivot meta suggestions:", error);
      toast.error("Failed to generate meta suggestions. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  // Handle canceling the pending selection
  const handleCancelPendingKeyword = () => {
    setPendingKeyword(null);
    setPendingKeywordSource(null);
  };

  // Handle canceling the pivot meta suggestions
  const handleCancelPivotSuggestions = () => {
    setShowPivotMetaSuggestions(false);
    setPivotNewMetaTitle(null);
    setPivotNewMetaDescription(null);
    setPivotNewKeyword(null);
    setPivotNewKeywordSource(null);
    setPivotOldKeyword(null);
    setPendingKeyword(null);
    setPendingKeywordSource(null);
  };

  // Handle marking pivot as implemented - Called when user clicks "I've Updated This On My Site"
  // This performs the actual tracking reset after user confirms they've updated their metas
  const handleMarkPivotImplemented = async () => {
    if (!user?.id || !pageUrl || !pivotNewKeyword) return;
    
    setIsMarkingPivotImplemented(true);
    
    try {
      const docId = createSafeDocId(user.id, pageUrl);
      
      // First, fetch the current document to preserve old stats
      const currentDoc = await getDoc(doc(db, "implementedSeoTips", docId));
      const currentData = currentDoc.exists() ? currentDoc.data() : {};
      
      // Add current focus keyword to history
      const updatedHistory = [...keywordHistory];
      if (focusKeyword && !updatedHistory.some(h => h.keyword.toLowerCase() === focusKeyword.toLowerCase())) {
        updatedHistory.push({
          keyword: focusKeyword,
          testedAt: new Date().toISOString(),
          source: keywordSource,
        });
      }
      
      // Build the keyword stats history - preserve metrics from previous keyword attempts
      const keywordStatsHistory = currentData.keywordStatsHistory || [];
      
      // If we have stats from the current keyword, save them to history before resetting
      if (currentData.preStats && currentData.implementedAt) {
        keywordStatsHistory.push({
          keyword: focusKeyword,
          source: keywordSource,
          implementedAt: currentData.implementedAt,
          pivotedAt: new Date().toISOString(),
          preStats: currentData.preStats,
          postStats: currentData.postStats || null,
          postStatsHistory: currentData.postStatsHistory || [],
          daysTracked: currentData.implementedAt 
            ? Math.floor((Date.now() - new Date(currentData.implementedAt).getTime()) / (1000 * 60 * 60 * 24))
            : 0,
          pivotSource: "pivot-card-keyword-change",
        });
      }
      
      // Save the new metas to metaOptimizationHistory for future AI learning (with full stats)
      const metaOptimizationHistory = currentData.metaOptimizationHistory || [];
      metaOptimizationHistory.push({
        title: pivotNewMetaTitle,
        description: pivotNewMetaDescription,
        generatedAt: new Date().toISOString(),
        type: "pivot-keyword-change", // Track this as a keyword pivot
        previousKeyword: pivotOldKeyword,
        newKeyword: pivotNewKeyword,
        // Include full stats for AI learning on next iteration
        keyword: pivotOldKeyword,
        implementedAt: currentData.implementedAt,
        preStats: currentData.preStats || null,
        finalStats: currentData.postStats || null,
        postStatsHistory: currentData.postStatsHistory || [],
        daysTracked: currentData.implementedAt 
          ? Math.floor((Date.now() - new Date(currentData.implementedAt).getTime()) / (1000 * 60 * 60 * 24))
          : 0,
        optimizationSource: "pivot-card-keyword-change",
      });

      // Get current stats for preStats baseline (for the NEW keyword tracking)
      // This captures the current metrics as the starting point for the new 45-day cycle
      const currentPosition = currentData.postStats?.position || currentData.preStats?.position || 0;
      const currentImpressions = currentData.postStats?.impressions || currentData.preStats?.impressions || 0;
      const currentClicks = currentData.postStats?.clicks || currentData.preStats?.clicks || 0;
      const currentCtr = currentData.postStats?.ctr || currentData.preStats?.ctr || 0;
      
      const newPreStats = {
        position: currentPosition,
        impressions: currentImpressions,
        clicks: currentClicks,
        ctr: currentCtr,
      };

      // RESET tracking - Set new implementedAt and preStats (matching Content Audit E3 flow)
      // This keeps the page "implemented" but resets the progress to Day 0
      await writeSeoRecord(
        doc(db, "implementedSeoTips", docId),
        {
          keywordHistory: updatedHistory,
          keywordStatsHistory: keywordStatsHistory,
          metaOptimizationHistory: metaOptimizationHistory,
          pivotedAt: new Date().toISOString(),
          // Set status to "implemented" so it stays in AI-Powered SEO Suggestions with reset progress
          status: "implemented",
          implementationType: "pivot-keyword-change", // Identifies this as a pivot for tracking label
          // Set new tracking dates - Day 0 starts NOW
          implementedAt: new Date().toISOString(),
          nextUpdateDue: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          // Set baseline stats for the NEW keyword
          preStats: newPreStats,
          // Clear old post stats (will be populated by cron job after 7 days)
          postStats: deleteField(),
          postStatsHistory: deleteField(),
          // Clear 45-day snapshot since we're starting fresh
          dayFortyFiveSnapshot: deleteField(),
          allowReImplementation: false,  // Reset flag - starting new cycle
          // Update keywords
          currentKeyword: pivotNewKeyword,
          pivotedToKeyword: pivotNewKeyword,
          pivotedFromKeyword: pivotOldKeyword,
          // Store the implemented meta title/description
          implementedMetaTitle: pivotNewMetaTitle,
          implementedMetaDescription: pivotNewMetaDescription,
        },
        { merge: true }
      );

      // Update focus keywords - fetch existing and update
      const existingResponse = await authenticatedFetch(`/api/focus-keywords?userId=${user.id}`);
      let existingKeywords = [];
      
      if (existingResponse.ok) {
        const existingData = await existingResponse.json();
        existingKeywords = existingData.keywords || [];
      }

      // Normalize URL for comparison
      const normalizeUrl = (url) => {
        if (!url) return "";
        try {
          const u = new URL(url);
          return (u.pathname === '/' ? u.origin : u.origin + u.pathname.replace(/\/$/, '')).toLowerCase();
        } catch {
          return url.trim().replace(/\/$/, '').toLowerCase();
        }
      };

      const normalizedPageUrl = normalizeUrl(pageUrl);
      const filteredKeywords = existingKeywords.filter(kw => {
        const kwPageUrl = normalizeUrl(kw.pageUrl);
        return kwPageUrl !== normalizedPageUrl;
      });

      const updatedKeywords = [
        ...filteredKeywords,
        {
          keyword: pivotNewKeyword,
          pageUrl,
          source: pivotNewKeywordSource,
        }
      ];

      await authenticatedFetch("/api/focus-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          keywords: updatedKeywords,
        }),
      });

      // Update meta cache with new metas
      try {
        await authenticatedFetch("/api/pages/update-cache", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            pageUrl,
            updates: {
              metaTitle: pivotNewMetaTitle,
              metaDescription: pivotNewMetaDescription,
            },
          }),
        });
      } catch (cacheError) {
        console.warn("Failed to update meta cache:", cacheError);
      }

      // Log AI training event
      try {
        await authenticatedFetch("/api/training/log-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            event_type: "meta_recommendation",
            status: "implemented",
            metadata: {
              newTitle: pivotNewMetaTitle,
              newDescription: pivotNewMetaDescription,
              source: "pivot-card-keyword-change",
              previousKeyword: pivotOldKeyword,
              newKeyword: pivotNewKeyword,
              pageUrl,
              userId: user.id,
            },
          }),
        });
      } catch (logError) {
        console.warn("Failed to log training event:", logError);
      }

      setKeywordHistory(updatedHistory);
      setShowPivotConfirmModal(false);
      toast.success(`Pivoted to "${pivotNewKeyword}"! Your 45-day tracking has been reset.`, {
        duration: 4000
      });
      
      // Reload to show the page in AI-Powered SEO Suggestions (ready for re-implementation)
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error("Error marking pivot as implemented:", error);
      toast.error("Failed to complete pivot. Please try again.");
    } finally {
      setIsMarkingPivotImplemented(false);
    }
  };

  // Handle "Optimize Meta Only" - For CTR Benchmark Fail cases
  // NEW: 2-step flow - generates and displays metas WITHOUT resetting tracking
  // User reviews suggestions, then clicks "I've Updated This" to confirm and reset
  const handleOptimizeMetaOnly = async () => {
    if (!user?.id || !pageUrl) return;

    setIsOptimizingMeta(true);
    
    try {
      // Re-crawl the page to get fresh content for new AI suggestions
      toast.info("Generating new meta suggestions...");
      try {
        const recrawlRes = await authenticatedFetch("/api/recrawl-page", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            pageUrl,
          }),
        });
        
        if (recrawlRes.ok) {
          const recrawlData = await recrawlRes.json();
          console.log("Page re-crawled:", recrawlData);
        } else {
          console.warn("Page re-crawl failed, but continuing with meta generation");
        }
      } catch (recrawlError) {
        console.warn("Could not re-crawl page:", recrawlError);
      }

      // Fetch previous meta optimization attempts for AI learning
      let previousAttempts = [];
      try {
        const docId = createSafeDocId(user.id, pageUrl);
        const seoTipDoc = await getDoc(doc(db, "implementedSeoTips", docId));
        if (seoTipDoc.exists()) {
          const data = seoTipDoc.data();
          previousAttempts = data.metaOptimizationHistory || [];
          if (previousAttempts.length > 0) {
            console.log(`Found ${previousAttempts.length} previous meta attempt(s) for AI learning`);
          }
        }
      } catch (historyError) {
        console.warn("Could not fetch meta optimization history:", historyError);
      }

      // Build payload for AI meta generation
      // Map previous attempts to include full stats for smarter AI recommendations
      const mappedPreviousAttempts = previousAttempts.slice(-3).map(attempt => ({
        title: attempt.title,
        description: attempt.description,
        outcome: attempt.outcome || "unknown",
        // Include full stats for smarter AI recommendations
        preStats: attempt.preStats || null,
        postStats: attempt.postStats || attempt.finalStats || null,
        daysTracked: attempt.daysTracked || 0,
        keyword: attempt.keyword || null,
        type: attempt.type || "meta-optimization",
      }));
      
      if (mappedPreviousAttempts.length > 0) {
        console.log(`🧠 Passing ${mappedPreviousAttempts.length} previous attempt(s) with full stats to AI`);
      }
      
      const payload = {
        pageUrl,
        userId: user.id,
        context: {
          source: "pivot-card-ctr-benchmark",
          ...(focusKeyword ? { focusKeyword: focusKeyword } : {}),
        },
        ...(focusKeyword ? { focusKeywords: [focusKeyword] } : {}),
        // Include previous attempts for AI learning (with full stats)
        ...(mappedPreviousAttempts.length > 0 ? { previousAttempts: mappedPreviousAttempts } : {}),
      };

      // Fetch NEW AI meta title and description (bypass cache by adding timestamp)
      const [titleRes, descRes] = await Promise.all([
        authenticatedFetch("/api/seo-assistant/meta-title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, _nocache: Date.now() }),
        }),
        authenticatedFetch("/api/seo-assistant/meta-description", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, _nocache: Date.now() }),
        }),
      ]);

      const [titleData, descData] = await Promise.all([
        titleRes.json(),
        descRes.json(),
      ]);

      if (titleData.title && descData.description) {
        // Store the new suggestions in state - display in card
        setOptimizeMetaNewTitle(titleData.title);
        setOptimizeMetaNewDescription(descData.description);
        setShowOptimizeMetaSuggestions(true);
        
        toast.success("New meta suggestions ready! Review them below.", {
          duration: 3000
        });
      } else {
        throw new Error("Failed to generate meta suggestions");
      }
    } catch (error) {
      console.error("Error generating meta suggestions:", error);
      toast.error("Failed to generate meta suggestions. Please try again.");
    } finally {
      setIsOptimizingMeta(false);
    }
  };

  // Handle "I've Updated This On My Site" - Called after user reviews new metas
  // This saves old stats to history, resets tracking, and starts a new 45-day cycle
  const handleMarkOptimizeMetaImplemented = async () => {
    if (!user?.id || !pageUrl || !optimizeMetaNewTitle || !optimizeMetaNewDescription) return;

    setIsMarkingOptimizeMetaImplemented(true);
    
    try {
      const docId = createSafeDocId(user.id, pageUrl);
      
      // Fetch the current document to preserve old stats
      const currentDoc = await getDoc(doc(db, "implementedSeoTips", docId));
      const currentData = currentDoc.exists() ? currentDoc.data() : {};
      
      // Fetch the current cached meta title/description BEFORE we update
      // This allows AI to learn from what didn't work
      let previousTitle = null;
      let previousDescription = null;
      try {
        const cacheKey = focusKeyword 
          ? `${pageUrl}::${focusKeyword.toLowerCase()}`
          : pageUrl;
        const encodedCacheKey = encodeURIComponent(cacheKey);
        
        const [titleDoc, descDoc] = await Promise.all([
          getDoc(doc(db, "seoMetaTitles", user.id, "titles", encodedCacheKey)),
          getDoc(doc(db, "seoMetaDescriptions", user.id, "descriptions", encodedCacheKey))
        ]);
        
        if (titleDoc.exists()) {
          previousTitle = titleDoc.data()?.title || null;
        }
        if (descDoc.exists()) {
          previousDescription = descDoc.data()?.description || null;
        }
      } catch (cacheReadError) {
        console.warn("Could not fetch previous meta cache:", cacheReadError);
      }
      
      // Build the meta optimization history - preserve metrics from previous meta attempts
      const metaOptimizationHistory = currentData.metaOptimizationHistory || [];
      
      // If we have stats from the current meta, save them to history before resetting
      if (currentData.preStats && currentData.implementedAt) {
        metaOptimizationHistory.push({
          type: "ctr-benchmark",
          optimizedAt: new Date().toISOString(),
          reason: ctrBenchmarkFail 
            ? `CTR Benchmark Fail: Position ${ctrBenchmarkFail.position} with ${ctrBenchmarkFail.impressions} impressions, ${ctrBenchmarkFail.actualClicks} clicks (expected ~${ctrBenchmarkFail.expectedClicks})`
            : "Meta optimization triggered from Pivot card",
          keyword: focusKeyword,
          implementedAt: currentData.implementedAt,
          preStats: currentData.preStats,
          finalStats: currentData.postStats || null,
          postStatsHistory: currentData.postStatsHistory || [],
          daysTracked: currentData.implementedAt 
            ? Math.floor((Date.now() - new Date(currentData.implementedAt).getTime()) / (1000 * 60 * 60 * 24))
            : 0,
          optimizationSource: "pivot-card",
          title: previousTitle,
          description: previousDescription,
        });
      }

      // Get current metrics for new preStats baseline
      const preStats = {
        position: currentPosition,
        impressions: currentImpressions,
        clicks: currentClicks,
        ctr: currentImpressions > 0 ? currentClicks / currentImpressions : 0,
      };

      // Update the document with new tracking status
      await writeSeoRecord(
        doc(db, "implementedSeoTips", docId),
        {
          metaOptimizationHistory: metaOptimizationHistory,
          // Set status to "implemented" so SEO Progress can find it after 7 days
          status: "implemented",
          implementationType: "ctr-benchmark-meta",
          // Set new tracking dates
          implementedAt: new Date().toISOString(),
          nextUpdateDue: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          // Set baseline stats
          preStats: preStats,
          // Clear old post stats (will be populated by cron job)
          postStats: deleteField(),
          postStatsHistory: deleteField(),
          extendedTotalDays: deleteField(),
          // Clear the 45-day snapshot since we're starting fresh
          dayFortyFiveSnapshot: deleteField(),
          allowReImplementation: false,  // Reset flag - starting new cycle
          // Keep the same keyword
          currentKeyword: focusKeyword,
          // Store the implemented meta title/description
          implementedMetaTitle: optimizeMetaNewTitle,
          implementedMetaDescription: optimizeMetaNewDescription,
          ctrBenchmarkMetaImplementedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      // Update the cached meta suggestions with the new ones
      try {
        const cacheKey = focusKeyword 
          ? `${pageUrl}::${focusKeyword.toLowerCase()}`
          : pageUrl;
        const encodedCacheKey = encodeURIComponent(cacheKey);
        
        await Promise.all([
          writeSeoRecord(doc(db, "seoMetaTitles", user.id, "titles", encodedCacheKey), {
            title: optimizeMetaNewTitle,
            createdAt: new Date().toISOString(),
            focusKeywords: focusKeyword ? [focusKeyword] : [],
            pageUrl,
          }),
          writeSeoRecord(doc(db, "seoMetaDescriptions", user.id, "descriptions", encodedCacheKey), {
            description: optimizeMetaNewDescription,
            createdAt: new Date().toISOString(),
            focusKeywords: focusKeyword ? [focusKeyword] : [],
            pageUrl,
          }),
        ]);
      } catch (cacheError) {
        console.warn("Could not update meta cache:", cacheError);
      }

      // Log training event for AI learning
      try {
        await authenticatedFetch("/api/training/log-event", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: user.id,
            eventType: "meta_optimization_outcome",
            payload: {
              pageUrl,
              outcome: "ctr_benchmark_fail",
              focusKeyword: focusKeyword,
              previousTitle: previousTitle,
              previousDescription: previousDescription,
              newTitle: optimizeMetaNewTitle,
              newDescription: optimizeMetaNewDescription,
              performanceMetrics: {
                impressions: currentImpressions,
                clicks: currentClicks,
                position: currentPosition,
                ctr: currentImpressions > 0 ? currentClicks / currentImpressions : 0,
                daysTracked: daysSinceImpl,
              },
              source: "pivot-card",
              triggerReason: ctrBenchmarkFail 
                ? `CTR Benchmark Fail: Position ${ctrBenchmarkFail.position} - user implemented new meta suggestions`
                : "Meta optimization from Pivot card",
            }
          }),
        });
      } catch (trainingError) {
        console.warn("Could not log training event:", trainingError);
      }

      toast.success("Meta tags updated! Your new 45-day tracking cycle has started. Refreshing...", {
        duration: 3000
      });
      
      // Refresh the page so user sees the change
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error) {
      console.error("Error marking meta optimization as implemented:", error);
      toast.error("Failed to complete meta optimization. Please try again.");
    } finally {
      setIsMarkingOptimizeMetaImplemented(false);
      setShowOptimizeMetaConfirmModal(false);
    }
  };

  // Handle waiting another 45 days - Now saves stats to history and resets tracking (matching Content Audit flow)
  const handleWaitAnotherCycle = async () => {
    if (!user?.id || !pageUrl) return;

    try {
      const docId = createSafeDocId(user.id, pageUrl);
      
      // Fetch current document to get existing data
      const currentDoc = await getDoc(doc(db, "implementedSeoTips", docId));
      const currentData = currentDoc.exists() ? currentDoc.data() : {};
      
      // Get or create waitExtensionHistory array
      const waitExtensionHistory = currentData.waitExtensionHistory || [];
      
      // Save current stats to history before resetting
      if (currentData.preStats || currentData.postStats) {
        waitExtensionHistory.push({
          preStats: currentData.preStats || null,
          postStats: currentData.postStats || null,
          postStatsHistory: currentData.postStatsHistory || [],
          keyword: focusKeyword || currentData.currentKeyword || "Unknown",
          waitStartedAt: new Date().toISOString(),
          extensionNumber: waitExtensionHistory.length + 1,
          daysTracked: daysSinceImpl || 45,
          reason: "User chose to wait for more data",
          position: currentPosition || currentData.postStats?.position || null,
          impressions: currentImpressions || currentData.postStats?.impressions || 0,
          clicks: currentClicks || currentData.postStats?.clicks || 0,
        });
      }

      // Capture fresh preStats from current postStats (or keep preStats if no postStats)
      // This ensures the new 45-day cycle has a baseline to compare against
      const freshPreStats = {
        position: currentData.postStats?.position || currentData.preStats?.position || 0,
        impressions: currentData.postStats?.impressions || currentData.preStats?.impressions || 0,
        clicks: currentData.postStats?.clicks || currentData.preStats?.clicks || 0,
        ctr: currentData.postStats?.ctr || currentData.preStats?.ctr || 0,
      };

      // Reset tracking and start fresh 45-day cycle
      await writeSeoRecord(
        doc(db, "implementedSeoTips", docId),
        {
          // Set new implementation type for tracking
          status: "implemented",
          implementationType: "wait-extension",
          implementedAt: new Date().toISOString(),
          nextUpdateDue: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),

          // Preserve history
          waitExtensionHistory: waitExtensionHistory,

          // Set fresh baseline for new cycle
          preStats: freshPreStats,

          // DELETE old tracking fields
          postStats: deleteField(),
          postStatsHistory: deleteField(),
          extendedDeadline: deleteField(),
          waitingForMoreData: deleteField(),
          extendedTotalDays: deleteField(),
          lastExtendedAt: deleteField(),
          dayFortyFiveSnapshot: deleteField(),
          allowReImplementation: false,  // Reset flag - starting new cycle
        },
        { merge: true }
      );

      toast.success("Starting fresh 45-day tracking! Check AI-Powered SEO Suggestions to monitor progress.");
      
      // Refresh page after short delay to show updated state
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error("Error starting wait extension:", error);
      toast.error("Failed to start wait extension. Please try again.");
    }
  };

  // Fetch keyword comparison data for smart recommendations
  // This compares the focus keyword against other ranking keywords to suggest better alternatives
  const fetchKeywordComparison = async () => {
    if (!user?.id || !pageUrl || !focusKeyword || keywordComparisonLoaded) return;
    
    setIsLoadingKeywordComparison(true);
    try {
      const { createGSCTokenManager } = await import("../../lib/gscTokenManager");
      const tokenManager = createGSCTokenManager(user.id);
      const gscData = await tokenManager.getStoredGSCData();
      
      if (!gscData?.accessToken || !gscData?.siteUrl) {
        console.log("GSC not connected for keyword comparison");
        setKeywordComparisonLoaded(true);
        return;
      }

      const validToken = await tokenManager.getValidAccessToken();
      if (!validToken) {
        console.log("Could not get valid GSC token for comparison");
        setKeywordComparisonLoaded(true);
        return;
      }

      const response = await authenticatedFetch("/api/gsc/page-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          pageUrl,
          dateRange: "28",
          token: validToken,
          siteUrl: gscData.siteUrl
        })
      });

      if (!response.ok) {
        console.log("Failed to fetch keywords for comparison");
        setKeywordComparisonLoaded(true);
        return;
      }

      const data = await response.json();
      if (data.success && data.keywords?.topPerformers?.length > 0) {
        const allKeywords = data.keywords.topPerformers;
        
        // Find focus keyword in the list
        const focusKeywordData = allKeywords.find(
          kw => kw.keyword.toLowerCase() === focusKeyword.toLowerCase()
        );
        
        // Find the best performing keyword (by position - lowest is best)
        const bestByPosition = [...allKeywords].sort((a, b) => a.position - b.position)[0];
        
        // Find keywords that outperform the focus keyword
        const focusPosition = focusKeywordData?.position || 999;
        const betterKeywords = allKeywords
          .filter(kw => kw.keyword.toLowerCase() !== focusKeyword.toLowerCase())
          .filter(kw => kw.position < focusPosition)
          .sort((a, b) => a.position - b.position);
        
        // Determine if focus keyword is the best
        const isFocusKeywordBest = focusKeywordData && 
          (!bestByPosition || focusKeywordData.position <= bestByPosition.position);
        
        // Get the best alternative keyword to recommend for pivot
        const bestAlternative = betterKeywords.length > 0 ? betterKeywords[0] : null;
        
        setKeywordComparisonData({
          isFocusKeywordBest,
          focusKeywordData,
          bestByPosition,
          bestAlternative,
          betterKeywordsCount: betterKeywords.length,
          allKeywordsCount: allKeywords.length,
        });
        
        console.log("Pivot Card Keyword Comparison:", {
          isFocusKeywordBest,
          focusKeyword,
          focusPosition,
          bestKeyword: bestByPosition?.keyword,
          bestPosition: bestByPosition?.position,
          bestAlternative: bestAlternative?.keyword,
        });
      }
      
      setKeywordComparisonLoaded(true);
    } catch (error) {
      console.error("Error fetching keyword comparison:", error);
      setKeywordComparisonLoaded(true);
    } finally {
      setIsLoadingKeywordComparison(false);
    }
  };

  // Fetch keyword insights for the modal
  const fetchKeywordInsights = async () => {
    if (!user?.id || keywordInsightsData) return; // Don't refetch if already loaded
    
    setIsLoadingInsights(true);
    try {
      // Get GSC token and siteUrl using the token manager
      const { createGSCTokenManager } = await import("../../lib/gscTokenManager");
      
      const tokenManager = createGSCTokenManager(user.id);
      const gscData = await tokenManager.getStoredGSCData();
      
      if (!gscData?.accessToken || !gscData?.siteUrl) {
        throw new Error("GSC not connected");
      }

      // Get valid access token (refreshes if needed)
      const validToken = await tokenManager.getValidAccessToken();
      if (!validToken) {
        throw new Error("Could not get valid GSC token");
      }

      const response = await authenticatedFetch("/api/gsc/page-keywords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          pageUrl,
          dateRange: "28",
          token: validToken,
          siteUrl: gscData.siteUrl
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || "Failed to fetch keywords");
      }

      const data = await response.json();
      if (data.success) {
        setKeywordInsightsData(data.keywords);
      }
    } catch (error) {
      console.error("Error fetching keyword insights:", error);
      toast.error("Failed to load keyword insights", {
        description: error.message
      });
    } finally {
      setIsLoadingInsights(false);
    }
  };

  // Helper to check if a keyword matches the focus keyword
  const isFocusKeyword = (keyword) => {
    if (!focusKeyword || !keyword) return false;
    return keyword.toLowerCase().trim() === focusKeyword.toLowerCase().trim();
  };

  const cleanUrl = pageUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "";

  useEffect(() => {
    if (isExpanded && contentRef.current) {
      // Use a large fixed value to ensure all content is visible
      setContentMaxHeight("2000px");
    } else {
      setContentMaxHeight("0px");
    }
  }, [
    isExpanded,
    showKeywordSelection,
    hybridKeywords.length,
    currentRankingKeywords.length,
    keywordHistory.length,
    waitAnotherCycle,
    pendingKeyword,
    pendingKeywordSource,
    selectedKeyword,
    loadingHybridKeywords,
    loadingRankingKeywords,
    isSaving,
    isOptimizingMeta,
  ]);

  // Format snapshot date for display
  const snapshotDate = snapshot?.capturedAt 
    ? new Date(snapshot.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  
  // Calculate next refresh date (7 days from snapshot)
  const nextRefreshDate = snapshot?.capturedAt
    ? new Date(new Date(snapshot.capturedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Check if this is a resurfaced page (decline detected)
  const isResurfaced = snapshot?.declineDetected === true;

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 overflow-hidden">
        {/* Decline Warning Banner - shown when resurfaced from passive monitoring */}
        {isResurfaced && snapshot?.declineDetails && (
          <div className="p-3 bg-red-100 dark:bg-red-900/30 border-b border-red-300 dark:border-red-700">
            <div className="flex items-center gap-2 text-red-800 dark:text-red-200 font-medium">
              <AlertCircle className="h-4 w-4" />
              Performance Declined
            </div>
            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
              {snapshot.declineReason === "ctr-drop" 
                ? `CTR dropped from ${(snapshot.declineDetails.previousCtr * 100).toFixed(1)}% to ${(snapshot.ctr * 100).toFixed(1)}%`
                : `Position dropped from ${snapshot.declineDetails.previousPosition.toFixed(0)} to ${snapshot.position.toFixed(0)}`
              } since you dismissed it. Here are your options:
            </p>
          </div>
        )}
        
        {/* Header - Unified layout matching Content Audit Card */}
        <div className="p-4 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-base sm:text-lg text-amber-900 dark:text-amber-100 flex items-center gap-2 flex-wrap">
                  <span className="break-all">{cleanUrl}</span>
                  <a 
                    href={pageUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 transition-colors flex-shrink-0"
                    title="Open page in new tab"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </h4>
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  {focusKeyword ? `Current keyword: "${focusKeyword}"` : "Consider trying a different keyword strategy"}
                </p>
                {/* Snapshot info display */}
                {snapshotDate && (
                  <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 mt-1">
                    <Clock className="h-3 w-3" />
                    <span>Based on metrics as of {snapshotDate}. Next refresh: {nextRefreshDate}.</span>
                  </div>
                )}
                {/* Keyword Insights Link - Inline with header like Content Audit */}
                <Dialog open={isInsightsOpen} onOpenChange={(open) => {
                  setIsInsightsOpen(open);
                  if (open) fetchKeywordInsights();
                }}>
                  <DialogTrigger asChild>
                    <button className="text-sm text-[#00BF63] hover:text-[#00a855] underline underline-offset-2 mt-1 flex items-center gap-1">
                      <BarChart3 className="w-3 h-3" />
                      Keyword Insights
                    </button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl max-h-[85vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-[#00BF63]" />
                  Keyword Insights
                </DialogTitle>
                <DialogDescription>
                  {cleanUrl}
                </DialogDescription>
              </DialogHeader>
              
              <ScrollArea className="max-h-[65vh] pr-4">
                {/* Explanatory message at top - matching Content Audit style */}
                <div className="mb-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    <strong>💡 Why are there so many keywords?</strong><br />
                    Google may show your page for many related searches (keywords) based on your page content and location. The keywords below explain why your impressions and rankings moved. <strong>You don&apos;t need to optimize for all of them.</strong> Continuing to improve your <strong>Focus Keyword</strong> helps Google naturally narrow results over time.<br /><br />
                    <strong>We just wanted to give you a quick look behind the curtain so you can see what&apos;s happening in the background (:</strong>
                  </p>
                </div>

                {/* Current Stats Section - matching Content Audit style */}
                {implementationData?.postStats && (
                  <div className="mb-6">
                    <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-blue-600" />
                      Current Performance (Last 28 Days)
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-muted-foreground mb-1">Impressions</p>
                        <p className="text-lg font-bold">{implementationData.postStats.impressions?.toLocaleString() || currentImpressions?.toLocaleString() || 0}</p>
                        {implementationData.preStats && (
                          <div className="text-xs mt-1 flex items-center gap-1">
                            {(implementationData.postStats.impressions - implementationData.preStats.impressions) > 0 ? (
                              <span className="text-green-600 flex items-center"><ArrowUp className="w-3 h-3" />+{implementationData.postStats.impressions - implementationData.preStats.impressions}</span>
                            ) : (implementationData.postStats.impressions - implementationData.preStats.impressions) < 0 ? (
                              <span className="text-red-600 flex items-center"><ArrowDown className="w-3 h-3" />{implementationData.postStats.impressions - implementationData.preStats.impressions}</span>
                            ) : (
                              <span className="text-gray-500 flex items-center"><Minus className="w-3 h-3" />0</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-muted-foreground mb-1">Clicks</p>
                        <p className="text-lg font-bold">{implementationData.postStats.clicks || currentClicks || 0}</p>
                        {implementationData.preStats && (
                          <div className="text-xs mt-1 flex items-center gap-1">
                            {(implementationData.postStats.clicks - implementationData.preStats.clicks) > 0 ? (
                              <span className="text-green-600 flex items-center"><ArrowUp className="w-3 h-3" />+{implementationData.postStats.clicks - implementationData.preStats.clicks}</span>
                            ) : (implementationData.postStats.clicks - implementationData.preStats.clicks) < 0 ? (
                              <span className="text-red-600 flex items-center"><ArrowDown className="w-3 h-3" />{implementationData.postStats.clicks - implementationData.preStats.clicks}</span>
                            ) : (
                              <span className="text-gray-500 flex items-center"><Minus className="w-3 h-3" />0</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-muted-foreground mb-1">CTR</p>
                        <p className="text-lg font-bold">{((implementationData.postStats.ctr || 0) * 100).toFixed(1)}%</p>
                        {implementationData.preStats && (
                          <div className="text-xs mt-1 flex items-center gap-1">
                            {((implementationData.postStats.ctr - implementationData.preStats.ctr) * 100) > 0 ? (
                              <span className="text-green-600 flex items-center"><ArrowUp className="w-3 h-3" />+{((implementationData.postStats.ctr - implementationData.preStats.ctr) * 100).toFixed(1)}</span>
                            ) : ((implementationData.postStats.ctr - implementationData.preStats.ctr) * 100) < 0 ? (
                              <span className="text-red-600 flex items-center"><ArrowDown className="w-3 h-3" />{((implementationData.postStats.ctr - implementationData.preStats.ctr) * 100).toFixed(1)}</span>
                            ) : (
                              <span className="text-gray-500 flex items-center"><Minus className="w-3 h-3" />0</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 border border-gray-200 dark:border-gray-700">
                        <p className="text-xs text-muted-foreground mb-1">Avg. Position</p>
                        <p className="text-lg font-bold">{implementationData.postStats.position?.toFixed(1) || currentPosition?.toFixed(1) || "—"}</p>
                        {implementationData.preStats && (
                          <div className="text-xs mt-1 flex items-center gap-1">
                            {/* For position, lower is better, so we invert the color logic */}
                            {(implementationData.postStats.position - implementationData.preStats.position) < 0 ? (
                              <span className="text-green-600 flex items-center"><ArrowUp className="w-3 h-3" />{(implementationData.postStats.position - implementationData.preStats.position).toFixed(1)}</span>
                            ) : (implementationData.postStats.position - implementationData.preStats.position) > 0 ? (
                              <span className="text-red-600 flex items-center"><ArrowDown className="w-3 h-3" />+{(implementationData.postStats.position - implementationData.preStats.position).toFixed(1)}</span>
                            ) : (
                              <span className="text-gray-500 flex items-center"><Minus className="w-3 h-3" />0</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Keywords Section */}
                <div className="space-y-4">
                  {isLoadingInsights ? (
                    <div className="text-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">Loading keyword data...</p>
                    </div>
                  ) : keywordInsightsData ? (
                    <>
                      {/* Focus Keyword Highlight */}
                      {focusKeyword && (
                        <div className={`mb-4 p-3 rounded-lg ${
                          keywordSource === "ai-generated"
                            ? "bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 border border-purple-200 dark:border-purple-800"
                            : "bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 border border-blue-200 dark:border-blue-800"
                        }`}>
                          <div className="flex items-center gap-2 mb-1">
                            {keywordSource === "ai-generated" ? (
                              <>
                                <Sparkles className="w-4 h-4 text-purple-600" />
                                <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wide">AI-Generated Focus Keyword</span>
                              </>
                            ) : (
                              <>
                                <Search className="w-4 h-4 text-blue-600" />
                                <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">Focus Keyword</span>
                              </>
                            )}
                          </div>
                          <p className={`font-bold ${
                            keywordSource === "ai-generated"
                              ? "text-purple-900 dark:text-purple-100"
                              : "text-blue-900 dark:text-blue-100"
                          }`}>{focusKeyword}</p>
                        </div>
                      )}

                      {/* Top Performing Keywords - matching Content Audit style */}
                      {keywordInsightsData.topPerformers?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                            <Search className="w-4 h-4 text-[#00BF63]" />
                            Search Queries Google Tested
                            <Badge variant="secondary" className="text-xs">{keywordInsightsData.topPerformers.length}</Badge>
                          </h4>
                          <div className="space-y-2">
                            {keywordInsightsData.topPerformers.slice(0, 10).map((kw, idx) => {
                              const isMatch = isFocusKeyword(kw.keyword);
                              const isAiGenerated = keywordSource === "ai-generated";
                              return (
                                <div 
                                  key={idx} 
                                  className={`flex items-center justify-between p-3 rounded-lg ${
                                    isMatch 
                                      ? isAiGenerated
                                        ? "bg-gradient-to-r from-purple-100 to-pink-100 dark:from-purple-950/40 dark:to-pink-950/40 border-2 border-purple-400 dark:border-purple-600 ring-2 ring-purple-200 dark:ring-purple-800"
                                        : "bg-gradient-to-r from-blue-100 to-cyan-100 dark:from-blue-950/40 dark:to-cyan-950/40 border-2 border-blue-400 dark:border-blue-600 ring-2 ring-blue-200 dark:ring-blue-800"
                                      : "bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800"
                                  }`}
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className={`font-medium text-sm truncate ${
                                        isMatch 
                                          ? isAiGenerated 
                                            ? "text-purple-900 dark:text-purple-100" 
                                            : "text-blue-900 dark:text-blue-100"
                                          : ""
                                      }`}>
                                        {kw.keyword}
                                      </p>
                                      {isMatch && (
                                        <Badge className={`text-white text-[10px] px-1.5 py-0 h-4 flex-shrink-0 ${
                                          isAiGenerated ? "bg-purple-600" : "bg-blue-600"
                                        }`}>
                                          {isAiGenerated && <Sparkles className="w-2.5 h-2.5 mr-0.5" />}
                                          FOCUS
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-xs text-muted-foreground">Position: {kw.position}</p>
                                  </div>
                                  <div className="flex items-center gap-4 text-xs">
                                    <div className="text-center">
                                      <p className="font-semibold">{kw.impressions}</p>
                                      <p className="text-muted-foreground">impr.</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="font-semibold">{kw.clicks}</p>
                                      <p className="text-muted-foreground">clicks</p>
                                    </div>
                                    <div className="text-center">
                                      <p className="font-semibold">{kw.ctr}</p>
                                      <p className="text-muted-foreground">CTR</p>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                            {keywordInsightsData.topPerformers.length > 10 && (
                              <p className="text-xs text-muted-foreground text-center py-1">
                                + {keywordInsightsData.topPerformers.length - 10} more top keywords
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Other Keywords (Testing) */}
                      {keywordInsightsData.otherKeywords?.length > 0 && (
                        <div>
                          <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
                            <MousePointerClick className="w-4 h-4 text-gray-500" />
                            Other Queries
                            <Badge variant="outline" className="text-xs">{keywordInsightsData.otherKeywords.length}</Badge>
                          </h4>

                          <div className="space-y-1.5">
                            {keywordInsightsData.otherKeywords.slice(0, 15).map((kw, idx) => {
                              const isMatch = isFocusKeyword(kw.keyword);
                              const isAiGenerated = keywordSource === "ai-generated";
                              return (
                                <div 
                                  key={idx} 
                                  className={`flex items-center justify-between p-2 rounded text-xs ${
                                    isMatch
                                      ? isAiGenerated
                                        ? "bg-purple-100 dark:bg-purple-950/40 border-2 border-purple-400 dark:border-purple-600"
                                        : "bg-blue-100 dark:bg-blue-950/40 border-2 border-blue-400 dark:border-blue-600"
                                      : "bg-gray-50/50 dark:bg-gray-800/30"
                                  }`}
                                >
                                  <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <span className="truncate">{kw.keyword}</span>
                                    {isMatch && (
                                      <Badge className={`text-[9px] ${isAiGenerated ? "bg-purple-500" : "bg-blue-500"}`}>
                                        {isAiGenerated ? "AI" : "Focus"}
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-3 text-muted-foreground ml-2">
                                    <span>{kw.impressions?.toLocaleString() || 0} imp</span>
                                    <span>{kw.clicks?.toLocaleString() || 0} clicks</span>
                                    <span className="font-medium">{kw.ctr}</span>
                                  </div>
                                </div>
                              );
                            })}
                            {keywordInsightsData.otherKeywords.length > 15 && (
                              <p className="text-xs text-muted-foreground text-center py-1">
                                + {keywordInsightsData.otherKeywords.length - 15} more testing keywords
                              </p>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Summary */}
                      {keywordInsightsData.totals && (
                        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-muted-foreground">Total Keywords Ranking:</span>
                            <span className="font-semibold">{keywordInsightsData.totals.totalKeywords}</span>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-8">
                      <p className="text-sm text-muted-foreground">No keyword data available yet.</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
              </div>
            </div>
            {/* Expand/Collapse Trigger - ChevronRight when closed, ChevronDown when open (matching Content Audit) */}
            <CollapsibleTrigger className="p-2 hover:bg-amber-200/50 dark:hover:bg-amber-800/30 rounded-lg transition-colors flex-shrink-0 self-start sm:self-center">
              {isExpanded ? (
                <ChevronDown className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              ) : (
                <ChevronRight className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              )}
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent
          forceMount
          className="overflow-hidden"
          style={{
            display: isExpanded ? "block" : "none",
            padding: isExpanded ? "1rem" : "0px",
          }}
        >
          <div ref={contentRef} className="space-y-4">
            {/* Explanation */}
            <div className="bg-white/50 dark:bg-gray-800/30 rounded-lg p-3">
              <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">
                Your page has been tracking for 45+ days but doesn&apos;t meet Content Audit criteria yet:
              </p>
              <ul className="text-xs text-amber-700 dark:text-amber-300 list-disc list-inside space-y-1">
                {pivotReasons.map((reason, idx) => (
                  <li key={idx}>{reason}</li>
                ))}
              </ul>
            </div>

            {/* AI Recommendation */}
            <div className={`rounded-lg p-4 border-2 ${
              recommendation.action === "success"
                ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-700"
                : recommendation.action === "wait" 
                ? "bg-green-50 dark:bg-green-950/30 border-green-300 dark:border-green-700" 
                : recommendation.action === "check-indexing"
                ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700"
                : recommendation.action === "pivot"
                ? "bg-purple-50 dark:bg-purple-950/30 border-purple-300 dark:border-purple-700"
                : recommendation.action === "optimize-meta"
                ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-700"
                : "bg-blue-50 dark:bg-blue-950/30 border-blue-300 dark:border-blue-700"
            }`}>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={`text-sm font-semibold ${
                      recommendation.action === "success"
                        ? "text-emerald-800 dark:text-emerald-200"
                        : recommendation.action === "wait"
                        ? "text-green-800 dark:text-green-200"
                        : recommendation.action === "check-indexing"
                        ? "text-amber-800 dark:text-amber-200"
                        : recommendation.action === "pivot"
                        ? "text-purple-800 dark:text-purple-200"
                        : recommendation.action === "optimize-meta"
                        ? "text-red-800 dark:text-red-200"
                        : "text-blue-800 dark:text-blue-200"
                    }`}>
                      {recommendation.action === "success" && "Great News: Your Page is Performing Well!"}
                      {recommendation.action === "wait" && "Recommended: Wait Another 45 Days"}
                      {recommendation.action === "check-indexing" && "Action Needed: Check Page Indexing"}
                      {recommendation.action === "pivot" && "Recommended: Select a New Keyword"}
                      {recommendation.action === "optimize-meta" && "Recommended: Optimize Meta Title & Description Only"}
                      {recommendation.action === "either" && "Either Option Works"}
                    </span>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded font-medium ${
                      recommendation.confidence === "high"
                        ? "bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200"
                        : recommendation.confidence === "medium"
                        ? "bg-yellow-200 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200"
                        : "bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300"
                    }`}>
                      {recommendation.confidence} confidence
                    </span>
                  </div>
                  <p className={`text-sm ${
                    recommendation.action === "success"
                      ? "text-emerald-700 dark:text-emerald-300"
                      : recommendation.action === "wait"
                      ? "text-green-700 dark:text-green-300"
                      : recommendation.action === "check-indexing"
                      ? "text-amber-700 dark:text-amber-300"
                      : recommendation.action === "pivot"
                      ? "text-purple-700 dark:text-purple-300"
                      : recommendation.action === "optimize-meta"
                      ? "text-red-700 dark:text-red-300"
                      : "text-blue-700 dark:text-blue-300"
                  }`}>
                    {recommendation.reason}
                  </p>
                  
                  {/* Keyword Insight Callout - Shows when keyword comparison data informs the recommendation */}
                  {recommendation.keywordInsight && (
                    <div className="mt-3 p-3 bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-900/20 dark:to-blue-900/20 rounded-lg border border-indigo-200 dark:border-indigo-700">
                      <div className="flex items-start gap-2">
                        <Lightbulb className="w-4 h-4 text-indigo-600 dark:text-indigo-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <p className="text-xs font-semibold text-indigo-800 dark:text-indigo-200 uppercase tracking-wide mb-1">Keyword Insight</p>
                          <p className="text-sm text-indigo-700 dark:text-indigo-300">{recommendation.keywordInsight}</p>
                          {recommendation.suggestedPivotKeyword && (
                            <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
                              Suggested keyword: <span className="font-medium">&quot;{recommendation.suggestedPivotKeyword}&quot;</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {/* Loading indicator for keyword comparison */}
                  {isLoadingKeywordComparison && !keywordComparisonLoaded && (
                    <div className="mt-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <div className="w-3 h-3 border-2 border-gray-300 dark:border-gray-600 border-t-indigo-500 rounded-full animate-spin" />
                      Analyzing keyword performance...
                    </div>
                  )}
                </div>
            </div>

            {/* Pivot to New Keyword - Meta Suggestions UI (2-step flow) */}
            {showPivotMetaSuggestions && pivotNewMetaTitle && pivotNewMetaDescription ? (
              <div className="space-y-4">
                <div className="bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 p-4 rounded-lg border border-emerald-200 dark:border-emerald-700">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <h4 className="font-semibold text-emerald-900 dark:text-emerald-100">New Keyword Meta Suggestions</h4>
                  </div>
                  
                  {/* Keyword Change Info */}
                  <div className="mb-4 p-3 bg-white dark:bg-gray-800/50 rounded-lg border border-emerald-200 dark:border-emerald-700">
                    <p className="text-xs text-muted-foreground mb-2">Keyword change:</p>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-gray-500 dark:text-gray-400 line-through">{pivotOldKeyword || "No previous keyword"}</span>
                      <ArrowRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span className="font-medium text-emerald-700 dark:text-emerald-300">{pivotNewKeyword}</span>
                    </div>
                  </div>
                  
                  <p className="text-sm text-emerald-700 dark:text-emerald-300 mb-4">
                    We&apos;ve generated new meta tags optimized for your new keyword. Review them below and update your site.
                  </p>
                  
                  {/* Page URL Link */}
                  <div className="mb-4 pl-3 border-l-2 border-[#00BF63]">
                    <p className="text-xs text-muted-foreground mb-1">Update meta tags on:</p>
                    <a 
                      href={pageUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-base text-[#00BF63] hover:text-[#00a855] hover:underline flex items-center gap-2 break-all font-medium"
                    >
                      <ExternalLink className="h-4 w-4 flex-shrink-0" />
                      {cleanUrl}
                    </a>
                  </div>
                  
                  {/* New Meta Title */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-2">
                      New Meta Title
                    </label>
                    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-emerald-300 dark:border-emerald-600">
                      <p className="text-sm text-gray-900 dark:text-gray-100 font-medium">{pivotNewMetaTitle}</p>
                    </div>
                  </div>
                  
                  {/* New Meta Description */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-emerald-800 dark:text-emerald-200 mb-2">
                      New Meta Description
                    </label>
                    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-emerald-300 dark:border-emerald-600">
                      <p className="text-sm text-gray-900 dark:text-gray-100">{pivotNewMetaDescription}</p>
                    </div>
                  </div>
                  
                  {/* Instructions */}
                  <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-700 mb-4">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>Next Steps:</strong> Copy these meta tags and update them on your website. Once done, click the button below to save your new keyword and start fresh 45-day tracking.
                    </p>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button 
                      onClick={() => setShowPivotConfirmModal(true)}
                      disabled={isMarkingPivotImplemented}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    >
                      {isMarkingPivotImplemented ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Updating...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          I&apos;ve Updated This On My Site
                        </>
                      )}
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={handleCancelPivotSuggestions}
                      className="border-gray-300 dark:border-gray-600"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            ) : showOptimizeMetaSuggestions && optimizeMetaNewTitle && optimizeMetaNewDescription ? (
              /* Optimize Meta Only - New Meta Suggestions UI */
              <div className="space-y-4">
                <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-4 rounded-lg border border-purple-200 dark:border-purple-700">
                  <div className="flex items-center gap-2 mb-3">
                    <Zap className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                    <h4 className="font-semibold text-purple-900 dark:text-purple-100">New AI Meta Suggestions</h4>
                  </div>
                  <p className="text-sm text-purple-700 dark:text-purple-300 mb-4">
                    We&apos;ve generated new meta tags to improve your click-through rate. Review them below and update your site.
                  </p>
                  
                  {/* Page URL Link */}
                  <div className="mb-4 pl-3 border-l-2 border-[#00BF63]">
                    <p className="text-xs text-muted-foreground mb-1">Update meta tags on:</p>
                    <a 
                      href={pageUrl} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-base text-[#00BF63] hover:text-[#00a855] hover:underline flex items-center gap-2 break-all font-medium"
                    >
                      <ExternalLink className="h-4 w-4 flex-shrink-0" />
                      {cleanUrl}
                    </a>
                  </div>
                  
                  {/* New Meta Title */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-purple-800 dark:text-purple-200 mb-2">
                      New Meta Title
                    </label>
                    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-purple-300 dark:border-purple-600">
                      <p className="text-sm text-gray-900 dark:text-gray-100 font-medium">{optimizeMetaNewTitle}</p>
                    </div>
                  </div>
                  
                  {/* New Meta Description */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium text-purple-800 dark:text-purple-200 mb-2">
                      New Meta Description
                    </label>
                    <div className="bg-white dark:bg-gray-800 p-3 rounded-lg border border-purple-300 dark:border-purple-600">
                      <p className="text-sm text-gray-900 dark:text-gray-100">{optimizeMetaNewDescription}</p>
                    </div>
                  </div>
                  
                  {/* Instructions */}
                  <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg border border-amber-200 dark:border-amber-700 mb-4">
                    <p className="text-sm text-amber-800 dark:text-amber-200">
                      <strong>Next Steps:</strong> Copy these meta tags and update them on your website. Once done, click the button below to start tracking your new performance.
                    </p>
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button 
                      onClick={() => setShowOptimizeMetaConfirmModal(true)}
                      disabled={isMarkingOptimizeMetaImplemented}
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                    >
                      {isMarkingOptimizeMetaImplemented ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin mr-2" />
                          Updating...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          I&apos;ve Updated This On My Site
                        </>
                      )}
                    </Button>
                    <Button 
                      variant="outline"
                      onClick={() => {
                        setShowOptimizeMetaSuggestions(false);
                        setOptimizeMetaNewTitle(null);
                        setOptimizeMetaNewDescription(null);
                      }}
                      className="border-gray-300 dark:border-gray-600"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Action Buttons - Initial State */}
                {/* Button styling is dynamic based on recommendation.action to highlight the recommended action */}
                {/* Recommended button = green, non-recommended = transparent/ghost */}
                {!showKeywordSelection && (
                  <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                    {/* CTR Benchmark Fail - Show "Optimize Meta Only" button prominently */}
                    {ctrBenchmarkFail && (
                      <Button
                        onClick={handleOptimizeMetaOnly}
                        disabled={isOptimizingMeta}
                        variant={recommendation.action === "optimize-meta" ? "default" : "ghost"}
                        className={`flex items-center gap-2 ${
                          recommendation.action === "optimize-meta"
                            ? "bg-green-600 hover:bg-green-700 text-white ring-2 ring-green-300 dark:ring-green-700"
                            : "bg-transparent border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                        }`}
                      >
                        {isOptimizingMeta ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Zap className="h-4 w-4" />
                        )}
                        {isOptimizingMeta ? "Generating..." : "Optimize Meta Only"}
                      </Button>
                    )}
                    
                    {!waitAnotherCycle ? (
                      <Button
                        variant={recommendation.action === "wait" ? "default" : "ghost"}
                        onClick={() => setShowWaitConfirmModal(true)}
                        className={`flex items-center gap-2 ${
                          recommendation.action === "wait"
                            ? "bg-green-600 hover:bg-green-700 text-white ring-2 ring-green-300 dark:ring-green-700"
                            : "bg-transparent border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                        }`}
                      >
                        <Clock className="h-4 w-4" />
                        Wait Another 45 Days
                      </Button>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-3 py-2 rounded-md">
                        <Clock className="h-4 w-4" />
                        Extended until {extendedDeadline?.toLocaleDateString()}
                      </div>
                    )}
                    <Button
                      variant={recommendation.action === "pivot" ? "default" : "ghost"}
                      onClick={handleOpenKeywordSelection}
                      className={`flex items-center gap-2 ${
                        recommendation.action === "pivot"
                          ? "bg-green-600 hover:bg-green-700 text-white ring-2 ring-green-300 dark:ring-green-700"
                          : "bg-transparent border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      }`}
                    >
                      <RefreshCw className="h-4 w-4" />
                      Select New Focus Keyword
                    </Button>
                  </div>
                )}
              </>
            )}

            {/* Keyword History */}
            {keywordHistory.length > 0 && (
              <div className="border-t border-amber-200 dark:border-amber-800 pt-3">
                <div className="flex items-center gap-2 mb-2">
                  <History className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-medium text-amber-900 dark:text-amber-100">Previously Tried Keywords</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {keywordHistory.map((item, idx) => (
                    <span
                      key={idx}
                      className="text-xs px-2 py-1 rounded bg-amber-100/50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 line-through opacity-60"
                      title={`Tested on ${new Date(item.testedAt).toLocaleDateString()}`}
                    >
                      {item.keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Keyword Selection Section - Shown after clicking "Select a New Focus Keyword" */}
            {showKeywordSelection && (
              <>
                {/* Current Ranking Keywords */}
                <div className="border-t border-amber-200 dark:border-amber-800 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
                        Current Ranking Keywords
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setShowKeywordSelection(false);
                        setPendingKeyword(null);
                        setPendingKeywordSource(null);
                      }}
                      className="text-xs text-muted-foreground"
                    >
                      Cancel
                    </Button>
                  </div>
                  
                  {loadingRankingKeywords ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading ranking keywords...
                    </div>
                  ) : currentRankingKeywords.length > 0 ? (
                    <>
                      {/* Smart Pivot Suggestion Message */}
                      {keywordComparisonData?.bestAlternative && (
                        <div className="mb-3 p-3 bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 rounded-lg border border-emerald-200 dark:border-emerald-700">
                          <div className="flex items-start gap-2">
                            <Lightbulb className="w-4 h-4 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                                Consider pivoting to &quot;{keywordComparisonData.bestAlternative.keyword}&quot;
                              </p>
                              <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                                This keyword has {keywordComparisonData.bestAlternative.clicks} clicks and {keywordComparisonData.bestAlternative.impressions} impressions — {keywordComparisonData.bestAlternative.clicks > 0 ? "it's already getting traffic!" : "better visibility than your focus keyword."}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      <p className="text-xs text-amber-700 dark:text-amber-300 mb-2">
                        Select one of these keywords your page is currently ranking for:
                      </p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {currentRankingKeywords.slice(0, 10).map((kw, idx) => {
                          const isPending = pendingKeyword === kw.keyword;
                          const isSaved = selectedKeyword === kw.keyword;
                          const isRecommended = keywordComparisonData?.bestAlternative?.keyword?.toLowerCase() === kw.keyword.toLowerCase();
                          return (
                            <div
                              key={idx}
                              className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                                isSaved
                                  ? "bg-green-100 dark:bg-green-900/30 border-green-400 dark:border-green-600"
                                  : isPending 
                                    ? "bg-blue-100 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 ring-2 ring-blue-400"
                                    : isRecommended
                                      ? "bg-gradient-to-r from-emerald-50 to-green-50 dark:from-emerald-900/20 dark:to-green-900/20 border-emerald-400 dark:border-emerald-600 ring-1 ring-emerald-300 dark:ring-emerald-600"
                                      : "bg-white dark:bg-gray-800/50 border-amber-200 dark:border-amber-800 hover:border-blue-400 dark:hover:border-blue-600"
                              }`}
                              onClick={() => !isSaved && handleSelectKeyword(kw.keyword, "gsc-existing")}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium truncate">{kw.keyword}</p>
                                  {isRecommended && (
                                    <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 text-[10px] px-1.5 py-0">
                                      Recommended
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  {kw.impressions} impressions • {kw.clicks} clicks • Pos. {Math.round(kw.position || 0)}
                                </p>
                              </div>
                              {isSaved ? (
                                <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                              ) : isPending ? (
                                <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Selected</span>
                              ) : (
                                <Button variant="ghost" size="sm" className="text-xs">
                                  Select
                                </Button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground py-2">
                      No ranking keywords found for this page yet.
                    </p>
                  )}

                  {/* Generate Hybrid Keywords Button - Shows with the keyword list */}
                  <div className="mt-4 pt-3 border-t border-amber-200 dark:border-amber-800">
                    <p className="text-xs text-purple-700 dark:text-purple-300 mb-2">
                      Or generate AI-powered hybrid keywords that combine your page content with ranking data:
                    </p>
                    <Button
                      onClick={handleGenerateHybridKeywords}
                      disabled={loadingHybridKeywords}
                      className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white"
                    >
                      {loadingHybridKeywords ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="h-4 w-4" />
                          Generate Hybrid Keywords
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                {/* Generated Hybrid Keywords */}
                {hybridKeywords.length > 0 && (
                  <div className="border-t border-purple-200 dark:border-purple-800 pt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                      <span className="text-sm font-medium text-purple-900 dark:text-purple-100">
                        AI Hybrid Keywords
                      </span>
                    </div>
                    <p className="text-xs text-purple-700 dark:text-purple-300 mb-2">
                      Select one of these AI-generated keywords to target:
                    </p>
                    <div className="space-y-2">
                      {hybridKeywords.map((kw, idx) => {
                        const keyword = typeof kw === "string" ? kw : kw.keyword;
                        const reason = typeof kw === "object" ? kw.reason : null;
                        const isPending = pendingKeyword === keyword;
                        const isSaved = selectedKeyword === keyword;
                        
                        return (
                          <div
                            key={idx}
                            className={`flex items-center justify-between p-2 rounded border transition-colors cursor-pointer ${
                              isSaved
                                ? "bg-green-100 dark:bg-green-900/30 border-green-400 dark:border-green-600"
                                : isPending 
                                  ? "bg-blue-100 dark:bg-blue-900/30 border-blue-400 dark:border-blue-600 ring-2 ring-blue-400"
                                  : "bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 border-purple-200 dark:border-purple-800 hover:border-purple-400 dark:hover:border-purple-600"
                            }`}
                            onClick={() => !isSaved && handleSelectKeyword(keyword, "hybrid")}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{keyword}</p>
                              {reason && (
                                <p className="text-xs text-purple-600 dark:text-purple-400 italic truncate">{reason}</p>
                              )}
                              {kw.hybridSource && (
                                <p className="text-xs text-muted-foreground">
                                  Combined with: &quot;{kw.hybridSource}&quot;
                                </p>
                              )}
                            </div>
                            {isSaved ? (
                              <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                            ) : isPending ? (
                              <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Selected</span>
                            ) : (
                              <Button variant="ghost" size="sm" className="text-xs text-purple-700 dark:text-purple-300">
                                Select
                              </Button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Save Button - Shows when a keyword is pending */}
                {pendingKeyword && (
                  <div className="border-t border-green-200 dark:border-green-800 pt-4 mt-4">
                    <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 mb-3">
                      <p className="text-sm text-green-800 dark:text-green-200">
                        <span className="font-medium">Selected keyword:</span> {pendingKeyword}
                      </p>
                      <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                        Click &quot;Save New Focus Keyword&quot; to confirm this change.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={handleSavePendingKeyword}
                        disabled={isSaving}
                        className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white"
                      >
                        {isSaving ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Check className="h-4 w-4" />
                            Save New Focus Keyword
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleCancelPendingKeyword}
                        disabled={isSaving}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </CollapsibleContent>
      </div>

      {/* Wait Extension Confirmation Modal */}
      {showWaitConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6 shadow-lg transition-colors">
            <h2 className="mb-2 text-lg font-semibold text-foreground">Start Fresh 45-Day Tracking?</h2>
            <p className="mb-4 text-sm text-muted-foreground">
              This will save your current performance data to history and start a fresh 45-day tracking cycle. 
              Your page will appear in AI-Powered SEO Suggestions while we gather new metrics.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setShowWaitConfirmModal(false)}
              >
                Cancel
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={() => {
                  setShowWaitConfirmModal(false);
                  handleWaitAnotherCycle();
                }}
              >
                Yes, Start Fresh Tracking
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pivot to New Keyword Confirmation Modal */}
      {showPivotConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <h2 className="text-lg font-semibold text-foreground">Confirm Keyword Pivot</h2>
            </div>
            <div className="space-y-3 mb-4">
              <p className="text-sm text-muted-foreground">
                Please confirm you have updated your website with the new meta tags for your new keyword.
              </p>
              <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-md p-3 mb-3">
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300 mb-1">Keyword change:</p>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500 dark:text-gray-400 line-through">{pivotOldKeyword || "None"}</span>
                  <ArrowRight className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-medium text-emerald-700 dark:text-emerald-300">{pivotNewKeyword}</span>
                </div>
              </div>
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded-md p-3">
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">What happens next:</p>
                <ul className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 ml-4 list-disc">
                  <li>Your focus keyword will change to &quot;{pivotNewKeyword}&quot;</li>
                  <li>Current performance data will be saved to keyword history</li>
                  <li>A new 45-day tracking cycle will begin</li>
                  <li>The page will move to &quot;AI-Powered SEO Suggestions&quot; for re-implementation</li>
                </ul>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowPivotConfirmModal(false)}
                disabled={isMarkingPivotImplemented}
              >
                Cancel
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={handleMarkPivotImplemented}
                disabled={isMarkingPivotImplemented}
              >
                {isMarkingPivotImplemented ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Confirming...
                  </>
                ) : (
                  "Yes, I've Updated My Site"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Optimize Meta Confirmation Modal */}
      {showOptimizeMetaConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg transition-colors">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <h2 className="text-lg font-semibold text-foreground">Confirm Meta Update</h2>
            </div>
            <div className="space-y-3 mb-4">
              <p className="text-sm text-muted-foreground">
                Please confirm you have updated your website with the new meta tags.
              </p>
              <div className="bg-zinc-100 dark:bg-zinc-800 rounded-md p-3">
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400 mb-2">What happens next:</p>
                <ul className="text-xs text-zinc-500 dark:text-zinc-400 space-y-1 ml-4 list-disc">
                  <li>Your current performance data will be saved to history</li>
                  <li>A new 45-day tracking cycle will begin</li>
                  <li>First update will appear in SEO Progress after 7 days</li>
                  <li>You can view old stats in &quot;View Full History&quot;</li>
                </ul>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => setShowOptimizeMetaConfirmModal(false)}
                disabled={isMarkingOptimizeMetaImplemented}
              >
                Cancel
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700 text-white"
                onClick={handleMarkOptimizeMetaImplemented}
                disabled={isMarkingOptimizeMetaImplemented}
              >
                {isMarkingOptimizeMetaImplemented ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Confirming...
                  </>
                ) : (
                  "Yes, I've Updated My Site"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Collapsible>
  );
};

export default PivotOptionsPanel;

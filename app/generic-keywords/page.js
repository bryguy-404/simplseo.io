"use client";
import { authenticatedFetch } from '../lib/authenticatedFetch';


import { useAuth } from "../contexts/AuthContext";
import { useEffect, useState, useMemo } from "react";
import MainLayout from "../components/MainLayout";
import { createGSCTokenManager } from "../lib/gscTokenManager";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, MapPin, Clock, Wrench, Search, Filter, TrendingUp, AlertTriangle, ChevronDown, CheckCircle, ExternalLink, Sparkles, FileText, Lightbulb, Loader2, Copy, Check, X, RotateCcw, Plus, RefreshCw, LayoutGrid } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { getFocusKeywords, saveFocusKeywords } from "../lib/firestoreHelpers";
import { useOnboarding } from "../contexts/OnboardingContext";
import SquashBounceLoader from "../components/ui/squash-bounce-loader";
import { useMinimumLoading } from "../hooks/use-minimum-loading";
import { cn } from "@/lib/utils";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export default function GenericKeywordsPage() {
  const { user, isLoading } = useAuth();
  const { data } = useOnboarding();
  const [opportunities, setOpportunities] = useState([]);
  const [cannibalizationAnalysis, setCannibalizationAnalysis] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [fromCache, setFromCache] = useState(false);
  const [cacheAge, setCacheAge] = useState(null);
  const shouldShowLoader = useMinimumLoading(loading, 2000);
  const [openCategories, setOpenCategories] = useState({});
  const [createdOpportunities, setCreatedOpportunities] = useState([]);
  const [successStories, setSuccessStories] = useState([]);
  const [gscKeywords, setGscKeywords] = useState([]);
  const [markAsCreatedDialog, setMarkAsCreatedDialog] = useState({ open: false, opportunity: null });
  const [markAsCreatedUrl, setMarkAsCreatedUrl] = useState("");
  const [isMarkingAsCreated, setIsMarkingAsCreated] = useState(false);
  
  // Content Outline Modal State
  const [contentOutlineDialog, setContentOutlineDialog] = useState({ open: false, opportunity: null });
  const [contentOutline, setContentOutline] = useState(null);
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false);
  const [copiedField, setCopiedField] = useState(null);
  
  // Cache for content outlines (persists in sessionStorage)
  const [outlineCache, setOutlineCache] = useState(() => {
    // Initialize from sessionStorage on mount
    if (typeof window !== 'undefined') {
      try {
        const stored = sessionStorage.getItem('contentOutlineCache');
        if (stored) {
          const parsed = JSON.parse(stored);
          return new Map(Object.entries(parsed));
        }
      } catch (e) {
        console.log('Failed to load outline cache from sessionStorage');
      }
    }
    return new Map();
  });
  
  // Skipped keywords state
  const [skippedKeywords, setSkippedKeywords] = useState([]);
  const [showSkipped, setShowSkipped] = useState(false);
  const [openActionItems, setOpenActionItems] = useState({});
  
  // Track which success stories have been added to focus keywords
  const [addedToFocusKeywords, setAddedToFocusKeywords] = useState(new Set());
  const [addingToFocusKeyword, setAddingToFocusKeyword] = useState(null); // Track which one is currently being added
  
  // Refresh keywords state
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Page type wireframe guide state
  const [selectedWireframe, setSelectedWireframe] = useState(null);
  
  // Indexing help modal state
  const [indexingHelpModal, setIndexingHelpModal] = useState({ open: false, pageUrl: null });
  
  // Settling period constants
  const SETTLING_DAYS_REQUIRED = 60; // Increased from 30 to let new pages stabilize longer
  const SETTLING_IMPRESSIONS_REQUIRED = 50;
  
  // Boost visibility recommendation thresholds
  const BOOST_VISIBILITY_DAYS_THRESHOLD = 30; // Show recommendation after 30 days
  const BOOST_VISIBILITY_IMPRESSIONS_THRESHOLD = 25; // If less than 25 impressions at 30 days

  // Smart navigation placement recommendation based on URL/slug
  const getNavigationRecommendation = (pageUrl, keyword) => {
    if (!pageUrl) return null;
    
    try {
      const url = new URL(pageUrl);
      const pathname = url.pathname.toLowerCase();
      const slug = pathname.split('/').filter(Boolean).pop() || '';
      const keywordLower = (keyword || '').toLowerCase();
      
      // Blog/Article patterns
      if (
        pathname.includes('/blog') || 
        pathname.includes('/article') || 
        pathname.includes('/post') ||
        pathname.includes('/news') ||
        pathname.includes('/guide') ||
        pathname.includes('/how-to') ||
        pathname.includes('/tips') ||
        slug.includes('best-') ||
        slug.includes('top-') ||
        slug.includes('guide')
      ) {
        return {
          placement: "Blog",
          icon: "",
          suggestion: "To help visitors (and Google) find this page, add it to your site’s header, blog, or resources menu",
          reason: "Pages linked in your navigation are discovered and crawled more often"
        };
      }
      
      // Service patterns
      if (
        pathname.includes('/service') || 
        pathname.includes('/pricing') ||
        pathname.includes('/consultation') ||
        pathname.includes('/package') ||
        pathname.includes('/solution') ||
        keywordLower.includes('service') ||
        keywordLower.includes('pricing')
      ) {
        return {
          placement: "Services",
          icon: "",
          suggestion: "Add this as a dropdown item under your Services menu",
          reason: "This appears to be a service page that should be easily discoverable from your main navigation."
        };
      }
      
      // Location/Local patterns
      if (
        pathname.includes('/location') ||
        pathname.includes('/area') ||
        pathname.includes('/near-me') ||
        pathname.includes('-in-') ||
        slug.match(/\b(city|town|county|state)\b/) ||
        keywordLower.includes('near me') ||
        keywordLower.includes(' in ')
      ) {
        return {
          placement: "Locations",
          icon: "",
          suggestion: "Add this to a Locations or Service Areas section",
          reason: "This is a location-specific page. Consider creating a 'Service Areas' dropdown in your navigation."
        };
      }
      
      // About/Company patterns
      if (
        pathname.includes('/about') ||
        pathname.includes('/team') ||
        pathname.includes('/story') ||
        pathname.includes('/mission')
      ) {
        return {
          placement: "About",
          icon: "",
          suggestion: "Link this from your About page or add to About dropdown",
          reason: "This is company/brand content that should be accessible from your About section."
        };
      }
      
      // FAQ patterns
      if (
        pathname.includes('/faq') ||
        pathname.includes('/question') ||
        pathname.includes('/help')
      ) {
        return {
          placement: "FAQ/Support",
          icon: "",
          suggestion: "Add this to a FAQ or Help section in your footer or main navigation",
          reason: "FAQ content helps with SEO and customer trust. Make it easy to find."
        };
      }
      
      // Default - suggest footer or main nav
      return {
        placement: "Footer or Main Nav",
        icon: "",
        suggestion: "Add this page to your footer navigation or as a main menu item",
        reason: "More internal links to this page will help Google discover and rank it faster."
      };
    } catch {
      return {
        placement: "Footer",
        icon: "",
        suggestion: "Add this page to your footer navigation",
        reason: "Internal links help Google discover your content faster."
      };
    }
  };

  // Page type wireframe configurations
  const pageTypeWireframes = {
    "Service Page": {
      label: "Service Page",
      color: "from-blue-500 to-blue-600",
      tips: [
        "Hero section with strong headline & CTA",
        "Service features in 2-3 column grid",
        "Benefits/why choose us section",
        "Testimonials for social proof",
        "Clear pricing or quote CTA",
        "Contact section at bottom"
      ]
    },
    "Local Landing Page": {
      label: "Landing Page",
      color: "from-purple-500 to-purple-600",
      tips: [
        "Minimal navigation (focus on conversion)",
        "Hero with location-specific headline",
        "Trust badges & local reviews",
        "Single focused CTA throughout",
        "Local map or service area",
        "Urgency elements (limited time offers)"
      ]
    },
    "Blog Article": {
      label: "Blog Post",
      color: "from-green-500 to-green-600",
      tips: [
        "Engaging title with keyword",
        "Table of contents for long posts",
        "Subheadings every 200-300 words",
        "Images/diagrams to break up text",
        "Author bio & publish date",
        "Related posts at bottom"
      ]
    },
    "FAQ Page": {
      label: "FAQ Page",
      color: "from-amber-500 to-amber-600",
      tips: [
        "Accordion-style Q&A sections",
        "Group questions by category",
        "Keep answers concise but complete",
        "Link to relevant service pages",
        "Add schema markup for rich results",
        "Include contact CTA for unanswered questions"
      ]
    },
    "Pricing Page": {
      label: "Pricing Page",
      color: "from-rose-500 to-rose-600",
      tips: [
        "Clear pricing tiers (if applicable)",
        "Comparison table for packages",
        "Highlight most popular option",
        "Money-back guarantee badge",
        "FAQ section for pricing questions",
        "Strong CTA for each tier"
      ]
    }
  };

  // Persist outline cache to sessionStorage whenever it changes
  useEffect(() => {
    if (outlineCache.size > 0) {
      try {
        const cacheObj = Object.fromEntries(outlineCache);
        sessionStorage.setItem('contentOutlineCache', JSON.stringify(cacheObj));
      } catch (e) {
        console.log('Failed to save outline cache to sessionStorage');
      }
    }
  }, [outlineCache]);

  // Helper function to get color gradient for page types (matches wireframe colors)
  const getPageTypeColor = (pageType) => {
    const colorMap = {
      'Service Page': 'from-blue-500 to-blue-600',
      'Local Landing Page': 'from-purple-500 to-purple-600',
      'Blog Article': 'from-green-500 to-green-600',
      'FAQ Page': 'from-amber-500 to-amber-600',
      'Pricing Page': 'from-rose-500 to-rose-600',
      // Fallbacks for other page types
      'Landing Page': 'from-purple-500 to-purple-600',
      'Blog Post': 'from-green-500 to-green-600',
      'FAQ': 'from-amber-500 to-amber-600',
      'Service': 'from-blue-500 to-blue-600',
    };
    return colorMap[pageType] || 'from-violet-500 to-purple-600';
  };

  // Helper function to get display name for page types
  const getPageTypeDisplayName = (pageType) => {
    const typeMap = {
      'homepage': 'Homepage',
      'oil-change': 'Oil Change',
      'detailing': 'Car Detailing',
      'location': 'Location',
      'landing-page': 'Landing Page',
      'faq': 'FAQ',
      'coupon': 'Coupon/Deal',
      'service': 'Service'
    };
    return typeMap[pageType] || 'Service';
  };

  useEffect(() => {
    if (user?.id && data?.businessType) {
      // Use the same approach as dashboard - get GSC data from the dashboard's context
      fetchGenericOpportunitiesFromDashboard();
      fetchCreatedOpportunities();
      fetchSkippedKeywords();
    }
  }, [user?.id, data?.businessType]);

  // Fetch created opportunities
  const fetchCreatedOpportunities = async () => {
    if (!user?.id) return;
    
    try {
      const response = await authenticatedFetch(`/api/content-opportunities/mark-created?userId=${encodeURIComponent(user.id)}`);
      const result = await response.json();
      
      if (result.success) {
        setCreatedOpportunities(result.opportunities || []);
      }
    } catch (error) {
      console.error("Error fetching created opportunities:", error);
    }
  };

  // Fetch skipped keywords
  const fetchSkippedKeywords = async () => {
    if (!user?.id) return;
    
    try {
      const response = await authenticatedFetch(`/api/content-opportunities/skip?userId=${encodeURIComponent(user.id)}`);
      const result = await response.json();
      
      if (result.success) {
        setSkippedKeywords(result.skippedKeywords || []);
      }
    } catch (error) {
      console.error("Error fetching skipped keywords:", error);
    }
  };

  // Skip a keyword
  const handleSkipKeyword = async (keyword) => {
    if (!user?.id) return;
    
    try {
      const response = await authenticatedFetch("/api/content-opportunities/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, keyword }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast.success("Keyword skipped", {
          description: "You can restore it anytime from the Skipped section.",
        });
        await fetchSkippedKeywords();
      } else {
        toast.error("Failed to skip keyword");
      }
    } catch (error) {
      console.error("Error skipping keyword:", error);
      toast.error("Failed to skip keyword");
    }
  };

  // Restore a skipped keyword
  const handleRestoreKeyword = async (keyword) => {
    if (!user?.id) return;
    
    try {
      const response = await authenticatedFetch("/api/content-opportunities/skip", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, keyword }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        toast.success("Keyword restored");
        await fetchSkippedKeywords();
      } else {
        toast.error("Failed to restore keyword");
      }
    } catch (error) {
      console.error("Error restoring keyword:", error);
      toast.error("Failed to restore keyword");
    }
  };

  // Add a success story keyword to focus keywords
  const handleAddToFocusKeywords = async (story) => {
    if (!user?.id) return;
    
    const storyKey = `${story.keyword.toLowerCase()}_${story.pageUrl}`;
    setAddingToFocusKeyword(storyKey);
    
    try {
      // Fetch existing focus keywords
      const existingKeywords = await getFocusKeywords(user.id);
      
      // Check if this keyword is already in focus keywords
      const alreadyExists = existingKeywords.some(
        k => k.keyword.toLowerCase() === story.keyword.toLowerCase()
      );
      
      if (alreadyExists) {
        toast.info("This keyword is already in your Focus Keywords list");
        setAddedToFocusKeywords(prev => new Set([...prev, storyKey]));
        setAddingToFocusKeyword(null);
        return;
      }
      
      // Add the new keyword with page URL and source
      const newKeyword = {
        keyword: story.keyword,
        pageUrl: story.pageUrl,
        source: "ai-generated", // Mark as AI-generated since it came from Generic Keywords
      };
      
      const updatedKeywords = [...existingKeywords, newKeyword];
      
      // Save to Firestore
      await saveFocusKeywords(user.id, updatedKeywords);
      
      // Update local state
      setAddedToFocusKeywords(prev => new Set([...prev, storyKey]));
      
      toast.success("Added to Focus Keywords!", {
        description: "You can now optimize this page in Improve a page.",
      });
    } catch (error) {
      console.error("Error adding to focus keywords:", error);
      toast.error("Failed to add to Focus Keywords");
    } finally {
      setAddingToFocusKeyword(null);
    }
  };

  // Store GSC credentials for direct page checks
  const [gscCredentials, setGscCredentials] = useState(null);

  // Fetch GSC keywords for success stories matching
  useEffect(() => {
    const fetchGSCDataForSuccessStories = async () => {
      if (!user?.id) return;

      console.log("🔍 [Success Stories] Starting GSC data fetch...");

      try {
        const tokenManager = createGSCTokenManager(user.id);
        const gscData = await tokenManager.getStoredGSCData();
        
        console.log("🔍 [Success Stories] GSC data:", { 
          hasRefreshToken: !!gscData?.refreshToken, 
          siteUrl: gscData?.siteUrl 
        });
        
        if (!gscData?.refreshToken || !gscData?.siteUrl) {
          console.log("❌ [Success Stories] No GSC credentials found");
          return;
        }

        const validToken = await tokenManager.getValidAccessToken();
        if (!validToken) {
          console.log("❌ [Success Stories] Could not get valid access token");
          return;
        }

        // Store credentials for direct page checks
        setGscCredentials({ siteUrl: gscData.siteUrl, token: validToken });

        console.log("✅ [Success Stories] Got valid token, fetching keywords...");
        const keywords = await fetchGSCKeywords(gscData.siteUrl, validToken);
        console.log("✅ [Success Stories] Fetched", keywords?.length || 0, "keywords from GSC");
        
        // Log unique pages found
        const uniquePages = [...new Set(keywords?.map(k => k.page) || [])];
        console.log("📄 [Success Stories] Unique pages in GSC data:", uniquePages.length);
        console.log("📄 [Success Stories] Sample pages:", uniquePages.slice(0, 5));
        
        setGscKeywords(keywords || []);
      } catch (error) {
        console.error("❌ [Success Stories] Error fetching GSC data:", error);
      }
    };

    fetchGSCDataForSuccessStories();
  }, [user?.id]);

  // Match created opportunities with GSC data to find success stories
  useEffect(() => {
    const matchSuccessStories = async () => {
      console.log("🔄 [Success Stories] Matching effect triggered");
      console.log("🔄 [Success Stories] Created opportunities:", createdOpportunities.length);
      console.log("🔄 [Success Stories] GSC keywords:", gscKeywords.length);
      console.log("🔄 [Success Stories] Has GSC credentials:", !!gscCredentials);
      
      if (createdOpportunities.length === 0) {
        console.log("⏭️ [Success Stories] Skipping - no created opportunities");
        setSuccessStories([]);
        return;
      }

      // Helper function to extract and normalize pathname only (not full URL)
      const normalizeUrlPath = (url) => {
        try {
          const u = new URL(url);
          // Return just the pathname, normalized (lowercase, no trailing slash)
          return u.pathname.toLowerCase().replace(/\/$/, '') || '/';
        } catch {
          return url.toLowerCase().replace(/\/$/, '');
        }
      };
      
      // Log created opportunities URLs for debugging
      console.log("📋 [Success Stories] Created opportunity URLs:");
      createdOpportunities.forEach(opp => {
        const normalized = normalizeUrlPath(opp.pageUrl);
        console.log(`  - ${opp.keyword}: ${opp.pageUrl} → ${normalized}`);
      });
      
      // Log unique GSC pages for comparison
      const uniqueGscPaths = [...new Set(gscKeywords.map(kw => normalizeUrlPath(kw.page)))];
      console.log("📋 [Success Stories] GSC page paths (sample):", uniqueGscPaths.slice(0, 10));
      
      const foundStories = [];
      
      for (const opp of createdOpportunities) {
        const oppPath = normalizeUrlPath(opp.pageUrl);
        
        // First: Check if the page exists in the main GSC data and aggregate all metrics
        const matchingRows = gscKeywords.filter(kw => {
          const kwPath = normalizeUrlPath(kw.page);
          return oppPath === kwPath;
        });
        
        if (matchingRows.length > 0) {
          console.log(`✅ [Success Stories] "${opp.keyword}": ${oppPath} → FOUND ${matchingRows.length} rows in main GSC data`);
          
          // Aggregate metrics from all matching rows for this page
          const totalImpressions = matchingRows.reduce((sum, kw) => sum + kw.impressions, 0);
          const totalClicks = matchingRows.reduce((sum, kw) => sum + kw.clicks, 0);
          
          // Weighted average position (weighted by impressions)
          const weightedPosition = totalImpressions > 0 
            ? matchingRows.reduce((sum, kw) => sum + (kw.position * kw.impressions), 0) / totalImpressions 
            : matchingRows[0].position;
          
          foundStories.push({
            ...opp,
            gscData: {
              impressions: totalImpressions,
              clicks: totalClicks,
              position: Math.round(weightedPosition),
              ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0
            }
          });
          continue;
        }
        
        // Second: If not found in main data, do a direct check (for low-impression pages)
        if (gscCredentials) {
          console.log(`🔍 [Success Stories] "${opp.keyword}": ${oppPath} → NOT in main data, doing direct check...`);
          
          const directCheck = await checkPageExistsInGSC(
            gscCredentials.siteUrl, 
            gscCredentials.token, 
            opp.pageUrl
          );
          
          if (directCheck.exists) {
            console.log(`✅ [Success Stories] "${opp.keyword}": ${oppPath} → FOUND via direct check!`);
            foundStories.push({
              ...opp,
              gscData: {
                impressions: directCheck.impressions,
                clicks: directCheck.clicks,
                position: Math.round(directCheck.position || 0)
              }
            });
          } else {
            console.log(`❌ [Success Stories] "${opp.keyword}": ${oppPath} → NOT FOUND (even with direct check)`);
          }
        } else {
          console.log(`❌ [Success Stories] "${opp.keyword}": ${oppPath} → NOT FOUND (no credentials for direct check)`);
        }
      }
      
      // Calculate additional data for each story
      const stories = foundStories.map(story => {
        const createdAt = new Date(story.createdAt);
        const now = new Date();
        const daysSinceCreated = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
        
        // Handle CTR - it might be a raw number or already formatted
        let ctrFormatted = '0%';
        if (story.gscData?.ctr) {
          if (typeof story.gscData.ctr === 'number') {
            ctrFormatted = `${(story.gscData.ctr * 100).toFixed(1)}%`;
          } else {
            ctrFormatted = story.gscData.ctr;
          }
        }
        
        return {
          ...story,
          position: story.gscData?.position || 0,
          impressions: story.gscData?.impressions || 0,
          clicks: story.gscData?.clicks || 0,
          ctr: ctrFormatted,
          daysSinceCreated,
          gscPage: story.pageUrl,
        };
      }).sort((a, b) => {
        // Sort by impressions (descending) then clicks (descending)
        if (b.impressions !== a.impressions) {
          return b.impressions - a.impressions;
        }
        return b.clicks - a.clicks;
      });

      console.log("🎉 [Success Stories] Found", stories.length, "success stories");
      setSuccessStories(stories);
    };
    
    matchSuccessStories();
  }, [createdOpportunities, gscKeywords, gscCredentials]);

  const fetchGSCKeywords = async (siteUrl, token) => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 90); // 90 days (3 months) for Success Stories to match settling period

    const format = (d) => d.toISOString().split("T")[0];
    const from = format(start);
    const to = format(today);

    console.log(`🔍 Fetching GSC data from ${from} to ${to} for ${siteUrl}`);

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
          rowLimit: 1000, // Increased from 100 to get more keywords
        }),
      }
    );

    const json = await res.json();
    console.log("🔍 GSC Raw Data:", json);
    
    if (!json.rows) {
      console.log("❌ No rows returned from GSC");
      return [];
    }
    
    console.log("✅ GSC returned", json.rows.length, "rows");

    // Format the data the same way as the dashboard
    const formatted = json.rows.map((row) => ({
      keyword: row.keys[0].replace(/^\[|\]$/g, ""),
      page: row.keys[1],
      clicks: row.clicks,
      impressions: row.impressions,
      position: Math.round(row.position),
      ctr: `${(row.ctr * 100).toFixed(1)}%`,
    }));

    return formatted;
  };

  // Check if a specific page URL exists in GSC (for pages with low impressions not in top 1000)
  const checkPageExistsInGSC = async (siteUrl, token, pageUrl) => {
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - 90); // 90 days to match Success Stories data window

    const format = (d) => d.toISOString().split("T")[0];
    const from = format(start);
    const to = format(today);

    // Try both with and without trailing slash
    const urlsToTry = [
      pageUrl,
      pageUrl.endsWith('/') ? pageUrl.slice(0, -1) : pageUrl + '/'
    ];

    console.log(`🔍 [Direct Check] Checking if ${pageUrl} exists in GSC...`);
    console.log(`🔍 [Direct Check] Will try these URLs:`, urlsToTry);

    for (const urlToCheck of urlsToTry) {
      try {
        console.log(`🔍 [Direct Check] Trying: ${urlToCheck}`);
        
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
              dimensions: ["page"],
              dimensionFilterGroups: [{
                filters: [{
                  dimension: "page",
                  operator: "equals",
                  expression: urlToCheck
                }]
              }],
              rowLimit: 1,
            }),
          }
        );

        const json = await res.json();
        console.log(`🔍 [Direct Check] Raw API response for ${urlToCheck}:`, json);
        
        if (json.rows && json.rows.length > 0) {
          const row = json.rows[0];
          console.log(`✅ [Direct Check] Found ${urlToCheck} in GSC: ${row.impressions} impressions, ${row.clicks} clicks`);
          return {
            exists: true,
            impressions: row.impressions,
            clicks: row.clicks,
            ctr: row.ctr,
            position: row.position
          };
        }
        
        console.log(`⚠️ [Direct Check] ${urlToCheck} returned no rows`);
      } catch (error) {
        console.error(`❌ [Direct Check] Error checking ${urlToCheck}:`, error);
      }
    }
    
    // Also try a "contains" search as a fallback
    try {
      const pathname = new URL(pageUrl).pathname.replace(/\/$/, '');
      console.log(`🔍 [Direct Check] Trying CONTAINS search for pathname: ${pathname}`);
      
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
            dimensions: ["page"],
            dimensionFilterGroups: [{
              filters: [{
                dimension: "page",
                operator: "contains",
                expression: pathname
              }]
            }],
            rowLimit: 10,
          }),
        }
      );

      const json = await res.json();
      console.log(`🔍 [Direct Check] CONTAINS search response:`, json);
      
      if (json.rows && json.rows.length > 0) {
        // Find the best matching row
        const row = json.rows[0];
        console.log(`✅ [Direct Check] Found via CONTAINS: ${row.keys[0]} with ${row.impressions} impressions`);
        return {
          exists: true,
          impressions: row.impressions,
          clicks: row.clicks,
          ctr: row.ctr,
          position: row.position
        };
      }
    } catch (error) {
      console.error(`❌ [Direct Check] Error in CONTAINS search:`, error);
    }
    
    console.log(`❌ [Direct Check] ${pageUrl} not found in GSC (tried all methods)`);
    return { exists: false };
  };

  const fetchGenericOpportunitiesFromDashboard = async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      console.log("🔍 Fetching generic opportunities using dashboard approach...", { forceRefresh });
      
      // Call the API directly with empty GSC keywords - the API will generate new ones
      const requestBody = {
        gscKeywords: [], // Empty array - let API generate new keywords
        businessType: data.businessType,
        customBusinessType: data.customBusinessType,
        businessLocation: data.businessLocation,
        websiteUrl: data.websiteUrl,
        userId: user.id, // Add userId for caching
        forceRefresh, // Add forceRefresh flag
      };
      
      console.log("🔍 API request body:", {
        gscKeywordsCount: requestBody.gscKeywords?.length || 0,
        businessType: requestBody.businessType,
        businessLocation: requestBody.businessLocation,
        websiteUrl: requestBody.websiteUrl,
        forceRefresh: requestBody.forceRefresh
      });

      const response = await authenticatedFetch("/api/generic-keywords/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `API error: ${response.status}`);
      }

      const result = await response.json();
      
      console.log("🔍 Generic opportunities result:", result);
      console.log("🔍 Sample opportunity with page data:", result.opportunities?.[0]);
      console.log("🔍 Sample opportunity actionItems:", result.opportunities?.[0]?.actionItems);
      
      if (result.opportunities && result.opportunities.length > 0) {
        setOpportunities(result.opportunities);
        setCannibalizationAnalysis(result.cannibalizationAnalysis || null);
        setFromCache(result.fromCache || false);
        setCacheAge(result.cacheAge || null);
        
        if (forceRefresh) {
          toast.success("Keywords refreshed!", {
            description: "New AI-generated keyword opportunities are now available.",
          });
        }
      } else {
        setError("No generic opportunities found");
      }
    } catch (err) {
      console.error("❌ Failed to fetch generic keywords:", err);
      setError(`Failed to load generic opportunities: ${err.message}`);
      if (forceRefresh) {
        toast.error("Failed to refresh keywords", {
          description: err.message || "Please try again.",
        });
      }
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  const getOpportunityIcon = (category) => {
    switch (category) {
      case 'service_based':
        return <Wrench className="w-4 h-4" />;
      case 'location_based':
        return <MapPin className="w-4 h-4" />;
      case 'problem_solving':
        return <Search className="w-4 h-4" />;
      case 'comparison':
        return <TrendingUp className="w-4 h-4" />;
      case 'trending_search':
        return <Clock className="w-4 h-4" />;
      case 'long_tail':
        return <Target className="w-4 h-4" />;
      default:
        return <Target className="w-4 h-4" />;
    }
  };

  const getPriorityColor = (priority) => {
    if (priority >= 8) return "bg-red-100 text-red-800";
    if (priority >= 6) return "bg-orange-100 text-orange-800";
    if (priority >= 4) return "bg-yellow-100 text-yellow-800";
    return "bg-blue-100 text-blue-800";
  };

  const getDifficultyColor = (difficulty) => {
    if (difficulty === 'Easy') return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    if (difficulty === 'Medium') return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    return "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300";
  };

  const getIntentColor = (intent) => {
    switch (intent) {
      case 'Transactional':
        return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
      case 'Commercial':
        return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
      case 'Informational':
        return "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300";
      case 'Navigational':
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300";
    }
  };

  const getIntentIcon = (intent) => {
    switch (intent) {
      case 'Transactional':
        return "";
      case 'Commercial':
        return "";
      case 'Informational':
        return "";
      case 'Navigational':
        return "";
      default:
        return "";
    }
  };

  const getBuyerReadinessColor = (readiness) => {
    switch (readiness) {
      case 'High':
        return "text-green-600 dark:text-green-400";
      case 'Medium':
        return "text-yellow-600 dark:text-yellow-400";
      case 'Low':
        return "text-red-600 dark:text-red-400";
      default:
        return "text-gray-600 dark:text-gray-400";
    }
  };

  const generateContentOutline = async (opportunity, forceRegenerate = false) => {
    const cacheKey = opportunity.keyword.toLowerCase();
    
    // Check cache first (unless forcing regeneration)
    if (!forceRegenerate && outlineCache.has(cacheKey)) {
      setContentOutline(outlineCache.get(cacheKey));
      return;
    }
    
    setIsGeneratingOutline(true);
    setContentOutline(null);
    
    try {
      const response = await authenticatedFetch("/api/generic-keywords/content-outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: opportunity.keyword,
          pageType: opportunity.pageType?.type || "Service Page",
          businessType: data?.businessType,
          businessLocation: data?.businessLocation,
          businessName: data?.businessName,
          websiteUrl: data?.websiteUrl,
          userId: user?.id, // Pass userId to fetch user's existing pages
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setContentOutline(result.outline);
        
        // Cache the result
        setOutlineCache(prev => {
          const newCache = new Map(prev);
          newCache.set(cacheKey, result.outline);
          return newCache;
        });
      } else {
        toast.error("Failed to generate content outline");
      }
    } catch (error) {
      console.error("Error generating outline:", error);
      toast.error("Failed to generate content outline");
    } finally {
      setIsGeneratingOutline(false);
    }
  };

  const copyToClipboard = async (text, field) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const getVolumeColor = (volume) => {
    if (volume === 'High') return "bg-green-100 text-green-800";
    if (volume === 'Medium-High') return "bg-blue-100 text-blue-800";
    if (volume === 'Medium') return "bg-yellow-100 text-yellow-800";
    return "bg-gray-100 text-gray-800";
  };

  const searchVolumeRank = {
    "Very High": 5,
    "High": 4,
    "Medium-High": 3,
    "Medium": 2,
    "Medium-Low": 1,
    "Low": 0,
  };

  const difficultyRank = {
    Easy: 2,
    Medium: 1,
    Hard: 0,
  };

  const categoryLabels = {
    location_based: "Location-Based Opportunities",
    service_based: "Service-Based Opportunities",
    comparison: "Comparison Opportunities",
    problem_solving: "Problem-Solving Opportunities",
    trending_search: "Trending & Seasonal Ideas",
    long_tail: "Long-Tail Opportunities",
  };

  const sortedOpportunities = useMemo(() => {
    const ranked = [...opportunities];
    ranked.sort((a, b) => {
      const priorityDiff = (b.priority || 0) - (a.priority || 0);
      if (priorityDiff !== 0) return priorityDiff;

      const volumeDiff =
        (searchVolumeRank[b.searchVolume] || -1) -
        (searchVolumeRank[a.searchVolume] || -1);
      if (volumeDiff !== 0) return volumeDiff;

      return (difficultyRank[a.difficulty] || 0) - (difficultyRank[b.difficulty] || 0);
    });
    return ranked;
  }, [opportunities]);

  // Set of skipped keyword names for quick lookup (must be defined first)
  const skippedKeywordSet = useMemo(() => {
    return new Set(skippedKeywords.map(sk => sk.keyword.toLowerCase()));
  }, [skippedKeywords]);

  // Top 3 opportunities - excluding skipped keywords
  const topOpportunities = useMemo(
    () => sortedOpportunities
      .filter(opp => !skippedKeywordSet.has(opp.keyword.toLowerCase()))
      .slice(0, 3),
    [sortedOpportunities, skippedKeywordSet]
  );

  // Set of top 3 keyword names for filtering from the main list
  const topOpportunityKeywords = useMemo(() => {
    return new Set(topOpportunities.map(opp => opp.keyword.toLowerCase()));
  }, [topOpportunities]);

  const filteredOpportunities = useMemo(() => {
    return sortedOpportunities.filter((opp) => {
      // Filter out keywords that are in "Start with these 3"
      if (topOpportunityKeywords.has(opp.keyword.toLowerCase())) {
        return false;
      }

      // Filter out skipped keywords
      if (skippedKeywordSet.has(opp.keyword.toLowerCase())) {
        return false;
      }

      if (categoryFilter !== "all" && opp.category !== categoryFilter) {
        return false;
      }

      if (priorityFilter === "high" && (opp.priority || 0) < 8) return false;
      if (
        priorityFilter === "medium" &&
        ((opp.priority || 0) < 6 || (opp.priority || 0) > 7)
      )
        return false;
      if (priorityFilter === "lower" && (opp.priority || 0) >= 6) return false;

      return true;
    });
  }, [sortedOpportunities, categoryFilter, priorityFilter, skippedKeywordSet, topOpportunityKeywords]);

  const groupedOpportunities = useMemo(() => {
    return filteredOpportunities.reduce((acc, opportunity) => {
      const category = opportunity.category || "other";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(opportunity);
      return acc;
    }, {});
  }, [filteredOpportunities]);

  const categoryOrder = [
    "location_based",
    "service_based",
    "problem_solving",
    "comparison",
    "trending_search",
    "long_tail",
    "other",
  ];

  useEffect(() => {
    setOpenCategories((prev) => {
      const next = { ...prev };
      Object.keys(groupedOpportunities).forEach((category) => {
        if (typeof next[category] === "undefined") {
          next[category] = categoryFilter === "all";
        }
      });
      return next;
    });
  }, [groupedOpportunities, categoryFilter]);

  const filterOptions = [
    { value: "all", label: "All Opportunities", count: sortedOpportunities.filter(o => 
      !topOpportunityKeywords.has(o.keyword.toLowerCase()) && 
      !skippedKeywordSet.has(o.keyword.toLowerCase())
    ).length },
    {
      value: "location_based",
      label: "Location-Based",
      count: sortedOpportunities.filter((o) => 
        o.category === "location_based" && 
        !topOpportunityKeywords.has(o.keyword.toLowerCase()) &&
        !skippedKeywordSet.has(o.keyword.toLowerCase())
      ).length,
    },
    {
      value: "service_based",
      label: "Service-Based",
      count: sortedOpportunities.filter((o) => 
        o.category === "service_based" && 
        !topOpportunityKeywords.has(o.keyword.toLowerCase()) &&
        !skippedKeywordSet.has(o.keyword.toLowerCase())
      ).length,
    },
    {
      value: "comparison",
      label: "Comparison",
      count: sortedOpportunities.filter((o) => 
        o.category === "comparison" && 
        !topOpportunityKeywords.has(o.keyword.toLowerCase()) &&
        !skippedKeywordSet.has(o.keyword.toLowerCase())
      ).length,
    },
    {
      value: "problem_solving",
      label: "Problem-Solving",
      count: sortedOpportunities.filter((o) => 
        o.category === "problem_solving" && 
        !topOpportunityKeywords.has(o.keyword.toLowerCase()) &&
        !skippedKeywordSet.has(o.keyword.toLowerCase())
      ).length,
    },
    {
      value: "trending_search",
      label: "Trending Search",
      count: sortedOpportunities.filter((o) => 
        o.category === "trending_search" && 
        !topOpportunityKeywords.has(o.keyword.toLowerCase()) &&
        !skippedKeywordSet.has(o.keyword.toLowerCase())
      ).length,
    },
    {
      value: "long_tail",
      label: "Long-Tail",
      count: sortedOpportunities.filter((o) => 
        o.category === "long_tail" && 
        !topOpportunityKeywords.has(o.keyword.toLowerCase()) &&
        !skippedKeywordSet.has(o.keyword.toLowerCase())
      ).length,
    },
  ];

  const priorityFilters = [
    { value: "all", label: "All Priorities" },
    { value: "high", label: "High (8-10)" },
    { value: "medium", label: "Medium (6-7)" },
    { value: "lower", label: "Lower (≤5)" },
  ];

  const renderOpportunityCard = (opportunity, key, { isFeatured = false } = {}) => (
    <Card
      key={key}
      className={cn(
        "hover:shadow-md transition-shadow",
        isFeatured && "bg-primary/5 dark:bg-primary/10"
      )}
    >
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4">
          {/* Header with keyword and badges */}
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div className="flex items-start gap-3">
              {getOpportunityIcon(opportunity.category)}
              <div>
                <h3 className="font-semibold text-lg leading-tight">
                  {opportunity.keyword}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {categoryLabels[opportunity.category] || "Growth Opportunity"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              {/* Page Type Badge - Color matches wireframe */}
              {opportunity.pageType?.type && (
                <Badge className={cn(
                  "bg-gradient-to-r text-white border-0 font-medium",
                  getPageTypeColor(opportunity.pageType.type)
                )}>
                   {opportunity.pageType.type}
                </Badge>
              )}
              {/* Intent Badge */}
              {opportunity.intent?.category && (
                <Badge className={getIntentColor(opportunity.intent.category)}>
                  {getIntentIcon(opportunity.intent.category)} {opportunity.intent.category}
                </Badge>
              )}
              {/* Difficulty Score Badge */}
              {opportunity.difficultyAnalysis?.score && (
                <Badge className={getDifficultyColor(opportunity.difficultyAnalysis.label)}>
                  Difficulty: {opportunity.difficultyAnalysis.score}/10
                </Badge>
              )}
              <Badge className={getPriorityColor(opportunity.priority)}>
                Priority {opportunity.priority}
              </Badge>
              <Badge className={getVolumeColor(opportunity.searchVolume)}>
                {opportunity.searchVolume} Volume
              </Badge>
            </div>
          </div>

          {/* Intent & Buyer Readiness Info */}
          {opportunity.intent && (
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 p-4 rounded-lg border border-blue-100 dark:border-blue-800/30">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
                  <Search className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-semibold text-blue-800 dark:text-blue-200">
                      Search Intent: {opportunity.intent.category}
                    </p>
                    {opportunity.intent.buyerReadiness && (
                      <span className={cn("text-xs font-medium", getBuyerReadinessColor(opportunity.intent.buyerReadiness))}>
                        • {opportunity.intent.buyerReadiness} Buyer Readiness
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {opportunity.intent.explanation}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Why This Keyword Matters */}
          {opportunity.valueExplanation && (
            <div className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 p-4 rounded-lg border border-green-100 dark:border-green-800/30">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-green-100 dark:bg-green-900/40 rounded-lg">
                  <Lightbulb className="w-4 h-4 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-green-800 dark:text-green-200 mb-1">
                    Why This Keyword Matters
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-300">
                    {opportunity.valueExplanation}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Page Type Recommendation */}
          {opportunity.pageType && (
            <div className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/20 dark:to-pink-900/20 p-4 rounded-lg border border-purple-100 dark:border-purple-800/30">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-purple-100 dark:bg-purple-900/40 rounded-lg">
                  <FileText className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-purple-800 dark:text-purple-200 mb-1">
                    Recommended: Create a {opportunity.pageType.type}
                  </p>
                  <p className="text-sm text-purple-700 dark:text-purple-300 mb-2">
                    {opportunity.pageType.reason}
                  </p>
                  {opportunity.pageType.suggestedUrl && (
                    <p className="text-xs text-purple-600 dark:text-purple-400 font-mono bg-purple-100 dark:bg-purple-900/40 px-2 py-1 rounded inline-block">
                      Suggested URL: {opportunity.pageType.suggestedUrl}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Difficulty Analysis */}
          {opportunity.difficultyAnalysis && (
            <div className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-900/20 dark:to-amber-900/20 p-4 rounded-lg border border-orange-100 dark:border-orange-800/30">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-orange-100 dark:bg-orange-900/40 rounded-lg">
                  <TrendingUp className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <p className="text-sm font-semibold text-orange-800 dark:text-orange-200">
                      SEO Difficulty: {opportunity.difficultyAnalysis.label} ({opportunity.difficultyAnalysis.score}/10)
                    </p>
                    {/* Visual difficulty bar */}
                    <div className="flex-1 max-w-32 h-2 bg-orange-200 dark:bg-orange-900/40 rounded-full overflow-hidden">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all",
                          opportunity.difficultyAnalysis.score <= 3 ? "bg-green-500" :
                          opportunity.difficultyAnalysis.score <= 6 ? "bg-yellow-500" : "bg-red-500"
                        )}
                        style={{ width: `${opportunity.difficultyAnalysis.score * 10}%` }}
                      />
                    </div>
                  </div>
                  <p className="text-sm text-orange-700 dark:text-orange-300">
                    {opportunity.difficultyAnalysis.explanation}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Content Strategy */}
          {opportunity.contentIdea && (
            <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
              <div className="flex items-start gap-2">
                <Target className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                    Content Strategy
                  </p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {opportunity.contentIdea}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Recommended Actions */}
          {opportunity.actionItems?.length > 0 && (
            <Collapsible
              open={!!openActionItems[key]}
              onOpenChange={(open) =>
                setOpenActionItems((prev) => ({ ...prev, [key]: open }))
              }
            >
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <div className="flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                    <span className="text-sm font-medium">Recommended Actions ({opportunity.actionItems.length})</span>
                  </div>
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent
                forceMount
                className="overflow-hidden"
                style={{
                  maxHeight: openActionItems[key] ? "1200px" : "0px",
                  opacity: openActionItems[key] ? 1 : 0,
                  marginTop: openActionItems[key] ? "0.5rem" : "0px",
                  pointerEvents: openActionItems[key] ? "auto" : "none",
                  transition: "max-height 300ms ease, opacity 300ms ease, margin 300ms ease",
                }}
              >
                <div className="bg-purple-50 dark:bg-purple-900/20 p-3 rounded-lg">
                  <ul className="text-sm text-foreground space-y-2">
                    {opportunity.actionItems.map((action, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-purple-600 dark:text-purple-400 mt-0.5 font-bold">{idx + 1}.</span>
                        <span>{action}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Action Buttons */}
          <div className="pt-4 border-t border-border flex flex-wrap gap-2">
            {/* Generate Content Outline Button - Disabled if already created */}
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                setContentOutlineDialog({ open: true, opportunity });
                generateContentOutline(opportunity);
              }}
              disabled={createdOpportunities.some(co => co.keyword.toLowerCase() === opportunity.keyword.toLowerCase())}
              className="gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" />
              Generate Content Outline
            </Button>

            {/* Mark as Created Button */}
            {!createdOpportunities.some(co => co.keyword.toLowerCase() === opportunity.keyword.toLowerCase()) ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setMarkAsCreatedDialog({ open: true, opportunity });
                  setMarkAsCreatedUrl("");
                }}
                className="gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Mark as Created
              </Button>
            ) : (
              <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 px-3 py-1.5 bg-green-50 dark:bg-green-900/20 rounded-md">
                <CheckCircle className="w-4 h-4" />
                <span>Created</span>
              </div>
            )}

            {/* Skip Button - Only show if not already created */}
            {!createdOpportunities.some(co => co.keyword.toLowerCase() === opportunity.keyword.toLowerCase()) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSkipKeyword(opportunity.keyword)}
                className="gap-2 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <X className="w-4 h-4" />
                Skip
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (isLoading || !user) return null;

  if (shouldShowLoader) {
    return (
      <MainLayout>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">Generic Keyword Opportunities</h1>
          <Button onClick={() => window.history.back()} variant="outline">
            Back to Dashboard
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <SquashBounceLoader size="lg" className="mb-4" />
              <p className="text-muted-foreground">Loading generic opportunities...</p>
            </div>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">AI-Generated Content Opportunities</h1>
          <p className="text-muted-foreground mt-2">
            Discover new keywords and content ideas to expand your reach and attract new customers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => window.history.back()} variant="outline">
            Back to Dashboard
          </Button>
        </div>
      </div>

      {/* Dummy Success Story Card - For Preview Only */}
      {/* <Card className="mb-6 border-green-200 bg-green-50 dark:border-green-900/20 dark:bg-green-900/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-green-800 dark:text-green-200">
            <CheckCircle className="w-5 h-5" />
            Success Stories - Your Pages Are Ranking!
          </CardTitle>
          <CardDescription className="text-green-700 dark:text-green-300">
            Pages you created are now appearing in Google Search Console
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-green-200 dark:border-green-800">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h4 className="font-semibold text-green-800 dark:text-green-200">
                      best dentist independence
                    </h4>
                    <Badge variant="outline" className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                      Ranking
                    </Badge>
                  </div>
                  <a
                    href="https://example.com/best-dentist-independence"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-green-700 dark:text-green-300 hover:underline flex items-center gap-1 mb-2"
                  >
                    https://example.com/best-dentist-independence
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-green-700 dark:text-green-300">
                    <span>
                      <strong>Position:</strong> 12
                    </span>
                    <span>
                      <strong>Impressions:</strong> 1,250
                    </span>
                    <span>
                      <strong>Clicks:</strong> 45
                    </span>
                    <span>
                      <strong>CTR:</strong> 3.6%
                    </span>
                    <span className="text-xs text-green-600 dark:text-green-400">
                      Created 7 days ago
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card> */}

      {/* Success Stories Section */}
      {successStories.length > 0 && (
        <Card className="mb-6 border-green-200 bg-green-50 dark:border-green-900/20 dark:bg-green-900/10">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-800 dark:text-green-200">
              <CheckCircle className="w-5 h-5" />
               Success Stories - Your Pages Are Ranking!
            </CardTitle>
            <CardDescription className="text-green-700 dark:text-green-300">
              Pages you created are now appearing in Google Search Console
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {successStories.map((story, index) => {
                // Calculate settling period progress
                const daysProgress = Math.min(story.daysSinceCreated / SETTLING_DAYS_REQUIRED, 1);
                const impressionsProgress = Math.min(story.impressions / SETTLING_IMPRESSIONS_REQUIRED, 1);
                const overallProgress = ((daysProgress + impressionsProgress) / 2) * 100;
                
                const daysRemaining = Math.max(SETTLING_DAYS_REQUIRED - story.daysSinceCreated, 0);
                const impressionsRemaining = Math.max(SETTLING_IMPRESSIONS_REQUIRED - story.impressions, 0);
                
                const isSettled = story.daysSinceCreated >= SETTLING_DAYS_REQUIRED && story.impressions >= SETTLING_IMPRESSIONS_REQUIRED;
                
                const storyKey = `${story.keyword.toLowerCase()}_${story.pageUrl}`;
                const isAlreadyAdded = addedToFocusKeywords.has(storyKey);
                const isAdding = addingToFocusKeyword === storyKey;
                
                return (
                  <div
                    key={story.id || index}
                    className="bg-background p-4 rounded-lg border border-green-200 dark:border-green-800"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-semibold text-green-800 dark:text-green-200">
                            {story.keyword}
                          </h4>
                          <Badge variant="outline" className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-200">
                            Ranking
                          </Badge>
                        </div>
                        <a
                          href={story.pageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-green-700 dark:text-green-300 hover:underline flex items-center gap-1 mb-2"
                        >
                          {story.pageUrl}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                        <div className="flex flex-wrap items-center gap-4 text-sm text-green-700 dark:text-green-300">
                          <span>
                            <strong>Position:</strong> {story.position}
                          </span>
                          <span>
                            <strong>Impressions:</strong> {story.impressions.toLocaleString()}
                          </span>
                          <span>
                            <strong>Clicks:</strong> {story.clicks.toLocaleString()}
                          </span>
                          <span>
                            <strong>CTR:</strong> {story.ctr}
                          </span>
                          <span className="text-xs text-green-600 dark:text-green-400">
                            Created {story.daysSinceCreated} {story.daysSinceCreated === 1 ? 'day' : 'days'} ago
                          </span>
                        </div>
                        
                        {/* Settling Period / Add to Focus Keywords Section */}
                        <div className="mt-4 pt-3 border-t border-green-200 dark:border-green-800">
                          {isSettled ? (
                            // Page has settled - show Add to Focus Keywords button
                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                                <CheckCircle className="w-4 h-4" />
                                <span className="text-sm font-medium">Ready to optimize!</span>
                              </div>
                              {isAlreadyAdded ? (
                                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 px-3 py-1.5 bg-green-100 dark:bg-green-900/30 rounded-md">
                                  <Check className="w-4 h-4" />
                                  <span>Added to Focus Keywords</span>
                                </div>
                              ) : (
                                <Button
                                  size="sm"
                                  onClick={() => handleAddToFocusKeywords(story)}
                                  disabled={isAdding}
                                  className="gap-2 bg-green-600 hover:bg-green-700"
                                >
                                  {isAdding ? (
                                    <>
                                      <Loader2 className="w-4 h-4 animate-spin" />
                                      Adding...
                                    </>
                                  ) : (
                                    <>
                                      <Plus className="w-4 h-4" />
                                      Add to Focus Keywords
                                    </>
                                  )}
                                </Button>
                              )}
                            </div>
                          ) : (
                            // Page is still settling - show progress
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                                <Clock className="w-4 h-4" />
                                <span className="text-sm font-medium">Settling Period</span>
                                <span className="text-xs text-muted-foreground">
                                  Let this page find its ranking before optimizing
                                </span>
                              </div>
                              
                              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                                {daysRemaining > 0 && (
                                  <span className={daysRemaining === 0 ? "text-green-600 dark:text-green-400" : ""}>
                                    • {daysRemaining} more {daysRemaining === 1 ? 'day' : 'days'} needed ({SETTLING_DAYS_REQUIRED} day minimum)
                                  </span>
                                )}
                                {daysRemaining === 0 && (
                                  <span className="text-green-600 dark:text-green-400">
                                    • ✓ {SETTLING_DAYS_REQUIRED} days reached
                                  </span>
                                )}
                                {impressionsRemaining > 0 && (
                                  <span className={impressionsRemaining === 0 ? "text-green-600 dark:text-green-400" : ""}>
                                    • {impressionsRemaining} more impressions needed ({SETTLING_IMPRESSIONS_REQUIRED} minimum)
                                  </span>
                                )}
                                {impressionsRemaining === 0 && (
                                  <span className="text-green-600 dark:text-green-400">
                                    • ✓ {SETTLING_IMPRESSIONS_REQUIRED}+ impressions reached
                                  </span>
                                )}
                              </div>
                              
                              <div className="flex items-center gap-2">
                                <Progress value={overallProgress} className="h-2 flex-1" />
                                <span className="text-xs font-medium text-muted-foreground w-10">
                                  {Math.round(overallProgress)}%
                                </span>
                              </div>
                              
                              {/* Boost Visibility Recommendation - Shows after 30 days if impressions are low */}
                              {story.daysSinceCreated >= BOOST_VISIBILITY_DAYS_THRESHOLD && 
                               story.impressions < BOOST_VISIBILITY_IMPRESSIONS_THRESHOLD && (() => {
                                const navRec = getNavigationRecommendation(story.pageUrl, story.keyword);
                                if (!navRec) return null;
                                
                                return (
                                  <div className="mt-3 p-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                                    <div className="flex items-start gap-2">
                                      <span className="text-lg">{navRec.icon}</span>
                                      <div className="flex-1">
                                        <p className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                                          Not Getting Enough Impressions After 30+ Days: Add This <strong>&quot;{navRec.placement}&quot;</strong> Page to Your Navigation
                                        </p>
                                        <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                                          {navRec.suggestion}
                                        </p>
                                        <p className="text-xs text-blue-600 dark:text-blue-400 italic">
                                          {navRec.reason}
                                        </p>
                                        <div className="mt-2 flex items-center gap-2">
                                          <Badge variant="outline" className="text-[10px] bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border-blue-300">
                                            {story.impressions} impressions in {story.daysSinceCreated} days
                                          </Badge>
                                          {/* <span className="text-[10px] text-blue-600 dark:text-blue-400">
                                            Internal links help Google crawl your page more often
                                          </span> */}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Your Created Pages Section - Shows pages waiting to rank */}
      {(() => {
        // Filter out pages that are already in Success Stories
        const successStoryUrls = new Set(successStories.map(s => s.pageUrl.toLowerCase()));
        const pendingPages = createdOpportunities.filter(
          opp => !successStoryUrls.has(opp.pageUrl.toLowerCase())
        );
        
        if (pendingPages.length === 0) return null;
        
        return (
          <Card className="mb-6 border-blue-200 bg-blue-50 dark:border-blue-900/20 dark:bg-blue-900/10">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-800 dark:text-blue-200">
                <Clock className="w-5 h-5" />
                Your Created Pages - Waiting to Rank
              </CardTitle>
              <CardDescription className="text-blue-700 dark:text-blue-300">
                Pages you&apos;ve created that are waiting to appear in Google Search Console. This can take a few days to a few weeks.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {pendingPages.map((page, index) => {
                  const createdAt = new Date(page.createdAt);
                  const now = new Date();
                  const daysSinceCreated = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
                  
                  return (
                    <div
                      key={page.id || index}
                      className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-blue-200 dark:border-blue-800"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold text-blue-800 dark:text-blue-200">
                              {page.keyword}
                            </h4>
                            <Badge variant="outline" className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-200">
                              Waiting
                            </Badge>
                          </div>
                          <a
                            href={page.pageUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-700 dark:text-blue-300 hover:underline flex items-center gap-1 mb-2"
                          >
                            {page.pageUrl}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                          <div className="flex flex-wrap items-center gap-4 text-sm text-blue-700 dark:text-blue-300">
                            <span className="text-xs text-blue-600 dark:text-blue-400">
                              Created {daysSinceCreated} {daysSinceCreated === 1 ? 'day' : 'days'} ago
                            </span>
                            {daysSinceCreated < 7 && (
                              <span className="text-xs text-blue-500 dark:text-blue-400">
                                • Usually takes 1-2 weeks to appear in GSC
                              </span>
                            )}
                            {daysSinceCreated >= 7 && daysSinceCreated < 14 && (
                              <span className="text-xs text-yellow-600 dark:text-yellow-400">
                                • Should appear soon - Google is indexing
                              </span>
                            )}
                            {daysSinceCreated >= 14 && (
                              <span className="text-xs text-orange-600 dark:text-orange-400 flex items-center gap-1">
                                • Check if page is indexed in Google
                                <button
                                  onClick={() => setIndexingHelpModal({ open: true, pageUrl: page.pageUrl })}
                                  className="underline text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 font-medium"
                                >
                                  (Need Help?)
                                </button>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Keyword Cannibalization Analysis */}
      {cannibalizationAnalysis && cannibalizationAnalysis.totalCannibalized > 0 && (
        <Card className="mb-6 border-orange-200 bg-orange-50 dark:bg-orange-900/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-800 dark:text-orange-200">
              <AlertTriangle className="w-5 h-5" />
              Keyword Cannibalization Detected
            </CardTitle>
            <CardDescription className="text-orange-700 dark:text-orange-300">
              {cannibalizationAnalysis.summary}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {cannibalizationAnalysis.cannibalizedKeywords.slice(0, 6).map((item, index) => (
                  <div key={index} className="p-3 bg-white dark:bg-gray-800 rounded-lg border border-orange-200">
                    <h4 className="font-semibold text-orange-800 dark:text-orange-200 mb-2">
                      &quot;{item.keyword}&quot;
                    </h4>
                    <p className="text-sm text-orange-700 dark:text-orange-300 mb-2">
                      {item.recommendation}
                    </p>
                    <div className="text-xs text-gray-600 dark:text-gray-400">
                      <p>Appears on {item.pages.length} pages:</p>
                      <ul className="list-disc list-inside mt-1">
                        {item.pages.map((page, idx) => (
                          <li key={idx}>
                            {page.page} (Pos: {page.position}, CTR: {page.ctr})
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ))}
              </div>
              {cannibalizationAnalysis.totalCannibalized > 6 && (
                <p className="text-sm text-orange-600 dark:text-orange-400">
                  ... and {cannibalizationAnalysis.totalCannibalized - 6} more cannibalized keywords
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}


      {error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-6">
              <div className="bg-muted inline-flex items-center justify-center w-12 h-12 rounded-full mb-3">
                <Target className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button
                onClick={fetchGenericOpportunitiesFromDashboard}
                variant="outline"
                size="sm"
                className="mt-2"
              >
                Try Again
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Page Type Visual Guide */}
          <Card className="mb-6 border-border/50 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900/50 dark:to-slate-800/50">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <LayoutGrid className="w-5 h-5 text-primary" />
                Page Type Visual Guide
              </CardTitle>
              <CardDescription>
                Click a page type to see layout tips. Your recommended pages are highlighted.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap justify-center gap-4">
                {Object.entries(pageTypeWireframes).map(([type, config]) => {
                  // Check if this page type is in the top opportunities
                  const isHighlighted = topOpportunities.some(
                    opp => opp.pageType?.type === type
                  );
                  const isSelected = selectedWireframe === type;
                  
                  return (
                    <button
                      key={type}
                      onClick={() => setSelectedWireframe(isSelected ? null : type)}
                      className={cn(
                        "relative group transition-all duration-200",
                        isSelected && "scale-105",
                        isHighlighted && !isSelected && "ring-2 ring-primary ring-offset-2 rounded-xl"
                      )}
                    >
                      {/* Wireframe Visual */}
                      <div className={cn(
                        "w-28 h-36 md:w-40 md:h-48 rounded-xl p-2 md:p-3 bg-gradient-to-br shadow-md transition-all",
                        config.color,
                        isSelected ? "shadow-lg" : "group-hover:shadow-lg group-hover:scale-[1.02]"
                      )}>
                        {/* Page Type Label */}
                        <div className="text-[10px] md:text-xs font-bold text-white/90 mb-1.5 md:mb-2 text-center uppercase tracking-wide">
                          {config.label}
                        </div>
                        
                        {/* Wireframe Content */}
                        <div className="bg-white/20 rounded-lg p-1.5 md:p-2 h-[calc(100%-20px)] md:h-[calc(100%-28px)] flex flex-col gap-1 md:gap-1.5">
                          {/* Nav bar */}
                          <div className="h-1.5 md:h-2 bg-white/40 rounded-full w-full" />
                          
                          {type === "Service Page" && (
                            <>
                              <div className="h-6 md:h-10 bg-amber-300/80 rounded w-full" />
                              <div className="h-1 md:h-1.5 bg-white/50 rounded w-3/4" />
                              <div className="h-1 md:h-1.5 bg-white/50 rounded w-1/2" />
                              <div className="flex gap-0.5 md:gap-1 flex-1">
                                <div className="flex-1 bg-white/30 rounded" />
                                <div className="flex-1 bg-white/30 rounded" />
                                <div className="flex-1 bg-white/30 rounded" />
                              </div>
                              <div className="h-2.5 md:h-4 bg-emerald-400/80 rounded w-1/2 mx-auto" />
                            </>
                          )}
                          
                          {type === "Local Landing Page" && (
                            <>
                              <div className="h-8 md:h-12 bg-amber-300/80 rounded w-full" />
                              <div className="h-1 md:h-1.5 bg-white/50 rounded w-2/3 mx-auto" />
                              <div className="h-3 md:h-5 bg-emerald-400/80 rounded w-2/3 mx-auto" />
                              <div className="flex gap-0.5 md:gap-1">
                                <div className="flex-1 h-3 md:h-5 bg-white/30 rounded" />
                                <div className="flex-1 h-3 md:h-5 bg-white/30 rounded" />
                              </div>
                              <div className="h-2 md:h-3 bg-white/30 rounded w-full" />
                            </>
                          )}
                          
                          {type === "Blog Article" && (
                            <>
                              <div className="h-5 md:h-8 bg-amber-300/80 rounded w-full" />
                              <div className="h-1 md:h-1.5 bg-white/50 rounded w-full" />
                              <div className="h-1 md:h-1.5 bg-white/50 rounded w-full" />
                              <div className="h-1 md:h-1.5 bg-white/50 rounded w-3/4" />
                              <div className="h-1.5 md:h-2 bg-white/40 rounded w-1/2" />
                              <div className="h-1 md:h-1.5 bg-white/50 rounded w-full" />
                              <div className="h-1 md:h-1.5 bg-white/50 rounded w-5/6" />
                            </>
                          )}
                          
                          {type === "FAQ Page" && (
                            <>
                              <div className="h-3 md:h-5 bg-amber-300/80 rounded w-2/3 mx-auto" />
                              <div className="space-y-0.5 md:space-y-1 flex-1">
                                <div className="h-2.5 md:h-4 bg-white/40 rounded w-full" />
                                <div className="h-2.5 md:h-4 bg-white/30 rounded w-full" />
                                <div className="h-2.5 md:h-4 bg-white/40 rounded w-full" />
                                <div className="h-2.5 md:h-4 bg-white/30 rounded w-full" />
                              </div>
                              <div className="h-2 md:h-3 bg-emerald-400/80 rounded w-1/2 mx-auto" />
                            </>
                          )}
                          
                          {type === "Pricing Page" && (
                            <>
                              <div className="h-2.5 md:h-4 bg-amber-300/80 rounded w-2/3 mx-auto" />
                              <div className="flex gap-0.5 md:gap-1 flex-1">
                                <div className="flex-1 bg-white/30 rounded flex flex-col items-center justify-end pb-0.5 md:pb-1">
                                  <div className="w-2/3 h-1.5 md:h-2.5 bg-white/50 rounded" />
                                </div>
                                <div className="flex-1 bg-emerald-400/50 rounded flex flex-col items-center justify-end pb-0.5 md:pb-1">
                                  <div className="w-2/3 h-1.5 md:h-2.5 bg-white/70 rounded" />
                                </div>
                                <div className="flex-1 bg-white/30 rounded flex flex-col items-center justify-end pb-0.5 md:pb-1">
                                  <div className="w-2/3 h-1.5 md:h-2.5 bg-white/50 rounded" />
                                </div>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* Highlighted indicator */}
                      {isHighlighted && (
                        <div className="absolute -top-2 -right-2 md:-top-2.5 md:-right-2.5 bg-primary text-primary-foreground text-[9px] md:text-xs font-bold px-1.5 md:px-2 py-0.5 md:py-1 rounded-full">
                          ★
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
              
              {/* Layout Tips Panel */}
              {selectedWireframe && pageTypeWireframes[selectedWireframe] && (
                <div className="mt-4 p-4 bg-white dark:bg-slate-800 rounded-xl border border-border shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={cn(
                      "w-3 h-3 rounded-full bg-gradient-to-br",
                      pageTypeWireframes[selectedWireframe].color
                    )} />
                    <h4 className="font-semibold text-sm">
                      {pageTypeWireframes[selectedWireframe].label} Layout Tips
                    </h4>
                  </div>
                  <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {pageTypeWireframes[selectedWireframe].tips.map((tip, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <span className="text-primary mt-0.5">•</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Skipped Keywords Section */}
          {skippedKeywords.length > 0 && (
            <Card className="mb-6 border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                      <X className="w-5 h-5" />
                      Skipped Keywords ({skippedKeywords.length})
                    </CardTitle>
                    <CardDescription className="text-gray-600 dark:text-gray-400">
                      Keywords you&apos;ve chosen to skip. You can restore them anytime.
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowSkipped(!showSkipped)}
                    className="text-gray-600 dark:text-gray-400"
                  >
                    {showSkipped ? "Hide" : "Show"}
                    <ChevronDown className={cn("w-4 h-4 ml-1 transition-transform", showSkipped && "rotate-180")} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent
                className="overflow-hidden"
                style={{
                  maxHeight: showSkipped ? "1200px" : "0px",
                  opacity: showSkipped ? 1 : 0,
                  padding: showSkipped ? "1rem" : "0px",
                  pointerEvents: showSkipped ? "auto" : "none",
                  transition: "max-height 300ms ease, opacity 300ms ease, padding 300ms ease",
                }}
              >
                <div className="space-y-2">
                  {skippedKeywords.map((skipped, index) => (
                    <div
                      key={skipped.id || index}
                      className="flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700"
                    >
                      <div>
                        <p className="font-medium text-gray-700 dark:text-gray-300">
                          {skipped.keyword}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Skipped {new Date(skipped.skippedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleRestoreKeyword(skipped.keyword)}
                        className="gap-2"
                      >
                        <RotateCcw className="w-4 h-4" />
                        Restore
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {topOpportunities.length > 0 && (
            <Card className="mb-6 border-primary/20 shadow-sm">
              <CardHeader className="pb-4">
                <CardTitle className="text-xl">Start with these 3</CardTitle>
                <CardDescription>
                  Highest-priority ideas right now. Tackle these first for the fastest impact.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {topOpportunities.map((opportunity, index) =>
                  renderOpportunityCard(opportunity, `${opportunity.keyword}-featured-${index}`, {
                    isFeatured: true,
                  })
                )}
              </CardContent>
            </Card>
          )}

          {/* Filter Options */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-2 mb-4">
                {filterOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={categoryFilter === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCategoryFilter(option.value)}
                    className="flex items-center gap-2"
                  >
                    <Filter className="w-4 h-4" />
                    {option.label}
                    <Badge variant="secondary" className="ml-1">
                      {option.count}
                    </Badge>
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {priorityFilters.map((option) => (
                  <Button
                    key={option.value}
                    variant={priorityFilter === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPriorityFilter(option.value)}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              
              {/* Cache Status Indicator */}
              {fromCache && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-4 pt-4 border-t border-border">
                  <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                  <span>
                    Cached data loaded {cacheAge ? `(${cacheAge} hours old)` : ''}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Opportunities List */}
          <div className="space-y-6">
            {filteredOpportunities.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <Target className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">
                      No opportunities match your current filters. Try selecting a different category or widen the priority/difficulty filters.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-5">
                {categoryOrder
                  .filter((category) => groupedOpportunities[category]?.length)
                  .map((category) => {
                    const items = groupedOpportunities[category];
                    return (
                      <Collapsible
                        key={category}
                        open={openCategories[category]}
                        onOpenChange={(open) =>
                          setOpenCategories((prev) => ({
                            ...prev,
                            [category]: open,
                          }))
                        }
                      >
                        <div className="rounded-lg border bg-muted/40 dark:bg-muted/20">
                          <CollapsibleTrigger asChild>
                            <button className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold">
                              <span>
                                {categoryLabels[category] || "Additional Opportunities"}
                              </span>
                              <div className="flex items-center gap-3 text-sm">
                                <Badge variant="secondary">{items.length}</Badge>
                                <ChevronDown
                                  className={`h-4 w-4 transition-transform ${
                                    openCategories[category] ? "rotate-180" : ""
                                  }`}
                                />
                              </div>
                            </button>
                          </CollapsibleTrigger>
                          <CollapsibleContent
                            forceMount
                            className="overflow-hidden px-4 pb-0 pt-0"
                            style={{
                              maxHeight: openCategories[category] ? "2000px" : "0px",
                              opacity: openCategories[category] ? 1 : 0,
                              paddingTop: openCategories[category] ? "0.5rem" : "0px",
                              paddingBottom: openCategories[category] ? "1rem" : "0px",
                              pointerEvents: openCategories[category] ? "auto" : "none",
                              transition: "max-height 300ms ease, opacity 300ms ease, padding 300ms ease",
                            }}
                          >
                            {items.map((opportunity, index) =>
                              renderOpportunityCard(
                                opportunity,
                                `${opportunity.keyword}-${category}-${index}`
                              )
                            )}
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
              </div>
            )}
          </div>
        </>
      )}

      {/* Content Outline Dialog */}
      <Dialog open={contentOutlineDialog.open} onOpenChange={(open) => {
        if (!open) {
          setContentOutlineDialog({ open: false, opportunity: null });
          setContentOutline(null);
        }
      }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-purple-600" />
              Content Outline for &quot;{contentOutlineDialog.opportunity?.keyword}&quot;
            </DialogTitle>
            <DialogDescription>
              Use this AI-generated outline to create a <span className="font-bold">New Page</span> on your website that is SEO-optimized.
            </DialogDescription>
          </DialogHeader>
          
          {isGeneratingOutline ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600 mb-4" />
              <p className="text-muted-foreground">Generating your content outline...</p>
              <p className="text-xs text-muted-foreground mt-2">This may take a few seconds</p>
            </div>
          ) : contentOutline ? (
            <div className="space-y-6 py-4">
              {/* Cache indicator */}
              {outlineCache.has(contentOutlineDialog.opportunity?.keyword?.toLowerCase()) && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
                  <Check className="w-3 h-3 text-green-500" />
                  <span>Loaded from cache • Click &quot;Regenerate&quot; for a fresh outline</span>
                </div>
              )}

              {/* Focus Keyword */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center justify-between">
                  Focus Keyword
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(contentOutlineDialog.opportunity?.keyword || '', 'focusKeyword')}
                    className="h-6 px-2"
                  >
                    {copiedField === 'focusKeyword' ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </Label>
                <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 rounded-lg border-2 border-amber-300 dark:border-amber-700">
                  <p className="font-bold text-lg text-amber-900 dark:text-amber-100">
                    {contentOutlineDialog.opportunity?.keyword}
                  </p>
                </div>
              </div>

              {/* H1 Title */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center justify-between">
                  H1 (Main Title)
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(contentOutline.h1, 'h1')}
                    className="h-6 px-2"
                  >
                    {copiedField === 'h1' ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </Label>
                <div className="p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                  <p className="font-semibold text-purple-900 dark:text-purple-100">{contentOutline.h1}</p>
                </div>
              </div>

              {/* Meta Title */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center justify-between">
                  Meta Title (60 chars max)
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(contentOutline.metaTitle, 'metaTitle')}
                    className="h-6 px-2"
                  >
                    {copiedField === 'metaTitle' ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </Label>
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                  <p className="text-blue-900 dark:text-blue-100">{contentOutline.metaTitle}</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                    {contentOutline.metaTitle?.length || 0}/60 characters
                  </p>
                </div>
              </div>

              {/* Meta Description */}
              <div className="space-y-2">
                <Label className="text-sm font-semibold flex items-center justify-between">
                  Meta Description (155 chars max)
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(contentOutline.metaDescription, 'metaDescription')}
                    className="h-6 px-2"
                  >
                    {copiedField === 'metaDescription' ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
                  </Button>
                </Label>
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                  <p className="text-green-900 dark:text-green-100">{contentOutline.metaDescription}</p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    {contentOutline.metaDescription?.length || 0}/155 characters
                  </p>
                </div>
              </div>

              {/* Content Sections */}
              <div className="space-y-4">
                <Label className="text-sm font-semibold">Content Sections</Label>
                {contentOutline.sections?.map((section, idx) => (
                  <div key={idx} className="p-4 bg-muted/50 rounded-lg border">
                    <div className="flex items-start justify-between mb-2">
                      <h4 className="font-semibold text-foreground">
                        H2: {section.h2}
                      </h4>
                      {section.ctaPlacement && (
                        <Badge variant="outline" className="text-xs bg-orange-50 text-orange-700 border-orange-200">
                          Add CTA Here
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{section.description}</p>
                    {section.h3s?.length > 0 && (
                      <div className="mt-2 pl-4 border-l-2 border-primary/30">
                        <p className="text-xs font-medium text-muted-foreground mb-1">Subheadings (H3):</p>
                        <ul className="text-sm space-y-1">
                          {section.h3s.map((h3, h3Idx) => (
                            <li key={h3Idx} className="text-foreground">• {h3}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {/* CTA Details - Show button text and destination */}
                    {section.ctaPlacement && (section.ctaText || section.ctaDestination) && (
                      <div className="mt-3 p-3 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                        <p className="text-xs font-medium text-orange-800 dark:text-orange-200 mb-1">📍 CTA Button:</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {section.ctaText && (
                            <Badge className="bg-orange-100 dark:bg-orange-900/40 text-orange-800 dark:text-orange-200 border-orange-300">
                              &quot;{section.ctaText}&quot;
                            </Badge>
                          )}
                          {section.ctaDestination && (
                            <span className="text-xs text-orange-700 dark:text-orange-300">
                              → Links to: <code className="bg-orange-100 dark:bg-orange-900/40 px-1.5 py-0.5 rounded font-mono">{section.ctaDestination}</code>
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Schema & Technical SEO */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Schema Markup */}
                {contentOutline.schema?.length > 0 && (
                  <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                    <Label className="text-sm font-semibold text-yellow-800 dark:text-yellow-200 mb-2 block">
                      📋 Recommended Schema Markup
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {contentOutline.schema.map((schema, idx) => (
                        <Badge key={idx} variant="outline" className="bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-200">
                          {schema}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* Word Count */}
                {contentOutline.wordCount && (
                  <div className="p-4 bg-indigo-50 dark:bg-indigo-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800">
                    <Label className="text-sm font-semibold text-indigo-800 dark:text-indigo-200 mb-2 block">
                      Recommended Word Count
                    </Label>
                    <p className="text-lg font-bold text-indigo-700 dark:text-indigo-300">{contentOutline.wordCount}</p>
                  </div>
                )}
              </div>

              {/* Internal Links */}
              {contentOutline.internalLinks?.length > 0 && (
                <div className="p-4 bg-cyan-50 dark:bg-cyan-900/20 rounded-lg border border-cyan-200 dark:border-cyan-800">
                  <Label className="text-sm font-semibold text-cyan-800 dark:text-cyan-200 mb-2 block">
                    Internal Linking Suggestions
                  </Label>
                  <ul className="text-sm space-y-2">
                    {contentOutline.internalLinks.map((link, idx) => (
                      <li key={idx} className="text-cyan-700 dark:text-cyan-300">
                        {typeof link === 'string' ? (
                          // Legacy format - just a string
                          <span>• {link}</span>
                        ) : (
                          // New format with url and context
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <span>•</span>
                              <span className="font-medium">&quot;{link.text}&quot;</span>
                              <span>→</span>
                              <code className="bg-cyan-100 dark:bg-cyan-900/40 px-1.5 py-0.5 rounded text-xs font-mono">
                                {link.url}
                              </code>
                            </div>
                            {link.context && (
                              <span className="text-xs text-cyan-600 dark:text-cyan-400 ml-4">
                                {link.context}
                              </span>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Additional Tips */}
              {contentOutline.additionalTips?.length > 0 && (
                <div className="p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  <Label className="text-sm font-semibold text-emerald-800 dark:text-emerald-200 mb-2 block">
                    Pro Tips
                  </Label>
                  <ul className="text-sm space-y-2">
                    {contentOutline.additionalTips.map((tip, idx) => (
                      <li key={idx} className="text-emerald-700 dark:text-emerald-300 flex items-start gap-2">
                        <span className="text-emerald-600">✓</span>
                        <span>{tip}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* SEO Mentor Tip */}
              <div className="p-4 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-violet-900/20 dark:to-purple-900/20 rounded-lg border border-violet-200 dark:border-violet-800 mt-2">
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-violet-100 dark:bg-violet-900/40 rounded-lg">
                    <Sparkles className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-violet-800 dark:text-violet-200 mb-1">
                      Next Step: Use SEO Mentor
                    </p>
                    <p className="text-sm text-violet-700 dark:text-violet-300">
                      Click <span className="font-semibold">&quot;Copy Full Outline&quot;</span> below, then paste it into the <span className="font-semibold">SEO Mentor</span> to get AI-powered help writing your content!
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Disclaimer */}
              <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800 mt-2">
                <p className="text-xs text-amber-700 dark:text-amber-300 text-center">
                  <span className="font-medium">Quick heads up:</span> AI can sometimes get things wrong specially at the beginning. When you get your content from SEO Mentor, give it a quick read and feel free to tweak anything that doesn&apos;t sound right for your business!
                </p>
              </div>
            </div>
          ) : (
            <div className="py-8 text-center text-muted-foreground">
              <p>Failed to generate outline. Please try again.</p>
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setContentOutlineDialog({ open: false, opportunity: null });
                setContentOutline(null);
              }}
            >
              Close
            </Button>
            {contentOutline && (
              <>
                <Button
                  variant="outline"
                  onClick={() => generateContentOutline(contentOutlineDialog.opportunity, true)}
                  disabled={isGeneratingOutline}
                  className="gap-2"
                >
                  {isGeneratingOutline ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Regenerating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      Regenerate
                    </>
                  )}
                </Button>
                <Button
                  onClick={() => {
                    // Copy entire outline as formatted text optimized for SEO Mentor
                    const opportunity = contentOutlineDialog.opportunity;
                    const intentInfo = opportunity?.intent;
                    
                    const outlineText = `
**IMPORTANT: Start your FIRST response ONLY with this exact message (do NOT include this reminder in any follow-up responses):**

"**Quick Reminder:** Give this content a quick read before using it. Feel free to edit anything that doesn't quite fit your business. The more you use SEO Mentor, the smarter it gets.

**Page Type: ${opportunity?.pageType?.type || 'Service Page'}** - This content is structured as a ${opportunity?.pageType?.type || 'Service Page'}."

---

Now write the COMPLETE, publish-ready content for a **${opportunity?.pageType?.type || 'Service Page'}**. Write out every section with FULL PARAGRAPHS.

**IMPORTANT FORMATTING RULES - Follow this exact format:**

1. **Label every element** so beginners know what it is:
   - Use [H1] for the main page title
   - Use [H2] for section headings
   - Use [H3] for subheadings within sections
   - Use [PARAGRAPH] before body text
   - Use [CTA BUTTON] for call-to-action button text
   - Use [META TITLE] and [META DESCRIPTION] for SEO fields

2. **Number each section** clearly (Section 1, Section 2, etc.)

3. **Separate sections visually** with divider lines (---)

4. Write in a professional, engaging tone for ${data?.businessName || 'the business'}

**Example format to follow:**

---
**SECTION 1: Hero/Introduction**
---

[H1] Your Main Page Title Here

[PARAGRAPH]
Your introduction paragraph goes here...

[CTA BUTTON] Get Started Today

---
**SECTION 2: Section Name**
---

[H2] Section Heading

[PARAGRAPH]
Section content here...

[H3] Subheading

[PARAGRAPH]
More content...

---

Now write the content following this format:

## SEO Content Brief

**Page Type:** ${opportunity?.pageType?.type || 'Service Page'} - Write this content in the style and structure of a ${opportunity?.pageType?.type || 'Service Page'}
**Focus Keyword:** ${opportunity?.keyword || 'N/A'}
${intentInfo ? `**Search Intent:** ${intentInfo.category}${intentInfo.buyerReadiness ? ` (${intentInfo.buyerReadiness} Buyer Readiness)` : ''}` : ''}
${data?.businessName ? `**Business:** ${data.businessName}${data?.businessLocation ? ` | ${data.businessLocation}` : ''}` : ''}

**Page Title (H1):** ${contentOutline.h1}
**Meta Title:** ${contentOutline.metaTitle}
**Meta Description:** ${contentOutline.metaDescription}
**Target Word Count:** ${contentOutline.wordCount}

## Sections to Write:
${contentOutline.sections?.map((s, index) => `
**Section ${index + 1}: ${s.h2}**
- Description: ${s.description}
${s.h3s?.length ? `- Subheadings (H3s) to include:\n${s.h3s.map(h3 => `  • ${h3}`).join('\n')}` : ''}
${s.ctaPlacement ? `- Include a CTA button: "${s.ctaText || 'Contact Us'}" → Links to: ${s.ctaDestination || '/contact'}` : ''}
`).join('\n')}

**Internal Links to Include (Use these ACTUAL URLs):**
${contentOutline.internalLinks?.map(l => {
  if (typeof l === 'string') return `- ${l}`;
  return `- Link text: "${l.text}" → URL: ${l.url}${l.context ? ` (${l.context})` : ''}`;
}).join('\n')}
`.trim();
                    copyToClipboard(outlineText, 'fullOutline');
                  }}
                  className="gap-2"
                >
                  {copiedField === 'fullOutline' ? (
                    <>
                      <Check className="w-4 h-4" />
                      Copied!
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy Full Outline
                    </>
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark as Created Dialog */}
      <Dialog open={markAsCreatedDialog.open} onOpenChange={(open) => {
        if (!open) {
          setMarkAsCreatedDialog({ open: false, opportunity: null });
          setMarkAsCreatedUrl("");
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Created</DialogTitle>
            <DialogDescription>
              Enter the URL of the page you created for this keyword. We&apos;ll track when it starts ranking in Google Search Console.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="keyword">Keyword</Label>
              <Input
                id="keyword"
                value={markAsCreatedDialog.opportunity?.keyword || ""}
                disabled
                className="bg-muted"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pageUrl">
                Page URL <span className="text-red-500">*</span>
              </Label>
              <Input
                id="pageUrl"
                value={markAsCreatedUrl}
                onChange={(e) => setMarkAsCreatedUrl(e.target.value)}
                placeholder="https://example.com/your-new-page"
                className="font-mono text-sm"
              />
              {markAsCreatedDialog.opportunity && (
                <p className="text-xs text-muted-foreground">
                  Suggested: <code className="bg-muted px-1 rounded">/{markAsCreatedDialog.opportunity.keyword.toLowerCase().replace(/\s+/g, '-')}</code>
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setMarkAsCreatedDialog({ open: false, opportunity: null });
                setMarkAsCreatedUrl("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!markAsCreatedUrl.trim()) {
                  toast.error("Please enter a URL");
                  return;
                }

                // Validate URL
                let normalizedUrl;
                try {
                  const url = new URL(markAsCreatedUrl);
                  normalizedUrl = url.href;
                  
                  // Validate URL belongs to user's website domain
                  if (data?.websiteUrl) {
                    try {
                      // Ensure websiteUrl has a protocol (might be stored without https://)
                      let websiteUrlWithProtocol = data.websiteUrl;
                      if (!websiteUrlWithProtocol.startsWith('http://') && !websiteUrlWithProtocol.startsWith('https://')) {
                        websiteUrlWithProtocol = 'https://' + websiteUrlWithProtocol;
                      }
                      
                      const userUrl = new URL(websiteUrlWithProtocol);
                      const userDomain = userUrl.hostname.replace(/^www\./, '');
                      const inputDomain = url.hostname.replace(/^www\./, '');
                      
                      if (userDomain !== inputDomain) {
                        toast.error(`URL must belong to your website domain (${userDomain})`);
                        return;
                      }
                    } catch (domainError) {
                      console.error("Error validating domain:", domainError);
                      // Continue if domain validation fails (user's website URL might be invalid)
                    }
                  }
                } catch (error) {
                  toast.error("Please enter a valid URL (e.g., https://example.com/page)");
                  return;
                }

                setIsMarkingAsCreated(true);
                try {
                  const response = await authenticatedFetch("/api/content-opportunities/mark-created", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      userId: user.id,
                      keyword: markAsCreatedDialog.opportunity.keyword,
                      pageUrl: normalizedUrl,
                      opportunityId: `${user.id}_${markAsCreatedDialog.opportunity.keyword.toLowerCase().replace(/\s+/g, '-')}_${Date.now()}`,
                    }),
                  });

                  if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || "Failed to mark as created");
                  }

                  const result = await response.json();
                  
                  // Show success message with crawl status
                  if (result.pageCrawled) {
                    toast.success("Page marked as created!", {
                      description: "Page content added to SEO Mentor's knowledge. We'll track when it starts ranking.",
                    });
                  } else {
                    toast.success("Page marked as created!", {
                      description: "We'll track when this page starts ranking. Note: The page couldn't be crawled yet (it may not be live). SEO Mentor will learn about it once it's accessible.",
                    });
                  }

                  // Refresh created opportunities
                  await fetchCreatedOpportunities();

                  // Close dialog
                  setMarkAsCreatedDialog({ open: false, opportunity: null });
                  setMarkAsCreatedUrl("");
                } catch (error) {
                  console.error("Error marking as created:", error);
                  toast.error("Failed to mark as created", {
                    description: error.message || "Please try again.",
                  });
                } finally {
                  setIsMarkingAsCreated(false);
                }
              }}
              disabled={!markAsCreatedUrl.trim() || isMarkingAsCreated}
            >
              {isMarkingAsCreated ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Mark as Created
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Indexing Help Modal */}
      <Dialog open={indexingHelpModal.open} onOpenChange={(open) => {
        if (!open) {
          setIndexingHelpModal({ open: false, pageUrl: null });
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5 text-orange-500" />
              How to Get Your Page Indexed in Google
            </DialogTitle>
            <DialogDescription>
              If your page isn&apos;t showing up in Google Search Console after 2+ weeks, follow these steps to request indexing.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6 py-4">
            {/* Step 1 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold">
                  1
                </div>
                <h4 className="font-semibold">Check if the page is indexed</h4>
              </div>
              <div className="ml-8 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Search for your exact URL in Google to see if it&apos;s indexed:
                </p>
                {indexingHelpModal.pageUrl && (
                  <a
                    href={`https://www.google.com/search?q=site:${encodeURIComponent(indexingHelpModal.pageUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Search Google for: site:{indexingHelpModal.pageUrl?.replace(/^https?:\/\//, '').slice(0, 40)}...
                  </a>
                )}
                <p className="text-xs text-muted-foreground">
                  If no results appear, your page is not indexed yet.
                </p>
              </div>
            </div>

            {/* Step 2 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold">
                  2
                </div>
                <h4 className="font-semibold">Use Google Search Console&apos;s URL Inspection Tool</h4>
              </div>
              <div className="ml-8 space-y-2">
                <p className="text-sm text-muted-foreground">
                  Go to Google Search Console and use the URL Inspection tool to request indexing:
                </p>
                <a
                  href="https://search.google.com/search-console"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 underline"
                >
                  <ExternalLink className="w-3 h-3" />
                  Open Google Search Console
                </a>
                <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1 mt-2">
                  <li>Paste your page URL in the search bar at the top</li>
                  <li>Click &quot;Request Indexing&quot; button</li>
                  <li>Wait 1-7 days for Google to crawl your page</li>
                </ol>
              </div>
            </div>

            {/* Step 3 */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 flex items-center justify-center text-sm font-bold">
                  3
                </div>
                <h4 className="font-semibold">Add internal links to the page</h4>
              </div>
              <div className="ml-8">
                <p className="text-sm text-muted-foreground">
                  Link to your new page from other pages on your site. Google discovers new pages by following links. Add your new page to:
                </p>
                <ul className="text-sm text-muted-foreground list-disc list-inside mt-2 space-y-1">
                  <li>Your site&apos;s navigation menu or footer</li>
                  <li>Related blog posts or service pages</li>
                  <li>Your sitemap.xml file</li>
                </ul>
              </div>
            </div>

            {/* Pro Tips */}
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200 dark:border-amber-800">
              <h4 className="font-semibold text-amber-800 dark:text-amber-200 mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4" />
                Pro Tips
              </h4>
              <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                <li>• New pages can take 1-4 weeks to get indexed naturally</li>
                <li>• Pages with more internal links get indexed faster</li>
                <li>• Sharing your page on social media can speed up discovery</li>
                <li>• Make sure your page isn&apos;t blocked by robots.txt</li>
              </ul>
            </div>

            {/* Helpful Links */}
            <div className="p-4 bg-muted/50 rounded-lg">
              <h4 className="font-semibold text-sm mb-2">Helpful Resources</h4>
              <div className="flex flex-wrap gap-3">
                <a
                  href="https://support.google.com/webmasters/answer/9012289"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 underline"
                >
                  Google&apos;s URL Inspection Guide
                </a>
                <a
                  href="https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 underline"
                >
                  How to Ask Google to Recrawl
                </a>
                <a
                  href="https://search.google.com/search-console/removals"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:text-blue-700 dark:text-blue-400 underline"
                >
                  Check if URL is Blocked
                </a>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIndexingHelpModal({ open: false, pageUrl: null })}
            >
              Close
            </Button>
            {indexingHelpModal.pageUrl && (
              <Button
                onClick={() => {
                  window.open(`https://search.google.com/search-console`, '_blank');
                }}
                className="gap-2"
              >
                <ExternalLink className="w-4 h-4" />
                Open Search Console
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainLayout>
  );
}

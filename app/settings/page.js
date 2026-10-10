"use client";

import { authenticatedFetch } from "../lib/authenticatedFetch";

import { useState, useEffect } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import { useTheme } from "../contexts/ThemeContext";
import MainLayout from "../components/MainLayout";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import FocusKeywordSelector from "../components/dashboard/FocusKeywordSelector";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { 
  User, 
  Bell, 
  Shield, 
  Search, 
  Globe, 
  Mail, 
  Key, 
  Trash2, 
  Download, 
  Upload,
  Save,
  Edit3,
  Camera,
  AlertTriangle,
  CheckCircle,
  Settings as SettingsIcon,
  Database,
  Zap,
  BarChart3,
  Plus,
  FileText,
  X,
  Loader2,
  Clock,
  Rocket
} from "lucide-react";
import { toast } from "sonner";
import { 
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { db } from "../lib/firebaseConfig";
import { createGSCTokenManager } from "../lib/gscTokenManager";
import { 
  doc, 
  deleteDoc, 
  collection, 
  query, 
  where, 
  getDocs,
  getDoc,
  writeBatch 
} from "firebase/firestore";
import { 
  deleteUser, 
  reauthenticateWithCredential, 
  reauthenticateWithPopup,
  EmailAuthProvider,
  signInWithEmailAndPassword 
} from "firebase/auth";
import RevampModal from "../components/settings/RevampModal";

export default function Settings() {
  const { user, isLoading: authLoading } = useAuth();
  const { data, updateData } = useOnboarding();
  const { isDarkMode, toggleTheme } = useTheme();
  const router = useRouter();

  // State for form data
  const [formData, setFormData] = useState({
    // Profile
    businessName: "",
    websiteUrl: "",
    businessType: "",
    businessLocation: "",
    cmsPlatform: "",
    contactEmail: "",
    
    // Notifications
    emailReports: true,
    weeklyDigest: true,
    keywordAlerts: true,
    rankingChanges: true,
    newFeatures: false,
    marketingEmails: false,
    
    // SEO Preferences
    defaultDateRange: "30",
    autoRefresh: true,
    showAdvancedMetrics: false,
    enableAITips: true,
    dataRetention: "12",
    
    // Integrations
    gscConnected: false,
    gscProperty: "",
    gscLastSync: null,
    analyticsConnected: false,
    socialConnected: false,
    
    // Account
    twoFactorEnabled: false,
    sessionTimeout: "24",
    dataExport: false
  });

  // Loading states
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");
  const [isDeleting, setIsDeleting] = useState(false);
  const [showRevampModal, setShowRevampModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [isGoogleUser, setIsGoogleUser] = useState(false);

  // Content & Keywords state
  const [pages, setPages] = useState([]);
  const [focusKeywords, setFocusKeywords] = useState([]);
  const [gscKeywords, setGscKeywords] = useState([]);
  const [gscKeywordsRaw, setGscKeywordsRaw] = useState([]); // Raw GSC data with page info
  const [focusKeywordByPage, setFocusKeywordByPage] = useState(new Map());
  const [groupedByPage, setGroupedByPage] = useState(new Map());
  const [pagesToRemove, setPagesToRemove] = useState([]);
  const [pagesToAdd, setPagesToAdd] = useState([]);
  const [keywordsToRemove, setKeywordsToRemove] = useState([]);
  const [keywordsToAdd, setKeywordsToAdd] = useState([]);
  const [newPageUrl, setNewPageUrl] = useState("");
  const [newKeyword, setNewKeyword] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [isSavingContent, setIsSavingContent] = useState(false);
  const [rateLimitInfo, setRateLimitInfo] = useState(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [pendingChanges, setPendingChanges] = useState(null);
  const [isGscConnected, setIsGscConnected] = useState(false);

  // Must match normalizePage in FocusKeywordSelector.jsx for consistent lookups
  const normalizePageKey = (page) => {
    if (!page) return "__unknown__";
    try {
      const u = new URL(page);
      // Remove trailing slash except for root, lowercase for consistency
      const normalized = u.pathname === '/' ? u.origin : u.origin + u.pathname.replace(/\/$/, '');
      return normalized.toLowerCase();
    } catch {
      // Fallback: just remove trailing slash and lowercase
      return page.trim().replace(/\/$/, '').toLowerCase();
    }
  };

  // Normalize and validate manual URL (same as dashboard)
  const normalizeManualUrl = (value) => {
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
  };

  useEffect(() => {
    if (typeof window !== "undefined" && !authLoading && !user) {
      router.push("/auth");
    }
  }, [user, authLoading, router]);

  // Detect user's authentication method
  useEffect(() => {
    if (user) {
      const checkAuthMethod = async () => {
        try {
          const { auth } = await import("../lib/firebaseConfig");
          const currentUser = auth.currentUser;
          if (currentUser) {
            const isGoogle = currentUser.providerData.some(provider => provider.providerId === 'google.com');
            setIsGoogleUser(isGoogle);
          }
        } catch (error) {
          console.error("Error checking auth method:", error);
        }
      };
      checkAuthMethod();
    }
  }, [user]);

  // Load user data
  useEffect(() => {
    if (data) {
      // Normalize CMS platform to match dropdown values (onboarding saves capitalized)
      const normalizeCmsPlatform = (platform) => {
        if (!platform) return "";
        // Map onboarding CMS platforms to settings values (lowercase)
        const platformMap = {
          "WordPress": "wordpress",
          "Squarespace": "squarespace",
          "Wix": "wix"
        };
        return platformMap[platform] || platform.toLowerCase() || "";
      };

      setFormData(prev => ({
        ...prev,
        businessName: data.businessName || "",
        websiteUrl: data.websiteUrl || "",
        businessType: data.businessType || "",
        businessLocation: data.businessLocation || "",
        cmsPlatform: normalizeCmsPlatform(data.cmsPlatform),
        contactEmail: user?.email || "",
        // Update GSC connection status from actual onboarding data
        gscConnected: !!(data.hasGSC && data.gscProperty),
        gscProperty: data.gscProperty || "",
        gscLastSync: data.gscLastSync || new Date().toISOString()
      }));
    }
  }, [data, user]);

  // Load content & keywords data
  useEffect(() => {
    if (activeTab === "content-keywords" && user?.id) {
      loadContentAndKeywords();
      checkRateLimit();
    }
  }, [activeTab, user?.id]);


  const loadContentAndKeywords = async () => {
    if (!user?.id) return;
    
    setIsLoadingContent(true);
    try {
      // Load pages
      const pagesRes = await authenticatedFetch(`/api/crawl-site/review?userId=${encodeURIComponent(user.id)}`);
      if (pagesRes.ok) {
        const pagesData = await pagesRes.json();
        setPages(pagesData.pages || []);
      }

      // Load focus keywords
      const keywordsRes = await authenticatedFetch(`/api/focus-keywords?userId=${encodeURIComponent(user.id)}`);
      let loadedKeywords = [];
      let snapshot = null;
      
      // Build focusKeywordByPage Map from Firestore
      const assignments = new Map();
      if (keywordsRes.ok) {
        const keywordsData = await keywordsRes.json();
        loadedKeywords = keywordsData.keywords || [];
        snapshot = keywordsData.snapshot || null;
        setFocusKeywords(loadedKeywords);

        // Build focusKeywordByPage Map
        loadedKeywords.forEach(({ keyword, pageUrl, source }) => {
          if (!keyword) return;
          const pageKey = normalizePageKey(pageUrl);
          assignments.set(pageKey, keyword);
        });
        setFocusKeywordByPage(assignments);
      }

      // If snapshot exists, use it instead of reconstructing from GSC
      if (snapshot && snapshot.groupedByPage && snapshot.gscKeywordsRaw) {
        // Restore from snapshot
        const restoredGroupedByPage = new Map();
        snapshot.groupedByPage.forEach(({ page, keywords }) => {
          if (page) {
            restoredGroupedByPage.set(normalizePageKey(page), keywords || []);
          }
        });
        
        // Also add AI-generated keywords from gscKeywordsRaw to groupedByPage
        snapshot.gscKeywordsRaw.forEach((kw) => {
          if (kw.source === "ai-generated" && kw.page && kw.keyword) {
            const pageKey = normalizePageKey(kw.page);
            if (!restoredGroupedByPage.has(pageKey)) {
              restoredGroupedByPage.set(pageKey, []);
            }
            const keywordLower = kw.keyword.toLowerCase();
            const pageKeywords = restoredGroupedByPage.get(pageKey) || [];
            if (!pageKeywords.includes(keywordLower)) {
              restoredGroupedByPage.set(pageKey, [...pageKeywords, keywordLower]);
            }
          }
        });
        
        setGroupedByPage(restoredGroupedByPage);
        setGscKeywordsRaw(snapshot.gscKeywordsRaw || []);
        
        // Restore selectedByPage from snapshot (merge with assignments from Firestore)
        const restoredSelectedByPage = new Map(assignments); // Start with Firestore assignments
        snapshot.selectedByPage?.forEach(({ page, keyword }) => {
          if (page && keyword) {
            restoredSelectedByPage.set(normalizePageKey(page), keyword);
          }
        });
        setFocusKeywordByPage(restoredSelectedByPage);
        
        // Set GSC connected to true since we have snapshot data
        setIsGscConnected(true);
      } else {
        // Load GSC keywords (pass loadedKeywords so AI keywords can be added)
        await loadGSCKeywords(loadedKeywords);
      }
    } catch (error) {
      console.error("Failed to load content and keywords:", error);
      toast.error("Failed to load content and keywords");
    } finally {
      setIsLoadingContent(false);
    }
  };

  const loadGSCKeywords = async (currentFocusKeywords = []) => {
    if (!user?.id || !data?.gscProperty) {
      setIsGscConnected(false);
      return;
    }

    try {
      const tokenManager = createGSCTokenManager(user.id);
      
      // Add a small delay to ensure tokens are stored
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const gscData = await tokenManager.getStoredGSCData();
      
      if (!gscData?.refreshToken || !gscData?.siteUrl) {
        setIsGscConnected(false);
        return;
      }

      setIsGscConnected(true);

      // Get valid access token (refresh if needed)
      const validToken = await tokenManager.getValidAccessToken();
      if (!validToken) {
        setIsGscConnected(false);
        return;
      }

      // Fetch GSC keywords
      const today = new Date();
      const startDate = new Date();
      startDate.setDate(today.getDate() - 28); // 28 days like dashboard

      const formatDate = (d) => d.toISOString().split("T")[0];
      const from = formatDate(startDate);
      const to = formatDate(today);

      const response = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
          gscData.siteUrl
        )}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${validToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: from,
            endDate: to,
            dimensions: ["query", "page"],
            rowLimit: 500,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`GSC API error: ${response.status}`);
      }

      const json = await response.json();

      if (json.rows) {
        const formatted = json.rows.map((row) => ({
          keyword: row.keys[0].replace(/^\[|\]$/g, ""),
          page: row.keys[1],
          clicks: row.clicks,
          impressions: row.impressions,
          position: Math.round(row.position),
          ctr: `${(row.ctr * 100).toFixed(1)}%`,
        }));

        // Create a map of keyword+page -> source from Firestore
        const keywordSourceMap = new Map();
        currentFocusKeywords.forEach(({ keyword, pageUrl, source }) => {
          if (!keyword || !pageUrl) return;
          const key = `${keyword.toLowerCase()}|${normalizePageKey(pageUrl)}`;
          keywordSourceMap.set(key, source);
        });

        // Merge source into GSC keywords to preserve source from Firestore
        const formattedWithSource = formatted.map(kw => {
          const key = `${kw.keyword.toLowerCase()}|${normalizePageKey(kw.page)}`;
          const source = keywordSourceMap.get(key);
          return {
            ...kw,
            source: source || "gsc-existing", // Default to gsc-existing if not in Firestore
          };
        });

        // Store raw GSC keywords with source preserved (needed for FocusKeywordSelector)
        setGscKeywordsRaw(formattedWithSource);

        // Group by keyword (get unique keywords with their best metrics) - for display summary
        const keywordMap = new Map();
        formattedWithSource.forEach((kw) => {
          const key = kw.keyword.toLowerCase();
          if (!keywordMap.has(key)) {
            keywordMap.set(key, {
              keyword: kw.keyword,
              clicks: kw.clicks,
              impressions: kw.impressions,
              position: kw.position,
              ctr: kw.ctr,
              pages: [kw.page],
            });
          } else {
            const existing = keywordMap.get(key);
            existing.clicks += kw.clicks;
            existing.impressions += kw.impressions;
            // Keep best (lowest) position
            if (kw.position < existing.position) {
              existing.position = kw.position;
            }
            if (!existing.pages.includes(kw.page)) {
              existing.pages.push(kw.page);
            }
          }
        });

        // Convert to array and sort by impressions
        const uniqueKeywords = Array.from(keywordMap.values()).sort(
          (a, b) => b.impressions - a.impressions
        );

        setGscKeywords(uniqueKeywords);

        // Build groupedByPage Map for FocusKeywordSelector
        const grouped = new Map();
        // Track normalized page URLs to prevent duplicates (handle trailing slash variations)
        const normalizedPages = new Map(); // normalized -> original page URL
        
        // Helper to normalize for deduplication (remove trailing slash, lowercase)
        const normalizeForDedup = (url) => {
          if (!url || url === "__unknown__") return "__unknown__";
          return url.trim().replace(/\/$/, '').toLowerCase();
        };
        
        // First, add all pages from GSC keywords
        formattedWithSource.forEach((kw) => {
          const normalized = normalizeForDedup(kw.page);
          const pageKey = normalizedPages.get(normalized) || normalizePageKey(kw.page);
          
          // Store the first occurrence of this normalized URL
          if (!normalizedPages.has(normalized)) {
            normalizedPages.set(normalized, normalizePageKey(kw.page));
          }
          
          if (!grouped.has(pageKey)) {
            grouped.set(pageKey, []);
          }
          const keywordLower = kw.keyword.toLowerCase();
          if (!grouped.get(pageKey).includes(keywordLower)) {
            grouped.get(pageKey).push(keywordLower);
          }
        });
        
        // IMPORTANT: Add ALL pages from currentFocusKeywords to ensure they appear
        // even if they don't have keywords in current GSC data
        currentFocusKeywords.forEach(({ keyword, pageUrl, source }) => {
          if (!keyword || !pageUrl) return;
          
          const normalized = normalizeForDedup(pageUrl);
          // Use existing pageKey if this normalized URL was already seen
          const pageKey = normalizedPages.get(normalized) || normalizePageKey(pageUrl);
          
          // Store the first occurrence
          if (!normalizedPages.has(normalized)) {
            normalizedPages.set(normalized, normalizePageKey(pageUrl));
          }
          
          // Ensure the page exists in groupedByPage
          if (!grouped.has(pageKey)) {
            grouped.set(pageKey, []);
          }
          
          // Add the keyword to the page's keyword list if not already present
          const keywordLower = keyword.toLowerCase();
          if (!grouped.get(pageKey).includes(keywordLower)) {
            grouped.get(pageKey).push(keywordLower);
          }
        });
        
        setGroupedByPage(grouped);
        
        // Add selected keywords that don't appear in current GSC data to gscKeywordsRaw
        const existingKeywords = new Set(
          formattedWithSource.map(kw => kw.keyword?.toLowerCase())
        );
        
        const keywordsToAdd = currentFocusKeywords
          .filter(({ keyword }) => {
            if (!keyword) return false;
            // Add if keyword doesn't exist in current GSC data
            return !existingKeywords.has(keyword.toLowerCase());
          })
          .map(({ keyword, pageUrl, source }) => ({
            keyword,
            page: pageUrl || null,
            clicks: 0,
            impressions: 0,
            position: 999, // High position since no GSC data
            ctr: "0%",
            source: source || "gsc-existing", // Preserve source (ai-generated or gsc-existing)
          }));
        
        if (keywordsToAdd.length > 0) {
          setGscKeywordsRaw([...formattedWithSource, ...keywordsToAdd]);
        } else {
          setGscKeywordsRaw(formattedWithSource);
        }
      } else {
        setGscKeywords([]);
        setGscKeywordsRaw([]);
        setGroupedByPage(new Map());
      }
    } catch (error) {
      console.error("Failed to load GSC keywords:", error);
      setIsGscConnected(false);
      setGscKeywords([]);
    }
  };

  const checkRateLimit = async () => {
    if (!user?.id) return;
    
    try {
      const res = await fetch(`/api/content-keywords/edit?userId=${encodeURIComponent(user.id)}`);
      if (res.ok) {
        const data = await res.json();
        setRateLimitInfo(data);
      }
    } catch (error) {
      console.error("Failed to check rate limit:", error);
    }
  };

  const handleRemovePage = (pageUrl) => {
    if (!pagesToRemove.includes(pageUrl)) {
      setPagesToRemove([...pagesToRemove, pageUrl]);
    }
  };

  const handleUndoRemovePage = (pageUrl) => {
    setPagesToRemove(pagesToRemove.filter(url => url !== pageUrl));
  };

  const handleAddPage = async () => {
    if (!newPageUrl.trim()) {
      toast.error("Please enter a valid URL");
      return;
    }

    if (!data?.websiteUrl) {
      toast.error("Please set your website URL in settings first");
      return;
    }

    // Validate and normalize URL (same as dashboard)
    const normalized = normalizeManualUrl(newPageUrl.trim());
    if (!normalized) {
      try {
        const userUrl = new URL(data.websiteUrl.startsWith("http") ? data.websiteUrl : `https://${data.websiteUrl}`);
        const userDomain = userUrl.hostname.replace(/^www\./, '');
        toast.error(`URL must belong to your website domain (${userDomain})`);
      } catch {
        toast.error("Invalid URL or URL does not belong to your website domain");
      }
      return;
    }

    // Check if URL already exists in current pages
    const existingPageUrls = pages.map((p) => p.pageUrl || p.url).filter(Boolean);
    if (existingPageUrls.includes(normalized)) {
      toast.error("This page is already in your list");
      return;
    }

    // Check if URL is already being added
    if (pagesToAdd.includes(normalized)) {
      toast.error("This URL is already being added");
      return;
    }

    // Check if URL is in the remove list (allow re-adding)
    if (pagesToRemove.includes(normalized)) {
      // Remove from remove list and add to add list
      setPagesToRemove(pagesToRemove.filter(url => url !== normalized));
    }

    // Optional: Verify URL is crawlable before adding (same as dashboard)
    try {
      const scrapeRes = await fetch("/api/scrape-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: normalized }),
      });

      if (!scrapeRes.ok) {
        toast.error(`Failed to verify URL: ${normalized}. The page may not be accessible.`);
        return;
      }

      const scrapeJson = await scrapeRes.json();
      if (!scrapeJson?.data || !scrapeJson.data.textContent) {
        toast.error(`Invalid URL: ${normalized} has no crawlable content.`);
        return;
      }

      // URL is valid and crawlable, add it
      setPagesToAdd([...pagesToAdd, normalized]);
      setNewPageUrl("");
      toast.success("Page added successfully!");
    } catch (error) {
      console.error("Error verifying URL:", error);
      toast.error("Failed to verify URL. Please try again.");
    }
  };

  const handleRemoveAddedPage = (pageUrl) => {
    setPagesToAdd(pagesToAdd.filter(url => url !== pageUrl));
  };

  const handleFocusKeywordToggle = ({ keyword, page, isSelectedForPage, source }) => {
    const pageKey = normalizePageKey(page);
    const lowerKeyword = keyword.toLowerCase();

    if (isSelectedForPage) {
      // Removing keyword from this page
      // Check if it's currently selected
      const currentSelected = focusKeywordByPage.get(pageKey);
      if (currentSelected?.toLowerCase() === lowerKeyword) {
        // Mark for removal
        if (!keywordsToRemove.includes(keyword)) {
          setKeywordsToRemove([...keywordsToRemove, keyword]);
        }
        // Remove from add list if it's there
        setKeywordsToAdd(keywordsToAdd.filter(k => {
          const kKeyword = typeof k === "string" ? k : k.keyword;
          return kKeyword?.toLowerCase() !== lowerKeyword;
        }));
        // Update local state
        const newMap = new Map(focusKeywordByPage);
        newMap.delete(pageKey);
        setFocusKeywordByPage(newMap);
      }
    } else {
      // Adding keyword to this page
      // Remove from remove list if it's there
      setKeywordsToRemove(keywordsToRemove.filter(k => k.toLowerCase() !== lowerKeyword));
      
      // Check if this keyword is already assigned to another page
      let alreadyAssigned = false;
      focusKeywordByPage.forEach((assignedKeyword, assignedPageKey) => {
        if (assignedKeyword?.toLowerCase() === lowerKeyword && assignedPageKey !== pageKey) {
          alreadyAssigned = true;
        }
      });

      if (!alreadyAssigned) {
        // Add to add list
        if (!keywordsToAdd.some(k => {
          const kKeyword = typeof k === "string" ? k : k.keyword;
          return kKeyword?.toLowerCase() === lowerKeyword;
        })) {
          setKeywordsToAdd([...keywordsToAdd, { keyword, pageUrl: page || null, source: source || "gsc-existing" }]);
        }
        // Update local state
        const newMap = new Map(focusKeywordByPage);
        newMap.set(pageKey, keyword);
        setFocusKeywordByPage(newMap);
      } else {
        toast.error("This keyword is already assigned to another page. Please remove it from that page first.");
      }
    }
  };

  const handleRemoveKeyword = (keyword) => {
    if (!keywordsToRemove.includes(keyword)) {
      setKeywordsToRemove([...keywordsToRemove, keyword]);
    }
  };

  const handleUndoRemoveKeyword = (keyword) => {
    setKeywordsToRemove(keywordsToRemove.filter(k => k !== keyword));
  };

  const handleAddKeyword = () => {
    if (!newKeyword.trim()) {
      toast.error("Please enter a keyword");
      return;
    }

    const keyword = newKeyword.trim();
    const exists = focusKeywords.some(
      kw => (typeof kw === "string" ? kw : kw.keyword)?.toLowerCase() === keyword.toLowerCase()
    );
    
    if (exists) {
      toast.error("This keyword already exists");
      return;
    }

    if (!keywordsToAdd.some(k => (typeof k === "string" ? k : k.keyword)?.toLowerCase() === keyword.toLowerCase())) {
      setKeywordsToAdd([...keywordsToAdd, { keyword, pageUrl: null, source: "gsc-existing" }]);
      setNewKeyword("");
    } else {
      toast.error("This keyword is already being added");
    }
  };

  const handleRemoveAddedKeyword = (keyword) => {
    setKeywordsToAdd(keywordsToAdd.filter(k => {
      const kKeyword = typeof k === "string" ? k : k.keyword;
      return kKeyword?.toLowerCase() !== keyword.toLowerCase();
    }));
  };

  const handleSaveContentKeywords = async () => {
    if (!user?.id) return;

    const hasChanges = pagesToRemove.length > 0 || pagesToAdd.length > 0 || 
                      keywordsToRemove.length > 0 || keywordsToAdd.length > 0;

    if (!hasChanges) {
      toast.error("No changes to save");
      return;
    }

    // Check rate limit
    if (rateLimitInfo && !rateLimitInfo.canEdit) {
      toast.error(rateLimitInfo.message || `You can make edits again in ${rateLimitInfo.hoursUntilNextEdit} hours.`);
      return;
    }

    // Show confirmation dialog
    const changes = {
      pagesRemoved: pagesToRemove.length,
      pagesAdded: pagesToAdd.length,
      keywordsRemoved: keywordsToRemove.length,
      keywordsAdded: keywordsToAdd.length,
    };
    setPendingChanges(changes);
    setShowConfirmDialog(true);
  };

  const confirmSave = async () => {
    if (!user?.id || !pendingChanges) return;

    setIsSavingContent(true);
    setShowConfirmDialog(false);

    try {
      // Create updated snapshot with current state after changes
      const updatedSnapshot = {
        groupedByPage: Array.from(groupedByPage.entries()).map(([page, keywords]) => ({
          page,
          keywords: Array.isArray(keywords) ? keywords : [],
        })),
        gscKeywordsRaw: gscKeywordsRaw.map(kw => ({
          keyword: kw.keyword,
          page: kw.page,
          clicks: kw.clicks || 0,
          impressions: kw.impressions || 0,
          position: kw.position || 999,
          ctr: kw.ctr || "0%",
          source: kw.source || "gsc-existing",
        })),
        selectedByPage: Array.from(focusKeywordByPage.entries()).map(([page, keyword]) => ({
          page,
          keyword,
        })),
      };

      const res = await fetch("/api/content-keywords/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          pagesToRemove,
          pagesToAdd,
          keywordsToRemove,
          keywordsToAdd,
          snapshot: updatedSnapshot, // Include updated snapshot
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 429) {
          toast.error(data.message || "Rate limit exceeded");
          await checkRateLimit();
        } else {
          throw new Error(data.error || "Failed to save changes");
        }
        return;
      }

      toast.success("Changes saved successfully!", {
        description: "You can make changes again in 24 hours.",
        duration: 8000, // Show for 8 seconds so user doesn't miss it
      });
      
      // Reset state
      setPagesToRemove([]);
      setPagesToAdd([]);
      setKeywordsToRemove([]);
      setKeywordsToAdd([]);
      setPendingChanges(null);

      // Reload data
      await loadContentAndKeywords();
      await checkRateLimit();
    } catch (error) {
      console.error("Failed to save changes:", error);
      toast.error("Failed to save changes. Please try again.");
    } finally {
      setIsSavingContent(false);
    }
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // Update onboarding data
      await updateData({
        businessName: formData.businessName,
        websiteUrl: formData.websiteUrl,
        businessType: formData.businessType,
        businessLocation: formData.businessLocation,
        cmsPlatform: formData.cmsPlatform
      });

      // Simulate API call for other settings
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      toast.success("Settings saved successfully!", {
        description: "Your preferences have been updated."
      });
    } catch (error) {
      toast.error("Failed to save settings", {
        description: "Please try again in a moment."
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportData = () => {
    toast.success("Data export started", {
      description: "You&apos;ll receive an email when your data is ready for download."
    });
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") {
      toast.error("Please type 'DELETE' to confirm account deletion");
      return;
    }

    setIsDeleting(true);
    try {
      const { auth } = await import("../lib/firebaseConfig");
      const currentUser = auth.currentUser;
      
      // Check if user signed up with Google OAuth
      const isGoogleUser = currentUser.providerData.some(provider => provider.providerId === 'google.com');
      
      if (isGoogleUser) {
        // For Google OAuth users, we need to re-authenticate with Google
        // This will open a popup for Google re-authentication
        const provider = new (await import("firebase/auth")).GoogleAuthProvider();
        provider.addScope('email');
        provider.addScope('profile');
        
        try {
          await reauthenticateWithPopup(currentUser, provider);
        } catch (reauthError) {
          if (reauthError.code === 'auth/popup-closed-by-user') {
            toast.error("Re-authentication cancelled", {
              description: "Please complete Google re-authentication to delete your account."
            });
            return;
          }
          throw reauthError;
        }
      } else {
        // For email/password users, require password
        if (!deletePassword) {
          toast.error("Please enter your password to confirm account deletion");
          return;
        }
        
        const credential = EmailAuthProvider.credential(user.email, deletePassword);
        await reauthenticateWithCredential(currentUser, credential);
      }
      
      // Delete all user data from Firestore via API (uses Admin SDK)
      const deleteRes = await authenticatedFetch("/api/account/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });

      if (!deleteRes.ok) {
        const errorData = await deleteRes.json();
        throw new Error(errorData.error || "Failed to delete user data");
      }

      const deleteData = await deleteRes.json();
      console.log(`✅ Deleted ${deleteData.deletedCount} documents`);
      
      // Delete the Firebase Auth user
      await deleteUser(currentUser);
      
      toast.success("Account deleted successfully");
      
      // Redirect to auth page
      router.push("/auth");
    } catch (error) {
      console.error("Error deleting account:", error);
      
      if (error.code === "auth/wrong-password") {
        toast.error("Incorrect password", {
          description: "Please enter the correct password for this account."
        });
      } else if (error.code === "auth/too-many-requests") {
        toast.error("Too many attempts", {
          description: "Please wait a moment before trying again."
        });
      } else if (error.code === "auth/popup-closed-by-user") {
        toast.error("Re-authentication cancelled", {
          description: "Please complete Google re-authentication to delete your account."
        });
      } else {
        toast.error("Failed to delete account", {
          description: error.message || "Please try again or contact support."
        });
      }
    } finally {
      setIsDeleting(false);
      setShowDeleteDialog(false);
      setDeleteConfirmation("");
      setDeletePassword("");
    }
  };

  const tabs = [
    { id: "profile", label: "Profile", icon: User },
    // TODO: Uncomment when implementing notification preferences
    // { id: "notifications", label: "Notifications", icon: Bell },
    // TODO: Uncomment when implementing SEO preferences
    // { id: "seo", label: "SEO Preferences", icon: Search },
    { id: "content-keywords", label: "Content & Keywords", icon: FileText },
    { id: "integrations", label: "Integrations", icon: Globe },
    { id: "account", label: "Account", icon: Shield }
  ];

  if (authLoading) {
    return null;
  }

  return (
    <MainLayout>
      <div className="min-h-screen bg-background">
        {/* Header */}
        <div className="bg-background border-b border-border">
          <div className="px-6 py-8">
            <h1 className="text-3xl font-bold text-foreground mb-2">Settings</h1>
            <p className="text-muted-foreground">
              Manage your account and SEO tool preferences.
            </p>
          </div>
        </div>

        {/* Horizontal Tab Navigation */}
        <div className="bg-background border-b border-border">
          <div className="px-4 sm:px-6">
            <nav className="flex overflow-x-auto scrollbar-hide -mb-px" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-3 sm:px-4 py-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap flex-shrink-0 ${
                      activeTab === tab.id
                        ? "text-foreground border-green-600 bg-green-50 dark:bg-green-950/20"
                        : "text-muted-foreground border-transparent hover:text-foreground hover:border-muted-foreground"
                    }`}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" />
                    <span className="hidden sm:inline">{tab.label}</span>
                    <span className="sm:hidden">{tab.label.split(' ')[0]}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Main Content */}
        <div className="px-6 py-8">
          <div className="w-full">
            {/* Profile Tab */}
            {activeTab === "profile" && (
              <Card className="border-green-200 dark:border-green-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <User className="w-5 h-5" />
                    Business Information
                  </CardTitle>
                  <CardDescription>
                    Update your business details for better SEO recommendations.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Coming Soon Message */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-medium text-blue-900 dark:text-blue-100 mb-1">
                          Profile editing coming soon
                        </p>
                        <p className="text-sm text-blue-800 dark:text-blue-200">
                          Profile editing will be available soon. For now, please{" "}
                          <a href="/contact" className="underline font-medium hover:text-blue-600 dark:hover:text-blue-300">
                            contact us
                          </a>{" "}
                          if you need to make any changes to your profile.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Faded Form Fields */}
                  <div className="opacity-50 pointer-events-none">
                  {/* Avatar Section */}
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-blue-600 rounded-full flex items-center justify-center text-white text-xl font-bold">
                      {data?.businessName?.charAt(0) || user?.email?.charAt(0) || 'U'}
                    </div>
                    <div>
                      <Button variant="outline" size="sm" className="gap-2" disabled>
                        <Camera className="w-4 h-4" />
                        Change Avatar
                      </Button>
                      <p className="text-sm text-muted-foreground mt-1">
                        Upload a new profile picture
                      </p>
                    </div>
                  </div>

                  {/* Form Fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <User className="w-4 h-4" />
                        Business Name
                      </label>
                      <Input
                        value={formData.businessName}
                        onChange={(e) => handleInputChange("businessName", e.target.value)}
                        placeholder="Enter your business name"
                        disabled
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        Website URL
                      </label>
                      <Input
                        value={formData.websiteUrl}
                        onChange={(e) => handleInputChange("websiteUrl", e.target.value)}
                        placeholder="https://yourwebsite.com"
                        disabled
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <BarChart3 className="w-4 h-4" />
                        Business Type
                      </label>
                      <Select value={formData.businessType} onValueChange={(value) => handleInputChange("businessType", value)} disabled>
                        <SelectTrigger>
                          <SelectValue placeholder="Select business type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Dentist">Dentist</SelectItem>
                          <SelectItem value="Restaurant">Restaurant</SelectItem>
                          <SelectItem value="Roofer">Roofer</SelectItem>
                          <SelectItem value="Plumber">Plumber</SelectItem>
                          <SelectItem value="Hair Salon">Hair Salon</SelectItem>
                          <SelectItem value="Retail Store">Retail Store</SelectItem>
                          <SelectItem value="Law Firm">Law Firm</SelectItem>
                          <SelectItem value="Real Estate">Real Estate</SelectItem>
                          <SelectItem value="Fitness">Fitness</SelectItem>
                          <SelectItem value="Car Wash">Car Wash</SelectItem>
                          <SelectItem value="Automotive Services">Automotive Services</SelectItem>
                          <SelectItem value="Oil Change">Oil Change</SelectItem>
                          <SelectItem value="Auto Repair">Auto Repair</SelectItem>
                          <SelectItem value="Pet Grooming">Pet Grooming</SelectItem>
                          <SelectItem value="Cleaning Services">Cleaning Services</SelectItem>
                          <SelectItem value="Landscaping">Landscaping</SelectItem>
                          <SelectItem value="HVAC">HVAC</SelectItem>
                          <SelectItem value="Electrician">Electrician</SelectItem>
                          <SelectItem value="Contractor">Contractor</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        Business Location
                      </label>
                      <Input
                        value={formData.businessLocation}
                        onChange={(e) => handleInputChange("businessLocation", e.target.value)}
                        placeholder="City, State or ZIP Code"
                        disabled
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <SettingsIcon className="w-4 h-4" />
                        CMS Platform
                      </label>
                      <Select value={formData.cmsPlatform} onValueChange={(value) => handleInputChange("cmsPlatform", value)} disabled>
                        <SelectTrigger>
                          <SelectValue placeholder="Select platform" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="wordpress">WordPress</SelectItem>
                          <SelectItem value="squarespace">Squarespace</SelectItem>
                          <SelectItem value="wix">Wix</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium flex items-center gap-2">
                        <Mail className="w-4 h-4" />
                        Contact Email
                      </label>
                      <Input
                        value={formData.contactEmail}
                        onChange={(e) => handleInputChange("contactEmail", e.target.value)}
                        type="email"
                        placeholder="contact@yourbusiness.com"
                        disabled
                      />
                    </div>
                  </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Notifications Tab - TODO: Uncomment when implementing notification preferences
            {activeTab === "notifications" && (
              <Card className="border-green-200 dark:border-green-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Bell className="w-5 h-5" />
                    Notification Preferences
                  </CardTitle>
                  <CardDescription>
                    Choose what notifications you&apos;d like to receive via email and real-time alerts.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Email Notifications</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {[
                        { key: "emailReports", label: "Weekly SEO Reports", description: "Get a summary of your SEO performance every week" },
                        { key: "weeklyDigest", label: "Weekly Digest", description: "Top keywords, ranking changes, and recommendations" },
                        { key: "keywordAlerts", label: "Keyword Alerts", description: "Get notified when your keywords change significantly" },
                        { key: "rankingChanges", label: "Ranking Changes", description: "Alerts when your pages move up or down in rankings" },
                        { key: "newFeatures", label: "New Features", description: "Updates about new tools and features" },
                        { key: "marketingEmails", label: "Marketing Emails", description: "Tips, best practices, and industry insights" }
                      ].map((item) => (
                        <div key={item.key} className="flex items-center justify-between p-4 border rounded-lg">
                          <div className="space-y-1">
                            <div className="font-medium">{item.label}</div>
                            <div className="text-sm text-muted-foreground">{item.description}</div>
                          </div>
                          <Switch
                            checked={formData[item.key]}
                            onCheckedChange={(checked) => handleInputChange(item.key, checked)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Real-time Alerts</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="font-medium">Critical Ranking Drops</div>
                          <div className="text-sm text-muted-foreground">Immediate alerts for significant ranking losses</div>
                        </div>
                        <Switch defaultChecked />
                      </div>
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="font-medium">Website Downtime</div>
                          <div className="text-sm text-muted-foreground">Get notified if your website goes offline</div>
                        </div>
                        <Switch defaultChecked />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button 
                      onClick={handleSave} 
                      disabled={isSaving}
                      className="gap-2 bg-green-600 hover:bg-green-700"
                    >
                      {isSaving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            */}

            {/* SEO Preferences Tab - TODO: Uncomment when implementing SEO preferences
            {activeTab === "seo" && (
              <Card className="border-green-200 dark:border-green-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Search className="w-5 h-5" />
                    SEO Dashboard Settings
                  </CardTitle>
                  <CardDescription>
                    Customize your SEO dashboard and data preferences for optimal performance tracking.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Dashboard Configuration</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                          <BarChart3 className="w-4 h-4" />
                          Default Date Range
                        </label>
                        <Select value={formData.defaultDateRange} onValueChange={(value) => handleInputChange("defaultDateRange", value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="7">Last 7 days</SelectItem>
                            <SelectItem value="30">Last 30 days</SelectItem>
                            <SelectItem value="90">Last 90 days</SelectItem>
                            <SelectItem value="365">Last year</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                          <Database className="w-4 h-4" />
                          Data Retention
                        </label>
                        <Select value={formData.dataRetention} onValueChange={(value) => handleInputChange("dataRetention", value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="6">6 months</SelectItem>
                            <SelectItem value="12">12 months</SelectItem>
                            <SelectItem value="24">24 months</SelectItem>
                            <SelectItem value="unlimited">Unlimited</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Feature Preferences</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="font-medium">Auto-refresh Data</div>
                          <div className="text-sm text-muted-foreground">Automatically refresh SEO data every hour</div>
                        </div>
                        <Switch
                          checked={formData.autoRefresh}
                          onCheckedChange={(checked) => handleInputChange("autoRefresh", checked)}
                        />
                      </div>
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="font-medium">Show Advanced Metrics</div>
                          <div className="text-sm text-muted-foreground">Display technical SEO metrics and advanced data</div>
                        </div>
                        <Switch
                          checked={formData.showAdvancedMetrics}
                          onCheckedChange={(checked) => handleInputChange("showAdvancedMetrics", checked)}
                        />
                      </div>
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="font-medium">Enable AI Tips</div>
                          <div className="text-sm text-muted-foreground">Show personalized AI recommendations and tips</div>
                        </div>
                        <Switch
                          checked={formData.enableAITips}
                          onCheckedChange={(checked) => handleInputChange("enableAITips", checked)}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Reporting Preferences</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                          <Bell className="w-4 h-4" />
                          Report Frequency
                        </label>
                        <Select defaultValue="weekly">
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                          <Download className="w-4 h-4" />
                          Report Format
                        </label>
                        <Select defaultValue="pdf">
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="pdf">PDF</SelectItem>
                            <SelectItem value="excel">Excel</SelectItem>
                            <SelectItem value="csv">CSV</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-4">
                    <Button 
                      onClick={handleSave} 
                      disabled={isSaving}
                      className="gap-2 bg-green-600 hover:bg-green-700"
                    >
                      {isSaving ? (
                        <>
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          Save Changes
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            */}

            {/* Content & Keywords Tab */}
            {activeTab === "content-keywords" && (
              <div className="space-y-6">
                {/* Warning Banner */}
                <Card className="border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-950/20">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h3 className="font-semibold text-yellow-900 dark:text-yellow-100 mb-1">
                          Important: Changing these settings will affect your chatbot training and focus keyword tracking.
                        </h3>
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                          This will affect {pages.length} page{pages.length !== 1 ? "s" : ""} and {focusKeywords.length} focus keyword{focusKeywords.length !== 1 ? "s" : ""} currently in use.
                        </p>
                        {rateLimitInfo && !rateLimitInfo.canEdit && (
                          <div className="mt-3 flex items-center gap-2 text-sm font-medium text-yellow-900 dark:text-yellow-100">
                            <Clock className="h-4 w-4" />
                            <span>
                              You can make edits again in {rateLimitInfo.hoursUntilNextEdit} hour{rateLimitInfo.hoursUntilNextEdit !== 1 ? "s" : ""}.
                              {rateLimitInfo.lastEditAt && (
                                <span className="text-yellow-700 dark:text-yellow-300 ml-2">
                                  (Last edited: {new Date(rateLimitInfo.lastEditAt).toLocaleString()})
                                </span>
                              )}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {isLoadingContent ? (
                  <Card>
                    <CardContent className="pt-6">
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        <span className="ml-2 text-muted-foreground">Loading content and keywords...</span>
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {/* Scan Complete Pages */}
                    <Card className="border-green-200 dark:border-green-800">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <FileText className="w-5 h-5" />
                          Scan Complete Pages
                        </CardTitle>
                        <CardDescription>
                          Manage which pages are crawled and used for chatbot training.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {/* Current Pages */}
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium">Current Pages ({pages.length})</h4>
                          {pages.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No pages configured yet.</p>
                          ) : (
                            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-3">
                              {pages
                                .filter(page => !pagesToRemove.includes(page.pageUrl))
                                .map((page) => (
                                  <div
                                    key={page.pageUrl}
                                    className="flex items-center justify-between p-2 rounded border bg-background hover:bg-muted/50"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium truncate">{page.title || page.pageUrl}</p>
                                      <p className="text-xs text-muted-foreground truncate">{page.pageUrl}</p>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleRemovePage(page.pageUrl)}
                                      disabled={isSavingContent || (rateLimitInfo && !rateLimitInfo.canEdit)}
                                    >
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>

                        {/* Pages to Remove */}
                        {pagesToRemove.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-red-600">Pages to Remove ({pagesToRemove.length})</h4>
                            <div className="space-y-2 border border-red-200 dark:border-red-800 rounded-lg p-3 bg-red-50 dark:bg-red-950/20">
                              {pagesToRemove.map((url) => {
                                const page = pages.find(p => p.pageUrl === url);
                                return (
                                  <div
                                    key={url}
                                    className="flex items-center justify-between p-2 rounded border border-red-200 dark:border-red-800 bg-background"
                                  >
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm font-medium line-through truncate">{page?.title || url}</p>
                                      <p className="text-xs text-muted-foreground truncate">{url}</p>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleUndoRemovePage(url)}
                                      disabled={isSavingContent}
                                    >
                                      Undo
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Add New Page */}
                        <div className="space-y-2">
                          <h4 className="text-sm font-medium">Add New Page</h4>
                          <div className="flex gap-2">
                            <Input
                              value={newPageUrl}
                              onChange={(e) => setNewPageUrl(e.target.value)}
                              placeholder="https://yourdomain.com/page"
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  handleAddPage();
                                }
                              }}
                              disabled={isSavingContent || (rateLimitInfo && !rateLimitInfo.canEdit)}
                            />
                            <Button
                              onClick={handleAddPage}
                              disabled={isSavingContent || (rateLimitInfo && !rateLimitInfo.canEdit)}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        {/* Pages to Add */}
                        {pagesToAdd.length > 0 && (
                          <div className="space-y-2">
                            <h4 className="text-sm font-medium text-green-600">Pages to Add ({pagesToAdd.length})</h4>
                            <div className="space-y-2 border border-green-200 dark:border-green-800 rounded-lg p-3 bg-green-50 dark:bg-green-950/20">
                              {pagesToAdd.map((url) => (
                                <div
                                  key={url}
                                  className="flex items-center justify-between p-2 rounded border border-green-200 dark:border-green-800 bg-background"
                                >
                                  <p className="text-sm truncate flex-1">{url}</p>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleRemoveAddedPage(url)}
                                    disabled={isSavingContent}
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* Focus Keywords */}
                    <Card className="border-green-200 dark:border-green-800">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-lg">
                          <Search className="w-5 h-5" />
                          Focus Keywords
                        </CardTitle>
                        <CardDescription>
                          Select keywords from Google Search Console to track and prioritize in your dashboard. Selected keywords ({focusKeywords.length}) are highlighted.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {!isGscConnected ? (
                          <div className="text-center py-8">
                            <p className="text-sm text-muted-foreground mb-4">
                              Google Search Console is not connected. Please connect GSC to view and manage focus keywords.
                            </p>
                            <Button
                              onClick={() => router.push("/onboarding?step=4")}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              Connect Google Search Console
                            </Button>
                          </div>
                        ) : gscKeywordsRaw.length === 0 ? (
                          <div className="text-center py-8">
                            <p className="text-sm text-muted-foreground">
                              No keywords found in Google Search Console. Make sure your site has search data.
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="max-h-144 overflow-y-auto border rounded-lg p-3">
                              <FocusKeywordSelector
                                keywords={gscKeywordsRaw}
                                selectedByPage={focusKeywordByPage}
                                onToggle={handleFocusKeywordToggle}
                                isSaving={isSavingContent || (rateLimitInfo && !rateLimitInfo.canEdit)}
                                suggestions={[]}
                                groupedByPage={groupedByPage}
                                businessName={data?.businessName || ""}
                                businessType={data?.businessType || ""}
                                businessLocation={data?.businessLocation || ""}
                                userId={user?.id || ""}
                              />
                            </div>
                          </>
                        )}
                      </CardContent>
                    </Card>

                    {/* Save Button */}
                    <div className="flex justify-end">
                      <Button
                        onClick={handleSaveContentKeywords}
                        disabled={
                          isSavingContent ||
                          (rateLimitInfo && !rateLimitInfo.canEdit) ||
                          (pagesToRemove.length === 0 &&
                            pagesToAdd.length === 0 &&
                            keywordsToRemove.length === 0 &&
                            keywordsToAdd.length === 0)
                        }
                        className="gap-2 bg-green-600 hover:bg-green-700"
                      >
                        {isSavingContent ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Saving...
                          </>
                        ) : (
                          <>
                            <Save className="h-4 w-4" />
                            Save Changes
                          </>
                        )}
                      </Button>
                    </div>
                  </>
                )}

                {/* Confirmation Dialog */}
                <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-yellow-600" />
                        Confirm Changes
                      </DialogTitle>
                      <DialogDescription>
                        Please review your changes before saving. This will affect your chatbot training and focus keyword tracking.
                      </DialogDescription>
                    </DialogHeader>
                    {pendingChanges && (
                      <div className="space-y-3">
                        <div className="bg-yellow-50 dark:bg-yellow-950/20 p-3 rounded-lg border border-yellow-200 dark:border-yellow-800">
                          <p className="text-sm font-medium mb-2">Summary of changes:</p>
                          <ul className="text-sm space-y-1">
                            {pendingChanges.pagesRemoved > 0 && (
                              <li className="text-red-600">• Remove {pendingChanges.pagesRemoved} page{pendingChanges.pagesRemoved !== 1 ? "s" : ""}</li>
                            )}
                            {pendingChanges.pagesAdded > 0 && (
                              <li className="text-green-600">• Add {pendingChanges.pagesAdded} page{pendingChanges.pagesAdded !== 1 ? "s" : ""}</li>
                            )}
                            {pendingChanges.keywordsRemoved > 0 && (
                              <li className="text-red-600">• Remove {pendingChanges.keywordsRemoved} keyword{pendingChanges.keywordsRemoved !== 1 ? "s" : ""}</li>
                            )}
                            {pendingChanges.keywordsAdded > 0 && (
                              <li className="text-green-600">• Add {pendingChanges.keywordsAdded} keyword{pendingChanges.keywordsAdded !== 1 ? "s" : ""}</li>
                            )}
                          </ul>
                        </div>
                        <div className="bg-red-50 dark:bg-red-950/20 p-3 rounded-lg border border-red-200 dark:border-red-800">
                          <p className="text-sm font-medium text-red-900 dark:text-red-100 mb-1 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4" />
                            Warning: Changes cannot be undone
                          </p>
                          <p className="text-xs text-red-800 dark:text-red-200">
                            Once saved, your previous selections will be permanently replaced. Make sure you&apos;re satisfied with your changes before confirming.
                          </p>
                        </div>
                        <p className="text-sm font-medium text-foreground">
                          These changes will permanently replace your current settings. Are you sure you want to continue?
                        </p>
                      </div>
                    )}
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowConfirmDialog(false);
                          setPendingChanges(null);
                        }}
                        disabled={isSavingContent}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={confirmSave}
                        disabled={isSavingContent}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {isSavingContent ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin mr-2" />
                            Saving...
                          </>
                        ) : (
                          "Confirm & Save"
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {/* Integrations Tab */}
            {activeTab === "integrations" && (
              <Card className="border-green-200 dark:border-green-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Globe className="w-5 h-5" />
                    Connected Services
                  </CardTitle>
                  <CardDescription>
                    Manage your integrations with third-party services and data sources.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 gap-6">
                    {/* Google Search Console */}
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-4 sm:p-6 border rounded-lg">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className="w-10 h-10 sm:w-12 sm:h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center flex-shrink-0">
                          <Search className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-base sm:text-lg">Google Search Console</div>
                          <div className="text-sm text-muted-foreground">
                            {formData.gscConnected ? (
                              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                                <span>Connected</span>
                                {formData.gscProperty && (
                                  <span className="text-green-600 truncate text-xs sm:text-sm">
                                    • Property: {formData.gscProperty}
                                  </span>
                                )}
                              </div>
                            ) : (
                              "Not connected"
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 self-end sm:self-center">
                        {formData.gscConnected ? (
                          <>
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <Button 
                              variant="outline" 
                              size="sm"
                              onClick={() => router.push("/onboarding?step=4")}
                            >
                              Reconnect
                            </Button>
                          </>
                        ) : (
                          <Button 
                            size="sm" 
                            className="bg-green-600 hover:bg-green-700"
                            onClick={() => router.push("/onboarding?step=4")}
                          >
                            Connect
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* TODO: Uncomment when implementing additional integrations */}
                    {/* Google Analytics */}
                    {/* <div className="flex items-center justify-between p-6 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/20 rounded-lg flex items-center justify-center">
                          <BarChart3 className="w-6 h-6 text-orange-600" />
                        </div>
                        <div>
                          <div className="font-semibold text-lg">Google Analytics</div>
                          <div className="text-sm text-muted-foreground">
                            {formData.analyticsConnected ? "Connected" : "Not connected"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {formData.analyticsConnected ? (
                          <>
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <Button variant="outline" size="sm">
                              Reconnect
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" className="bg-green-600 hover:bg-green-700">
                            Connect
                          </Button>
                        )}
                      </div>
                    </div> */}

                    {/* Social Media */}
                    {/* <div className="flex items-center justify-between p-6 border rounded-lg">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/20 rounded-lg flex items-center justify-center">
                          <Globe className="w-6 h-6 text-purple-600" />
                        </div>
                        <div>
                          <div className="font-semibold text-lg">Social Media</div>
                          <div className="text-sm text-muted-foreground">
                            {formData.socialConnected ? "Connected" : "Not connected"}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {formData.socialConnected ? (
                          <>
                            <CheckCircle className="w-5 h-5 text-green-600" />
                            <Button variant="outline" size="sm">
                              Reconnect
                            </Button>
                          </>
                        ) : (
                          <Button size="sm" className="bg-green-600 hover:bg-green-700">
                            Connect
                          </Button>
                        )}
                      </div>
                    </div> */}

                    {/* Additional Integration Placeholder */}
                    {/* <div className="flex items-center justify-between p-6 border rounded-lg border-dashed">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-lg flex items-center justify-center">
                          <Plus className="w-6 h-6 text-gray-400" />
                        </div>
                        <div>
                          <div className="font-semibold text-lg text-muted-foreground">More Integrations</div>
                          <div className="text-sm text-muted-foreground">
                            Coming soon
                          </div>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" disabled>
                        Coming Soon
                      </Button>
                    </div> */}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Account Tab */}
            {activeTab === "account" && (
              <Card className="border-green-200 dark:border-green-800">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Shield className="w-5 h-5" />
                    Account & Security
                  </CardTitle>
                  <CardDescription>
                    Manage your account security, data preferences, and privacy settings.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-8">
                  {/* Security Settings - TODO: Uncomment when implementing security features
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Security Settings</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="font-medium">Two-Factor Authentication</div>
                          <div className="text-sm text-muted-foreground">Add an extra layer of security to your account</div>
                        </div>
                        <Switch
                          checked={formData.twoFactorEnabled}
                          onCheckedChange={(checked) => handleInputChange("twoFactorEnabled", checked)}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium flex items-center gap-2">
                          <Key className="w-4 h-4" />
                          Session Timeout
                        </label>
                        <Select value={formData.sessionTimeout} onValueChange={(value) => handleInputChange("sessionTimeout", value)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 hour</SelectItem>
                            <SelectItem value="8">8 hours</SelectItem>
                            <SelectItem value="24">24 hours</SelectItem>
                            <SelectItem value="168">1 week</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  */}

                  {/* Data Management - TODO: Uncomment when implementing data export/import
                  <div className="space-y-6">
                    <h3 className="text-lg font-semibold">Data Management</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="font-medium">Export My Data</div>
                          <div className="text-sm text-muted-foreground">Download all your SEO data and settings</div>
                        </div>
                        <Button variant="outline" onClick={handleExportData}>
                          <Download className="w-4 h-4 mr-2" />
                          Export
                        </Button>
                      </div>
                      <div className="flex items-center justify-between p-4 border rounded-lg">
                        <div className="space-y-1">
                          <div className="font-medium">Import Data</div>
                          <div className="text-sm text-muted-foreground">Upload data from other SEO tools</div>
                        </div>
                        <Button variant="outline">
                          <Upload className="w-4 h-4 mr-2" />
                          Import
                        </Button>
                      </div>
                    </div>
                  </div>
                  */}

                  {/* Revamp My Site */}
                  <div className="space-y-4 sm:space-y-6">
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <Rocket className="w-5 h-5 text-amber-600" />
                      Revamp My Site
                    </h3>
                    <div className="p-4 border border-amber-200 dark:border-amber-800 rounded-lg bg-amber-50 dark:bg-amber-950/20">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="space-y-2">
                          <div className="font-medium">Planning a site revamp?</div>
                          <div className="text-sm text-muted-foreground">
                            Redesigned your whole website with new content and pages? Use this to reset your SEO tracking, re-crawl your updated site, and start fresh with new focus keywords for your new content.
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          className="w-full sm:w-auto flex-shrink-0 border-amber-300 dark:border-amber-700 hover:bg-amber-100 dark:hover:bg-amber-900/30"
                          onClick={() => setShowRevampModal(true)}
                        >
                          <Rocket className="w-4 h-4 mr-2" />
                          Start Site Revamp
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Danger Zone */}
                  <div className="space-y-4 sm:space-y-6">
                    <h3 className="text-lg font-semibold text-red-600">Danger Zone</h3>
                    <div className="p-4 border border-red-200 dark:border-red-800 rounded-lg bg-red-50 dark:bg-red-950/20">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <div className="space-y-2">
                          <div className="font-medium text-red-600">Delete Account</div>
                          <div className="text-sm text-muted-foreground">
                            Permanently delete your account and all associated data. This action cannot be undone.
                          </div>
                          <div className="text-xs text-red-500">
                            <strong>This will delete:</strong> All SEO progress, implementation history, GSC data, 
                            recommendations, settings, and account information.
                          </div>
                        </div>
                        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
                          <DialogTrigger asChild>
                            <Button variant="destructive" className="w-full sm:w-auto flex-shrink-0">
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete Account
                            </Button>
                          </DialogTrigger>
                          <DialogContent className="sm:max-w-md">
                            <DialogHeader>
                              <DialogTitle className="flex items-center gap-2 text-red-600">
                                <AlertTriangle className="w-5 h-5" />
                                Delete Account
                              </DialogTitle>
                              <DialogDescription>
                                This action will permanently delete your account and all associated data. 
                                <strong> This cannot be undone.</strong>
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div className="bg-red-50 dark:bg-red-950/20 p-3 rounded-lg">
                                <p className="text-sm font-medium text-red-800 dark:text-red-200 mb-2">
                                  The following data will be permanently deleted:
                                </p>
                                <ul className="text-xs text-red-700 dark:text-red-300 space-y-1">
                                  <li>• All SEO progress and implementation history</li>
                                  <li>• Google Search Console data and tokens</li>
                                  <li>• AI-generated recommendations and suggestions</li>
                                  <li>• Content audit results and keyword analysis</li>
                                  <li>• Account settings and preferences</li>
                                  <li>• All cached data and analytics</li>
                                </ul>
                              </div>
                              <p className="text-sm">
                                To confirm deletion, type <strong>DELETE</strong> in the box below{!isGoogleUser && " and enter your password"}:
                              </p>
                              <div className="space-y-3">
                                <Input
                                  placeholder="Type DELETE to confirm"
                                  value={deleteConfirmation}
                                  onChange={(e) => setDeleteConfirmation(e.target.value)}
                                  className="border-red-200 focus:border-red-400"
                                />
                                {!isGoogleUser && (
                                  <Input
                                    type="password"
                                    placeholder="Enter your password"
                                    value={deletePassword}
                                    onChange={(e) => setDeletePassword(e.target.value)}
                                    className="border-red-200 focus:border-red-400"
                                  />
                                )}
                                {isGoogleUser && (
                                  <div className="text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/20 p-2 rounded">
                                    <strong>Google Account:</strong> You&apos;ll be prompted to re-authenticate with Google when you click delete.
                                  </div>
                                )}
                              </div>
                            </div>
                            <DialogFooter className="gap-2">
                              <Button
                                variant="outline"
                                onClick={() => {
                                  setShowDeleteDialog(false);
                                  setDeleteConfirmation("");
                                  setDeletePassword("");
                                }}
                                disabled={isDeleting}
                              >
                                Cancel
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={handleDeleteAccount}
                                disabled={isDeleting || deleteConfirmation !== "DELETE" || (!isGoogleUser && !deletePassword)}
                                className="gap-2"
                              >
                                {isDeleting ? (
                                  <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                    Deleting...
                                  </>
                                ) : (
                                  <>
                                    <Trash2 className="w-4 h-4" />
                                    Delete Account
                                  </>
                                )}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
      <RevampModal open={showRevampModal} onClose={() => setShowRevampModal(false)} />
    </MainLayout>
  );
}

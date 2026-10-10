"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import MainLayout from "../components/MainLayout";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, MessageSquare } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import { createGSCTokenManager } from "../lib/gscTokenManager";
import SquashBounceLoader from "../components/ui/squash-bounce-loader";
import { useMinimumLoading } from "../hooks/use-minimum-loading";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../lib/firebaseConfig";
import { detectLocationIssues } from "../lib/smartLocationDetector";
import LocationIssueAlert from "../components/dashboard/LocationIssueAlert";
import { generateRecommendedKeyword, updateSuggestionWithKeyword } from "../lib/locationUtils";

export default function IntentMismatch() {
  const { user, isLoading: authLoading } = useAuth();
  const { data } = useOnboarding();
  const router = useRouter();
  const [mismatches, setMismatches] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterScore, setFilterScore] = useState("all");
  const [isGenerating, setIsGenerating] = useState(false);
  const [lowCtrPages, setLowCtrPages] = useState([]);
  const [dismissedLocationAlerts, setDismissedLocationAlerts] = useState(new Set());
  const [locationAlertInteractions, setLocationAlertInteractions] = useState(new Map());
  const shouldShowLoader = useMinimumLoading(isLoading, 3000);

  useEffect(() => {
    // Load cached results first for faster initial load
    const loadCachedResults = async () => {
      if (!user?.id) return;
      
      try {
        console.log("🔍 Loading cached intent mismatches...");
        const { collection, query, where, getDocs } = await import("firebase/firestore");
        const { db } = await import("../lib/firebaseConfig");
        
        const q = query(
          collection(db, "intentMismatches"),
          where("userId", "==", user.id)
        );
        
        const snapshot = await getDocs(q);
        const cachedMismatches = snapshot.docs.map(doc => {
          const data = doc.data();
          console.log(`🔍 Loading cached data for ${data.keyword}:`, {
            hasTitle: !!data.title,
            hasMetaDescription: !!data.metaDescription,
            hasPageContent: !!data.pageContent,
            hasPageHeadings: !!data.pageHeadings,
            hasPageStructure: !!data.pageStructure,
            pageContentLength: data.pageContent?.length || 0,
            pageHeadingsCount: data.pageHeadings?.length || 0
          });
          
          // Map Firebase field names to frontend field names and ensure consistency
          return {
            ...data,
            // Ensure we have the correct field names
            suggestion: data.suggestedFix || data.suggestion,
            // Map page data fields consistently
            title: data.title || data.pageTitle || 'Not available',
            metaDescription: data.metaDescription || data.pageMetaDescription || 'Not available',
            // Ensure other fields are available
            pageUrl: data.pageUrl,
            keyword: data.keyword,
            matchScore: data.matchScore,
            reason: data.reason,
            suggestedFix: data.suggestedFix,
            // Map page structure fields from cached data
            pageContent: data.pageContent || data.fullPageContent || 'Not available',
            pageHeadings: data.pageHeadings || data.allHeadings || [],
            // Map page structure data
            pageStructure: data.pageStructure || {
              headings: data.pageHeadings || data.allHeadings || [],
              contentLength: data.pageContent ? data.pageContent.length : 0,
              contentPreview: data.pageContent ? data.pageContent.substring(0, 500) : 'Not available',
              hasContent: !!data.pageContent,
              headingsCount: data.pageHeadings ? data.pageHeadings.length : 0
            },
            // Map full page content
            fullPageContent: data.fullPageContent || data.pageContent || '',
            // Map all headings
            allHeadings: data.allHeadings || data.pageHeadings || []
          };
        });
        
        // Filter out original documents when there's a fixed version available
        const filteredMismatches = cachedMismatches.filter(mismatch => {
          // If this is a fixed version, keep it
          if (mismatch.locationIssueFixed || mismatch.isFixedVersion) {
            return true;
          }
          
          // If this is an original document, check if there's a fixed version
          const hasFixedVersion = cachedMismatches.some(other => 
            other.locationIssueFixed && 
            other.keyword === mismatch.keyword &&
            other.pageUrl === mismatch.pageUrl
          );
          
          // Only keep original if there's no fixed version
          return !hasFixedVersion;
        });
        
        if (filteredMismatches.length > 0) {
          console.log(`✅ Loaded ${filteredMismatches.length} filtered mismatches (removed ${cachedMismatches.length - filteredMismatches.length} duplicates)`);
          setMismatches(filteredMismatches);
          setIsLoading(false);
          return true;
        }
        
        return false;
      } catch (error) {
        console.error("❌ Error loading cached results:", error);
        return false;
      }
    };

    const fetchLowCtrPages = async (siteUrl, token) => {
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - 28);

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
      console.log("🔍 GSC Raw Data:", json);
      if (!json.rows) {
        console.log("❌ No rows returned from GSC");
        setMismatches([]);
        setIsLoading(false);
        return;
      }
      console.log("✅ GSC returned", json.rows.length, "rows");

      // Debug: Log all rows before filtering
      console.log("🔍 All GSC rows before filtering:", json.rows.slice(0, 5));
      
      const filteredRows = json.rows.filter(
        (r) =>
          parseFloat((r.ctr * 100).toFixed(1)) <= 2 && r.impressions > 20
      );
      
      console.log("🔍 Rows after filtering (≤2% CTR, >20 impressions):", filteredRows.length);
      console.log("🔍 Sample filtered rows:", filteredRows.slice(0, 3));
      
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
              };
            }
            acc[page].clicks += row.clicks;
            acc[page].impressions += row.impressions;
            return acc;
          }, {})
      );

      setLowCtrPages(grouped);

      // Convert low CTR data to intent mismatches with real AI analysis
      const intentMismatches = [];
      
      // Process each keyword-page pair with AI analysis
      for (let i = 0; i < Math.min(filteredRows.length, 10); i++) { // Limit to 10 for demo
        const row = filteredRows[i];
        const keyword = row.keys[0].replace(/^\[|\]$/g, '');
        const pageUrl = row.keys[1];
        
        try {
          // Step 1: Scrape the page content
          console.log(`🔍 Scraping content for: ${pageUrl}`);
          const scrapeResponse = await fetch("/api/scrape-content", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ pageUrl }),
          });

          if (!scrapeResponse.ok) {
            console.error(`❌ Failed to scrape ${pageUrl}: ${scrapeResponse.status}`);
            continue;
          }

          const scrapeData = await scrapeResponse.json();
          console.log(`✅ Scraped content for ${pageUrl}:`, {
            titleLength: scrapeData.data.title?.length || 0,
            contentLength: scrapeData.data.textContent?.length || 0,
            hasHeadings: scrapeData.data.headings?.length > 0
          });
          
          let { title, metaDescription, textContent, headings } = scrapeData.data;

          // Step 2: Check if we have cached results (using backward-compatible helper)
          console.log(`🔍 Checking cache for: ${keyword}`);
          
          try {
            const { getIntentMismatch, saveIntentMismatch } = await import("../lib/firestoreMigrationHelpers");
            const cached = await getIntentMismatch(user.id, keyword, pageUrl);
            
            let analysis;
            if (cached.success && cached.data) {
              // Use cached result
              analysis = cached.data;
              console.log(`✅ Using cached analysis for ${keyword}`);
              
              // Ensure we have the page data from cache
              if (analysis.title && analysis.metaDescription) {
                title = analysis.title;
                metaDescription = analysis.metaDescription;
              }
              
              // Also get page structure data from cache if available
              if (analysis.pageContent) {
                textContent = analysis.pageContent;
              }
              if (analysis.pageHeadings) {
                headings = analysis.pageHeadings;
              }
            } else {
              // Perform new AI analysis
              console.log(`🤖 Performing AI analysis for: ${keyword}`);
              const analysisResponse = await fetch("/api/intent-analysis", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  keyword,
                  pageUrl,
                  pageContent: textContent,
                  title,
                  metaDescription,
                  headings
                }),
              });

              if (!analysisResponse.ok) {
                console.error(`❌ Failed to analyze ${keyword} for ${pageUrl}: ${analysisResponse.status}`);
                throw new Error(`AI analysis failed: ${analysisResponse.status}`);
              }

              analysis = await analysisResponse.json();
              console.log(`✅ AI analysis completed for ${keyword}:`, analysis);
              
              // Cache the result using backward-compatible helper (writes to both structures)
              try {
                await saveIntentMismatch(user.id, keyword, pageUrl, {
                  ...analysis,
                  title,
                  metaDescription,
                  // Store comprehensive page data for better context
                  pageContent: textContent?.substring(0, 2000), // Store more content for better context
                  pageHeadings: headings,
                  // Store the full crawl data for comprehensive analysis
                  fullPageData: {
                    title,
                    metaDescription,
                    contentLength: textContent?.length || 0,
                    headingsCount: headings?.length || 0,
                    hasContent: !!textContent
                  },
                  // Store page structure data with consistent field names
                  pageStructure: {
                    headings: headings || [],
                    contentLength: textContent ? textContent.length : 0,
                    contentPreview: textContent ? textContent.substring(0, 500) : '',
                    hasContent: !!textContent,
                    headingsCount: headings ? headings.length : 0
                  },
                  // Store full page content for detailed analysis
                  fullPageContent: textContent || '',
                  // Store all headings for structure analysis
                  allHeadings: headings || []
                });
                console.log(`💾 Cached new analysis for ${keyword}`);
              } catch (cacheError) {
                console.error(`❌ Failed to cache analysis for ${keyword}:`, cacheError);
                // Continue without caching
              }
            }
            
            intentMismatches.push({
              keyword,
              pageUrl,
              matchScore: analysis.matchScore,
              reason: analysis.reason,
              suggestion: analysis.suggestedFix,
              suggestedFix: analysis.suggestedFix, // Also save with the original field name for consistency
              // Include the page data for comprehensive context
              title,
              metaDescription,
              pageContent: textContent?.substring(0, 2000), // Store more content for better context
              pageHeadings: headings,
              // Store analysis metadata
              analysisData: {
                matchScore: analysis.matchScore,
                reason: analysis.reason,
                suggestedFix: analysis.suggestedFix
              },
              // Store comprehensive page structure data
              pageStructure: {
                headings: headings || [],
                contentLength: textContent ? textContent.length : 0,
                contentPreview: textContent ? textContent.substring(0, 500) : '',
                hasContent: !!textContent,
                headingsCount: headings ? headings.length : 0
              },
              // Store full page content for detailed analysis
              fullPageContent: textContent || '',
              // Store all headings for structure analysis
              allHeadings: headings || []
            });
          } catch (error) {
            console.error(`❌ Error processing ${keyword} for ${pageUrl}:`, error);
            
            // Fallback to dummy data if AI analysis fails
            intentMismatches.push({
              keyword,
              pageUrl,
              matchScore: null,
              reason: "AI analysis failed - using fallback data",
              suggestion: "Review page content and ensure it matches search intent",
              suggestedFix: "Review page content and ensure it matches search intent",
              // Include basic page data even in fallback
              title: title || 'Not available',
              metaDescription: metaDescription || 'Not available',
              pageContent: textContent?.substring(0, 1000) || 'Content not available',
              pageHeadings: headings || [],
              // Include basic page structure
              pageStructure: {
                headings: headings || [],
                contentLength: textContent ? textContent.length : 0,
                contentPreview: textContent ? textContent.substring(0, 300) : 'Content preview not available',
                hasContent: !!textContent,
                headingsCount: headings ? headings.length : 0
              },
              fullPageContent: textContent || '',
              allHeadings: headings || []
            });
          }

          // Small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          console.error(`❌ Error processing ${keyword} for ${pageUrl}:`, error);
          
          // Fallback to dummy data if AI analysis fails
          intentMismatches.push({
            keyword,
            pageUrl,
            matchScore: null,
            reason: "AI analysis failed - using fallback data",
            suggestion: "Review page content and ensure it matches search intent",
            suggestedFix: "Review page content and ensure it matches search intent",
            // Include basic page data even in fallback
            title: title || 'Not available',
            metaDescription: metaDescription || 'Not available',
            pageContent: textContent?.substring(0, 1000) || 'Content not available',
            pageHeadings: headings || [],
            // Include basic page structure
            pageStructure: {
              headings: headings || [],
              contentLength: textContent ? textContent.length : 0,
              contentPreview: textContent ? textContent.substring(0, 300) : 'Content preview not available',
              hasContent: !!textContent,
              headingsCount: headings ? headings.length : 0
            },
            fullPageContent: textContent || '',
            allHeadings: headings || []
          });
        }
      }

      setMismatches(intentMismatches);
      setIsLoading(false);
    };

    const initializePage = async () => {
      if (!user?.id) {
        console.log("❌ No user ID");
        return;
      }

      // Check if GSC is connected
      if (!data?.hasGSC) {
        console.log("❌ GSC not connected");
        setIsLoading(false);
        return;
      }

      // Try to load cached results first
      const hasCached = await loadCachedResults();
      
      if (!hasCached) {
        // If no cached data, check GSC and load fresh data
        const fetchGSCData = async () => {
          try {
            console.log("🔍 Fetching GSC data for user:", user.id);
            const tokenManager = createGSCTokenManager(user.id);
            
            // Add a small delay to ensure tokens are stored
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            const gscData = await tokenManager.getStoredGSCData();
            
            console.log("🔍 Stored GSC data:", gscData);
            console.log("🔍 GSC data details:", {
              hasAccessToken: !!gscData?.accessToken,
              hasRefreshToken: !!gscData?.refreshToken,
              hasSiteUrl: !!gscData?.siteUrl,
              accessTokenLength: gscData?.accessToken?.length,
              refreshTokenLength: gscData?.refreshToken?.length
            });
            
            if (!gscData?.accessToken || !gscData?.siteUrl) {
              console.log("❌ Missing GSC access token or site URL");
              setIsLoading(false);
              return;
            }

            // Get valid access token (refresh if needed)
            const validToken = await tokenManager.getValidAccessToken();
            if (!validToken) {
              console.log("❌ Could not get valid access token");
              setIsLoading(false);
              return;
            }

            console.log("✅ Got valid token, fetching low CTR pages...");
            fetchLowCtrPages(gscData.siteUrl, validToken);
          } catch (error) {
            console.error("❌ Error fetching GSC data:", error);
            setIsLoading(false);
          }
        };

        fetchGSCData();
      }
    };

    initializePage();
  }, [user]);

  // Note: We need to create a separate function for generateMismatches that can access the functions
  const generateMismatches = async () => {
    try {
      setIsGenerating(true);
      
      // Re-fetch GSC data to get fresh intent mismatches
      if (!user?.id) {
        toast.error("User not authenticated");
        return;
      }

      const tokenManager = createGSCTokenManager(user.id);
      const gscData = await tokenManager.getStoredGSCData();
      
      if (!gscData?.accessToken || !gscData?.siteUrl) {
        toast.error("Google Search Console not connected");
        return;
      }

      const validToken = await tokenManager.getValidAccessToken();
      if (!validToken) {
        toast.error("Could not get valid access token");
        return;
      }

      // Clear old intent mismatches before generating new ones
      try {
        console.log("🧹 Clearing old intent mismatches...");
        const { collection, query, where, getDocs, deleteDoc } = await import("firebase/firestore");
        
        const q = query(
          collection(db, "intentMismatches"),
          where("userId", "==", user.id)
        );
        
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        
        console.log(`✅ Cleared ${snapshot.docs.length} old intent mismatches`);
        toast.success(`Cleared ${snapshot.docs.length} old analyses`);
      } catch (clearError) {
        console.error("⚠️ Warning: Could not clear old data:", clearError);
        // Continue with generation even if clearing fails
      }

      // We need to recreate fetchLowCtrPages here since it's now inside useEffect
      const fetchLowCtrPages = async (siteUrl, token) => {
        const today = new Date();
        const start = new Date(today);
        start.setDate(today.getDate() - 28);

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
        console.log("🔍 GSC Raw Data:", json);
        if (!json.rows) {
          console.log("❌ No rows returned from GSC");
          setMismatches([]);
          setIsLoading(false);
          return;
        }
        console.log("✅ GSC returned", json.rows.length, "rows");

        // Debug: Log all rows before filtering
        console.log("🔍 All GSC rows before filtering:", json.rows.slice(0, 5));
        
        const filteredRows = json.rows.filter(
          (r) =>
            parseFloat((r.ctr * 100).toFixed(1)) <= 2 && r.impressions > 20
        );
        
        console.log("🔍 Rows after filtering (≤2% CTR, >20 impressions):", filteredRows.length);
        console.log("🔍 Sample filtered rows:", filteredRows.slice(0, 3));
        
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
                };
              }
              acc[page].clicks += row.clicks;
              acc[page].impressions += row.impressions;
              return acc;
            }, {})
        );

        setLowCtrPages(grouped);

        // Convert low CTR data to intent mismatches with real AI analysis
        const intentMismatches = [];
        
        // Process each keyword-page pair with AI analysis
        for (let i = 0; i < Math.min(filteredRows.length, 10); i++) { // Limit to 10 for demo
          const row = filteredRows[i];
          const keyword = row.keys[0].replace(/^\[|\]$/g, '');
          const pageUrl = row.keys[1];
          
          try {
            // Step 1: Scrape the page content
            console.log(`🔍 Scraping content for: ${pageUrl}`);
            const scrapeResponse = await fetch("/api/scrape-content", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ pageUrl }),
            });

            if (!scrapeResponse.ok) {
              console.error(`❌ Failed to scrape ${pageUrl}: ${scrapeResponse.status}`);
              continue;
            }

            const scrapeData = await scrapeResponse.json();
            console.log(`✅ Scraped content for ${pageUrl}:`, {
              titleLength: scrapeData.data.title?.length || 0,
              contentLength: scrapeData.data.textContent?.length || 0,
              hasHeadings: scrapeData.data.headings?.length > 0
            });
            
            let { title, metaDescription, textContent, headings } = scrapeData.data;

            // Step 2: Check if we have cached results
            const cacheKey = `${user.id}_${encodeURIComponent(keyword)}_${encodeURIComponent(pageUrl)}`;
            console.log(`🔍 Checking cache for: ${keyword}`);
            
            try {
              const cachedDoc = await getDoc(doc(db, "intentMismatches", cacheKey));
              
              let analysis;
              if (cachedDoc.exists()) {
                // Use cached result
                analysis = cachedDoc.data();
                console.log(`✅ Using cached analysis for ${keyword}`);
                
                // Ensure we have the page data from cache
                if (analysis.title && analysis.metaDescription) {
                  title = analysis.title;
                  metaDescription = analysis.metaDescription;
                }
                
                // Also get page structure data from cache if available
                if (analysis.pageContent) {
                  textContent = analysis.pageContent;
                }
                if (analysis.pageHeadings) {
                  headings = analysis.pageHeadings;
                }
              } else {
                // Perform new AI analysis
                console.log(`🤖 Performing AI analysis for: ${keyword}`);
                const analysisResponse = await fetch("/api/intent-analysis", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    keyword,
                    pageUrl,
                    pageContent: textContent,
                    title,
                    metaDescription,
                    headings
                  }),
                });

                if (!analysisResponse.ok) {
                  console.error(`❌ Failed to analyze ${keyword} for ${pageUrl}: ${analysisResponse.status}`);
                  throw new Error(`AI analysis failed: ${analysisResponse.status}`);
                }

                analysis = await analysisResponse.json();
                console.log(`✅ AI analysis completed for ${keyword}:`, analysis);
                
                // Cache the result
                try {
                  await setDoc(doc(db, "intentMismatches", cacheKey), {
                    ...analysis,
                    userId: user.id,
                    keyword,
                    pageUrl,
                    createdAt: new Date(),
                    title,
                    metaDescription,
                    // Store comprehensive page data for better context
                    pageContent: textContent?.substring(0, 2000), // Store more content for better context
                    pageHeadings: headings,
                    // Store the full crawl data for comprehensive analysis
                    fullPageData: {
                      title,
                      metaDescription,
                      contentLength: textContent?.length || 0,
                      headingsCount: headings?.length || 0,
                      hasContent: !!textContent
                    },
                    // Store page structure data with consistent field names
                    pageStructure: {
                      headings: headings || [],
                      contentLength: textContent ? textContent.length : 0,
                      contentPreview: textContent ? textContent.substring(0, 500) : '',
                      hasContent: !!textContent,
                      headingsCount: headings ? headings.length : 0
                    },
                    // Store full page content for detailed analysis
                    fullPageContent: textContent || '',
                    // Store all headings for structure analysis
                    allHeadings: headings || []
                  });
                  console.log(`💾 Cached new analysis for ${keyword}`);
                } catch (cacheError) {
                  console.error(`❌ Failed to cache analysis for ${keyword}:`, cacheError);
                  // Continue without caching
                }
              }
              
              intentMismatches.push({
                keyword,
                pageUrl,
                matchScore: analysis.matchScore,
                reason: analysis.reason,
                suggestion: analysis.suggestedFix,
                suggestedFix: analysis.suggestedFix, // Also save with the original field name for consistency
                // Include the page data for comprehensive context
                title,
                metaDescription,
                pageContent: textContent?.substring(0, 2000), // Store more content for better context
                pageHeadings: headings,
                // Store analysis metadata
                analysisData: {
                  matchScore: analysis.matchScore,
                  reason: analysis.reason,
                  suggestedFix: analysis.suggestedFix
                },
                // Store comprehensive page structure data
                pageStructure: {
                  headings: headings || [],
                  contentLength: textContent ? textContent.length : 0,
                  contentPreview: textContent ? textContent.substring(0, 500) : '',
                  hasContent: !!textContent,
                  headingsCount: headings ? headings.length : 0
                },
                // Store full page content for detailed analysis
                fullPageContent: textContent || '',
                // Store all headings for structure analysis
                allHeadings: headings || []
              });
            } catch (error) {
              console.error(`❌ Error processing ${keyword} for ${pageUrl}:`, error);
              
              // Fallback to dummy data if AI analysis fails
              intentMismatches.push({
                keyword,
                pageUrl,
                matchScore: null,
                reason: "AI analysis failed - using fallback data",
                suggestion: "Review page content and ensure it matches search intent",
                suggestedFix: "Review page content and ensure it matches search intent",
                // Include basic page data even in fallback
                title: title || 'Not available',
                metaDescription: metaDescription || 'Not available',
                pageContent: textContent?.substring(0, 1000) || 'Content not available',
                pageHeadings: headings || [],
                // Include basic page structure
                pageStructure: {
                  headings: headings || [],
                  contentLength: textContent ? textContent.length : 0,
                  contentPreview: textContent ? textContent.substring(0, 300) : 'Content preview not available',
                  hasContent: !!textContent,
                  headingsCount: headings ? headings.length : 0
                },
                fullPageContent: textContent || '',
                allHeadings: headings || []
              });
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (error) {
            console.error(`❌ Error processing ${keyword} for ${pageUrl}:`, error);
            
            // Fallback to dummy data if AI analysis fails
            intentMismatches.push({
              keyword,
              pageUrl,
              matchScore: null,
              reason: "AI analysis failed - using fallback data",
              suggestion: "Review page content and ensure it matches search intent",
              suggestedFix: "Review page content and ensure it matches search intent",
              // Include basic page data even in fallback
              title: title || 'Not available',
              metaDescription: metaDescription || 'Not available',
              pageContent: textContent?.substring(0, 1000) || 'Content not available',
              pageHeadings: headings || [],
              // Include basic page structure
              pageStructure: {
                headings: headings || [],
                contentLength: textContent ? textContent.length : 0,
                contentPreview: textContent ? textContent.substring(0, 300) : 'Content preview not available',
                hasContent: !!textContent,
                headingsCount: headings ? headings.length : 0
              },
              fullPageContent: textContent || '',
              allHeadings: headings || []
            });
          }
        }

        setMismatches(intentMismatches);
        setIsLoading(false);
      };

      // Fetch fresh data
      await fetchLowCtrPages(gscData.siteUrl, validToken);
      toast.success("Generated fresh intent mismatches from GSC data");
      
    } catch (error) {
      console.error("Error generating intent mismatches:", error);
      toast.error("Failed to generate intent mismatches");
    } finally {
      setIsGenerating(false);
    }
  };

  // We also need to create a loadCachedResults function that can be called from outside useEffect
  const loadCachedResults = async () => {
    if (!user?.id) return;
    
    try {
      console.log("🔍 Loading cached intent mismatches...");
      const { collection, query, where, getDocs } = await import("firebase/firestore");
      const { db } = await import("../lib/firebaseConfig");
      
      const q = query(
        collection(db, "intentMismatches"),
        where("userId", "==", user.id)
      );
      
      const snapshot = await getDocs(q);
      const cachedMismatches = snapshot.docs.map(doc => {
        const data = doc.data();
        console.log(`🔍 Loading cached data for ${data.keyword}:`, {
          hasTitle: !!data.title,
          hasMetaDescription: !!data.metaDescription,
          hasPageContent: !!data.pageContent,
          hasPageHeadings: !!data.pageHeadings,
          hasPageStructure: !!data.pageStructure,
          pageContentLength: data.pageContent?.length || 0,
          pageHeadingsCount: data.pageHeadings?.length || 0
        });
        
        // Map Firebase field names to frontend field names and ensure consistency
        return {
          ...data,
          // Ensure we have the correct field names
          suggestion: data.suggestedFix || data.suggestion,
          // Map page data fields consistently
          title: data.title || data.pageTitle || 'Not available',
          metaDescription: data.metaDescription || data.pageMetaDescription || 'Not available',
          // Ensure other fields are available
          pageUrl: data.pageUrl,
          keyword: data.keyword,
          matchScore: data.matchScore,
          reason: data.reason,
          suggestedFix: data.suggestedFix,
          // Map page structure fields from cached data
          pageContent: data.pageContent || data.fullPageContent || 'Not available',
          pageHeadings: data.pageHeadings || data.allHeadings || [],
          // Map page structure data
          pageStructure: data.pageStructure || {
            headings: data.pageHeadings || data.allHeadings || [],
            contentLength: data.pageContent ? data.pageContent.length : 0,
            contentPreview: data.pageContent ? data.pageContent.substring(0, 500) : 'Not available',
            hasContent: !!data.pageContent,
            headingsCount: data.pageHeadings ? data.pageHeadings.length : 0
          },
          // Map full page content
          fullPageContent: data.fullPageContent || data.pageContent || '',
          // Map all headings
          allHeadings: data.allHeadings || data.pageHeadings || []
        };
      });
      
      // Filter out original documents when there's a fixed version available
      const filteredMismatches = cachedMismatches.filter(mismatch => {
        // If this is a fixed version, keep it
        if (mismatch.locationIssueFixed || mismatch.isFixedVersion) {
          return true;
        }
        
        // If this is an original document, check if there's a fixed version
        const hasFixedVersion = cachedMismatches.some(other => 
          other.locationIssueFixed && 
          other.keyword === mismatch.keyword &&
          other.pageUrl === mismatch.pageUrl
        );
        
        // Only keep original if there's no fixed version
        return !hasFixedVersion;
      });
      
      if (filteredMismatches.length > 0) {
        console.log(`✅ Loaded ${filteredMismatches.length} filtered mismatches (removed ${cachedMismatches.length - filteredMismatches.length} duplicates)`);
        setMismatches(filteredMismatches);
        setIsLoading(false);
        return true;
      }
      
      return false;
    } catch (error) {
      console.error("❌ Error loading cached results:", error);
      return false;
    }
  };

  const getScoreBadge = (score) => {
    if (score == null) return <Badge variant="outline">Analysis unavailable</Badge>;
    if (score < 40) {
      return <Badge variant="destructive" className="flex items-center gap-1">
        <AlertTriangle className="w-3 h-3" />
        {score} - Likely Mismatch
      </Badge>;
    } else if (score < 70) {
      return <Badge variant="secondary" className="flex items-center gap-1">
        <Clock className="w-3 h-3" />
        {score} - Moderate
      </Badge>;
    } else {
      return <Badge variant="default" className="flex items-center gap-1">
        <CheckCircle2 className="w-3 h-3" />
        {score} - Good
      </Badge>;
    }
  };

  const filteredMismatches = mismatches.filter(mismatch => {
    if (filterScore === "all") return true;
    if (mismatch.matchScore == null) return false;
    if (filterScore === "low") return mismatch.matchScore < 40;
    if (filterScore === "medium") return mismatch.matchScore >= 40 && mismatch.matchScore < 70;
    if (filterScore === "high") return mismatch.matchScore >= 70;
    return true;
  });

  // Check if a keyword has location issues that need attention
  // Note: This function is kept for future use but UI is disabled
  const checkForLocationIssues = (keyword, userLocation) => {
    if (!userLocation) return null;
    
    try {
      const issues = detectLocationIssues(keyword, userLocation);
      return issues;
    } catch (error) {
      console.error('Error checking location issues:', error);
      return null;
    }
  };

  // Handle location alert actions
  const handleLocationAction = async (action, keyword, locationIssues) => {
    console.log('Location action:', action, keyword, locationIssues);
    
    // Track that user has interacted with this location alert
    const alertId = `${keyword}_${locationIssues.severity}`;
    setLocationAlertInteractions(prev => new Map(prev).set(alertId, action));
    
    switch (action) {
      case 'fix_keyword':
        try {
          // Find the mismatch that needs updating
          const mismatchIndex = mismatches.findIndex(m => 
            m.keyword.replace(/^\[|\]$/g, '') === keyword
          );
          
          if (mismatchIndex !== -1) {
            const mismatch = mismatches[mismatchIndex];
            const recommendedKeyword = generateRecommendedKeyword(keyword, data.businessLocation);
            
            // Update the suggestion to use the recommended keyword
            const updatedSuggestion = updateSuggestionWithKeyword(
              mismatch.suggestion, 
              keyword, 
              recommendedKeyword
            );
            
            // Update local state - keep original keyword, only update suggestion
            const updatedMismatches = [...mismatches];
            updatedMismatches[mismatchIndex] = {
              ...updatedMismatches[mismatchIndex],
              suggestion: updatedSuggestion,
              suggestedFix: updatedSuggestion, // Also update the alternative field name
              // Keep the original keyword from GSC unchanged
              keyword: mismatch.keyword, // Preserve original: "bend local seo"
              // Store the recommended keyword for reference
              recommendedKeyword: recommendedKeyword,
              // Mark as fixed
              locationIssueFixed: true
            };
            
            setMismatches(updatedMismatches);
            
            // Create new document in Firebase - keep original keyword, update suggestion
            const cacheKey = `${user.id}_${encodeURIComponent(keyword)}_${encodeURIComponent(mismatch.pageUrl)}`;
            await setDoc(doc(db, "intentMismatches", cacheKey), {
              ...mismatch,
              suggestion: updatedSuggestion,
              suggestedFix: updatedSuggestion,
              // Keep the original keyword from GSC unchanged
              keyword: mismatch.keyword, // Preserve original: "bend local seo"
              // Store the recommended keyword for reference
              recommendedKeyword: recommendedKeyword,
              updatedAt: new Date(),
              locationIssueFixed: true,
              // This is a "fixed" version
              isFixedVersion: true,
              // Mark location alerts as dismissed for this keyword
              locationAlertsDismissed: true,
              dismissedLocationIssues: [
                { 
                  keyword: keyword, 
                  severity: 'medium', // Assuming medium priority for location issues
                  dismissedAt: new Date(),
                  action: 'fix_keyword'
                }
              ]
            });
            
            toast.success(`Keyword updated from "${keyword}" as requested`);
            
            // Refresh the cached results to show the updated list
            await loadCachedResults();
          }
        } catch (error) {
          console.error('Error updating keyword:', error);
          toast.error('Failed to update keyword');
        }
        break;
        
      case 'do_not_fix':
        // User chooses not to fix the location issue
        toast.info(`Keeping original keyword "${keyword}" as requested`);
        break;
        
      case 'dismiss':
        // User dismisses the alert
        console.log('Location alert dismissed');
        break;
        
      default:
        break;
    }
  };

  // Handle location alert dismissal
  const handleLocationAlertDismiss = (keyword, locationIssues) => {
    // Create a unique identifier for this location alert
    const alertId = `${keyword}_${locationIssues.severity}`;
    setDismissedLocationAlerts(prev => new Set([...prev, alertId]));
    
    // Track that user has interacted with this location alert (dismissed)
    setLocationAlertInteractions(prev => new Map(prev).set(alertId, 'dismissed'));
    
    // Also mark the mismatch as having dismissed location alerts
    const mismatchIndex = mismatches.findIndex(m => 
      m.keyword.replace(/^\[|\]$/g, '') === keyword
    );
    
    if (mismatchIndex !== -1) {
      const updatedMismatches = [...mismatches];
      updatedMismatches[mismatchIndex] = {
        ...updatedMismatches[mismatchIndex],
        locationAlertsDismissed: true,
        dismissedLocationIssues: [
          ...(updatedMismatches[mismatchIndex].dismissedLocationIssues || []),
          { keyword, severity: locationIssues.severity, dismissedAt: new Date() }
        ]
      };
      setMismatches(updatedMismatches);
    }
  };

  // Helper function to style quoted keywords with theme colors
  const styleQuotedKeywords = (text) => {
    if (!text) return text;
    
    return text.split("'").map((part, index) => 
      index % 2 === 1 ? (
        <span key={index} className="text-[#00bf63] font-medium">&apos;{part}&apos;</span>
      ) : (
        part
      )
    );
  };

  const openChatWithContext = (mismatch) => {
    // Check if this keyword has been enhanced with a recommended keyword
    const hasRecommendedKeyword = mismatch.recommendedKeyword && mismatch.locationIssueFixed;
    const targetKeyword = mismatch.keyword.replace(/^\[|\]$/g, '');
    const recommendedKeyword = mismatch.recommendedKeyword;
    
    // Create a comprehensive, SEO-friendly message with complete page context
    let message = `I need help optimizing my page for better search performance. Here's the complete context:

🔑 **Target Keyword:** "${targetKeyword}"`;
    
    // Add recommended keyword information if available
    if (hasRecommendedKeyword) {
      message += `
🎯 **Recommended Enhanced Keyword:** "${recommendedKeyword}" (Location-specific improvement)`;
    }
    
    message += `
🌐 **Page URL:** ${mismatch.pageUrl}
📊 **Current Match Score:** ${mismatch.matchScore == null ? "Unavailable" : `${mismatch.matchScore}/100`}

**Current Page Content:**
- Title: "${mismatch.title || 'Not available'}"
- Meta Description: "${mismatch.metaDescription || 'Not available'}"`;
    
    // Add enhanced content information if keyword was improved
    if (hasRecommendedKeyword) {
      message += `
- Enhanced Suggestion: "${mismatch.suggestedFix || mismatch.suggestion}"`;
    }
    
    message += `

**Page Structure & Content:**
- Page Content Length: ${mismatch.pageContent ? mismatch.pageContent.length + ' characters' : 'Not available'}
- Headings Found: ${mismatch.pageHeadings ? mismatch.pageHeadings.length + ' headings' : 'Not available'}
- Content Preview: "${mismatch.pageContent ? mismatch.pageContent.substring(0, 200) + '...' : 'Not available'}"

**Current Headings Structure:**
${mismatch.pageHeadings ? mismatch.pageHeadings.map((heading, index) => `  ${index + 1}. ${heading}`).join('\n') : 'No headings available'}

**SEO Issue:** ${mismatch.reason}`;
    
    // Add enhanced goal if keyword was improved
    if (hasRecommendedKeyword) {
      message += `

**Enhanced Goal:** Improve this page's performance for both "${targetKeyword}" and "${recommendedKeyword}" while maintaining natural content flow and avoiding over-optimization. Focus on incorporating the location-specific keyword "${recommendedKeyword}" naturally throughout the content.`;
    } else {
      message += `

**Goal:** Improve this page's performance for "${targetKeyword}" while maintaining natural content flow and avoiding over-optimization.`;
    }
    
    message += `

Can you analyze my page structure and give me specific, actionable advice for improving this page's SEO performance naturally?`;
    
    // Store comprehensive context for the chatbot with ALL page data
    localStorage.setItem("chatContext", JSON.stringify({
      type: "intent_mismatch",
      mismatch: {
        ...mismatch,
        // Include all the crawl data for context
        pageTitle: mismatch.title,
        pageMetaDescription: mismatch.metaDescription,
        // Add the target keyword for focus
        targetKeyword: targetKeyword,
        // Include the recommended keyword if available
        recommendedKeyword: hasRecommendedKeyword ? recommendedKeyword : null,
        // Include the current page URL for reference
        currentPageUrl: mismatch.pageUrl,
        // Add the match score for context
        currentMatchScore: mismatch.matchScore,
        // Include complete page structure data
        pageStructure: {
          headings: mismatch.pageHeadings || [],
          contentLength: mismatch.pageContent ? mismatch.pageContent.length : 0,
          contentPreview: mismatch.pageContent ? mismatch.pageContent.substring(0, 500) : '',
          hasContent: !!mismatch.pageContent,
          headingsCount: mismatch.pageHeadings ? mismatch.pageHeadings.length : 0
        },
        // Include the full page content for detailed analysis
        fullPageContent: mismatch.pageContent || '',
        // Include all headings for structure analysis
        allHeadings: mismatch.pageHeadings || []
      },
      message,
      // Add comprehensive SEO guidance parameters
      seoGuidance: {
        approach: "natural_optimization",
        focus: "user_experience_first",
        avoid: "keyword_stuffing",
        strategy: "semantic_relevance",
        // Add specific SEO best practices
        bestPractices: {
          keywordDensity: "Keep keyword usage natural (1-2% max)",
          contentQuality: "Focus on valuable, informative content",
          userIntent: "Match what users actually want to find",
          futureProofing: "Optimize for semantic relevance, not exact matches",
          competitiveAnalysis: "Consider what competitors are doing well"
        },
        // Add optimization priorities based on page structure
        optimizationPriorities: [
          "Analyze current page structure and headings",
          "Improve page title and meta description",
          "Enhance H1 and main heading structure", 
          "Add relevant, valuable content sections",
          "Improve internal linking opportunities",
          "Ensure mobile-friendly user experience"
        ],
        // Add page-specific analysis guidance
        pageAnalysis: {
          checkHeadings: "Review all H1, H2, H3 tags for keyword opportunities",
          contentGaps: "Identify areas where target keyword could naturally fit",
          structureOptimization: "Optimize heading hierarchy for better SEO",
          contentEnhancement: "Enhance existing content sections with target keywords"
        },
        // Add enhanced guidance for location-specific keywords
        locationOptimization: hasRecommendedKeyword ? {
          primaryKeyword: targetKeyword,
          enhancedKeyword: recommendedKeyword,
          strategy: "Incorporate both keywords naturally - use the enhanced location-specific keyword more prominently",
          contentAreas: [
            "Page title and meta description",
            "H1 and main headings", 
            "Introduction and conclusion sections",
            "Local business information",
            "Service area descriptions"
          ],
          keywordBalance: "Use enhanced keyword 60-70%, original keyword 30-40% for natural flow"
        } : null
      }
    }));
    
    // Instead of navigating to dashboard, open the chat directly
    // We'll use a custom event to trigger the chat opening
    const chatEvent = new CustomEvent('openChatAssistant', {
      detail: {
        context: 'intent_mismatch',
        message: message,
        hasPageStructure: !!(mismatch.pageHeadings && mismatch.pageContent)
      }
    });
    window.dispatchEvent(chatEvent);
    
    // Show a toast notification that chat context is loaded
    toast.success("Complete page context loaded!", {
      description: "Click the chat button in the bottom right to get detailed SEO help for this page."
    });
  };

  // Show loading state while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-between">
        <div className="flex-1"></div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#00BF63] mx-auto mb-4"></div>
            <p className="text-muted-foreground">Checking authentication...</p>
          </div>
        </div>
        <div className="flex-1"></div>
      </div>
    );
  }

  // Redirect to auth if no user
  if (!user) {
    router.push("/auth");
    return null;
  }

  return (
    <MainLayout>
      <div className="mb-6">
        <h1 className="text-4xl font-bold mb-2">Search Intent Mismatches</h1>
        <p className="text-muted-foreground">
          Identify pages that rank for keywords but may not satisfy searcher expectations.
        </p>
      </div>

      {/* Generate Button */}
      <Card className="mb-6">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold mb-2">Generate Intent Analysis</h3>
              <p className="text-sm text-muted-foreground">
                {mismatches.length > 0 
                  ? `Showing ${mismatches.length} cached results. Click to refresh with fresh GSC data.`
                  : "Analyze your Google Search Console data to find keyword-page mismatches"
                }
              </p>
            </div>
            <div className="flex gap-2">
              {mismatches.length > 0 && (
                <Button 
                  onClick={loadCachedResults} 
                  variant="outline"
                  disabled={isLoading}
                >
                  Load Cached
                </Button>
              )}
              <Button 
                onClick={generateMismatches} 
                disabled={isGenerating || !data?.hasGSC}
                className="bg-[#00bf63] hover:bg-[#00bf63]/90"
              >
                {isGenerating ? "Generating..." : !data?.hasGSC ? "Connect GSC First" : "Generate Analysis"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* GSC Connection Alert */}
      {!data?.hasGSC && (
        <Alert className="mb-6">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Google Search Console not connected.</strong> You need to connect your GSC account to analyze intent mismatches. 
            <Button 
              variant="link" 
              className="p-0 h-auto text-[#00bf63] hover:text-[#00bf63]/90 ml-1"
              onClick={() => router.push("/dashboard")}
            >
              Go to Dashboard to connect
            </Button>
          </AlertDescription>
        </Alert>
      )}


      {/* Location Keyword Warning */}
      <Alert className="mt-6 mb-5 bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800">
        <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        <AlertDescription className="text-blue-800 dark:text-blue-200">
          <strong>Location Keyword Notice:</strong> Some keywords may appear without full location context (e.g., &quot;orleans seo&quot; instead of &quot;new orleans seo&quot;). 
          If you notice location-related keywords that seem incorrect, consider updating them in your content to include the full location name for better local targeting.
        </AlertDescription>
      </Alert>

      {/* Info Alert */}
       <Alert className="mt-6 mb-5">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Intent mismatches occur when your page ranks for a keyword but doesn&apos;t fully satisfy what the searcher is looking for. 
          This can lead to high bounce rates and poor user experience. Use the &quot;Fix This&quot; button to get AI-powered suggestions for improving your content.
        </AlertDescription>
      </Alert>

      {/* Filter and Status */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Filter by score:</span>
            <Select value={filterScore} onValueChange={setFilterScore}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Scores</SelectItem>
                <SelectItem value="low">Low (&lt; 40)</SelectItem>
                <SelectItem value="medium">Medium (40-69)</SelectItem>
                <SelectItem value="high">High (70+)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <span className="text-sm text-muted-foreground">
            {filteredMismatches.length} of {mismatches.length} mismatches
          </span>
        </div>
        {mismatches.length > 0 && (
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-muted-foreground">Cached data loaded</span>
          </div>
        )}
      </div>

      

      {/* Results */}
      {shouldShowLoader ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <SquashBounceLoader size="lg" className="mb-4" />
              <p className="text-sm text-muted-foreground">Loading intent mismatches...</p>
            </div>
          </CardContent>
        </Card>
      ) : mismatches.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No intent mismatches found</h3>
              <p className="text-muted-foreground mb-4">
                {data?.hasGSC 
                  ? "No cached analysis found. Generate your first intent mismatch analysis to get started."
                  : "Connect your Google Search Console to analyze intent mismatches."
                }
              </p>
              {data?.hasGSC ? (
                <Button onClick={generateMismatches} className="bg-[#00bf63] hover:bg-[#00bf63]/90">
                  Generate Analysis
                </Button>
              ) : (
                <Button onClick={() => router.push("/dashboard")} className="bg-[#00bf63] hover:bg-[#00bf63]/90">
                  Connect GSC
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Intent Mismatches</CardTitle>
              <CardDescription>
                Pages that rank for keywords but may not satisfy searcher expectations
              </CardDescription>
            </CardHeader>
          </Card>
          
          <div className="space-y-6">
            {filteredMismatches.map((mismatch, index) => {
              const cleanKeyword = mismatch.keyword.replace(/^\[|\]$/g, '');
              
              // Keep location detection logic for future use but don't render UI
              // const locationIssues = checkForLocationIssues(cleanKeyword, data?.businessLocation);
              
              return (
                <Card key={index} className="hover:shadow-md transition-shadow">
                  {/* Location Keyword Warning - Full notice in each card */}
                  <div className="px-4 pt-4 pb-2">
                    <div className="text-sm text-blue-800 dark:text-blue-200 bg-blue-50 dark:bg-blue-950/20 px-3 py-2 rounded border border-blue-200 dark:border-blue-800">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                        <div>
                          <strong>Location Keyword Notice:</strong> Some keywords may appear without full location context (e.g., &quot;orleans seo&quot; instead of &quot;new orleans seo&quot;). 
                          If you notice location-related keywords that seem incorrect, consider updating them in your content to include the full location name for better local targeting.
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  <CardContent className="pt-2">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Left Column - Keyword & Page */}
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-semibold text-lg text-foreground mb-1">
                        {mismatch.keyword.replace(/^\[|\]$/g, '')}
                      </h3>
                      <a 
                        href={mismatch.pageUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-[#00bf63] hover:underline text-sm flex items-center gap-1"
                      >
                        {mismatch.pageUrl}
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      {getScoreBadge(mismatch.matchScore)}
                      {mismatch.locationIssueFixed && (
                        <Badge variant="default" className="bg-green-100 text-green-800 border-green-200">
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                          Correct Location Added to Keyword
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Middle Column - Mismatch Reason */}
                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground text-sm">Mismatch Reason</h4>
                    <div className="text-sm text-muted-foreground leading-relaxed">
                      {mismatch.reason.length > 150 ? (
                        <div>
                          <p>
                            {mismatch.reason.length > 150 && !mismatch.showFullReason 
                              ? styleQuotedKeywords(`${mismatch.reason.substring(0, 150)}...`)
                              : styleQuotedKeywords(mismatch.reason)
                            }
                          </p>
                          <button 
                            onClick={() => {
                              const updatedMismatches = [...mismatches];
                              updatedMismatches[index] = {
                                ...updatedMismatches[index],
                                showFullReason: !updatedMismatches[index].showFullReason
                              };
                              setMismatches(updatedMismatches);
                            }}
                            className="mt-2 text-[#00bf63] hover:text-[#00bf63]/80 text-sm font-medium cursor-pointer"
                          >
                            {mismatch.showFullReason ? 'Show less' : 'Read more'}
                          </button>
                        </div>
                      ) : (
                        <p>{styleQuotedKeywords(mismatch.reason)}</p>
                      )}
                                          </div>
                  </div>

                  {/* Right Column - Suggested Fix & Action */}
                  <div className="space-y-3">
                    <div>
                      <h4 className="font-medium text-foreground text-sm mb-2">Suggested Fix</h4>
                      <div className="text-sm text-muted-foreground leading-relaxed">
                        {mismatch.suggestion.length > 120 ? (
                          <div>
                            <p>
                              {mismatch.suggestion.length > 120 && !mismatch.showFullSuggestion 
                                ? styleQuotedKeywords(`${mismatch.suggestion.substring(0, 120)}...`)
                                : styleQuotedKeywords(mismatch.suggestion)
                              }
                            </p>
                            <button 
                              onClick={() => {
                                const updatedMismatches = [...mismatches];
                                updatedMismatches[index] = {
                                  ...updatedMismatches[index],
                                  showFullSuggestion: !updatedMismatches[index].showFullSuggestion
                                };
                                setMismatches(updatedMismatches);
                              }}
                              className="mt-2 text-[#00bf63] hover:text-[#00bf63]/80 text-sm font-medium cursor-pointer"
                              >
                              {mismatch.showFullSuggestion ? 'Show less' : 'Read more'}
                            </button>
                          </div>
                        ) : (
                          <p>{styleQuotedKeywords(mismatch.suggestion)}</p>
                        )}
                      </div>
                    </div>
                    
                    
                    <Button 
                      size="sm" 
                      onClick={() => openChatWithContext(mismatch)}
                      className="w-full bg-[#00bf63] hover:bg-[#00bf63]/90 text-white"
                    >
                      <MessageSquare className="w-4 h-4 mr-2" />
                      Fix This
                    </Button>
                  </div>
                </div>
              </CardContent>
                </Card>
              );
            })}
          </div>
          </>
        )}

 
    </MainLayout>
  );
}
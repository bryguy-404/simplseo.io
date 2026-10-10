"use client";
import { authenticatedFetch } from '../lib/authenticatedFetch';


import { useAuth } from "../contexts/AuthContext";
import { useEffect, useState } from "react";
import MainLayout from "../components/MainLayout";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { AlertTriangle, AlertCircle } from "lucide-react";
import SeoTitleSuggestionPanel from "../components/dashboard/SeoTitleSuggestionPanel";
import { createGSCTokenManager } from "../lib/gscTokenManager";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import SquashBounceLoader from "../components/ui/squash-bounce-loader";
import { useMinimumLoading } from "../hooks/use-minimum-loading";
import { getFocusKeywords } from "../lib/firestoreHelpers";

// Normalize URL for comparison (remove trailing slashes, ensure consistent format)
const normalizeUrlForComparison = (url) => {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Remove trailing slash except for root
    const normalized = u.pathname === '/' ? u.origin : u.origin + u.pathname.replace(/\/$/, '');
    return normalized.toLowerCase();
  } catch {
    return url?.toLowerCase()?.replace(/\/$/, '') || null;
  }
};

export default function EasyWinsPage() {
  const { user, isLoading } = useAuth();
  const router = useRouter();
  const [gscKeywords, setGscKeywords] = useState([]);
  const [generatedTitles, setGeneratedTitles] = useState([]);
  const [loading, setLoading] = useState(true);
  const shouldShowLoader = useMinimumLoading(loading, 3000);
  const [error, setError] = useState(null);
  const [focusKeywordsByPage, setFocusKeywordsByPage] = useState(new Map());

  useEffect(() => {
    const fetchEasyWinKeywords = async () => {
      if (!user?.id) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Fetch saved focus keywords first
        const savedFocusKeywords = await getFocusKeywords(user.id);
        const keywordMap = new Map();
        savedFocusKeywords.forEach(({ keyword, pageUrl }) => {
          if (keyword && pageUrl) {
            const normalizedUrl = normalizeUrlForComparison(pageUrl);
            if (normalizedUrl) {
              keywordMap.set(normalizedUrl, keyword);
            }
          }
        });
        setFocusKeywordsByPage(keywordMap);

        const tokenManager = createGSCTokenManager(user.id);
        
        // Get stored GSC data
        const gscData = await tokenManager.getStoredGSCData();
        
        if (!gscData?.accessToken || !gscData?.siteUrl) {
          setError("No Google Search Console data found. Please connect your GSC account first.");
          setLoading(false);
          return;
        }

        // Get valid access token
        const validToken = await tokenManager.getValidAccessToken();
        if (!validToken) {
          setError("Could not get valid access token. Please reconnect your GSC account.");
          setLoading(false);
          return;
        }

        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 28);

        const formatDate = (d) => d.toISOString().split("T")[0];
        const from = formatDate(startDate);
        const to = formatDate(today);

        const res = await fetch(
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
              rowLimit: 250,
            }),
          }
        );

        const data = await res.json();

        if (!data.rows) {
          setError("No keyword data found. This could mean your site hasn't received any search traffic in the past 28 days.");
          setLoading(false);
          return;
        }

        const formatted = data.rows.map((row) => ({
          keyword: row.keys[0].replace(/^\[|\]$/g, ""),
          page: row.keys[1],
          clicks: row.clicks,
          impressions: row.impressions,
          position: Math.round(row.position),
          ctr: `${(row.ctr * 100).toFixed(1)}%`,
        }));

        const easyWins = formatted.filter((kw) => {
          const pos = kw.position;
          const ctr = parseFloat(kw.ctr.replace("%", ""));
          return pos > 10 && pos <= 20 && ctr < 3 && kw.impressions > 10;
        });

        setGscKeywords(easyWins);

        if (easyWins.length > 0) {
          const aiResults = await Promise.all(
            easyWins.map(async (kw) => {
              // Look up saved focus keyword for this page
              const normalizedPageUrl = normalizeUrlForComparison(kw.page);
              const savedFocusKeyword = keywordMap.get(normalizedPageUrl);
              
              const res = await authenticatedFetch("/api/seo-assistant/meta-title", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  pageUrl: kw.page,
                  userId: user?.id, // ✅ Add userId so API can fetch onboarding data
                  keyword: kw.keyword,
                  context: {
                    type: "easy-win",
                    targetKeyword: kw.keyword,
                    goal: "improve ranking to page 1",
                  },
                  // Pass saved focus keyword if available, otherwise use the easy-win keyword
                  focusKeywords: savedFocusKeyword ? [savedFocusKeyword] : [kw.keyword],
                }),
              });

              const json = await res.json();
              return {
                ...kw,
                title: json.title || "Suggested Title",
              };
            })
          );

          setGeneratedTitles(aiResults);
        }
      } catch (err) {
        console.error("❌ Failed to fetch easy win keywords", err);
        setError("Failed to load easy win keywords. Please try again.");
      } finally {
        setLoading(false);
      }
    };

    fetchEasyWinKeywords();
  }, [user]);

  if (isLoading || !user) return null;

  if (shouldShowLoader) {
    return (
      <MainLayout>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">Easy Win Opportunities</h1>
          <Button onClick={() => router.back()} variant="outline">
            Back to Dashboard
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
                    <div className="text-center py-8">
          <SquashBounceLoader size="lg" className="mb-4" />
          <p className="text-muted-foreground">Loading easy win opportunities...</p>
        </div>
          </CardContent>
        </Card>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Easy Win Opportunities</h1>
        <Button onClick={() => router.back()} variant="outline">
          Back to Dashboard
        </Button>
      </div>

      <p className="text-muted-foreground mb-4">
        These are keywords currently ranking on page 2 of search results. With
        a bit of effort, they can hit page 1.
      </p>

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-lg font-semibold text-red-800 mb-2">Unable to Load Easy Wins</h3>
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ✅ Card: Raw Easy Win Data */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle>Raw Easy Win Data</CardTitle>
              <CardDescription>
                Keywords with positions 11–20, CTR &lt; 3%, and &gt; 10 impressions
              </CardDescription>
            </CardHeader>
            <CardContent>
              {gscKeywords.length === 0 ? (
                <p className="text-sm text-muted-foreground">No easy wins found.</p>
              ) : (
                <ul className="space-y-2">
                  {gscKeywords.map((kw, idx) => (
                    <li key={idx} className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="text-yellow-500 h-4 w-4 flex-shrink-0" />
                        <span className="font-medium">{kw.keyword}</span>
                      </div>
                      <div className="text-sm text-muted-foreground pl-6">
                        <a
                          href={kw.page}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#00BF63] underline truncate"
                        >
                          {kw.page}
                        </a>
                        <div>
                          {kw.impressions} impressions, {kw.clicks} clicks, {kw.ctr}{" "}
                          CTR, position {kw.position}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* ✅ Card: SEO Title Suggestions */}
          <Card>
            <CardHeader>
              <CardTitle>SEO Title Suggestions</CardTitle>
              <CardDescription>
                AI-generated title recommendations for easy-win keywords
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {generatedTitles.map((item, idx) => (
                <SeoTitleSuggestionPanel
                  key={idx}
                  title={`Fix: ${item.keyword}`}
                  keyword={item.keyword}
                  pageUrl={item.page}
                  suggestedTitle={item.title}
                  suggestedDescription=""
                />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </MainLayout>
  );
}

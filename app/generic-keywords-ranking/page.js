"use client";
import { authenticatedFetch } from '../lib/authenticatedFetch';


import { useAuth } from "../contexts/AuthContext";
import { useEffect, useState } from "react";
import MainLayout from "../components/MainLayout";
import { useOnboarding } from "../contexts/OnboardingContext";
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
import { Target, MapPin, Clock, Wrench, Search, Filter, TrendingUp, AlertTriangle, FileText } from "lucide-react";
import SquashBounceLoader from "../components/ui/squash-bounce-loader";
import { useMinimumLoading } from "../hooks/use-minimum-loading";

export default function GenericKeywordsRankingPage() {
  const { user, isLoading } = useAuth();
  const { data } = useOnboarding();
  const [gscKeywords, setGscKeywords] = useState([]);
  const [nonBrandedKeywords, setNonBrandedKeywords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFilteringKeywords, setIsFilteringKeywords] = useState(false);
  const [filter, setFilter] = useState('all');
  const shouldShowLoader = useMinimumLoading(loading, 2000);

  useEffect(() => {
    if (user?.id && data?.businessType) {
      fetchGSCKeywords();
    }
  }, [user?.id, data?.businessType]);

  const fetchGSCKeywords = async () => {
    setLoading(true);
    setError(null);

    try {
      console.log("🔍 Fetching GSC keywords for Generic Keywords Ranking page...");
      
      // Use the same GSC token management as dashboard
      const tokenManager = createGSCTokenManager(user.id);
      const accessToken = await tokenManager.getValidAccessToken();

      if (!accessToken) {
        throw new Error('No GSC access token available. Please reconnect GSC in the dashboard.');
      }

      // Fetch GSC keywords with increased limit
      const today = new Date();
      const start = new Date(today);
      start.setDate(today.getDate() - 28);

      const format = (d) => d.toISOString().split("T")[0];
      const from = format(start);
      const to = format(today);

      const res = await fetch(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
          data.gscProperty
        )}/searchAnalytics/query`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: from,
            endDate: to,
            dimensions: ["query", "page"],
            rowLimit: 1000, // Increased limit for comprehensive analysis
          }),
        }
      );

      const json = await res.json();
      console.log("🔍 GSC Raw Data:", json);
      
      if (!json.rows) {
        console.log("❌ No rows returned from GSC");
        setError("No GSC data available");
        return;
      }
      
      console.log("✅ GSC returned", json.rows.length, "rows");

      // Format the data
      const formatted = json.rows.map((row) => ({
        keyword: row.keys[0].replace(/^\[|\]$/g, ""),
        page: row.keys[1],
        clicks: row.clicks,
        impressions: row.impressions,
        position: Math.round(row.position),
        ctr: `${(row.ctr * 100).toFixed(1)}%`,
      }));

      setGscKeywords(formatted);
      
      // Now filter with AI
      await filterKeywordsWithAI(formatted);

    } catch (err) {
      console.error("❌ Failed to fetch GSC keywords:", err);
      setError(`Failed to load GSC data: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const filterKeywordsWithAI = async (keywords) => {
    if (!keywords.length || !data?.businessName) return;
    
    setIsFilteringKeywords(true);
    try {
      console.log('🤖 Using AI to filter branded keywords...', {
        keywordCount: keywords.length,
        businessName: data.businessName,
        businessType: data.businessType
      });
      
      // Limit keywords to prevent API overload (process in batches if needed)
      const keywordsToProcess = keywords.slice(0, 500); // Limit to 500 keywords max
      console.log(`📊 Processing ${keywordsToProcess.length} keywords (limited from ${keywords.length})`);
      
      const response = await authenticatedFetch('/api/filter-branded-keywords', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          keywords: keywordsToProcess,
          businessName: data.businessName,
          businessType: data.businessType
        })
      });

      console.log('🔍 API Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error response:', errorText);
        throw new Error(`API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      console.log('✅ AI filtering result:', result);
      console.log('🔍 Branded keywords from AI:', result.branded?.map(kw => kw.keyword) || []);
      console.log('🔍 Generic keywords from AI:', result.generic?.map(kw => kw.keyword) || []);
      
      // Set only the generic (non-branded) keywords
      setNonBrandedKeywords(result.generic || []);
      
    } catch (error) {
      console.error('❌ AI filtering failed, using enhanced fallback:', error);
      // Enhanced fallback filtering if AI fails
      const businessName = data?.businessName?.toLowerCase() || '';
      const businessWords = businessName.split(' ').filter(word => word.length > 2);
      
      const fallback = keywords.filter(kw => {
        const keyword = kw.keyword.toLowerCase();
        
        // Enhanced branded detection - same logic as API
        const isBranded = 
          // Exact business name matches
          keyword.includes(businessName) || 
          keyword.includes(businessName.replace(/\s+/g, '')) ||
          keyword.includes(businessName.replace(/\s+/g, ' n ')) ||
          keyword.includes(businessName.replace(/\s+/g, ' & ')) ||
          keyword.includes(businessName.replace(/\s+/g, ' and ')) ||
          // Check for individual business words (but be more strict)
          (businessWords.length > 1 && businessWords.every(word => keyword.includes(word))) ||
          // Check for common brand variations
          keyword === businessName ||
          keyword === businessName.replace(/\s+/g, '') ||
          keyword === businessName.replace(/\s+/g, ' n ') ||
          keyword === businessName.replace(/\s+/g, ' & ');
        
        // Return true if NOT branded (i.e., it's generic)
        return !isBranded;
      });
      
      console.log(`🔄 Enhanced fallback filtering: ${fallback.length} generic keywords from ${keywords.length} total`);
      console.log(`🔄 Business name: "${businessName}"`);
      console.log(`🔄 Business words:`, businessWords);
      console.log(`🔄 Sample filtered keywords:`, fallback.slice(0, 5).map(kw => kw.keyword));
      setNonBrandedKeywords(fallback);
    } finally {
      setIsFilteringKeywords(false);
    }
  };

  const getKeywordIcon = (keyword) => {
    const keywordLower = keyword.toLowerCase();
    if (keywordLower.includes('near me') || keywordLower.includes('location')) {
      return <MapPin className="w-4 h-4" />;
    } else if (keywordLower.includes('best') || keywordLower.includes('top')) {
      return <TrendingUp className="w-4 h-4" />;
    } else if (keywordLower.includes('how') || keywordLower.includes('what')) {
      return <Search className="w-4 h-4" />;
    } else {
      return <Target className="w-4 h-4" />;
    }
  };

  const getPositionColor = (position) => {
    if (position <= 3) return "bg-green-100 text-green-800";
    if (position <= 10) return "bg-yellow-100 text-yellow-800";
    if (position <= 20) return "bg-orange-100 text-orange-800";
    return "bg-red-100 text-red-800";
  };

  const getCTRColor = (ctr) => {
    const ctrValue = parseFloat(ctr.replace('%', ''));
    if (ctrValue >= 10) return "text-green-600";
    if (ctrValue >= 5) return "text-yellow-600";
    if (ctrValue >= 2) return "text-orange-600";
    return "text-red-600";
  };

  const filteredKeywords = filter === 'all' 
    ? nonBrandedKeywords 
    : nonBrandedKeywords.filter(kw => {
        const keyword = kw.keyword.toLowerCase();
        switch (filter) {
          case 'location':
            return keyword.includes('near me') || keyword.includes('location') || 
                   keyword.includes(data?.businessLocation?.split(',')[0]?.toLowerCase() || '');
          case 'service':
            return !keyword.includes('near me') && !keyword.includes('location') && 
                   !keyword.includes('best') && !keyword.includes('top');
          case 'comparison':
            return keyword.includes('best') || keyword.includes('top') || 
                   keyword.includes('vs') || keyword.includes('compare');
          default:
            return true;
        }
      });

  const filterOptions = [
    { value: 'all', label: 'All Keywords', count: nonBrandedKeywords.length },
    { value: 'location', label: 'Location-Based', count: nonBrandedKeywords.filter(kw => 
      kw.keyword.toLowerCase().includes('near me') || 
      kw.keyword.toLowerCase().includes('location') ||
      kw.keyword.toLowerCase().includes(data?.businessLocation?.split(',')[0]?.toLowerCase() || '')
    ).length },
    { value: 'service', label: 'Service-Based', count: nonBrandedKeywords.filter(kw => {
      const keyword = kw.keyword.toLowerCase();
      return !keyword.includes('near me') && !keyword.includes('location') && 
             !keyword.includes('best') && !keyword.includes('top');
    }).length },
    { value: 'comparison', label: 'Comparison', count: nonBrandedKeywords.filter(kw => {
      const keyword = kw.keyword.toLowerCase();
      return keyword.includes('best') || keyword.includes('top') || 
             keyword.includes('vs') || keyword.includes('compare');
    }).length }
  ];

  if (isLoading || !user) return null;

  if (shouldShowLoader) {
    return (
      <MainLayout>
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold">Generic Keywords Already Ranking</h1>
          <Button onClick={() => window.history.back()} variant="outline">
            Back to Dashboard
          </Button>
        </div>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-8">
              <SquashBounceLoader size="lg" className="mb-4" />
              <p className="text-muted-foreground">Loading generic keywords...</p>
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
          <h1 className="text-3xl font-bold">Generic Keywords Already Ranking</h1>
          <p className="text-muted-foreground mt-2">
            Non-branded keywords you&apos;re already ranking for in the last 28 days
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={fetchGSCKeywords} variant="outline" size="sm">
            Refresh Data
          </Button>
          <Button onClick={() => window.history.back()} variant="outline">
            Back to Dashboard
          </Button>
        </div>
      </div>

      {error ? (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center py-6">
              <div className="bg-muted inline-flex items-center justify-center w-12 h-12 rounded-full mb-3">
                <Target className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button 
                onClick={fetchGSCKeywords} 
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
          {/* Filter Options */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div className="flex flex-wrap gap-2 mb-4">
                {filterOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={filter === option.value ? "default" : "outline"}
                    size="sm"
                    onClick={() => setFilter(option.value)}
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
              
              {/* AI Filtering Status */}
              {isFilteringKeywords && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <SquashBounceLoader size="sm" />
                  <span>AI is filtering keywords...</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Keywords List */}
          <div className="space-y-6">
            {filteredKeywords.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <div className="text-center py-8">
                    <Target className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <p className="text-sm text-muted-foreground">
                      {isFilteringKeywords ? 'AI is filtering keywords...' : 'No generic keywords found for this filter'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {filteredKeywords.map((keyword, index) => (
                  <Card key={`${keyword.keyword}-${index}`} className="hover:shadow-md transition-shadow border-l-4 border-l-green-200 dark:border-l-green-800">
                    <CardContent className="pt-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          {getKeywordIcon(keyword.keyword)}
                          <div>
                            <h3 className="font-semibold text-lg">&quot;{keyword.keyword}&quot;</h3>
                            <p className="text-sm text-muted-foreground">Page: {keyword.page}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Badge className={getPositionColor(keyword.position)}>
                            Position {keyword.position}
                          </Badge>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm">
                        <div>
                          <span className="font-medium text-green-600">{keyword.clicks}</span> clicks
                        </div>
                        <div>
                          <span className="font-medium text-green-600">{keyword.impressions}</span> impressions
                        </div>
                        <div>
                          <span className={`font-medium ${getCTRColor(keyword.ctr)}`}>{keyword.ctr}</span> CTR
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </MainLayout>
  );
}

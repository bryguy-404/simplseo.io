"use client";
import { authenticatedFetch } from '../../lib/authenticatedFetch';


import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useOnboarding } from "../../contexts/OnboardingContext";
import { createGSCTokenManager } from "../../lib/gscTokenManager";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  TrendingUp, 
  MapPin, 
  Wrench, 
  FileText, 
  ArrowRight,
  Loader2
} from "lucide-react";
import Link from "next/link";

export default function ContentExpansionCard() {
  const { user } = useAuth();
  const { data } = useOnboarding();
  const [opportunities, setOpportunities] = useState([]);
  const [insights, setInsights] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchContentExpansionData = async () => {
      if (!user?.id || !data?.gscProperty) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        // Get GSC data first
        const tokenManager = createGSCTokenManager(user.id);
        const gscData = await tokenManager.getStoredGSCData();
        
        if (!gscData?.accessToken || !gscData?.siteUrl) {
          setError("No GSC data available");
          setLoading(false);
          return;
        }

        const validToken = await tokenManager.getValidAccessToken();
        if (!validToken) {
          setError("GSC token expired");
          setLoading(false);
          return;
        }

        // Fetch GSC keywords
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(today.getDate() - 28);

        const formatDate = (d) => d.toISOString().split("T")[0];
        const from = formatDate(startDate);
        const to = formatDate(today);

        const gscRes = await fetch(
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
              rowLimit: 100,
            }),
          }
        );

        const gscJson = await gscRes.json();
        
        if (!gscJson.rows) {
          setError("No GSC data available");
          setLoading(false);
          return;
        }

        const gscKeywords = gscJson.rows.map((row) => ({
          keyword: row.keys[0].replace(/^\[|\]$/g, ""),
          page: row.keys[1],
          clicks: row.clicks,
          impressions: row.impressions,
          position: Math.round(row.position),
          ctr: `${(row.ctr * 100).toFixed(1)}%`,
        }));

        // Debug: Log the data being sent
        console.log("🔍 Content Expansion Debug:", {
          gscKeywordsCount: gscKeywords.length,
          businessType: data.businessType,
          customBusinessType: data.customBusinessType,
          businessLocation: data.businessLocation,
          websiteUrl: data.websiteUrl,
          fullData: data
        });

        // Analyze content expansion opportunities
        const analysisRes = await authenticatedFetch("/api/content-expansion/analyze", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            gscKeywords,
            businessType: data.businessType || "Other",
            customBusinessType: data.customBusinessType || "",
            businessLocation: data.businessLocation || "",
            websiteUrl: data.websiteUrl || ""
          }),
        });

        const analysis = await analysisRes.json();
        
        console.log('🔍 Content Expansion Analysis Response:', analysis);
        
        if (analysis.success) {
          setOpportunities(analysis.opportunities.slice(0, 5)); // Show top 5
          setInsights(analysis.insights);
          console.log('✅ Set opportunities:', analysis.opportunities.slice(0, 5));
        } else {
          setError(analysis.error || "Failed to analyze opportunities");
        }
      } catch (err) {
        console.error("Content expansion analysis error:", err);
        setError("Failed to load content expansion data");
      } finally {
        setLoading(false);
      }
    };

    fetchContentExpansionData();
  }, [user, data]);

  const getOpportunityIcon = (type) => {
    switch (type) {
      case 'location_expansion':
        return <MapPin className="w-4 h-4" />;
      case 'service_expansion':
        return <Wrench className="w-4 h-4" />;
      case 'long_tail':
        return <FileText className="w-4 h-4" />;
      case 'content_improvement':
        return <TrendingUp className="w-4 h-4" />;
      case 'trending_search':
        return <TrendingUp className="w-4 h-4" />;
      default:
        return <TrendingUp className="w-4 h-4" />;
    }
  };

  const getPriorityColor = (priority) => {
    if (priority >= 8) return "bg-red-100 text-red-700";
    if (priority >= 6) return "bg-yellow-100 text-yellow-700";
    return "bg-green-100 text-green-700";
  };

  if (loading) {
    return (
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="w-5 h-5" />
            Content Expansion Opportunities
          </CardTitle>
          <CardDescription>
            Finding new content opportunities to grow your search presence
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Analyzing content opportunities...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <TrendingUp className="w-5 h-5" />
            Content Expansion Opportunities
          </CardTitle>
          <CardDescription>
            Finding new content opportunities to grow your search presence
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="w-5 h-5" />
              Content Expansion Opportunities
              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                Medium Priority
              </span>
            </CardTitle>
            <CardDescription>
              {insights?.summary || "New content opportunities to expand your search presence"}
            </CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/content-expansion">See More</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {opportunities.length === 0 ? (
          <div className="text-center py-8">
            <TrendingUp className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">
              No content expansion opportunities found
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {opportunities.map((opportunity, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-3 flex-1">
                  {getOpportunityIcon(opportunity.type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm truncate">
                        {opportunity.keyword}
                      </span>
                      <Badge 
                        variant="secondary" 
                        className={`text-xs ${getPriorityColor(opportunity.priority)}`}
                      >
                        {opportunity.estimatedVolume}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {opportunity.description}
                    </p>
                    {opportunity.contentIdea && (
                      <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">
                        💡 {opportunity.contentIdea}
                      </p>
                    )}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </div>
            ))}
            
            {insights && (
              <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>Insight:</strong> {insights.summary}
                </p>
                <p className="text-xs text-blue-600 dark:text-blue-300 mt-1">
                  Found {insights.totalOpportunities} total opportunities • 
                  {insights.locationBased} location-based • 
                  {insights.serviceBased} service-based
                </p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

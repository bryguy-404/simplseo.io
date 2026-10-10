"use client";
import { authenticatedFetch } from '../../lib/authenticatedFetch';


import { useState, useEffect } from "react";
import { useAuth } from "../../contexts/AuthContext";
import { useOnboarding } from "../../contexts/OnboardingContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Search, TrendingUp, MapPin, Clock, Wrench, Lightbulb } from "lucide-react";
import SquashBounceLoader from "../ui/squash-bounce-loader";

export default function LongTailKeywordCard({ gscKeywords = [] }) {
  const { user } = useAuth();
  const { data } = useOnboarding();
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (user?.id && data?.businessType && gscKeywords.length > 0) {
      fetchLongTailOpportunities(gscKeywords);
    }
  }, [user?.id, data?.businessType, gscKeywords]);

  const fetchLongTailOpportunities = async (gscKeywords) => {
    setLoading(true);
    setError(null);

    try {
      console.log("🔍 Fetching Long-Tail Keywords for:", {
        gscKeywordsCount: gscKeywords?.length || 0,
        businessType: data.businessType,
        businessLocation: data.businessLocation,
        websiteUrl: data.websiteUrl
      });

      const response = await authenticatedFetch("/api/long-tail-keywords/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          gscKeywords: gscKeywords || [],
          businessType: data.businessType,
          customBusinessType: data.customBusinessType,
          businessLocation: data.businessLocation,
          websiteUrl: data.websiteUrl,
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      console.log("✅ Long-Tail Keywords response:", result);

      if (result.success && result.opportunities) {
        setOpportunities(result.opportunities);
      } else {
        setError("No long-tail opportunities found");
      }
    } catch (err) {
      console.error("❌ Failed to fetch long-tail keywords:", err);
      setError("Failed to load long-tail opportunities");
    } finally {
      setLoading(false);
    }
  };

  const getOpportunityIcon = (type) => {
    switch (type) {
      case 'service_based':
        return <Wrench className="w-4 h-4" />;
      case 'location_based':
        return <MapPin className="w-4 h-4" />;
      case 'problem_based':
        return <Search className="w-4 h-4" />;
      case 'comparison_based':
        return <TrendingUp className="w-4 h-4" />;
      case 'time_based':
        return <Clock className="w-4 h-4" />;
      case 'ai_generated':
        return <Lightbulb className="w-4 h-4" />;
      default:
        return <Search className="w-4 h-4" />;
    }
  };

  const getPriorityColor = (priority) => {
    if (priority >= 8) return "bg-green-100 text-green-800";
    if (priority >= 6) return "bg-yellow-100 text-yellow-800";
    return "bg-blue-100 text-blue-800";
  };

  const getDifficultyColor = (difficulty) => {
    if (difficulty === 'Low') return "bg-green-100 text-green-800";
    if (difficulty === 'Medium') return "bg-yellow-100 text-yellow-800";
    return "bg-red-100 text-red-800";
  };

  if (loading) {
    return (
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="w-5 h-5" />
            Long-Tail Keyword Opportunities
            <Badge className="bg-blue-100 text-blue-700">Medium Priority</Badge>
          </CardTitle>
          <CardDescription>
            Identify specific, easier-to-rank keyword phrases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <SquashBounceLoader size="lg" className="mb-4" />
            <p className="text-sm text-muted-foreground">Finding long-tail opportunities...</p>
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
            <Search className="w-5 h-5" />
            Long-Tail Keyword Opportunities
            <Badge className="bg-blue-100 text-blue-700">Medium Priority</Badge>
          </CardTitle>
          <CardDescription>
            Identify specific, easier-to-rank keyword phrases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="bg-muted inline-flex items-center justify-center w-12 h-12 rounded-full mb-3">
              <Search className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button 
              onClick={fetchLongTailOpportunities} 
              variant="outline" 
              size="sm" 
              className="mt-2"
            >
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (opportunities.length === 0) {
    return (
      <Card className="border-blue-200 dark:border-blue-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Search className="w-5 h-5" />
            Long-Tail Keyword Opportunities
            <Badge className="bg-blue-100 text-blue-700">Medium Priority</Badge>
          </CardTitle>
          <CardDescription>
            Identify specific, easier-to-rank keyword phrases
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-6">
            <div className="bg-green-100 dark:bg-green-900/20 inline-flex items-center justify-center w-12 h-12 rounded-full mb-3">
              <Search className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">
              🎉 No opportunities found!
            </p>
            <p className="text-xs text-green-600 dark:text-green-300">
              You're already targeting great long-tail keywords
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-blue-200 dark:border-blue-800">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Search className="w-5 h-5" />
          Long-Tail Keyword Opportunities
          <Badge className="bg-blue-100 text-blue-700">Medium Priority</Badge>
        </CardTitle>
        <CardDescription>
          Identify specific, easier-to-rank keyword phrases
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {opportunities.slice(0, 5).map((opportunity, index) => (
            <div key={index} className="p-3 border rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {getOpportunityIcon(opportunity.type)}
                  <span className="font-medium text-sm">{opportunity.keyword}</span>
                </div>
                <div className="flex gap-1">
                  <Badge className={`text-xs ${getPriorityColor(opportunity.priority)}`}>
                    Priority {opportunity.priority}
                  </Badge>
                  <Badge className={`text-xs ${getDifficultyColor(opportunity.difficulty)}`}>
                    {opportunity.difficulty}
                  </Badge>
                </div>
              </div>
              
              <p className="text-xs text-muted-foreground mb-2">
                {opportunity.description}
              </p>
              
              {opportunity.contentIdea && (
                <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">
                  💡 {opportunity.contentIdea}
                </p>
              )}
              
              <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                <span>Volume: {opportunity.estimatedVolume}</span>
                <span>•</span>
                <span>Type: {opportunity.type.replace('_', ' ')}</span>
              </div>
            </div>
          ))}
        </div>
        
        {opportunities.length > 5 && (
          <div className="mt-4 text-center">
            <Button variant="outline" size="sm">
              View All {opportunities.length} Opportunities
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

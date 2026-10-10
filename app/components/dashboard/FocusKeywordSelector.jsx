"use client";
import { authenticatedFetch } from '../../lib/authenticatedFetch';


import { useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Info, Sparkles, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Must match normalizePageKey in dashboard/page.js for consistent lookups
const normalizePage = (page) => {
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

const FocusKeywordSelector = ({
  keywords = [],
  selectedByPage = new Map(),
  onToggle,
  isSaving = false,
  suggestions = [],
  groupedByPage = new Map(),
  businessName = "",
  businessType = "",
  businessLocation = "",
  userId = "",
}) => {
  // State for AI suggestions per page
  const [aiSuggestionsByPage, setAiSuggestionsByPage] = useState(new Map());
  const [loadingSuggestions, setLoadingSuggestions] = useState(new Set());
  
  // State for custom keyword dialog
  const [customKeywordDialog, setCustomKeywordDialog] = useState({
    open: false,
    pageUrl: null,
    keyword: "",
  });

  const aggregatedKeywords = useMemo(() => {
    if (!keywords?.length) {
      return [];
    }

    const map = new Map();

    keywords.forEach((item) => {
      if (!item?.keyword) return;
      const key = item.keyword;
      const existing = map.get(key);
      if (existing) {
        existing.clicks += item.clicks || 0;
        existing.impressions += item.impressions || 0;
        const candidatePosition = item.position ?? Number.MAX_SAFE_INTEGER;
        if (candidatePosition < existing.position) {
          existing.position = candidatePosition;
        }
        // Preserve AI-generated source if either is AI-generated
        if (item.source === "ai-generated" || existing.source === "ai-generated") {
          existing.source = "ai-generated";
        }
      } else {
        map.set(key, {
          keyword: key,
          clicks: item.clicks || 0,
          impressions: item.impressions || 0,
          position: item.position ?? Number.MAX_SAFE_INTEGER,
          page: item.page || null,
          source: item.source || "gsc-existing", // Preserve source
        });
      }
    });

    return Array.from(map.values());
  }, [keywords]);

  const keywordMap = useMemo(() => {
    return aggregatedKeywords.reduce((acc, item) => {
      acc.set(item.keyword.toLowerCase(), item);
      return acc;
    }, new Map());
  }, [aggregatedKeywords]);

  const pageGroups = useMemo(() => {
    if (!groupedByPage?.size) {
      return [];
    }

    const groups = [];
    groupedByPage.forEach((value, pageUrl) => {
      const keywords = Array.isArray(value)
        ? value
        : Array.isArray(value.keywords)
        ? value.keywords
        : [];
      if (!keywords.length) return;
      const enriched = keywords
        .map((keyword) => keywordMap.get(keyword.toLowerCase()) || null)
        .filter(Boolean);
      if (!enriched.length) return;
      
      // Sort keywords by: clicks (desc), impressions (desc), position (asc)
      enriched.sort((a, b) => {
        const clicksA = Number(a.clicks) || 0;
        const clicksB = Number(b.clicks) || 0;
        const impressionsA = Number(a.impressions) || 0;
        const impressionsB = Number(b.impressions) || 0;
        const positionA = Number(a.position) || Number.MAX_SAFE_INTEGER;
        const positionB = Number(b.position) || Number.MAX_SAFE_INTEGER;
        
        if (clicksB !== clicksA) {
          return clicksB - clicksA;
        }
        if (impressionsB !== impressionsA) {
          return impressionsB - impressionsA;
        }
        return positionA - positionB;
      });
      
      groups.push({ page: pageUrl === "__unknown__" ? null : pageUrl, keywords: enriched });
    });

    groups.sort((a, b) => {
      const impressionsA = Math.max(...a.keywords.map((kw) => kw.impressions || 0));
      const impressionsB = Math.max(...b.keywords.map((kw) => kw.impressions || 0));
      return impressionsB - impressionsA;
    });

    return groups;
  }, [groupedByPage, keywordMap]);

  const keywordAssignments = useMemo(() => {
    const map = new Map();
    if (!selectedByPage?.size) return map;
    selectedByPage.forEach((keyword, pageKey) => {
      if (!keyword) return;
      map.set(keyword.toLowerCase(), pageKey);
    });
    return map;
  }, [selectedByPage]);

  const handleToggle = (keyword, page, source = "gsc-existing") => {
    if (!onToggle) return;
    const pageKey = normalizePage(page);
    const lowerKeyword = keyword.toLowerCase();
    const isSelectedForPage =
      selectedByPage?.get(pageKey)?.toLowerCase() === lowerKeyword;
    onToggle({
      keyword,
      page,
      isSelectedForPage,
      source,
    });
  };

  const handleSuggestKeywords = async (pageUrl) => {
    if (!pageUrl || !userId) return;

    setLoadingSuggestions((prev) => {
      const next = new Set(prev);
      next.add(pageUrl);
      return next;
    });

    try {
      const response = await authenticatedFetch("/api/seo-assistant/suggest-keywords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pageUrl,
          userId,
          businessType,
          businessLocation,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.suggestions?.length > 0) {
          setAiSuggestionsByPage((prev) => {
            const next = new Map(prev);
            next.set(pageUrl, data.suggestions);
            return next;
          });
        }
      } else {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error || "Failed to generate keyword suggestions. Please try again.";
        
        console.error("Failed to generate suggestions:", errorMessage);
        
        // Show more helpful error message
        if (errorMessage.includes("No page content") || errorMessage.includes("crawl")) {
          alert("No page content available. Please crawl this page first from the 'Scan Complete Pages' section to generate keyword suggestions.");
        } else {
          alert(errorMessage);
        }
      }
    } catch (error) {
      console.error("Error generating AI keywords:", error);
      alert("Failed to generate keyword suggestions. Please try again.");
    } finally {
      setLoadingSuggestions((prev) => {
        const next = new Set(prev);
        next.delete(pageUrl);
        return next;
      });
    }
  };

  const handleAddCustomKeyword = (pageUrl) => {
    setCustomKeywordDialog({
      open: true,
      pageUrl,
      keyword: "",
    });
  };

  const handleSaveCustomKeyword = () => {
    const { pageUrl, keyword } = customKeywordDialog;
    if (!keyword.trim() || !pageUrl) return;

    // Add custom keyword to AI suggestions for this page
    setAiSuggestionsByPage((prev) => {
      const next = new Map(prev);
      const existing = next.get(pageUrl) || [];
      if (!existing.includes(keyword.trim())) {
        next.set(pageUrl, [...existing, keyword.trim()]);
      }
      return next;
    });

    setCustomKeywordDialog({ open: false, pageUrl: null, keyword: "" });
  };

  const validateKeywordFormat = (keyword) => {
    // Basic validation: should have at least 2 words
    const words = keyword.trim().split(/\s+/);
    return words.length >= 2;
  };

  if (!pageGroups.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect Google Search Console to choose focus keywords.
      </p>
    );
  }

  const selectedCount = selectedByPage?.size || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span className="sm:text-right">
          Keywords selected: {selectedCount}
        </span>
      </div>
      <Alert className="w-full border-blue-200 bg-blue-50 dark:border-blue-900/40 dark:bg-blue-900/20">
        <Info className="h-4 w-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
        <AlertDescription className="!block text-sm text-blue-900 dark:text-blue-100 leading-relaxed">
          <span className="font-medium">Tip:</span> choose a keyword that includes your <span className="font-bold">service or product and location</span>. Avoid keywords with your brand to attract new customers who haven't discovered your business name yet.{" "}
          <br></br>For example:<span className="font-semibold"> emergency plumber austin, custom T-shirts in los angeles, affordable dentist chicago</span>.
        </AlertDescription>
      </Alert>
      <div className="rounded-md border divide-y">
        {pageGroups.map((group, groupIdx) => {
          const pageKey = normalizePage(group.page);
          const pageUrl = group.page;
          const aiSuggestions = aiSuggestionsByPage.get(pageUrl) || [];
          const isLoading = loadingSuggestions.has(pageUrl);
          
          return (
            <div key={group.page || `group-${groupIdx}`} className="divide-y">
              {/* Page Header */}
              <div className="px-4 py-4 bg-muted/30 border-b border-border/50">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">Page:</span>
                    {group.page ? (
                      <a
                        href={group.page}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-[#00BF63] hover:text-[#00BF63]/80 underline break-all"
                      >
                        {group.page.replace(/^https?:\/\//, "")}
                      </a>
                    ) : (
                      <span className="text-sm font-medium text-foreground">Unassigned</span>
                    )}
                  </div>
                  <div className="text-sm font-bold text-foreground uppercase tracking-wide bg-primary/10 px-3 py-1.5 rounded-md border border-primary/20">
                    Choose "one" keyword per page
                  </div>
                </div>
                
                {/* Action Buttons */}
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleSuggestKeywords(pageUrl)}
                    disabled={isLoading || !userId}
                    className="flex items-center gap-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white border-0 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Suggest Keywords
                      </>
                    )}
                  </Button>
                  {/* TODO: Implement custom keyword feature later */}
                  {/* <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleAddCustomKeyword(pageUrl)}
                    disabled={!userId}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add Custom Keyword
                  </Button> */}
                </div>

                {/* Format Tip */}
                {aiSuggestions.length === 0 && (
                  <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-950/20 rounded-md border border-blue-200 dark:border-blue-900/40">
                    <p className="text-xs text-blue-900 dark:text-blue-100">
                      <span className="font-medium">💡</span> If you don’t see a keyword that fits your page, try <span className="font-bold">Suggest Keywords</span>.
                      AI will create suggestions based on your content. <br></br> Choosing a stronger, more accurate keyword helps Google understand your page faster and leads to better results long-term
                    </p>
                  </div>
                )}
              </div>

              {/* Keywords List */}
              <div className="px-4 py-3 space-y-2">
                {/* AI Suggestions Section - Show at TOP when available */}
                {aiSuggestions.length > 0 && (
                  <>
                    <div className="pb-3 mb-3 border-b border-border/50">
                      <div className="flex items-center gap-2 mb-2">
                        <Sparkles className="h-4 w-4 text-purple-700 dark:text-purple-300" />
                        <span className="text-sm font-semibold text-foreground">AI Suggestions</span>
                        <Badge variant="outline" className="text-xs">New</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mb-2">
                        💡 Format: "service or product + location" (e.g., "roof repair Austin TX" or "dentist Chicago IL")
                      </p>
                      {aiSuggestions.map((suggestion, idx) => {
                        const keyword = typeof suggestion === "string" ? suggestion : suggestion.keyword;
                        const confidence = typeof suggestion === "object" ? suggestion.confidence : 0.8;
                        const reason = typeof suggestion === "object" ? suggestion.reason : "";
                        const lowerKeyword = keyword.toLowerCase();
                        const assignedPageKey = keywordAssignments.get(lowerKeyword);
                        const isSelected =
                          selectedByPage?.get(pageKey)?.toLowerCase() === lowerKeyword;
                        const isAssignedElsewhere =
                          assignedPageKey && assignedPageKey !== pageKey;
                        
                        return (
                          <label
                            key={`ai-${group.page || "__unknown__"}-${keyword}-${idx}`}
                            className={cn(
                              "flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm transition-colors mb-2 cursor-pointer",
                              isSelected
                                ? "border-purple-300 dark:border-purple-700 bg-purple-100 dark:bg-purple-900/30"
                                : "border-purple-200 dark:border-purple-800/50 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30",
                              isAssignedElsewhere && !isSelected && "opacity-70"
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() =>
                                  handleToggle(keyword, group.page, "ai-generated")
                                }
                                disabled={isSaving}
                              />
                              <div className="flex-1">
                                <p className="font-medium leading-tight">{keyword}</p>
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                                  <span className="text-purple-100 dark:text-purple-100">AI Generated</span>
                                  {isAssignedElsewhere && (
                                    <Badge variant="outline">Selected on another page</Badge>
                                  )}
                                </div>
                                {reason && (
                                  <p className="text-xs text-muted-foreground mt-1.5 italic leading-relaxed">
                                    {reason}
                                  </p>
                                )}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </>
                )}

                {/* GSC Keywords */}
                {group.keywords.map((keyword, idx) => {
                  const lowerKeyword = keyword.keyword.toLowerCase();
                  const assignedPageKey = keywordAssignments.get(lowerKeyword);
                  const isSelected =
                    selectedByPage?.get(pageKey)?.toLowerCase() === lowerKeyword;
                  const isAssignedElsewhere =
                    assignedPageKey && assignedPageKey !== pageKey;
                  const isAIGenerated = keyword.source === "ai-generated";
                  
                  return (
                    <label
                      key={`${group.page || "__unknown__"}-${keyword.keyword}-${idx}`}
                      className={cn(
                        "flex items-center justify-between gap-4 rounded-md border px-3 py-2 text-sm transition-colors",
                        isAIGenerated && isSelected
                          ? "border-purple-300 dark:border-purple-700 bg-purple-100 dark:bg-purple-900/30"
                          : isAIGenerated
                          ? "border-purple-200 dark:border-purple-800/50 bg-purple-50 dark:bg-purple-900/20 hover:bg-purple-100 dark:hover:bg-purple-900/30"
                          : isSelected
                          ? "border-primary bg-primary/10"
                          : "border-transparent bg-muted/40 hover:bg-muted/60",
                        isAssignedElsewhere && !isSelected && "opacity-70"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() =>
                            handleToggle(keyword.keyword, group.page, keyword.source || "gsc-existing")
                          }
                          disabled={isSaving}
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium leading-tight">{keyword.keyword}</p>
                            {isAIGenerated && (
                              <Badge variant="outline" className="text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800">
                                AI
                              </Badge>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {keyword.impressions > 0 ? (
                              <>
                                <span>{keyword.impressions} impressions</span>
                                <span>Pos. {keyword.position}</span>
                              </>
                            ) : (
                              <span className="text-purple-600 dark:text-purple-400">AI Generated</span>
                            )}
                            {isAssignedElsewhere && (
                              <Badge variant="outline">Selected on another page</Badge>
                            )}
                          </div>
                        </div>
                      </div>
                      {keyword.clicks > 0 && (
                        <div className="text-xs text-muted-foreground">
                          {keyword.clicks} clicks
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom Keyword Dialog */}
      <Dialog open={customKeywordDialog.open} onOpenChange={(open) => 
        setCustomKeywordDialog({ ...customKeywordDialog, open })
      }>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Keyword</DialogTitle>
            <DialogDescription>
              Enter a keyword in the format "service/product location"
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Input
                placeholder="e.g., group tour mexico city"
                value={customKeywordDialog.keyword}
                onChange={(e) =>
                  setCustomKeywordDialog({
                    ...customKeywordDialog,
                    keyword: e.target.value,
                  })
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && validateKeywordFormat(customKeywordDialog.keyword)) {
                    handleSaveCustomKeyword();
                  }
                }}
              />
              {customKeywordDialog.keyword && !validateKeywordFormat(customKeywordDialog.keyword) && (
                <p className="text-xs text-red-500">
                  Keyword should have at least 2 words (e.g., "service location")
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCustomKeywordDialog({ open: false, pageUrl: null, keyword: "" })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveCustomKeyword}
              disabled={!validateKeywordFormat(customKeywordDialog.keyword)}
            >
              Add Keyword
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isSaving && (
        <p className="text-xs text-muted-foreground">
          Saving your focus keywords…
        </p>
      )}
    </div>
  );
};

export default FocusKeywordSelector;

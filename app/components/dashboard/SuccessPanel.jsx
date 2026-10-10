"use client";
import { writeSeoRecord } from "../../lib/writeSeoRecord";

import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { 
  CheckCircle2, 
  PartyPopper,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  XCircle,
  TrendingUp,
  BarChart3,
  Clock,
  AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { db } from "../../lib/firebaseConfig";
import { doc, deleteField, getDoc } from "firebase/firestore";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  if (position <= 15) return 0.01;  // 1%
  return 0.005; // 0.5% for position 16+
};

export default function SuccessPanel({
  pageUrl,
  focusKeyword,
  snapshot,
  implementationData,
  preStats,
}) {
  const { user } = useAuth();
  const [isExpanded, setIsExpanded] = useState(false);
  const [contentMaxHeight, setContentMaxHeight] = useState("0px");
  const [showStartFreshModal, setShowStartFreshModal] = useState(false);
  const [showDismissModal, setShowDismissModal] = useState(false);
  const [isStartingFresh, setIsStartingFresh] = useState(false);
  const [isDismissing, setIsDismissing] = useState(false);
  const contentRef = useRef(null);

  const cleanUrl = pageUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") || "";
  
  // Use snapshot data for display
  const position = snapshot?.position || implementationData?.currentPosition || 0;
  const impressions = snapshot?.impressions || implementationData?.postStats?.impressions || 0;
  const clicks = snapshot?.clicks || implementationData?.postStats?.clicks || 0;
  const ctr = snapshot?.ctr || implementationData?.postStats?.ctr || 0;
  const expectedCTR = getExpectedCTR(position);
  const ctrPercent = (ctr * 100).toFixed(1);
  const expectedCTRPercent = (expectedCTR * 100).toFixed(1);
  
  // Calculate improvement from preStats
  const prePosition = preStats?.position || implementationData?.preStats?.position || position;
  const positionImproved = prePosition > position;
  const positionChange = Math.abs(position - prePosition).toFixed(1);
  
  // Format snapshot date
  const snapshotDate = snapshot?.capturedAt 
    ? new Date(snapshot.capturedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  
  // Calculate next refresh date (7 days from snapshot)
  const nextRefreshDate = snapshot?.capturedAt
    ? new Date(new Date(snapshot.capturedAt).getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;
  
  // Check if card type changed from previous snapshot
  const cardTypeChanged = snapshot?.previousCardType && snapshot.previousCardType !== "success" && snapshot.previousCardType !== null;

  // Check if this is a resurfaced page (decline detected)
  const isResurfaced = snapshot?.declineDetected === true;

  // Handle Start Fresh 45-Day Tracking
  const handleStartFresh = async () => {
    if (!user?.id) {
      toast.error("Please sign in to continue");
      return;
    }

    setIsStartingFresh(true);

    try {
      const docId = createSafeDocId(user.id, pageUrl);

      // Fetch current document to preserve successful cycle's data
      const currentDoc = await getDoc(doc(db, "implementedSeoTips", docId));
      const currentData = currentDoc.exists() ? currentDoc.data() : {};

      // Get or create successRestartHistory array
      const successRestartHistory = currentData.successRestartHistory || [];

      // Save the successful cycle to history before resetting
      if (currentData.preStats || currentData.postStats || snapshot) {
        successRestartHistory.push({
          preStats: currentData.preStats || null,
          postStats: currentData.postStats || snapshot || null,
          postStatsHistory: currentData.postStatsHistory || [],
          keyword: currentData.currentKeyword || focusKeyword || "Unknown",
          restartedAt: new Date().toISOString(),
          daysTracked: currentData.implementedAt
            ? Math.floor((Date.now() - new Date(currentData.implementedAt).getTime()) / (1000 * 60 * 60 * 24))
            : 0,
          reason: "Success - User chose to start fresh tracking",
          cardType: snapshot?.cardType || "success",
          implementationType: currentData.implementationType || "unknown",
        });
      }

      // Save current stats to history and reset tracking
      await writeSeoRecord(
        doc(db, "implementedSeoTips", docId),
        {
          // Preserve success history
          successRestartHistory: successRestartHistory,

          status: "implemented",
          implementationType: "success-restart",
          implementedAt: new Date().toISOString(),
          nextUpdateDue: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          preStats: {
            impressions: impressions,
            clicks: clicks,
            ctr: ctr,
            position: position,
          },
          // Clear snapshot and passive monitoring fields - user took action
          dayFortyFiveSnapshot: deleteField(),
          postStats: deleteField(),
          postStatsHistory: deleteField(),
          passiveMonitoring: deleteField(),
          dismissedAt: deleteField(),
          dismissedMetrics: deleteField(),
          allowReImplementation: false,  // Reset flag - starting new cycle
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      toast.success("Fresh 45-day tracking started!", {
        description: "Your progress will be tracked from today."
      });

      setShowStartFreshModal(false);

      // Refresh page after short delay
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error("Error starting fresh tracking:", error);
      toast.error("Failed to start fresh tracking. Please try again.");
    } finally {
      setIsStartingFresh(false);
    }
  };

  // Handle Dismiss (enter passive monitoring)
  const handleDismiss = async () => {
    if (!user?.id) {
      toast.error("Please sign in to continue");
      return;
    }

    setIsDismissing(true);

    try {
      const docId = createSafeDocId(user.id, pageUrl);

      // Enter passive monitoring state
      await writeSeoRecord(
        doc(db, "implementedSeoTips", docId),
        {
          passiveMonitoring: true,
          dismissedAt: new Date().toISOString(),
          dismissedMetrics: {
            impressions: impressions,
            clicks: clicks,
            ctr: ctr,
            position: position,
          },
          // Clear the snapshot - user dismissed
          dayFortyFiveSnapshot: deleteField(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      toast.success("Page dismissed from active monitoring", {
        description: "We'll notify you if performance drops significantly."
      });

      setShowDismissModal(false);

      // Refresh page after short delay
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (error) {
      console.error("Error dismissing page:", error);
      toast.error("Failed to dismiss page. Please try again.");
    } finally {
      setIsDismissing(false);
    }
  };

  useEffect(() => {
    if (isExpanded && contentRef.current) {
      setContentMaxHeight("1500px");
    } else {
      setContentMaxHeight("0px");
    }
  }, [isExpanded]);

  return (
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className="rounded-lg border-2 border-emerald-300 dark:border-emerald-700 bg-gradient-to-br from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30 overflow-hidden">
        {/* Decline Warning Banner - shown when resurfaced */}
        {isResurfaced && snapshot?.declineDetails && (
          <div className="p-3 bg-amber-100 dark:bg-amber-900/30 border-b border-amber-300 dark:border-amber-700">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-200 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Performance Declined
            </div>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
              {snapshot.declineReason === "ctr-drop" 
                ? `CTR dropped from ${(snapshot.declineDetails.previousCtr * 100).toFixed(1)}% to ${ctrPercent}%`
                : `Position dropped from ${snapshot.declineDetails.previousPosition.toFixed(0)} to ${position.toFixed(0)}`
              } since you dismissed it. Here are your options:
            </p>
          </div>
        )}

        {/* Header */}
        <div className="p-4 pb-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0 flex-1">
              <div className="relative flex-shrink-0 mt-0.5">
                <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                <PartyPopper className="h-3 w-3 text-amber-500 absolute -top-1 -right-1" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-semibold text-base sm:text-lg text-emerald-900 dark:text-emerald-100 flex items-center gap-2 flex-wrap">
                  <span className="break-all">{cleanUrl}</span>
                  <a 
                    href={pageUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-emerald-600 hover:text-emerald-800 dark:text-emerald-400 dark:hover:text-emerald-200 transition-colors flex-shrink-0"
                    title="Open page in new tab"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </h4>
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  {isResurfaced ? "This page came back for review" : "This page is performing well!"} 🎉
                </p>
              </div>
            </div>
            
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 flex-shrink-0 self-start sm:self-center">
                {isExpanded ? (
                  <ChevronDown className="h-5 w-5" />
                ) : (
                  <ChevronRight className="h-5 w-5" />
                )}
              </Button>
            </CollapsibleTrigger>
          </div>

          {/* Success Badge - Always visible */}
          <div className="mt-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 text-sm font-medium">
              <TrendingUp className="h-4 w-4" />
              CTR of {ctrPercent}% meets expected {expectedCTRPercent}% for position {position.toFixed(0)}
            </span>
          </div>

          {/* Snapshot info */}
          {snapshotDate && (
            <div className="mt-2 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
              <Clock className="h-3 w-3" />
              <span>Based on metrics as of {snapshotDate}. Next refresh: {nextRefreshDate}.</span>
            </div>
          )}

          {/* Card type change message */}
          {cardTypeChanged && !isResurfaced && (
            <div className="mt-2 p-2 bg-emerald-100/50 dark:bg-emerald-900/30 rounded-md text-xs text-emerald-800 dark:text-emerald-200">
              <strong>Update:</strong> Your recommendation changed based on new metrics. 
              Previously: {snapshot.previousCardType === "pivot" ? "Pivot recommended" : "Content audit needed"}. 
              Now: Performing well — great progress!
            </div>
          )}
        </div>

        {/* Collapsible Content */}
        <CollapsibleContent>
          <div 
            ref={contentRef}
            style={{ 
              display: isExpanded ? "block" : "none",
            }}
            className="px-4 pb-4 space-y-4"
          >
            {/* Performance Stats */}
            <div className="bg-white/60 dark:bg-black/20 rounded-lg p-4">
              <h5 className="font-medium text-emerald-900 dark:text-emerald-100 mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4" />
                Performance Summary
              </h5>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-lg">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Position</p>
                  <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100">
                    {position.toFixed(1)}
                    {positionImproved && (
                      <span className="text-sm text-emerald-500 ml-1">↑{positionChange}</span>
                    )}
                  </p>
                  <p className="text-xs text-emerald-600/70 dark:text-emerald-400/70 mt-1">
                    Page {Math.ceil(position / 10)} of Google
                  </p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-lg">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Impressions</p>
                  <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100">
                    {impressions.toLocaleString()}
                  </p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-lg">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">Clicks</p>
                  <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100">
                    {clicks.toLocaleString()}
                  </p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-900/30 p-3 rounded-lg">
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">CTR</p>
                  <p className="text-xl font-bold text-emerald-900 dark:text-emerald-100">
                    {ctrPercent}%
                  </p>
                </div>
              </div>

              {focusKeyword && (
                <div className="mt-3 p-2 bg-emerald-100/50 dark:bg-emerald-900/20 rounded-md">
                  <p className="text-sm text-emerald-700 dark:text-emerald-300">
                    <strong>Focus Keyword:</strong> {focusKeyword}
                  </p>
                </div>
              )}
            </div>

            {/* Explanation */}
            <div className="bg-emerald-100/50 dark:bg-emerald-900/20 rounded-lg p-4">
              <h5 className="font-medium text-emerald-900 dark:text-emerald-100 mb-2">What does this mean?</h5>
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                Your page&apos;s click-through rate ({ctrPercent}%) meets or exceeds the expected CTR ({expectedCTRPercent}%) 
                for its average position ({position.toFixed(1)}). This indicates your title and description are compelling 
                and relevant to searchers.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={() => setShowStartFreshModal(true)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Start Fresh 45-Day Tracking
              </Button>
              
              <Button
                onClick={() => setShowDismissModal(true)}
                variant="outline"
                className="flex-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-700 dark:text-emerald-300 dark:hover:bg-emerald-900/20"
              >
                <XCircle className="h-4 w-4 mr-2" />
                Dismiss
              </Button>
            </div>

            <p className="text-xs text-emerald-600 dark:text-emerald-400 text-center">
              Dismissing moves this page to passive monitoring. We&apos;ll alert you if performance drops significantly.
            </p>
          </div>
        </CollapsibleContent>
      </div>

      {/* Start Fresh Confirmation Modal */}
      <Dialog open={showStartFreshModal} onOpenChange={setShowStartFreshModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-emerald-600" />
              Start Fresh 45-Day Tracking?
            </DialogTitle>
            <DialogDescription>
              This will reset your tracking progress and start a new 45-day monitoring cycle. 
              Your current performance metrics will be saved as the new baseline.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowStartFreshModal(false)}
              disabled={isStartingFresh}
            >
              Cancel
            </Button>
            <Button
              onClick={handleStartFresh}
              disabled={isStartingFresh}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {isStartingFresh ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Starting...
                </>
              ) : (
                "Start Fresh Tracking"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dismiss Confirmation Modal */}
      <Dialog open={showDismissModal} onOpenChange={setShowDismissModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5 text-amber-600" />
              Dismiss This Page?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-3">
                <p>
                  This page will be removed from your dashboard and placed into silent background monitoring.
                </p>
                <div className="bg-zinc-800/50 rounded-md p-3 text-left">
                  <p className="font-medium text-zinc-300 mb-2">What happens next:</p>
                  <ul className="ml-4 list-disc space-y-1 text-zinc-400">
                    <li>Page disappears from SEO Progress</li>
                    <li>No more 7-day refresh updates</li>
                    <li>We silently monitor for significant drops</li>
                  </ul>
                </div>
                <div className="bg-amber-950/30 border border-amber-800/50 rounded-md p-3 text-left">
                  <p className="font-medium text-amber-400 mb-2">Page will reappear only if:</p>
                  <ul className="ml-4 list-disc space-y-1 text-amber-300/80">
                    <li>CTR drops by 50% or more</li>
                    <li>Position drops by 10+ places</li>
                  </ul>
                </div>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-3">
            <Button
              variant="outline"
              onClick={() => setShowDismissModal(false)}
              disabled={isDismissing}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDismiss}
              disabled={isDismissing}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isDismissing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Dismissing...
                </>
              ) : (
                "Dismiss & Monitor"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  );
}

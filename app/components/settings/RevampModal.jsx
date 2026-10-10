"use client";

import { authenticatedFetch } from "../../lib/authenticatedFetch";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useOnboarding } from "../../contexts/OnboardingContext";
import { useAuth } from "../../contexts/AuthContext";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlertTriangle, Calendar, Globe, Rocket, ArrowLeft } from "lucide-react";

export default function RevampModal({ open, onClose }) {
  const router = useRouter();
  const { user } = useAuth();
  const { data, updateData, reloadData } = useOnboarding();

  const [step, setStep] = useState(1);
  const [subState, setSubState] = useState(null); // "not-live", "new-domain", "warning"
  const [revampDate, setRevampDate] = useState("");
  const [reminderDate, setReminderDate] = useState("");
  const [isArchiving, setIsArchiving] = useState(false);
  const [archiveError, setArchiveError] = useState(null);

  const resetAndClose = () => {
    setStep(1);
    setSubState(null);
    setRevampDate("");
    setReminderDate("");
    setArchiveError(null);
    onClose();
  };

  const handleNotLive = () => {
    setSubState("not-live");
  };

  const handleSaveReminder = async () => {
    if (reminderDate) {
      await updateData({ revampReminderDate: reminderDate });
    }
    resetAndClose();
  };

  const handleNewDomain = () => {
    setSubState("new-domain");
  };

  const handleSameDomain = () => {
    setStep(3);
    setSubState(null);
  };

  const handleDateContinue = () => {
    if (!revampDate) return;
    setSubState("warning");
  };

  const handleCancel = async () => {
    resetAndClose();
  };

  const handleConfirmRevamp = async () => {
    setIsArchiving(true);
    setArchiveError(null);

    try {
      const res = await authenticatedFetch("/api/revamp/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, revampDate }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || "Archive failed");
      }

      await reloadData();

      resetAndClose();
      router.push("/revamp");
    } catch (error) {
      console.error("Revamp archive failed:", error);
      setArchiveError(error.message);
      setIsArchiving(false);
    }
  };

  const today = new Date().toISOString().split("T")[0];

  const currentStepNumber = subState === "warning" ? 3 : step;
  const showStepIndicator = !subState || subState === "warning";

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && resetAndClose()}>
      <DialogContent className="sm:max-w-lg">
        {/* Step Indicator */}
        {showStepIndicator && (
          <div className="flex items-center justify-center gap-2 mb-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                    s <= currentStepNumber
                      ? "bg-green-600 text-white"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {s}
                </div>
                {s < 3 && (
                  <div className={`w-8 h-0.5 ${s < currentStepNumber ? "bg-green-600" : "bg-muted"}`} />
                )}
              </div>
            ))}
          </div>
        )}

        {/* STEP 1 — Is your new site live? */}
        {step === 1 && !subState && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Rocket className="w-5 h-5" />
                Is Your New Site Already Live?
              </DialogTitle>
              <DialogDescription>
                Let us know if your revamped website has launched so we can guide you through the transition.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 mt-4">
              <Button
                variant="outline"
                className="justify-start h-auto py-3 px-4"
                onClick={handleNotLive}
              >
                <Calendar className="w-4 h-4 mr-2 flex-shrink-0" />
                <span className="text-left">Not yet, I&apos;m still planning</span>
              </Button>
              <Button
                className="justify-start h-auto py-3 px-4 bg-green-600 hover:bg-green-700"
                onClick={() => setStep(2)}
              >
                <Globe className="w-4 h-4 mr-2 flex-shrink-0" />
                <span className="text-left">Yes, it&apos;s live</span>
              </Button>
            </div>
          </>
        )}

        {/* STEP 1 — Not live yet */}
        {step === 1 && subState === "not-live" && (
          <>
            <DialogHeader>
              <DialogTitle>No Problem!</DialogTitle>
              <DialogDescription>
                Come back once your new site is live and we&apos;ll walk you through the transition.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-muted-foreground">
                  Expected launch date (optional)
                </label>
                <Input
                  type="date"
                  value={reminderDate}
                  onChange={(e) => setReminderDate(e.target.value)}
                  min={today}
                />
                {reminderDate && (
                  <p className="text-xs text-muted-foreground">
                    We&apos;ll remind you when this date arrives.
                  </p>
                )}
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={handleSaveReminder}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP 2 — Same domain? */}
        {step === 2 && !subState && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Globe className="w-5 h-5" />
                Did Your Domain Name Stay the Same?
              </DialogTitle>
              <DialogDescription>
                We need to know if you&apos;re still using <strong>{data?.websiteUrl?.replace(/^https?:\/\//, "").replace(/\/+$/, "") || "your current domain"}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 mt-4">
              <Button
                variant="outline"
                className="justify-start h-auto py-3 px-4"
                onClick={handleNewDomain}
              >
                <span className="text-left">No, I have a new domain</span>
              </Button>
              <Button
                className="justify-start h-auto py-3 px-4 bg-green-600 hover:bg-green-700"
                onClick={handleSameDomain}
              >
                <span className="text-left">Yes, same domain</span>
              </Button>
            </div>
            <div className="mt-2">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" onClick={() => { setStep(1); setSubState(null); }}>
                <ArrowLeft className="w-3 h-3 mr-1" /> Back
              </Button>
            </div>
          </>
        )}

        {/* STEP 2 — New domain */}
        {step === 2 && subState === "new-domain" && (
          <>
            <DialogHeader>
              <DialogTitle>New Domain Detected</DialogTitle>
              <DialogDescription>
                Since SimplSEO tracks your specific domain&apos;s Google Search Console data, you&apos;ll need to create a new SimplSEO account for your new domain.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Your current account remains fully active and all your existing data is preserved. You can continue using it alongside a new account for your new domain.
              </p>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={resetAndClose}>
                Close
              </Button>
            </DialogFooter>
          </>
        )}

        {/* STEP 3 — When did it go live? */}
        {step === 3 && subState !== "warning" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5" />
                When Did Your New Site Go Live?
              </DialogTitle>
              <DialogDescription>
                Select the date your revamped website was published. This helps us track your new site&apos;s performance accurately.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <Input
                type="date"
                value={revampDate}
                onChange={(e) => setRevampDate(e.target.value)}
                max={today}
              />
            </div>
            <DialogFooter className="mt-4 gap-2">
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground mr-auto" onClick={() => { setStep(2); setSubState(null); }}>
                <ArrowLeft className="w-3 h-3 mr-1" /> Back
              </Button>
              <Button
                className="bg-green-600 hover:bg-green-700"
                onClick={handleDateContinue}
                disabled={!revampDate}
              >
                Continue
              </Button>
            </DialogFooter>
          </>
        )}

        {/* WARNING CONFIRMATION */}
        {subState === "warning" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-amber-600">
                <AlertTriangle className="w-5 h-5" />
                You&apos;re About to Enter Revamp Mode
              </DialogTitle>
            </DialogHeader>
            <div className="mt-2 space-y-3">
              <p className="text-sm text-muted-foreground">Here is what will happen:</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5">•</span>
                  <span>Your current tracked pages and data will be <strong>archived</strong>. You can still view them in Previous website work, but you will not be able to edit or take any actions on them.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5">•</span>
                  <span>Your dashboard and settings stay available during setup.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5">•</span>
                  <span>Search data monitoring continues independently. Focus keywords are optional.</span>
                </li>
              </ul>

              {archiveError && (
                <div className="p-3 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                  <p className="text-sm text-red-700 dark:text-red-300">{archiveError}</p>
                </div>
              )}
            </div>
            <DialogFooter className="mt-4 gap-2">
              <Button variant="outline" onClick={handleCancel} disabled={isArchiving}>
                Cancel
              </Button>
              <Button
                className="bg-amber-600 hover:bg-amber-700"
                onClick={handleConfirmRevamp}
                disabled={isArchiving}
              >
                {isArchiving ? "Archiving your data..." : "Yes, Start My Revamp"}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

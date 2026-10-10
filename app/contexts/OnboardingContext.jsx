"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { saveOnboardingData, getOnboardingData } from "../lib/firestoreHelpers";
import { useAuth } from "./AuthContext";

const initialData = {
  businessName: "",
  websiteUrl: "",
  businessType: "",
  businessLocation: "",
  servesMultipleCities: false, // Track if business serves multiple cities
  cmsPlatform: "",
  hasGSC: false,
  gscProperty: "",
  googleEmail: "",
  isComplete: false,
  siteCrawlStatus: "idle",
  lastSiteCrawlAt: null,
  privacyPolicyAccepted: false,
  postOnboardingStep: null, // 'pages' | 'keywords' | 'complete' | null
  pagesStepCompleted: false, // Track if pages step is completed
  revampStatus: "idle", // 'idle' | 'in-progress' | 'complete'
  revampDate: null,
  revampReminderDate: null,
  revampInitiatedAt: null,
  revampPages: [],
  revampStep: null, // 'crawl' | 'waiting' | 'keywords' | 'complete' | null
};

const OnboardingContext = createContext(undefined);

export const useOnboarding = () => {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return context;
};

// Helper functions for localStorage
const getDraftKey = (userId) => `onboarding_draft_${userId}`;

const saveDraftToLocalStorage = (userId, data) => {
  if (typeof window !== "undefined" && userId) {
    try {
      localStorage.setItem(getDraftKey(userId), JSON.stringify(data));
    } catch (err) {
      console.warn("⚠️ Failed to save draft to localStorage:", err);
    }
  }
};

const loadDraftFromLocalStorage = (userId) => {
  if (typeof window !== "undefined" && userId) {
    try {
      const draft = localStorage.getItem(getDraftKey(userId));
      return draft ? JSON.parse(draft) : null;
    } catch (err) {
      console.warn("⚠️ Failed to load draft from localStorage:", err);
      return null;
    }
  }
  return null;
};

const clearDraftFromLocalStorage = (userId) => {
  if (typeof window !== "undefined" && userId) {
    try {
      localStorage.removeItem(getDraftKey(userId));
    } catch (err) {
      console.warn("⚠️ Failed to clear draft from localStorage:", err);
    }
  }
};

export const OnboardingProvider = ({ children }) => {
  const [data, setData] = useState(initialData);
  const [isLoaded, setIsLoaded] = useState(false);
  const { user } = useAuth();
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    const loadData = async () => {
      if (!user) {
        setData(initialData);
        setIsLoaded(false);
        return;
      }

      try {
        setIsLoaded(false);
        
        // First, try to load from Firestore (completed onboarding)
        const firestoreData = await getOnboardingData(user.id);
        
        if (firestoreData?.isComplete) {
          // User has completed onboarding - use Firestore data
          setData(firestoreData);
          // Clear any draft from localStorage since onboarding is complete
          clearDraftFromLocalStorage(user.id);
        } else if (firestoreData) {
          // Firestore has incomplete data (legacy) - use it but don't save drafts
          setData(firestoreData);
        } else {
          // No Firestore data - check localStorage for draft
          const draftData = loadDraftFromLocalStorage(user.id);
          if (draftData) {
            console.log("📝 Restoring draft from localStorage");
            setData(draftData);
          } else {
            setData(initialData);
          }
        }
      } catch (err) {
        console.error("Failed to fetch onboarding data:", err);
        // On error, try to load from localStorage
        const draftData = loadDraftFromLocalStorage(user.id);
        if (draftData) {
          setData(draftData);
        } else {
          setData(initialData);
        }
      } finally {
        setIsLoaded(true);
      }
    };

    loadData();
  }, [user]);

  const updateData = async (newData) => {
    const previous = dataRef.current;
    const updated = { ...previous, ...newData };
    if (user) {
      if (updated.isComplete) {
        // After initial completion, only write changed fields; never stale monitoring data.
        await saveOnboardingData(user.id, previous.isComplete ? newData : updated);
        clearDraftFromLocalStorage(user.id);
      } else {
        saveDraftToLocalStorage(user.id, updated);
      }
    }
    dataRef.current = { ...dataRef.current, ...newData };
    setData(dataRef.current);
  };

  const reloadData = async () => {
    if (!user) return;
    const stored = await getOnboardingData(user.id);
    if (stored) { dataRef.current = { ...initialData, ...stored }; setData(dataRef.current); }
  };

  const resetData = () => {
    setData(initialData);
    setIsLoaded(true);
    if (user) {
      // Clear both Firestore and localStorage
      saveOnboardingData(user.id, initialData).catch((err) =>
        console.error("❌ Failed to reset onboarding data:", err)
      );
      clearDraftFromLocalStorage(user.id);
    }
  };

  return (
    <OnboardingContext.Provider value={{ data, updateData, resetData, reloadData, isLoaded }}>
      {children}
    </OnboardingContext.Provider>
  );
};

"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { saveOnboardingData, getOnboardingData } from "../lib/firestoreHelpers";
import { useAuth } from "./AuthContext";
import { authenticatedFetch } from '../lib/authenticatedFetch';
import { editableOnboardingDraft } from '../lib/onboardingDraft';

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
  const [setupWorkspace, setSetupWorkspace] = useState(null);
  const [setupError, setSetupError] = useState('');
  const { user, access } = useAuth();
  const dataRef = useRef(data);
  const userId = access?.status === 'approved' ? user?.id : null;
  const accountRef = useRef(userId);
  accountRef.current = user?.id;
  dataRef.current = data;

  const applySetupWorkspace = useCallback(workspace => {
    if (!workspace || typeof workspace.eligible !== 'boolean') return;
    setSetupWorkspace(workspace); setSetupError('');
  }, []);

  const refreshSetup = useCallback(async () => {
    const uid = user?.id;
    if (!uid) return null;
    try {
      const response = await authenticatedFetch('/api/onboarding/workspace');
      const workspace = await response.json();
      if (!response.ok) throw new Error(workspace.error || 'Your saved setup could not be loaded. Please retry.');
      if (accountRef.current !== uid) return null;
      applySetupWorkspace(workspace);
      return workspace;
    } catch (error) { if (accountRef.current === uid) setSetupError(error.message); throw error; }
  }, [user?.id, applySetupWorkspace]);

  useEffect(() => {
    let cancelled = false;
    const loadData = async () => {
      setSetupWorkspace(null); setSetupError('');
      if (!userId) {
        setData(initialData);
        setIsLoaded(false);
        return;
      }

      try {
        setIsLoaded(false);
        
        // First, try to load from Firestore (completed onboarding)
        const [stored, workspace] = await Promise.allSettled([
          getOnboardingData(userId),
          authenticatedFetch('/api/onboarding/workspace').then(async response => {
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Your saved setup could not be loaded. Please retry.');
            return result;
          }),
        ]);
        if (cancelled) return;
        if (workspace.status === 'fulfilled') applySetupWorkspace(workspace.value);
        else setSetupError(workspace.reason.message);
        if (stored.status === 'rejected') throw stored.reason;
        const firestoreData = stored.value;
        
        if (firestoreData?.isComplete) {
          // User has completed onboarding - use Firestore data
          setData(firestoreData);
          // Clear any draft from localStorage since onboarding is complete
          clearDraftFromLocalStorage(userId);
        } else if (firestoreData) {
          // Firestore has incomplete data (legacy) - use it but don't save drafts
          setData(firestoreData);
        } else {
          // No Firestore data - check localStorage for draft
          const draftData = loadDraftFromLocalStorage(userId);
          if (draftData) {
            console.log("📝 Restoring draft from localStorage");
            setData({ ...initialData, ...editableOnboardingDraft(draftData) });
          } else {
            setData(initialData);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to fetch onboarding data:", err);
        // On error, try to load from localStorage
        const draftData = loadDraftFromLocalStorage(userId);
        if (draftData) {
          setData({ ...initialData, ...editableOnboardingDraft(draftData) });
        } else {
          setData(initialData);
        }
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    };

    loadData();
    return () => { cancelled = true; };
  }, [userId, applySetupWorkspace]);

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
    const uid = user.id;
    const stored = await getOnboardingData(user.id);
    if (stored && accountRef.current === uid) { dataRef.current = { ...initialData, ...stored }; setData(dataRef.current); }
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
    <OnboardingContext.Provider value={{ data, updateData, resetData, reloadData, isLoaded, setupWorkspace, setupError, refreshSetup, applySetupWorkspace }}>
      {children}
    </OnboardingContext.Provider>
  );
};

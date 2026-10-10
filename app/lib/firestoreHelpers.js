import { writeSeoRecord } from "./writeSeoRecord";

import { authenticatedFetch } from "./authenticatedFetch";
import { doc, getDoc, setDoc, collection, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { db } from "./firebaseConfig";

// Save onboarding data
export const saveOnboardingData = async (userId, data) => {
  try {
    const docRef = doc(db, "onboarding", userId);
    await setDoc(docRef, data, { merge: true });
  } catch (error) {
    console.error("Failed to save onboarding data:", error);
    throw error;
  }
};

// Get onboarding data
export const getOnboardingData = async (userId) => {
  try {
    const docRef = doc(db, "onboarding", userId);
    const snapshot = await getDoc(docRef);
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    console.error("Failed to fetch onboarding data:", error);
    throw error;
  }
};

// Save internal link suggestion
export const setInternalLinkSuggestion = async (userId, pageUrl, suggestion) => {
  try {
    const docId = `${userId}_${encodeURIComponent(pageUrl)}`;
    const docRef = doc(db, "internalLinkSuggestions", docId);
    await setDoc(docRef, suggestion, { merge: true });
  } catch (error) {
    console.error("Failed to save internal link suggestion:", error);
    throw error;
  }
};

// Get internal link suggestion
export const getInternalLinkSuggestion = async (userId, pageUrl) => {
  try {
    const docId = `${userId}_${encodeURIComponent(pageUrl)}`;
    const docRef = doc(db, "internalLinkSuggestions", docId);
    const snapshot = await getDoc(docRef);
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    console.error("Failed to fetch internal link suggestion:", error);
    throw error;
  }
};

// Save content audit result
export const saveContentAuditResult = async (userId, pageUrl, auditResult) => {
  try {
    const docId = `${userId}_${encodeURIComponent(pageUrl)}`;
    const docRef = doc(db, "contentAuditResults", docId);
    await writeSeoRecord(docRef, {
      ...auditResult,
      pageUrl,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error("Failed to save content audit result:", error);
    throw error;
  }
};

// Get content audit result
export const getContentAuditResult = async (userId, pageUrl) => {
  try {
    const docId = `${userId}_${encodeURIComponent(pageUrl)}`;
    const docRef = doc(db, "contentAuditResults", docId);
    const snapshot = await getDoc(docRef);
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    console.error("Failed to fetch content audit result:", error);
    throw error;
  }
};

// Save AI suggestions
export const saveAiSuggestions = async (userId, pageUrl, suggestions) => {
  try {
    const docId = `${userId}_${encodeURIComponent(pageUrl)}`;
    const docRef = doc(db, "aiSuggestions", docId);
    await writeSeoRecord(docRef, {
      ...suggestions,
      pageUrl,
      userId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, { merge: true });
  } catch (error) {
    console.error("Failed to save AI suggestions:", error);
    throw error;
  }
};

// Get AI suggestions
export const getAiSuggestions = async (userId, pageUrl) => {
  try {
    const docId = `${userId}_${encodeURIComponent(pageUrl)}`;
    const docRef = doc(db, "aiSuggestions", docId);
    const snapshot = await getDoc(docRef);
    return snapshot.exists() ? snapshot.data() : null;
  } catch (error) {
    console.error("Failed to fetch AI suggestions:", error);
    throw error;
  }
};

export const getCachedSitePages = async (userId, maxPages = 5) => {
  console.warn(
    "getCachedSitePages from firestoreHelpers should not be used on the server. Use admin SDK helper instead."
  );
  return [];
};

// Focus keyword helpers
export const saveFocusKeywords = async (userId, keywords, snapshot = null) => {
  try {
    const response = await authenticatedFetch("/api/focus-keywords", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        keywords,
        snapshot, // Include snapshot if provided
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody?.error || "Failed to save focus keywords");
    }

    return await response.json();
  } catch (error) {
    console.error("Failed to save focus keywords:", error);
    throw error;
  }
};

export const getFocusKeywords = async (userId) => {
  try {
    const response = await authenticatedFetch(
      `/api/focus-keywords?userId=${encodeURIComponent(userId)}`
    );
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody?.error || "Failed to fetch focus keywords");
    }
    const data = await response.json();
    if (!Array.isArray(data.keywords)) {
      return [];
    }
    return data.keywords
      .map((entry) => {
        if (!entry) return null;
        if (typeof entry === "string") {
          const keyword = entry.trim();
          if (!keyword) return null;
          return { keyword, pageUrl: null, source: "gsc-existing" };
        }
        const keyword =
          typeof entry.keyword === "string" ? entry.keyword.trim() : null;
        if (!keyword) return null;
        const pageUrl =
          typeof entry.pageUrl === "string" && entry.pageUrl.trim().length
            ? entry.pageUrl.trim()
            : null;
        const source = entry.source === "ai-generated" ? "ai-generated" : "gsc-existing";
        return { keyword, pageUrl, source };
      })
      .filter(Boolean);
  } catch (error) {
    console.error("Failed to fetch focus keywords:", error);
    throw error;
  }
};

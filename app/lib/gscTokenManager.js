import { db } from "./firebaseConfig";
import { doc, getDoc, setDoc } from "firebase/firestore";

// GSC Token Management
export class GSCTokenManager {
  constructor(userId) {
    this.userId = userId;
    this.userDoc = doc(db, "users", userId);
  }

  // Store GSC tokens in Firestore
  async storeTokens(refreshToken, accessToken, siteUrl) {
    try {
      console.log("🔐 About to store tokens in Firestore:", {
        hasRefreshToken: !!refreshToken,
        refreshTokenLength: refreshToken?.length,
        hasAccessToken: !!accessToken,
        accessTokenLength: accessToken?.length,
        siteUrl: siteUrl,
        userId: this.userId
      });

      // Get existing data to preserve tokens if not provided
      const existingDoc = await getDoc(this.userDoc);
      const existingData = existingDoc.exists() ? existingDoc.data() : {};

      // Create the document data, preserving existing tokens if not provided
      const docData = {
        gscRefreshToken: refreshToken || existingData.gscRefreshToken || null,
        gscAccessToken: accessToken || existingData.gscAccessToken,
        gscConnectedAt: new Date().toISOString(),
        gscLastSync: new Date().toISOString(),
      };

      // Add siteUrl if provided
      if (siteUrl) {
        docData.gscSiteUrl = siteUrl;
      }

      // Use setDoc to create/update the document
      await setDoc(this.userDoc, docData, { merge: true });
      
      console.log("✅ GSC tokens stored in Firestore");
      
      // Verify the storage worked
      const verifyDoc = await getDoc(this.userDoc);
      if (verifyDoc.exists()) {
        const storedData = verifyDoc.data();
        console.log("🔍 Verification - Stored data:", {
          hasRefreshToken: !!storedData.gscRefreshToken,
          refreshTokenLength: storedData.gscRefreshToken?.length,
          hasAccessToken: !!storedData.gscAccessToken,
          accessTokenLength: storedData.gscAccessToken?.length
        });
      } else {
        console.log("❌ Verification failed - Document doesn&apos;t exist after storage");
      }
    } catch (error) {
      console.error("❌ Failed to store GSC tokens:", error);
      throw error;
    }
  }

  // Get stored GSC data
  async getStoredGSCData() {
    try {
      const docSnap = await getDoc(this.userDoc);
      if (docSnap.exists()) {
        const data = docSnap.data();
        return {
          refreshToken: data.gscRefreshToken,
          accessToken: data.gscAccessToken,
          siteUrl: data.gscSiteUrl,
          connectedAt: data.gscConnectedAt,
          lastSync: data.gscLastSync,
        };
      }
      return null;
    } catch (error) {
      console.error("❌ Failed to get stored GSC data:", error);
      return null;
    }
  }

  // Check if access token is expired (GSC tokens expire in 1 hour)
  isTokenExpired(tokenIssuedAt) {
    if (!tokenIssuedAt) return true;
    
    const tokenTime = new Date(tokenIssuedAt).getTime();
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    
    // Add 5-minute buffer to be safe
    const bufferTime = 5 * 60 * 1000;
    
    return (now - tokenTime) > (oneHour - bufferTime);
  }

  // Update last sync timestamp
  async updateLastSync() {
    try {
      await setDoc(
        this.userDoc,
        {
          gscLastSync: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (error) {
      console.error("❌ Failed to update last sync:", error);
    }
  }

  // Clear GSC data
  async clearGSCData() {
    try {
      await setDoc(
        this.userDoc,
        {
          gscRefreshToken: null,
          gscAccessToken: null,
          gscSiteUrl: null,
          gscConnectedAt: null,
          gscLastSync: null,
        },
        { merge: true }
      );
      console.log("✅ GSC data cleared from Firestore");
    } catch (error) {
      console.error("❌ Failed to clear GSC data:", error);
    }
  }

  // Get valid access token (refresh if needed)
  async getValidAccessToken() {
    const gscData = await this.getStoredGSCData();
    
    console.log("🔍 GSC Data for token validation:", {
      hasRefreshToken: !!gscData?.refreshToken,
      hasAccessToken: !!gscData?.accessToken,
      connectedAt: gscData?.connectedAt,
      isExpired: gscData?.connectedAt ? this.isTokenExpired(gscData.connectedAt) : 'unknown'
    });
    
    if (!gscData?.refreshToken) {
      console.log("❌ No refresh token found");
      return null; // No GSC connection
    }

    // If access token is still valid, return it
    if (gscData.accessToken && !this.isTokenExpired(gscData.connectedAt)) {
      console.log("✅ Access token is still valid");
      return gscData.accessToken;
    }

    // Token is expired, need to refresh
    console.log("🔄 GSC access token expired, refreshing...");
    return await this.refreshAccessToken(gscData.refreshToken);
  }

  // Refresh access token using refresh token
  async refreshAccessToken(refreshToken) {
    try {
      const response = await fetch("/api/gsc/refresh-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data = await response.json();
      const newAccessToken = data.access_token;

      // Update stored access token
      await setDoc(
        this.userDoc,
        {
          gscAccessToken: newAccessToken,
          gscConnectedAt: new Date().toISOString(),
        },
        { merge: true }
      );

      console.log("✅ GSC access token refreshed");
      return newAccessToken;
    } catch (error) {
      console.error("❌ Failed to refresh GSC access token:", error);
      // If refresh fails, clear the connection
      // Keep the stored connection on temporary failures.
      return null;
    }
  }
}

// Helper function to create token manager for current user
export const createGSCTokenManager = (userId) => {
  if (!userId) {
    throw new Error("User ID is required for GSC token management");
  }
  return new GSCTokenManager(userId);
}; 
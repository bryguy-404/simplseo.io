import { db } from './firebaseConfig';
import { doc, getDoc } from 'firebase/firestore';
import { authenticatedFetch } from './authenticatedFetch';

// Compatibility for browser Search Console views. Every connection mutation and
// refresh verifies Firebase identity on the server. Temporary failures preserve it.
export class GSCTokenManager {
  constructor(userId) { this.userId = userId; this.userDoc = doc(db, 'users', userId); }
  async storeTokens(refreshToken, accessToken, siteUrl) {
    const response = await authenticatedFetch('/api/gsc/store-tokens', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.userId, refreshToken, accessToken, siteUrl }),
    });
    if (!response.ok) throw new Error((await response.json()).error || 'Unable to save Google connection.');
  }
  async getStoredGSCData() {
    const snapshot = await getDoc(this.userDoc);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return { refreshToken: data.gscRefreshToken, accessToken: data.gscAccessToken,
      siteUrl: data.gscSiteUrl, connectedAt: data.gscConnectedAt, lastSync: data.gscLastSync,
      expiresAt: data.gscExpiresAt };
  }
  isTokenExpired(issuedAt) { return !issuedAt || Date.now() - Date.parse(issuedAt) >= 55 * 60000; }
  async updateLastSync() { /* Successful server observations own sync timestamps. */ }
  async clearGSCData() {
    const response = await authenticatedFetch('/api/gsc/store-tokens', { method: 'DELETE' });
    if (!response.ok) throw new Error('Unable to disconnect Google. Please try again.');
  }
  async getValidAccessToken() {
    const data = await this.getStoredGSCData();
    if (!data?.siteUrl) return null;
    const expiresAt = data.expiresAt || Date.parse(data.connectedAt) + 3600000;
    if (data.accessToken && expiresAt > Date.now() + 300000) return data.accessToken;
    return this.refreshAccessToken();
  }
  async refreshAccessToken() {
    const response = await authenticatedFetch('/api/gsc/refresh-token', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: this.userId }) });
    if (response.status === 409) return null;
    if (!response.ok) throw new Error('Google is temporarily unavailable. Your connection has been preserved.');
    return (await response.json()).access_token;
  }
}
export function createGSCTokenManager(userId) {
  if (!userId) throw new Error('Sign in to use Google Search Console.');
  return new GSCTokenManager(userId);
}

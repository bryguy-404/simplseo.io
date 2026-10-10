import { auth } from './firebaseConfig';

export async function authenticatedFetch(url, options = {}) {
  await auth.authStateReady();
  if (!auth.currentUser) throw new Error('Please sign in to continue.');
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${await auth.currentUser.getIdToken()}`);
  return fetch(url, { ...options, headers });
}

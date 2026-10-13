"use client";
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut, onAuthStateChanged, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth } from '../lib/firebaseConfig';
const AuthContext = createContext(undefined);
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [access, setAccess] = useState({ status: 'loading' });
  const generation = useRef(0);
  const refreshAccess = useCallback(async () => {
    const current = auth.currentUser, version = ++generation.current;
    if (!current) { setAccess({ status: 'signed_out' }); return null; }
    setAccess({ status: 'loading' });
    try {
      const response = await fetch('/api/access/status', { headers: { Authorization: `Bearer ${await current.getIdToken()}` }, cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'We could not check your access. Please retry.');
      if (generation.current !== version || auth.currentUser?.uid !== current.uid) return null;
      const result = { ...value, status: value.approved ? 'approved' : 'pending' };
      setAccess(result); return result;
    } catch (error) {
      if (generation.current === version && auth.currentUser?.uid === current.uid) setAccess({ status: 'error', error: error.message });
      return null;
    }
  }, []);
  useEffect(() => onAuthStateChanged(auth, firebaseUser => {
    setUser(firebaseUser ? { id: firebaseUser.uid, email: firebaseUser.email || '', displayName: firebaseUser.displayName || '' } : null);
    if (!firebaseUser) {
      generation.current += 1;
      setAccess({ status: 'signed_out' });
      localStorage.removeItem('gscAccessToken'); localStorage.removeItem('gscSiteUrl'); localStorage.removeItem('approvedEmail');
    } else { void refreshAccess(); }
    setIsLoading(false);
  }), [refreshAccess]);
  const login = (email, password) => signInWithEmailAndPassword(auth, email, password);
  const signup = (email, password) => createUserWithEmailAndPassword(auth, email, password);
  const signInWithGoogle = async () => {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    // Search Console authorization happens separately during onboarding.
    return signInWithPopup(auth, provider);
  };
  const logout = async () => { await signOut(auth); };
  return <AuthContext.Provider value={{ user, isAuthenticated: !!user, isLoading, access, refreshAccess, login, signup, logout, signInWithGoogle }}>{children}</AuthContext.Provider>;
};

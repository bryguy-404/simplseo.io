"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth } from "../lib/firebaseConfig";

const AuthContext = createContext(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (firebaseUser) {
        setUser({
          id: firebaseUser.uid,
          email: firebaseUser.email ?? "",
        });
      } else {
        setUser(null);
        // Clear GSC data when user logs out
        localStorage.removeItem("gscAccessToken");
        localStorage.removeItem("gscSiteUrl");
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async (email, password) => {
    setIsLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      let message = "Incorrect password or email. Please try again.";

      if (error.code === "auth/user-not-found") {
        message = "No account found with that email.";
      } else if (error.code === "auth/wrong-password") {
        message = "Incorrect password. Please try again.";
      } else if (error.code === "auth/invalid-email") {
        message = "The email address is not valid.";
      }

      throw new Error(message);
    } finally {
      setIsLoading(false);
    }
  };

  const signup = async (email, password) => {
    setIsLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email, password);
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    setIsLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope("https://www.googleapis.com/auth/webmasters.readonly");

      const result = await signInWithPopup(auth, provider);
      const firebaseUser = result.user;

      setUser({
        id: firebaseUser.uid,
        email: firebaseUser.email ?? "",
      });

      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;

      // Store token if needed
    } catch (error) {
      throw new Error(error.message || "Google login failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    setIsLoading(true);
    // Clear GSC data before logout
    localStorage.removeItem("gscAccessToken");
    localStorage.removeItem("gscSiteUrl");
    await signOut(auth);
    setUser(null);
    setIsLoading(false);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        login,
        signup,
        logout,
        signInWithGoogle,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

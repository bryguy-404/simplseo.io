"use client";

import { useEffect } from "react";

export default function GSCCallback() {
  useEffect(() => {
    // Get the authorization code from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get("code");
    const state = urlParams.get("state");
    const error = urlParams.get("error");

    if (error) {
      // Handle OAuth error
      window.opener?.postMessage({
        state,
        type: "GSC_AUTH_ERROR",
        error: error
      }, window.location.origin);
      window.close();
      return;
    }

    if (code) {
      // Send the authorization code back to the parent window
      window.opener?.postMessage({
        state,
        type: "GSC_AUTH_SUCCESS",
        code: code
      }, window.location.origin);
      window.close();
    } else {
      // No code found
      window.opener?.postMessage({
        state,
        type: "GSC_AUTH_ERROR",
        error: "No authorization code received"
      }, window.location.origin);
      window.close();
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
        <p className="text-muted-foreground">Completing Google Search Console connection...</p>
      </div>
    </div>
  );
} 
"use client";
import { authenticatedFetch } from '../lib/authenticatedFetch';


import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useOnboarding } from "../contexts/OnboardingContext";
import MainLayout from "../components/MainLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DebugPage() {
  const { user, isLoading: authLoading } = useAuth();
  const { data, isLoading: isOnboardingLoading } = useOnboarding();
  const [testResults, setTestResults] = useState({});
  const [loading, setLoading] = useState(false);

  const runTests = async () => {
    setLoading(true);
    const results = {};

    try {
      // Test 1: Environment variables
      const envResponse = await authenticatedFetch("/api/test-env");
      results.env = await envResponse.json();

      // Test 2: Scraping API
      const scrapeResponse = await authenticatedFetch("/api/scrape-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageUrl: "https://bryandevelops.com/" })
      });
      results.scrape = await scrapeResponse.json();

      // Test 3: Intent Analysis
      const intentResponse = await authenticatedFetch("/api/test-intent-mismatch");
      results.intent = await intentResponse.json();

      // Test 4: Firebase connection
      if (user?.id) {
        try {
          const { doc, getDoc, db } = await import("firebase/firestore");
          const { db: firebaseDb } = await import("../lib/firebaseConfig");
          const testDoc = await getDoc(doc(firebaseDb, "users", user.id));
          results.firebase = {
            success: true,
            userExists: testDoc.exists(),
            userId: user.id
          };
        } catch (error) {
          results.firebase = {
            success: false,
            error: error.message
          };
        }
      }

    } catch (error) {
      results.error = error.message;
    }

    setTestResults(results);
    setLoading(false);
  };

  if (authLoading || isOnboardingLoading) {
    return (
      <MainLayout>
        <div className="text-center py-8">
          <p>Loading...</p>
        </div>
      </MainLayout>
    );
  }

  return (
    <MainLayout>
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Debug Page</h1>
        <p className="text-muted-foreground">Test all components to identify issues</p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>User & Auth Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p><strong>User ID:</strong> {user?.id || "Not authenticated"}</p>
            <p><strong>Website URL:</strong> {data?.websiteUrl || "Not set"}</p>
            <p><strong>Has GSC:</strong> {data?.hasGSC ? "Yes" : "No"}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>API Tests</CardTitle>
        </CardHeader>
        <CardContent>
          <Button onClick={runTests} disabled={loading}>
            {loading ? "Running Tests..." : "Run All Tests"}
          </Button>
          
          {Object.keys(testResults).length > 0 && (
            <div className="mt-4 space-y-4">
              {Object.entries(testResults).map(([key, result]) => (
                <div key={key} className="border rounded p-3">
                  <h3 className="font-semibold capitalize">{key}</h3>
                  <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-auto">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </MainLayout>
  );
}

"use client";
import { authenticatedFetch } from '../../lib/authenticatedFetch';


import { useEffect, useState } from "react";
import { db } from "../../lib/firebaseConfig";
import { doc, getDoc } from "firebase/firestore";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"; // Assumes you have a UI input
import { getInternalLinkSuggestion, setInternalLinkSuggestion } from "../../lib/firestoreHelpers";

function extractSlug(url) {
  try {
    const path = new URL(url).pathname;
    const slug = path.split("/").filter(Boolean).pop(); // last part of the URL
    return slug || "/";
  } catch {
    return "invalid-url";
  }
}

export default function InternalLinkSuggestion({
  userId,
  page,
  targetPage,
  sitemapUrls,
  lowCtrUrls = new Set(),
  implementedPages = [],
}) {
  const [show, setShow] = useState(false); // ✅ Start with false
  const [suggestions, setSuggestions] = useState([]);
  const [editingStates, setEditingStates] = useState([]);

  useEffect(() => {
    const checkEligibility = async () => {
      // ✅ Only show if page is in implementedPages array
      if (!implementedPages.includes(page)) {
        setShow(false);
        return;
      }

      const docId = `${userId}_${encodeURIComponent(page)}`;
      const snapshot = await getDoc(doc(db, "implementedSeoTips", docId));
      const data = snapshot.data();

      if (!data?.postStats || !data?.implementedAt) {
        setShow(false);
        return;
      }

      const daysSince =
        (Date.now() - new Date(data.implementedAt).getTime()) /
        (1000 * 60 * 60 * 24);

      // ✅ Show if 30+ days have passed and still 0 clicks
      if (daysSince >= 30 && data.postStats.clicks === 0) {
        setShow(true);
      } else {
        setShow(false);
      }
    };

    checkEligibility();
  }, [page, userId, implementedPages]);

  useEffect(() => {
    const fetchAnchorTextSuggestions = async () => {
      if (!Array.isArray(sitemapUrls)) return;

      // Check Firestore for cached suggestion
      const cached = await getInternalLinkSuggestion(userId, page);
      if (cached && cached.page && cached.anchorText) {
        setSuggestions([{ page: cached.page, anchorText: cached.anchorText }]);
        setEditingStates([{ isEditing: false, text: cached.anchorText }]);
        return;
      }

      const available = sitemapUrls.filter(
        (url) => url !== page && !lowCtrUrls.has(url)
      );

      const fromUrl = available.sort(() => 0.5 - Math.random())[0];
      if (!fromUrl) return;

      const targetSlug = extractSlug(targetPage);
      const fromSlug = extractSlug(fromUrl);

      try {
        const res = await authenticatedFetch("/api/seo-assistant/anchor-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromUrl,
            toUrl: targetPage,
            targetSlug,
          }),
        });

        const json = await res.json();
        const anchorText = json.anchorText || "Learn more";

        // Save to Firestore for caching
        await setInternalLinkSuggestion(userId, page, { page: fromUrl, anchorText });

        setSuggestions([{ page: fromUrl, anchorText }]);
        setEditingStates([{ isEditing: false, text: anchorText }]);
      } catch (err) {
        console.error("❌ Failed to fetch anchor text:", err.message);
      }
    };

    fetchAnchorTextSuggestions();
  }, [sitemapUrls, page, lowCtrUrls, targetPage, userId]);

  if (!show || suggestions.length === 0) return null;

  const toggleEditing = (index) => {
    setEditingStates((prev) =>
      prev.map((s, i) => (i === index ? { ...s, isEditing: !s.isEditing } : s))
    );
  };

  const updateText = (index, newText) => {
    setEditingStates((prev) =>
      prev.map((s, i) => (i === index ? { ...s, text: newText } : s))
    );
  };

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>{page}</CardTitle>
        <CardDescription>
          Link this page from others on your site to help it get discovered.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {suggestions.map((s, i) => {
          const { isEditing, text } = editingStates[i] || {};

          return (
            <div key={i} className="bg-muted p-2 rounded text-sm">
              <p className="text-muted-foreground mb-1">Suggested link:</p>
              {isEditing ? (
                <>
                  <Input
                    value={text}
                    onChange={(e) => updateText(i, e.target.value)}
                    className="mb-2"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => toggleEditing(i)}
                      variant="default"
                    >
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        updateText(i, suggestions[i].anchorText); // revert text
                        toggleEditing(i); // exit edit mode
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <code>{`<a href="${s.page}">${text}</a>`}</code>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => toggleEditing(i)}
                    >
                      Edit
                    </Button>
                    <Button variant="secondary" size="sm">
                      Copy Link Snippet
                    </Button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// Internal server module; callable only through authenticated routes.

import { db } from "./firebaseAdmin";
import crypto from "crypto";

// Hash user ID for privacy
const hashIdentifier = (value) => {
  if (!value) return null;
  return crypto.createHash("sha256").update(value).digest("hex");
};

// Create a summary of a conversation for training purposes
export async function saveConversationSummary(userId, conversationData) {
  try {
    const { messages, businessType, businessLocation, source } =
      conversationData;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return null;
    }

    // Extract user questions and AI responses
    const userMessages = messages
      .filter((msg) => msg.role === "user")
      .map((msg) => msg.content)
      .slice(0, 5); // Limit to first 5 user messages

    const aiResponses = messages
      .filter((msg) => msg.role === "assistant")
      .map((msg) => msg.content)
      .slice(0, 5); // Limit to first 5 AI responses

    // Create summary (not full conversation for privacy)
    const summary = {
      // Business context
      businessType: businessType || null,
      businessLocation: businessLocation || null,

      // Conversation summary (anonymized)
      userQuestionsCount: userMessages.length,
      userQuestionsSample: userMessages.slice(0, 3), // First 3 questions only
      aiResponsesCount: aiResponses.length,
      totalMessages: messages.length,
      conversationLength: messages.reduce(
        (sum, msg) => sum + (msg.content?.length || 0),
        0
      ),

      // Topics discussed (extract keywords from questions)
      topics: extractTopics(userMessages),

      // Source
      source: source || "unknown", // "main-chatbot" or "corner-bubble"

      // Metadata
      hashedUserId: hashIdentifier(userId),
      createdAt: new Date().toISOString(),
    };

    // Save to subcollection structure
    // conversationSummaries/{hashedUserId}/summaries/{autoId}
    const hashedUserId = hashIdentifier(userId);
    await db
      .collection("conversationSummaries")
      .doc(hashedUserId)
      .collection("summaries")
      .add(summary);

    return summary;
  } catch (error) {
    console.error("Error saving conversation summary:", error);
    return null;
  }
}

// Extract topics/keywords from user questions
function extractTopics(userMessages) {
  const topics = new Set();
  const commonWords = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "should",
    "could",
    "can",
    "may",
    "might",
    "must",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "my",
    "your",
    "his",
    "her",
    "its",
    "our",
    "their",
    "what",
    "how",
    "why",
    "when",
    "where",
    "who",
  ]);

  userMessages.forEach((message) => {
    const words = message
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3 && !commonWords.has(word));

    words.forEach((word) => {
      if (word.length > 3) {
        topics.add(word);
      }
    });
  });

  return Array.from(topics).slice(0, 10); // Limit to 10 topics
}


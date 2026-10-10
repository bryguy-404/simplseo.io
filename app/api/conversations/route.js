import { authenticatedRoute } from '../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import { db } from "../../lib/firebaseAdmin";
import { saveConversationSummary } from "../../lib/conversationSummarizer";
import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Generate an AI-powered conversation title from the messages
async function generateConversationTitle(messages) {
  try {
    // Get conversation context (first few exchanges, limited content)
    const conversationSnippet = messages
      .slice(0, 4) // First 2 user messages + 2 AI responses max
      .map(m => `${m.role}: ${m.content.slice(0, 300)}`)
      .join('\n');

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Use cheaper, faster model for titles
      messages: [
        {
          role: "system",
          content: "Generate a concise 5-8 word title that summarizes this SEO conversation. Be specific about the topic discussed (e.g., 'Blog outline for pet grooming services', 'Meta title optimization tips', 'Keyword strategy for local business'). Do not use quotes. Just return the title, nothing else."
        },
        {
          role: "user",
          content: conversationSnippet
        }
      ],
      max_tokens: 30,
      temperature: 0.3,
    });

    const generatedTitle = completion.choices[0]?.message?.content?.trim();
    
    // Validate the title is reasonable
    if (generatedTitle && generatedTitle.length > 3 && generatedTitle.length < 100) {
      return generatedTitle;
    }
    
    return null; // Fall back to default behavior
  } catch (error) {
    console.error("Error generating AI title:", error.message);
    return null; // Fall back to default behavior
  }
}

// GET - Fetch all conversations for a user
async function handleGET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const search = searchParams.get('search') || '';
    const includeActiveCorner = searchParams.get('includeActiveCorner') === 'true';

    if (!userId) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 });
    }

    // Get all conversations for the user (without ordering to avoid index requirement)
    const snapshot = await db.collection('conversations')
      .where('userId', '==', userId)
      .get();
    
    let conversations = [];

    snapshot.forEach(doc => {
      const data = doc.data();
      conversations.push({
        id: doc.id,
        ...data,
        createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
        updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
      });
    });

    // Sort by updatedAt in JavaScript (to avoid Firestore index requirement)
    conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    // Filter out corner-bubble conversations that haven't been ended
    // Only show corner-bubble conversations in chat history if they've been explicitly ended
    // UNLESS includeActiveCorner is true (used when loading current conversation in corner bubble)
    if (!includeActiveCorner) {
      conversations = conversations.filter(conv => {
        // If it's a corner-bubble conversation, only show it if cornerEnded is true
        if (conv.source === 'corner-bubble') {
          return conv.cornerEnded === true;
        }
        // Show all other conversations (main-chatbot, etc.)
        return true;
      });
    }

    // Filter by search term if provided
    if (search) {
      conversations = conversations.filter(conv => 
        conv.title.toLowerCase().includes(search.toLowerCase()) ||
        conv.messages.some(msg => 
          msg.content.toLowerCase().includes(search.toLowerCase())
        )
      );
    }

    return NextResponse.json({ 
      success: true, 
      conversations 
    });

  } catch (error) {
    console.error("Error fetching conversations:", error);
    return NextResponse.json({ 
      error: "Failed to fetch conversations" 
    }, { status: 500 });
  }
}

// POST - Create a new conversation
async function handlePOST(req) {
  try {
    const { userId, title, messages, source } = await req.json();

    if (!userId || !messages || !Array.isArray(messages)) {
      return NextResponse.json({ 
        error: "User ID and messages are required" 
      }, { status: 400 });
    }

    // Auto-generate title - try AI first, then fallback to first message
    let conversationTitle = title;
    const firstUserMessage = messages.find(msg => msg.role === 'user');
    
    // Try AI-generated title if we have enough context (at least 2 messages)
    if (!conversationTitle && messages.length >= 2) {
      conversationTitle = await generateConversationTitle(messages);
    }
    
    // Fallback to first user message if AI fails or not enough context
    if (!conversationTitle && firstUserMessage) {
      conversationTitle = firstUserMessage.content.slice(0, 50);
      if (firstUserMessage.content.length > 50) {
        conversationTitle += '...';
      }
    } else if (!conversationTitle) {
      conversationTitle = 'New Conversation';
    }

    // Deduplication: Check if a conversation with the same first message was created recently (within 5 minutes)
    // This prevents duplicate conversations from race conditions
    // Note: This requires a Firestore composite index. If the index doesn't exist, we skip deduplication.
    if (firstUserMessage) {
      try {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const existingSnapshot = await db.collection('conversations')
        .where('userId', '==', userId)
        .where('source', '==', source || 'main-chatbot')
        .where('createdAt', '>=', fiveMinutesAgo)
        .get();

      // Check if any existing conversation has the same first user message
      for (const doc of existingSnapshot.docs) {
        const existingData = doc.data();
        const existingFirstUserMsg = existingData.messages?.find(msg => msg.role === 'user');
        
        if (existingFirstUserMsg && 
            existingFirstUserMsg.content === firstUserMessage.content &&
            existingData.messageCount === messages.length) {
          // Found duplicate - return existing conversation ID instead of creating new one
          return NextResponse.json({ 
            success: true, 
            conversationId: doc.id,
            conversation: {
              id: doc.id,
              ...existingData,
              createdAt: existingData.createdAt?.toDate?.() || new Date(existingData.createdAt),
              updatedAt: existingData.updatedAt?.toDate?.() || new Date(existingData.updatedAt)
            },
            isDuplicate: true
          });
        }
        }
      } catch (error) {
        // If index doesn't exist or query fails, log warning and continue without deduplication
        // This is non-critical - duplicates are rare and can be handled manually if needed
        console.warn("Deduplication check skipped (index may not exist):", error.message);
        // Continue to create the conversation normally
      }
    }

    const conversationData = {
      userId,
      title: conversationTitle,
      messages,
      messageCount: messages.length,
      source: source || 'main-chatbot', // Default to main-chatbot for backward compatibility
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: {
        lastActivity: new Date(),
        tags: []
      }
    };

    const docRef = await db.collection('conversations').add(conversationData);

    // Save conversation summary for training (async, don't block response)
    try {
      // Get user's onboarding data for business context
      const onboardingDoc = await db.collection('onboarding').doc(userId).get();
      const onboarding = onboardingDoc.exists ? onboardingDoc.data() : {};
      
      saveConversationSummary(userId, {
        messages,
        businessType: onboarding.businessType,
        businessLocation: onboarding.businessLocation,
        source: source || 'main-chatbot',
      }).catch(err => {
        console.error("Failed to save conversation summary (non-critical):", err);
      });
    } catch (err) {
      // Non-critical - don't fail the request
      console.error("Error saving conversation summary:", err);
    }

    return NextResponse.json({ 
      success: true, 
      conversationId: docRef.id,
      conversation: {
        id: docRef.id,
        ...conversationData
      }
    });

  } catch (error) {
    console.error("Error creating conversation:", error);
    return NextResponse.json({ 
      error: "Failed to create conversation" 
    }, { status: 500 });
  }
}

export const GET = authenticatedRoute(handleGET);
export const POST = authenticatedRoute(handlePOST, { quota: 'ai' });

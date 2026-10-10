import { authenticatedRoute } from '../../../lib/server/authenticatedRoute';
import { NextResponse } from "next/server";
import { db } from "../../../lib/firebaseAdmin";
import { saveConversationSummary } from "../../../lib/conversationSummarizer";

// GET - Fetch a specific conversation
async function handleGET(req, { params }) {
  try {
    const { id } = await params;
    const userId = new URL(req.url).searchParams.get('userId');

    if (!id) {
      return NextResponse.json({ error: "Conversation ID is required" }, { status: 400 });
    }

    const doc = await db.collection('conversations').doc(id).get();

    if (!doc.exists || doc.data().userId !== userId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    const data = doc.data();
    const conversation = {
      id: doc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
    };

    return NextResponse.json({ 
      success: true, 
      conversation 
    });

  } catch (error) {
    console.error("Error fetching conversation:", error);
    return NextResponse.json({ 
      error: "Failed to fetch conversation" 
    }, { status: 500 });
  }
}

// PUT - Update a conversation (rename, add messages, etc.)
async function handlePUT(req, { params }) {
  try {
    const { id } = await params;
    const userId = new URL(req.url).searchParams.get('userId');
    const { title, messages, action, cornerEnded } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Conversation ID is required" }, { status: 400 });
    }

    const conversationRef = db.collection('conversations').doc(id);
    const doc = await conversationRef.get();

    if (!doc.exists || doc.data().userId !== userId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    let updateData = {
      updatedAt: new Date()
    };

    if (action === 'rename' && title) {
      updateData.title = title;
    } else if (action === 'cornerEnd') {
      updateData.cornerEnded = cornerEnded || true;
    } else if (action === 'addMessage' && messages) {
      updateData.messages = messages;
      updateData.messageCount = messages.length;
      updateData.metadata = {
        ...doc.data().metadata,
        lastActivity: new Date()
      };
    }

    await conversationRef.update(updateData);

    // Fetch updated conversation
    const updatedDoc = await conversationRef.get();
    const data = updatedDoc.data();
    const conversation = {
      id: updatedDoc.id,
      ...data,
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
      updatedAt: data.updatedAt?.toDate?.() || new Date(data.updatedAt)
    };

    // Save conversation summary when conversation is updated (async, don't block response)
    if (action === 'addMessage' && messages && messages.length >= 2) {
      try {
        const userId = data.userId;
        const onboardingDoc = await db.collection('onboarding').doc(userId).get();
        const onboarding = onboardingDoc.exists ? onboardingDoc.data() : {};
        
        saveConversationSummary(userId, {
          messages,
          businessType: onboarding.businessType,
          businessLocation: onboarding.businessLocation,
          source: data.source || 'main-chatbot',
        }).catch(err => {
          console.error("Failed to save conversation summary (non-critical):", err);
        });
      } catch (err) {
        // Non-critical - don't fail the request
        console.error("Error saving conversation summary:", err);
      }
    }

    return NextResponse.json({ 
      success: true, 
      conversation 
    });

  } catch (error) {
    console.error("Error updating conversation:", error);
    return NextResponse.json({ 
      error: "Failed to update conversation" 
    }, { status: 500 });
  }
}

// DELETE - Delete a conversation
async function handleDELETE(req, { params }) {
  try {
    const { id } = await params;
    const userId = new URL(req.url).searchParams.get('userId');

    if (!id) {
      return NextResponse.json({ error: "Conversation ID is required" }, { status: 400 });
    }

    const conversationRef = db.collection('conversations').doc(id);
    const doc = await conversationRef.get();

    if (!doc.exists || doc.data().userId !== userId) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    await conversationRef.delete();

    return NextResponse.json({ 
      success: true, 
      message: "Conversation deleted successfully" 
    });

  } catch (error) {
    console.error("Error deleting conversation:", error);
    return NextResponse.json({ 
      error: "Failed to delete conversation" 
    }, { status: 500 });
  }
}

export const GET = authenticatedRoute(handleGET);
export const PUT = authenticatedRoute(handlePUT);
export const DELETE = authenticatedRoute(handleDELETE);
